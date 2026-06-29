import type { ToolDefinition } from 'kcd_sdk';
import { MCPUtils } from './MCPUtils';
import { StaleRefError } from './types';
import type { BrowserSession } from './types';

/**
 * The semantic-browser tool surface — five explicit verbs over a BrowserSession.
 *
 * Reads (read_page / read_raw / scroll) are read-only; navigate / click / type carry side effects.
 * Handlers stay thin: validate args, call the session, fold any failure into a structured
 * result — they never throw across the MCP boundary. The origin guard chain inserts ahead
 * of the session call in Phase 3.
 *
 * No screenshot tool, by design: the model reasons from the distilled text list, not pixels (the
 * semantic thesis — the cleaner the surface, the less a dumb model carries). The human watches the
 * live set-of-marks overlay instead; the agent never receives an image.
 */
export function browserTools( session: BrowserSession ): ToolDefinition[] {
	return [
		{
			name:        'navigate',
			annotations: { openWorldHint: true },
			example:     { url: 'https://example.com' },
			description: 'Go to a URL in the browser; returns a one-line summary of the page that loaded.',
			doc:
				'Point the current page at `url`, wait for it to settle, and return a brief summary (final ' +
				'URL, title, count of actionable elements). It does NOT list the elements — call read_page ' +
				'for that. The URL is jailed to a whitelisted origin; a disallowed origin is refused before ' +
				'any navigation. Changes page state.',
			inputSchema: {
				type:                 'object',
				properties:           { url: { type: 'string', description: 'Absolute URL to navigate to (must be a whitelisted origin).' } },
				required:             [ 'url' ],
				additionalProperties: false,
			},
			handler: async ( args ) => {
				try {
					const snap = await session.navigate( String( args[ 'url' ] ?? '' ) );
					return MCPUtils.text( `Navigated to ${ snap.url } (${ snap.title || 'untitled' }). ${ snap.elements.length } actionable elements — call read_page to list them.` );
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'read_page',
			annotations: { readOnlyHint: true },
			description: 'List the actionable + salient elements on the current page, each with a [ref] to act on.',
			doc:
				'Distil the current page to the elements that matter — interactive controls, landmarks, ' +
				'headings — each as `[ref] role "name"` (plus value for inputs). The [ref] is what click and ' +
				'type take. Scoped to the viewport and capped so a large page stays readable; a "truncated" ' +
				'flag marks when some were dropped (scroll, then read again). Read-only.',
			inputSchema: { type: 'object', properties: {}, additionalProperties: false },
			handler: async () => {
				try {
					return MCPUtils.text( MCPUtils.renderSnapshot( await session.readPage() ) );
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'read_raw',
			annotations: { readOnlyHint: true },
			description: 'Return the full raw HTML of the current page — slow; prefer read_page unless you need the source.',
			doc:
				'Return the complete outerHTML of the current page. The slow escape hatch for when the ' +
				'distilled read_page dropped something you need (hidden markup, attributes, exact text). ' +
				'Large and unstructured — reach for read_page first. Read-only.',
			inputSchema: { type: 'object', properties: {}, additionalProperties: false },
			handler: async () => {
				try {
					return MCPUtils.text( await session.readRaw() );
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'scroll',
			annotations: { readOnlyHint: true },
			example:     { direction: 'down' },
			description: 'Scroll the page up or down by ~one screen and return the freshly distilled view.',
			doc:
				'Scroll the current page by roughly one viewport in `direction` (down | up) and return the ' +
				're-distilled element list — reach for it when read_page came back "truncated" or the element ' +
				'you need is below the fold. Refs are reassigned by the new read, so act on the refs this returns.',
			inputSchema: {
				type:                 'object',
				properties:           { direction: { type: 'string', enum: [ 'down', 'up' ], description: 'Scroll direction.' } },
				required:             [ 'direction' ],
				additionalProperties: false,
			},
			handler: async ( args ) => {
				try {
					const dir = args[ 'direction' ] === 'up' ? 'up' : 'down';
					return MCPUtils.text( MCPUtils.renderSnapshot( await session.scroll( dir ) ) );
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'click',
			annotations: { openWorldHint: true },
			example:     { ref: 0 },
			description: 'Click the element with the given [ref] from the latest read_page.',
			doc:
				'Click the element addressed by `ref` (a number from the most recent read_page) and return ' +
				'a confirmation of what was clicked. If the page changed since that read the ref is stale, ' +
				'and the call returns a re-read prompt instead of clicking — call read_page and retry. ' +
				'Changes page state.',
			inputSchema: {
				type:                 'object',
				properties:           { ref: { type: 'integer', minimum: 0, description: 'Element ref from the latest read_page.' } },
				required:             [ 'ref' ],
				additionalProperties: false,
			},
			handler: async ( args ) => {
				try {
					const el = await session.click( Number( args[ 'ref' ] ) );
					return MCPUtils.text( `Clicked [${ el.ref }] ${ el.role } ${ JSON.stringify( el.name ) }.` );
				} catch ( e ) {
					if ( e instanceof StaleRefError ) return MCPUtils.error( `${ e.message }. Call read_page and retry.` );
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'type',
			annotations: { openWorldHint: true },
			example:     { ref: 1, text: 'hello' },
			description: 'Type text into the input element with the given [ref] from the latest read_page.',
			doc:
				'Focus the input addressed by `ref` (a number from the most recent read_page) and type ' +
				'`text` into it, returning a confirmation. A stale ref (page changed since the read) returns ' +
				'a re-read prompt instead of typing — call read_page and retry. Changes page state.',
			inputSchema: {
				type:                 'object',
				properties:           {
					ref:  { type: 'integer', minimum: 0, description: 'Element ref from the latest read_page.' },
					text: { type: 'string', description: 'Text to type into the element.' },
				},
				required:             [ 'ref', 'text' ],
				additionalProperties: false,
			},
			handler: async ( args ) => {
				try {
					const text = String( args[ 'text' ] ?? '' );
					const el   = await session.type( Number( args[ 'ref' ] ), text );
					return MCPUtils.text( `Typed ${ JSON.stringify( text ) } into [${ el.ref }] ${ el.role } ${ JSON.stringify( el.name ) }.` );
				} catch ( e ) {
					if ( e instanceof StaleRefError ) return MCPUtils.error( `${ e.message }. Call read_page and retry.` );
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
	];
}
