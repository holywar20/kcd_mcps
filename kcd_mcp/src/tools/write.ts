import * as fs from 'fs';
import * as path from 'path';
import { KCDPrimitive } from 'kcd_sdk';
import type { ToolDefinition, SerializedArtifact } from 'kcd_sdk';
import { GuardChain } from '../guards';
import { toolResult, toolError } from '../types';
import type { SaveResult } from '../types';

export function writeTools( chain: GuardChain ): ToolDefinition[] {
	return [
		{
			name:        'kcd_save',
			description: 'Write one or more KCD artifacts to disk. Accepts a WriteMap (path → SerializedArtifact). PathGuard validates all paths and type consistency before any file is touched.',
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
							const abs      = path.resolve( writePath );
							const artifact = KCDPrimitive.fromSerialized( serialized );
							const markdown = artifact.toMarkdown();

							fs.mkdirSync( path.dirname( abs ), { recursive: true } );
							fs.writeFileSync( abs, markdown, 'utf-8' );
							result.saved.push( abs );
						} catch ( e ) {
							result.failed.push( {
								path:  writePath,
								error: e instanceof Error ? e.message : String( e ),
							} );
						}
					}

					return toolResult( result );
				} catch ( e ) {
					return toolError( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
		{
			name:        'kcd_move',
			description: 'Move or rename a KCD artifact. NOTE: not implemented in the prototype — move the file manually and restart the server.',
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
					return toolError(
						`kcd_move is not implemented. Move "${ from }" to "${ to }" manually, then restart the server to rebuild the scan.`
					);
				} catch ( e ) {
					return toolError( e instanceof Error ? e.message : String( e ) );
				}
			},
		},
	];
}
