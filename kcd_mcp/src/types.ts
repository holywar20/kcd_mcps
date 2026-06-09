/** A single search result from kcd_search. */
export interface SearchHit {
	path:        string;
	type:        string;
	/** 100-char window centered on the first match position, newlines collapsed. */
	excerpt:     string;
	matchOffset: number;
}

/** A single validation issue from kcd_health. */
export interface HealthIssue {
	path:      string;
	severity:  'error' | 'warn';
	message:   string;
	field?:    string;
	section?:  string;
}

/** Full output of kcd_health. */
export interface HealthReport {
	issues:  HealthIssue[];
	summary: {
		total:    number;
		errors:   number;
		warnings: number;
	};
}

/** Output of kcd_save. */
export interface SaveResult {
	saved:  string[];
	failed: Array<{ path: string; error: string }>;
}

// ── Tool response helpers ─────────────────────────────────────────────────────

type TextBlock = { type: 'text'; text: string };

/** Wrap any serialisable value in the MCP text-content envelope. */
export function toolResult( data: unknown ): { content: TextBlock[] } {
	return { content: [ { type: 'text', text: JSON.stringify( data, null, 2 ) } ] };
}

/** Return an error response that the MCP client surfaces as a tool failure. */
export function toolError( message: string ): { content: TextBlock[]; isError: true } {
	return { content: [ { type: 'text', text: message } ], isError: true };
}
