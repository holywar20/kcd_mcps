import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { WriteGuard } from '../guards/WriteGuard'
import { DeleteGuard } from '../guards/DeleteGuard'
import { WRITE_MAX_BYTES } from '../config'
import { TestSlice } from './TestSlice'
import { loadConfig } from '../config'
import { SdkFileAccess } from 'kcd_sdk'
import type { GrantRef } from 'kcd_sdk'

/**
 * The WRITE SURFACE — CHARACTERIZATION, written 2026-08-09 ahead of Arc 2 Phases 2 and 3.
 *
 * Write and delete are ONE surface by design: a write-enabled root is a deletable root, and the two
 * guards compute their root set with byte-identical code. Testing them in one file is the honest framing
 * and it is also what catches the two copies drifting — see the shared-surface block at the end, which
 * is the assertion a single-guard suite would have no way to make.
 *
 * EVERY ASSERTION HERE SURVIVED PHASE 2 UNCHANGED, which is the result the phase was aiming at: the root
 * fold moved onto a shared resolver and the stored booleans became an ordered level, and not one verdict
 * moved. The arrangements below still write the legacy pair on purpose — they are now also proving that a
 * slice nobody has migrated resolves exactly as it always did.
 *
 * Phase 3 then turned the two assertions it said it would, and only those: a grant now reaches the write
 * surface at its own rung, and the extension limit yields to an explicit hand-over. Both are rewritten
 * below rather than deleted, so what changed is legible beside what did not.
 *
 * The DELETE block at the end is the one that must survive the rest of the arc unchanged.
 */

const slice = new TestSlice()

/** The configured floor, minted the only way it can be — through `loadConfig`. Tests arrange the SLICE and
 *  then read it back through the real reader, so what reaches a guard here is the same value production
 *  hands it, rather than a literal that could drift from what the reader actually produces. */
function floor() {
	return loadConfig().whitelist
}


// Absolute on both platforms and never created — see the WhitelistGuard suite for why a literal will not do.
const BASE   = join( tmpdir(), 'starmind-ws' )
const ROOT   = join( BASE, 'proj' )
const DOC    = join( ROOT, 'notes.md' )
const CODE   = join( ROOT, 'src', 'app.ts' )
const SECRET = join( ROOT, '.env' )
const KEY    = join( ROOT, 'certs', 'server.pem' )
const GITDIR = join( ROOT, '.git', 'config' )
const OUT    = join( BASE, 'elsewhere', 'notes.md' )

/** A root the user opted into writing. Still written in the LEGACY shape, so these arrangements double as
 *  proof that an unmigrated slice keeps resolving exactly as it did. */
function writable(): void {
	slice.whitelist( { path: ROOT, enabled: true, write: true } )
}

/** One grant at a stated depth — the shape both carriers deliver. */
function grant( subject: string, level: GrantRef[ 'level' ] ): GrantRef {
	return { kind: 'file', subject, level }
}

beforeEach( () => slice.arm() )
afterEach( () => slice.reset() )

describe( 'the write jail', () => {

	it( 'permits a text write inside a write-enabled root', () => {
		writable()
		expect( WriteGuard.contain( DOC, 'hello', floor() ) ).toBeNull()
	} )

	it( 'refuses everything when NOTHING is write-enabled — the severe default', () => {
		expect( WriteGuard.contain( DOC, 'hello', floor() ) ).toBe( 'no_write_roots' )
	} )

	it( 'refuses a root that is readable but not write-flagged', () => {
		slice.whitelist( { path: ROOT, enabled: true, write: false } )
		expect( WriteGuard.contain( DOC, 'hello', floor() ) ).toBe( 'no_write_roots' )
	} )

	it( 'refuses a write-flagged root that is disabled', () => {
		slice.whitelist( { path: ROOT, enabled: false, write: true } )
		expect( WriteGuard.contain( DOC, 'hello', floor() ) ).toBe( 'no_write_roots' )
	} )

	it( 'refuses a path outside the write surface when one exists', () => {
		writable()
		expect( WriteGuard.contain( OUT, 'hello', floor() ) ).toBe( 'outside_write_surface' )
	} )
} )

