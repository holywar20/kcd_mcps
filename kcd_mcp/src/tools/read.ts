import * as fs from 'fs';
import * as path from 'path';
import { scan, LensObject, KCDPrimitive } from 'kcd_sdk';
import type { ToolDefinition } from 'kcd_sdk';
import { CONFIG } from '../config';
import { GuardChain } from '../guards';
import { toolResult, toolError } from '../types';
import type { HealthIssue, HealthReport } from '../types';

const VAULT_ROOT = path.join( CONFIG.projectRoot, CONFIG.docRoot );

export function readTools( chain: GuardChain ): ToolDefinition[] {
	return [
		{
			name:        'kcd_get',
			description: 'Load and serialize a KCD artifact. For lenses, depth controls how many levels of always-policy children are dredged (default 1 = artifact only, 2+ = with children).',
			inputSchema: {
				type:       'object',
				properties: {
					path:  { type: 'string', description: 'Vault-relative path to the artifact.' },
					depth: { type: 'integer', minimum: 1, maximum: 4, description: 'Lens dredge depth; 1 = artifact only.' },
				},
				required: [ 'path' ],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_get', params: args } );

					const filePath = String( args[ 'path' ] ?? '' );
					const depth    = typeof args[ 'depth' ] === 'number' ? args[ 'depth' ] as number : undefined;
					const type     = LensObject.classifyByPath( filePath, CONFIG.projectRoot, CONFIG.docRoot );

					if ( type === 'lens' ) {
						const lens = LensObject.load( filePath, {
							projectRoot: CONFIG.projectRoot,
							depth:       depth ?? 1,
						} );
						return toolResult( lens.serialize() );
					}

					const markdown = fs.readFileSync( filePath, 'utf-8' );
					const artifact = KCDPrimitive.create( type, markdown, filePath );
					return toolResult( artifact.serialize() );
				} catch ( e ) {
					return toolError( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'kcd_links',
			description: 'Get outbound links declared by an artifact and inbound links pointing to it from the rest of the vault.',
			inputSchema: {
				type:       'object',
				properties: { path: { type: 'string', description: 'Vault-relative path to the artifact.' } },
				required:   [ 'path' ],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_links', params: args } );

					const filePath = String( args[ 'path' ] ?? '' );
					const abs      = path.resolve( filePath );
					const type     = LensObject.classifyByPath( abs, CONFIG.projectRoot, CONFIG.docRoot );
					const markdown = fs.readFileSync( abs, 'utf-8' );
					const artifact = KCDPrimitive.create( type, markdown, abs );
					const outbound = artifact.getLinks();

					// Inbound: scan vault, resolve each raw link, match against target
					const allFiles = scan( VAULT_ROOT );
					const inbound  = allFiles
						.filter( f => f.rawLinks.some( l => {
							const resolved = LensObject.resolveHref( l.href, CONFIG.projectRoot );
							return path.resolve( resolved ) === abs;
						} ) )
						.map( f => ( {
							path:         f.path,
							relativePath: f.relativePath,
						} ) );

					return toolResult( { outbound, inbound } );
				} catch ( e ) {
					return toolError( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'kcd_health',
			description: 'Run structural validation on one artifact (path provided) or the entire vault (no path). Returns issues and a summary.',
			inputSchema: {
				type:       'object',
				properties: { path: { type: 'string', description: 'Optional vault-relative path; omit to check the whole vault.' } },
				required:   [],
			},
			handler: async ( args ) => {
				try {
					chain.run( { tool: 'kcd_health', params: args } );

					const issues: HealthIssue[] = [];
					const inputPath = typeof args[ 'path' ] === 'string' ? args[ 'path' ] as string : '';

					const checkFile = ( filePath: string ) => {
						const abs  = path.resolve( filePath );
						const type = LensObject.classifyByPath( abs, CONFIG.projectRoot, CONFIG.docRoot );

						try {
							const markdown = fs.readFileSync( abs, 'utf-8' );
							const artifact = KCDPrimitive.create( type, markdown, abs );

							for ( const issue of artifact.typeCheck() ) {
								issues.push( { path: abs, ...issue } );
							}
						} catch ( e ) {
							issues.push( {
								path:     abs,
								severity: 'error',
								message:  e instanceof Error ? e.message : String( e ),
							} );
						}
					};

					if ( inputPath ) {
						checkFile( inputPath );
					} else {
						const files = scan( VAULT_ROOT );
						for ( const f of files ) checkFile( f.path );
					}

					const report: HealthReport = {
						issues,
						summary: {
							total:    issues.length,
							errors:   issues.filter( i => i.severity === 'error' ).length,
							warnings: issues.filter( i => i.severity === 'warn' ).length,
						},
					};

					return toolResult( report );
				} catch ( e ) {
					return toolError( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
	];
}
