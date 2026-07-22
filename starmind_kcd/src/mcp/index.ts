/**
 * The vendored MCP wire — Daedalus's own copy of the server substrate, extracted from
 * `kcd_sdk/src/server/` on 2026-07-22 so the kit carries no import edge back into
 * Starmind. Read `./McpServer.ts`'s header before changing anything here; the copy is
 * deliberate and divergence from the Starmind original is expected, not a defect.
 *
 * NOT vendored: `StarmindServer`. Its useful parts ( build/registerTool/run/invoke/
 * wireTools/verify/liveDoc ) fold directly into the one Daedalus server class instead
 * of arriving as a base to extend. Daedalus will only ever possess a single MCP
 * server, so a base class exists to serve a plurality it does not have.
 */
export { McpServer } from './McpServer';
export type { ContentBlock, ToolResult, ToolAnnotations, ToolDefinition, ServerInfo } from './McpServer';
export { runVerify } from './verify';
export type { Registration, TestSpec, VerifyReport } from './verify';
export type { ServerManifest, ServerConfigSurface, ServerConfigField } from './manifest';
