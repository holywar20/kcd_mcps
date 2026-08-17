import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

/**
 * The file server's test harness — new 2026-08-09, because this package held three security guards and
 * had no way to assert anything about them.
 *
 * `kcd_sdk` is ALIASED TO SOURCE rather than resolved through node_modules. The dependency is a symlink
 * to the sibling repository whose `main` points at `dist/`, so the default resolution would test whatever
 * was last built there — and a suite that goes green against a stale build of the containment primitive is
 * worse than no suite. Starmind's own config aliases the same way for the same reason.
 *
 * Bare node, no setup file. Every rule under test is path math plus a config parse; the one input that is
 * not pure is the package-store slice, which is a real file by design ( the server re-reads it per call ),
 * so the tests write a real one. See TestSlice.
 */
export default defineConfig( {
	resolve: {
		alias: {
			kcd_sdk: resolve( __dirname, '..', '..', 'kcd_sdk', 'src', 'index.ts' )
		}
	},
	test: {
		name:        'starmind_file',
		environment: 'node',
		include:     [ 'src/**/*.test.ts' ]
	}
} )
