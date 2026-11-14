import { DurableObject } from "cloudflare:workers";
import type { ClearURLsProvider, ClearURLsRules } from "./types";

const RULES_URL = "https://rules2.clearurls.xyz/data.minify.json";
const HASH_URL = "https://rules2.clearurls.xyz/rules.minify.hash";
const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Custom rules for tracking parameters not yet in ClearURLs database
const CUSTOM_RULES: Record<string, Pick<ClearURLsProvider, "rules" | "valueRules">> = {
	airbnb: {
		// Additional Airbnb tracking parameters found in share URLs
		rules: ["viralityEntryPoint", "unique_share_id", "slcid", "s", "slug"],
	},
	google: {
		// Additional Google Maps tracking parameters
		rules: ["lucs", "g_ep", "skid", "g_st"],
	},
	// `a` is a per-share fingerprint added by "Copy link" (https://github.com/ClearURLs/Rules/issues/352).
	// Drop once https://github.com/ClearURLs/Rules/pull/354 ships.
	x: {
		rules: ["a"],
	},
	twitter: {
		rules: ["a"],
	},
	// Share links carry a per-share token under a random 4-letter key, e.g. `?xtok=cnF3NHJleTFicGY%3D`
	// (https://github.com/ClearURLs/Rules/issues/351). The key rotates, so match the value instead: base64 of
	// a short lowercase alphanumeric payload (`rqw4rey1bpf` here), which ordinary params don't decode to.
	instagram: {
		valueRules: [{ key: "[a-z]{4}", value: "[A-Za-z0-9]{14,18}={0,2}", base64Payload: "[a-z0-9]{10,13}" }],
	},
};

type CachedRules = {
	data: ClearURLsRules;
	hash: string;
	cachedAt: number;
	expiresAt: number;
};

export class RulesCache extends DurableObject {
	async getRules() {
		try {
			const cached = await this.ctx.storage.get<CachedRules>("rules");

			let baseRules: ClearURLsRules;
			if (cached && Date.now() < cached.expiresAt) {
				baseRules = cached.data;
			} else {
				console.log("Fetching fresh rules from ClearURLs");
				baseRules = await this.fetchAndCacheRules();
			}

			return mergeCustomRules(baseRules);
		} catch (error) {
			console.error("Error getting rules:", error);

			// Try to return cached rules even if expired as fallback
			const cached = await this.ctx.storage.get<CachedRules>("rules");
			if (cached) {
				console.log("Falling back to expired cached rules");
				return mergeCustomRules(cached.data);
			}

			throw new Error("Failed to get rules and no cached fallback available");
		}
	}

	private async fetchAndCacheRules() {
		const [rulesResponse, hashResponse] = await Promise.all([fetch(RULES_URL), fetch(HASH_URL)]);
		if (!rulesResponse.ok) {
			throw new Error(`Failed to fetch rules: ${rulesResponse.status}`);
		}
		if (!hashResponse.ok) {
			throw new Error(`Failed to fetch hash: ${hashResponse.status}`);
		}

		const [rulesText, expectedHash] = await Promise.all([rulesResponse.text(), hashResponse.text()]);
		const actualHash = await this.calculateSHA256(rulesText);
		if (actualHash !== expectedHash.trim()) {
			throw new Error(`Hash validation failed. Expected: ${expectedHash.trim()}, Actual: ${actualHash}`);
		}

		const rules = JSON.parse(rulesText) as ClearURLsRules;
		const now = Date.now();
		const cachedRules: CachedRules = {
			data: rules,
			hash: actualHash,
			cachedAt: now,
			expiresAt: now + CACHE_DURATION_MS,
		};

		await this.ctx.storage.put("rules", cachedRules);
		console.log(`Cached rules with hash: ${actualHash}`);

		return rules;
	}

	private async calculateSHA256(text: string) {
		const encoder = new TextEncoder();
		const data = encoder.encode(text);
		const hashBuffer = await crypto.subtle.digest("SHA-256", data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	}
}

export function mergeCustomRules(rules: ClearURLsRules) {
	const mergedRules = structuredClone(rules);

	for (const [providerName, { rules: customRules = [], valueRules: customValueRules = [] }] of Object.entries(CUSTOM_RULES)) {
		const provider = mergedRules.providers[providerName];
		if (!provider) {
			continue;
		}

		provider.rules = [...new Set([...(provider.rules ?? []), ...customRules])];
		provider.valueRules = [...(provider.valueRules ?? []), ...customValueRules];
	}

	return mergedRules;
}
