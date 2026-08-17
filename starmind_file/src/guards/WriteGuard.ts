import { extname } from 'path'
import { SdkFileAccess, Authorization, levelMeets } from 'kcd_sdk'
import type { GrantRef } from 'kcd_sdk'
import { loadConfig, WRITE_EXTENSIONS, WRITE_MAX_BYTES, type ConfiguredFloor } from '../config'
import { Blacklist } from '../Blacklist'
import { McpTrace } from '../McpTrace'

/** Why a write was refused — returned in-band per file (batch tools never throw the whole call). */
export type WriteDenial =
	| 'no_write_roots'          // nothing reaches the write rung — the severe default (writes OFF)
	| 'outside_write_surface'   // path sits in NO configured root at all
	| 'insufficient_level'      // path IS in reach, that reach just does not extend to writing
	| 'out_of_scope'            // a secret/blacklist pattern (cannot write over credentials, .git, …)
	| 'extension_blocked'       // not an allowed write extension (no code / executables while testing)
	| 'too_large'               // content exceeds the size cap

/**
 * WriteGuard — the write surface's jail. The DELIBERATELY-NARROW counterpart to WhitelistGuard: reads are
 * permitted wherever the configuration reaches `read`, but a WRITE must clear FOUR independent gates:
 *
 *   1. depth — the path resolves to at least `write` through the shared resolver. One question, asked of
 *      the same primitive the read and delete guards ask, differing only in the rung required.
 *   2. blacklist — the same secret/.git/.ssh deny-list reads honour; you can never write OVER a secret.
 *   3. extension allowlist — text + asset/data types only (WRITE_EXTENSIONS); no .js/.ts/.sh/.exe/… so a
 *      compromised agent can't drop executable code.
 *   4. size cap — WRITE_MAX_BYTES, so a runaway write can't fill the disk.
 *
 * This guard used to compute its own root set from the stored `enabled`/`write` pair, as did the delete
 * guard with byte-identical code. Both now ask the resolver. The rung they require is the whole difference
 * between them, which is what having an ordered ladder was for.
 *
 * Static, non-throwing (`permits`) like WhitelistGuard.permits — the batch write tool checks per file so
 * one denied path never sinks the batch. Every denial traces to the GUARD channel (visible in the dev
 * overlay), decided by config + pattern BEFORE any disk touch.
 */
export class WriteGuard {

	/**
	 * Per-path verdict — null when the write is allowed, else the denial CODE and the sentence that goes
	 * with it (already traced). Takes the call's `_meta` and reads its grants the same way the read guard
	 * does, so a write and a read on one call see one grant list.
	 *
	 * BOTH, not one or the other. The code is what a batch row is keyed on and what a caller branches on —
	 * stable, terse, and unchanged. The sentence is what the MODEL reads, and until now this door had none:
	 * it answered `outside_write_surface` and nothing else, which tells an agent that something is wrong and
	 * nothing about what would be right. The read door has pointed at its scope for as long as it has
	 * existed; two thirds of this surface never did.
	 */
	static permits( tool: string, path: string, content: string, meta?: Record<string, unknown> ): { code: WriteDenial; detail: string } | null {
		// Resolved ONCE and handed to both, so the verdict and the sentence explaining it can never be
		// computed against two different workspaces.
		const floor  = loadConfig( meta ).whitelist
		const grants = WriteGuard._grantsFor( meta )
		const code   = WriteGuard.contain( path, content, floor, grants )
		if( !code ) return null
		McpTrace.guard( 'starmind_file.guard.rejected', { tool, path, code } )
		return { code, detail: WriteGuard._detail( code, path, grants, floor ) }
	}

