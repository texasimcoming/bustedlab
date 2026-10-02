# Production eval, run 4

https://www.bustedlab.com, 2026-10-02T13:21:16.965Z to 2026-10-02T13:21:23.413Z. Diagnose only: confirm whether the Anthropic credit balance is still exhausted (run 3's replays started failing with 'credit balance is too low').

Spend this run: $0.0010 (Claude $0.0000, search $0.0010). All runs: $6.1934 of the $25 cap.

## Preflight

HTTP 200 in 1686 ms.
Ready: **true** (production).
- warning email: The Resend key is send-only, so the domain could not be checked. Confirm bustedlab.com shows as verified in Resend.
- ok: redis, checkout (lemonsqueezy, overlay), base url, model key, search key, identity salt
- limits: {"dailyModelBudgetUsd":250,"paidScansPerAccountPerDay":500,"freeUncachedScansPerDay":25000}

## Diagnose

HTTP 200 in 4761 ms.
Production is running commit `98a69d5` (production).
Pass: **false**. Failing: claude claude-opus-5-5 (gate), claude claude-sonnet-5-5 (gate fallback, degraded gate, re-confirmation), claude claude-sonnet-5-5 (first read, page text, search query). Spend mode: full, today $0 of $250. This run's Claude cost: $0. Thinking per call: n/a.

| layer | pass | status | ms | detail |
|---|---|---|---|---|
| claude claude-opus-5-5 (gate) | FAIL | 400 | 641 | client: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CfdUoEzJsq31g6yWDqvRj"} |
| claude claude-sonnet-5-5 (gate fallback, degraded gate, re-confirmation) | FAIL | 400 | 562 | client: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CfdUoFCTz2DM1D56QUS2y"} |
| claude claude-sonnet-5-5 (first read, page text, search query) | FAIL | 400 | 577 | client: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CfdUoEkRTmS8gGrCZFuw5"} |
| blob | pass | 200 | 662 | uploaded, publicly readable, deleted |
| lens serpapi | pass | 200 | 2867 | 40 visual matches; first: Purple Teeth Whitening Strips with Purple Gel, 28 Strips, 14 ... |
| models api | pass | 200 | 596 | claude-sonnet-5-5 available, claude-opus-5-5 available, claude-fable-5-1 available |
| serpapi account | pass | 200 | 421 | 37 searches left: top up before a traffic push |
| serper | pass | 200 | 1582 | answered; 1 result(s) |
| exchange rates | pass | 200 | 519 | rates for 2026-10-01: EUR 0.88365216, GBP 0.7549139, MAD 9.71943978, CAD 1.42483855 per USD |
| redis | pass | 200 | 471 | write and read |
| photo cap | pass | 200 | 415 | a 1170x2532 screenshot reaches the models at 725x1568 |

