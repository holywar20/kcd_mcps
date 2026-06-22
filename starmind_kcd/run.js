// Registers the tsx TypeScript hook, then loads the server entry point.
// This avoids needing `npx` (which requires a shell) and sidesteps the
// tsc OOM issue caused by MCP SDK's deep zod type graph.
require( 'tsx/cjs' );
require( './src/index.ts' );
