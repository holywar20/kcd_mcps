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

/** A single inbound link from kcd_links — an artifact that points at the target. */
export interface InboundLink {
	path:         string;
	relativePath: string;
}
