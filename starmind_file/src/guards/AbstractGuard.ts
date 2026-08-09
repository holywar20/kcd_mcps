/**
 * AbstractGuard — base class for every security check in the guard chain.
 *
 * Each guard gets the full ToolRequest and either returns (pass) or throws
 * a GuardError (reject). The GuardChain runner stops at the first rejection
 * and the server maps it to an MCP error response.
 *
 * New behavior is a new guard subclass — existing guards and tool handlers
 * never change when a new rule is added.
 */
export interface ToolRequest {
	/** The registered tool name, e.g. 'list'. */
	tool:   string;
	/** The params object as received from the MCP SDK after Zod validation. */
	params: Record<string, unknown>;
	/**
	 * The call's out-of-band envelope — JSON-RPC's `_meta`, forwarded VERBATIM from the handler.
	 * Carries the user-authored grants the host asserted for this call ( read via `CallMeta.grants` ).
	 * ONE of two carriers, not the only one: it is present when Starmind owns the call, and absent on
	 * the harness tier where Claude Code does — there the grants arrive by file. `WhitelistGuard._grantsFor`
	 * is the single place that knows the difference; nothing else should learn it.
	 *
	 * A TOOL NEVER READS THIS; only a guard does. That asymmetry is the containment. The envelope
	 * arrives opaque and leaves opaque, so a handler holds nothing it could strip, rewrite or
	 * synthesize — forwarding is the only thing it can do with it. Optional, because a call carrying
	 * no exception omits the field entirely.
	 */
	meta?:  Record<string, unknown>;
}

export class GuardError extends Error {
	/** Short machine-readable rejection code for logging and error mapping. */
	readonly code: string;

	constructor( message: string, code = 'GUARD_REJECTED' ) {
		super( message );
		this.name = 'GuardError';
		this.code = code;
	}
}

export abstract class AbstractGuard {
	/**
	 * Validate the request. Return normally to pass; throw GuardError to reject.
	 */
	abstract validate( req: ToolRequest ): void;
}
