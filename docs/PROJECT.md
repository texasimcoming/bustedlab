# BustedLab: project memory

As of 2 October 2026, updated 4 October 2026. These are the owner's facts and decisions. Do not add claims here that the owner has not made.

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
- Search: Serper is primary, SerpApi is the backup.
- Escalation policy: the cheapest provider first, the better one when the cheap one cannot verify. Serper's Lens answers first; when nothing it found survives the gate and the match guards, SerpApi's Lens is asked once, only while SerpApi is above its reserve with a known balance, never on a degraded day. See ESCALATION in `src/lib/scan.ts`.
- Match guards (`src/lib/match-guards.ts`) hold every gate answer in code. "Exact" and "likely" are refused when:
  - a brand read off the photo is missing from the listing;
  - no brand was read and the answer is "likely" (only "exact" counts then);
  - the listing sells a part or one piece of the product;
  - the read names a model the listing lacks;
  - the gate names no tie (logo, printed text, distinctive part, or the identical photo);
  - the gate's own reason says the page sells nothing.

## Research, October 2026

- **Google:** its Shopping Graph holds 60B+ listings, and Google ships price tracking and a smart cart (Google I/O 2026).
- **Gemini's free tier** may use inputs to improve Google products and lets human reviewers read them. Never send user photos to a free tier.
- **Search APIs:**
  - Serper costs about $0.001 per search, with 2,500 free credits.
  - SerpApi costs about $0.015 per search, with 250 free a month.
- **Voyage multimodal embeddings:** a free allowance of roughly tens of thousands of images, then about a tenth of a cent each.
- **Anthropic's connector directory portal** opened on 25 Sept 2026 for anyone on a paid Claude plan (claude.ai/directory/manage).
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

## Lessons

- **Stubbed tests hide real failures.** Tests that stubbed the Claude API hid a real 400 (temperature on Opus 5) behind silent failures. After any model or parameter change, run `/api/diagnose` and keep failures loud.
- **Verify request rules in Anthropic's docs.**
- **Spend caps.** Set a spend cap before any live run, and never exceed it.
- **Evaluation scans never touch public data.**
- **All changes go through a PR.** Never push a zip to main.
- **No test purchase with the owner's card.**
- **A model's "match" is a claim, not a fact.** The gate called lookalikes "exact" or "likely" on shape and colour alone, and once answered "exact" on a page it had itself described as an article. Match rules are enforced in code on every answer, and measured against every stored labelled result (`npm run check:match-guards`). Zero wrong products labelled exact or likely comes first; the recall it costs is reported plainly.

## How to report to the owner

- Plain English.
- One objective recommendation, with its cost and evidence.
- No menus of options.
- No re-litigating decided items.
