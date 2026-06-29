import { sep } from 'path'
import { Glob } from 'kcd_sdk'
import { loadConfig } from './config'

/**
 * Blacklist — the agent surface's negative permission layer: the security-only DENY side, beside
 * WhitelistGuard's ALLOW side. The core stays pristine — this filter lives ENTIRELY in the agent
 * surface, layered over the blunt core, never injected into it.
 *
 * One security model — SUBTREE semantics: a path is denied when the path ITSELF or ANY ANCESTOR
 * directory matches a deny pattern, so a single `.ssh` deny pattern hides the whole subtree. Patterns
 * are globs matched by the shared Glob matcher (identical to the whitelist / glob tool), read fresh
 * from the package store on every call (loadConfig already merges the default deny-list in), so a
 * config change lands on the next tool call with no respawn.
 *
 * Enforcement is bifurcated by the CALLER, not here: discovery tools (list / glob / grep) drop denied
 * entries SILENTLY; read reports `out_of_scope` on a directly-named path. This class answers only the
 * one question — is this path denied? — by pattern alone, never touching disk. That is what lets read
 * report policy WITHOUT a stat: it discloses the rule, not the file's existence.
 */
export class Blacklist {

	/** True when `path` is denied — the path or any ancestor directory matches a deny pattern. */
	static excludes( path: string ): boolean {
		const patterns = loadConfig().blacklist
		if( patterns.length === 0 ) {
			return false
		}

		// Walk the path and every ancestor prefix ('/'-normalized) — a match at any depth denies the
		// whole subtree, so `**/.ssh` covers a nested `.ssh/id_rsa` without a second `**/.ssh/**` pattern.
		const segments = path.split( sep ).join( '/' ).split( '/' )
		for( let depth = segments.length; depth > 0; depth -= 1 ) {
			const prefix = segments.slice( 0, depth ).join( '/' )
			for( const pattern of patterns ) {
				if( Glob.matches( prefix, pattern ) ) {
					return true
				}
			}
		}
		return false
	}
}
