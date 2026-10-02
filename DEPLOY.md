# Deployment

Vercel, Next.js App Router, one project. The build is standard; everything
that varies between environments is an environment variable.

## Before sending anyone to the site

    curl -s -H "Authorization: Bearer $ANALYTICS_TOKEN" https://<domain>/api/preflight

`"ready": true` means this deployment can take money, deliver what was bought
and run the scanner. Anything under `blockers` loses money or customers the
moment traffic arrives, and says what to set; `warnings` are worth fixing but
do not block. It checks that Redis answers, that checkout is live and its
webhook can verify purchases, that the sending domain is verified in Resend,
that the base URL is right, and that the scanner's keys and the privacy
salt are set. It reports whether each thing is set and working, never a
value. Run it after every configuration change.

Then check that every provider actually WORKS, with real calls:

    curl -s -H "Authorization: Bearer $ANALYTICS_TOKEN" https://<domain>/api/diagnose

Preflight says the keys are set; this says they are accepted. It makes one
real call to each Claude model the engine uses (Sonnet 5.5 and Opus 5.5 with
the gate's request, Sonnet 5.5 with the extraction request), reads the SerpApi
account's remaining searches, runs one Serper search, does a Blob upload,
read and delete, runs one real Lens search on a bundled sample photo, and
fetches the day's exchange rates. Each layer reports pass or fail, latency,
HTTP status and the provider's error text. `"pass": true` is the bar; any
name under `failing` is a layer that would make scans fail. One run costs
about two to six cents of Claude usage (measured and returned as
`cost.claudeUsd`), one SerpApi search and one Serper credit. It also returns
`thinking.perCallApprox`, the average thinking tokens per call; re-price
every scan type with `npm run cost-model -- --thinking <that number>`. Run it after every deploy and
after any change at Anthropic, SerpApi, Serper or Vercel.

When a provider fails during real traffic, the scan answers "could not be
completed, try again" (it uses no free scan and is not cached) and the
failure is counted by layer under `failures` in `/api/stats`, with the last
fifty listed as layer:provider:model:status. The function log has one line
per failed call starting `[scan] provider call failed`.

## 1. Deploy

Import the repository into Vercel and deploy. Default settings are correct.
The app builds and serves with no environment variables set.

## 2. Configure the scan engine

Set in Vercel project settings, then redeploy:

- `ANTHROPIC_API_KEY`, in a workspace with access to `claude-opus-5-5` and
  `claude-sonnet-5-5`, the only two models the engine calls. Set a workspace
  spend limit and a rate limit in the Claude Console. Check the account's
  usage tier first: each tier has a MONTHLY spend cap (Start $500, Build
  $1,000, Scale $200,000), and at the cap every call is refused until the
  1st of the next month, so every scan fails. `npm run cost-model` shows how
  many scans each cap covers. Request the tier you need on the Console's
  Rate limits page before sending traffic.
- `GATE_EFFORT` (optional): the verification gate's effort level, `low` by
  default. Raise it to `medium` only if `npm run eval:gate` on labelled
  photos shows the gate missing matches at `low`.
- `DAILY_MODEL_BUDGET_USD` (optional, default 250): past it, scans run on
  the cheaper path (Sonnet 5.5 gate, capped at "likely") instead of failing.
  `npm run cost-model` shows what each value bounds.
- `SERPER_API_KEY` (primary search)
- `SERPAPI_KEY` (backup search and merchant-link resolution)
- `BLOB_READ_WRITE_TOKEN` (create a Blob store in the project first)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `IDENTITY_SALT` (any long random string; rotating it resets rate limits)
- `RESEND_API_KEY`, and verify the sending domain
- `NEXT_PUBLIC_BASE_URL` (no trailing slash)
- `CRON_SECRET` (the cleanup cron rejects every request without it)

Confirm `maxDuration = 60` in `src/app/api/scan/route.ts` is within the plan's
function limit. Hobby caps lower, and a scan that exceeds it is cut off by
the platform and fails in the browser as a timeout, which looks like an
engine fault but is not.

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

## Content-Security-Policy

Enforced on every page, with a fresh nonce per request (`src/proxy.ts`,
`src/lib/csp.ts`). Only scripts carrying that nonce run, plus what they load
(Next's chunks, and lemon.js at checkout). Injected scripts, inline handlers
and `eval` are refused. Every page is therefore rendered per request; the
Redis reads behind the data pages are cached separately, so this costs about
10 ms of render time per page view, not database load.

After each deploy:

    curl -sI https://<domain>/ | grep -i '^content-security-policy'

shows the policy with a `'nonce-...'` that changes on every request.

What it blocks in the wild is counted per day in the stats:

    curl -s -H "Authorization: Bearer $ANALYTICS_TOKEN" https://<domain>/api/stats | jq .csp

An empty list is the healthy state. An entry reads
`<enforce|report> <directive> <what was blocked> <page>`; browser extensions
and other sites are already filtered out, so an `enforce` entry is something
a visitor's browser refused on this site. The checkout overlay falls back to
the full-page checkout if its frame does not appear, so a blocked checkout
script costs the overlay, never the sale.

Adding any third-party script, frame or connection means adding its origin
in `src/lib/csp.ts`.

Break glass: `CSP_REPORT_ONLY=true` and a redeploy sends the same policy as
report-only, so nothing is blocked while a fix ships; reports keep being
counted. Unset it once the fix is live.

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
