# URL Cleaner

A Cloudflare Worker that removes tracking parameters from URLs using the official ClearURLs rule database. Provides the same privacy protection as the ClearURLs browser extension but as a serverless API.

## Usage

### iOS Shortcut Integration

For iPhone and iPad users, we provide a convenient iOS Shortcut that integrates directly with the system share sheet, allowing you to clean URLs from any app with just a tap.

#### Installation

Get it from the iCloud link: https://www.icloud.com/shortcuts/a52e8aebc61e4c5bb81ecba452c16a03
When you open the link, iOS will prompt you to install the shortcut, simply tap **Add Shortcut** to complete the installation.

The shortcut file is also available in this repository as `Clean URLs.shortcut` for reference.

#### First Use & Permissions

When you first share a URL using the shortcut, iOS will display a privacy protection dialog:

> **Allow "Clean URLs" to send 1 item to "url-cleaner.m5r.workers.dev"?**
>
> This might allow "Clean URLs" to share this content with "url-cleaner.m5r.workers.dev" and potentially other websites.

**Options:**
- **Don't Allow** - Blocks the request (shortcut won't work)
- **Allow Once** - Permits this single request only
- **Always Allow** - Remembers your choice for future uses (recommended)

**What this means:** iOS is asking permission for the shortcut to send your shared URL to the URL cleaner service. This is exactly what you want - the shortcut needs to send the URL to be cleaned. Choose **"Always Allow"** for the best experience.

#### How to Use

1. **Share a URL** from any app (Safari, Twitter, Reddit, Messages, etc.)
2. **Find "Clean URLs"** in the share sheet (may be in the "More" section initially)
3. **Tap the shortcut** - it will clean the URL and copy the result to your clipboard
4. **Paste the cleaned URL** wherever you need it

#### Troubleshooting

**Shortcut not appearing in share sheet?**
- Look in the "More" section (scroll right in the bottom row)
- Open Shortcuts app → Settings → Share Sheet → ensure "Clean URLs" is enabled

**Getting permission denied errors?**
- Open Shortcuts app → find "Clean URLs" → tap the details icon (ⓘ) → **Privacy**
- Under "Allow Get Contents of URL to use", ensure the apps you're sharing from are allowed
- You can grant permission to specific apps or choose "Always Allow"

**Cleaned URL not copying to clipboard?**
- Open Shortcuts app → find "Clean URLs" → tap the details icon (ⓘ) → **Privacy**
- Ensure clipboard access is enabled for the shortcut

### API

#### Clean URLs

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

#### Purge Cache

**API Endpoint**: `DELETE /?url=<encoded-url>`

```bash
# Delete cached response for a specific URL
curl -X DELETE "https://your-worker.workers.dev/?url=https%3A//example.com%3Futm_source%3Dtest"
# Returns: Cache entry deleted (200) or Cache entry not found (404)
```

## Features

- **Same ClearURLs Rules** - Uses the same 250+ provider rule database as the ClearURLs browser extension
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
