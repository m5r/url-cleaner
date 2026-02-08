import type { ClearURLsRules } from "./types";

export async function cleanUrl(inputUrl: string, rules: ClearURLsRules, maxRedirects = 5, visited = new Set<string>()) {
	try {
		const currentUrl = new URL(inputUrl);

		if (visited.has(currentUrl.href) || visited.size >= maxRedirects) {
			return cleanUrlParameters(currentUrl, rules.providers);
		}

		visited.add(currentUrl.href);

		// Check for ClearURLs redirections first
		const clearUrlsRedirect = checkClearUrlsRedirections(currentUrl.href, rules.providers);
		if (clearUrlsRedirect && clearUrlsRedirect !== currentUrl.href) {
			return await cleanUrl(clearUrlsRedirect, rules, maxRedirects, visited);
		}

		// Then check for HTTP redirects
		const redirectTarget = await followRedirect(currentUrl.href);
		if (redirectTarget && redirectTarget !== currentUrl.href) {
			return await cleanUrl(redirectTarget, rules, maxRedirects, visited);
		}

		return cleanUrlParameters(currentUrl, rules.providers);
	} catch (error) {
		console.error(`Error caught when trying to clean url ${inputUrl}`, error);
		return inputUrl;
	}
}

function extractRedirectLocation(originalUrl: string, response: Response) {
	if (response.status < 300 || response.status >= 400) return null;
	const location = response.headers.get("Location");
	if (!location) return null;
	if (location.startsWith("/")) {
		const base = new URL(originalUrl);
		return `${base.protocol}//${base.host}${location}`;
	}
	return location;
}

async function followRedirect(url: string) {
	const headers: HeadersInit = {
		"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
		Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"Accept-Language": "en-US,en;q=0.5",
		"Accept-Encoding": "gzip, deflate, br, zstd",
		"Sec-GPC": "1",
		"Upgrade-Insecure-Requests": "1",
		"Sec-Fetch-Dest": "document",
		"Sec-Fetch-Mode": "navigate",
		"Sec-Fetch-Site": "none",
		"Sec-Fetch-User": "?1",
		Connection: "keep-alive",
	};

	try {
		const headResponse = await fetch(url, { method: "HEAD", redirect: "manual", headers });
		const redirect = extractRedirectLocation(url, headResponse);
		if (redirect) return redirect;

		if (headResponse.status === 404 || headResponse.status === 405) {
			const getResponse = await fetch(url, { method: "GET", redirect: "manual", headers });
			return extractRedirectLocation(url, getResponse);
		}

		return null;
	} catch (error) {
		return null;
	}
}

function cleanUrlParameters(url: URL, providers: ClearURLsRules["providers"]) {
	const matchingProvider = findMatchingProvider(url.href, providers);

	if (!matchingProvider) {
		return url.href;
	}

	if (matchingProvider.completeProvider === true) {
		throw new Error("URL blocked by ClearURLs rules");
	}

	if (matchingProvider.exceptions && isException(url.href, matchingProvider.exceptions)) {
		return url.href;
	}

	if (matchingProvider.rules && matchingProvider.rules.length > 0) {
		url = cleanParametersByRules(url, matchingProvider.rules);
		url = cleanFragmentsByRules(url, matchingProvider.rules);
	}

	if (matchingProvider.rawRules && matchingProvider.rawRules.length > 0) {
		let cleaned = url.href;
		for (const rawRule of matchingProvider.rawRules) {
			try {
				cleaned = cleaned.replace(new RegExp(rawRule, "gi"), "");
			} catch (error) {
				console.warn(`Invalid raw rule regex: ${rawRule}`, error);
			}
		}
		try {
			url = new URL(cleaned);
		} catch (error) {
			console.warn("Raw rule produced invalid URL, skipping", error);
		}
	}

	return url.href;
}

function findMatchingProvider(url: string, providers: ClearURLsRules["providers"]) {
	const { globalRules, ...otherProviders } = providers;

	for (const [providerName, provider] of Object.entries(otherProviders)) {
		try {
			const regex = new RegExp(provider.urlPattern);
			if (regex.test(url)) {
				return provider;
			}
		} catch (error) {
			console.warn(`Invalid URL pattern for provider ${providerName}: ${provider.urlPattern}`, error);
		}
	}

	return globalRules;
}

function cleanParametersByRules(url: URL, rules: string[]) {
	const params = new URLSearchParams(url.search);
	const cleanParams = new URLSearchParams();

	for (const [key, value] of params) {
		let shouldRemove = false;

		for (const rule of rules) {
			try {
				if (new RegExp("^" + rule + "$", "gi").test(key)) {
					shouldRemove = true;
					break;
				}
			} catch (error) {
				console.warn(`Invalid rule regex: ${rule}`, error);
			}
		}

		if (!shouldRemove) {
			cleanParams.set(key, value);
		}
	}

	url.search = cleanParams.toString();
	return url;
}

function cleanFragmentsByRules(url: URL, rules: string[]) {
	const fragments = extractFragments(url);
	const cleanFragments = new Map<string, string | null>();

	for (const [key, value] of fragments) {
		let shouldRemove = false;

		for (const rule of rules) {
			try {
				if (new RegExp("^" + rule + "$", "gi").test(key)) {
					shouldRemove = true;
					break;
				}
			} catch (error) {
				console.warn(`Invalid rule regex: ${rule}`, error);
			}
		}

		if (!shouldRemove) {
			cleanFragments.set(key, value);
		}
	}

	url.hash = fragmentsToString(cleanFragments);
	return url;
}

function extractFragments(url: URL) {
	const fragments = new Map<string, string | null>();
	const hash = url.hash.slice(1); // Remove the #

	if (!hash) return fragments;

	const params = hash.split("&");
	for (const p of params) {
		const param = p.split("=");
		if (!param[0]) continue;

		const key = param[0];
		let value: string | null = null;
		if (param.length === 2 && param[1]) {
			value = param[1];
		}
		fragments.set(key, value);
	}

	return fragments;
}

function fragmentsToString(fragments: Map<string, string | null>) {
	const parts: string[] = [];
	for (const [key, value] of fragments) {
		if (value !== null) {
			parts.push(key + "=" + value);
		} else {
			parts.push(key);
		}
	}
	return parts.length > 0 ? parts.join("&") : "";
}

function isException(url: string, exceptions: string[]) {
	for (const exception of exceptions) {
		try {
			const regex = new RegExp(exception, "i");
			if (regex.test(url)) {
				return true;
			}
		} catch (error) {
			console.warn(`Invalid exception regex: ${exception}`, error);
		}
	}
	return false;
}

function checkClearUrlsRedirections(url: string, providers: ClearURLsRules["providers"]) {
	const matchingProvider = findMatchingProvider(url, providers);

	if (!matchingProvider || !matchingProvider.redirections) {
		return null;
	}

	for (const redirectionPattern of matchingProvider.redirections) {
		try {
			const regex = new RegExp(redirectionPattern, "i");
			const match = url.match(regex);
			if (match && match[1]) {
				// First capture group is the target URL
				return decodeURIComponent(match[1]);
			}
		} catch (error) {
			console.warn(`Invalid redirection regex: ${redirectionPattern}`, error);
		}
	}

	return null;
}
