import { StarmindServer } from 'kcd_sdk'
import type { ServerManifest } from 'kcd_sdk'
import { GuardChain, WhitelistGuard } from './guards'
import { rootsTools } from './tools/roots'
import { listTools } from './tools/list'
import { readTools } from './tools/read'
import { globTools } from './tools/glob'
import { grepTools } from './tools/grep'
import { writeTools } from './tools/write'

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
		doc:         'Starmind File — whitelist-scoped read access to the local filesystem, plus a severely-limited write surface. `roots` surfaces the directories the user has whitelisted; `list`, `read`, `glob`, and `grep` explore and search within them; `write` saves files but ONLY inside roots the user has explicitly opted into writing (off by default), and only safe extensions under a size cap, never over a blacklisted secret. Every path is jailed to the whitelist, so an agent reads the project without roaming the disk and cannot write outside the narrow surface granted it.',
		// The config screen renders the bespoke 'file_access' surface (FileAccessPanel) under this package —
		// the whitelist (Off / Read / Write per root), the grep file cap, and the extra hidden-pattern list.
		// A list of records, so a bespoke surface, not flat fields. The panel writes the slice this server
		// reads fresh per call (loadConfig), so an edit takes effect with no respawn.
		config:      { surface: 'file_access' },
		installed:   false,
		exposed:     false,
	}

	/** One chokepoint for the agent surface. WhitelistGuard jails every path param on every tool
	 *  to the configured whitelist; tools (Phase 2) call this.chain.run(req) before touching disk.
	 *  Inert until the first tool lands — the slot is shaped and ready. */
	private chain = new GuardChain( new WhitelistGuard() )

	build(): void {
		// Path-bearing tools run this.chain (the whitelist jail) before disk; the blacklist is layered
		// on top per-tool in the agent surface (silent on discovery, vocal on direct read). `roots` is
		// argless discovery — it surfaces the whitelist so the agent need not guess paths.
		for( const tool of rootsTools() ) {
			this.registerTool( tool )
		}
		for( const tool of listTools( this.chain ) ) {
			this.registerTool( tool )
		}
		for( const tool of readTools( this.chain ) ) {
			this.registerTool( tool )
		}
		for( const tool of globTools( this.chain ) ) {
			this.registerTool( tool )
		}
		for( const tool of grepTools( this.chain ) ) {
			this.registerTool( tool )
		}
		// write — gated by WriteGuard per item (a far narrower surface than the read guards): off until a
		// root is write-opted-in, then extension/size/secret-checked. The chain runs first (universal), but
		// the real jail is WriteGuard inside the handler so one denied path never sinks the batch.
		for( const tool of writeTools( this.chain ) ) {
			this.registerTool( tool )
		}
	}
}
