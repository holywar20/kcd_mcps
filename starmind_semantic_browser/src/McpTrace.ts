import { appendFileSync } from 'fs'
import { join } from 'path'

/**
 * McpTrace — the child's one-way write into Starmind's debug trace. The file IS the interchange:
 * this child is a separate spawned process with no MainBus, so instead of a Bus.debug event it appends
 * a JSONL line to a userData trace file that the host's TraceTail viewer reads on demand. The host gives
 * the dir at spawn (STARMIND_TRACE_DIR); the GUARD filename is the contract with the matching
 * DebugChannels.GUARD entry ('trace-guards.jsonl') — the SAME channel starmind_file writes to, so a
 * denial here shows in the same dev-overlay tab, tagged by `source`.
 *
 * Best-effort and silent on failure: a trace must never break a tool call. Writes tool names + URLs +
 * event names only — never credentials — so skipping the host's redaction layer is safe.
 */
export class McpTrace {

	private static readonly GUARD_FILE = 'trace-guards.jsonl'

	/** A guard rejection (origin or tier denial) → the GUARD channel. */
	static guard( source: string, payload: Record<string, unknown> ): void {
		const dir = process.env[ 'STARMIND_TRACE_DIR' ]
		if( !dir ) {
			return
		}
		try {
			const line = JSON.stringify( { kind: 'trace', source, payload, ts: Date.now() } )
			appendFileSync( join( dir, McpTrace.GUARD_FILE ), line + '\n', 'utf-8' )
		} catch {
			// best-effort: never let tracing break a tool call
		}
	}
}
