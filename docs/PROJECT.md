# BustedLab: project memory

As of 2 October 2026, updated 9 October 2026. These are the owner's facts and decisions. Do not add claims here that the owner has not made.

## What it is

Scan a photo or a link, identify the product, find the cheapest verified price, and show a shareable card:

- a verdict card (BUSTED / OVERPRICED / FAIR PRICE), or
- a closest-match / cheapest-link card.

Google Lens already identifies products for free. The differentiator is the verdict (the markup against the source price) and the shareable card.

## Owner and money

- Solo 18-year-old founder, self-funded.
- The business must fund itself. Payouts go back into API credit until the balance reaches $50; after that, the owner decides.
- Anthropic is prepaid, so spend cannot exceed the loaded balance.
- Price: $4.99 one-time via Lemon Squeezy, about $4.24 net.
- Vercel Hobby is non-commercial by Vercel's terms. Upgrade to Pro after about 5 sales.
- Claude cost per scan, measured on the labelled set (runs 7 and 8): about $0.020 when Serper's Lens verifies the product, about $0.045 to $0.06 when the SerpApi escalation runs. Search adds about half a cent (Serper credits); SerpApi is free within its 250 a month.
  - $1 of daily budget is about 50 plain scans, or 17 to 22 escalated ones.
  - $5 of credit buys about 250 scans if none escalate, about 110 at $0.045 escalated, about 85 at $0.06; at the labelled set's mix (5 of 6 escalated, $0.041 on average) about 120.
  - `/api/stats` (scanCosts) and the weekly brief report the real split each week.

## Decided by the owner

Never change or remove these. If a change would touch one, flag it and ask.

- The scan counter floor and tick.
- The activity toasts.
- The stats-row floors.
- The illustrative reactions and the "What we catch" examples. They switch to real data at thresholds already coded.
- The hero line.
- The fair-use ceiling of 500 scans a day.
- The two-card design (verdict vs finder).
- The EXACT MATCH / VISUAL MATCH / LOOKALIKE labels.
- The sign-in and unlock flows.

## Models and rules

