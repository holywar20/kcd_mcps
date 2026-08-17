import { rmSync, existsSync, statSync } from 'fs'
import { GuardChain, DeleteGuard } from '../guards'
import { MCPUtils } from '../MCPUtils'
import type { ToolDefinition, TestSpec } from 'kcd_sdk'

/** `reason` is the stable CODE a caller branches on; `detail` is the sentence it acts on. Same pair the
 *  write rows carry, for the same reason. */
type DeleteRow = { path: string; ok: boolean; reason?: string; detail?: string }

/**
 * delete — the batch file-delete lever, the destructive counterpart to `read`/`write`. N paths in one call,
 * per-item status, never all-or-nothing (a denied or missing path is data the model adapts to, not a thrown
 * error).
 *
 * Delete rides the WRITE surface: a path is deletable IFF it sits inside a WRITE-enabled root and clears the
 * secret blacklist — DeleteGuard gates every path on those two deny-by-default checks, so even a broad READ
 * whitelist grants no delete access until a root is write-opted-in. Reasons mirror write's vocabulary so the
 * model reads a refusal the same way: no_write_roots | outside_write_surface | out_of_scope | not_found |
 * is_directory | delete_failed | malformed. Files only — a directory is refused (is_directory), never
 * recursively removed.
 *
 * NOTE — CONTAINMENT ONLY. Whether a contained delete also requires the user's approval is decided one layer
 * up, host-side at the ToolGate (the Interaction Deck's delete gate), not in this handler. The tool declares
 * destructiveHint so the host knows to gate it, and otherwise stays a thin I/O gate.
 */
export function deleteTools( chain: GuardChain ): ( ToolDefinition & { spec?: TestSpec[] } )[] {
	return [
		{
			name:        'delete',
			annotations: { destructiveHint: true },
			spec: [
				{ label: 'structural fail when paths is missing', input: {}, assertions: [ { type: 'error_expected' } ] },
			],
			description: 'Batch-delete files. Severely limited: each path must sit inside a WRITE-enabled whitelist root (deletes ride the write surface, off until a root is opted in) and clear the secret blacklist. Files only. Returns { path, ok, reason?, detail? } per file — `reason` is a stable code, `detail` says what would make the delete succeed; one denied/missing path never fails the batch.',
			inputSchema: {
				type:       'object',
				properties: {
					paths: {
						type:        'array',
						items:       { type: 'string' },
						description: 'Absolute file paths to delete; each lands only if it clears every delete gate.',
					},
				},
				required: [ 'paths' ],
			},
			handler: async ( args, meta ) => {
				try {
					// Universal chain (no single `path` param on a batch tool, so the whitelist guard is a
					// no-op here); the real gating is DeleteGuard per item, so one bad path never sinks the batch.
					chain.run( { tool: 'delete', params: args } )

					const paths = args[ 'paths' ]
					if( !Array.isArray( paths ) ) {
						return MCPUtils.error( 'delete: "paths" must be an array of strings' )
					}

					const rows: DeleteRow[] = []
					for( const entry of paths ) {
						if( typeof entry !== 'string' || !entry ) {
							rows.push( { path: String( entry ?? '' ), ok: false, reason: 'malformed' } )
							continue
						}

						// `meta` reaches the guard for EXPLANATION only — `contain` still resolves against
					// configuration alone, which is what keeps a gesture structurally unable to reach this rung.
					const denial = DeleteGuard.permits( 'delete', entry, meta )
						if( denial ) {
							rows.push( { path: entry, ok: false, reason: denial.code, detail: denial.detail } )
							continue
						}

						// existsSync → statSync → rmSync in one try: a file vanishing mid-check, an unreadable
						// stat, or a failed unlink all degrade to a per-item reason, never sink the batch.
						try {
							if( !existsSync( entry ) ) {
								rows.push( { path: entry, ok: false, reason: 'not_found' } )
								continue
							}
							if( statSync( entry ).isDirectory() ) {
								rows.push( { path: entry, ok: false, reason: 'is_directory' } )
								continue
							}
							rmSync( entry )
							rows.push( { path: entry, ok: true } )
						} catch {
							rows.push( { path: entry, ok: false, reason: 'delete_failed' } )
						}
					}

					return MCPUtils.result( rows )
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) )
				}
			},
		},
	]
}
