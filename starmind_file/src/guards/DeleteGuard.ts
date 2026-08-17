import { SdkFileAccess, levelMeets, Authorization } from 'kcd_sdk'
import type { GrantRef } from 'kcd_sdk'
import { loadConfig, type ConfiguredFloor } from '../config'
import { Blacklist } from '../Blacklist'
import { McpTrace } from '../McpTrace'

/** Why a delete was refused — returned in-band per file (batch tools never throw the whole call). */
export type DeleteDenial =
	| 'no_write_roots'          // nothing reaches the delete rung — off by default
	| 'outside_write_surface'   // path sits in NO configured root at all
	| 'insufficient_level'      // path IS in a root, that root just does not reach the delete rung
	| 'out_of_scope'            // a secret/blacklist pattern (cannot delete credentials, .git, …)

/**
 * DeleteGuard — the delete surface's jail. Two gates, both shared with the write guard, minus the two that
 * are write-CONTENT concerns (extension allowlist, size cap — a delete has no content):
 *
 *   1. depth — the path resolves to at least `delete`, asked of the same resolver every other guard asks.
 *   2. blacklist — the same secret/.git/.ssh deny-list reads and writes honour; you can never delete a
 *      blacklisted secret.
 *
 * DELETE IS ITS OWN RUNG NOW, and that is the one real behaviour change here. Delete used to ride the
 * write surface exactly — the two guards' root computations were byte-identical, so a write-flagged root
 * was a deletable root. The ladder gives destruction a rung of its own, and the migration maps
 * `write: true` to `delete` precisely so that existing configuration keeps permitting what it already
 * permitted. Nothing is silently revoked; what changes is that a person can now express write-without-
 * delete, which the boolean pair had no way to say.
 *
 * DELETE IS UNREACHABLE BY GESTURE and stays so for the whole arc. A grant's level is clamped below this
 * rung where it is created, and this guard requires the rung — two independent refusals, because this is
 * the one depth where a single point of failure is not acceptable.
 *
 * NOTE — CONTAINMENT ONLY. Whether a permitted delete also needs a human's approval is decided one layer
 * up, host-side at the ToolGate, never here. Reach says WHERE and the action axis says WHETHER; a root at
 * this depth means reach is not what stops a delete, not that deletes happen quietly. The server stays a
 * thin gate; it only declares destructiveHint so the host knows to gate it.
 */
export class DeleteGuard {

	/** Per-path verdict — null when the delete is allowed, else the denial CODE and the sentence that goes
	 *  with it (already traced). Same pair the write guard returns, for the same reason: the code is what a
	 *  batch row is keyed on, the sentence is what the model reads. */
	static permits( tool: string, path: string, meta?: Record<string, unknown> ): { code: DeleteDenial; detail: string } | null {
		// RESOLVED ONCE, here, and handed to both. `permits` is the boundary that holds the call's envelope,
		// so it is where a floor comes from — and passing the SAME list to the verdict and to the wording is
		// what stops an agent being refused against one workspace and told about another.
		const floor = loadConfig( meta ).whitelist
		const code  = DeleteGuard.contain( path, floor )
		if( !code ) return null
		McpTrace.guard( 'starmind_file.guard.rejected', { tool, path, code } )
		return { code, detail: DeleteGuard._detail( code, path, DeleteGuard._grantsFor( meta ), floor ) }
	}