describe( 'the three orthogonal gates', () => {

	it( 'never writes over a secret, however write-enabled the root', () => {
		writable()
		for( const path of [ SECRET, KEY, GITDIR ] ) {
			expect( WriteGuard.contain( path, 'x', floor() ) ).toBe( 'out_of_scope' )
		}
	} )

	// Still true for the CONFIGURED surface, which is where the limit was always the point: a root covers a
	// tree nobody enumerated. Phase 3 opened it to a grant only — see the hand-over block below.
	it( 'refuses code and executables by extension', () => {
		writable()
		expect( WriteGuard.contain( CODE, 'x', floor() ) ).toBe( 'extension_blocked' )
		expect( WriteGuard.contain( join( ROOT, 'run.sh' ), 'x', floor() ) ).toBe( 'extension_blocked' )
		expect( WriteGuard.contain( join( ROOT, 'a.exe' ), 'x', floor() ) ).toBe( 'extension_blocked' )
	} )

	it( 'allows the text and asset extensions', () => {
		writable()
		for( const name of [ 'a.md', 'a.txt', 'a.json', 'a.csv', 'a.svg', 'a.yaml', 'a.html', 'a.xml', 'a.log' ] ) {
			expect( WriteGuard.contain( join( ROOT, name ), 'x', floor() ) ).toBeNull()
		}
	} )

	it( 'refuses a write over the size cap, and permits one exactly at it', () => {
		writable()
		expect( WriteGuard.contain( DOC, 'x'.repeat( WRITE_MAX_BYTES ), floor() ) ).toBeNull()
		expect( WriteGuard.contain( DOC, 'x'.repeat( WRITE_MAX_BYTES + 1 ), floor() ) ).toBe( 'too_large' )
	} )

	it( 'measures the cap in BYTES, not characters', () => {
		writable()
		// One multi-byte character per two budgeted bytes — under the character count, over the byte count.
		expect( WriteGuard.contain( DOC, '€'.repeat( WRITE_MAX_BYTES / 2 ), floor() ) ).toBe( 'too_large' )
	} )

	it( 'checks containment BEFORE content — an outside path is refused for being outside', () => {
		writable()
		expect( WriteGuard.contain( join( BASE, 'elsewhere', 'a.exe' ), 'x'.repeat( WRITE_MAX_BYTES + 1 ), floor() ) ).toBe( 'outside_write_surface' )
	} )
} )

describe( 'the delete jail', () => {

	it( 'permits a delete inside a write-enabled root', () => {
		writable()
		expect( DeleteGuard.contain( DOC, floor() ) ).toBeNull()
	} )

	it( 'refuses when nothing is write-enabled', () => {
		expect( DeleteGuard.contain( DOC, floor() ) ).toBe( 'no_write_roots' )
	} )

	it( 'refuses a readable-only root', () => {
		slice.whitelist( { path: ROOT, enabled: true, write: false } )
		expect( DeleteGuard.contain( DOC, floor() ) ).toBe( 'no_write_roots' )
	} )

	it( 'refuses outside the write surface', () => {
		writable()
		expect( DeleteGuard.contain( OUT, floor() ) ).toBe( 'outside_write_surface' )
	} )

	it( 'never deletes a secret', () => {
		writable()
		expect( DeleteGuard.contain( SECRET, floor() ) ).toBe( 'out_of_scope' )
	} )

	it( 'has NO extension or size gate — a delete has no content to judge', () => {
		writable()
		expect( DeleteGuard.contain( CODE, floor() ) ).toBeNull()
	} )

	it( 'is REFUSED by a root that reaches only write — the rung the ladder made expressible', () => {
		// The one thing the boolean pair could not say. `write: true` meant write AND delete because the two
		// guards shared a root set; a level can now stop at write, and the migration maps the legacy flag to
		// `delete` precisely so nobody's existing configuration loses the deletes it already permitted.
		slice.write( { whitelist: [ { path: ROOT, level: 'write' } ] } )
		expect( WriteGuard.contain( DOC, 'x', floor() ) ).toBeNull()
		expect( DeleteGuard.contain( DOC, floor() ) ).toBe( 'no_write_roots' )
	} )
} )

