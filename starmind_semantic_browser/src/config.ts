/**
 * Server configuration — resolved from the package store at runtime.
 *
 * Starmind hands this child the absolute path to its own package-store slice via
 * STARMIND_PACKAGE_STORE at spawn. loadConfig() reads that file fresh on each call, so an origin the
 * control widget adds/removes/toggles takes effect on the next tool call with no respawn.
 *
 * Missing env / file / key degrades to an EMPTY whitelist — the server boots and answers every call,
 * but the guard chain denies all navigation and action until the user enables at least one origin.
 * Secure by default: zero config = reaches nothing.
 */
import { readFileSync } from 'fs'

const STORE_ENV = 'STARMIND_PACKAGE_STORE'

/** A whitelisted origin and the tier it's granted. `read` = navigate + read only; `act` = + click/type. */
export interface OriginEntry {
	origin:  string
	tier:    'read' | 'act'
	enabled: boolean
}

export interface BrowserConfig {
	origins: OriginEntry[]
	overlay: boolean
}

/** The current config — read fresh from the package store slice on every call. */
export function loadConfig(): BrowserConfig {
	const slice = _readSlice()

	const rawOrigins = slice[ 'origins' ]
	const origins = Array.isArray( rawOrigins )
		? ( rawOrigins as unknown[] ).flatMap( ( e ) => _parseOrigin( e ) )
		: []

	const overlay = slice[ 'overlay' ] !== false   // default ON — the human watches unless told not to

	return { origins, overlay }
}

/**
 * The whitelist lookups, as one bucket. Origin parsing + matching live here so both guards ask the
 * same question the same way, reading config fresh each call.
 */
export const Whitelist = {

	/** The web origin of a URL ('https://example.com'), or null if unparseable. */
	origin( url: string ): string | null {
		try {
			return new URL( url ).origin
		} catch {
			return null
		}
	},

	/** The enabled entry matching this URL's origin, or null. */
	match( url: string ): OriginEntry | null {
		const o = Whitelist.origin( url )
		if( !o ) {
			return null
		}
		return loadConfig().origins.find( ( e ) => e.enabled && e.origin === o ) ?? null
	},

	/** Are there NO enabled origins at all? (distinguishes "deny-all" from "this one isn't listed"). */
	get empty(): boolean {
		return !loadConfig().origins.some( ( e ) => e.enabled )
	},
}

/** Parse one origin entry, dropping anything malformed. */
function _parseOrigin( raw: unknown ): OriginEntry[] {
	if( typeof raw !== 'object' || raw === null ) return []
	const e = raw as Record<string, unknown>
	if( typeof e[ 'origin' ] !== 'string' || !e[ 'origin' ] ) return []
	const tier = e[ 'tier' ] === 'act' ? 'act' : 'read'
	return [ { origin: e[ 'origin' ] as string, tier, enabled: e[ 'enabled' ] !== false } ]
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
