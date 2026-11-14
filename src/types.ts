export type ValueRule = {
	// Anchored, case-sensitive regexes tested against the decoded key and value
	key: string;
	value: string;
	// When set, the value must also base64-decode to a payload matching this regex
	base64Payload?: string;
};

export type ClearURLsProvider = {
	urlPattern: string;
	completeProvider?: boolean;
	rules?: string[];
	// Not part of ClearURLs: removes a parameter only when both its key and value match
	valueRules?: ValueRule[];
	rawRules?: string[];
	referralMarketing?: string[];
	exceptions?: string[];
	redirections?: string[];
	forceRedirection?: boolean;
};

export type ClearURLsRules = {
	providers: Record<string, ClearURLsProvider>;
};
