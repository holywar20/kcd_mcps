import { StarmindServer } from 'kcd_sdk';
import type { ServerManifest } from 'kcd_sdk';
import { GuardChain, PathGuard } from './guards';
// bryan TODO - Research unification of tool surfaces using params.
import { discoveryTools } from './tools/discovery';
import { readTools } from './tools/read';
import { writeTools } from './tools/write';

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
			'over kcd_sdk: discovery (glob/list/search/types), reads (get/links/health), and writes ' +
			'(save/move/delete) — move and delete HEAL the link graph, so a rename rewrites every inbound ' +
			'reference and a delete cascades through every referrer. Every path is jailed to the vault by ' +
			'the PathGuard before any disk touch; reads are free, writes carry a destructive hint. ' +
			'Judgment lives in the model above and ' +
			'kcd_sdk beneath — these tools only gate I/O.',
	};

	private chain = new GuardChain( new PathGuard() );

	build(): void {
		const tools = [
			...discoveryTools( this.chain ),
			...readTools( this.chain ),
			...writeTools( this.chain ),
		];
		for ( const tool of tools ) this.registerTool( tool );
	}
}
