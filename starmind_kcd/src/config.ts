/**
 * Server configuration — resolved from the package store at runtime.
 *
 * Starmind hands this child the absolute path to its OWN package-store slice file via the
 * STARMIND_PACKAGE_STORE env var at spawn (set by MCPService). loadConfig() reads that file FRESH
 * on each call, so a config change written by the control widget is picked up on the next tool call
 * with no respawn.
 *
 * Missing env / missing file / missing key falls back to dev defaults: the project root is the
 * spawn cwd (Starmind spawns the child with cwd = the repo root), the doc root is _Claude — so a
 * dev run works with no widget, identical to the old hardcode. A packaged install relies on the
 * store value (its spawn cwd is the app's resources dir, not the user's KCD project), which is
 * exactly the long-open packaged-vault-root question the store resolves.
 */
import { readFileSync } from 'fs';

const STORE_ENV = 'STARMIND_PACKAGE_STORE';

export interface KcdConfig {
	projectRoot: string;
	docRoot:     string;
}

/** The current config — read fresh from the package store slice on every call. */
export function loadConfig(): KcdConfig {
	const slice = readSlice();
	return {
		projectRoot: str( slice.projectRoot ) ?? process.cwd(),
		docRoot:     str( slice.docRoot )     ?? '_Claude',
	};
}

/** Parse the child's own slice file; any failure (no env, no file, bad JSON) degrades to empty. */
function readSlice(): Record<string, unknown> {
	const path = process.env[ STORE_ENV ];
	if ( !path ) return {};
	try {
		return JSON.parse( readFileSync( path, 'utf8' ) ) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/** A non-empty string, or null — so a blank/garbled store value falls through to the default. */
function str( value: unknown ): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}
