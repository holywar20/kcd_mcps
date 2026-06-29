import { MCPUtils } from '../MCPUtils'
import { loadConfig } from '../config'
import type { ToolDefinition, TestSpec } from 'kcd_sdk'

/**
 * roots — the agent's view of its own scope. Returns the enabled whitelisted directories, so the
 * agent discovers where it may search/read instead of guessing paths and eating GuardErrors. This is
 * how the whitelist is SURFACED to the model (the blacklist, by contrast, is never surfaced — denied
 * files are filtered silently). Read-only, no args. The blacklist is deliberately absent here.
 */
export function rootsTools(): ( ToolDefinition & { spec?: TestSpec[] } )[] {
	return [
		{
			name:        'roots',
			annotations: { readOnlyHint: true },
			spec: [
				{ label: 'returns a roots array', input: {}, assertions: [ { type: 'has_key', key: 'roots' }, { type: 'type_is', key: 'roots', expected: 'array' } ] },
			],
			description: 'List the directories you are allowed to search and read. Every path you use must sit inside one of these roots.',
			inputSchema: {
				type:       'object',
				properties: {},
				required:   [],
			},
			handler: async () => {
				try {
					const roots: string[] = []
					for( const entry of loadConfig().whitelist ) {
						if( entry.enabled ) {
							roots.push( entry.path )
						}
					}
					return MCPUtils.result( { roots } )
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) )
				}
			},
		},
	]
}
