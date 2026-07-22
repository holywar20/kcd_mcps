/**
 * snapshot.ts — regenerate the committed tool snapshot.
 *
 * WHY THIS EXISTS ( 2026-07-22, Daedalus extraction ). This capability used to belong to
 * Starmind's `promote:mcp`, which discovered a server by finding a `StarmindServer`
 * subclass. Daedalus no longer extends that base, so promote can no longer see it — and
 * the snapshot is not optional: under lazy activation a host advertises this server's
 * tools FROM the committed snapshot while the process stays dormant, so a stale snapshot
 * means agents see a tool surface that no longer matches the code.
 *
 * Authoritative by construction: the payload comes from `wireTools()`, which is the exact
 * same projection `tools/list` sends over the wire. There is no second place where the
 * tool surface is described.
 *
 * Usage:  tsx src/scripts/snapshot.ts [outPath]
 *
 * Lives under `src/` rather than a sibling `scripts/` folder for two reasons: the package's
 * tsconfig has `rootDir: src`, so anything outside it is silently not type-checked; and the
 * CLI planned for this package will import `snapshotPayload()` directly rather than shelling
 * out. esbuild never bundles it into the server dist — the bundle follows imports from
 * `src/index.ts`, and nothing there reaches here.
 *
 * Default output is `tools.snapshot.json` at the package root — Daedalus's own copy, which
 * travels with the package. Pass an explicit path to ALSO write a host's plugin-folder copy
 * ( Starmind keeps one at `starmind/plugins/mcp/<id>/tools.snapshot.json` ). The format is
 * unchanged from what promote wrote, so an existing host consumer needs no adjustment.
 *
 * Exits non-zero on failure so a build or a check can gate on it. Reports a tool-count
 * change against the prior snapshot rather than swallowing it — a surface that changed
 * size is exactly the thing someone wants to notice.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { DaedalusServer } from '../server';

/** The snapshot payload — version-stamped so a consumer can tell which build produced it. */
export function snapshotPayload(): { version: string; tools: Record<string, unknown>[] } {
	const server = new DaedalusServer();
	return { version: DaedalusServer.manifest.version, tools: server.wireTools() };
}

/** The tools array from an existing snapshot, or null if absent or unreadable. Drift reporting only. */
function priorTools( path: string ): Record<string, unknown>[] | null {
	if ( !existsSync( path ) ) return null;
	try {
		const parsed = JSON.parse( readFileSync( path, 'utf8' ) ) as { tools?: Record<string, unknown>[] };
		return Array.isArray( parsed.tools ) ? parsed.tools : null;
	} catch {
		return null;
	}
}

function main(): void {
	const out     = resolve( process.argv[ 2 ] ?? resolve( __dirname, '..', 'tools.snapshot.json' ) );
	const payload = snapshotPayload();
	const prior   = priorTools( out );

	if ( prior && prior.length !== payload.tools.length ) {
		process.stdout.write( `  ⚠ tool surface changed since the last snapshot ( ${ prior.length } → ${ payload.tools.length } tools ) — committing the fresh one\n` );
	}

	mkdirSync( dirname( out ), { recursive: true } );
	writeFileSync( out, JSON.stringify( payload, null, '\t' ) + '\n' );
	process.stdout.write( `  snapshot: ${ payload.tools.length } tools → ${ out }\n` );
}

try {
	main();
} catch ( err ) {
	process.stderr.write( `snapshot: FAILED — ${ err instanceof Error ? err.message : String( err ) }\n` );
	process.exit( 1 );
}
