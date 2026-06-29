import type { PageSnapshot } from './types';

type TextBlock = { type: 'text'; text: string };

/**
 * MCPUtils — the MCP-local utility surface as one bounded object.
 *
 * The wire-envelope helpers plus the page renderer every read handler needs. Imported as
 * the object — `import { MCPUtils }` — never as loose functions, so a reader sees the whole
 * MCP-local surface in one place. Unlike the file/kcd servers these results are plain TEXT,
 * not JSON: a dumb model reads the distilled page directly.
 */
export class MCPUtils {

	/** Plain-text tool result — the model reads the body directly. */
	static text( body: string ): { content: TextBlock[] } {
		return { content: [ { type: 'text', text: body } ] };
	}

	/** Error result the MCP client surfaces as a tool failure (the model sees it and self-corrects). */
	static error( message: string ): { content: TextBlock[]; isError: true } {
		return { content: [ { type: 'text', text: message } ], isError: true };
	}

	/** Render a distilled page as the compact, ref-bearing list the model acts from. */
	static renderSnapshot( s: PageSnapshot ): string {
		const head = `${ s.title || '(untitled)' } — ${ s.url }  (${ s.elements.length } elements${ s.truncated ? ', truncated' : '' })`;
		const rows = s.elements.map( ( e ) => {
			const val  = e.value !== undefined ? `  (value: ${ JSON.stringify( e.value ) })` : '';
			const hint = e.hint ? `  — ${ e.hint }` : '';
			return `[${ e.ref }] ${ e.role } ${ JSON.stringify( e.name ) }${ val }${ hint }`;
		} );
		return [ head, ...rows ].join( '\n' );
	}
}
