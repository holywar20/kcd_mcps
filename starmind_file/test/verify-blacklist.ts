/**
 * Behavioral harness for the blacklist + grep surface (run with `npx tsx test/verify-blacklist.ts`).
 * Plants a fixture tree with a real secret (.env) and a nested .ssh/id_rsa, points the package-store
 * env at a temp slice whitelisting the fixture root, and drives the LIVE tool handlers to prove the
 * behavioral guarantees the in-process spec runner can't express (fixtures + array contents): silent
 * omit on discovery, vocal out_of_scope on direct read, subtree hiding, grep never reading a denied
 * file, and the case/word flags. Kept as a working double for later automation (Test* idiom).
 */
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const ROOT  = join( tmpdir(), 'starmind_file_verify' )
const STORE = join( tmpdir(), 'starmind_file_verify_store.json' )

// Fixture must exist + env must be set BEFORE importing the tools (config reads the env per call, but
// set it up front so nothing races). The store whitelists ROOT; the default deny-list does the rest.
rmSync( ROOT, { recursive: true, force: true } )
mkdirSync( join( ROOT, 'sub', '.ssh' ), { recursive: true } )
writeFileSync( join( ROOT, 'keep.txt' ),            'alpha secret token beta\nplain line\nSECRET upper\n' )
writeFileSync( join( ROOT, 'notes.md' ),            'another secret token here\n' )
writeFileSync( join( ROOT, '.env' ),               'API_KEY=secret token xyz\n' )
writeFileSync( join( ROOT, 'sub', 'code.ts' ),      "const x = 'secret token'\nfoobar\n" )
writeFileSync( join( ROOT, 'sub', '.ssh', 'id_rsa' ), 'secret token PRIVATE\n' )
writeFileSync( STORE, JSON.stringify( { whitelist: [ { path: ROOT, enabled: true } ] } ) )
process.env[ 'STARMIND_PACKAGE_STORE' ] = STORE

import { GuardChain, WhitelistGuard } from '../src/guards'
import { rootsTools } from '../src/tools/roots'
import { listTools }  from '../src/tools/list'
import { globTools }  from '../src/tools/glob'
import { grepTools }  from '../src/tools/grep'
import { readTools }  from '../src/tools/read'

const chain = new GuardChain( new WhitelistGuard() )
const roots = rootsTools()[ 0 ]
const list  = listTools( chain )[ 0 ]
const glob  = globTools( chain )[ 0 ]
const grep  = grepTools( chain )[ 0 ]
const read  = readTools( chain )[ 0 ]

let passed = 0
let failed = 0
function ok( label: string, cond: boolean, detail?: unknown ): void {
	if( cond ) { passed += 1; console.log( `  PASS  ${ label }` ) }
	else       { failed += 1; console.log( `  FAIL  ${ label }`, detail ?? '' ) }
}

async function call( def: { handler: ( a: Record<string, unknown> ) => Promise<{ content: { text: string }[]; isError?: boolean }> }, input: Record<string, unknown> ): Promise<{ isError: boolean; data: unknown; text: string }> {
	const res  = await def.handler( input )
	const text = res.content[ 0 ]?.text ?? ''
	let   data: unknown = null
	try { data = JSON.parse( text ) } catch { /* error text, not json */ }
	return { isError: res.isError === true, data, text }
}

const paths = ( rows: unknown ): string[] => Array.isArray( rows ) ? rows.map( ( r ) => String( ( r as { path: string } ).path ) ) : []
const has   = ( ps: string[], suffix: string ): boolean => ps.some( ( p ) => p.replace( /\\/g, '/' ).endsWith( suffix ) )
const any   = ( ps: string[], frag: string ): boolean => ps.some( ( p ) => p.replace( /\\/g, '/' ).includes( frag ) )

