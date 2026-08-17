/**
 * Server configuration — resolved fresh on every call, from THREE sources that answer different questions.
 *
 *   the package store  — TWO different kinds of thing under one roof, and the distinction is load-bearing.
 *                        The deny patterns and the grep cap are durable USER settings: the control widget
 *                        writes them and they stay true until someone changes them. THE FLOOR IS NOT. In-app
 *                        it is DERIVED — the host publishes a project's policy into the slice ahead of each
 *                        call to this child — so reading it back tells you about the last call, not about the
 *                        user. It is authoritative only on a STANDALONE run, where nothing else supplies one.
 *                        Do not read the slice as "what the user configured" without asking which half.
 *                        Starmind hands this child the absolute path via STARMIND_PACKAGE_STORE at spawn and
 *                        re-reads are per call, so a change written by the host or by hand takes effect on
 *                        the next tool call with no respawn.
 *   ACCESS_ENV         — the floor as the HARNESS host publishes it, for this turn only. WINS when present.
 *   GRANT_ENV          — this turn's user-authored exceptions to that floor.
 *
 * THE FLOOR HAS TWO CARRIERS BECAUSE THE TWO LANES HAVE DIFFERENT LIFETIMES, not because anyone wanted two.
 * Starmind's own copy of this server is long-lived, so an env variable would freeze its floor at spawn and
 * carry it across every project the app went on to open — it must be re-pointed through a file it re-reads.
 * A harness copy is per-turn and, worse, shares that file with the in-process copy: both lanes are handed
 * the SAME store path, so a floor published there for one lane is read by the other. That is why a harness
 * child is told directly instead. `Authorization` owns both writers so the two cannot disagree about shape.
 *
 * Missing env / missing file / missing key degrades to an empty floor — the server boots and answers every
 * tool call, but the guard blocks every path until something configures a root. Failing closed is the only
 * safe direction: a policy we cannot read is not a policy we may assume is permissive.
 */
import { readFileSync } from 'fs'
import { Blacklist, GRANT_ENV, ACCESS_ENV, Authorization, parseAccessList } from 'kcd_sdk'
import type { GrantRef, AccessEntry } from 'kcd_sdk'
import { McpTrace } from './McpTrace'

const STORE_ENV = 'STARMIND_PACKAGE_STORE'

declare const CONFIGURED: unique symbol

/**
 * A floor that came from CONFIGURATION — and a type nothing else can produce.
 *
 * ── WHY A BRAND, AND WHAT IT REPLACES ──
 * The guards below take their floor as an ARGUMENT rather than reading it ambiently, because one copy of
 * this server now answers for several sessions and an ambient read judges a call against whichever
 * workspace resolved last. That change cost `DeleteGuard.contain` a guarantee it used to get for free: it
 * took exactly one parameter, so there was no argument a caller could pass that would let a GESTURE-born
 * grant reach the delete rung, and a test pinned the arity precisely because absence cannot be inverted
 * the way a comparison can.
 *
 * A PLAIN `AccessEntry[]` WOULD NOT HAVE RESTORED THAT. `GrantRef` is `{ kind, subject, level }` and
 * `AccessEntry` is `{ path, level }`, so passing grants directly fails to compile — but one line of
 * `grants.map( g => ( { path: g.subject, level: g.level } ) )` satisfies it perfectly, and a gesture
 * reaches delete. That is a weaker guarantee wearing the same clothes.
 *
 * The brand closes it. Only `loadConfig` mints one, through the single cast at its return. A mapped grant
 * list is a plain array and cannot satisfy this type; the only way in is an explicit `as ConfiguredFloor`,
 * which is greppable, reviewable, and impossible to write by accident. The protection is still structural
 * — a thing the type system will not let you produce — rather than a comparison someone could invert.
 *
 * It flows ONE WAY, which is the direction that matters: a `ConfiguredFloor` satisfies every
 * `AccessEntry[]` parameter downstream ( `resolveLevel`, `scope` ), while nothing widens back into it.
 */
export type ConfiguredFloor = AccessEntry[] & { readonly [ CONFIGURED ]: true }

