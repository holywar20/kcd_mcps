import { GuardChain } from '../guards'
import { MCPUtils } from '../MCPUtils'
import type { ToolDefinition, TestSpec } from 'kcd_sdk'

type ListRow = { path: string; isDir: boolean; size: number; mtime: number }

/**
 * list — directory discovery within the whitelist. The cheap primitive the agent loop starts from
 * (discover -> operate) and the seam an index (Phase 4) later aggregates. Read-only; the row shape
 * stays lean ({ path, isDir, size, mtime }) for token economy.
 */
export function listTools( chain: GuardChain ): ( ToolDefinition & { spec?: TestSpec[] } )[] {
	return [
		{
			name:        'list',
			annotations: { readOnlyHint: true },
			spec: [
				{ label: 'rejects a non-whitelisted path', input: { path: 'C:\\Windows\\System32' }, assertions: [ { type: 'error_expected' } ] },
			],
			description: 'List a directory within the whitelist. Returns { path, isDir, size, mtime } per entry, directories first.',
			inputSchema: {
				type:       'object',
				properties: { path: { type: 'string', description: 'Absolute directory path to list; must sit inside a whitelisted root.' } },
				required:   [ 'path' ],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'list', params: args } )

					const path    = String( args[ 'path' ] ?? '' )
					const entries = MCPUtils.files.list( path )

					const rows: ListRow[] = []
					for( const entry of entries ) {
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
