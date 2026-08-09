import { MCPUtils } from '../MCPUtils'
import { WhitelistGuard } from '../guards/WhitelistGuard'
import type { ToolDefinition, TestSpec } from 'kcd_sdk'

/**
 * roots — the agent's view of its own scope. Returns the enabled whitelisted directories PLUS any
 * user-authored grants in force, so the agent discovers where it may search/read instead of guessing
 * paths and eating GuardErrors. This is how scope is SURFACED to the model (the blacklist, by contrast,
 * is never surfaced — denied files are filtered silently). Read-only, no args.
 *
 * This reads the SAME two lists `WhitelistGuard` admits against, which is the point: what the agent is
 * told it may reach and what it may actually reach cannot drift, because there is one source for both.
 * The reporting is nonetheless a WITNESS and never the boundary — if this and the guard ever disagreed,
 * the guard is right and this is the bug. Read the other way round it would be a permission model made
 * of prose.
 *
 * An entry may be a FILE rather than a directory: a file grant covers exactly that file.
 */
export function rootsTools(): ( ToolDefinition & { spec?: TestSpec[] } )[] {
	return [
		{
			name:        'roots',
			annotations: { readOnlyHint: true },
			spec: [
				{ label: 'returns a roots array', input: {}, assertions: [ { type: 'has_key', key: 'roots' }, { type: 'type_is', key: 'roots', expected: 'array' } ] },
			],
			description: 'List the paths you are allowed to search and read — your permitted directories, plus anything the user has handed you for this session (which may be a single file). Every path you use must sit inside one of these.',
			inputSchema: {
				type:       'object',
				properties: {},
				required:   [],
			},
			handler: async ( _args, meta ) => {
				try {
					// The guard's OWN composer, not a second union assembled here. THREE surfaces state this
					// list now — this tool when the agent asks, the refusal message when it guesses wrong, and
					// the guard when it admits — and one of them being built separately is exactly how they
					// come to disagree. Granted subjects arrive undifferentiated from configured roots on
					// purpose: the agent needs to know where it may go, never why it may go there.
					return MCPUtils.result( { roots: WhitelistGuard.scope( meta ) } )
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) )
				}
			},
		},
	]
}
