import { MCPUtils } from '../MCPUtils'
import { McpTrace } from '../McpTrace'
import type { ToolDefinition } from 'kcd_sdk'

/**
 * permission_probe — A TEMPORARY INSTRUMENT. Delete it once the real gate is built.
 *
 * Claude Code's `--permission-prompt-tool <tool>` names an MCP tool it calls before running a tool call,
 * and that flag is how a harness-lane confirmation can reach the host at all. What it SENDS that tool, and
 * what it expects back, is not documented anywhere we can read — the binary yields the flag, its `--print`
 * restriction, and the fact that the reply must be one `type: "text"` block, and stops there.
 *
 * So this exists to be called once and read. It asserts nothing, decides nothing, and refuses nothing: it
 * records the request verbatim and returns the least surprising decision, so a single real turn tells us
 * the request shape, whether our reply shape is accepted, WHICH calls it fires for ( every tool, or only
 * some ), whether `--allowedTools` suppresses it, and whether the probe tool itself shows up on the model's
 * own surface. Guessing any one of those and building against the guess is how the last two defects in this
 * arc happened.
 *
 * REGISTERED ONLY UNDER ITS ENV FLAG. An always-present tool would sit on every agent's surface, change
 * what `probeTools()` reports, and give the model something meaningless to call.
 */
export const PROBE_ENV = 'STARMIND_PERMISSION_PROBE'

/** Is the probe armed for this process — the host stamps the flag onto the child it spawns. */
export function probeArmed(): boolean {
	return !!process.env[ PROBE_ENV ]
}

/** Serialised args are capped: we are after the SHAPE, and one `write` call would otherwise drop a whole
 *  file into the trace. The full length rides alongside so a truncation is never mistaken for the payload. */
const ARG_CAP = 2000

/** Ordering within one turn, which no timestamp resolves at this resolution — two calls in the same
 *  millisecond are exactly the case where knowing which came first matters. */
let _seq = 0

export function permissionProbeTools(): ToolDefinition[] {
	return [
		{
			name:        'permission_probe',
			annotations: { readOnlyHint: true },
			// Deliberately schema-less. We do not know what Claude Code sends, and declaring guessed field
			// names is how a probe starts confirming its own assumptions instead of reporting.
			description: 'Internal instrument. Do not call — it records a permission request and returns a fixed decision.',
			inputSchema: {
				type:       'object',
				properties: {},
				required:   [],
			},
			handler: async ( args, meta ) => {
				const raw   = JSON.stringify( args ?? null )
				const allow = !process.env[ 'STARMIND_PROBE_DENY' ]

				// THE TIMEOUT WALK. A real gate holds this call open while a person decides — seconds to
				// minutes — and Claude Code has timeout machinery whose value we cannot read. So stall by a
				// settable amount and find the cliff: if it is short, held-call confirmation is the wrong shape
				// and the gate wants deny-on-timeout with a re-ask path instead. The delay is recorded on the
				// line below BEFORE it is served, so a request that never got its answer still leaves a mark.
				const delayMs = Number( process.env[ 'STARMIND_PROBE_DELAY_MS' ] ?? 0 ) || 0

				// The whole point of the exercise, on the CAPABILITY channel beside `grant.env_seeded` so the
				// host's hand-over and this arrival read as one story in one file.
				McpTrace.capability( 'starmind_file.permission_probe', {
					seq:      ++_seq,
					decision: allow ? 'allow' : 'deny',
					delayMs,
					argBytes: raw.length,
					args:     raw.slice( 0, ARG_CAP ),
					argKeys:  args && typeof args === 'object' ? Object.keys( args ) : null,
					// `_meta` rides a tools/call beside `arguments`. If Claude Code puts anything there for a
					// permission request, that is a channel the model cannot reach — worth knowing before we
					// decide what the real gate is allowed to trust.
					meta:     meta ? JSON.stringify( meta ).slice( 0, ARG_CAP ) : null,
				} )

				// Stall AFTER the trace, so the record of the request survives even when the answer is discarded.
				if( delayMs > 0 ) {
					await new Promise( ( done ) => setTimeout( done, delayMs ) )
					McpTrace.capability( 'starmind_file.permission_probe_served', { seq: _seq, delayMs } )
				}

				// ALLOW BY DEFAULT so the turn runs to completion and one invocation yields many observations
				// rather than one. `STARMIND_PROBE_DENY` flips it for the second run, which is what tells us
				// whether a refusal is honoured and how it surfaces to the model.
				//
				// The reply shape is the `canUseTool` decision as far as we understand it, and it is A GUESS —
				// which is fine here and nowhere else: if it is wrong, Claude Code rejects it and the error is
				// itself the answer we came for. `updatedInput` echoes the input back untouched; the real gate
				// will never rewrite a call ( refuse-and-report ), but a probe that omitted a required field
				// would fail for a reason we could not distinguish from the shape being wrong.
				return MCPUtils.result(
					allow
						? { behavior: 'allow', updatedInput: ( args as Record<string, unknown> )?.[ 'input' ] ?? args ?? {} }
						: { behavior: 'deny', message: 'permission_probe: refusing by instrument, not by policy.' }
				)
			},
		},
	]
}
