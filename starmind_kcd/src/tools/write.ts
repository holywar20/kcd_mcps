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
			example:     { from: 'references/domain/old-name.html', to: 'references/domain/new-name.html' },
			spec: [
				{ label: 'jails an out-of-vault source', input: { from: 'C:/Windows/System32/drivers/etc/hosts', to: 'x.html' }, assertions: [ { type: 'error_expected' } ] },
				{ label: 'missing source → structured error', input: { from: 'does-not-exist-xyz.html', to: 'work/mcp/AI/nope.html' }, assertions: [ { type: 'error_expected' } ] },
			],
			description: 'Move or rename a KCD artifact and heal every inbound link across the vault. Destructive: rewrites referrers and renames the file.',
			doc:
				'Rename or relocate one artifact by vault-relative `from` → `to`, then HEAL the graph: every ' +
				'other file whose links resolve to `from` has that href rewritten to the new location, so no ' +
				'backlink rots. Referrers are matched by RESOLVED identity ( not a text grep ), and the swap ' +
				'preserves their hand-authored formatting. Returns the HealPlan — `{ op, from, to, edits }`, ' +
				'where each edit is the referrer + old/new href. Refuses if `from` is missing or `to` already ' +
				'exists ( structured error ), and asserts afterward that no link still resolves to `from` — a ' +
				'residual fails loud rather than leaving the vault dangling. Both paths are PathGuard-jailed. ' +
				'Destructive: it writes referrers and renames the file.',
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
					const from = String( args[ 'from' ] ?? '' );
					const to   = String( args[ 'to' ] ?? '' );
					const plan = MCPUtils.vault.move( from, to );
					return MCPUtils.result( plan );
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'kcd_delete',
			annotations: { destructiveHint: true },
			example:     { path: 'references/domain/obsolete-note.html' },
			spec: [
				{ label: 'jails an out-of-vault path', input: { path: 'C:/Windows/System32/drivers/etc/hosts' }, assertions: [ { type: 'error_expected' } ] },
				{ label: 'missing target → structured error', input: { path: 'does-not-exist-xyz.html' }, assertions: [ { type: 'error_expected' } ] },
			],
			description: 'Delete a KCD artifact and cascade the removal through every referrer. Destructive: strips inbound references and removes the file; blocks if the artifact is referenced by identity (base/lens).',
			doc:
				'Remove one artifact by vault-relative `path` and CASCADE the removal: every inbound reference ' +
				'is excised from its referrer so the graph stays viable — a slot-field link takes its whole ' +
				'record row, a bare prose <a> unwraps to its text, span-precise so surrounding formatting is ' +
				'untouched. BLOCKS ( structured error, nothing deleted ) if any artifact references the target ' +
				'by IDENTITY ( a base/lens slug naming it ) — those are not movable links and must be repointed ' +
				'or renamed first. Returns the HealPlan — `{ op:"delete", from, edits }`, each edit a referrer ' +
				'touched. Refuses a missing target, PathGuard-jails the path, and asserts afterward that no link ' +
				'still resolves to it ( a residual fails loud ). Destructive: it writes referrers and removes the file.',
			inputSchema: {
				type:       'object',
				properties: { path: { type: 'string', description: 'Vault-relative path to the artifact to delete.' } },
				required:   [ 'path' ],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_delete', params: args } );
					const filePath = String( args[ 'path' ] ?? '' );
					const plan     = MCPUtils.vault.delete( filePath );
					return MCPUtils.result( plan );
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
	];
}