async function main(): Promise<void> {
	console.log( '\nstarmind_file — blacklist + grep verification\n' )

	// 1. roots surfaces only the enabled whitelist
	const r = await call( roots, {} )
	ok( 'roots returns the whitelisted root', JSON.stringify( ( r.data as { roots: string[] } ).roots ) === JSON.stringify( [ ROOT ] ), r.data )

	// 2. list silently omits the .env
	const l = paths( ( await call( list, { path: ROOT } ) ).data )
	ok( 'list shows keep.txt',        has( l, '/keep.txt' ), l )
	ok( 'list shows sub dir',         has( l, '/sub' ), l )
	ok( 'list SILENTLY omits .env',   !has( l, '/.env' ), l )

	// 3. glob silently omits the .env and the whole .ssh subtree
	const g = paths( ( await call( glob, { path: ROOT, pattern: '**' } ) ).data )
	ok( 'glob finds sub/code.ts',         has( g, '/sub/code.ts' ), g )
	ok( 'glob omits .env',                !has( g, '/.env' ), g )
	ok( 'glob omits .ssh subtree',        !any( g, '/.ssh' ), g )

	// 4. grep matches legit files, never the blacklisted ones (it never even reads them)
	const gr = paths( ( await call( grep, { path: ROOT, query: 'secret token' } ) ).data )
	ok( 'grep matches keep.txt',          has( gr, '/keep.txt' ), gr )
	ok( 'grep matches notes.md',          has( gr, '/notes.md' ), gr )
	ok( 'grep matches sub/code.ts',       has( gr, '/sub/code.ts' ), gr )
	ok( 'grep NEVER hits .env',           !has( gr, '/.env' ), gr )
	ok( 'grep NEVER hits id_rsa',         !any( gr, 'id_rsa' ), gr )

	// 5. read is VOCAL on a directly-named blacklisted path
	const rdEnv = ( await call( read, { paths: [ join( ROOT, '.env' ) ] } ) ).data as { ok: boolean; reason?: string }[]
	ok( 'read(.env) → out_of_scope',      rdEnv[ 0 ]?.ok === false && rdEnv[ 0 ]?.reason === 'out_of_scope', rdEnv )

	const rdKeep = ( await call( read, { paths: [ join( ROOT, 'keep.txt' ) ] } ) ).data as { ok: boolean; content?: string }[]
	ok( 'read(keep.txt) → ok with content', rdKeep[ 0 ]?.ok === true && String( rdKeep[ 0 ]?.content ).includes( 'secret token' ), rdKeep )

	// 6. subtree: a file under a blacklisted .ssh dir is out_of_scope even though .ssh isn't the leaf
	const rdKey = ( await call( read, { paths: [ join( ROOT, 'sub', '.ssh', 'id_rsa' ) ] } ) ).data as { ok: boolean; reason?: string }[]
	ok( 'read(sub/.ssh/id_rsa) → out_of_scope (subtree)', rdKey[ 0 ]?.reason === 'out_of_scope', rdKey )

	// 7. caseInsensitive flag
	const ciOff = paths( ( await call( grep, { path: ROOT, query: 'SECRET token' } ) ).data )
	const ciOn  = paths( ( await call( grep, { path: ROOT, query: 'SECRET token', caseInsensitive: true } ) ).data )
	ok( 'grep case-sensitive misses lowercase', !has( ciOff, '/keep.txt' ), ciOff )
	ok( 'grep caseInsensitive hits it',         has( ciOn, '/keep.txt' ), ciOn )

	// 8. wholeWord flag — "secre" is a substring of "secret" but not a whole word
	const wwOff = paths( ( await call( grep, { path: ROOT, query: 'secre' } ) ).data )
	const wwOn  = paths( ( await call( grep, { path: ROOT, query: 'secre', wholeWord: true } ) ).data )
	ok( 'grep substring hits (wholeWord off)',  has( wwOff, '/keep.txt' ), wwOff )
	ok( 'grep wholeWord rejects partial',       !has( wwOn, '/keep.txt' ), wwOn )

	console.log( `\n${ passed } passed, ${ failed } failed\n` )
	rmSync( ROOT, { recursive: true, force: true } )
	rmSync( STORE, { force: true } )
	process.exit( failed === 0 ? 0 : 1 )
}

main()
