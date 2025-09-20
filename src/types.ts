export type ClearURLsProvider = {
	urlPattern: string;
	completeProvider?: boolean;
	rules?: string[];
	rawRules?: string[];
	referralMarketing?: string[];
	exceptions?: string[];
	redirections?: string[];
	forceRedirection?: boolean;
};

export type ClearURLsRules = {
	providers: Record<string, ClearURLsProvider>;
};
