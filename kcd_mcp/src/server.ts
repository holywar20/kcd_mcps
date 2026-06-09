import { StarmindServer } from 'kcd_sdk';
import type { ServerManifest } from 'kcd_sdk';
import { GuardChain, PathGuard } from './guards';
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
		id:          'kcd',
		name:        'KCD',
		version:     '0.1.0',
		entryPoint:  'dist/index.js',
		transport:   'stdio',
		credentials: [],
		installed:   false,
		exposed:     false,
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
