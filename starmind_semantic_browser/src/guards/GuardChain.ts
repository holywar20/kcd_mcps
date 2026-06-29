import { AbstractGuard } from './AbstractGuard'
import type { ToolRequest } from './AbstractGuard'

/**
 * Ordered guard runner. Calls validate() on each guard in insertion order, stopping at the first
 * GuardError — which propagates to the GuardedSession and then the tool handler. Order matters:
 * OriginWhitelistGuard runs before TierGuard, so the tier check can assume the origin already passed.
 */
export class GuardChain {

	private guards: AbstractGuard[]

	constructor( ...guards: AbstractGuard[] ) {
		this.guards = [ ...guards ]
	}

	/** Run all guards against the request. Throws GuardError on the first rejection. */
	run( req: ToolRequest ): void {
		for( const guard of this.guards ) {
			guard.validate( req )
		}
	}

	/** Append a guard to the end of the chain (e.g. a future CapabilityGuard). */
	add( guard: AbstractGuard ): void {
		this.guards.push( guard )
	}
}
