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

/** A single inbound link from kcd_links — an artifact that points at the target. */
export interface InboundLink {
	path:         string;
	relativePath: string;
}
