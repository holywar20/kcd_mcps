/**
 * Build script — esbuild bundles the server into a single self-contained dist/index.js.
 * kcd_sdk (StarmindServer + the hand-rolled, dep-free McpServer) is inlined; only Node
 * builtins stay external. Target node22: the CDP connector leans on Node 22 globals
 * (WebSocket, fetch), so the substrate carries zero third-party deps.
 */
const esbuild = require( 'esbuild' );

esbuild.buildSync({
	entryPoints: [ 'src/index.ts' ],
	bundle:      true,
	platform:    'node',
	target:      'node22',
	outfile:     'dist/index.js',
	sourcemap:   true,
});

console.log( 'build complete → dist/index.js (self-contained)' );
