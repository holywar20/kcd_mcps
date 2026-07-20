/**
 * Behavioral harness for the delete surface (run with `npx tsx test/verify-delete.ts`). Plants a fixture
 * tree under a WRITE-enabled root and a second READ-only root, points the package-store env at a temp slice,
 * and drives the LIVE delete handler to prove the containment guarantees the in-process spec runner can't
 * express (real files removed, real files preserved): delete inside a write root succeeds and the file is
 * actually gone; a read-only root, a blacklisted secret, a directory, and a missing path are each refused
 * per-item without sinking the batch; and with NO write root, every delete is refused (the severe default).
 * Kept as a working double for later automation (Test* idiom), mirroring verify-blacklist.ts.
 */
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const WROOT = join( tmpdir(), 'starmind_file_delverify_w' )   // write-enabled
const RROOT = join( tmpdir(), 'starmind_file_delverify_r' )   // read-only (enabled, not write)
const STORE = join( tmpdir(), 'starmind_file_delverify_store.json' )

/** Plant a clean fixture tree + a store slice with the two roots. Called before each config posture. */
function plant( writeEnabled: boolean ): void {
	rmSync( WROOT, { recursive: true, force: true } )
	rmSync( RROOT, { recursive: true, force: true } )
	mkdirSync( join( WROOT, 'nested' ), { recursive: true } )
	mkdirSync( RROOT, { recursive: true } )
	writeFileSync( join( WROOT, 'gone.txt' ),   'delete me\n' )
	writeFileSync( join( WROOT, 'keep.txt' ),   'survive\n' )
	writeFileSync( join( WROOT, '.env' ),       'API_KEY=secret\n' )
	writeFileSync( join( RROOT, 'safe.txt' ),   'do not delete\n' )
	writeFileSync( STORE, JSON.stringify( {
		whitelist: [
			{ path: WROOT, enabled: true, write: writeEnabled },
			{ path: RROOT, enabled: true, write: false },
		],
	} ) )
	process.env[ 'STARMIND_PACKAGE_STORE' ] = STORE
}

plant( true )   // env + fixture must exist BEFORE importing the tool (config reads the env per call)

import { GuardChain, WhitelistGuard } from '../src/guards'
import { deleteTools } from '../src/tools/delete'

const chain = new GuardChain( new WhitelistGuard() )
const del   = deleteTools( chain )[ 0 ]

let passed = 0
let failed = 0
function ok( label: string, cond: boolean, detail?: unknown ): void {
	if( cond ) { passed += 1; console.log( `  PASS  ${ label }` ) }
	else       { failed += 1; console.log( `  FAIL  ${ label }`, detail ?? '' ) }
}

type Row = { path: string; ok: boolean; reason?: string }
async function call( input: Record<string, unknown> ): Promise<{ isError: boolean; rows: Row[] }> {
	const res  = await del.handler( input )
	const text = res.content[ 0 ]?.text ?? ''
	let   rows: Row[] = []
	try { rows = JSON.parse( text ) } catch { /* error text, not json */ }
	return { isError: res.isError === true, rows }
}

async function main(): Promise<void> {
	console.log( '\nstarmind_file — delete verification\n' )

	// 1. delete a real file inside the write-enabled root → ok, and it is ACTUALLY gone
	const one = await call( { paths: [ join( WROOT, 'gone.txt' ) ] } )
	ok( 'delete(gone.txt) → ok',            one.rows[ 0 ]?.ok === true, one.rows )
	ok( 'gone.txt is actually removed',     !existsSync( join( WROOT, 'gone.txt' ) ) )

	// 2. a read-only root is outside the write/delete surface → refused, file preserved
	const ro = await call( { paths: [ join( RROOT, 'safe.txt' ) ] } )
	ok( 'delete(read-only root) → outside_write_surface', ro.rows[ 0 ]?.reason === 'outside_write_surface', ro.rows )
	ok( 'safe.txt preserved',               existsSync( join( RROOT, 'safe.txt' ) ) )

	// 3. a blacklisted secret is never deletable, even inside a write root → out_of_scope, preserved
	const secret = await call( { paths: [ join( WROOT, '.env' ) ] } )
	ok( 'delete(.env) → out_of_scope',      secret.rows[ 0 ]?.reason === 'out_of_scope', secret.rows )
	ok( '.env preserved',                   existsSync( join( WROOT, '.env' ) ) )

	// 4. a directory is refused (files only, never recursive)
	const dir = await call( { paths: [ join( WROOT, 'nested' ) ] } )
	ok( 'delete(dir) → is_directory',       dir.rows[ 0 ]?.reason === 'is_directory', dir.rows )
	ok( 'nested dir preserved',             existsSync( join( WROOT, 'nested' ) ) )

	// 5. a missing path → not_found
	const missing = await call( { paths: [ join( WROOT, 'nope.txt' ) ] } )
	ok( 'delete(missing) → not_found',      missing.rows[ 0 ]?.reason === 'not_found', missing.rows )

	// 6. one denied path never sinks the batch — mixed [good, secret, missing]
	const batch = await call( { paths: [ join( WROOT, 'keep.txt' ), join( WROOT, '.env' ), join( WROOT, 'nope.txt' ) ] } )
	ok( 'batch: keep.txt deleted',          batch.rows[ 0 ]?.ok === true, batch.rows )
	ok( 'batch: .env out_of_scope',         batch.rows[ 1 ]?.reason === 'out_of_scope', batch.rows )
	ok( 'batch: nope.txt not_found',        batch.rows[ 2 ]?.reason === 'not_found', batch.rows )
	ok( 'batch: keep.txt actually gone',    !existsSync( join( WROOT, 'keep.txt' ) ) )

	// 7. with NO write-enabled root, every delete is refused — the severe default
	plant( false )
	const noWrite = await call( { paths: [ join( WROOT, 'keep.txt' ) ] } )
	ok( 'no write root → no_write_roots',   noWrite.rows[ 0 ]?.reason === 'no_write_roots', noWrite.rows )
	ok( 'keep.txt preserved (no write root)', existsSync( join( WROOT, 'keep.txt' ) ) )

	console.log( `\n${ passed } passed, ${ failed } failed\n` )
	rmSync( WROOT, { recursive: true, force: true } )
	rmSync( RROOT, { recursive: true, force: true } )
	rmSync( STORE, { force: true } )
	process.exit( failed === 0 ? 0 : 1 )
}

main()
