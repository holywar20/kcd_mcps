import * as path from 'path';
import { scan, LensObject } from 'kcd_sdk';
import type { ToolDefinition, ArtifactRef } from 'kcd_sdk';
import { CONFIG } from '../config';
import { GuardChain } from '../guards';
import { toolResult, toolError } from '../types';

const VAULT_ROOT = path.join( CONFIG.projectRoot, CONFIG.docRoot );

/**
 * Match a relativePath against a simple glob pattern.
 * Supports: * (within one path segment) and ** (across segments).
 * No filesystem access — matches against the pre-scanned path list only.
 */
function matchesPattern( relativePath: string, pattern: string ): boolean {
	const regexStr = pattern
		.replace( /[.+^${}()|[\]\\]/g, '\\$&' )  // escape regex special chars
		.replace( /\*\*/g, '\x01' )                // protect ** before replacing *
		.replace( /\*/g, '[^/]*' )                 // * → within-segment wildcard
		.replace( /\x01/g, '.*' );                 // ** → cross-segment wildcard
	return new RegExp( `^${regexStr}$` ).test( relativePath );
}

function toRef( filePath: string, frontmatter: Record<string, unknown> ): ArtifactRef {
	return {
		path: filePath,
		type: LensObject.classifyByPath( filePath, CONFIG.projectRoot, CONFIG.docRoot ),
		name: typeof frontmatter[ 'name' ] === 'string'
			? frontmatter[ 'name' ]
			: path.basename( filePath, '.md' ),
	};
}

export function discoveryTools( chain: GuardChain ): ToolDefinition[] {
	return [
		{
			name:        'kcd_glob',
			description: 'Find artifact files whose vault-relative path matches a glob pattern. Supports * (within segment) and ** (across segments).',
			inputSchema: {
				type:       'object',
				properties: { pattern: { type: 'string', description: 'Glob over vault-relative paths; * within a segment, ** across segments.' } },
				required:   [ 'pattern' ],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_glob', params: args } );
					const pattern = String( args[ 'pattern' ] ?? '' );
					const files   = scan( VAULT_ROOT );
					const refs    = files
						.filter( f => matchesPattern( f.relativePath, pattern ) )
						.map( f => toRef( f.path, f.frontmatter ) );
					return toolResult( refs );
				} catch ( e ) {
					return toolError( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'kcd_list',
			description: 'List all artifacts of a given type (lens, plan, habit, contract, generator, analyzer, pipeline, reference, template, framework).',
			inputSchema: {
				type:       'object',
				properties: { type: { type: 'string', description: 'Artifact type to list (lens, plan, habit, …).' } },
				required:   [ 'type' ],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_list', params: args } );
					const wantType = String( args[ 'type' ] ?? '' );
					const files    = scan( VAULT_ROOT );
					const refs     = files
						.filter( f => LensObject.classifyByPath( f.path, CONFIG.projectRoot, CONFIG.docRoot ) === wantType )
						.map( f => toRef( f.path, f.frontmatter ) );
					return toolResult( refs );
				} catch ( e ) {
					return toolError( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'kcd_search',
			description: 'Substring search across all artifact bodies and frontmatter. Returns up to 20 hits with a 100-char excerpt each.',
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

					const query = String( args[ 'query' ] ?? '' );
					const scope = typeof args[ 'scope' ] === 'string' ? args[ 'scope' ] as string : undefined;
					const files = scan( VAULT_ROOT );
					const hits  = [];

					for ( const f of files ) {
						if ( scope ) {
							const fileType = LensObject.classifyByPath( f.path, CONFIG.projectRoot, CONFIG.docRoot );
							if ( fileType !== scope ) continue;
						}

						const searchable = f.body + '\n' + JSON.stringify( f.frontmatter );
						const idx        = searchable.toLowerCase().indexOf( query.toLowerCase() );
						if ( idx === -1 ) continue;

						const start   = Math.max( 0, idx - 50 );
						const end     = Math.min( searchable.length, idx + 50 );
						const excerpt = searchable.slice( start, end ).replace( /\n/g, ' ' ).trim();

						hits.push( {
							path:        f.path,
							type:        LensObject.classifyByPath( f.path, CONFIG.projectRoot, CONFIG.docRoot ),
							excerpt,
							matchOffset: idx,
						} );

						if ( hits.length >= 20 ) break;
					}

					return toolResult( hits );
				} catch ( e ) {
					return toolError( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'kcd_types',
			description: 'Count artifacts by type across the vault. Returns an array sorted by count descending.',
			inputSchema: {
				type:       'object',
				properties: {},
				required:   [],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_types', params: args } );
					const files  = scan( VAULT_ROOT );
					const counts: Record<string, number> = {};

					for ( const f of files ) {
						const type     = LensObject.classifyByPath( f.path, CONFIG.projectRoot, CONFIG.docRoot );
						counts[ type ] = ( counts[ type ] ?? 0 ) + 1;
					}

					const result = Object.entries( counts )
						.sort( ( a, b ) => b[ 1 ] - a[ 1 ] )
						.map( ( [ type, count ] ) => ( { type, count } ) );

					return toolResult( result );
				} catch ( e ) {
					return toolError( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
	];
}
