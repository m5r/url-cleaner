# URL Cleaner

A Cloudflare Worker that removes tracking parameters from URLs using the official ClearURLs rule database. Provides the same privacy protection as the ClearURLs browser extension but as a serverless API.

## Usage

### Clean URLs

**API Endpoint**: `GET /?url=<encoded-url>`

```bash
# Remove UTM tracking
curl "https://your-worker.workers.dev/?url=https%3A//example.com%3Futm_source%3Dtest"
# Returns: https://example.com

# Clean YouTube URL (preserves video ID, removes tracking)
curl "https://your-worker.workers.dev/?url=https%3A//youtube.com/watch%3Fv%3Dabc%26feature%3Dshare"
# Returns: https://youtube.com/watch?v=abc

# Clean URL with fragments/hash parameters
curl "https://your-worker.workers.dev/?url=https%3A//example.com/page%3Futm_source%3Dtest%23utm_campaign%3Dfragment"
# Returns: https://example.com/page
```

### Purge Cache

**API Endpoint**: `DELETE /?url=<encoded-url>`

```bash
# Delete cached response for a specific URL
curl -X DELETE "https://your-worker.workers.dev/?url=https%3A//example.com%3Futm_source%3Dtest"
# Returns: Cache entry deleted (200) or Cache entry not found (404)
```

## Features

- **Official ClearURLs Rules** - Uses the same 250+ provider rule database as the ClearURLs browser extension
- **Live Rule Updates** - Automatically fetches and validates rules from ClearURLs API with SHA256 verification
- **Query & Fragment Cleaning** - Removes tracking from both URL parameters (`?utm_source=test`) and fragments (`#utm_campaign=test`)
- **Redirect Following** - Unwraps shortened URLs and tracking redirects (up to 5 levels)
- **Provider-Specific Logic** - Domain-specific rules prevent false positives (e.g., TikTok rules won't affect YouTube)
- **Advanced Pattern Matching** - Full regex support with exact ClearURLs compatibility
- **Response Caching** - 1-hour cache using Cloudflare Cache API for improved performance and reduced latency
- **Cache Management** - DELETE endpoint for manual cache purging and testing
- **Durable Object Storage** - 7-day rule caching with automatic refresh and fallback support

## Deployment

```bash
npm install
npm run deploy
```

## Development

```bash
npm run dev     # Start local server at http://localhost:8787
npm test        # Run tests
npm run format  # Format code with Prettier
```

## Architecture

- **Cloudflare Workers** - Serverless edge computing for global performance
- **Durable Objects** - Persistent storage for ClearURLs rule caching with SHA256 validation
- **TypeScript** - Full type safety with generated Cloudflare Workers types
- **ClearURLs Integration** - Official rule database with automatic updates

## Rule System

The worker fetches and caches rules from the official ClearURLs API:

- **Source**: `https://rules2.clearurls.xyz/data.minify.json`
- **Validation**: `https://rules2.clearurls.xyz/rules.minify.hash`
- **Cache Duration**: 7 days with automatic refresh
- **Fallback**: Uses cached rules if fresh fetch fails