	/**
	 * A denial code as the sentence an agent can act on — worded by the SHARED author, so this door and the
	 * in-process one cannot answer one fact two ways.
	 *
	 * ── CONTAINMENT MAY NOT SEE GRANTS. EXPLANATION MAY. ──
	 * These are two different decisions and they were being made as one. `contain` above resolves against
	 * configuration alone and always will — that is half of the two independent refusals destruction gets,
	 * and no argument passed here can reach it. But this method only WORDS the outcome, and wording it
	 * blind was a mistake with a real cost: a file the user had visibly handed over, refused for depth, was
	 * told it "sits outside every path you may remove" — a sentence that is false from where the agent
	 * stands, since it had just read that very file. Two very different situations, one message.
	 *
	 * The correction is not to soften the refusal but to make it name the actual rule. An agent told
	 * `a grant cannot reach removal, ever` knows something true and general, can stop probing, and can ask
	 * for the right thing. An agent told it is standing outside its own scope goes looking for a path that
	 * does not exist. The original worry — that mentioning the grant would advertise reach it does not have
	 * — is answered by saying so outright rather than by silence.
	 */
	private static _detail( code: DeleteDenial, path: string, grants: GrantRef[], entries: ConfiguredFloor ): string {
		if( code === 'out_of_scope' ) return SdkFileAccess.blacklistLine()

		const handed  = grants.some( ( g ) =>
			( g.kind === 'file' || g.kind === 'folder' ) && SdkFileAccess.jail( path, [ g.subject ] ) !== null )

		if( handed ) {
			return 'You do hold a grant on this path — that is why you can read it — but a grant can NEVER reach '
				+ 'removal, whatever depth it carries. That rung is configuration-only by design, so that destroying '
				+ 'something always takes a deliberate act rather than a gesture. Retrying will not change this. Ask '
				+ 'the user to raise this folder to the delete level in the file-access settings if the agent should '
				+ 'own it, or simply ask them to remove the file — that is usually the faster answer for one file.'
		}

		const verdict = SdkFileAccess.resolveLevel( path, entries )
		return SdkFileAccess.refusal( verdict, 'delete', SdkFileAccess.scope( entries, [], 'delete' ) )
	}

	/** The grants in force for this call, for EXPLANATION only — never threaded into `contain`. Both
	 *  carriers, same composition the other guards use. */
	private static _grantsFor( meta?: Record<string, unknown> ): GrantRef[] {
		return [ ...Authorization.grants( meta ), ...loadConfig( meta ).grants ]
	}

	/**
	 * The two-gate containment check. Returns a denial code, or null when both gates pass.
	 *
	 * TAKES NO GRANTS, EVER — not as a phase boundary but permanently. The resolver is called with
	 * configuration alone, so there is no argument a caller could pass that would let a gesture reach this
	 * rung. That is the structural half of the two independent refusals destruction gets; the other half is
	 * the clamp where a grant is created. A GRANT parameter here would collapse two refusals into one.
	 *
	 * ── THE FLOOR IS AN ARGUMENT NOW, AND IT IS NOT A LOOPHOLE ──
	 * It used to be read ambiently, and arity was the free proof that nothing else could get in. That broke
	 * for a reason unrelated to grants: one copy of this server answers several sessions, and an ambient
	 * floor judges a delete against whichever workspace resolved last — wrong in BOTH directions, from the
	 * same read, silently.
	 *
	 * `ConfiguredFloor` is what keeps the guarantee structural rather than conventional. It is branded and
	 * `loadConfig` is the only thing that mints one, so grants cannot arrive here wearing a floor's shape —
	 * not directly, and not through the `map` that a plain `AccessEntry[]` would have accepted without
	 * complaint. The property is still enforced by something a caller cannot produce, which is what the
	 * arity was ever standing in for.
	 */
	static contain( path: string, floor: ConfiguredFloor ): DeleteDenial | null {
		const entries   = floor
		const deletable = entries.some( ( entry ) => levelMeets( entry.level, 'delete' ) )
		if( !deletable )                              return 'no_write_roots'

		const verdict = SdkFileAccess.resolveLevel( path, entries )
		// TWO CODES, because they were one and it made two very different bugs produce identical evidence.
		// `outside_write_surface` said both "that path is in no root of yours" and "that path is yours, just
		// not this deeply" — so a granted file refused for depth reported exactly as an ungranted one, and a
		// reader reconstructing state from the trace would conclude the grant never arrived. It is the code a
		// log keys on; the prose beside it is not a substitute for it saying the right thing.
		if( !levelMeets( verdict.level, 'delete' ) ) {
			return verdict.level === 'none' ? 'outside_write_surface' : 'insufficient_level'
		}
		if( Blacklist.excludes( path ) )              return 'out_of_scope'
		return null
	}
}
