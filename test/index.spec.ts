import { env, createExecutionContext, waitOnExecutionContext, fetchMock, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";

import worker, { RulesCache } from "../src/index";
import { cleanUrl } from "../src/cleaner";
import { mergeCustomRules } from "../src/rules-cache";
import type { ClearURLsRules } from "../src/types";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

// Sampled ClearURLs rules for testing
const mockRules: ClearURLsRules = {
	providers: {
		Google: {
			urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?google(?:\\.[a-z]{2,}){1,}",
			completeProvider: false,
			rules: ["ved", "ei", "source", "gs_lcp", "aqs", "sourceid", "uact", "rlz", "sclient", "client"],
			rawRules: [],
			referralMarketing: [],
			exceptions: [],
			redirections: [],
			forceRedirection: false,
		},
		YouTube: {
			urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?(youtube\\.com|youtu\\.be)",
			completeProvider: false,
			rules: ["feature", "gclid", "si", "pp", "ab_channel"],
			rawRules: [],
			referralMarketing: [],
			exceptions: [],
			redirections: [],
			forceRedirection: false,
		},
		Amazon: {
			urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?amazon(?:\\.[a-z]{2,}){1,}",
			completeProvider: false,
			rules: ["qid", "sr", "ref_", "keywords", "sprefix", "tag", "linkCode", "camp", "creative", "creativeASIN", "psc"],
			rawRules: [],
			referralMarketing: [],
			exceptions: [],
			redirections: [],
			forceRedirection: false,
		},
		TikTok: {
			urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?tiktok\\.com",
			completeProvider: false,
			rules: ["u_code", "_d", "_t", "timestamp", "share_app_name", "_r", "checksum", "language"],
			rawRules: [],
			referralMarketing: [],
			exceptions: [],
			redirections: [],
			forceRedirection: false,
		},
		globalRules: {
			urlPattern: ".*",
			completeProvider: false,
			rules: [
				"utm_source",
				"utm_medium",
				"utm_campaign",
				"utm_term",
				"utm_content",
				"mtm_campaign",
				"mtm_kwd",
				"ga_source",
				"ga_medium",
				"ga_term",
				"ga_content",
				"ga_campaign",
				"yclid",
				"_openstat",
				"fbclid",
				"gclid",
				"msclkid",
			],
			rawRules: [],
			referralMarketing: [],
			exceptions: [],
			redirections: [],
			forceRedirection: false,
		},
	},
};

beforeAll(() => {
	const mockStub = {
		getRules: () => Promise.resolve(mockRules),
	} as DurableObjectStub<RulesCache>;

	if (env.RULES_CACHE) {
		env.RULES_CACHE.getByName = () => mockStub;
	}
});

describe("URL Cleaner worker", () => {
	beforeEach(() => {
		fetchMock.activate();
		fetchMock.disableNetConnect();
		for (const origin of [
			"https://example.com",
			"https://youtube.com",
			"https://amazon.com",
			"https://google.com",
			"https://tiktok.com",
			"https://unknown-site.com",
			"https://nonexistent.com",
		]) {
			fetchMock.get(origin).intercept({ path: /.*/, method: "HEAD" }).reply(200).persist();
		}
	});

	afterEach(() => fetchMock.deactivate());

	it("cleans global tracking parameters", async () => {
		const testUrl = "https://example.com?utm_source=test&utm_medium=email&normal=keep";
		const request = new IncomingRequest(`http://example.com/?url=${encodeURIComponent(testUrl)}`);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const cleanedUrl = await response.text();
		expect(cleanedUrl).toBe("https://example.com/?normal=keep");
	});

	it("cleans YouTube tracking parameters", async () => {
		const testUrl = "https://youtube.com/watch?v=abc123&feature=share&si=trackingid&t=30";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		const cleanedUrl = await response.text();
		expect(cleanedUrl).toBe("https://youtube.com/watch?v=abc123&t=30");
	});

	it("cleans Amazon tracking parameters", async () => {
		const testUrl = "https://amazon.com/product?keywords=test&ref_=test&tag=mytag&normal=keep";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		const cleanedUrl = await response.text();
		expect(cleanedUrl).toBe("https://amazon.com/product?normal=keep");
	});

	it("cleans Google tracking parameters", async () => {
		const testUrl = "https://google.com/search?q=test&ved=123&ei=456&tbm=isch";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		const cleanedUrl = await response.text();
		expect(cleanedUrl).toBe("https://google.com/search?q=test&tbm=isch");
	});

	it("cleans TikTok tracking parameters specifically", async () => {
		const testUrl = "https://tiktok.com/video?_t=tracking&_r=more&u_code=123&normal=keep&other=stay";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		const cleanedUrl = await response.text();
		expect(cleanedUrl).toBe("https://tiktok.com/video?normal=keep&other=stay");
	});

	it("handles unknown domains gracefully", async () => {
		const testUrl = "https://unknown-site.com?page=1&sort=name&utm_source=test&fbclid=spam";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		const cleanedUrl = await response.text();
		expect(cleanedUrl).toBe("https://unknown-site.com/?page=1&sort=name");
	});

	it("applies global rules alongside site rules", async () => {
		const testUrl = "https://youtube.com/watch?v=abc&feature=share&utm_source=newsletter";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://youtube.com/watch?v=abc");
	});

	it("keeps repeated query parameters", async () => {
		const testUrl = "https://example.com/topic?tag=one&tag=two&utm_source=test";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://example.com/topic?tag=one&tag=two");
	});

	it("keeps repeated fragment parameters", async () => {
		const testUrl = "https://example.com/page#tag=one&tag=two&utm_source=test";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://example.com/page#tag=one&tag=two");
	});

	it("returns error for missing URL parameter", async () => {
		const response = await SELF.fetch("https://example.com/");
		expect(response.status).toBe(400);
		expect(await response.text()).toBe("Missing url parameter");
	});

	it("cleans URL fragments (hash parameters)", async () => {
		const testUrl = "https://example.com/page?normal=keep&utm_source=test#utm_campaign=fragment&other=stay";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		const cleanedUrl = await response.text();
		expect(cleanedUrl).toBe("https://example.com/page?normal=keep#other=stay");
	});

	it("handles invalid URLs gracefully", async () => {
		const response = await SELF.fetch("https://example.com/?url=not-a-valid-url");
		expect(response.status).toBe(200); // Should return original URL, not error
		expect(await response.text()).toBe("not-a-valid-url");
	});

	it("deletes cache entry on DELETE request", async () => {
		// First, make a GET request to cache the response
		const testUrl = "https://tiktok.com/video?_t=tracking&_r=more&u_code=123&normal=keep&other=stay";
		const getResponse = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(getResponse.status).toBe(200);
		expect(await getResponse.text()).toBe("https://tiktok.com/video?normal=keep&other=stay");

		// Then delete the cache entry
		const deleteResponse = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`, {
			method: "DELETE",
		});
		expect(deleteResponse.status).toBe(200);
		expect(await deleteResponse.text()).toBe("Cache entry deleted");

		const subsequentDeleteResponse = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`, {
			method: "DELETE",
		});
		expect(subsequentDeleteResponse.status).toBe(404);
		expect(await subsequentDeleteResponse.text()).toBe("Cache entry not found");
	});

	it("returns 404 when deleting non-existent cache entry", async () => {
		const testUrl = "https://nonexistent.com?param=value";

		const deleteResponse = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`, {
			method: "DELETE",
		});
		expect(deleteResponse.status).toBe(404);
		expect(await deleteResponse.text()).toBe("Cache entry not found");
	});

	it("returns 405 for unsupported HTTP methods", async () => {
		const testUrl = "https://example.com?utm_source=test";

		const postResponse = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`, {
			method: "POST",
		});
		expect(postResponse.status).toBe(405);
		expect(postResponse.headers.get("Allow")).toBe("GET, DELETE");
		expect(await postResponse.text()).toBe("Method not allowed");

		const putResponse = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`, {
			method: "PUT",
		});
		expect(putResponse.status).toBe(405);
		expect(await putResponse.text()).toBe("Method not allowed");
	});
});

describe("Redirect following", () => {
	beforeEach(() => {
		fetchMock.activate();
		fetchMock.disableNetConnect();
	});

	afterEach(() => fetchMock.deactivate());

	it("follows redirect when HEAD returns 3xx", async () => {
		fetchMock
			.get("https://short.test")
			.intercept({ path: "/abc", method: "HEAD" })
			.reply(301, "", { headers: { Location: "https://no-redirect.test/target" } });

		const testUrl = "https://short.test/abc";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://no-redirect.test/target");
	});

	it("falls back to GET when HEAD returns 404", async () => {
		const pool = fetchMock.get("https://amzn-short.test");
		pool.intercept({ path: "/d/abc123", method: "HEAD" }).reply(404);
		pool
			.intercept({ path: "/d/abc123", method: "GET" })
			.reply(301, "", { headers: { Location: "https://amazon.com/dp/B123?ref_=tracking&tag=mytag" } });

		const testUrl = "https://amzn-short.test/d/abc123";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://amazon.com/dp/B123");
	});

	it("falls back to GET when HEAD returns 405", async () => {
		const pool = fetchMock.get("https://head-unsupported.test");
		pool.intercept({ path: "/link", method: "HEAD" }).reply(405);
		pool.intercept({ path: "/link", method: "GET" }).reply(302, "", { headers: { Location: "https://no-redirect.test/destination" } });

		const testUrl = "https://head-unsupported.test/link";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://no-redirect.test/destination");
	});

	it("does not fall back to GET when HEAD returns 200", async () => {
		fetchMock.get("https://no-redirect.test").intercept({ path: "/page?utm_source=test", method: "HEAD" }).reply(200);

		const testUrl = "https://no-redirect.test/page?utm_source=test";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://no-redirect.test/page");
	});

	it("cleans parameters on the redirect target", async () => {
		fetchMock
			.get("https://redir.test")
			.intercept({ path: "/go", method: "HEAD" })
			.reply(301, "", { headers: { Location: "https://youtube.com/watch?v=xyz&feature=share&si=track" } });

		const testUrl = "https://redir.test/go";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://youtube.com/watch?v=xyz");
	});

	it("handles relative redirect locations", async () => {
		const pool = fetchMock.get("https://relative.test");
		pool.intercept({ path: "/short", method: "HEAD" }).reply(301, "", { headers: { Location: "/full/path" } });
		pool.intercept({ path: "/full/path", method: "HEAD" }).reply(200);

		const testUrl = "https://relative.test/short";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://relative.test/full/path");
	});

	it("does not follow login-wall redirects that embed the original URL", async () => {
		fetchMock
			.get("https://walled.test")
			.intercept({ path: "/profile", method: "HEAD" })
			.reply(302, "", {
				headers: { Location: "https://walled.test/accounts/login/?next=https%3A%2F%2Fwalled.test%2Fprofile&amp;is_from_rle=" },
			});

		const testUrl = "https://walled.test/profile";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://walled.test/profile");
	});

	it("does not follow login-wall redirects that embed the original path", async () => {
		fetchMock
			.get("https://walled.test")
			.intercept({ path: "/profile", method: "HEAD" })
			.reply(302, "", { headers: { Location: "/login?return_to=%2Fprofile" } });

		const testUrl = "https://walled.test/profile";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://walled.test/profile");
	});

	it("follows HTTPS upgrades when the source already carries a self-referential param", async () => {
		fetchMock
			.get("http://canon.test")
			.intercept({ path: "/article?next=%2Farticle", method: "HEAD" })
			.reply(301, "", { headers: { Location: "https://canon.test/article?next=%2Farticle" } });
		fetchMock.get("https://canon.test").intercept({ path: "/article?next=%2Farticle", method: "HEAD" }).reply(200);

		const testUrl = "http://canon.test/article?next=%2Farticle";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://canon.test/article?next=%2Farticle");
	});

	it("follows trailing-slash canonicalization when the source already carries a self-referential param", async () => {
		const pool = fetchMock.get("https://canon.test");
		pool
			.intercept({ path: "/article?next=%2Farticle", method: "HEAD" })
			.reply(301, "", { headers: { Location: "/article/?next=%2Farticle" } });
		pool.intercept({ path: "/article/?next=%2Farticle", method: "HEAD" }).reply(200);

		const testUrl = "https://canon.test/article?next=%2Farticle";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://canon.test/article/?next=%2Farticle");
	});

	it("resolves relative params against the redirect target, not the source", async () => {
		fetchMock
			.get("https://short.test")
			.intercept({ path: "/offer", method: "HEAD" })
			.reply(301, "", { headers: { Location: "https://shop.test/landing?continue=%2Foffer" } });
		fetchMock.get("https://shop.test").intercept({ path: "/landing?continue=%2Foffer", method: "HEAD" }).reply(200);

		const testUrl = "https://short.test/offer";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://shop.test/landing?continue=%2Foffer");
	});

	it("handles protocol-relative redirect locations", async () => {
		fetchMock
			.get("https://proto.test")
			.intercept({ path: "/go", method: "HEAD" })
			.reply(301, "", { headers: { Location: "//dest.test/page" } });
		fetchMock.get("https://dest.test").intercept({ path: "/page", method: "HEAD" }).reply(200);

		const testUrl = "https://proto.test/go";
		const response = await SELF.fetch(`https://example.com/?url=${encodeURIComponent(testUrl)}`);
		expect(await response.text()).toBe("https://dest.test/page");
	});
});

