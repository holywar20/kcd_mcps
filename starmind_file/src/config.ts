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
}

export interface FileReaderConfig {
	whitelist: WhitelistEntry[]
}

/** The current config — read fresh from the package store slice on every call. */
export function loadConfig(): FileReaderConfig {
	const slice = _readSlice()
	const raw   = slice.whitelist
	const whitelist = Array.isArray( raw )
		? ( raw as unknown[] ).flatMap( ( e ) => _parseEntry( e ) )
		: []
	return { whitelist }
}

/** Parse one whitelist entry, dropping anything malformed. */
function _parseEntry( raw: unknown ): WhitelistEntry[] {
	if( typeof raw !== 'object' || raw === null ) return []
	const e = raw as Record<string, unknown>
	if( typeof e.path !== 'string' || !e.path ) return []
	return [ { path: e.path, enabled: e.enabled !== false } ]
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
