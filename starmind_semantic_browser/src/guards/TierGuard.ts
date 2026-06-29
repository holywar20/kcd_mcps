import { AbstractGuard, GuardError } from './AbstractGuard'
import type { ToolRequest } from './AbstractGuard'
import { Whitelist } from '../config'
import { McpTrace } from '../McpTrace'

/**
 * TierGuard — the per-origin read/act split. Read-tier ops (navigate, read_page, read_raw, scroll)
 * always pass; act-tier ops (click, type) require the in-play origin to be granted the `act` tier.
 * Runs AFTER OriginWhitelistGuard, so a passing origin entry is guaranteed to exist for act ops.
 *
 * Lets a user grant an agent eyes on a site without hands — read a dashboard but never click it.
 */
export class TierGuard extends AbstractGuard {

	validate( req: ToolRequest ): void {
		if( !req.act ) {
			return
		}

		const entry = Whitelist.match( req.url )
		if( entry && entry.tier === 'act' ) {
			return
		}

		McpTrace.guard( 'starmind_semantic_browser.guard.rejected', { tool: req.tool, url: req.url, code: 'TIER_READ_ONLY' } )
		throw new GuardError(
			`Origin "${ Whitelist.origin( req.url ) }" is granted read-only; "${ req.tool }" needs the act tier`,
			'TIER_READ_ONLY',
		)
	}
}
