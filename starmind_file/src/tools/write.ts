import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { GuardChain, WriteGuard } from '../guards'
import { MCPUtils } from '../MCPUtils'
import type { ToolDefinition, TestSpec } from 'kcd_sdk'

type WriteRow = { path: string; ok: boolean; reason?: string }
type WriteItem = { path: string; content: string }

/**
 * write — the batch file-write lever, the writing counterpart to `read`. N files in one call, per-item
 * status, never all-or-nothing (a denied path is data the model adapts to, not a thrown error).
 *
 * The write surface is SEVERELY limited by design while testing — WriteGuard gates every path on four
 * independent, deny-by-default checks (write-enabled root · secret blacklist · extension allowlist · size
 * cap), so even a broad READ whitelist grants no write access until a root is explicitly opted in. The
 * reasons mirror read's vocabulary so the model reads a refusal the same way: no_write_roots |
 * outside_write_surface | out_of_scope | extension_blocked | too_large | write_failed | malformed.
 */
export function writeTools( chain: GuardChain ): ( ToolDefinition & { spec?: TestSpec[] } )[] {
	return [
		{
			name:        'write',
			annotations: { destructiveHint: true },
			spec: [
				{ label: 'structural fail when files is missing', input: {}, assertions: [ { type: 'error_expected' } ] },
			],
			description: 'Batch-write text/asset files. Severely limited: each path must sit inside a WRITE-enabled whitelist root (writes are off until a root is opted in), pass the secret blacklist + an extension allowlist (no code/executables), and stay under the size cap. Returns { path, ok, reason? } per file; one denied path never fails the batch.',
			inputSchema: {
				type:       'object',
				properties: {
					files: {
						type:        'array',
						description: 'Files to write; each lands only if it clears every write gate.',
						items: {
							type:       'object',
							properties: {
								path:    { type: 'string', description: 'Absolute path inside a write-enabled root.' },
								content: { type: 'string', description: 'UTF-8 text content (size-capped).' },
							},
							required: [ 'path', 'content' ],
						},
					},
				},
				required: [ 'files' ],
			},
			handler: async ( args ) => {
				try {
					// Universal chain (no single `path` param on a batch tool, so the whitelist guard is a
					// no-op here); the real gating is WriteGuard per item, so one bad path never sinks the batch.
					chain.run( { tool: 'write', params: args } )

					const files = args[ 'files' ]
					if( !Array.isArray( files ) ) {
						return MCPUtils.error( 'write: "files" must be an array of { path, content }' )
					}

					const rows: WriteRow[] = []
					for( const entry of files ) {
						const item = _item( entry )
						if( !item ) {
							rows.push( { path: String( ( entry as { path?: unknown } )?.path ?? '' ), ok: false, reason: 'malformed' } )
							continue
						}

						const denial = WriteGuard.permits( 'write', item.path, item.content )
						if( denial ) {
							rows.push( { path: item.path, ok: false, reason: denial } )
							continue
						}

						try {
							mkdirSync( dirname( item.path ), { recursive: true } )
							writeFileSync( item.path, item.content, 'utf8' )
							rows.push( { path: item.path, ok: true } )
						} catch {
							rows.push( { path: item.path, ok: false, reason: 'write_failed' } )
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

/** A well-formed { path, content } pair, or null (the entry is dropped to a `malformed` row). */
function _item( raw: unknown ): WriteItem | null {
	if( typeof raw !== 'object' || raw === null ) return null
	const e = raw as Record<string, unknown>
	if( typeof e.path !== 'string' || !e.path || typeof e.content !== 'string' ) return null
	return { path: e.path, content: e.content }
}
