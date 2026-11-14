import type { ClearURLsProvider, ClearURLsRules } from "./types";

const MAX_CLEANING_PASSES = 10;

type Providers = ClearURLsRules["providers"];
type CleaningResult = { href: string; redirectTo: string | null };

export async function cleanUrl(inputUrl: string, rules: ClearURLsRules, redirectsLeft = 5, requested = new Set<string>()) {
	try {
		const canFollow = redirectsLeft > 0;
		const { href: cleanedHref, redirectTo } = applyRules(new URL(inputUrl).href, rules.providers, canFollow);
		if (redirectTo) {
			return await cleanUrl(redirectTo, rules, redirectsLeft - 1, requested);
		}

		if (!canFollow || requested.has(cleanedHref)) {
			return cleanedHref;
		}
		requested.add(cleanedHref);

		// Request the cleaned URL so the site never receives the tracking params we strip
		const redirectTarget = await followRedirect(cleanedHref);
		if (redirectTarget && redirectTarget !== cleanedHref) {
			return await cleanUrl(redirectTarget, rules, redirectsLeft - 1, requested);
		}

		return cleanedHref;
	} catch (error) {
		console.error(`Error caught when trying to clean url ${inputUrl}`, error);
		return inputUrl;
	}
}

function extractRedirectLocation(originalUrl: string, response: Response) {
	if (response.status < 300 || response.status >= 400) return null;
	const location = response.headers.get("Location");
	if (!location) return null;
	const target = new URL(location, originalUrl).href;
	// Login walls (e.g. Instagram for datacenter IPs) redirect to `/login?next=<original url>`
	if (pointsBackTo(target, originalUrl)) return null;
	return target;
}

