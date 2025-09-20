# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Workers project called "url-cleaner" built with TypeScript. It's a serverless URL cleaning service that removes tracking parameters from URLs, similar to the ClearURLs browser extension. The worker runs on Cloudflare's edge network for fast global performance.

## Architecture

- **Runtime**: Cloudflare Workers (serverless edge computing)
- **Language**: TypeScript with ES2021 target
- **Entry Point**: `src/index.ts` - main worker handler accepting `?url=` parameter
- **URL Cleaner**: `src/cleaner.ts` - core cleaning engine with redirect following and fragment cleaning
- **Rules Cache**: `src/rules-cache.ts` - Durable Object for caching ClearURLs rules with SHA256 validation
- **Types**: `src/types.ts` - TypeScript interfaces for ClearURLs rule structure
- **Configuration**: `wrangler.jsonc` - Cloudflare Workers deployment configuration with Durable Objects
- **Testing**: Vitest with Cloudflare Workers testing pool

## API Usage

### Clean URL Endpoint

**Endpoint**: `GET /?url=<encoded-url>`
**Response**: Plain text containing the cleaned URL

**Examples**:

- `/?url=https://example.com?utm_source=test` → `https://example.com`
- `/?url=https://youtube.com/watch?v=abc&feature=share` → `https://youtube.com/watch?v=abc`

### Cache Purge Endpoint

**Endpoint**: `DELETE /?url=<encoded-url>`
**Response**: Plain text confirming cache deletion

**Examples**:

- `DELETE /?url=https://example.com?utm_source=test` → `Cache entry deleted` (200)
- `DELETE /?url=https://nonexistent.com` → `Cache entry not found` (404)

## Common Commands

### Development

- `npm run dev` or `npm run start` - Start local development server with Wrangler
- `npm run deploy` - Deploy worker to Cloudflare
- `npm test` - Run tests with Vitest
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting
- `npm run cf-typegen` - Generate TypeScript types for Cloudflare bindings

### Development Server

The development server runs on `http://localhost:8787/` by default.

## Project Structure

```
src/
├── index.ts          # Main worker entry point with fetch handler
├── cleaner.ts        # Core URL cleaning engine with redirect following and fragment cleaning
├── rules-cache.ts    # Durable Object for caching ClearURLs rules with validation
└── types.ts          # TypeScript interfaces for ClearURLs rule structure
test/
├── index.spec.ts     # Unit and integration tests with ClearURLs rule mocking
├── tsconfig.json     # Test-specific TypeScript config
└── env.d.ts          # Test environment types
```

## URL Cleaning Features

### Core Functionality

- **Official ClearURLs Rules**: Uses the same rule database as ClearURLs browser extension (250+ providers)
- **Redirect Following**: Follows up to 5 redirects to unwrap shortened URLs and tracking redirects
- **Provider-Specific Rules**: Domain-specific rules prevent false positives and preserve functionality
- **Query Parameter Cleaning**: Removes tracking from URL query parameters (`?utm_source=test`)
- **Fragment Cleaning**: Removes tracking from URL fragments/hash parameters (`#utm_campaign=test`)
- **Raw Rules Support**: Handles complex regex-based cleaning for advanced tracking patterns
- **Loop Prevention**: Tracks visited URLs to prevent infinite redirect loops
- **Response Caching**: 1-hour cache using Cloudflare Cache API for improved performance
- **Cache Management**: DELETE endpoint for manual cache purging

### Rule System

- **Live Updates**: Fetches rules from ClearURLs official API (`https://rules2.clearurls.xyz/`)
- **SHA256 Validation**: Cryptographically verifies rule integrity
- **Durable Object Caching**: 7-day cache with automatic refresh
- **Fallback Support**: Uses cached rules if fresh fetch fails
- **Provider Priority**: Domain-specific providers take precedence over global rules

### Supported Providers (250+ total)

- **Google**: Search, Analytics, Ads tracking removal
- **YouTube**: Preserves video/playlist IDs, removes tracking
- **Amazon**: E-commerce functionality preserved, affiliate tracking removed
- **Facebook/Meta**: Social features preserved, tracking removed
- **Twitter/X**: Post/user functionality preserved, tracking removed
- **TikTok**: Video functionality preserved, tracking removed
- **And 240+ more providers** maintained by the ClearURLs community

### Advanced Features

- **Exception Handling**: Respects provider-specific exception rules
- **Redirection Unwrapping**: Follows ClearURLs redirection patterns
- **Regex Pattern Matching**: Exact ClearURLs compatibility with `^rule$` pattern matching
- **Case-Insensitive Matching**: Handles mixed-case tracking parameters
- **Fragment Parameter Support**: Cleans tracking from URL hash fragments

## Key Files

- `wrangler.jsonc` - Worker configuration including compatibility date and observability
- `vitest.config.mts` - Test configuration using Cloudflare Workers pool
- `worker-configuration.d.ts` - Generated TypeScript definitions for Cloudflare bindings
- `tsconfig.json` - TypeScript configuration with strict mode enabled

## Testing

The project uses Vitest with the Cloudflare Workers testing pool (`@cloudflare/vitest-pool-workers`). Tests support both unit testing (with mocked context) and integration testing (using `SELF.fetch()`).

## TypeScript Configuration

- Target: ES2021
- Module: ES2022
- Strict mode enabled
- JSX support configured for React
- Excludes test files from main compilation