	/**
	 * A denial code as the sentence an agent can act on.
	 *
	 * THE DEPTH REFUSALS DEFER TO THE SDK, which is the point of the whole exercise: `no_write_roots` and
	 * `outside_write_surface` are the same two facts the in-process door refuses on, so they are worded by
	 * the same author or they drift. `out_of_scope` likewise.
	 *
	 * The last two are worded HERE, deliberately rather than by omission. An extension allowlist and a size
	 * cap are properties of this write surface alone — the in-process door has no twin to disagree with, and
	 * hoisting them would move prose away from the constants it quotes for no benefit. A shared vocabulary
	 * is for facts two doors both state; reflexively sharing everything is how the shared thing ends up
	 * carrying arguments only one caller passes.
	 */
	private static _detail( code: WriteDenial, path: string, grants: GrantRef[], entries: ConfiguredFloor ): string {
		if( code === 'out_of_scope' )      return SdkFileAccess.blacklistLine()
		if( code === 'extension_blocked' ) {
			return `Only text and data files may be written ( ${ WRITE_EXTENSIONS.join( ' ' ) } ) — code and `
				+ 'executables are refused by policy. A file the user handed you directly is exempt from this; '
				+ 'one that is merely inside a configured root is not.'
		}
		if( code === 'too_large' ) {
			return `A single write is capped at ${ Math.floor( WRITE_MAX_BYTES / 1024 ) } KB. Write less, or split it `
				+ 'across files.'
		}
		const verdict = SdkFileAccess.resolveLevel( path, entries, grants )
		return SdkFileAccess.refusal( verdict, 'write', SdkFileAccess.scope( entries, grants, 'write' ) )
	}

	/** The four-gate containment check. Returns a denial code, or null when every gate passes.
	 *
	 *  ORDER IS DELIBERATE and unchanged: depth before content, so a path outside the surface is refused
	 *  for being outside rather than for what someone tried to put in it. An agent told its file was too
	 *  large would retry smaller against a path it can never write.
	 *
	 *  A GRANT REACHES THIS SURFACE NOW, up to its own rung and no further. That retires a property this
	 *  guard held from the day it was written — it used to take no grant list at all, so a grant was
	 *  structurally incapable of reaching a write. The governing contract was amended to permit it: read
	 *  and write adjacency for a subject a person explicitly NAMED is the gesture doing what they asked.
	 *  Adjacency to delete stays forbidden and lives in the sibling guard, which still takes nothing. */
	static contain( path: string, content: string, entries: ConfiguredFloor, grants: GrantRef[] = [] ): WriteDenial | null {
		const reachable = entries.some( ( entry ) => levelMeets( entry.level, 'write' ) )
			|| grants.some( ( grant ) => levelMeets( grant.level, 'write' ) )
		if( !reachable )                                             return 'no_write_roots'

		const verdict = SdkFileAccess.resolveLevel( path, entries, grants )
		// TWO CODES — see DeleteGuard.contain for why one was a defect. "In no root of yours" and "yours, just
		// not this deeply" want opposite next moves, and a single code made a granted file refused for depth
		// report identically to one that was never granted at all.
		if( !levelMeets( verdict.level, 'write' ) ) {
			return verdict.level === 'none' ? 'outside_write_surface' : 'insufficient_level'
		}
		if( Blacklist.excludes( path ) )                             return 'out_of_scope'

		// THE EXTENSION LIMIT YIELDS TO AN EXPLICIT HAND-OVER, and to nothing else. A configured root covers
		// a tree nobody enumerated, so the limit is a real backstop there; a grant names ONE subject and the
		// person naming it carries the onus. Keyed off `granted` rather than off `via`, deliberately: `via`
		// only names a grant that CHANGED the verdict, so keying on it would make the same drop succeed on a
		// file outside the project and fail on one inside it, for reasons invisible at the moment of the
		// gesture.
		const handed = levelMeets( verdict.granted, 'write' )
		if( !handed && !WRITE_EXTENSIONS.includes( extname( path ).toLowerCase() ) ) return 'extension_blocked'

		// The size cap does NOT yield. It guards the disk rather than the authority, and no gesture about
		// permission says anything about how many bytes may land.
		if( Buffer.byteLength( content, 'utf8' ) > WRITE_MAX_BYTES ) return 'too_large'
		return null
	}

	/** Both carriers, one list — the same composition the read guard does, so a call cannot be granted for
	 *  one verb and not the other. */
	private static _grantsFor( meta?: Record<string, unknown> ): GrantRef[] {
		return [ ...Authorization.grants( meta ), ...loadConfig( meta ).grants ]
	}
}
