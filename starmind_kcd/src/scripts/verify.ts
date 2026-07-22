/**
 * verify.ts — prove every tool against its attached TestSpecs, in-process.
 *
 * WHY THIS EXISTS ( 2026-07-22, Daedalus extraction ). Verification used to be reached
 * only through Starmind's `promote:mcp`, which gated promotion on a passing report.
 * Daedalus no longer extends `StarmindServer`, so promote can no longer discover it —
 * and without a runner the vendored `src/mcp/verify.ts` would become dead code the same
 * day its own header argues it is load-bearing. This is that runner.
 *
 * Usage:  tsx src/scripts/verify.ts [--json]
 *
 * Lives under `src/` so the package's `rootDir: src` tsconfig actually type-checks it, and so
 * the planned CLI can call `verify()` directly rather than shelling out. Note there are now two
 * files named verify.ts: `src/mcp/verify.ts` is the engine, this is the runner that reaches it.
 *
 * Exits 0 when every case passes, 1 otherwise, so a build, a hook, or a check can gate
 * on it. `--json` emits the raw VerifyReport for a machine consumer; the default is a
 * human read.
 *
 * No transport is involved — handlers run directly, and a handler that throws folds into
 * an isError result exactly as it would on the wire, so a passing report here means the
 * same thing it would mean over stdio.
 */
import { DaedalusServer } from '../server';
import type { VerifyReport } from '../mcp';

function render( report: VerifyReport ): string {
	const lines: string[] = [];
	lines.push( `${ report.server_id } v${ report.version } — ${ report.timestamp }` );

	for ( const tool of report.tools ) {
		if ( tool.cases.length === 0 ) {
			lines.push( `  ·  ${ tool.name } — no specs` );
			continue;
		}
		const mark = tool.failed === 0 ? '✓' : '✗';
		lines.push( `  ${ mark }  ${ tool.name } — ${ tool.passed }/${ tool.cases.length }` );
		for ( const c of tool.cases ) {
			if ( c.pass ) continue;
			lines.push( `       ✗ ${ c.label }${ c.detail ? ` — ${ c.detail }` : '' }` );
		}
	}

	const specced = report.tools.filter( ( t ) => t.cases.length > 0 ).length;
	lines.push( '' );
	lines.push( `${ report.overall.toUpperCase() } — ${ specced }/${ report.tools.length } tools carry specs` );
	return lines.join( '\n' );
}

async function main(): Promise<void> {
	const json   = process.argv.includes( '--json' );
	const report = await new DaedalusServer().verify();

	process.stdout.write( ( json ? JSON.stringify( report, null, '\t' ) : render( report ) ) + '\n' );
	if ( report.overall !== 'pass' ) process.exit( 1 );
}

main().catch( ( err ) => {
	process.stderr.write( `verify: FAILED — ${ err instanceof Error ? err.message : String( err ) }\n` );
	process.exit( 1 );
} );
