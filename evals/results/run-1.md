# Production eval, run 1

https://www.bustedlab.com, 2026-10-01T20:21:07.650Z to 2026-10-01T20:21:14.393Z. First contact: preflight and diagnose on the deployed merge of PR #4 (1f4be54).

Spend this run: $0.0219 (Claude $0.0109, search $0.0110). All runs: $0.0219 of the $25 cap.

## Preflight

HTTP 200 in 1718 ms.
Ready: **true** (production).
- warning email: The Resend key is send-only, so the domain could not be checked. Confirm bustedlab.com shows as verified in Resend.
- ok: redis, checkout (lemonsqueezy, overlay), base url, model key, search key, identity salt
- limits: {"dailyModelBudgetUsd":250,"paidScansPerAccountPerDay":500,"freeUncachedScansPerDay":25000}

## Diagnose

HTTP 200 in 5023 ms.
Pass: **true**. Failing: none. Spend mode: full, today $0 of $250. This run's Claude cost: $0.010896. Thinking per call: 35.

| layer | pass | status | ms | detail |
|---|---|---|---|---|
| claude claude-opus-5-5 (gate) | pass | 200 | 3781 | answered and parsed |
| claude claude-sonnet-5-5 (gate fallback, degraded gate, re-confirmation) | pass | 200 | 2018 | answered and parsed |
| claude claude-sonnet-5-5 (first read, page text, search query) | pass | 200 | 1724 | answered and parsed |
| blob | pass | 200 | 495 | uploaded, publicly readable, deleted |
| lens serpapi | pass | 200 | 3158 | 40 visual matches; first: Purple Teeth Whitening Strips with Purple Gel, 28 Strips, 14 ... |
| serpapi account | pass | 200 | 295 | 219 searches left: top up before a traffic push |
| serper | pass | 200 | 1082 | answered; 1 result(s) |
| exchange rates | pass | 200 | 346 | rates for 2026-10-01: EUR 0.88365216, GBP 0.7549139, MAD 9.71943978, CAD 1.42483855 per USD |
| redis | pass | 200 | 301 | write and read |
| photo cap | pass | 200 | 298 | a 1170x2532 screenshot reaches the models at 725x1568 |

