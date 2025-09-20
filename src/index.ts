import { cleanUrl } from "./cleaner";
import { RulesCache } from "./rules-cache";

type Env = {
	RULES_CACHE: DurableObjectNamespace<RulesCache>;
};

export { RulesCache };

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const targetUrl = url.searchParams.get("url");

		if (!targetUrl) {
			return new Response("Missing url parameter", { status: 400 });
		}

		const cache = caches.default;
		const cacheKey = new Request(`${url.origin}/cache/${encodeURIComponent(targetUrl)}`);

		let response = await cache.match(cacheKey);
		if (response) {
			return response;
		}

		try {
			const rulesStub = env.RULES_CACHE.getByName("rules");
			const rules = await rulesStub.getRules();

			const cleanedUrl = await cleanUrl(targetUrl, rules);
			response = new Response(cleanedUrl, {
				headers: {
					"Content-Type": "text/plain",
					"Access-Control-Allow-Origin": "*",
					"Cache-Control": "public, max-age=3600",
				},
			});

			ctx.waitUntil(cache.put(cacheKey, response.clone()));
			return response;
		} catch (error) {
			return new Response(`Error processing URL: ${error instanceof Error ? error.message : "Unknown error"}`, {
				status: 500,
			});
		}
	},
} satisfies ExportedHandler<Env>;
