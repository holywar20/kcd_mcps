import { AbstractGuard, GuardError } from './AbstractGuard'
import type { ToolRequest } from './AbstractGuard'
import { Whitelist } from '../config'
import { McpTrace } from '../McpTrace'

/**
 * OriginWhitelistGuard — security Layer 2, the jail. The URL in play must belong to an ENABLED
 * whitelisted origin, or the call is denied. Enforced first and hardest at navigate (the target is
 * refused before any page loads) and on every subsequent op against the live current page (so an
 * in-page navigation off the whitelist can't be read or acted on).
 *
 * The whitelist is read fresh from the package store each call (Whitelist.match → loadConfig). An empty
 * whitelist denies everything — secure by default. Every denial traces to the GUARD channel, so it's
 * visible in the dev overlay, not just returned to the model.
 */
export class OriginWhitelistGuard extends AbstractGuard {

	validate( req: ToolRequest ): void {
		if( Whitelist.match( req.url ) ) {
			return
		}

		const code   = Whitelist.empty ? 'WHITELIST_EMPTY' : 'ORIGIN_NOT_WHITELISTED'
		const origin = Whitelist.origin( req.url ) ?? req.url
		McpTrace.guard( 'starmind_semantic_browser.guard.rejected', { tool: req.tool, url: req.url, code } )

		throw new GuardError(
			code === 'WHITELIST_EMPTY'
				? `No whitelisted origins configured; "${ origin }" denied`
				: `Origin "${ origin }" is not whitelisted`,
			code,
		)
	}
}