- Sonnet 5.5 at low effort for the first read, the gate, the degraded gate and re-confirmation.
- Opus 5.5 for fallback and escalation.
- No sampling parameters. Adaptive thinking is always on. Read replies by block type.
- The rules live in `src/lib/model-rules.ts`.
- Same-market verdicts: a scan gets a verdict (BUSTED / OVERPRICED / FAIR PRICE) only when the source listing's price is in the same currency as the asking price (the screenshot's, or the scanned page's). A euro screenshot against a rupiah store, or a dirham one against a US listing, gets the cheapest-link card with the regional-shipping note and no verdict; both prices are still converted for display. Why: regional prices, VAT and shipping make a cross-border gap unreliable to accuse a seller on. See SAME-MARKET VERDICTS in `src/lib/scan.ts`.
- Prices are read by one parser (`parsePrice` in `src/lib/fx.ts`) wherever they come from: page meta tags, microdata and JSON-LD, Serper and SerpApi price strings, and the model's reads. A format that could mean two things is unreadable, never guessed: a missing price only costs a verdict, a wrong one makes a false accusation. Provider prices count only when the provider's text and its own extracted number agree.
- Plausible gap: no verdict when the asking price and the source price are more than 50 times apart, in either direction. The scan returns the cheapest-link card with a short note. A misread price is off by 100 or 1,000 times, not by a few percent. See PLAUSIBLE GAP in `src/lib/scan.ts`.
- Pages fetched on someone else's say-so (a pasted link, a store address read off a screenshot, a search result) go through `fetchPublic` in `src/lib/net-guard.ts`: http or https on the default port, no credentials, a public hostname whose every address is public, and redirects followed by hand, at most four, each hop checked. `npm run check:net-guard` proves it offline; run 11 proved it live (an http link redirected to https and the page was read).
- The global daily cap on free scans fails closed: if Redis cannot be read, a free scan gets the "high demand" answer instead of running uncapped. Every other limit fails open. Paid scans are unaffected.
- Link scans take the brand the page's own product data states (schema.org brand or product:brand, never "Generic" or "Unbranded"), and the match guards compare listings with it as with a brand read off a photo.
- Search: Serper is primary, SerpApi is the backup.
- Escalation policy: the cheapest provider first, the better one when the cheap one cannot verify. Serper's Lens answers first; when nothing it found survives the gate and the match guards, SerpApi's Lens is asked once, only while SerpApi is above its reserve with a known balance, never on a degraded day. See ESCALATION in `src/lib/scan.ts`.
- Match guards (`src/lib/match-guards.ts`) hold every gate answer in code. "Exact" and "likely" are refused when:
  - a brand read off the photo is missing from the listing;
  - no brand was read and the answer is "likely" (only "exact" counts then);
  - the listing sells a part or one piece of the product;
  - the read names a model the listing lacks;
  - the gate names no tie (logo, printed text, distinctive part, or the identical photo);
  - the gate's own reason says the page sells nothing;
  - the listing's link is a collection, category or brand page, not one product's page (run 10: "exact" on Stanley's "New Arrivals" page).

## Research, October 2026

- **Google:** its Shopping Graph holds 60B+ listings, and Google ships price tracking and a smart cart (Google I/O 2026).
- **Gemini's free tier** may use inputs to improve Google products and lets human reviewers read them. Never send user photos to a free tier.
- **Search APIs:**
  - Serper costs about $0.001 per search, with 2,500 free credits.
  - SerpApi costs about $0.015 per search, with 250 free a month.
- **Voyage multimodal embeddings:** a free allowance of roughly tens of thousands of images, then about a tenth of a cent each.
- **Anthropic's connector directory portal** opened on 25 Sept 2026 for anyone on a paid Claude plan (claude.ai/directory/manage).
- **Anthropic prices (checked 9 Oct 2026, platform.claude.com pricing page):** Opus 5.5 $4 / $20 per million tokens, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50 (prompts up to 100K tokens). Cache reads 0.05x input on Opus 5.5 and Sonnet 5.5, 0.1x on Haiku 5.5; 5-minute cache writes 1.25x. Batch is 50% off but asynchronous, so it does not fit a live scan.
- **Upstash free tier:** 500,000 commands a month, then pay as you go at about $0.20 per 100,000 (Upstash's own blog). A landing visit costs about 16 to 20 commands in production (measured locally: 36 without the CDN-cached leaderboard).
- **Vercel Hobby:** 1M function invocations and 4 CPU-hours a month; going over pauses the feature for up to 30 days. Non-commercial only. Pro is $20 a month.
- **Lemon Squeezy:** 5% + 50c per sale, +1.5% international, +1.5% PayPal. Payouts on the 1st and 15th, $50 minimum; US bank payouts free, 1% outside the US (docs; the pricing page was not reachable from the sandbox).
- **SerpApi:** free plan 250 searches a month; cached searches (the same Lens query again within its cache window) are free.
- **WhatsApp link previews** fail silently above about 300 KB (widely reported, undocumented). The preview images here are 72 to 81 KB.
- **Haiku 5.5 as the gate: rejected (run 11, 9 Oct 2026).** It would cut the gate, about 83% of a scan's Claude cost, by about 20 times. Replayed on all 370 stored candidates for $0.046: the guards held 11 of its 12 wrong claims, but one was still shown (a Taobao "Stanley Shaker Cup" passed as likely on the Stanley logo), and on run 6's 89 hard candidates it kept 6 right matches against Sonnet 5.5's 11. Zero wrong products comes first, so the gate stays on Sonnet. Re-test any new small model the same way: a `replay` with `model` in `evals/run.json`; `npm run check:match-guards` reports it as a trial, head to head with the shipped gate.
- **Sovrn Commerce and Skimlinks** auto-convert outbound links, and each reviews the site first.
  - Sovrn: install, generate clicks, then about 5 business days. Independent sources say new or small sites are often declined.
  - Skimlinks reportedly keeps about 25% and pays on long terms (secondary sources).

## Roadmap, with gates

Each phase moves on only when its gate is met and its cost is funded by revenue.

- **Phase 0:** live (this work).
- **First sale:** by a friend, not on the owner's own card. Lemon Squeezy's approval email forbids self-purchases.
- **Phase 1:** first revenue.
  - Organic posting from the weekly content pack.
  - Watch the funnel.
  - Apply to Sovrn Commerce and Skimlinks once the site is live.
- **Phase 2:** after about 10 real stranger scans. All measured on real scans and the "wrong product?" labels:
  - rank candidates with image embeddings before the Claude gate;
  - a Lens-first shortcut when exact matches agree;
  - an AliExpress/Alibaba source-price layer via Serper (the original anti-dropshipping thesis);
  - a referral loop (free scans for the sharer and the friend, inside the caps);
  - a spend cap that rises with trailing revenue.
- **Phase 3:**
  - a Claude connector with an MCP App that renders the verdict card;
  - then ChatGPT;
  - starting with link and text inputs and a capped free allowance.

## Tagging links (for the funnel by channel)

Each browser count carries one channel word (`src/lib/source.ts`). Tag every link you post so it is counted right: the TikTok bio `https://bustedlab.com/?utm_source=tiktok`, an Instagram Story sticker `?utm_source=instagram`, X `?utm_source=x`. Share links from the result screen carry `?ref=share` already. `/api/stats` returns `bySource`, and the weekly brief has "Where visits came from".

## Example photos: the shot list

The landing page's hero and example card read `src/content/examples.ts`. It works with the one photo there is now and cycles through more. For each new example: one product you own, bought cheaply, with its two prices verified by you (the asking price on an ad or shop listing, and the source price on a wholesale listing for the same configuration).

- **Products:** an LED light therapy face mask (`led-face-mask`), an electric scalp massager (`scalp-massager`), a galaxy star projector night light (`star-projector`), a USB portable blender (`portable-blender`), a posture corrector brace (`posture-corrector`).
- **Framing:** square, at least 2400 px, the product about 60% of the frame's width, centred, held or used by one hand to show its size. Keep everything important in the middle band: phones crop the top and bottom fifth.
- **Background:** plain matte charcoal or a dark desk. No props. Turn brand names away from the camera.
- **Light:** one soft light from above and front-left (a window, or a lamp bounced off the ceiling), a white card opposite. No flash, no filters, no retouching beyond crop and exposure.
- **Files:** `public/demo/<id>-480.webp`, `-720.webp`, `-960.webp` (square), and `<id>-150.webp` for the card's thumbnail, next to the original `public/demo/<id>.jpg`, as the first example has them.
- **Entry:** add `{ id, title, label, asking, source, photo, thumb }` to `examples.ts`. The markup, the gap and the verdict are computed by `calculateVerdict`, so they cannot disagree with the engine.

## Rollback plan

- **A bad deploy:** in Vercel, Deployments, open the last good production deployment and choose "Promote to Production" (instant, no rebuild). Then revert the merge on GitHub (`git revert -m 1 <merge sha>`) through a PR so main matches what is live.
- **How you know:** the watchdog runs after every production deploy (diagnose when runtime code changed) and every hour, and opens a "watchdog" issue that mentions the owner when anything fails.
- **Spend running away:** set `DAILY_MODEL_BUDGET_USD` lower, or `GLOBAL_DAILY_SCAN_CAP` to 0 to pause free scans, in Vercel's environment variables, then redeploy. The Anthropic balance is prepaid, so it is the final ceiling.
- **Redis down:** free scans pause by themselves (the cap fails closed); landing pages keep working.

## Lessons

- **Stubbed tests hide real failures.** Tests that stubbed the Claude API hid a real 400 (temperature on Opus 5) behind silent failures. After any model or parameter change, run `/api/diagnose` and keep failures loud.
- **Verify request rules in Anthropic's docs.**
- **Spend caps.** Set a spend cap before any live run, and never exceed it.
- **Evaluation scans never touch public data.**
- **All changes go through a PR.** Never push a zip to main.
- **No test purchase with the owner's card.**
- **Every URL from outside is hostile until checked.** Link scans fetched any address with redirects followed; the image proxy had been guarded since the start, the page fetch had not. One guard now covers both kinds of fetch.
- **A cap that fails open is not a cap.** The free-scan cap is the one limit that fails closed.
- **A model's "match" is a claim, not a fact.** The gate called lookalikes "exact" or "likely" on shape and colour alone, and once answered "exact" on a page it had itself described as an article. Match rules are enforced in code on every answer, and measured against every stored labelled result (`npm run check:match-guards`). Zero wrong products labelled exact or likely comes first; the recall it costs is reported plainly.

## How to report to the owner

- Plain English.
- One objective recommendation, with its cost and evidence.
- No menus of options.
- No re-litigating decided items.
