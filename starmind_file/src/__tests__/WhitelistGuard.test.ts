import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { WhitelistGuard } from '../guards/WhitelistGuard'
import { GuardError } from '../guards/AbstractGuard'
import { TestSlice } from './TestSlice'
import { loadConfig } from '../config'
import type { GrantRef } from 'kcd_sdk'

/**
 * WhitelistGuard — CHARACTERIZATION, written 2026-08-09 ahead of Arc 2.
 *
 * The read jail, and the only guard that can be excused. Everything here was asserted at the behaviour
 * BEFORE the ladder, as a baseline for the arc that rewrites it: Phase 2 moved the root computation onto a
 * shared resolver, Phase 3 gives grants a depth, Phase 4 moves the configuration to the project. Each
 * should leave every assertion in this file green except the ones it deliberately rewrites.
 *
 * Phase 2 changed none of them. The arrangements still write the LEGACY boolean pair, which now also makes
 * them the proof that an unmigrated slice keeps resolving exactly as it did — worth keeping in that shape
 * for as long as any installation might still be carrying one.
 *
 * NO DISK beyond the config slice. Containment is pure path math — `jail` resolves and compares and
 * deliberately never stats, which is what lets a refusal disclose the rule without disclosing whether the
 * file exists. A test that created files would be testing something the guard does not do.
 *
 * Paths hang off `tmpdir()` — the idiom the sibling gate suite already uses — because they must be
 * ABSOLUTE on both platforms and nothing is ever created at them. Writing them as literals would not do:
 * `join( 'C:', 'work' )` yields the drive-RELATIVE `C:work`, and a POSIX literal resolves against the
 * current drive on Windows. Either way `jail` would be comparing something other than what the test reads
 * like. The mixed-case segment is deliberate — the case-folding assertion is vacuous without one.
 */

const slice = new TestSlice()

/** The configured floor, minted the only way it can be — through `loadConfig`. Tests arrange the SLICE and
 *  then read it back through the real reader, so what reaches a guard here is the same value production
 *  hands it, rather than a literal that could drift from what the reader actually produces. */
function floor() {
	return loadConfig().whitelist
}


const BASE    = join( tmpdir(), 'starmind-wl' )
const ROOT    = join( BASE, 'Work', 'Proj' )
const INSIDE  = join( ROOT, 'src', 'app.ts' )
const SIBLING = join( BASE, 'Work', 'Projector', 'x.ts' )   // shares ROOT's prefix, is NOT inside it
const OUTSIDE = join( BASE, 'elsewhere', 'notes.md' )
const LOOSE   = join( BASE, 'loose' )
const FILE    = join( LOOSE, 'b.ts' )

/** One grant. Defaults to READ because that is what this guard is about — depth is the write surface's
 *  question, and a read grant is what every assertion here means. */
function grant( subject: string, level: GrantRef[ 'level' ] = 'read' ): GrantRef {
	return { kind: 'file', subject, level }
}

beforeEach( () => slice.arm() )
afterEach( () => slice.reset() )

