import { appendFileSync } from 'fs'
import { join } from 'path'

/**
 * McpTrace — the child's one-way write into Starmind's debug trace. The file IS the interchange:
 * this child is a separate spawned process with no MainBus, so instead of a Bus.debug event it
 * appends a JSONL line to a userData trace file that the host's TraceTail viewer reads on demand.
 * The host gives the dir at spawn (STARMIND_TRACE_DIR); the filenames below are the contract with
 * the matching DebugChannels entries (GUARD -> 'trace-guards.jsonl', WARNINGS ->
 * 'trace-warnings.jsonl', CAPABILITY -> 'trace-capability.jsonl' in
 * starmind/src/shared/spine/DebugChannels.ts) — keep both in sync.
 *
 * Best-effort and silent on failure: a trace must never break a tool call. Writes tool names +
 * path strings + event names only — never credentials — so skipping the host's redaction layer is safe.
 */
export class McpTrace {

	private static readonly GUARD_FILE = 'trace-guards.jsonl'
	private static readonly WARN_FILE  = 'trace-warnings.jsonl'
	private static readonly CAP_FILE   = 'trace-capability.jsonl'

	/** A guard rejection (a whitelist denial) -> the GUARD channel. */
	static guard( source: string, payload: Record<string, unknown> ): void {
		McpTrace._append( McpTrace.GUARD_FILE, source, payload )
	}

	/** What ARRIVED of the grants the host asserted -> the CAPABILITY channel, the same file the host
	 *  writes the hand-over into. That shared file is the point: `sessions.grant` and `grant.env_seeded`
	 *  land there from main, this lands there from the child, and a count that changes between two
	 *  adjacent lines names the hop that lost it. Split across two files it would be a correlation job. */
	static capability( source: string, payload: Record<string, unknown> ): void {
		McpTrace._append( McpTrace.CAP_FILE, source, payload )
	}

	/** A non-fatal degrade (a cap hit, a denied subtree) -> the WARNINGS channel. Made-safe locally;
	 *  this bubbles the fact up so it is visible rather than swallowed. */
	static warn( source: string, payload: Record<string, unknown> ): void {
		McpTrace._append( McpTrace.WARN_FILE, source, payload )
	}

	/** Append one JSONL line to a userData trace file, or do nothing if no trace dir / on failure. */
	private static _append( file: string, source: string, payload: Record<string, unknown> ): void {
		const dir = process.env[ 'STARMIND_TRACE_DIR' ]
		if( !dir ) {
			return
		}
		try {
			const line = JSON.stringify( { kind: 'trace', source, payload, ts: Date.now() } )
			appendFileSync( join( dir, file ), line + '\n', 'utf-8' )
		} catch {
			// best-effort: never let tracing break a tool call
		}
	}
}
