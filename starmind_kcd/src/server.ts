import { McpServer, runVerify } from './mcp';
import type { ServerManifest, ToolDefinition, ToolResult, Registration, TestSpec, VerifyReport } from './mcp';
import { GuardChain, PathGuard } from './guards';
import { MCPUtils } from './MCPUtils';
// bryan TODO - Research unification of tool surfaces using params.
import { discoveryTools } from './tools/discovery';
import { readTools } from './tools/read';
import { writeTools } from './tools/write';
import { batchTools } from './tools/batch';

/**
 * DaedalusServer — the Daedalus MCP server. ONE class, no base.
 *
 * A thin I/O gate exposing the KCD artifact tools over stdio. Judgment lives in the
 * model above and kcd_sdk beneath; these handlers only gate I/O.
 *
 * WHY THERE IS NO BASE CLASS ( 2026-07-22, Daedalus extraction ). This used to be
 * `KcdServer extends StarmindServer`, sharing a base with `starmind_file` and
 * `starmind_semantic_browser`. Daedalus is now its own project — a narrowly scoped
 * context compiler — and it will only ever possess THIS ONE server, so an abstract
 * base exists to serve a plurality it does not have. The base's useful parts
 * ( build / registerTool / ensureBuilt / run / invoke / wireTools / verify / liveDoc )
 * are folded in here directly. The wire itself stays its own module, `./mcp`, because
 * that genuinely is a separate concern.
 *
 * Consequence to know about: Starmind's `promote:mcp` identifies a server as "any
 * StarmindServer subclass exported from src/server.ts", so it can no longer discover
 * this one. That is intended — Daedalus is not a Starmind plugin — and the capability
 * it took with it ( snapshot regeneration, verification ) is replaced by this package's
 * own `scripts/snapshot.ts` and `scripts/verify.ts`, so neither is lost.
 */
export class DaedalusServer {

	/**
	 * Declared statically so tooling can inventory the server without constructing one.
	 * The lifecycle fields ( installed / exposed / entryPoint ) are Starmind interop and
	 * are deliberately kept — see `./mcp/manifest.ts`'s header.
	 *
	 * NOTE: `id` and `name` still carry the pre-Daedalus branding. The identity rename
	 * ( starmind_kcd → daedalus ) is its own step, because it re-keys Starmind's plugin
	 * registry, package-store slice, and committed snapshot all at once.
	 */
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

	private server:        McpServer;
	private registrations: Registration[] = [];
	private built          = false;
	private chain          = new GuardChain( new PathGuard() );

	constructor() {
		const m = DaedalusServer.manifest;
		this.server = new McpServer( { name: m.name, version: m.version } );
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────────

	/** Build the tool surface, then serve it on stdio until the client disconnects. */
	async run(): Promise<void> {
		this.ensureBuilt();
		await this.server.connect();
	}

	/** Prove every tool against its TestSpecs, in-process. Reached by `scripts/verify.ts`. */
	async verify(): Promise<VerifyReport> {
		this.ensureBuilt();
		return runVerify( this.registrations, DaedalusServer.manifest );
	}

	/**
	 * The built wire tool surface — the exact `tools/list` array, without spawning the server.
	 * Builds first ( idempotent ), then reads it off the underlying McpServer. This is what
	 * regenerates the committed tool snapshot, and what a `mcp tools` command prints.
	 */
	wireTools(): Record<string, unknown>[] {
		this.ensureBuilt();
		return this.server.listTools();
	}

	/**
	 * Run a registered tool in-process by name — the seam a COMPOSING tool ( the batch ) dispatches
	 * through to run other tools in sequence. Builds first ( idempotent ), then delegates to the
	 * McpServer's own dispatch, so an internal call obeys the exact same contract as a wire call.
	 */
	invoke( name: string, args: Record<string, unknown> ): Promise<ToolResult> {
		this.ensureBuilt();
		return this.server.invoke( name, args );
	}

	// ── Tool surface ──────────────────────────────────────────────────────────────

	/** Register every tool through one shared guard chain. Runs once, via ensureBuilt(). */
	private build(): void {
		const tools = [
			...discoveryTools( this.chain ),
			...readTools( this.chain ),
			...writeTools( this.chain ),
			// batch dispatches the others through the in-process invoke seam ( no guard chain of
			// its own — each dispatched call runs its own handler + PathGuard ).
			...batchTools( ( name, args ) => this.invoke( name, args ) ),
		];
		for ( const tool of tools ) this.registerTool( tool );
	}

	/**
	 * Register a tool and ( optionally ) the TestSpecs that verify it, in one call. The wire fields
	 * pass through to the McpServer; the spec is stashed for verify().
	 *
	 * House convention: the first verify input doubles as the tool's inspector sample — the example
	 * you prove a tool with is the example a user sees prepopulated. An explicit `example` on the def
	 * wins; otherwise borrow the first spec's input.
	 */
	private registerTool( def: ToolDefinition & { spec?: TestSpec[] } ): void {
		const { spec, ...tool } = def;
		const example = tool.example ?? spec?.[ 0 ]?.input;
		this.server.registerTool( example ? { ...tool, example } : tool );
		this.registrations.push( { def: tool, spec: spec ?? [] } );
	}

	private ensureBuilt(): void {
		if ( this.built ) return;
		this.build();
		this.built = true;
	}

	// ── Live doc ──────────────────────────────────────────────────────────────────

	/**
	 * The server's doc-block as served right now — generated fresh rather than frozen at
	 * author-time. Folds the live vault root and a fresh type census into the manifest's authored
	 * doc, so an agent that gets this server's doc already knows where the vault lives and roughly
	 * what is in it — a cheaper orientation than a kcd_query({ groupBy: 'type' }) round-trip. Read
	 * fresh each time ( MCPUtils.vault re-resolves config on access ), the same freshness contract
	 * every tool here uses.
	 */
	liveDoc(): string {
		const base  = DaedalusServer.manifest.doc ?? '';
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
