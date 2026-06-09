/**
 * Server configuration — hardcoded for the prototype.
 *
 * TODO: Replace with deployment config before the server is project-agnostic.
 *       A KCD project can live at any path on the user's machine; the MCP binary
 *       must not assume it lives near _Claude/. Likely shape: env var
 *       KCD_PROJECT_ROOT set by the Electron UI's deployment flow, or a settings
 *       file written at install time.
 */
export const CONFIG = {
	projectRoot: 'C:\\Code\\ContextManager',
	docRoot:     '_Claude',
};
