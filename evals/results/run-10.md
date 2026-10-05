# Production eval, run 10

https://www.bustedlab.com, 2026-10-05T14:48:54.483Z to 2026-10-05T14:49:17.173Z. One hardened price parser and the 50-times plausibility gap (PR #25, merge 8cda9f6; diagnose passed on it in the watchdog's deploy run): the Stanley euro screenshot once more. Run 9 read Stanley's European store's "55,00" as 5,500 euros. Every cap at $0.06 all-in, inside the prompt's $0.10 of Claude.

Spend this run: $0.0333 (Claude $0.0263, search $0.0070). All runs: $7.0848 of the $25 cap.

## Preflight

HTTP 200 in 830 ms.
Ready: **true** (production).
- warning email: The Resend key is send-only, so the domain could not be checked. Confirm bustedlab.com shows as verified in Resend.
- ok: redis, checkout (lemonsqueezy, overlay), base url, model key, search key, identity salt
- limits: {"dailyModelBudgetUsd":2,"paidScansPerAccountPerDay":500,"freeUncachedScansPerDay":50}

## Photos

| case | source | license | size | note |
|---|---|---|---|---|
| stanley-quencher-eur | [Quencher® H2.0 FlowState™ Tumbler / 1.18L](https://eu.stanley1913.com/fr/products/quencher-h2-0-flowstate-tumbler-1-18-l) | listing | 1080x2340 | screenshot at 55,00 € |

## Scans

Free allowance seen from this runner's address: 2 before, 2 after (an evaluation scan must not use it). SerpApi searches left after: unknown.
Scan step spend, all-in: $0.0333 of its $0.06 cap.

| case | kind | intent | class | confidence | mode | engine | SerpApi escalation | shown | ms | $ all-in | $ model | Serper credits | SerpApi | cache read / written | calls reading |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stanley-quencher-eur | screenshot, euro price | verdict | **miss** (no match) | unverified | UNRESOLVED | none | not needed | Product not identified | 16845 | 0.0333 | 0.026322 | 7 | 0 | 4434 / 1478 | 3 of 4 |

Totals: miss 1.

Engine time per scan: median 16569 ms, p90 16569 ms, max 16569 ms.
Thinking tokens per call (approx.): mean 83, median 102, over 4 calls.

| layer | total ms | scans | mean ms |
|---|---|---|---|
| model:extraction | 1980 | 1 | 1980 |
| model:gate | 8550 | 1 | 8550 |
| search:lens | 1393 | 1 | 1393 |
| search:shopping | 3518 | 1 | 3518 |

| model@effort:layer | calls | mean ms | mean thinking | $ total |
|---|---|---|---|---|
| claude-sonnet-5-5@low:extraction | 1 | 1980 | 86 | 0.0073 |
| claude-sonnet-5-5@low:gate | 3 | 2850 | 82 | 0.0190 |