describe( 'containment', () => {

	it( 'admits a path inside an enabled root', () => {
		slice.whitelist( { path: ROOT } )
		expect( WhitelistGuard.contain( INSIDE, floor() ) ).toBeNull()
	} )

	it( 'admits the root itself, not only what is under it', () => {
		slice.whitelist( { path: ROOT } )
		expect( WhitelistGuard.contain( ROOT, floor() ) ).toBeNull()
	} )

	it( 'refuses a path outside every root', () => {
		slice.whitelist( { path: ROOT } )
		expect( WhitelistGuard.contain( OUTSIDE, floor() ) ).toBe( 'PATH_OUTSIDE_WHITELIST' )
	} )

	it( 'reports an EMPTY whitelist distinctly from a path that missed one', () => {
		expect( WhitelistGuard.contain( INSIDE, floor() ) ).toBe( 'WHITELIST_EMPTY' )
	} )

	it( 'does not count a disabled root', () => {
		slice.whitelist( { path: ROOT, enabled: false } )
		expect( WhitelistGuard.contain( INSIDE, floor() ) ).toBe( 'WHITELIST_EMPTY' )
	} )

	it( 'reports an entry lowered to NONE the same way it reported a disabled one', () => {
		// The two codes route an agent differently — one says "you have nothing", the other "not there". A
		// disabled root used to produce the first because the old computation counted ENABLED roots, and the
		// ladder's equivalent has to keep producing it. Easy to lose by counting stored entries instead.
		slice.write( { whitelist: [ { path: ROOT, level: 'none' } ] } )
		expect( WhitelistGuard.contain( INSIDE, floor() ) ).toBe( 'WHITELIST_EMPTY' )
	} )

	it( 'distinguishes a closed path from a closed policy', () => {
		slice.write( { whitelist: [ { path: ROOT, level: 'read' }, { path: OUTSIDE, level: 'none' } ] } )
		expect( WhitelistGuard.contain( OUTSIDE, floor() ) ).toBe( 'PATH_OUTSIDE_WHITELIST' )
	} )

	it( 'stops at the separator — a prefix match is not containment', () => {
		slice.whitelist( { path: ROOT } )
		expect( WhitelistGuard.contain( SIBLING, floor() ) ).toBe( 'PATH_OUTSIDE_WHITELIST' )
	} )

	it( 'collapses .. before comparing, so an escape lands outside', () => {
		slice.whitelist( { path: ROOT } )
		expect( WhitelistGuard.contain( join( ROOT, '..', '..', 'etc', 'passwd' ), floor() ) ).toBe( 'PATH_OUTSIDE_WHITELIST' )
	} )

	it( 'folds case on Windows, where the filesystem does', () => {
		slice.whitelist( { path: ROOT } )
		const verdict = WhitelistGuard.contain( INSIDE.toLowerCase(), floor() )
		expect( verdict ).toBe( process.platform === 'win32' ? null : 'PATH_OUTSIDE_WHITELIST' )
	} )
} )

describe( 'grants — the only way past this guard', () => {

	it( 'excuses exactly the granted FILE', () => {
		expect( WhitelistGuard.contain( FILE, floor(), [ grant( FILE ) ] ) ).toBeNull()
	} )

	it( 'excuses a granted FOLDER and what sits under it', () => {
		expect( WhitelistGuard.contain( join( LOOSE, 'deep', 'x.md' ), floor(), [ { kind: 'folder', subject: LOOSE, level: 'read' } ] ) ).toBeNull()
	} )

	it( 'cannot be stretched past the separator — a grant on b.ts is not a grant on b.ts.bak', () => {
		expect( WhitelistGuard.contain( `${ FILE }.bak`, floor(), [ grant( FILE ) ] ) ).toBe( 'WHITELIST_EMPTY' )
	} )

	it( 'does not excuse a sibling of the granted file', () => {
		expect( WhitelistGuard.contain( join( LOOSE, 'other.ts' ), floor(), [ grant( FILE ) ] ) ).toBe( 'WHITELIST_EMPTY' )
	} )

	it( 'still reports WHITELIST_EMPTY when a grant exists but does not cover the path', () => {
		// The code reports the ROOTS being empty, which is true, and is why the refusal PROSE is worded off
		// the scope rather than off this code — a grant in force means the agent does have access to
		// something, and a message saying otherwise would be a lie it cannot check.
		expect( WhitelistGuard.contain( OUTSIDE, floor(), [ grant( FILE ) ] ) ).toBe( 'WHITELIST_EMPTY' )
	} )

	it( 'admits at every rung AT OR ABOVE read, and refuses at none', () => {
		// This door needs `read` and nothing deeper, so a write grant admits here exactly as a read one does.
		// The rung starts mattering at the write surface, which is the point of it being ordered.
		expect( WhitelistGuard.contain( FILE, floor(), [ grant( FILE, 'read' ) ] ) ).toBeNull()
		expect( WhitelistGuard.contain( FILE, floor(), [ grant( FILE, 'write' ) ] ) ).toBeNull()
		expect( WhitelistGuard.contain( FILE, floor(), [ grant( FILE, 'none' ) ] ) ).toBe( 'WHITELIST_EMPTY' )
	} )
} )

