import { Cdp } from './Cdp';
import type { HostConnector } from './HostConnector';
import { StaleRefError } from '../types';
import type { BrowserSession, DistilledElement, ElementRef, PageSnapshot } from '../types';

/**
 * ChromeConnector — the first BrowserConnector: a BrowserSession over the Chrome DevTools Protocol.
 *
 * Where the session model lives. The connector holds ONE live CDP connection bound to a single page
 * target (the deliberate held-connection exception to stateless-per-call) and a "current page". Reads
 * distil the page by tagging each interesting element with a `data-smref` attribute and returning
 * `[ref] role "name"`; acts resolve a ref back to its tagged node on the LIVE page. A ref whose tag is
 * gone (the DOM moved) yields a StaleRefError — the tool folds that into a re-read, never a mis-click.
 *
 * When `overlay` is on (default; Phase 3 wires it to config), every distil also paints a set-of-marks
 * overlay — numbered boxes over the elements it returned, so a human watches what the agent perceives.
 * The numbers ARE the refs. read_raw strips the overlay (and our tags) so the source stays honest.
 */
export class ChromeConnector implements BrowserSession {

	private cdp: Cdp | null = null;
	private overlay: () => boolean;

	constructor( private host: HostConnector, opts: { overlay?: boolean | ( () => boolean ) } = {} ) {
		const o = opts.overlay ?? true;
		this.overlay = typeof o === 'function' ? o : () => o;   // a thunk so a config toggle reads fresh each distil
	}

	async navigate( url: string ): Promise<PageSnapshot> {
		const cdp    = await this.ensure();
		const loaded = cdp.once( 'Page.loadEventFired' );
		await cdp.send( 'Page.navigate', { url } );
		await Promise.race( [ loaded, this.wait( SETTLE_TIMEOUT_MS ) ] );   // settle: load event or timeout…
		await this.wait( SETTLE_DEBOUNCE_MS );                             // …then a short debounce (network-idle tuning is a later refinement)
		return this.distill();
	}

	async readPage(): Promise<PageSnapshot> {
		await this.ensure();
		return this.distill();
	}

	async readRaw(): Promise<string> {
		await this.ensure();
		return this.evaluate<string>( JS.rawClean );   // outerHTML with the overlay + our tags stripped
	}

	/** The live URL of the current page — the guard chain's origin check reads this before each op. */
	async currentUrl(): Promise<string> {
		await this.ensure();
		return this.evaluate<string>( 'location.href' );
	}

	async scroll( direction: 'down' | 'up' ): Promise<PageSnapshot> {
		await this.ensure();
		await this.evaluate( JS.scroll( direction === 'down' ) );
		await this.wait( SETTLE_DEBOUNCE_MS );
		return this.distill();
	}

