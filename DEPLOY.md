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

Checkout is configuration. The link lives in `CHECKOUT_URL` and nowhere else.
With a Lemon Squeezy link, checkout opens as Lemon Squeezy's in-page overlay;
any other provider's link opens as a normal page.

Lemon Squeezy, the live provider:

1. In the Lemon Squeezy dashboard, in LIVE mode, copy the product's checkout
   link and set `CHECKOUT_URL` to it.
2. Leave `PAYMENT_PROVIDER` unset. The provider is read from the link, and a
   value that contradicts the link keeps checkout offline rather than taking
   money the webhook would then refuse.
3. Settings > Webhooks: add `https://<domain>/api/webhook` with the events
   `order_created` and `order_refunded`, and a signing secret. Set
   `LEMONSQUEEZY_WEBHOOK_SECRET` to the same secret. If the store keeps
   separate test-mode and live-mode webhooks, give both the same secret.
4. Set the product's confirmation modal (title, message, button to
   `https://<domain>/success`) in the product's settings in Lemon Squeezy.
   The overlay shows it after payment.
5. Redeploy.

Checkout stays in the disabled "Checkout offline" state until both
`CHECKOUT_URL` and its provider's webhook secret are set. That is deliberate:
without the secret, the webhook would reject every purchase and nobody who
paid would get access. The server log says which one is missing.

End-to-end test on production, with a test card:

1. Set `LEMONSQUEEZY_ACCEPT_TEST_ORDERS=true` and redeploy. Without it,
   production acknowledges test-mode orders but does not grant them, so a
   test-mode link left in `CHECKOUT_URL` cannot hand out free access.
2. Point `CHECKOUT_URL` at the test-mode link, buy with Lemon Squeezy's test
   card, and confirm: the overlay opens on the page, the confirmation modal
   appears, the page behind it unlocks on its own within a few seconds
   ("You're in. Unlimited scans are unlocked on this device."), the access
   email arrives, and its link signs in a second browser. If the page does
   not unlock but the email works, the claim is not making it through the
   checkout: check that the webhook delivery's `meta.custom_data` has a
   `claim` field.
3. Put the live link back in `CHECKOUT_URL`, unset
   `LEMONSQUEEZY_ACCEPT_TEST_ORDERS`, and redeploy.

Gumroad and Paddle still work: set `CHECKOUT_URL` to their link and
`GUMROAD_WEBHOOK_SECRET` (appended as `?secret=<value>` to the ping URL,
optionally with `GUMROAD_SELLER_ID` and `GUMROAD_PRODUCT_PERMALINK`) or
`PADDLE_WEBHOOK_SECRET`. Keeping an old provider's secret set after moving
keeps its refunds able to revoke access.

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
