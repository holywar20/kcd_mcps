import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig, DEFAULT_GREP_FILE_CAP } from '../config'
import { TestSlice } from './TestSlice'
import type { AccessEntry } from 'kcd_sdk'

/**
 * The config parse — rewritten by Arc 2 Phase 2, exactly as its characterization predecessor said it would
 * be. What that version asserted about the `enabled`/`write` pair now lives in the shared migration table
 * ( `AccessPolicy.test.ts` ), because this file no longer performs the fold: `loadConfig` delegates to
 * `parseAccessList`, which was the point of the collapse.
 *
 * What stays here is what is LOCAL to this server and untouched by the ladder — where the configuration
 * comes from, how it degrades, and the grant carrier. Those assertions are the same ones written before
 * the change and they are the evidence the change did not disturb anything beside itself.
 *
 * One legacy case is deliberately kept rather than moved: a stored slice still holding the old pair has to
 * come back through THIS door as levels. The unit test proves the table; this proves the wiring.
 */

const slice = new TestSlice()

beforeEach( () => slice.arm() )
afterEach( () => slice.reset() )

describe( 'the policy arrives as LEVELS, through the shared parse', () => {

	it( 'reads a slice written in the new shape', () => {
		slice.write( { whitelist: [ { path: 'C:\\a', level: 'write' } ] } )
		expect( loadConfig().whitelist ).toEqual( [ { path: 'C:\\a', level: 'write' } ] )
	} )

	it( 'migrates a LEGACY slice on the way through — the wiring, not the table', () => {
		// Every row of the table is proved in AccessPolicy.test.ts. What this asserts is that the server's
		// own door is the one calling it, so an installation that has never been touched since the change
		// still resolves correctly on its next tool call rather than after some rewrite that has to have run.
		slice.whitelist(
			{ path: 'C:\\off',   enabled: false },
			{ path: 'C:\\read',  enabled: true },
			{ path: 'C:\\deep',  enabled: true, write: true }
		)
		expect( loadConfig().whitelist ).toEqual( [
			{ path: 'C:\\off',  level: 'none' },
			{ path: 'C:\\read', level: 'read' },
			{ path: 'C:\\deep', level: 'delete' }
		] )
	} )

	it( 'drops malformed entries instead of guessing at them', () => {
		slice.write( { whitelist: [ null, 'C:\\a', 42, {}, { path: '' }, { path: 5 }, { path: 'C:\\ok' } ] } )
		expect( loadConfig().whitelist ).toEqual( [ { path: 'C:\\ok', level: 'read' } ] )
	} )

	it( 'degrades to an empty policy on a non-array, a missing file, or no env at all', () => {
		slice.write( { whitelist: { path: 'C:\\a' } } )
		expect( loadConfig().whitelist ).toEqual( [] )
		slice.missingFile()
		expect( loadConfig().whitelist ).toEqual( [] )
		slice.noStore()
		expect( loadConfig().whitelist ).toEqual( [] )
	} )
} )

describe( 'a PUBLISHED floor outranks the slice', () => {

	// The harness lane's carrier, and the wiring rather than the parse ( that is pinned in the SDK, which
	// owns both ends ). What this proves is that this server's own door consults it, and in which order.
	//
	// The order is the whole point. Both lanes are handed the SAME slice path, so a harness child reading its
	// baseline from that file reads whatever the in-process lane last wrote there — which belongs to whatever
	// workspace THAT lane was serving. Being told directly is the only way this child can be sure the floor
	// it enforces is its own.

	const SLICE_ROOT: AccessEntry = { path: 'C:\\from-slice', level: 'read' }
	const SENT_ROOT:  AccessEntry = { path: 'C:\\from-host',  level: 'write' }

	it( 'uses the published floor and ignores the slice entirely', () => {
		slice.write( { whitelist: [ SLICE_ROOT ] } )
		slice.floor( SENT_ROOT )
		expect( loadConfig().whitelist ).toEqual( [ SENT_ROOT ] )
	} )

	it( 'falls back to the slice when nothing was published — the in-process lane', () => {
		// Not a legacy path. Starmind's own copy of this server is long-lived and is never given the variable,
		// because env would freeze its floor at spawn; it is re-pointed through the slice instead. So `absent`
		// is the ordinary, correct state on that lane rather than a version skew to be migrated away.
		slice.write( { whitelist: [ SLICE_ROOT ] } )
		slice.floorRaw( null )
		expect( loadConfig().whitelist ).toEqual( [ SLICE_ROOT ] )
	} )

	it( 'treats a published EMPTY floor as a refusal, not as nothing published', () => {
		// The distinction the carrier exists for. Reading these as the same thing would restore the slice at
		// the exact moment a host meant to say this caller reaches nothing — and on this server that slice can
		// hold another workspace's roots.
		slice.write( { whitelist: [ SLICE_ROOT ] } )
		slice.floor()
		expect( loadConfig().whitelist ).toEqual( [] )
	} )

	it( 'falls back when the reference arrived unexpanded, rather than refusing everything', () => {
		// A failed string substitution is a transport failure, not a statement about access — and it has
		// happened before on the grant carrier. Denying every path over one would take file access down for a
		// reason nobody could see from the outside.
		slice.write( { whitelist: [ SLICE_ROOT ] } )
		slice.floorRaw( '${STARMIND_ACCESS}' )
		expect( loadConfig().whitelist ).toEqual( [ SLICE_ROOT ] )
	} )

	it( 'refuses everything when a floor arrived and could not be read', () => {
		// The opposite direction from the case above, deliberately: that one is the variable failing to
		// arrive, this one is a floor arriving corrupt. A floor we cannot read is not one we may quietly
		// swap a different floor in for.
		slice.write( { whitelist: [ SLICE_ROOT ] } )
		slice.floorRaw( '{ not a list }' )
		expect( loadConfig().whitelist ).toEqual( [] )
	} )

	it( 'leaves the GRANTS carrier alone — the two are read independently', () => {
		// They are halves of one answer but separate variables, so a turn can publish a floor with no
		// exceptions, or exceptions against a floor it fell back to, and neither disturbs the other.
		slice.floor( SENT_ROOT )
		slice.grants( { kind: 'file', subject: 'C:\\elsewhere\\one.md', level: 'read' } )
		const config = loadConfig()
		expect( config.whitelist ).toEqual( [ SENT_ROOT ] )
		expect( config.grants ).toEqual( [ { kind: 'file', subject: 'C:\\elsewhere\\one.md', level: 'read' } ] )
	} )
} )

