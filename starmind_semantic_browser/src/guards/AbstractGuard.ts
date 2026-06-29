/**
 * AbstractGuard — base for every check in the origin guard chain.
 *
 * Each guard gets the RESOLVED request (the tool, the page URL in play, and whether the op is an
 * ACT — click/type) and either returns (pass) or throws a GuardError (reject). The GuardChain stops
 * at the first rejection; the GuardedSession lets it propagate and the tool handler folds it into a
 * structured MCP error. New behavior is a new guard subclass — existing guards never change.
 *
 * Unlike the file server's params-based jail, this request is RESOLVED state, not raw params: a
 * browser is stateful, so the URL in play is the navigate target (for navigate) or the LIVE current
 * page (for everything else), supplied by the GuardedSession which alone knows it.
 */
export interface ToolRequest {
	tool: string
	url:  string     // the origin in play — navigate target, or the live current page
	act:  boolean    // true for click/type (act tier); false for navigate/read/scroll
}

export class GuardError extends Error {
	readonly code: string

	constructor( message: string, code = 'GUARD_REJECTED' ) {
		super( message )
		this.name = 'GuardError'
		this.code = code
	}
}

export abstract class AbstractGuard {
	/** Return normally to pass; throw GuardError to reject. */
	abstract validate( req: ToolRequest ): void
}
