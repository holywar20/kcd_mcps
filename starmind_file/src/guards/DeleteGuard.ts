import { SdkFileAccess } from 'kcd_sdk'
import { loadConfig } from '../config'
import { Blacklist } from '../Blacklist'
import { McpTrace } from '../McpTrace'

/** Why a delete was refused — returned in-band per file (batch tools never throw the whole call). */
export type DeleteDenial =
	| 'no_write_roots'          // nothing is write-enabled — deletes ride the write surface, off by default
	| 'outside_write_surface'   // path is not inside a write-enabled root
	| 'out_of_scope'            // a secret/blacklist pattern (cannot delete credentials, .git, …)

/**
 * DeleteGuard — the delete surface's jail. Delete rides the WRITE surface exactly: a write-enabled root is a
 * deletable root. So it reuses WriteGuard's first two gates and DROPS the two that are write-CONTENT concerns
 * (extension allowlist, size cap — a delete has no content):
 *
 *   1. write-enabled containment — the path sits inside a root flagged `write: true` (separate from the read
 *      `enabled` flag). With nothing write-enabled, ALL deletes are refused — the severe default.
 *   2. blacklist — the same secret/.git/.ssh deny-list reads and writes honour; you can never delete a
 *      blacklisted secret.
 *
 * Static, non-throwing (`permits`) like WriteGuard.permits — the batch delete tool checks per file so one
 * denied path never sinks the batch. Every denial traces to the GUARD channel (visible in the dev overlay),
 * decided by config + pattern BEFORE any disk touch.
 *
 * NOTE — CONTAINMENT ONLY. Whether a contained delete also needs a human's approval is decided one layer up,
 * host-side at the ToolGate (the Interaction Deck's delete gate), never here. The server stays a thin gate;
 * it only declares destructiveHint so the host knows to gate it.
 */
export class DeleteGuard {

	/** Per-path verdict — null when the delete is allowed, else the denial reason (already traced). */
	static permits( tool: string, path: string ): DeleteDenial | null {
		const code = DeleteGuard.contain( path )
		if( code ) {
			McpTrace.guard( 'starmind_file.guard.rejected', { tool, path, code } )
		}
		return code
	}

	/** The two-gate containment check. Returns a denial code, or null when both gates pass. */
	static contain( path: string ): DeleteDenial | null {
		const roots = DeleteGuard.writeRoots()
		if( roots.length === 0 )                         return 'no_write_roots'
		if( SdkFileAccess.jail( path, roots ) === null ) return 'outside_write_surface'
		if( Blacklist.excludes( path ) )                 return 'out_of_scope'
		return null
	}

	/** Roots a delete may touch — enabled AND explicitly write-flagged, read fresh on every call (a delete
	 *  is a write-surface operation, so it shares the write roots exactly). */
	private static writeRoots(): string[] {
		const roots: string[] = []
		for( const entry of loadConfig().whitelist ) {
			if( entry.enabled && entry.write ) {
				roots.push( entry.path )
			}
		}
		return roots
	}
}
