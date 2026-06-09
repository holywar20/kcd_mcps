/**
 * Build script — uses esbuild instead of tsc.
 * tsc OOMs on the MCP SDK's zod type graph; esbuild strips types without checking them.
 * All node_modules (kcd_sdk, @modelcontextprotocol/sdk, zod) stay external —
 * dist/index.js requires them at runtime from node_modules.
 */
const esbuild = require( 'esbuild' );

esbuild.buildSync({
	entryPoints: [ 'src/index.ts' ],
	bundle:      true,
	platform:    'node',
	packages:    'external',
	outfile:     'dist/index.js',
	sourcemap:   true,
});

console.log( 'build complete → dist/index.js' );
