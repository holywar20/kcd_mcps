/**
 * Domain types for the semantic-browser surface — the shape the tools speak.
 *
 * A DistilledElement is one actionable-or-salient node the model can see and address.
 * Its `ref` is SNAPSHOT-SCOPED: issued by a read_page, valid only against the page that
 * produced it. When the DOM has moved, resolving a stale ref yields a re-read result,
 * never a mis-click (the session model — Phase 1.c).
 */

/** Snapshot-scoped handle to a distilled element. Stable only within one read_page result. */
export type ElementRef = number;

/** One element the model can see and act on, as returned by read_page. */
export interface DistilledElement {
	ref:    ElementRef;
	role:   string;            // semantic role — 'button' | 'link' | 'textbox' | 'heading' | …
	name:   string;            // accessible name / visible text, trimmed
	value?: string;            // current value, for inputs
	hint?:  string;            // short disambiguating context when the name alone is weak
}

/** The distilled view of the current page returned by read_page (and behind navigate's summary). */
export interface PageSnapshot {
	url:       string;
	title:     string;
	elements:  DistilledElement[];
	truncated: boolean;        // true when the viewport scope / element cap dropped some
}

/**
 * BrowserSession — the seam every tool calls. One live browser + a "current page", owned
 * by a connector for its lifetime: the deliberate held-connection exception to
 * stateless-per-call (a resource, not accumulated logic). ChromeConnector (Phase 1.d) is
 * the first implementation; a TestBrowserSession double drives verify later.
 *
 * The acting methods resolve a snapshot-scoped ref against the live page. A ref that no
 * longer maps to a node throws StaleRefError; the tool handler folds that into a re-read
 * result rather than acting on the wrong node.
 */
export interface BrowserSession {
	navigate( url: string ): Promise<PageSnapshot>;
	readPage(): Promise<PageSnapshot>;
	readRaw(): Promise<string>;
	scroll( direction: 'down' | 'up' ): Promise<PageSnapshot>;         // scroll ~one screen, return the fresh distil
	click( ref: ElementRef ): Promise<DistilledElement>;               // returns the element acted on
	type( ref: ElementRef, text: string ): Promise<DistilledElement>;  // returns the element typed into
	currentUrl(): Promise<string>;                                     // the live URL of the current page — the guard's origin check
}

/** Thrown by a session when a snapshot-scoped ref no longer maps to a live node (stale or unknown). */
export class StaleRefError extends Error {
	constructor( readonly ref: ElementRef ) {
		super( `ref [${ ref }] is stale — the page changed since the last read_page` );
		this.name = 'StaleRefError';
	}
}