function pointsBackTo(target: string, source: string) {
	const sourceUrl = new URL(source);
	const targetUrl = new URL(target);
	const inheritedValues = new Set(sourceUrl.searchParams.values());
	for (const value of targetUrl.searchParams.values()) {
		if (inheritedValues.has(value)) continue;
		if (!value.startsWith("/") && !/^https?:/i.test(value)) continue;
		try {
			const candidate = new URL(value, targetUrl);
			if (candidate.host === sourceUrl.host && candidate.pathname === sourceUrl.pathname) return true;
		} catch {}
	}
	return false;
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

// Mirrors the ClearURLs extension's pureCleaning: repeat full passes until the URL stops changing
function applyRules(href: string, providers: Providers, unwrapRedirects: boolean): CleaningResult {
	let current = href;
	for (let pass = 0; pass < MAX_CLEANING_PASSES; pass++) {
		const result = cleaningPass(current, providers, unwrapRedirects);
		if (result.redirectTo !== null || result.href === current) {
			return result;
		}
		current = result.href;
	}
	return { href: current, redirectTo: null };
}

// Every applicable provider runs, in rules-data order, on the URL as cleaned by the providers before it
function cleaningPass(href: string, providers: Providers, unwrapRedirects: boolean): CleaningResult {
	let current = href;
	for (const [providerName, provider] of Object.entries(providers)) {
		if (!providerApplies(providerName, provider, current)) {
			continue;
		}

		if (unwrapRedirects) {
			const redirectTo = findRedirection(current, provider.redirections ?? []);
			if (redirectTo && redirectTo !== current) {
				return { href: current, redirectTo };
			}
		}

		// The extension blocks these only on page loads; its "Copy clean link" skips them and keeps cleaning
		if (provider.completeProvider) {
			continue;
		}

		current = applyProviderRules(current, provider);
	}
	return { href: current, redirectTo: null };
}

function providerApplies(providerName: string, provider: ClearURLsProvider, href: string) {
	try {
		if (!new RegExp(provider.urlPattern, "i").test(href)) {
			return false;
		}
	} catch (error) {
		console.warn(`Invalid URL pattern for provider ${providerName}: ${provider.urlPattern}`, error);
		return false;
	}

	return !isException(href, provider.exceptions ?? []);
}

function applyProviderRules(href: string, provider: ClearURLsProvider) {
	const { href: rawCleaned } = applyRawRules(href, provider.rawRules ?? []);
	const rules = provider.rules ?? [];
	return rules.length > 0 ? removeTrackingParams(rawCleaned, rules) : rawCleaned;
}

function applyRawRules(href: string, rawRules: string[]) {
	let cleaned = href;
	for (const rawRule of rawRules) {
		try {
			cleaned = cleaned.replace(new RegExp(rawRule, "gi"), "");
		} catch (error) {
			console.warn(`Invalid raw rule regex: ${rawRule}`, error);
		}
	}

	try {
		return new URL(cleaned);
	} catch (error) {
		console.warn("Raw rule produced invalid URL, skipping", error);
		return new URL(href);
	}
}

const TEXT_DIRECTIVE = ":~:";

// Cuts matching segments out of the href string and keeps everything else byte-for-byte, so surviving params are never re-encoded
function removeTrackingParams(href: string, rules: string[]) {
	const [beforeHash, fragment] = splitOnce(href, "#");
	const [base, query] = splitOnce(beforeHash, "?");
	const cleanedQuery = query === null ? null : cleanQuery(query, rules);
	const cleanedFragment = fragment === null ? null : cleanFragment(fragment, rules);
	return base + (cleanedQuery === null ? "" : `?${cleanedQuery}`) + (cleanedFragment === null ? "" : `#${cleanedFragment}`);
}

function cleanQuery(query: string, rules: string[]) {
	const cleaned = removeSegments(query, (segment) => segment !== "" && keyMatchesRule(segment, rules));
	if (cleaned === null) {
		return query;
	}
	return cleaned === "" ? null : cleaned;
}

function cleanFragment(fragment: string, rules: string[]) {
	const directiveIndex = fragment.indexOf(TEXT_DIRECTIVE);
	const params = directiveIndex === -1 ? fragment : fragment.slice(0, directiveIndex);
	const directive = directiveIndex === -1 ? "" : fragment.slice(directiveIndex);

	// Hash routes like `#/path?x=1` carry their params after the `?`; bare anchors like `#mc` are never params
	const [route, routeParams] = splitOnce(params, "?");
	const cleaned = removeSegments(routeParams ?? route, (segment) => segment.includes("=") && keyMatchesRule(segment, rules));
	if (cleaned === null) {
		return fragment;
	}

	let cleanedParams = cleaned;
	if (routeParams !== null) {
		cleanedParams = cleaned === "" ? route : `${route}?${cleaned}`;
	}
	const cleanedFragment = cleanedParams + directive;
	return cleanedFragment === "" ? null : cleanedFragment;
}

// Null when nothing matched; otherwise the surviving segments without the empty ones a removal left at the edges
function removeSegments(list: string, shouldRemove: (segment: string) => boolean) {
	const segments = list.split("&");
	const kept = segments.filter((segment) => !shouldRemove(segment));
	if (kept.length === segments.length) {
		return null;
	}

	while (kept.length > 0 && kept[0] === "") {
		kept.shift();
	}
	while (kept.length > 0 && kept[kept.length - 1] === "") {
		kept.pop();
	}
	return kept.join("&");
}

function keyMatchesRule(segment: string, rules: string[]) {
	const rawKey = segment.split("=", 1)[0];
	// Rules target decoded keys, but some spell escapes out literally, e.g. `(?:%3F)?utm…`
	const keys = [rawKey, formDecode(rawKey)];

	return rules.some((rule) => {
		try {
			const regex = new RegExp("^" + rule + "$", "i");
			return keys.some((key) => regex.test(key));
		} catch (error) {
			console.warn(`Invalid rule regex: ${rule}`, error);
			return false;
		}
	});
}

// The lenient decoding URLSearchParams applies: `+` is a space and malformed escapes stay literal instead of throwing
function formDecode(value: string) {
	return new URLSearchParams(`k=${value}`).get("k") ?? value;
}

function splitOnce(value: string, separator: string): [string, string | null] {
	const index = value.indexOf(separator);
	return index === -1 ? [value, null] : [value.slice(0, index), value.slice(index + 1)];
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

function findRedirection(url: string, redirections: string[]) {
	for (const redirectionPattern of redirections) {
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
