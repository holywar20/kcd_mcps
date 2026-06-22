import { AbstractGuard } from './AbstractGuard';
import type { ToolRequest } from './AbstractGuard';

/**
 * Ordered guard runner. Calls validate() on each guard in insertion order.
 * Stops at the first GuardError — the error propagates to the tool handler,
 * which maps it to an MCP error response.
 *
 * Add guards at construction time or via add(). Order matters: cheaper checks
 * (path jail) should precede expensive ones (a future agent guard).
 */
export class GuardChain {

	private guards: AbstractGuard[] = [];

	constructor( ...guards: AbstractGuard[] ) {
		this.guards = [ ...guards ];
	}

	/** Run all guards against the request. Throws GuardError on the first rejection. */
	run( req: ToolRequest ): void {
		for ( const guard of this.guards ) {
			guard.validate( req );
		}
	}

	/** Append a guard to the end of the chain. */
	add( guard: AbstractGuard ): void {
		this.guards.push( guard );
	}
}
