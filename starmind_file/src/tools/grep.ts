import { GuardChain } from '../guards'
import { MCPUtils } from '../MCPUtils'
import { Blacklist } from '../Blacklist'
import { McpTrace } from '../McpTrace'
import { loadConfig } from '../config'
import type { ToolDefinition, TestSpec } from 'kcd_sdk'

type GrepRow = { path: string; lineNumber: number; line: string }

// Result floors — bound the wire and the work. A grep that returns thousands of hits is useless to
// the model and expensive to ship; these keep it focused. The FILE cap is config (grepFileCap); these
// MATCH caps are constants for v1 (surface to config later if a real consumer needs it).
const MATCH_CAP          = 200    // max total match rows across all files
const PER_FILE_MATCH_CAP = 20     // max rows from any one file — one noisy file can't flood the result
const MAX_LINE_LEN       = 1000   // a matched line longer than this is truncated (minified-file guard)

/**
 * grep — LITERAL content search under a whitelisted root. The deliberate non-feature: it takes a
 * literal string, never a regex. A backtracking engine (JS RegExp) on an agent-supplied pattern is a
 * ReDoS hole — one pathological pattern hangs the child. A linear-time engine (RE2 / ripgrep) is the
 * only safe way to add real regex, and that is deferred to a real consumer.
 *
 * Composed entirely from the blunt core, so the core stays pristine: core.glob enumerates candidate
 * files, the Blacklist drops denied paths from that candidate list (so a secret is NEVER read — it's
 * gone before any read), core.read pulls survivors (inheriting the text-gate + 1 MiB floor for free),
 * and the literal match runs here. The root is jailed by the chain (single path, all-or-nothing, like
 * glob); blacklisted hits are dropped SILENTLY (this is discovery, not a direct read). Cap overflows
 * are made-safe locally and bubble to the WARNINGS trace channel.
 */
export function grepTools( chain: GuardChain ): ( ToolDefinition & { spec?: TestSpec[] } )[] {
	return [
		{
			name:        'grep',
			annotations: { readOnlyHint: true },
			spec: [
				{ label: 'rejects a non-whitelisted root', input: { path: 'C:\\Windows\\System32', query: 'x' }, assertions: [ { type: 'error_expected' } ] },
			],
			description: 'Search file CONTENTS for a literal string under a whitelisted root (not a regex). Returns { path, lineNumber, line } per matching line. Flags: caseInsensitive, wholeWord, glob (a file filter).',
			inputSchema: {
				type:       'object',
				properties: {
					path:            { type: 'string',  description: 'Absolute root directory to search under; must sit inside a whitelisted root.' },
					query:           { type: 'string',  description: 'Literal text to find in file contents (not a regex / glob).' },
					caseInsensitive: { type: 'boolean', description: 'Match regardless of case. Default false.' },
					wholeWord:       { type: 'boolean', description: 'Match only when the query is bounded by non-word characters. Default false.' },
					glob:            { type: 'string',  description: 'Optional glob limiting which files are searched (relative to root, e.g. "**/*.ts"). Default all files.' },
				},
				required:   [ 'path', 'query' ],
			},
			handler: async ( args, meta ) => {
				try {
					// `meta` is forwarded opaque — the guard reads the grants off it, this handler never does.
					chain.run( { tool: 'grep', params: args, meta } )

					const root  = String( args[ 'path' ] ?? '' )
					const query = String( args[ 'query' ] ?? '' )
					if( query.length === 0 ) {
						return MCPUtils.error( 'grep: "query" must be a non-empty string' )
					}

					const caseInsensitive = args[ 'caseInsensitive' ] === true
					const wholeWord       = args[ 'wholeWord' ] === true
					// Default '**' (not '**/*') — the shared Glob matcher requires a literal '/' for '**/*',
					// so '**/*' would skip top-level files. '**' → matches every path at any depth.
					const filePattern     = typeof args[ 'glob' ] === 'string' && args[ 'glob' ] ? String( args[ 'glob' ] ) : '**'

					// Candidates: core.glob finds files, the blacklist removes denied ones BEFORE any read,
					// then the per-search file cap (config) bounds the work.
					const fileCap    = loadConfig().grepFileCap
					const candidates: string[] = []
					for( const entry of MCPUtils.files.glob( root, filePattern ) ) {
						if( entry.isDir ) {
							continue
						}
						if( Blacklist.excludes( entry.path ) ) {
							continue
						}
						candidates.push( entry.path )
					}
					if( candidates.length > fileCap ) {
						McpTrace.warn( 'starmind_file.grep.files_capped', { root, pattern: filePattern, total: candidates.length, cap: fileCap } )
					}
					const searched = candidates.slice( 0, fileCap )

					const rows: GrepRow[] = []
					let   matchesCapped   = false
					for( const file of searched ) {
						const content = MCPUtils.files.read( file )   // null = binary / too_large / unreadable → skip (core already warned)
						if( content === null ) {
							continue
						}

						let perFile = 0
						const lines = content.split( /\r?\n/ )
						for( let i = 0; i < lines.length; i += 1 ) {
							if( !lineMatches( lines[ i ], query, caseInsensitive, wholeWord ) ) {
								continue
							}
							rows.push( { path: file, lineNumber: i + 1, line: truncateLine( lines[ i ] ) } )
							perFile += 1
							if( rows.length >= MATCH_CAP ) {
								matchesCapped = true
								break
							}
							if( perFile >= PER_FILE_MATCH_CAP ) {
								break
							}
						}
						if( matchesCapped ) {
							break
						}
					}

					if( matchesCapped ) {
						McpTrace.warn( 'starmind_file.grep.matches_capped', { root, query, cap: MATCH_CAP } )
					}

					return MCPUtils.result( rows )
				} catch ( e ) {
					return MCPUtils.error( e instanceof Error ? e.message : String( e ) )
				}
			},
		},
	]
}

/** Does one line contain the literal query, honouring the flags? Literal only — no regex on the
 *  query, so no ReDoS surface. wholeWord requires non-word chars (or a line edge) on both sides. */
function lineMatches( line: string, query: string, caseInsensitive: boolean, wholeWord: boolean ): boolean {
	const hay    = caseInsensitive ? line.toLowerCase() : line
	const needle = caseInsensitive ? query.toLowerCase() : query

	let from = 0
	while( true ) {
		const idx = hay.indexOf( needle, from )
		if( idx === -1 ) {
			return false
		}
		if( !wholeWord ) {
			return true
		}
		const before = idx === 0 ? '' : hay[ idx - 1 ]
		const after  = idx + needle.length >= hay.length ? '' : hay[ idx + needle.length ]
		if( !isWordChar( before ) && !isWordChar( after ) ) {
			return true
		}
		from = idx + 1
	}
}

/** A word character is [A-Za-z0-9_] — checked by code point so the matcher stays regex-free. */
function isWordChar( ch: string ): boolean {
	if( ch === '' ) {
		return false
	}
	const c = ch.charCodeAt( 0 )
	return ( c >= 48 && c <= 57 ) || ( c >= 65 && c <= 90 ) || ( c >= 97 && c <= 122 ) || c === 95
}

/** Truncate an over-long matched line so one minified file can't dump a megabyte on a single line. */
function truncateLine( line: string ): string {
	return line.length > MAX_LINE_LEN ? line.slice( 0, MAX_LINE_LEN ) + '…' : line
}
