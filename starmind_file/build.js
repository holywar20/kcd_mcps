/**
 * Build script — esbuild bundles the server into a single self-contained dist/index.js.
 * kcd_sdk is inlined; only Node builtins stay external.
 */
const esbuild = require( 'esbuild' );

esbuild.buildSync({
	entryPoints: [ 'src/index.ts' ],
	bundle:      true,
	platform:    'node',
	target:      'node20',
	outfile:     'dist/index.js',
	sourcemap:   true,
});

console.log( 'build complete → dist/index.js (self-contained)' );
