/**
 * Server configuration — resolved from the package store at runtime.
 *
 * Starmind hands this child the absolute path to its own package-store slice via
 * STARMIND_PACKAGE_STORE at spawn. loadConfig() reads that file fresh on each call,
 * so a whitelist change written by the control widget takes effect on the next tool
 * call with no respawn.
 *
 * Missing env / missing file / missing key degrades to an empty whitelist — the server
 * boots and responds to every tool call, but the guard will block all paths until the
 * user configures at least one enabled root through the widget.
 *
 * TWO sources, not one. The package store holds the user's durable configuration; the
 * GRANT_ENV variable carries this session's user-authored grants, which are per-turn and
 * belong nowhere near the user's settings. Both are read on every call, and both degrade to
 * empty rather than throwing.
 */
import { readFileSync } from 'fs'
import { Blacklist, INJECTED_KINDS, GRANT_ENV } from 'kcd_sdk'
import type { GrantRef, InjectedKind } from 'kcd_sdk'

const STORE_ENV = 'STARMIND_PACKAGE_STORE'

export interface WhitelistEntry {
	path:    string
	enabled: boolean
	/** Whether WRITES are permitted under this root. Strictly opt-in and SEPARATE from `enabled` (read):
	 *  a root readable by default is NOT writable. Defaults false — the severe-by-default write posture. */
	write:   boolean
}

export interface FileReaderConfig {
	whitelist:   WhitelistEntry[]
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

/** The current config — read fresh from the package store slice on every call. */
export function loadConfig(): FileReaderConfig {
	const slice = _readSlice()

	const rawWhitelist = slice.whitelist
	const whitelist = Array.isArray( rawWhitelist )
		? ( rawWhitelist as unknown[] ).flatMap( ( e ) => _parseEntry( e ) )
		: []

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

/**
 * The session's GRANTS, read from the GRANT_ENV variable this child was spawned with.
 *
 * Kept OUT of the package store deliberately. The store is the USER'S durable configuration while a grant
 * is a per-turn fact about one session, and writing one into the other would park session state inside
 * the user's settings. Because they stay apart, this child also still reads the LIVE store — a root
 * toggled in the control widget takes effect on the next call exactly as it does today.
 *
 * Grants are NOT whitelist entries and must never be merged into that list. Kept separate, `admits`
 * returns the GrantRef that excused a path rather than 'whitelist', so the audit line says WHY access was
 * allowed; and WriteGuard — which reads `whitelist` for write-opted-in roots — cannot see them at all, so
 * a grant is structurally incapable of reaching `write` or `delete`.
 *
 * SAFE ONLY BECAUSE THIS CHILD IS PER-TURN. Env is fixed for a process's life, so a long-lived server
 * given this variable would freeze its grants at spawn and carry them into every session it went on to
 * serve. Claude Code spawns and kills this process with each invocation, which is what makes the carrier
 * honest. Starmind's own long-lived servers are never handed it — there a grant rides the call's `_meta`.
 *
 * Absent variable, unparseable value, wrong shape and malformed entries ALL degrade to no grants. Failing
 * closed is the only acceptable direction here: a grant that cannot be read is a grant that was not given.
 * That also covers an unexpanded `${…}` reference reaching us literally, which JSON.parse rejects.
 */
function _readGrants(): GrantRef[] {
	const raw = process.env[ GRANT_ENV ]
	if( !raw ) return []
	try {
		const parsed = JSON.parse( raw ) as unknown
		if( !Array.isArray( parsed ) ) return []
		return ( parsed as unknown[] ).flatMap( ( g ) => _parseGrant( g ) )
	} catch {
		return []
	}
}

/** Parse one grant, dropping anything malformed. Strict on BOTH fields: `subject` is what the jail
 *  compares, so an empty one would match nothing useful; `kind` is what the audit line reports, and an
 *  unknown one would make the trace lie about what was allowed. */
function _parseGrant( raw: unknown ): GrantRef[] {
	if( typeof raw !== 'object' || raw === null ) return []
	const g = raw as Record<string, unknown>
	if( typeof g.subject !== 'string' || !g.subject ) return []
	if( typeof g.kind !== 'string' || !INJECTED_KINDS.includes( g.kind as InjectedKind ) ) return []
	return [ { kind: g.kind as InjectedKind, subject: g.subject } ]
}

/** Parse one whitelist entry, dropping anything malformed. `write` is opt-in (must be exactly true) and
 *  independent of `enabled` — a readable root is not writable unless explicitly flagged. */
function _parseEntry( raw: unknown ): WhitelistEntry[] {
	if( typeof raw !== 'object' || raw === null ) return []
	const e = raw as Record<string, unknown>
	if( typeof e.path !== 'string' || !e.path ) return []
	return [ { path: e.path, enabled: e.enabled !== false, write: e.write === true } ]
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
