import { SdkFileAccess } from 'kcd_sdk'
import { McpTrace } from './McpTrace'

type TextBlock = { type: 'text'; text: string }

/**
 * MCPUtils — the MCP-local utility surface as one bounded object (mirrors starmind_kcd's). Holds
 * the shared SdkFileAccess core (the SAME read/list/floors every reader enforces) and the MCP
 * wire-envelope helpers. Imported as the object — never as loose functions.
 */
export class MCPUtils {

	private static _files: SdkFileAccess | null = null

	/** The shared file-access core. General disk: WhitelistGuard supplies authorization, the core
	 *  supplies the resource floors. One instance per process — no config dependency to rebuild on.
	 *  Its degrade-warnings (list/glob caps, denied subtrees) route to the WARNINGS trace channel so
	 *  a made-safe-locally truncation is visible, not swallowed. (read uses its own capturing instance
	 *  — its degrades are per-item reasons returned in-band, not warnings.) */
	static get files(): SdkFileAccess {
		if( this._files === null ) {
			this._files = new SdkFileAccess( ( event, detail ) => {
				McpTrace.warn( `starmind_file.access.${ event }`, detail )
			} )
		}
		return this._files
	}

	/** Wrap any serialisable value in the MCP text-content envelope. */
	static result( data: unknown ): { content: TextBlock[] } {
		return { content: [ { type: 'text', text: JSON.stringify( data, null, 2 ) } ] }
	}

	/** Error response the MCP client surfaces as a tool failure. */
	static error( message: string ): { content: TextBlock[]; isError: true } {
		return { content: [ { type: 'text', text: message } ], isError: true }
	}
}
