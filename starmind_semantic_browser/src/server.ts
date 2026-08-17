import { StarmindServer } from 'kcd_sdk';
import type { ServerManifest } from 'kcd_sdk';
import { browserTools } from './tools';
import { ChromeConnector } from './connectors/ChromeConnector';
import { WindowsHost } from './connectors/WindowsHost';
import { GuardedSession } from './GuardedSession';
import { GuardChain, OriginWhitelistGuard, TierGuard } from './guards';
import { loadConfig } from './config';

/**
 * SemanticBrowserServer — the semantic-browser MCP server, a StarmindServer subclass.
 *
 * A thin I/O gate that lets an agent drive a whitelisted web page by *meaning*, not
 * pixels: navigate to an allowed origin, read the page distilled to the elements that
 * matter, and act (click / type) on an element by ref. Everything runs over the Chrome
 * DevTools Protocol behind hot-swappable Browser × Host connectors; every URL is jailed
 * to a whitelisted origin before any navigation or action. Judgment lives in the model
 * above — these tools only see and act.
 *
 * The tool surface is defined in `tools.ts` (Phase 1.b): navigate · read_page · read_raw ·
 * click · type, over a BrowserSession seam. build() registers it once a concrete session
 * exists — the connectors (Phase 1.d/e) and session/page-state model (Phase 1.c) land next,
 * then 1.f wires `browserTools( session )` here; the origin guard chain follows in Phase 3.
 */
export class SemanticBrowserServer extends StarmindServer {

	static manifest: ServerManifest = {
		id:          'starmind_semantic_browser',
		name:        'Semantic Browser',
		version:     '0.1.0',
		entryPoint:  'dist/index.js',
		transport:   'stdio',
		credentials: [],
		installed:   false,
		exposed:     false,
		// The config screen renders this package's whitelist editor — the bespoke 'semantic_browser' surface
		// (origin rows + per-origin read/act tier + the set-of-marks overlay toggle), writing the same slice
		// loadConfig() reads. A bespoke surface, not flat fields: the origin whitelist is a list of records.
		config:      { surface: 'semantic_browser' },
		doc:
			'The semantic-browser gate — drive a whitelisted web page by meaning, not pixels. ' +
			'navigate to an allowed origin; read_page returns a distilled, ref-bearing list of the ' +
			'elements that matter (read_raw is the slow full-HTML escape hatch); click / type act on ' +
			'an element by ref. All over the Chrome DevTools Protocol behind hot-swappable Browser × ' +
			'Host connectors, with every URL jailed to a whitelisted origin before any action. ' +
			'Judgment lives in the model above; these tools only see and act.',
	};

	build(): void {
		// The session, lazily over Chrome — wrapped in the origin guard chain. Construction is cheap:
		// Chrome launches on the first tool call (ensure()), not at build time. `overlay` reads fresh
		// from config each distil (so the widget's toggle is live). GuardedSession runs OriginWhitelistGuard
		// → TierGuard against the URL in play before every op, denying any non-whitelisted origin and any
		// click/type on a read-tier origin — secure by default (empty whitelist = reaches nothing).
		const connector = new ChromeConnector( new WindowsHost(), { overlay: () => loadConfig().overlay } );
		const chain     = new GuardChain( new OriginWhitelistGuard(), new TierGuard() );
		const session   = new GuardedSession( connector, chain );
		for ( const tool of browserTools( session ) ) this.registerTool( tool );
	}
}
