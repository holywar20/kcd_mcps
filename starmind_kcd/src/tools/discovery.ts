import { GuardChain } from '../guards';
import { MCPUtils } from '../MCPUtils';

import type { ToolDefinition, TestSpec } from 'kcd_sdk';

export function discoveryTools( chain: GuardChain ): ( ToolDefinition & { spec?: TestSpec[] } )[] {
	return [
		{
			name:        'kcd_glob',
			annotations: { readOnlyHint: true },
			spec: [
				{ label: 'globs the lenses tree', input: { pattern: 'lenses/**' }, assertions: [] },
			],
			description: 'Find artifact files whose vault-relative path matches a glob pattern. Supports * (within segment) and ** (across segments).',
			doc:
				'Match artifact files by path shape, not content. `pattern` is a glob over vault-relative ' +
				'paths: `*` matches within one segment, `**` matches across segments. ' +
				'Returns an array of artifact refs (path + type) for every match. ' +
				'Use it to enumerate a subtree (`lenses/**`) or a naming family (`**/*-plan.md`); ' +
				'reach for kcd_search instead when you need to match on body or frontmatter. Read-only.',
			inputSchema: {
				type:       'object',
				properties: { pattern: { type: 'string', description: 'Glob over vault-relative paths; * within a segment, ** across segments.' } },
				required:   [ 'pattern' ],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_glob', params: args } );
					const vault   = MCPUtils.vault;
					const pattern = String( args[ 'pattern' ] ?? '' );
					const refs    = vault.glob( pattern ).map( f => vault.toRef( f ) );
					return MCPUtils.result( refs );
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'kcd_list',
			annotations: { readOnlyHint: true },
			spec: [
				{ label: 'lists lenses', input: { type: 'lens' }, assertions: [] },
			],
			description: 'List all artifacts of a given type (lens, plan, habit, contract, generator, analyzer, utility, reference, template, framework).',
			doc:
				'Enumerate every artifact of one KCD type across the whole vault. `type` is the classifier ' +
				'(lens, plan, habit, contract, reference, generator, analyzer, utility, template, framework) — ' +
				'derived from each file\'s location + frontmatter, not its extension. ' +
				'Returns an array of refs (path + type). The fastest way to answer "what lenses exist?" ' +
				'without globbing paths. Use kcd_types first if you don\'t yet know which types are present. Read-only.',
			inputSchema: {
				type:       'object',
				properties: { type: { type: 'string', description: 'Artifact type to list (lens, plan, habit, …).' } },
				required:   [ 'type' ],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_list', params: args } );
					const vault    = MCPUtils.vault;
					const wantType = String( args[ 'type' ] ?? '' );
					const refs     = vault.scan()
						.filter( f => vault.classify( f.path ) === wantType )
						.map( f => vault.toRef( f ) );
					return MCPUtils.result( refs );
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'kcd_search',
			annotations: { readOnlyHint: true },
			spec: [
				{ label: 'finds the term "lens"', input: { query: 'lens' }, assertions: [] },
			],
			description: 'Substring search across all artifact bodies and frontmatter. Returns up to 20 hits with a 100-char excerpt each.',
			doc:
				'Case-insensitive substring search across every artifact\'s body AND serialized frontmatter. ' +
				'`query` is a literal substring (not a regex); optional `scope` restricts the hunt to one ' +
				'artifact type. Returns up to 20 hits, each with the file path, its type, a ~100-char excerpt ' +
				'around the match, and the match offset — capped to stay cheap, so narrow the query when it ' +
				'saturates. The content counterpart to kcd_glob (which matches paths). Read-only.',
			inputSchema: {
				type:       'object',
				properties: {
					query: { type: 'string', description: 'Case-insensitive substring to find.' },
					scope: { type: 'string', description: 'Optional artifact-type filter (e.g. "lens").' },
				},
				required: [ 'query' ],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_search', params: args } );

					const vault = MCPUtils.vault;
					const query = String( args[ 'query' ] ?? '' );
					const scope = typeof args[ 'scope' ] === 'string' ? args[ 'scope' ] as string : undefined;
					const hits  = [];

					for ( const f of vault.scan() ) {
						if ( scope && vault.classify( f.path ) !== scope ) continue;

						const searchable = f.body + '\n' + JSON.stringify( f.frontmatter );
						const idx        = searchable.toLowerCase().indexOf( query.toLowerCase() );
						if ( idx === -1 ) continue;

						const start   = Math.max( 0, idx - 50 );
						const end     = Math.min( searchable.length, idx + 50 );
						const excerpt = searchable.slice( start, end ).replace( /\n/g, ' ' ).trim();

						hits.push( {
							path:        f.relativePath,
							type:        vault.classify( f.path ),
							excerpt,
							matchOffset: idx,
						} );

						if ( hits.length >= 20 ) break;
					}

					return MCPUtils.result( hits );
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'kcd_types',
			annotations: { readOnlyHint: true },
			spec: [
				{ label: 'counts artifacts by type', input: {}, assertions: [] },
			],
			description: 'Count artifacts by type across the vault. Returns an array sorted by count descending.',
			doc:
				'Census the whole vault: one pass that buckets every artifact by its classified type and ' +
				'returns `{ type, count }[]` sorted by count descending. Takes no arguments. ' +
				'The cheapest orientation call — run it first to see which types exist and how the vault ' +
				'is weighted before drilling in with kcd_list or kcd_glob. Read-only.',
			inputSchema: {
				type:       'object',
				properties: {},
				required:   [],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_types', params: args } );
					const vault  = MCPUtils.vault;
					const counts: Record<string, number> = {};

					for ( const f of vault.scan() ) {
						const type     = vault.classify( f.path );
						counts[ type ] = ( counts[ type ] ?? 0 ) + 1;
					}

					const result = Object.entries( counts )
						.sort( ( a, b ) => b[ 1 ] - a[ 1 ] )
						.map( ( [ type, count ] ) => ( { type, count } ) );

					return MCPUtils.result( result );
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
	];
}
