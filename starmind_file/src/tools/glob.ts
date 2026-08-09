import { GuardChain } from '../guards'
import { MCPUtils } from '../MCPUtils'
import { Blacklist } from '../Blacklist'
import type { ToolDefinition, TestSpec } from 'kcd_sdk'

type GlobRow = { path: string; isDir: boolean; size: number; mtime: number }

/**
 * glob — pattern-based discovery under a whitelisted root: the deliberate divergence from the
 * single-path text-editor tool. One call finds files (or directories) instead of walking with N
 * `list`s. The root is jailed by the chain (single path, all-or-nothing); matching + caps live in
 * the shared core. Cap overflows are made safe in the core and bubble to the WARNINGS trace channel.
 */
export function globTools( chain: GuardChain ): ( ToolDefinition & { spec?: TestSpec[] } )[] {
	return [
		{
			name:        'glob',
			annotations: { readOnlyHint: true },
			spec: [
				{ label: 'rejects a non-whitelisted root', input: { path: 'C:\\Windows\\System32', pattern: '**/*' }, assertions: [ { type: 'error_expected' } ] },
			],
			description: 'Find files and directories under a whitelisted root whose relative path matches a glob (* within a segment, ** across). Returns { path, isDir, size, mtime } per match.',
			inputSchema: {
				type:       'object',
				properties: {
					path:    { type: 'string', description: 'Absolute root directory to search under; must sit inside a whitelisted root.' },
					pattern: { type: 'string', description: 'Glob over paths relative to the root: * within a segment, ** across segments (e.g. "**/*.ts").' },
				},
				required:   [ 'path', 'pattern' ],
			},
			handler: async ( args, meta ) => {
				try {
					// `meta` is forwarded opaque — the guard reads the grants off it, this handler never does.
					chain.run( { tool: 'glob', params: args, meta } )

					const path    = String( args[ 'path' ] ?? '' )
					const pattern = String( args[ 'pattern' ] ?? '' )
					const matches = MCPUtils.files.glob( path, pattern )

					// Blacklisted matches are dropped SILENTLY — pattern discovery must not surface a
					// denied path (same rule as list; the vocal path is a direct read → out_of_scope).
					const rows: GlobRow[] = []
					for( const entry of matches ) {
						if( Blacklist.excludes( entry.path ) ) {
							continue
						}
						rows.push( {
							path:  entry.path,
							isDir: entry.isDir,
							size:  entry.size,
							mtime: entry.mtime,
						} )
					}

					return MCPUtils.result( rows )
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) )
				}
			},
		},
	]
}
