import { StarmindServer } from 'kcd_sdk';
import type { ServerManifest } from 'kcd_sdk';
import { GuardChain, PathGuard } from './guards';
import { MCPUtils } from './MCPUtils';
// bryan TODO - Research unification of tool surfaces using params.
import { discoveryTools } from './tools/discovery';
import { readTools } from './tools/read';
import { writeTools } from './tools/write';
import { batchTools } from './tools/batch';

/**
 * KcdServer — the KCD MCP server, and the first StarmindServer subclass.
 *
 * A thin I/O gate exposing the KCD artifact tools over stdio. build() collects
 * every tool factory and registers them through one shared guard chain; the base
 * (StarmindServer) owns the wire, verify(), and run(). Handlers stay thin —
 * judgment lives in kcd_sdk beneath and the model above.
 */
export class KcdServer extends StarmindServer {

	static manifest: ServerManifest = {
		id:          'starmind_kcd',
		name:        'KCD',
		version:     '0.1.0',
		entryPoint:  'dist/index.js',
		transport:   'stdio',
		credentials: [],
		installed:   false,
		exposed:     false,
		doc:
			'The KCD library gate — read/write access to the artifact vault (lenses, plans, habits, ' +
			'contracts, references, generators, analyzers, utilities, templates). A thin I/O surface ' +
			'over kcd_sdk: one query (kcd_query), reads (get/links/health), writes (save/move/delete), and a ' +
			'batch (kcd_batch) that runs an ordered sequence of calls in one shot. Move and delete HEAL the ' +
			'link graph — a rename rewrites every inbound reference, a delete cascades through every referrer. ' +
			'Every path is jailed to the vault by the PathGuard before any disk touch; reads are free, writes ' +
			'carry a destructive hint. Judgment lives in the model above and ' +
			'kcd_sdk beneath — these tools only gate I/O.',
	};

	private chain = new GuardChain( new PathGuard() );

	build(): void {
		const tools = [
			...discoveryTools( this.chain ),
			...readTools( this.chain ),
			...writeTools( this.chain ),
			// batch dispatches the others through the base's in-process invoke seam ( no guard chain of
			// its own — each dispatched call runs its own handler + PathGuard ).
			...batchTools( ( name, args ) => this.invoke( name, args ) ),
		];
		for ( const tool of tools ) this.registerTool( tool );
	}

	/**
	 * Folds the live vault root and a fresh type census into the base doc-block, so an agent that
	 * gets this server's doc already knows where the vault lives and roughly what's in it — a
	 * cheaper orientation than a kcd_query({ groupBy: 'type' }) round-trip. Read fresh each time
	 * (MCPUtils.vault re-resolves config on access), same freshness contract every tool here uses.
	 */
	liveDoc(): string {
		const base  = super.liveDoc();
		const vault = MCPUtils.vault;

		const counts: Record<string, number> = {};
		for ( const f of vault.scan() ) {
			const t = vault.classify( f.path );
			counts[ t ] = ( counts[ t ] ?? 0 ) + 1;
		}
		const census = Object.entries( counts )
			.sort( ( a, b ) => b[ 1 ] - a[ 1 ] )
			.map( ( [ type, count ] ) => `${ type }: ${ count }` )
			.join( ', ' );

		return `${ base }\n\nVault root (live): ${ vault.root }\nCensus (live): ${ census || 'empty' }`;
	}
}