describe( 'a grant reaches WRITE, up to its own rung', () => {

	it( 'permits a write outside every configured root, with nothing configured at all', () => {
		expect( WriteGuard.contain( OUT, 'hello', floor(), [ grant( OUT, 'write' ) ] ) ).toBeNull()
	} )

	it( 'refuses when the grant only reaches READ — the rung is the permission', () => {
		expect( WriteGuard.contain( OUT, 'hello', floor(), [ grant( OUT, 'read' ) ] ) ).toBe( 'no_write_roots' )
	} )

	it( 'covers exactly its subject and nothing beside it', () => {
		const grants = [ grant( OUT, 'write' ) ]
		expect( WriteGuard.contain( join( BASE, 'elsewhere', 'other.md' ), 'x', floor(), grants ) ).toBe( 'outside_write_surface' )
	} )

	it( 'clears the EXTENSION limit — the whole point of a direct hand-over', () => {
		expect( WriteGuard.contain( join( BASE, 'loose', 'app.ts' ), 'x', floor(), [ grant( join( BASE, 'loose', 'app.ts' ), 'write' ) ] ) ).toBeNull()
	} )

	it( 'clears the extension limit even where CONFIGURATION already covered the path', () => {
		// The asymmetry worth guarding: keyed off which source WON, the identical gesture would succeed on a
		// file outside the project and fail on one inside it, for reasons invisible when it was made.
		writable()
		expect( WriteGuard.contain( CODE, 'x', floor() ) ).toBe( 'extension_blocked' )
		expect( WriteGuard.contain( CODE, 'x', floor(), [ grant( CODE, 'write' ) ] ) ).toBeNull()
	} )

	it( 'does NOT clear the deny-list — a stray drop may not switch off the secret rule', () => {
		expect( WriteGuard.contain( SECRET, 'x', floor(), [ grant( SECRET, 'write' ) ] ) ).toBe( 'out_of_scope' )
		expect( WriteGuard.contain( KEY, 'x', floor(), [ grant( KEY, 'write' ) ] ) ).toBe( 'out_of_scope' )
	} )

	it( 'does NOT clear the size cap — it guards the disk, not the authority', () => {
		expect( WriteGuard.contain( OUT, 'x'.repeat( WRITE_MAX_BYTES + 1 ), floor(), [ grant( OUT, 'write' ) ] ) ).toBe( 'too_large' )
	} )

	it( 'reads its grants off the call envelope, the same carrier the read guard reads', () => {
		expect( WriteGuard.permits( 'write', OUT, 'hello', TestSlice.meta( grant( OUT, 'write' ) ) ) ).toBeNull()
		expect( WriteGuard.permits( 'write', OUT, 'hello' )?.code ).toBe( 'no_write_roots' )
	} )

	it( 'reads them off the ENVIRONMENT too, with the same verdict', () => {
		slice.grants( grant( OUT, 'write' ) )
		expect( WriteGuard.permits( 'write', OUT, 'hello' ) ).toBeNull()
	} )
} )

describe( 'DELETE is unreachable by any gesture — the line that must survive the whole arc', () => {

	it( 'takes no grant list at all — the COMPILER refuses one, including a grant list in disguise', () => {
		// STILL STRUCTURAL, still not a comparison someone could invert — but the structure moved, because
		// arity stopped being available to carry it. `contain` had to take the floor as an argument once one
		// copy of this server began answering for several sessions: an ambient read judges a delete against
		// whichever workspace resolved last, which is wrong in both directions at once and silent.
		//
		// A PLAIN `AccessEntry[]` WOULD NOT HAVE HELD THE LINE. Passing `GrantRef[]` directly fails, but the
		// one-line map below satisfies a plain array perfectly — and a gesture reaches delete. `ConfiguredFloor`
		// is branded and `loadConfig` is its only mint, so the disguise fails too.
		//
		// THIS ASSERTION IS THE COMPILER'S, NOT VITEST'S. `@ts-expect-error` fails the BUILD if the error it
		// expects stops happening — so removing the brand breaks typecheck on this line, rather than being
		// discovered after something has already been deleted. The runtime call is inert scaffolding; the
		// arity check beside it pins that no THIRD parameter appeared, which is where a grant list would go.
		const disguised = [ grant( DOC, 'delete' ) ].map( ( g ) => ( { path: g.subject, level: g.level } ) )
		// @ts-expect-error — a mapped grant list is a plain AccessEntry[] and cannot satisfy ConfiguredFloor.
		DeleteGuard.contain( DOC, disguised )
		expect( DeleteGuard.contain.length ).toBe( 2 )
	} )

	it( 'refuses through PERMITS with a grant in force — the path a caller actually takes', () => {
		// The sibling assertions all drive `contain` directly, which is the right unit but the wrong ROAD: a
		// future edit that mapped grants into the floor would do it at the `permits` call site, above every
		// one of them, and they would all stay green while delete became reachable by gesture. This is the
		// only test in the file that would fail.
		// NOTHING CONFIGURED, deliberately — no `writable()`. With a delete root in place the refusal could
		// come from the path being outside it, which is a different rule and would pass even if grants HAD
		// reached the resolver. Configured-empty leaves exactly one reason a delete can be refused: the guard
		// did not look at the grant. That is the property, so that is the arrangement.
		slice.grants( grant( DOC, 'delete' ) )
		expect( DeleteGuard.permits( 'delete', DOC )?.code ).toBe( 'no_write_roots' )
	} )

	it( 'refuses a delete on a granted subject with nothing configured', () => {
		slice.grants( grant( DOC, 'write' ) )
		expect( DeleteGuard.contain( DOC, floor() ) ).toBe( 'no_write_roots' )
	} )

	it( 'refuses even a grant that somehow claims DELETE depth', () => {
		// Such a grant should be impossible — the gesture clamps below this rung where the record is made.
		// This is the second of the two independent refusals: if the clamp were ever bypassed, the guard
		// still does not look, so the payload changes nothing.
		slice.grantsRaw( JSON.stringify( [ { kind: 'file', subject: DOC, level: 'delete' } ] ) )
		expect( DeleteGuard.contain( DOC, floor() ) ).toBe( 'no_write_roots' )
	} )

	it( 'refuses a granted subject outside the write surface while a delete root exists', () => {
		writable()
		slice.grants( grant( OUT, 'write' ) )
		expect( DeleteGuard.contain( OUT, floor() ) ).toBe( 'outside_write_surface' )
	} )
} )

