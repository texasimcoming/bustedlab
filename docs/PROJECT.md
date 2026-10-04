# BustedLab: project memory

As of 2 October 2026. These are the owner's facts and decisions. Do not add claims here that the owner has not made.

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
- $1 of daily budget is about 30 scans (about $0.03 per cold scan).

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

## How to report to the owner

- Plain English.
- One objective recommendation, with its cost and evidence.
- No menus of options.
- No re-litigating decided items.