describe("Custom rules", () => {
	const upstreamXRules = ["(?:ref_?)?src", "s", "cn", "ref_url", "t"];
	const upstreamRules: ClearURLsRules = {
		providers: {
			x: { urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?x.com", rules: upstreamXRules },
			twitter: { urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?twitter.com", rules: upstreamXRules },
			globalRules: { urlPattern: ".*", rules: ["utm_source"] },
		},
	};

	beforeEach(() => {
		fetchMock.activate();
		fetchMock.disableNetConnect();
	});

	afterEach(() => fetchMock.deactivate());

	it.each(["https://x.com", "https://twitter.com"])("strips the share fingerprint from %s links", async (origin) => {
		fetchMock.get(origin).intercept({ path: /.*/, method: "HEAD" }).reply(200);

		const cleaned = await cleanUrl(
			`${origin}/user/status/123?a=uimaJy3bBcbyfnLBrjs&s=20&utm_source=share`,
			mergeCustomRules(upstreamRules),
		);
		expect(cleaned).toBe(`${origin}/user/status/123`);
	});
});

describe("Provider matching", () => {
	const globalRules = { urlPattern: ".*", rules: ["utm_source"] };

	beforeEach(() => {
		fetchMock.activate();
		fetchMock.disableNetConnect();
	});

	afterEach(() => fetchMock.deactivate());

	function stubHead(origin: string) {
		fetchMock.get(origin).intercept({ path: /.*/, method: "HEAD" }).reply(200);
	}

	it("lets a site exception disable only that site's rules", async () => {
		stubHead("https://www.amazon.com");
		const rules: ClearURLsRules = {
			providers: {
				amazon: {
					urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?amazon\\.com",
					rules: ["keywords", "qid"],
					exceptions: ["^https?:\\/\\/(?:[a-z0-9-]+\\.)*?amazon\\.com\\/s\\?"],
				},
				"amazon search": { urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?amazon\\.com\\/s\\?", rules: ["qid"] },
				globalRules,
			},
		};

		const cleaned = await cleanUrl("https://www.amazon.com/s?keywords=book&qid=123&utm_source=x", rules);
		expect(cleaned).toBe("https://www.amazon.com/s?keywords=book");
	});

	it("lets a global exception disable only the global rules", async () => {
		stubHead("https://site.test");
		const rules: ClearURLsRules = {
			providers: {
				globalRules: { ...globalRules, exceptions: ["^https?:\\/\\/site\\.test\\/keep"] },
				site: { urlPattern: "^https?:\\/\\/site\\.test", rules: ["tracker"] },
			},
		};

		const cleaned = await cleanUrl("https://site.test/keep?tracker=1&utm_source=x", rules);
		expect(cleaned).toBe("https://site.test/keep?utm_source=x");
	});

	it("keeps cleaning URLs that a provider marks as blocked", async () => {
		stubHead("https://www.youtube.com");
		const rules: ClearURLsRules = {
			providers: {
				globalRules,
				youtube_pagead: { urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?youtube\\.com\\/pagead", completeProvider: true },
			},
		};

		const cleaned = await cleanUrl("https://www.youtube.com/pagead?utm_source=x", rules);
		expect(cleaned).toBe("https://www.youtube.com/pagead");
	});

	it("unwraps redirections from a blocked provider", async () => {
		stubHead("https://dest.test");
		const rules: ClearURLsRules = {
			providers: {
				ads: {
					urlPattern: "^https?:\\/\\/ads\\.test",
					completeProvider: true,
					redirections: ["^https?:\\/\\/ads\\.test\\/click\\?url=([^&]+)"],
				},
				globalRules,
			},
		};

		const cleaned = await cleanUrl("https://ads.test/click?url=https%3A%2F%2Fdest.test%2Fpage%3Futm_source%3Dx", rules);
		expect(cleaned).toBe("https://dest.test/page");
	});

	it("checks redirections against the URL cleaned by earlier providers", async () => {
		stubHead("https://dest.test");
		const rules: ClearURLsRules = {
			providers: {
				globalRules,
				wrapper: { urlPattern: "^https?:\\/\\/wrap\\.test", redirections: ["^https?:\\/\\/wrap\\.test\\/out\\?url=([^&]+)$"] },
			},
		};

		const cleaned = await cleanUrl("https://wrap.test/out?utm_source=x&url=https%3A%2F%2Fdest.test%2Fpage", rules);
		expect(cleaned).toBe("https://dest.test/page");
	});

	it("runs another pass when a later provider lifts a global exception", async () => {
		stubHead("https://site.test");
		const rules: ClearURLsRules = {
			providers: {
				globalRules: { ...globalRules, exceptions: ["^https?:\\/\\/site\\.test\\/.*?[?&]ref="] },
				site: { urlPattern: "^https?:\\/\\/site\\.test", rules: ["ref"] },
			},
		};

		const cleaned = await cleanUrl("https://site.test/page?ref=x&utm_source=y", rules);
		expect(cleaned).toBe("https://site.test/page");
	});

	it("matches provider URL patterns case-insensitively", async () => {
		stubHead("https://www.linkedin.com");
		const rules: ClearURLsRules = {
			providers: {
				"LinkedIn Learning": { urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?linkedin\\.com\\/learning", rules: ["u"] },
				globalRules,
			},
		};

		const cleaned = await cleanUrl("https://www.linkedin.com/LEARNING/course?u=123", rules);
		expect(cleaned).toBe("https://www.linkedin.com/LEARNING/course");
	});

	it("applies raw rules before parameter rules", async () => {
		stubHead("https://site.test");
		const rules: ClearURLsRules = {
			providers: {
				site: { urlPattern: "^https?:\\/\\/site\\.test", rawRules: ["x-(?=trk=)"], rules: ["trk"] },
				globalRules,
			},
		};

		const cleaned = await cleanUrl("https://site.test/page?x-trk=1", rules);
		expect(cleaned).toBe("https://site.test/page");
	});
});
