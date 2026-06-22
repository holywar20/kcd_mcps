import { StarmindServer } from 'kcd_sdk'
import type { ServerManifest } from 'kcd_sdk'
import { GuardChain, WhitelistGuard } from './guards'
import { listTools } from './tools/list'
import { readTools } from './tools/read'
import { globTools } from './tools/glob'

/**
 * StarmindFileServer — whitelist-scoped filesystem read access for agents.
 *
 * A thin I/O gate over the local filesystem, bounded to directories the user
 * explicitly whitelists through the paired control widget. The whitelist is read
 * fresh from the package store on every tool call — a config change takes effect
 * immediately with no server respawn.
 *
 * Tools are added one at a time (see Phase 4.c). The skeleton connects and serves
 * an empty tool surface so the integration can be verified end-to-end before any
 * tool logic lands.
 */
export class StarmindFileServer extends StarmindServer {

	static manifest: ServerManifest = {
		id:          'starmind_file',
		name:        'Starmind File',
		version:     '0.1.0',
		entryPoint:  'dist/index.js',
		transport:   'stdio',
		credentials: [],
		installed:   false,
		exposed:     false,
	}

	/** One chokepoint for the agent surface. WhitelistGuard jails every path param on every tool
	 *  to the configured whitelist; tools (Phase 2) call this.chain.run(req) before touching disk.
	 *  Inert until the first tool lands — the slot is shaped and ready. */
	private chain = new GuardChain( new WhitelistGuard() )

	build(): void {
		// Tools registered one at a time as Phase 2 proceeds; each runs this.chain before disk.
		for( const tool of listTools( this.chain ) ) {
			this.registerTool( tool )
		}
		for( const tool of readTools( this.chain ) ) {
			this.registerTool( tool )
		}
		for( const tool of globTools( this.chain ) ) {
			this.registerTool( tool )
		}
	}
}
