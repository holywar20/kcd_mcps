import { KcdEmit, KcdValidate } from 'kcd_sdk';
import type { ToolDefinition, TestSpec, SerializedArtifact } from 'kcd_sdk';
import { GuardChain } from '../guards';
import { MCPUtils } from '../MCPUtils';

export function writeTools( chain: GuardChain ): ( ToolDefinition & { spec?: TestSpec[] } )[] {
	return [
		{
			name:        'kcd_save',
			annotations: { destructiveHint: true },
			example:     {
				path:     'references/domain/my-note.html',
				artifact: {
					type:        'reference',
					frontmatter: { name: 'my-note', description: 'A worked example.', type: 'reference', status: 'active' },
					body:        '<h1>My Note</h1>\n<p>The body content.</p>',
				},
			},
			spec: [
				{ label: 'jails an out-of-vault path', input: { path: 'C:/Windows/x.html', artifact: { type: 'reference', frontmatter: {}, body: '' } }, assertions: [ { type: 'error_expected' } ] },
				{ label: 'refuses an artifact that fails validation', input: { path: 'references/domain/x.html', artifact: { type: 'reference', frontmatter: {}, body: '' } }, assertions: [ { type: 'error_expected' } ] },
			],
			description: 'Write one KCD artifact to disk: emit HTML from its structured shape, validate, and save — a malformed artifact is refused, nothing written. Creates or overwrites. For several, sequence via kcd_batch.',
			doc:
				'Persist one artifact by vault-relative `path` from its `artifact` ( a SerializedArtifact — the ' +
				'shape kcd_get returns ). Emits HTML with KcdEmit: frontmatter is rebuilt from `artifact.frontmatter`, ' +
				'the `body` passes through — an existing body has its frontmatter block replaced ( the edit path: ' +
				'kcd_get → mutate → kcd_save ), a body with none gets one prepended ( the create path ). The result ' +
				'is validated with KcdValidate BEFORE any write: a structural failure returns a structured error and ' +
				'writes NOTHING ( the write-time gate — can\'t save a malformed artifact ). On success it writes and ' +
				'returns `{ saved, warnings }`. PathGuard jails the path and checks the declared type matches the ' +
				'target directory. NOTE: agent-authored body HTML is not yet sanitized here ( the render layer ' +
				'sanitizes on display; a save-time sanitize pass is a named deferral ), and structured ' +
				'section/region/slot synthesis ( create a lens from fields alone ) is not built — supply body HTML.',
			inputSchema: {
				type:       'object',
				properties: {
					path:     { type: 'string', description: 'Vault-relative destination path.' },
					artifact: {
						type:        'object',
						description: 'The SerializedArtifact to write.',
						properties: {
							type:        { type: 'string', description: 'Artifact type (lens, plan, habit, reference, …) — must match the target directory.' },
							frontmatter: { type: 'object', additionalProperties: true, description: 'Frontmatter fields (name, description, status, …) — rebuilt into the HTML header block.' },
							body:        { type: 'string', description: 'Body HTML, no frontmatter block. Omit only when creating from fields alone (not yet supported — supply body HTML).' },
						},
						required: [ 'type', 'frontmatter', 'body' ],
					},
				},
				required: [ 'path', 'artifact' ],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_save', params: args } );

					const filePath = String( args[ 'path' ] ?? '' );
					const raw      = ( args[ 'artifact' ] ?? {} ) as Record<string, unknown>;
					// coerce body to a string — an absent body is a create with no content ( validation
					// will then reject it with a helpful message, not a parse crash ).
					const artifact = { ...raw, body: typeof raw[ 'body' ] === 'string' ? raw[ 'body' ] : '' } as unknown as SerializedArtifact;

					const html   = KcdEmit.emit( artifact );
					const report = KcdValidate.validate( html );
					if ( !report.ok ) {
						const detail = report.errors.map( e => `${ e.code } @ ${ e.where }: ${ e.msg }` ).join( '; ' );
						return MCPUtils.error( `kcd_save refused "${ filePath }": artifact failed validation — ${ detail }` );
					}

					const saved = MCPUtils.vault.write( filePath, html );
					return MCPUtils.result( { saved, warnings: report.warnings } );
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
