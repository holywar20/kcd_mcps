import { extname } from 'path'
import { SdkFileAccess } from 'kcd_sdk'
import { loadConfig, WRITE_EXTENSIONS, WRITE_MAX_BYTES } from '../config'
import { Blacklist } from '../Blacklist'
import { McpTrace } from '../McpTrace'

/** Why a write was refused — returned in-band per file (batch tools never throw the whole call). */
export type WriteDenial =
	| 'no_write_roots'          // nothing is write-enabled — the severe default (writes OFF)
	| 'outside_write_surface'   // path is not inside a write-enabled root
	| 'out_of_scope'            // a secret/blacklist pattern (cannot write over credentials, .git, …)
	| 'extension_blocked'       // not an allowed write extension (no code / executables while testing)
	| 'too_large'               // content exceeds the size cap

/**
 * WriteGuard — the write surface's jail. The DELIBERATELY-NARROW counterpart to WhitelistGuard: reads are
 * permitted across every enabled root, but a WRITE must clear FOUR independent gates, every one of which
 * defaults to denying:
 *
 *   1. write-enabled containment — the path sits inside a root flagged `write: true` (separate from the
 *      read `enabled` flag). With nothing write-enabled, ALL writes are refused. This is the headline
 *      "severely limited while testing" posture — the write surface is empty until a user opts a root in.
 *   2. blacklist — the same secret/.git/.ssh deny-list reads honour; you can never write OVER a secret.
 *   3. extension allowlist — text + asset/data types only (WRITE_EXTENSIONS); no .js/.ts/.sh/.exe/… so a
 *      compromised agent can't drop executable code.
 *   4. size cap — WRITE_MAX_BYTES, so a runaway write can't fill the disk.
 *
 * Static, non-throwing (`permits`) like WhitelistGuard.permits — the batch write tool checks per file so
 * one denied path never sinks the batch. Every denial traces to the GUARD channel (visible in the dev
 * overlay), decided by config + pattern BEFORE any disk touch.
 */
export class WriteGuard {

	/** Per-path verdict — null when the write is allowed, else the denial reason (already traced). */
	static permits( tool: string, path: string, content: string ): WriteDenial | null {
		const code = WriteGuard.contain( path, content )
		if( code ) {
			McpTrace.guard( 'starmind_file.guard.rejected', { tool, path, code } )
		}
		return code
	}

	/** The four-gate containment check. Returns a denial code, or null when every gate passes. */
	static contain( path: string, content: string ): WriteDenial | null {
		const roots = WriteGuard.writeRoots()
		if( roots.length === 0 )                                return 'no_write_roots'
		if( SdkFileAccess.jail( path, roots ) === null )        return 'outside_write_surface'
		if( Blacklist.excludes( path ) )                        return 'out_of_scope'
		if( !WRITE_EXTENSIONS.includes( extname( path ).toLowerCase() ) ) return 'extension_blocked'
		if( Buffer.byteLength( content, 'utf8' ) > WRITE_MAX_BYTES )      return 'too_large'
		return null
	}

	/** Roots a write may land in — enabled AND explicitly write-flagged, read fresh on every call. */
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
