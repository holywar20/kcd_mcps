import { MCPUtils } from '../MCPUtils';

import type { ToolDefinition, TestSpec, ToolResult } from 'kcd_sdk';

/** The server's in-process dispatch — `StarmindServer.invoke`, bound at build() time. */
type Invoke = ( name: string, args: Record<string, unknown> ) => Promise<ToolResult>;

/**
 * The batch tool — an agent bundles a few calls that must run in order, and gets one envelope back.
 *
 * It is NOT a guard-chain tool: kcd_batch touches nothing itself; each call it dispatches runs its own
 * handler ( and its own PathGuard ). It only needs the server's internal dispatch, injected as `invoke`.
 */
export function batchTools( invoke: Invoke ): ( ToolDefinition & { spec?: TestSpec[] } )[] {

	const textOf = ( r: ToolResult ): string => r.content.map( c => c.text ).join( '' );

	return [
		{
			name:    'kcd_batch',
			example: {
				calls: [
					{ tool: 'kcd_query', args: { type: 'lens' } },
					{ tool: 'kcd_get',   args: { path: 'lenses/mcp/mcp.html' } },
				],
			},
			spec: [
				{ label: 'runs a read sequence',                  input: { calls: [ { tool: 'kcd_query', args: { groupBy: 'type' } } ] }, assertions: [] },
				{ label: 'reports a bad call without throwing',   input: { calls: [ { tool: 'does-not-exist' } ] },                        assertions: [] },
			],
			description: 'Run an ordered sequence of tool calls in one shot, stopping at the first failure. Returns each call\'s output, any failure, and the unrun remainder.',
			doc:
				'Execute `calls` — `[{ tool, args? }]` — IN ORDER through the server\'s internal dispatch, as a ' +
				'single tool call, so an agent that stacks a few operations gets one round-trip. Stops at the ' +
				'FIRST failure ( a step whose result is an error ). Returns `{ completed, failed, remaining }`: ' +
				'`completed` is `[{ tool, output }]` for every step that succeeded ( output is that tool\'s own ' +
				'result text ); `failed` is `{ index, tool, error }` or null; `remaining` is the tool names never ' +
				'reached. A nested `kcd_batch` is rejected. This tool is only as destructive as the tools it ' +
				'invokes — bundle heals ( move/delete ) and reads freely — but the sequence is NOT atomic: a ' +
				'mid-sequence failure leaves the earlier steps applied.',
			inputSchema: {
				type:       'object',
				properties: {
					calls: {
						type:        'array',
						description: 'Ordered tool calls; the batch stops at the first that fails.',
						items: {
							type:       'object',
							properties: {
								tool: { type: 'string', description: 'Registered tool name to invoke.' },
								args: { type: 'object', additionalProperties: true, description: 'Arguments for that tool.' },
							},
							required: [ 'tool' ],
						},
					},
				},
				required: [ 'calls' ],
			},
			handler: async ( args ) => {
				const calls = Array.isArray( args[ 'calls' ] ) ? args[ 'calls' ] as Array<Record<string, unknown>> : [];
				const completed: Array<{ tool: string; output: string }> = [];

				for ( let i = 0; i < calls.length; i++ ) {
					const call     = calls[ i ] ?? {};
					const tool     = typeof call[ 'tool' ] === 'string' ? call[ 'tool' ] as string : '';
					const callArgs = ( call[ 'args' ] ?? {} ) as Record<string, unknown>;

					const fail = ( error: string ) => MCPUtils.result( {
						completed,
						failed:    { index: i, tool, error },
						remaining: calls.slice( i + 1 ).map( c => typeof c?.[ 'tool' ] === 'string' ? c[ 'tool' ] : '?' ),
					} );

					if ( !tool )                return fail( 'call is missing a "tool" name' );
					if ( tool === 'kcd_batch' ) return fail( 'kcd_batch cannot be nested' );

					const result = await invoke( tool, callArgs );
					if ( result.isError ) return fail( textOf( result ) );

					completed.push( { tool, output: textOf( result ) } );
				}

				return MCPUtils.result( { completed, failed: null, remaining: [] } );
			},
		},
	];
}