describe( 'one surface, two guards — the copy that must not drift', () => {

	/** Every arrangement where write and delete are supposed to agree. They disagree only on the two gates
	 *  a delete has no content for, which are tested separately above. */
	const SHARED: { label: string; arrange: () => void; path: string; code: string | null }[] = [
		{ label: 'nothing enabled',      arrange: () => slice.whitelist(),                                       path: DOC,    code: 'no_write_roots' },
		{ label: 'read-only root',       arrange: () => slice.whitelist( { path: ROOT, enabled: true } ),         path: DOC,    code: 'no_write_roots' },
		{ label: 'disabled write root',  arrange: () => slice.whitelist( { path: ROOT, enabled: false, write: true } ), path: DOC, code: 'no_write_roots' },
		{ label: 'outside the surface',  arrange: writable,                                                       path: OUT,    code: 'outside_write_surface' },
		{ label: 'a blacklisted secret', arrange: writable,                                                       path: SECRET, code: 'out_of_scope' },
		{ label: 'a permitted document', arrange: writable,                                                       path: DOC,    code: null }
	]

	for( const row of SHARED ) {
		it( `agrees on ${ row.label }`, () => {
			row.arrange()
			expect( WriteGuard.contain( row.path, 'x', floor() ) ).toBe( row.code )
			expect( DeleteGuard.contain( row.path, floor() ) ).toBe( row.code )
		} )
	}
} )

describe( 'the per-path doors never throw', () => {

	it( 'returns the code in band rather than sinking the batch', () => {
		writable()
		expect( () => WriteGuard.permits( 'write', OUT, 'x' ) ).not.toThrow()
		expect( WriteGuard.permits( 'write', OUT, 'x' )?.code ).toBe( 'outside_write_surface' )
		expect( DeleteGuard.permits( 'delete', OUT )?.code ).toBe( 'outside_write_surface' )
		expect( WriteGuard.permits( 'write', DOC, 'x' ) ).toBeNull()
		expect( DeleteGuard.permits( 'delete', DOC ) ).toBeNull()
	} )
} )

