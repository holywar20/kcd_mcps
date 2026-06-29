/**
 * HostConnector — the thin OS axis of the connector matrix.
 *
 * Locates/launches the browser and yields a CDP page-target WebSocket debugger URL; closes
 * what it started. Everything OS-specific lives behind this seam (Chrome already running →
 * dedicated profile, the debug port, native file dialogs). WindowsHost is the first impl
 * (Phase 1.e); a BrowserConnector stays OS-portable because everything above this line is
 * just CDP over a socket.
 */
export interface HostConnector {
	/** Launch/locate the browser and return its page-target WebSocket debugger URL. */
	launch(): Promise<string>;
	/** Tear down anything this host started (kill a spawned browser, remove a temp profile). */
	close(): Promise<void>;
}
