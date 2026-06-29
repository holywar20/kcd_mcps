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
 */
import { readFileSync } from 'fs'

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
}

/** The write surface's extension allowlist — a SECURITY limit held in code (not config) while testing:
 *  text + common asset/data types only, never code or executables. WriteGuard denies anything else. To
 *  widen, edit here deliberately — it is the tool-level severe limit Bryan asked for. */
export const WRITE_EXTENSIONS: string[] = [
	'.md', '.txt', '.svg', '.json', '.csv', '.yaml', '.yml', '.html', '.xml', '.log',
]

/** Hard cap on a single write's content size (bytes) — a runaway/garbage write can't fill the disk. */
export const WRITE_MAX_BYTES = 256 * 1024

/** Secrets-only default deny-list — always merged in, so protection holds with zero config. This is
 *  a SECURITY boundary (hide credentials), never a noise filter — node_modules / build-dir noise
 *  belongs to a separate, opt-in flag. Subtree semantics in Blacklist mean one pattern hides a whole
 *  directory (a `.ssh` pattern hides everything under it). */
export const DEFAULT_BLACKLIST: string[] = [
	'**/.env*',
	'**/*.pem',
	'**/*.key',
	'**/*.p12',
	'**/*.pfx',
	'**/id_rsa*',
	'**/.ssh',
	'**/.git',
]

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

	// The default deny-list is always on; user patterns extend it. Defaults first so a user can only
	// ADD coverage through the slice, never remove a default secret-pattern.
	const rawBlacklist = slice.blacklist
	const userBlacklist = Array.isArray( rawBlacklist )
		? ( rawBlacklist as unknown[] ).filter( ( p ): p is string => typeof p === 'string' && p.length > 0 )
		: []
	const blacklist = [ ...DEFAULT_BLACKLIST, ...userBlacklist ]

	const rawCap = slice.grepFileCap
	const grepFileCap = typeof rawCap === 'number' && rawCap > 0 ? Math.floor( rawCap ) : DEFAULT_GREP_FILE_CAP

	return { whitelist, blacklist, grepFileCap }
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
