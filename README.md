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
src/app/api/scan/route.ts     Scan endpoint: access, rate limits, cache, ledger
src/app/api/notify/route.ts   Intent capture: the product update list
src/app/api/event/route.ts    Analytics beacon (3 browser events, allowlisted)
src/app/api/stats/route.ts    The funnel. Token-protected.
src/lib/analytics.ts          Six events, daily counters, no third parties
src/app/scan/[id]/            Permanent page + per-scan OG image for one verdict
src/app/the-index/            The public index: ranked, filterable, all real records
src/app/api/leaderboard/      The three boards, edge-cached
src/app/sitemap.ts            Hands the crawler the ledger
src/app/api/checkout/route.ts Resolves the payment link from configuration
src/app/api/webhook/route.ts  Purchase webhook: Gumroad / Lemon Squeezy / Paddle
src/app/api/auth/route.ts     Magic-link auth
src/app/api/proxy-image       Same-origin image relay (SSRF-guarded)
src/app/api/cleanup-blobs     Daily backstop for orphaned scan uploads
src/lib/scan.ts               The scan engine
src/lib/redis.ts              Counters, access, sessions, scan cache, THE LEDGER
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
| `ANALYTICS_TOKEN` | Bearer token for `GET /api/stats`. Unset means the endpoint is closed entirely. |
| `EVENT_BURST_PER_MINUTE` | Per-IP limit on the analytics beacon. Defaults to 60. |

## The ledger

Every confirmed verdict is written permanently to `scan:rec:<id>`, indexed by
time, by verdict and by markup, with a rolling per-product aggregate. This is
separate from the 24-hour result cache and it does not expire.

It is the only part of this codebase that cannot be rebuilt by a competitor.
The scanner is roughly $0.009 a scan and a weekend of work; a few hundred
million measurements of what things cost against what they are sold for is
obtainable only by having run for years.

A record describes a product, never a person: no IP, no email, no session, no
uploaded image, and deliberately not the retail URL that was scanned. That is
what makes it publishable at `/scan/<id>` and what keeps it outside the scope
of a subject access request.

## Analytics

Six events as daily counters in Redis. No third-party script, no cookie, no
identifier: a row says "on this date, this many scans finished" and nothing
more. `scan_completed`, the three verdict counters and `email_captured` are
counted server-side and cannot be forged; `share_tapped`, `paywall_shown` and
`checkout_clicked` arrive from the browser through an allowlisted beacon and
are labelled `client` in the output so nobody mistakes them for evidence.

```bash
curl -H "Authorization: Bearer $ANALYTICS_TOKEN" https://bustedlab.com/api/stats?days=30
```

The number that matters is `sharesPerScan`. It is the loop coefficient, and
the entire growth model is a function of it.

## Routing note that will bite you

The public index lives at `/the-index`, not `/index`. Next.js normalizes the
request path `/index` to `/` before routing, inherited from the Pages Router
where `pages/index.js` was the root. An `app/index/page.tsx` builds cleanly,
appears in the route manifest, and is unreachable forever: every request
silently renders the home page instead.

## Rules that are not style preferences

- **No em dashes in rendered text.** Anywhere.
- **Every verdict message states the exact dollar gap.**
- **No number on the site that a visitor could disprove.** Counters are real or
  they render `INDEXING`. The only fixed figure is the scan baseline.
- **No invented people.** No testimonials, no activity notifications, no names.
- **Animation is light, not motion.** No `translateY` on hover, nothing that
  borrows the physics of a physical object.
- **Every verdict message states the exact dollar gap**, and the copy is
  written to be shared rather than to be safe. It stays anchored to what was
  measured: "it sells for $X" is an observation about a public listing, "they
  paid $X for it" is an assertion about a business's costs that no scan can
  see. The first one is also the one that cannot be argued with.
- **The verdict tone fires only on a card the user asked for.** It defaults on,
  it is muted from the nav on every screen, and it never fires on the landing
  page reference card. `VerdictCard`'s `sound` prop defaults to `false` for
  exactly that reason.
- **A confident verdict requires an observed retail price**, a verified visual
  match, and a real gap. Two out of three renders as `FINDER`.