describe( 'the two carriers deliver one list', () => {

	it( 'honours a grant that arrived on the wire envelope', () => {
		expect( WhitelistGuard.permits( 'read', FILE, TestSlice.meta( grant( FILE ) ) ) ).toBe( true )
	} )

	it( 'honours the same grant when it arrived on the environment instead', () => {
		slice.grants( grant( FILE ) )
		expect( WhitelistGuard.permits( 'read', FILE ) ).toBe( true )
	} )

	it( 'gives the same verdict either way — the property that must never drift', () => {
		const wire = WhitelistGuard.permits( 'read', FILE, TestSlice.meta( grant( FILE ) ) )
		slice.grants( grant( FILE ) )
		const env  = WhitelistGuard.permits( 'read', FILE )
		expect( wire ).toBe( env )
	} )
} )

describe( 'scope — the witness a refusal points with', () => {

	it( 'lists the enabled roots plus every granted subject', () => {
		slice.whitelist( { path: ROOT } )
		expect( WhitelistGuard.scope( TestSlice.meta( grant( FILE ) ) ).sort() ).toEqual( [ FILE, ROOT ].sort() )
	} )

	it( 'omits a disabled root, so it never advertises reach the guard would refuse', () => {
		slice.whitelist( { path: ROOT, enabled: false } )
		expect( WhitelistGuard.scope() ).toEqual( [] )
	} )

	it( 'dedupes a granted path that already sits inside a root', () => {
		slice.whitelist( { path: ROOT } )
		expect( WhitelistGuard.scope( TestSlice.meta( grant( ROOT ) ) ) ).toEqual( [ ROOT ] )
	} )
} )

describe( 'the chain entry', () => {

	it( 'throws a coded GuardError whose message POINTS at where the call may go', () => {
		slice.whitelist( { path: ROOT } )
		let thrown: unknown
		try {
			new WhitelistGuard().validate( { tool: 'list', params: { path: OUTSIDE } } )
		} catch( err ) {
			thrown = err
		}
		expect( thrown ).toBeInstanceOf( GuardError )
		const error = thrown as GuardError
		expect( error.code ).toBe( 'PATH_OUTSIDE_WHITELIST' )
		expect( error.message ).toContain( OUTSIDE )   // what was refused
		expect( error.message ).toContain( ROOT )      // and where it MAY go instead
	} )

	it( 'says so plainly when there is no access at all rather than naming an empty list', () => {
		let message = ''
		try {
			new WhitelistGuard().validate( { tool: 'list', params: { path: OUTSIDE } } )
		} catch( err ) {
			message = ( err as GuardError ).message
		}
		expect( message ).toContain( 'no file access at all' )
	} )

	it( 'passes a contained path through without throwing', () => {
		slice.whitelist( { path: ROOT } )
		expect( () => new WhitelistGuard().validate( { tool: 'list', params: { path: INSIDE } } ) ).not.toThrow()
	} )

	it( 'ignores a request carrying no string path — batch tools jail per item instead', () => {
		expect( () => new WhitelistGuard().validate( { tool: 'read', params: { paths: [ OUTSIDE ] } } ) ).not.toThrow()
	} )

	it( 'returns false rather than throwing on the per-item door', () => {
		slice.whitelist( { path: ROOT } )
		expect( WhitelistGuard.permits( 'read', OUTSIDE ) ).toBe( false )
		expect( WhitelistGuard.permits( 'read', INSIDE ) ).toBe( true )
	} )
} )
