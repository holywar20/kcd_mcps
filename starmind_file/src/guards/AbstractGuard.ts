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
