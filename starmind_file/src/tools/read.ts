import { SdkFileAccess } from 'kcd_sdk'
import { GuardChain, WhitelistGuard } from '../guards'
import { MCPUtils } from '../MCPUtils'
import type { ToolDefinition, TestSpec } from 'kcd_sdk'

type ReadRow = { path: string; ok: boolean; content?: string; reason?: string }

/**
 * read — the batch multi-file lever (the key divergence from the single-path text-editor tool):
 * N paths in one call. Per-item status, never all-or-nothing — a bad path is data the model adapts
 * to (absence-is-not-failure), not a thrown error. WhitelistGuard.permits() jails EVERY path (the
 * canonical containment check); the resource floors + text gate come from the shared SdkFileAccess
 * core, whose degrade-warning tells us WHY a read returned nothing.
 */
export function readTools( chain: GuardChain ): ( ToolDefinition & { spec?: TestSpec[] } )[] {
	return [
		{
			name:        'read',
			annotations: { readOnlyHint: true },
			spec: [
				{ label: 'structural fail when paths is missing', input: {}, assertions: [ { type: 'error_expected' } ] },
			],
			description: 'Batch-read text files. Returns { path, ok, content?, reason? } per path; one bad path never fails the batch (reason: outside_whitelist | not_found | too_large | binary).',
			inputSchema: {
				type:       'object',
				properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths to read; each must sit inside a whitelisted root.' } },
				required:   [ 'paths' ],
			},
			handler: async ( args ) => {
				try {
					// Universal guards run here; the path-jail is per-item below so one bad path in the
					// batch returns a reason instead of throwing the whole call.
					chain.run( { tool: 'read', params: args } )

					const paths = args[ 'paths' ]
					if( !Array.isArray( paths ) ) {
						return MCPUtils.error( 'read: "paths" must be an array of strings' )
					}

					// A capturing core instance: onWarn records WHY a read returned null, so the reason
					// comes from the shared core — never re-derived in the tool, so it can never drift.
					let lastWarn = ''
					const files  = new SdkFileAccess( ( event ) => { lastWarn = event } )

					const rows: ReadRow[] = []
					for( const entry of paths ) {
						if( typeof entry !== 'string' ) {
							continue
						}

						if( !WhitelistGuard.permits( 'read', entry ) ) {
							rows.push( { path: entry, ok: false, reason: 'outside_whitelist' } )
							continue
						}

						lastWarn = ''
						const content = files.read( entry )
						if( content === null ) {
							rows.push( { path: entry, ok: false, reason: reasonFor( lastWarn ) } )
							continue
						}

						rows.push( { path: entry, ok: true, content } )
					}

					return MCPUtils.result( rows )
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) )
				}
			},
		},
	]
}

/** Map the shared core's degrade-warning to the tool's per-file result vocabulary. */
function reasonFor( warn: string ): string {
	if( warn === 'read_skipped_nontext' ) {
		return 'binary'
	}
	if( warn === 'read_too_large' ) {
		return 'too_large'
	}
	return 'not_found'   // read_failed (missing / unreadable) or no warn
}
