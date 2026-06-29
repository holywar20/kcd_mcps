import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostConnector } from './HostConnector';

/**
 * WindowsHost — the first HostConnector: launches Chrome on Windows and yields its CDP page-target
 * WebSocket debugger URL.
 *
 * Locates chrome.exe in the standard install paths, spawns it with a DEDICATED automation profile
 * (so it never touches the user's logged-in session — a data-safety property, not just hygiene) on a
 * private debug port, then polls the debug endpoint for the page target. `--remote-allow-origins=*`
 * is required for a non-browser CDP client since Chrome ~111. A LinuxHost / MacHost would differ only
 * here — everything above the HostConnector seam is plain CDP.
 */
export class WindowsHost implements HostConnector {

	private proc: ChildProcess | null = null;

	async launch(): Promise<string> {
		const chrome = CHROME_PATHS.find( ( p ) => p && existsSync( p ) );
		if ( !chrome ) throw new Error( 'Chrome not found in the standard Windows install locations' );
		this.proc = spawn( chrome, [
			`--remote-debugging-port=${ DEBUG_PORT }`,
			`--user-data-dir=${ PROFILE_DIR }`,
			'--remote-allow-origins=*',
			'--no-first-run',
			'--no-default-browser-check',
			'about:blank',
		], { stdio: 'ignore' } );
		return this.discover();
	}

	async close(): Promise<void> {
		try { this.proc?.kill(); } catch { /* already gone */ }
		this.proc = null;
	}

	/** Poll the debug endpoint until a page target appears; return its WS debugger URL. */
	private async discover(): Promise<string> {
		for ( let i = 0; i < 50; i++ ) {
			try {
				const targets = await ( await fetch( `http://127.0.0.1:${ DEBUG_PORT }/json/list` ) ).json() as { type: string; webSocketDebuggerUrl?: string }[];
				const page = targets.find( ( t ) => t.type === 'page' && t.webSocketDebuggerUrl );
				if ( page?.webSocketDebuggerUrl ) return page.webSocketDebuggerUrl;
			} catch { /* not up yet */ }
			await new Promise( ( r ) => setTimeout( r, 100 ) );
		}
		throw new Error( `no Chrome page target on debug port ${ DEBUG_PORT } after 5s` );
	}
}

const DEBUG_PORT  = 9357;
const PROFILE_DIR = join( tmpdir(), 'starmind_semantic_browser_profile' );
const CHROME_PATHS = [
	'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
	'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
	join( process.env[ 'LOCALAPPDATA' ] ?? '', 'Google\\Chrome\\Application\\chrome.exe' ),
];
