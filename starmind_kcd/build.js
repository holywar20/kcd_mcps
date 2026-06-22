/**
 * Build script — esbuild bundles the server into a single self-contained dist/index.js.
 *
 * Everything the server needs is inlined: kcd_sdk (and its js-yaml) are bundled in, so the
 * promoted plugin folder carries no node_modules. Only Node builtins (fs, path, …) stay
 * external — platform:'node' marks them external automatically.
 *
 * esbuild (not tsc): it strips types without type-checking, sidestepping the historical tsc
 * OOM on deep generic graphs, and it bundles kcd_sdk's CJS dist cleanly — the export* interop
 * problem that forces the @kcd *source* alias on the main side is a Vite/Rollup issue, not an
 * esbuild one.
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
