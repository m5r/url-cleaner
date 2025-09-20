import { env, createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

import worker, { RulesCache } from "../src/index";
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
