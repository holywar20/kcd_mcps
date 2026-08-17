import { AbstractGuard, GuardError } from './AbstractGuard'
import type { ToolRequest } from './AbstractGuard'
import { SdkFileAccess, Authorization, levelMeets } from 'kcd_sdk'
import type { GrantRef, AccessEntry } from 'kcd_sdk'
import { loadConfig, type ConfiguredFloor } from '../config'
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
 * A path outside the configured floor gets ONE second chance: a user-authored GRANT. That is the whole
 * override surface — there is no other way past this guard. A grant reaches this server by one of two
 * carriers depending on who owns the call ( see _grantsFor ), and means exactly the same thing either way.
 *
 * THE VERDICT IS A LEVEL, NOT A BOOLEAN. This guard asks the shared resolver what the path resolves to
 * and requires `read`. Its siblings ask the same resolver and require `write` and `delete`. Before that
 * collapse each of the three computed its own root set from the stored booleans, and so did Starmind's
 * in-process gate and the capability deck's store — five folds of one pair, agreeing by authorship rather
 * than by construction.
 *
 * The configuration is read FRESH on every check (loadConfig), so a root the control widget adds, removes
 * or lowers takes effect on the next tool call with no respawn. Every denial — thrown or per-item — traces
 * to the GUARD channel (McpTrace) so it is visible in the dev overlay, not just returned to the model.
 */
export class WhitelistGuard extends AbstractGuard {

	/** Chain entry — throws (all-or-nothing tools). Single `path` only; batch tools jail per item
	 *  through the static permits() instead, so one bad path never sinks the call. */
	validate( req: ToolRequest ): void {
		const path = req.params[ 'path' ]
		if( typeof path !== 'string' ) {
			return
		}

		const code = WhitelistGuard.contain( path, loadConfig( req.meta ).whitelist, WhitelistGuard._grantsFor( req.meta ) )
		if( code ) {
			WhitelistGuard.reject( req.tool, path, code, req.meta )
		}
	}

	/** Canonical per-path verdict, non-throwing — the containment check batch tools call per item.
	 *  Traces a denial (so batch rejections show in the GUARD tab too), then returns false. */
	static permits( tool: string, path: string, meta?: Record<string, unknown> ): boolean {
		const code = WhitelistGuard.contain( path, loadConfig( meta ).whitelist, WhitelistGuard._grantsFor( meta ) )
		if( !code ) {
			return true
		}

		McpTrace.guard( 'starmind_file.guard.rejected', { tool, path, code } )
		return false
	}

	/**
	 * This server's containment verdict — a rejection code, or null when the path may be read.
	 *
	 * The RULE lives in `SdkFileAccess.resolveLevel`, shared with the in-process built-in that enforces the
	 * same posture from Starmind's main process. What stays here is what is local to this server: where the
	 * configuration comes from, the trace, and the rejection vocabulary.
	 *
	 * An empty grant list is simply a call with no exception on it. This method does not know or care which
	 * carrier delivered a grant — that is `_grantsFor`'s job, and keeping it there is what makes the two
	 * tiers provably identical from the boundary down.
	 */
	static contain( path: string, entries: ConfiguredFloor, grants: GrantRef[] = [] ): GuardCode | null {
		const verdict = SdkFileAccess.resolveLevel( path, entries, grants )

		if( levelMeets( verdict.level, 'read' ) ) {
			if( verdict.via !== 'config' && verdict.via !== null ) {
				// An allow BY EXCEPTION is traced as loudly as a deny. A capability exception nobody can audit
				// is the one outcome worse than not having the feature. A grant that merely duplicates the
				// configured floor never reaches here — `via` names it only when it lifted the verdict.
				McpTrace.guard( 'starmind_file.guard.granted', { path, kind: verdict.via.kind, subject: verdict.via.subject } )
			}
			return null
		}

		// `WHITELIST_EMPTY` means NOTHING IS READABLE, which is what it has always meant — the old code
		// counted ENABLED roots, not stored ones, so a policy holding only disabled entries reported empty.
		// An entry lowered to `none` is that same fact expressed on the ladder, and it must keep reporting
		// the same way: the two codes route an agent differently, and moving a case between them would
		// change advice nobody decided to change.
		const readable = entries.some( ( entry ) => levelMeets( entry.level, 'read' ) )
		return readable ? 'PATH_OUTSIDE_WHITELIST' : 'WHITELIST_EMPTY'
	}

	/**
	 * Trace + throw — the validate() failure path.
	 *
	 * The refusal POINTS rather than merely declining: it names where this call MAY go, so an agent that
	 * guessed wrong is not left guessing again. The prose is the shared one both doors answer with; the
	 * GuardCode still rides on the error for machine readers.
	 *
	 * Worded off the SCOPE, never off the code. `WHITELIST_EMPTY` reports an empty policy, which is not
	 * the same as no access — a grant can be in force with nothing configured at all, and telling that
	 * agent it has nothing would be a lie the agent has no way to check.
	 */
	static reject( tool: string, path: string, code: GuardCode, meta?: Record<string, unknown> ): never {
		McpTrace.guard( 'starmind_file.guard.rejected', { tool, path, code } )
		// Resolved a SECOND time, on the failure path only. `contain` already knew this answer, but threading
		// it out through every caller to save a resolve on the branch that is about to throw would put the
		// cost of the refusal on the shape of the success path.
		const verdict = SdkFileAccess.resolveLevel( path, loadConfig( meta ).whitelist, WhitelistGuard._grantsFor( meta ) )
		const line    = SdkFileAccess.refusal( verdict, 'read', WhitelistGuard.scope( meta ) )
		throw new GuardError( `Path "${ path }" was refused. ${ line }`, code )
	}

	/** Everywhere this call may READ — configured entries at or above that rung, plus any grant in force.
	 *  Composed off the SAME lists `contain` resolves against, through the shared union, so what the agent
	 *  is told when it asks ( the `roots` tool ) and when it is refused ( `reject` ) are one list and cannot
	 *  drift. An entry lowered to `none` drops out, exactly as a disabled root used to. */
	static scope( meta?: Record<string, unknown> ): string[] {
		return SdkFileAccess.scope( loadConfig( meta ).whitelist, WhitelistGuard._grantsFor( meta ), 'read' )
	}

	/** The same list WITH each path's depth, for the agent that asks before it acts rather than after it is
	 *  refused. A bare path list means the only way to learn a root is read-only is to attempt a write and
	 *  be told — so the policy can only be read by tripping the gate, and the trace records a failed attempt
	 *  where it should record an informed decision. Same composer, one field wider. */
	static scopeEntries( meta?: Record<string, unknown> ): AccessEntry[] {
		return SdkFileAccess.scopeEntries( loadConfig( meta ).whitelist, WhitelistGuard._grantsFor( meta ), 'read' )
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
		return [ ...Authorization.grants( meta ), ...loadConfig( meta ).grants ]
	}
}