describe( 'blacklist parse — config may widen, never narrow', () => {

	it( 'always includes the shared defaults, with no config at all', () => {
		expect( loadConfig().blacklist.length ).toBeGreaterThan( 0 )
	} )

	it( 'appends user patterns to the defaults rather than replacing them', () => {
		const defaults = loadConfig().blacklist
		slice.write( { blacklist: [ '**/mine' ] } )
		const widened = loadConfig().blacklist
		expect( widened ).toContain( '**/mine' )
		for( const pattern of defaults ) expect( widened ).toContain( pattern )
	} )

	it( 'ignores malformed patterns without losing the good ones', () => {
		slice.write( { blacklist: [ '', null, 7, '**/mine' ] } )
		expect( loadConfig().blacklist ).toContain( '**/mine' )
	} )
} )

describe( 'grep cap', () => {

	it( 'defaults when absent, zero, negative or the wrong type', () => {
		for( const value of [ undefined, 0, -5, 'lots', null ] ) {
			slice.write( { grepFileCap: value } )
			expect( loadConfig().grepFileCap ).toBe( DEFAULT_GREP_FILE_CAP )
		}
	} )

	it( 'floors a fractional override', () => {
		slice.write( { grepFileCap: 12.9 } )
		expect( loadConfig().grepFileCap ).toBe( 12 )
	} )
} )

describe( 'the harness grant carrier — fails closed on everything', () => {

	it( 'reads well-formed grants off the environment', () => {
		slice.grants( { kind: 'file', subject: 'C:\\x\\y.md', level: 'read' } )
		expect( loadConfig().grants ).toEqual( [ { kind: 'file', subject: 'C:\\x\\y.md', level: 'read' } ] )
	} )

	it( 'yields nothing for an absent, unparseable, non-array or unexpanded value', () => {
		for( const raw of [ null, 'not json', '{"grants":[]}', '${STARMIND_GRANTS}', '"a string"' ] ) {
			slice.grantsRaw( raw )
			expect( loadConfig().grants ).toEqual( [] )
		}
	} )

	it( 'drops a grant missing a subject, missing a kind, or naming an unknown kind', () => {
		slice.grantsRaw( JSON.stringify( [
			{ kind: 'file' },
			{ subject: 'C:\\x' },
			{ kind: 'file', subject: '' },
			{ kind: 'wormhole', subject: 'C:\\x' },
			{ kind: 'file', subject: 'C:\\keep.md', level: 'read' }
		] ) )
		expect( loadConfig().grants ).toEqual( [ { kind: 'file', subject: 'C:\\keep.md', level: 'read' } ] )
	} )

	it( 'CARRIES the level now — the wiring half of Phase 3, the table is proved in the SDK', () => {
		// Its predecessor asserted the opposite: the depth Arc 1 recorded stopped at this parse. It was
		// pinned precisely so the moment it started surviving would be a deliberate edit here rather than
		// something nobody noticed.
		slice.grantsRaw( JSON.stringify( [ { kind: 'file', subject: 'C:\\x.md', level: 'write' } ] ) )
		expect( loadConfig().grants ).toEqual( [ { kind: 'file', subject: 'C:\\x.md', level: 'write' } ] )
	} )

	it( 'reads a payload with no level as read, so an older host under-grants rather than breaking', () => {
		slice.grantsRaw( JSON.stringify( [ { kind: 'file', subject: 'C:\\x.md' } ] ) )
		expect( loadConfig().grants ).toEqual( [ { kind: 'file', subject: 'C:\\x.md', level: 'read' } ] )
	} )
} )

describe( 'freshness — the property the whole no-respawn design rests on', () => {

	it( 'sees a slice rewritten between two calls', () => {
		slice.whitelist( { path: 'C:\\a' } )
		expect( loadConfig().whitelist ).toHaveLength( 1 )
		slice.whitelist( { path: 'C:\\a' }, { path: 'C:\\b' } )
		expect( loadConfig().whitelist ).toHaveLength( 2 )
	} )
} )
