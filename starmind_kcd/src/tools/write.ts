import type { ToolDefinition, TestSpec } from 'kcd_sdk';
import { GuardChain } from '../guards';
import { MCPUtils } from '../MCPUtils';

export function writeTools( chain: GuardChain ): ( ToolDefinition & { spec?: TestSpec[] } )[] {
	return [
		{
			name:        'kcd_save',
			annotations: { destructiveHint: true },
			// NOT IMPLEMENTED in the HTML cutover. Saving an artifact means object-model → HTML
			// emit, and that serializer ( the render/emit direction ) does not exist yet — it is
			// Phase 3 of the substrate migration. Until then a save must fail LOUD rather than
			// silently write stale markdown, so verify() asserts the structured error.
			spec: [
				{
					label: 'not implemented → structured error',
					input: { writes: { 'work/mcp/AI/.verify-throwaway.html': {} } },
					assertions: [ { type: 'error_expected' } ],
				},
			],
			description: 'Write one or more KCD artifacts to disk. NOT IMPLEMENTED — the object-model → HTML emitter lands in Phase 3 of the substrate migration; until then, save fails with a structured error.',
			doc:
				'NOT IMPLEMENTED in the HTML cutover. A save requires serializing the object model back to ' +
				'HTML ( the render/emit direction ), which is Phase 3 of the substrate migration — there is ' +
				'no markdown emit any more, and no HTML emit yet. The tool is listed so its capacity stays ' +
				'visible; today it always returns a structured error. `writes` is a map of vault-relative ' +
				'path → SerializedArtifact, the shape a real save will consume.',
			inputSchema: {
				type:       'object',
				properties: { writes: { type: 'object', additionalProperties: true, description: 'Map of vault-relative path → SerializedArtifact.' } },
				required:   [ 'writes' ],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_save', params: args } );
					return MCPUtils.error(
						'kcd_save is not implemented in the HTML cutover. The object-model → HTML emitter is ' +
						'Phase 3 of the substrate migration; until it lands, artifacts cannot be written back to disk.'
					);
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