export interface FileReaderConfig {
	/** The configured floor — each root and how deeply it may be reached ( `none` / `read` / `write` /
	 *  `delete` ), from whichever carrier published one ( see _readFloor ). Parsed by the SHARED reader
	 *  (`parseAccessList`), which also performs the legacy migration: a slice still holding the
	 *  `enabled`/`write` pair is read into levels on load rather than by a one-shot rewrite, because a slice
	 *  can be hand-edited and an older build can write one.
	 *
	 *  THE NAME IS A FOSSIL AND MEANS SOMETHING NARROWER THAN IT SAYS. `whitelist` reads as a binary
	 *  allow-list; what the key holds is a LADDER, and membership is not permission — only the level is. A
	 *  root can sit in the `whitelist` at `none` and be denied every operation. The name stays because it is
	 *  the key on disk and renaming it would orphan every existing installation's configuration. Read it as
	 *  "the access floor", and never infer a permission from presence alone. */
	whitelist:   ConfiguredFloor
	blacklist:   string[]
	grepFileCap: number
	/** The user-authored GRANTS in force for the session this child was spawned for. Their own env
	 *  variable, never the package store — see _readGrants. Empty on the wire tiers and on any turn
	 *  that holds none. */
	grants:      GrantRef[]
}

/** The write surface's extension allowlist — a SECURITY limit held in code (not config) while testing:
 *  text + common asset/data types only, never code or executables. WriteGuard denies anything else. To
 *  widen, edit here deliberately — it is the tool-level severe limit Bryan asked for. */
export const WRITE_EXTENSIONS: string[] = [
	'.md', '.txt', '.svg', '.json', '.csv', '.yaml', '.yml', '.html', '.xml', '.log',
]

/** Hard cap on a single write's content size (bytes) — a runaway/garbage write can't fill the disk. */
export const WRITE_MAX_BYTES = 256 * 1024

/** Default cap on the files a single grep searches — small by intent (focused searches); raised
 *  per-config via `grepFileCap` in the slice. */
export const DEFAULT_GREP_FILE_CAP = 100

/**
 * The current config — read fresh on every call.
 *
 * TAKES THE CALL'S `_meta`, and that argument is the difference between one copy of this server answering
 * for one workspace and one copy answering for several. Everything here used to be ambient — environment
 * and a slice on disk — which was correct only because no copy of this process ever saw two floors. A host
 * that routes every session's calls through ONE copy makes that false, and an ambient read would then
 * answer whichever floor happened to be resolved last.
 *
 * Optional, because the CLI and any standalone use have no call to read from and must keep working
 * unchanged — they fall through to exactly the tiers they use today.
 */
export function loadConfig( meta?: Record<string, unknown> ): FileReaderConfig {
	const slice = _readSlice()

	// THE ONE MINT. This cast is the only place a `ConfiguredFloor` comes into existence, which is what
	// makes the brand mean anything — see the type. A second one anywhere would quietly reopen the door
	// `DeleteGuard.contain` is holding shut, so it is deliberately not helped along by a factory function
	// that would make minting one look ordinary.
	const whitelist = _readFloor( slice, meta ) as ConfiguredFloor

	// The default deny-list is always on; user patterns extend it. `Blacklist.patterns` puts the shared
	// defaults first, so a user can only ADD coverage through the slice, never remove a secret-pattern.
	const rawBlacklist = slice.blacklist
	const userBlacklist = Array.isArray( rawBlacklist )
		? ( rawBlacklist as unknown[] ).filter( ( p ): p is string => typeof p === 'string' && p.length > 0 )
		: []
	const blacklist = Blacklist.patterns( userBlacklist )

	const rawCap = slice.grepFileCap
	const grepFileCap = typeof rawCap === 'number' && rawCap > 0 ? Math.floor( rawCap ) : DEFAULT_GREP_FILE_CAP

	return { whitelist, blacklist, grepFileCap, grants: _readGrants() }
}

/** The last GRANT_ENV value this process saw, so the trace below reports a CHANGE rather than a call. */
let _lastGrantEnv: string | null = null

/** The same, for the floor carrier. */
let _lastAccessEnv: string | null = null