	async click( ref: ElementRef ): Promise<DistilledElement> {
		const cdp = await this.ensure();
		const hit = await this.evaluate<{ x: number; y: number; role: string; name: string } | null>( JS.clickAt( ref ) );
		if ( !hit ) throw new StaleRefError( ref );
		await cdp.send( 'Input.dispatchMouseEvent', { type: 'mousePressed',  x: hit.x, y: hit.y, button: 'left', buttons: 1, clickCount: 1 } );
		await cdp.send( 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', buttons: 1, clickCount: 1 } );
		return { ref, role: hit.role, name: hit.name };
	}

	async type( ref: ElementRef, text: string ): Promise<DistilledElement> {
		const cdp = await this.ensure();
		const hit = await this.evaluate<{ role: string; name: string } | null>( JS.focusAt( ref ) );
		if ( !hit ) throw new StaleRefError( ref );
		await cdp.send( 'Input.insertText', { text } );
		return { ref, role: hit.role, name: hit.name };
	}

	/** Drop the connection and let the host tear down what it started. */
	async close(): Promise<void> {
		this.cdp?.close();
		this.cdp = null;
		await this.host.close();
	}

	// ── internals ───────────────────────────────────────────────────────────────

	/** Lazily launch + connect on first use; enable the domains the reads/acts need. */
	private async ensure(): Promise<Cdp> {
		if ( this.cdp ) return this.cdp;
		const cdp = await Cdp.connect( await this.host.launch() );
		await cdp.send( 'Page.enable' );
		await cdp.send( 'Runtime.enable' );
		this.cdp = cdp;
		return cdp;
	}

	private async distill(): Promise<PageSnapshot> {
		const raw = await this.evaluate<{ url: string; title: string; elements: DistilledElement[]; truncated: boolean }>( JS.distill );
		if ( this.overlay() ) await this.evaluate( JS.paint );
		return { url: raw.url, title: raw.title, elements: raw.elements, truncated: raw.truncated };
	}

	private async evaluate<T>( expression: string ): Promise<T> {
		const cdp = await this.ensure();
		const r: any = await cdp.send( 'Runtime.evaluate', { expression, returnByValue: true } );
		if ( r.exceptionDetails ) throw new Error( r.exceptionDetails.exception?.description ?? 'page evaluate failed' );
		return r.result.value as T;
	}

	private wait( ms: number ): Promise<void> {
		return new Promise( ( r ) => setTimeout( r, ms ) );
	}
}

const SETTLE_TIMEOUT_MS  = 5000;
const SETTLE_DEBOUNCE_MS = 250;
const ELEMENT_CAP        = 150;   // budget floor for a dumb model's context; `truncated` flags when hit

/**
 * The in-page scripts, as a bucket. Each returns a JSON-serialisable value via Runtime.evaluate.
 *
 * `distill` clears prior tags, then tags every VISIBLE interesting element with `data-smref` and
 * returns a tuned `{ role, name, value?, hint? }` per element — semantic roles, names resolved through
 * aria/label, a disambiguating hint, nameless decoration dropped. `paint` draws the set-of-marks
 * overlay over those tags. The act scripts resolve a tag on the live page, returning null when gone
 * (stale). `rawClean` returns honest source (overlay + tags removed). Note `\\s` — the regex must
 * survive into the page as `\s`, not be eaten as a template escape; page-side strings use concatenation
 * to avoid `${}` collisions with TS interpolation.
 */
const JS = {
	distill: `(() => {
		document.querySelectorAll( '[data-smref]' ).forEach( ( e ) => e.removeAttribute( 'data-smref' ) );
		const SEL = 'a,button,input,select,textarea,[role],[contenteditable="true"],h1,h2,h3,h4';
		const visible = ( el, r ) => {
			if ( r.width === 0 && r.height === 0 ) return false;
			if ( el.getAttribute( 'aria-hidden' ) === 'true' ) return false;
			const st = getComputedStyle( el );
			return st.visibility !== 'hidden' && st.display !== 'none';
		};
		const roleOf = ( el ) => {
			const explicit = el.getAttribute( 'role' ); if ( explicit ) return explicit;
			const tag = el.tagName;
			if ( tag === 'A' ) return 'link';
			if ( tag === 'BUTTON' ) return 'button';
			if ( tag === 'SELECT' ) return 'combobox';
			if ( tag === 'TEXTAREA' ) return 'textbox';
			if ( /^H[1-6]$/.test( tag ) ) return 'heading';
			if ( tag === 'INPUT' ) {
				const t = ( el.getAttribute( 'type' ) || 'text' ).toLowerCase();
				if ( t === 'checkbox' ) return 'checkbox';
				if ( t === 'radio' ) return 'radio';
				if ( t === 'submit' || t === 'button' || t === 'reset' ) return 'button';
				if ( t === 'range' ) return 'slider';
				return 'textbox';
			}
			return tag.toLowerCase();
		};
		const nameOf = ( el ) => {
			const it = el.tagName === 'INPUT' ? ( el.getAttribute( 'type' ) || 'text' ).toLowerCase() : '';
			if ( ( it === 'submit' || it === 'button' || it === 'reset' ) && el.value ) return el.value;
			const aria = el.getAttribute( 'aria-label' ); if ( aria ) return aria;
			const lb = el.getAttribute( 'aria-labelledby' );
			if ( lb ) { const t = document.getElementById( lb ); if ( t ) return t.innerText || ''; }
			if ( el.id ) { const lab = document.querySelector( 'label[for="' + el.id + '"]' ); if ( lab ) return lab.innerText || ''; }
			const wrap = el.closest( 'label' ); if ( wrap ) return wrap.innerText || '';
			const txt = ( el.innerText || '' ).trim(); if ( txt ) return txt;
			return el.getAttribute( 'title' ) || el.getAttribute( 'placeholder' ) || el.getAttribute( 'alt' ) || el.getAttribute( 'name' ) || '';
		};
		const hintOf = ( el, role ) => {
			if ( role === 'link' ) { const h = el.getAttribute( 'href' ) || ''; return h.startsWith( 'javascript' ) ? '' : h.slice( 0, 60 ); }
			if ( role === 'textbox' || role === 'combobox' ) return el.placeholder || '';
			return '';
		};
		const all = [ ...document.querySelectorAll( SEL ) ].filter( ( el ) => visible( el, el.getBoundingClientRect() ) );
		const elements = [];
		let truncated = false;
		for ( const el of all ) {
			const role = roleOf( el );
			const isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
			const name = nameOf( el ).replace( /\\s+/g, ' ' ).trim().slice( 0, 80 );
			if ( !name && !isField ) continue;                         // drop nameless decoration
			if ( elements.length >= ${ ELEMENT_CAP } ) { truncated = true; break; }
			el.setAttribute( 'data-smref', String( elements.length ) );
			const e = { ref: elements.length, role, name };
			if ( isField && 'value' in el ) e.value = el.value;
			const hint = hintOf( el, role ); if ( hint ) e.hint = hint;
			elements.push( e );
		}
		return { url: location.href, title: document.title, elements, truncated };
	})()`,

	paint: `(() => {
		const ID = '__sm_overlay';
		const old = document.getElementById( ID ); if ( old ) old.remove();
		const layer = document.createElement( 'div' );
		layer.id = ID;
		layer.setAttribute( 'style', 'position:fixed;inset:0;pointer-events:none;z-index:2147483647' );
		const C = '#e11d8f';
		document.querySelectorAll( '[data-smref]' ).forEach( ( el ) => {
			const r = el.getBoundingClientRect();
			if ( r.width === 0 && r.height === 0 ) return;
			if ( r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth ) return;
			const box = document.createElement( 'div' );
			box.setAttribute( 'style', 'position:absolute;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;border:2px solid ' + C + ';box-sizing:border-box;border-radius:2px' );
			const tag = document.createElement( 'div' );
			tag.textContent = el.getAttribute( 'data-smref' );
			tag.setAttribute( 'style', 'position:absolute;left:' + r.left + 'px;top:' + Math.max( 0, r.top - 15 ) + 'px;background:' + C + ';color:#fff;font:11px/14px sans-serif;padding:0 4px;border-radius:2px' );
			layer.appendChild( box ); layer.appendChild( tag );
		} );
		document.documentElement.appendChild( layer );
		return true;
	})()`,

	rawClean: `(() => {
		const clone = document.documentElement.cloneNode( true );
		const o = clone.querySelector( '#__sm_overlay' ); if ( o ) o.remove();
		clone.querySelectorAll( '[data-smref]' ).forEach( ( e ) => e.removeAttribute( 'data-smref' ) );
		return clone.outerHTML;
	})()`,

	scroll: ( down: boolean ): string => `(() => { window.scrollBy( 0, ${ down ? 1 : -1 } * Math.round( innerHeight * 0.8 ) ); return true; })()`,

	clickAt: ( ref: number ): string => `(() => {
		const el = document.querySelector( '[data-smref="${ ref }"]' );
		if ( !el ) return null;
		el.scrollIntoView( { block: 'center', inline: 'center' } );
		const r = el.getBoundingClientRect();
		const role = el.getAttribute( 'role' ) || el.tagName.toLowerCase();
		const name = ( el.innerText || el.value || el.getAttribute( 'aria-label' ) || el.placeholder || '' ).trim().replace( /\\s+/g, ' ' ).slice( 0, 80 );
		return { x: r.x + r.width / 2, y: r.y + r.height / 2, role, name };
	})()`,

	focusAt: ( ref: number ): string => `(() => {
		const el = document.querySelector( '[data-smref="${ ref }"]' );
		if ( !el ) return null;
		el.scrollIntoView( { block: 'center' } );
		el.focus();
		const role = el.getAttribute( 'role' ) || el.tagName.toLowerCase();
		const name = ( el.getAttribute( 'aria-label' ) || el.placeholder || el.name || '' ).trim().slice( 0, 80 );
		return { role, name };
	})()`,
};
