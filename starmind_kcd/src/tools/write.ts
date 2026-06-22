import { KCDPrimitive } from 'kcd_sdk';
import type { ToolDefinition, SerializedArtifact, TestSpec } from 'kcd_sdk';
import { GuardChain } from '../guards';
import { MCPUtils } from '../MCPUtils';
import type { SaveResult } from '../types';

export function writeTools( chain: GuardChain ): ( ToolDefinition & { spec?: TestSpec[] } )[] {
	return [
		{
			name:        'kcd_save',
			annotations: { destructiveHint: true },
			// Flush-and-fill round-trip: writes one throwaway artifact (overwritten each run,
			// no history) and asserts it saved with no failures. The embedded artifact mirrors
			// a real serialized shape so fromSerialized → toMarkdown round-trips.
			spec: [
				{
					label: 'round-trips a throwaway artifact',
					input: {
						writes: {
							'work/mcp/AI/.verify-throwaway.md': {
								path:        'work/mcp/AI/.verify-throwaway.md',
								type:        'habit',
								frontmatter: { type: 'habit', status: 'active' },
								sections:    {},
								body:        '\n# Habit — verify throwaway\n\n**When:** never — written by verify() to prove kcd_save round-trips.\n',
								links:       [],
							},
						},
					},
					assertions: [
						{ type: 'type_is',  key: 'saved',  expected: 'array' },
						{ type: 'value_eq', key: 'failed', expected: [] },
					],
				},
			],
			description: 'Write one or more KCD artifacts to disk. Accepts a WriteMap (path → SerializedArtifact). PathGuard validates all paths and type consistency before any file is touched.',
			doc:
				'DESTRUCTIVE — writes files. `writes` is a map of vault-relative path → SerializedArtifact; ' +
				'each value is rehydrated (fromSerialized) and rendered back to markdown (toMarkdown) before ' +
				'it lands, so only well-formed artifacts persist. PathGuard validates every path and its ' +
				'type consistency up front. Returns `{ saved, failed }` — saved is the list of written ' +
				'paths, failed pairs each rejected path with its error; one bad entry does not block the ' +
				'rest (per-write try/catch). Batch related writes in one call. Overwrites in place; no history.',
			inputSchema: {
				type:       'object',
				properties: { writes: { type: 'object', additionalProperties: true, description: 'Map of vault-relative path → SerializedArtifact.' } },
				required:   [ 'writes' ],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_save', params: args } );

					const writes = ( args[ 'writes' ] ?? {} ) as Record<string, SerializedArtifact>;
					const result: SaveResult = { saved: [], failed: [] };

					for ( const [ writePath, serialized ] of Object.entries( writes ) ) {
						try {
							const artifact = KCDPrimitive.fromSerialized( serialized );
							result.saved.push( MCPUtils.vault.write( writePath, artifact.toMarkdown() ) );
						} catch ( e ) {
							result.failed.push( {
								path:  writePath,
								error: e instanceof Error ? e.message : String( e ),
							} );
						}
					}

					return MCPUtils.result( result );
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'kcd_move',
			annotations: { destructiveHint: true },
			spec: [
				{ label: 'not implemented → structured error', input: { from: 'a.md', to: 'b.md' }, assertions: [ { type: 'error_expected' } ] },
			],
			description: 'Move or rename a KCD artifact. NOTE: not implemented in the prototype — move the file manually and restart the server.',
			doc:
				'NOT IMPLEMENTED in the prototype — always returns a structured error telling you to move the ' +
				'file manually and restart the server. Listed so its capacity is visible: a real move must ' +
				'rename the file AND rewrite every inbound link href across the vault (otherwise backlinks ' +
				'rot), which is why it is deferred. `from` / `to` are vault-relative paths. Destructive once ' +
				'built; today a safe no-op that only reports.',
			inputSchema: {
				type:       'object',
				properties: {
					from: { type: 'string', description: 'Current vault-relative path.' },
					to:   { type: 'string', description: 'Destination vault-relative path.' },
				},
				required: [ 'from', 'to' ],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_move', params: args } );
					// Full implementation requires: rename file + rewrite all inbound link hrefs
					// across the vault. Deferred — non-trivial and not needed for the prototype.
					const from = String( args[ 'from' ] ?? '' );
					const to   = String( args[ 'to' ] ?? '' );
					return MCPUtils.error(
						`kcd_move is not implemented. Move "${ from }" to "${ to }" manually, then restart the server to rebuild the scan.`
					);
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
	];
}
