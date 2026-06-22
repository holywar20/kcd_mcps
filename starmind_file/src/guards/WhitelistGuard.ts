import { AbstractGuard, GuardError } from './AbstractGuard'
import type { ToolRequest } from './AbstractGuard'
import { SdkFileAccess } from 'kcd_sdk'
import { loadConfig } from '../config'
import { McpTrace } from '../McpTrace'

type GuardCode = 'WHITELIST_EMPTY' | 'PATH_OUTSIDE_WHITELIST'

/**
 * WhitelistGuard — the agent surface's jail (security Layer 2, the only tier-varying layer) and the
 * sole source of containment truth. Mirrors PathGuard at the head of starmind_kcd's GuardChain.
 *
 * Two surfaces, one check (contain):
 *   validate() — the chain entry. THROWS, for all-or-nothing tools (e.g. `list`): one path, one
 *                verdict, fail the call.
 *   permits()  — non-throwing per-path verdict, for batch tools (e.g. `read`): a denied path is
 *                returned in-band so one bad path never sinks the whole batch.
 *
 * The whitelist is read FRESH from the package store on every check (loadConfig), so a root the
 * control widget adds/removes/toggles takes effect on the next tool call with no respawn. Every
 * denial — thrown or per-item — traces to the GUARD channel (McpTrace) so it is visible in the dev
 * overlay, not just returned to the model.
 */
export class WhitelistGuard extends AbstractGuard {

	/** Chain entry — throws (all-or-nothing tools). Single `path` only; batch tools jail per item
	 *  through the static permits() instead, so one bad path never sinks the call. */
	validate( req: ToolRequest ): void {
		const path = req.params[ 'path' ]
		if( typeof path !== 'string' ) {
			return
		}

		const code = WhitelistGuard.contain( path )
		if( code ) {
			WhitelistGuard.reject( req.tool, path, code )
		}
	}

	/** Canonical per-path verdict, non-throwing — the containment check batch tools call per item.
	 *  Traces a denial (so batch rejections show in the GUARD tab too), then returns false. */
	static permits( tool: string, path: string ): boolean {
		const code = WhitelistGuard.contain( path )
		if( !code ) {
			return true
		}

		McpTrace.guard( 'starmind_file.guard.rejected', { tool, path, code } )
		return false
	}

	/** The ONE containment check. Returns a rejection code, or null when the path is allowed. */
	static contain( path: string ): GuardCode | null {
		const roots = WhitelistGuard.enabledRoots()
		if( roots.length === 0 ) {
			return 'WHITELIST_EMPTY'
		}

		const contained = SdkFileAccess.jail( path, roots )
		if( contained === null ) {
			return 'PATH_OUTSIDE_WHITELIST'
		}

		return null
	}

	/** Trace + throw — the validate() failure path. */
	static reject( tool: string, path: string, code: GuardCode ): never {
		McpTrace.guard( 'starmind_file.guard.rejected', { tool, path, code } )

		let message = `Path "${ path }" is outside the whitelist`
		if( code === 'WHITELIST_EMPTY' ) {
			message = `No whitelisted roots configured; "${ path }" denied`
		}
		throw new GuardError( message, code )
	}

	/** The enabled whitelist roots, read fresh from the package store on every call. */
	private static enabledRoots(): string[] {
		const roots: string[] = []
		for( const entry of loadConfig().whitelist ) {
			if( entry.enabled ) {
				roots.push( entry.path )
			}
		}
		return roots
	}
}
