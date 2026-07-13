import { GuardChain } from '../guards';
import { MCPUtils } from '../MCPUtils';

import type { ToolDefinition, TestSpec } from 'kcd_sdk';

export function discoveryTools( chain: GuardChain ): ( ToolDefinition & { spec?: TestSpec[] } )[] {
	return [
		{
			name:        'kcd_query',
			annotations: { readOnlyHint: true },
			example:     { type: 'lens' },
			spec: [
				{ label: 'lists the lenses subtree',  input: { glob: 'lenses/**' }, assertions: [] },
				{ label: 'lists all lenses',           input: { type: 'lens' },      assertions: [] },
				{ label: 'finds a body/frontmatter term', input: { text: 'lens' },   assertions: [] },
				{ label: 'censuses the vault by type',  input: { groupBy: 'type' },   assertions: [] },
			],
			description: 'Query artifacts by any combination of path glob, type, and body/frontmatter text (AND-combined). Returns matching refs, or { type, count }[] with groupBy:"type".',
			doc:
				'The single read-query over the vault — subsumes the old glob/list/search/types tools. Any of ' +
				'`glob` ( vault-relative path pattern; `*` within a segment, `**` across ), `type` ( artifact ' +
				'classifier: lens, plan, habit, reference, contract, generator, analyzer, template, framework, ' +
				'nav-index ), and `text` ( case-insensitive substring across body + serialized frontmatter ) may ' +
				'be combined; they AND together. With no filter it returns the whole vault. Returns an array of ' +
				'refs ( path + type + name ) — read one with kcd_get, walk its edges with kcd_links. Pass ' +
				'`groupBy: "type"` to get `{ type, count }[]` ( sorted by count, descending ) instead of refs — ' +
				'the cheapest orientation call. Read-only.',
			inputSchema: {
				type:       'object',
				properties: {
					glob:    { type: 'string', description: 'Vault-relative path glob; * within a segment, ** across segments.' },
					type:    { type: 'string', description: 'Artifact-type filter (lens, plan, habit, reference, …).' },
					text:    { type: 'string', description: 'Case-insensitive substring across body + serialized frontmatter.' },
					groupBy: { type: 'string', enum: [ 'type' ], description: 'Return { type, count }[] instead of refs.' },
				},
				required: [],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_query', params: args } );

					const vault   = MCPUtils.vault;
					const glob    = typeof args[ 'glob' ] === 'string' ? args[ 'glob' ] as string : undefined;
					const type    = typeof args[ 'type' ] === 'string' ? args[ 'type' ] as string : undefined;
					const text    = typeof args[ 'text' ] === 'string' ? args[ 'text' ] as string : undefined;
					const groupBy = args[ 'groupBy' ] === 'type';
					const needle  = text?.toLowerCase();

					// AND-combine the filters over one scan. glob short-circuits through the Vault's own
					// path filter; type + text narrow the survivors.
					let files = glob ? vault.glob( glob ) : vault.scan();
					if ( type )   files = files.filter( f => vault.classify( f.path ) === type );
					if ( needle ) files = files.filter( f => ( f.body + '\n' + JSON.stringify( f.frontmatter ) ).toLowerCase().includes( needle ) );

					if ( groupBy ) {
						const counts: Record<string, number> = {};
						for ( const f of files ) {
							const t      = vault.classify( f.path );
							counts[ t ]  = ( counts[ t ] ?? 0 ) + 1;
						}
						const census = Object.entries( counts )
							.sort( ( a, b ) => b[ 1 ] - a[ 1 ] )
							.map( ( [ type, count ] ) => ( { type, count } ) );
						return MCPUtils.result( census );
					}

					return MCPUtils.result( files.map( f => vault.toRef( f ) ) );
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
	];
}
