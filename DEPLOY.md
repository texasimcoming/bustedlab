# Deployment

Vercel, Next.js App Router, one project. The build is standard; everything
that varies between environments is an environment variable.

## 1. Deploy

Import the repository into Vercel and deploy. Default settings are correct.
The app builds and serves with no environment variables set.

## 2. Configure the scan engine

Set in Vercel project settings, then redeploy:

- `ANTHROPIC_API_KEY`
- `SERPER_API_KEY` (primary search)
- `SERPAPI_KEY` (backup search and merchant-link resolution)
- `BLOB_READ_WRITE_TOKEN` (create a Blob store in the project first)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `IDENTITY_SALT` (any long random string; rotating it resets rate limits)
- `RESEND_API_KEY`, and verify the sending domain
- `NEXT_PUBLIC_BASE_URL` (no trailing slash)
- `CRON_SECRET` (the cleanup cron rejects every request without it)

Confirm `maxDuration = 60` in `src/app/api/scan/route.ts` is within the plan's
function limit. Hobby caps lower, and a scan that exceeds it returns
`UNRESOLVED` for reasons that look like an engine fault but are not.

## 3. Turn on payments

Checkout is configuration. Nothing in the codebase names a processor.

1. Create the product with whichever provider is live and copy its payment link.
2. Set `CHECKOUT_URL` to that link and `PAYMENT_PROVIDER` to `gumroad`,
   `lemonsqueezy` or `paddle`.
3. Point the provider's webhook at `https://<domain>/api/webhook` and set the
   matching secret:
   - Gumroad: append `?secret=<value>` to the ping URL and set
     `GUMROAD_WEBHOOK_SECRET` to the same value. Optionally set
     `GUMROAD_SELLER_ID` and `GUMROAD_PRODUCT_PERMALINK` to narrow what
     grants access.
   - Lemon Squeezy: `LEMONSQUEEZY_WEBHOOK_SECRET`.
   - Paddle: `PADDLE_WEBHOOK_SECRET`.
4. Redeploy and make one live purchase. The access email should arrive and its
   link should sign you in.

Until `CHECKOUT_URL` is set, the purchase buttons render a disabled
"Checkout offline" state. That is deliberate: an honest closed door beats a
button that opens a dead tab.

Switching providers is two environment variables and a redeploy. No code change.

## 4. Domain

Add the domain in Vercel, create the DNS records it shows, and set
`NEXT_PUBLIC_BASE_URL` to match. Emails and share metadata read from it.

## Cron

`vercel.json` schedules `/api/cleanup-blobs` daily at 03:00 UTC. It is a
backstop only: the scan pipeline deletes each temporary upload as soon as the
reverse-image search returns, so a healthy deployment reports `deleted: 0`.
A consistently non-zero count means scans are dying mid-request.

## Load behaviour

- Verified results are cached for 24 hours, keyed on the normalized URL or on
  the bytes of the uploaded image. One product going viral costs the API once.
- `GLOBAL_DAILY_SCAN_CAP` (default 25000) caps uncached scans per day for
  free users. Cache hits and signed-in paid users are never capped.
- Raise it before a campaign, not during one.
