import { AbstractGuard, GuardError } from './AbstractGuard'
import type { ToolRequest } from './AbstractGuard'
import { SdkFileAccess, CallMeta } from 'kcd_sdk'
import type { GrantRef } from 'kcd_sdk'
import { loadConfig } from '../config'
import { McpTrace } from '../McpTrace'

type GuardCode = 'WHITELIST_EMPTY' | 'PATH_OUTSIDE_WHITELIST'

/**
 * WhitelistGuard — the agent surface's jail (security Layer 2, the only tier-varying layer) and the
 * sole source of containment truth. Mirrors PathGuard at the head of daedalus's GuardChain.
 *
 * Two surfaces, one check (contain):
 *   validate() — the chain entry. THROWS, for all-or-nothing tools (e.g. `list`): one path, one
 *                verdict, fail the call.
 *   permits()  — non-throwing per-path verdict, for batch tools (e.g. `read`): a denied path is
 *                returned in-band so one bad path never sinks the whole batch.
 *
 * A path outside the whitelist gets ONE second chance: a user-authored GRANT (see contain). That is the
 * whole override surface — there is no other way past this guard. A grant reaches this server by one of
 * two carriers depending on who owns the call ( see _grantsFor ), and means exactly the same thing either
 * way.
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

		const code = WhitelistGuard.contain( path, WhitelistGuard._grantsFor( req.meta ) )
		if( code ) {
			WhitelistGuard.reject( req.tool, path, code, req.meta )
		}
	}

	/** Canonical per-path verdict, non-throwing — the containment check batch tools call per item.
	 *  Traces a denial (so batch rejections show in the GUARD tab too), then returns false. */
	static permits( tool: string, path: string, meta?: Record<string, unknown> ): boolean {
		const code = WhitelistGuard.contain( path, WhitelistGuard._grantsFor( meta ) )
		if( !code ) {
			return true
		}

		McpTrace.guard( 'starmind_file.guard.rejected', { tool, path, code } )
		return false
	}

	/**
	 * This server's containment verdict — a rejection code, or null when the path is allowed.
	 *
	 * The RULE ( whitelist first, a user-authored grant only as an exception afterwards ) lives in
	 * `SdkFileAccess.admits`, shared with the in-process `starmind_files` built-in, which enforces the
	 * same posture from the main process. What stays here is what is local to this server: where the
	 * roots come from, the trace, and the rejection vocabulary.
	 *
	 * An empty list is simply a call with no exception on it. This method does not know or care which
	 * carrier delivered a grant — that is `_grantsFor`'s job, and keeping it there is what makes the two
	 * tiers provably identical from the boundary down.
	 */
	static contain( path: string, grants: GrantRef[] = [] ): GuardCode | null {
		const roots    = WhitelistGuard.enabledRoots()
		const admitted = SdkFileAccess.admits( path, roots, grants )
		if( admitted === 'whitelist' ) {
			return null
		}
		if( admitted ) {
			// An allow is traced as loudly as a deny. A capability exception nobody can audit is the one
			// outcome worse than not having the feature.
			McpTrace.guard( 'starmind_file.guard.granted', { path, kind: admitted.kind, subject: admitted.subject } )
			return null
		}

		return roots.length === 0 ? 'WHITELIST_EMPTY' : 'PATH_OUTSIDE_WHITELIST'
	}

	/**
	 * Trace + throw — the validate() failure path.
	 *
	 * The refusal POINTS rather than merely declining: it names where this call MAY go, so an agent that
	 * guessed wrong is not left guessing again. The prose is the shared one both doors answer with; the
	 * GuardCode still rides on the error for machine readers.
	 *
	 * Worded off the SCOPE, never off the code. `WHITELIST_EMPTY` reports an empty whitelist, which is not
	 * the same as no access — a grant can be in force with no roots configured at all, and telling that
	 * agent it has nothing would be a lie the agent has no way to check.
	 */
	static reject( tool: string, path: string, code: GuardCode, meta?: Record<string, unknown> ): never {
		McpTrace.guard( 'starmind_file.guard.rejected', { tool, path, code } )
		const line = SdkFileAccess.scopeLine( WhitelistGuard.scope( meta ) )
		throw new GuardError( `Path "${ path }" was refused. ${ line }`, code )
	}

	/** Everywhere this call may reach — enabled roots plus any grant in force. Composed off the SAME two
	 *  lists `contain` admits against, through the shared union, so what the agent is told when it asks
	 *  ( the `roots` tool ) and when it is refused ( `reject` ) are one list and cannot drift. */
	static scope( meta?: Record<string, unknown> ): string[] {
		return SdkFileAccess.scope( WhitelistGuard.enabledRoots(), WhitelistGuard._grantsFor( meta ) )
	}

	/**
	 * Every grant in force for this call, from BOTH carriers.
	 *
	 * On the WIRE tiers Starmind owns the call, so `ToolGate` stamps the grant onto its `_meta` and the
	 * assertion is unforgeable by construction: `arguments` is what the model writes, `_meta` is what the
	 * client writes. On the HARNESS tier Claude Code owns the call and spawns this server itself, so none
	 * of our `_meta` is on it; the grant rides this child's own ENVIRONMENT ( GRANT_ENV, seeded by the
	 * `claude` process Starmind spawned — see config._readGrants ), which the model equally cannot reach.
	 *
	 * Two carriers, ONE list, and no caller learns which is which. A grant means the same thing however it
	 * arrived, and a call site that had to choose a source is a call site that can choose wrong.
	 *
	 * Note this IS a lookup on the harness tier, which the wire tier deliberately has none of. The property
	 * that survives is the one that matters — the model has no channel to either carrier — but it is a
	 * weaker statement than "the grant on the wire is the permission", and it is written down as such
	 * rather than inherited by assumption.
	 */
	private static _grantsFor( meta?: Record<string, unknown> ): GrantRef[] {
		return [ ...CallMeta.grants( meta ), ...loadConfig().grants ]
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
