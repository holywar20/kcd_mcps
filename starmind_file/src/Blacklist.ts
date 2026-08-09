import { Blacklist as SharedBlacklist } from 'kcd_sdk'
import { loadConfig } from './config'

/**
 * Blacklist — this server's config-bound face on the SHARED deny-list.
 *
 * The patterns and the subtree-matching rule live in `kcd_sdk` (`core/Blacklist.ts`), because the
 * in-process `starmind_files` built-in enforces the same deny-list from the main process and the two
 * run in different processes. A copy here would be a second security model wearing the same name.
 *
 * What stays local is the only thing that IS local: where the patterns come from. They are read fresh
 * from the package store on every call (loadConfig already merges the shared defaults in), so a config
 * change lands on the next tool call with no respawn.
 *
 * Enforcement is bifurcated by the CALLER, not here: discovery tools (list / glob / grep) drop denied
 * entries SILENTLY; read reports `out_of_scope` on a directly-named path. This answers only the one
 * question — is this path denied? — by pattern alone, never touching disk. That is what lets read
 * report policy WITHOUT a stat: it discloses the rule, not the file's existence.
 */
export class Blacklist {

	/** True when `path` is denied — the path or any ancestor directory matches a deny pattern. */
	static excludes( path: string ): boolean {
		return SharedBlacklist.excludes( path, loadConfig().blacklist )
	}
}