/**
 * The FLOOR this child works within — the published one if a host published one, else its slice.
 *
 * A PUBLISHED FLOOR WINS OUTRIGHT, INCLUDING AN EMPTY ONE. `readFloor` hands back null when nothing was
 * published and a list when something was, and those must not be read as the same thing: a host that
 * published an empty floor is saying this caller reaches nothing, while nothing published means fall back.
 * Collapsing them would silently restore whatever the slice happened to hold at the exact moment a host
 * meant to deny — and on this server the slice is shared with the other lane, so "whatever it held" can be
 * another workspace's roots.
 *
 * The FALLBACK is not a legacy path. Starmind's own long-lived copy of this server is never given the
 * variable — it is re-pointed through the slice because env would freeze its floor at spawn — so `absent`
 * is the ordinary, correct state on that lane and it must stay quiet.
 *
 * TRACE ON CHANGE, not per call, matching `_readGrants`. `loadConfig()` runs on every tool call by design,
 * so an unconditional line would write the same fact a hundred times a turn and bury the one that matters.
 * `absent` says nothing at all; everything else is either a delivery receipt worth one line, or a failure.
 */
function _readFloor( slice: Record<string, unknown>, meta?: Record<string, unknown> ): AccessEntry[] {
	// ── TIER 1 · THE CALL ──────────────────────────────────────────────────────────────────────────
	// The only tier that can differ between two calls this process is serving at the same moment, which
	// is what lets ONE copy answer for several sessions. Wins outright including when EMPTY, for exactly
	// the reason the published floor does one tier down.
	//
	// A CHAIN, NOT A MERGE — and the difference from how GRANTS resolve is deliberate rather than an
	// inconsistency. `WhitelistGuard._grantsFor` UNIONS its two carriers, which is right for grants: they
	// are additive exceptions, every one is host-authored, and a union can only restate reach someone
	// already granted. A floor is the BASELINE, so unioning two of them yields the WIDER — and a stale
	// slice would then quietly widen a call the host meant to restrict. Same shape, opposite operator,
	// because one is an exception and the other is the thing it is an exception to.
	const onCall = Authorization.floorOnCall( meta )
	if( onCall.state === 'unreadable' ) {
		// LOUD, EVERY TIME, ON TWO CHANNELS — the one state here that is a DEFECT rather than a condition.
		// One tier down, `unreadable` means a harness failed to expand a variable: someone else's bug, a
		// degraded mode, correctly tolerated quietly. On THIS tier the envelope was authored by our own
		// gate and handed to a server we also wrote, so there is no third party and no retry that helps.
		//
		// Both channels because either alone can be silent: the trace file needs STARMIND_TRACE_DIR, which
		// standalone use does not set, and stderr is invisible when a host swallows it. Never stdout —
		// that is the JSON-RPC channel and writing prose to it would break the call rather than report it.
		const detail = { server: 'starmind_file', reason: 'access on _meta was not an array' }
		McpTrace.warn( 'starmind_file.floor_unreadable', detail )
		console.error( 'WARNING starmind_file: unreadable floor on the call envelope — refusing every path. This is a Starmind defect, not a configuration state.', detail )
	}
	// `?? []` is unreachable for `published` and `unreadable` ( both return a list ) and never reached for
	// `absent` ( guarded above ). It stands so a future state added to the union cannot silently fall
	// through to the tiers below, which would be a widening nobody wrote.
	if( onCall.state !== 'absent' ) return onCall.entries ?? []

	// ── TIER 2 · THE ENVIRONMENT ───────────────────────────────────────────────────────────────────
	const raw = process.env[ ACCESS_ENV ]
	const { entries, state } = Authorization.readFloor( raw )

	const fresh = ( raw ?? null ) !== _lastAccessEnv
	_lastAccessEnv = raw ?? null
	// `head` is the tell for the one failure this hop cannot otherwise report: an unexpanded `${…}` arrives
	// LITERALLY, and seeing those exact bytes is the difference between a glance and bisecting a harness.
	if( fresh && state !== 'absent' ) {
		McpTrace.capability( 'starmind_file.floor', {
			state, entries: entries?.length ?? 0, head: state === 'published' ? undefined : raw?.slice( 0, 40 )
		} )
	}

	// ── TIER 3 · THE SLICE ─────────────────────────────────────────────────────────────────────────
	return entries ?? parseAccessList( slice.whitelist )
}

