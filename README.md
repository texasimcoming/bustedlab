# BustedLab

Consumer price intelligence. Scan a product, get the source price, the asking
price, and the exact distance between them.

## Running locally

```bash
npm install
npm run dev
```

The app runs without any keys configured. Every external dependency degrades
to a documented no-op rather than an error, so an unconfigured environment
returns `UNRESOLVED` results instead of crashing.

```bash
npm run build      # production build
npx tsc --noEmit   # typecheck
npx eslint .       # lint (next build no longer runs it)
```

## Architecture

```
src/app/page.tsx              Landing, scan entry, counters
src/app/api/scan/route.ts     Scan endpoint: access, rate limits, cache, counters
src/app/api/checkout/route.ts Resolves the payment link from configuration
src/app/api/webhook/route.ts  Purchase webhook: Gumroad / Lemon Squeezy / Paddle
src/app/api/auth/route.ts     Magic-link auth
src/app/api/proxy-image       Same-origin image relay (SSRF-guarded)
src/app/api/cleanup-blobs     Daily backstop for orphaned scan uploads
src/lib/scan.ts               The scan engine
src/lib/redis.ts              Counters, access, sessions, scan cache
src/components/VerdictCard    The card. The product's entire growth loop.
```

## Environment

Nothing below is required to run the app; each one enables a capability.

| Variable | Enables |
| --- | --- |
| `ANTHROPIC_API_KEY` | Vision extraction and visual verification |
| `SERPER_API_KEY` | Primary shopping, Lens and organic search |
| `SERPAPI_KEY` | Backup search and merchant-link resolution |
| `BLOB_READ_WRITE_TOKEN` | Temporary uploads for reverse-image search |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Rate limits, sessions, counters, scan cache |
| `IDENTITY_SALT` | Salt for hashed rate-limit keys. Set this in production. |
| `RESEND_API_KEY` | Sign-in and purchase emails |
| `NEXT_PUBLIC_BASE_URL` | Absolute URLs in emails and metadata |
| `CRON_SECRET` | Authorizes the blob cleanup cron. Without it the cron rejects everything. |
| `CHECKOUT_URL` | The live payment link. Without it, checkout renders an honest closed state. |
| `PAYMENT_PROVIDER` | `gumroad` (default), `lemonsqueezy` or `paddle` |
| `GUMROAD_WEBHOOK_SECRET` | Shared secret on the Gumroad ping URL |
| `GUMROAD_SELLER_ID` | Optional. Rejects pings from any other seller. |
| `GUMROAD_PRODUCT_PERMALINK` | Optional. Restricts access grants to one product. |
| `LEMONSQUEEZY_WEBHOOK_SECRET` / `PADDLE_WEBHOOK_SECRET` | Signature verification for those providers |
| `GLOBAL_DAILY_SCAN_CAP` | Daily ceiling on uncached scans. Defaults to 25000. |
| `SCAN_BURST_PER_MINUTE` | Per-IP scan burst limit. Defaults to 12. |

## Rules that are not style preferences

- **No em dashes in rendered text.** Anywhere.
- **Every verdict message states the exact dollar gap.**
- **No number on the site that a visitor could disprove.** Counters are real or
  they render `INDEXING`. The only fixed figure is the scan baseline.
- **No invented people.** No testimonials, no activity notifications, no names.
- **Animation is light, not motion.** No `translateY` on hover, nothing that
  borrows the physics of a physical object.
- **A confident verdict requires an observed retail price**, a verified visual
  match, and a real gap. Two out of three renders as `FINDER`.