describe( 'the refusal an agent actually reads', () => {

	// The write and delete doors returned a bare CODE and nothing else, which told a model that something
	// was wrong and nothing about what would be right. The read door has pointed at its scope since the day
	// it was written. These assert that the other two thirds of the surface now do too — in the SAME words,
	// because they defer to the same author rather than each carrying its own.

	it( 'points a too-shallow WRITE at the depth, not at somewhere else to go', () => {
		slice.whitelist( { path: ROOT, enabled: true, write: false } )   // readable, not writable
		const detail = WriteGuard.permits( 'write', DOC, 'x' )?.detail ?? ''

		expect( detail ).toContain( 'write' )
		expect( detail ).toContain( 'raise' )
		// The wrong advice for this refusal — relocating a file it should have asked about.
		expect( detail ).not.toContain( 'Work inside one of those' )
	} )

	it( 'points a path OUTSIDE the write surface at where the surface is', () => {
		writable()
		const detail = WriteGuard.permits( 'write', OUT, 'x' )?.detail ?? ''

		expect( detail ).toContain( 'outside' )
		expect( detail ).toContain( ROOT )
	} )

	it( 'never says DELETE to the agent, at the door named for it', () => {
		writable()
		const detail = DeleteGuard.permits( 'delete', OUT )?.detail ?? ''

		expect( detail ).toContain( 'remove' )
		expect( detail ).not.toContain( 'delete' )
	} )

	it( 'words a blacklist refusal identically to the other door', () => {
		writable()
		expect( WriteGuard.permits( 'write', SECRET, 'x' )?.detail ).toBe( SdkFileAccess.blacklistLine() )
		expect( DeleteGuard.permits( 'delete', SECRET )?.detail ).toBe( SdkFileAccess.blacklistLine() )
	} )

	// ── The split, and why the enum could not stay one value ──
	//
	// `outside_write_surface` meant BOTH "that path is in no root of yours" and "that path is yours, just
	// not this deeply". An agent reported the second reading as actively false — a file it had just read,
	// explicitly handed over, refused as though it were outside everything. The prose fix is not enough on
	// its own: the CODE is what a trace keys on, and two very different bugs ( a grant that never arrived
	// vs one that arrived at the wrong tier ) were producing identical evidence.

	/** A shallow root OUTSIDE the deep one, so a path inside it is reachable but not writable. */
	const SHALLOW = join( BASE, 'elsewhere' )
	function shallowBesideDeep(): void {
		slice.whitelist( { path: ROOT, enabled: true, write: true }, { path: SHALLOW, enabled: true, write: false } )
	}

	it( 'says INSUFFICIENT_LEVEL for a path that is reachable but not deeply enough', () => {
		shallowBesideDeep()
		expect( WriteGuard.contain( OUT, 'x', floor() ) ).toBe( 'insufficient_level' )
		expect( DeleteGuard.contain( OUT, floor() ) ).toBe( 'insufficient_level' )
	} )

	it( 'still says OUTSIDE_WRITE_SURFACE for a path in no root at all — the other meaning, kept', () => {
		writable()
		expect( WriteGuard.contain( OUT, 'x', floor() ) ).toBe( 'outside_write_surface' )
		expect( DeleteGuard.contain( OUT, floor() ) ).toBe( 'outside_write_surface' )
	} )

	it( 'gives the two codes DIFFERENT advice, which is the point of splitting them', () => {
		shallowBesideDeep()
		const shallow = WriteGuard.permits( 'write', OUT, 'x' )?.detail ?? ''
		writable()
		const outside = WriteGuard.permits( 'write', OUT, 'x' )?.detail ?? ''

		expect( shallow ).toContain( 'within reach' )
		expect( outside ).toContain( 'outside' )
		expect( shallow ).not.toBe( outside )
	} )

	it( 'tells a GRANT HOLDER the actual rule instead of calling its own file out of scope', () => {
		// THE REPORTED DEFECT, pinned. A granted file is refused for delete — correctly, since a gesture
		// may never reach that rung — but the refusal used to describe a world without the grant in it and
		// said the path sat outside everything. From where the agent stands that is false: it had just read
		// the file. Naming the rule ends the probing; naming the wrong scope starts it.
		writable()
		const detail = DeleteGuard.permits( 'delete', OUT, TestSlice.meta( grant( OUT, 'read' ) ) )?.detail ?? ''

		expect( detail ).toContain( 'grant' )
		expect( detail ).toContain( 'NEVER' )
		expect( detail ).toContain( 'Retrying will not change this' )
		expect( detail ).not.toContain( 'sits outside' )
	} )

	it( 'does NOT let that explanation reach the DECISION — containment stays grant-blind', () => {
		// The whole reason the message was blind in the first place. Wording may see the grant; the verdict
		// may not, and `contain` takes no argument through which one could arrive.
		writable()
		expect( DeleteGuard.permits( 'delete', OUT, TestSlice.meta( grant( OUT, 'delete' ) ) )?.code )
			.toBe( 'outside_write_surface' )
		expect( DeleteGuard.contain( OUT, floor() ) ).toBe( 'outside_write_surface' )
	} )

	it( 'keeps the write-ONLY refusals local, and says what would fix them', () => {
		// An extension allowlist and a size cap have no in-process twin to drift from, so they are worded
		// here on purpose. They still owe the agent a next move.
		writable()
		expect( WriteGuard.permits( 'write', CODE, 'x' )?.detail ).toContain( 'executables' )
		expect( WriteGuard.permits( 'write', DOC, 'x'.repeat( WRITE_MAX_BYTES + 1 ) )?.detail ).toContain( 'KB' )
	} )
} )