/**
 * The session's GRANTS, read from the GRANT_ENV variable this child was spawned with.
 *
 * Kept OUT of the package store deliberately. The store is the USER'S durable configuration while a grant
 * is a per-turn fact about one session, and writing one into the other would park session state inside
 * the user's settings. Because they stay apart, this child also still reads the LIVE store — a root
 * toggled in the control widget takes effect on the next call exactly as it does today.
 *
 * Grants are NOT whitelist entries and must never be merged into that list. Kept separate,
 * `SdkFileAccess.resolveLevel` returns the GrantRef that excused a path in its `via`, rather than
 * 'config' — so the audit line says WHY access was allowed and not merely that it was.
 *
 * A GRANT DOES REACH WRITE AND DELETE. It did not once, and the separation above was how that was enforced;
 * the ordered level replaced that with a depth the grant states outright, and the ruling that a grant clears
 * the write-extension limit made it deliberate rather than incidental. Merging the two lists would still be
 * wrong — the depth a grant carries and the floor a project configures answer different questions, and
 * `resolveLevel` needs both apart to say which one admitted a path.
 *
 * SAFE ONLY BECAUSE THIS CHILD IS PER-TURN. Env is fixed for a process's life, so a long-lived server
 * given this variable would freeze its grants at spawn and carry them into every session it went on to
 * serve. Claude Code spawns and kills this process with each invocation, which is what makes the carrier
 * honest. Starmind's own long-lived servers are never handed it — there a grant rides the call's `_meta`.
 *
 * Absent variable, unparseable value, wrong shape and malformed entries ALL degrade to no grants. Failing
 * closed is the only acceptable direction here: a grant that cannot be read is a grant that was not given.
 * That also covers an unexpanded `${…}` reference reaching us literally, which JSON.parse rejects.
 *
 * Degrading is no longer SILENT, which is a separate decision from failing closed and the one that was
 * missing. An absent variable stays quiet — that is every ungranted turn — but a payload that arrived and
 * could not be used says so on the CAPABILITY channel, the same file the host wrote the hand-over into.
 */
function _readGrants(): GrantRef[] {
	const raw = process.env[ GRANT_ENV ]
	if( !raw ) return []

	// TRACE ON CHANGE, not per call. `loadConfig()` runs on every tool call by design, so an unconditional
	// line here would write the same fact a hundred times per turn and bury the one that matters. Env is
	// fixed for a process's life, so for a per-turn child this fires exactly once — and on the in-process
	// tier, where the variable is never set at all, it never fires. The idiom matches `_pointAt`'s.
	const fresh = raw !== _lastGrantEnv
	_lastGrantEnv = raw

	try {
		// The SAME parse the wire carrier uses — hoisted into `Authorization`, which owns both carriers, so a
		// grant means exactly one thing however it arrived. This side used to hold its own strict reader
		// while the wire side did an unchecked cast; two carriers with two behaviours is the failure mode
		// that file exists to prevent, and it had already happened.
		const { grants, dropped } = Authorization.parseGrantsCounted( JSON.parse( raw ) )
		if( fresh && dropped ) McpTrace.capability( 'starmind_file.grant.dropped', { dropped, kept: grants.length } )
		return grants
	} catch {
		// The refusal still stands — a grant that cannot be read is a grant that was not given — but it no
		// longer happens in silence. `head` is the tell for the failure this hop could not otherwise report:
		// an unexpanded `${STARMIND_GRANTS}` arrives here LITERALLY, and seeing those exact bytes in the
		// trace is the difference between one glance and an afternoon of bisecting a harness. Truncated
		// because the value is a list of the user's own paths, not because it is secret.
		if( fresh ) McpTrace.capability( 'starmind_file.grant.unreadable', { bytes: raw.length, head: raw.slice( 0, 40 ) } )
		return []
	}
}

/** Parse the child's own slice file; any failure degrades to empty. */
function _readSlice(): Record<string, unknown> {
	const path = process.env[ STORE_ENV ]
	if( !path ) return {}
	try {
		return JSON.parse( readFileSync( path, 'utf8' ) ) as Record<string, unknown>
	} catch {
		return {}
	}
}
