import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { GRANT_ENV, ACCESS_ENV } from 'kcd_sdk'
import type { GrantRef, AccessEntry } from 'kcd_sdk'

/**
 * TestSlice — the config double, and deliberately not a mock.
 *
 * The server reads its configuration from a real JSON file whose path arrives on an environment
 * variable, re-read on every call. That IS the mechanism, so a test that stubbed `loadConfig` would be
 * asserting against a shape rather than against the thing the server does — and the parse layer was one of
 * the six folds this arc collapsed, which makes it exactly the part worth exercising for real.
 *
 * So: a real temp file, a real env var, the real read path. One small write per arrangement, which costs
 * nothing at this size and buys the whole chain.
 *
 * Every env variable is RESTORED on `reset`, not merely deleted. Vitest runs a file's tests in one process,
 * and a suite that leaks a grant into the next one produces a pass that means nothing.
 *
 * `arm` also CLEARS the two per-turn carriers rather than only remembering them. They are the harness lane's
 * channels; the default arrangement here is the in-process lane, where neither is set. A leaked floor is the
 * worse of the two — a published floor outranks the slice outright, so one left behind would quietly answer
 * every slice-based assertion in the file after it.
 */

/** One entry as it may sit ON DISK, in either shape — the LEGACY boolean pair or the current level. All
 *  fields optional and untyped on purpose: the absent and wrong-typed cases are precisely what a parse has
 *  to be pinned on, and a slice can be hand-edited or written by an older build. */
export interface RawEntry {
	path?:    unknown
	enabled?: unknown
	write?:   unknown
	level?:   unknown
}

export class TestSlice {

	private _dir:      string | null = null
	private _priorEnv: string | undefined
	private _priorGrants: string | undefined
	private _priorFloor:  string | undefined

	/** Point the server at a fresh empty slice, with both per-turn carriers unset. Call in `beforeEach`. */
	arm(): void {
		this._priorEnv    = process.env[ 'STARMIND_PACKAGE_STORE' ]
		this._priorGrants = process.env[ GRANT_ENV ]
		this._priorFloor  = process.env[ ACCESS_ENV ]
		delete process.env[ GRANT_ENV ]
		delete process.env[ ACCESS_ENV ]
		this._dir = mkdtempSync( join( tmpdir(), 'starmind-file-test-' ) )
		this.write( {} )
	}

	/** Restore the environment and remove the temp dir. Call in `afterEach`. */
	reset(): void {
		this._restore( 'STARMIND_PACKAGE_STORE', this._priorEnv )
		this._restore( GRANT_ENV, this._priorGrants )
		this._restore( ACCESS_ENV, this._priorFloor )
		if( this._dir ) rmSync( this._dir, { recursive: true, force: true } )
		this._dir = null
	}

	/** Replace the whole slice with `content`, exactly as given — including malformed content, which is
	 *  half of what needs pinning. */
	write( content: unknown ): void {
		if( !this._dir ) throw new Error( 'TestSlice.write before arm' )
		const file = join( this._dir, 'pkg.starmind_file.json' )
		writeFileSync( file, JSON.stringify( content ), 'utf-8' )
		process.env[ 'STARMIND_PACKAGE_STORE' ] = file
	}

	/** The common arrangement — a whitelist and nothing else. */
	whitelist( ...entries: RawEntry[] ): void {
		this.write( { whitelist: entries } )
	}

	/** Point the store env at a path that does not exist — the degrade case. */
	missingFile(): void {
		process.env[ 'STARMIND_PACKAGE_STORE' ] = join( tmpdir(), 'starmind-file-test-nonexistent', 'nope.json' )
	}

	/** Unset the store env entirely — the other degrade case, and the one a standalone run hits. */
	noStore(): void {
		delete process.env[ 'STARMIND_PACKAGE_STORE' ]
	}

	/** Seed the HARNESS-tier grant carrier. Takes the raw string so a malformed payload is expressible. */
	grantsRaw( raw: string | null ): void {
		if( raw === null ) delete process.env[ GRANT_ENV ]
		else process.env[ GRANT_ENV ] = raw
	}

	/** Seed the harness carrier with well-formed grants. */
	grants( ...refs: GrantRef[] ): void {
		this.grantsRaw( JSON.stringify( refs ) )
	}

	/** Seed the HARNESS-tier FLOOR carrier. Raw so a corrupt or unexpanded payload is expressible — those
	 *  are the two failures the carrier is actually prone to and they want opposite outcomes. */
	floorRaw( raw: string | null ): void {
		if( raw === null ) delete process.env[ ACCESS_ENV ]
		else process.env[ ACCESS_ENV ] = raw
	}

	/** Publish a well-formed floor. NOTE that no arguments publishes an EMPTY one, which refuses every path
	 *  — deliberately different from `floorRaw( null )`, which publishes nothing and falls back to the slice. */
	floor( ...entries: AccessEntry[] ): void {
		this.floorRaw( JSON.stringify( entries ) )
	}

	/** The WIRE-tier carrier's shape — a `_meta` envelope, for the guards that take one. */
	static meta( ...refs: GrantRef[] ): Record<string, unknown> {
		return { starmind: { grants: refs } }
	}

	private _restore( key: string, prior: string | undefined ): void {
		if( prior === undefined ) delete process.env[ key ]
		else process.env[ key ] = prior
	}
}
