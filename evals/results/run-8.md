# Production eval, run 8

https://www.bustedlab.com, 2026-10-04T18:57:18.737Z to 2026-10-04T18:58:07.988Z. The two live scans run 7's cap held back (Stanley euro screenshot, silicone brush), on the same build (5fa0d34), under a $0.16 all-in scan cap that keeps the job's Claude total under $0.60 ($0.4128 spent before this run).

Spend this run: $0.0810 (Claude $0.0610, search $0.0200). All runs: $6.9176 of the $25 cap.

## Preflight

HTTP 200 in 643 ms.
Ready: **true** (production).
- warning email: The Resend key is send-only, so the domain could not be checked. Confirm bustedlab.com shows as verified in Resend.
- ok: redis, checkout (lemonsqueezy, overlay), base url, model key, search key, identity salt
- limits: {"dailyModelBudgetUsd":2,"paidScansPerAccountPerDay":500,"freeUncachedScansPerDay":50}

## Photos

| case | source | license | size | note |
|---|---|---|---|---|
| silicone-pastry-brush | [Kitchen-Silicone-Brush.jpg](https://commons.wikimedia.org/wiki/File:Kitchen-Silicone-Brush.jpg) | Public domain | 2000x903 |  |
| stanley-quencher-eur | [Quencher® H2.0 FlowState™ Tumbler / 1.18L](https://eu.stanley1913.com/fr/products/quencher-h2-0-flowstate-tumbler-1-18-l) | listing | 1080x2340 | screenshot at 55,00 € |

## Scans

Free allowance seen from this runner's address: 2 before, 2 after (an evaluation scan must not use it). SerpApi searches left after: unknown.
Scan step spend, all-in: $0.0810 of its $0.16 cap.

| case | kind | intent | class | confidence | mode | engine | SerpApi escalation | shown | ms | $ all-in | $ model | Serper credits | SerpApi | cache read / written | calls reading |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stanley-quencher-eur | screenshot, euro price | verdict | **correct exact** | exact | VERDICT | lens_serper+priced_page | not needed | THE QUENCHER 2.0™ TUMBLER - Stanley 1913 Indonesia | 12815 | 0.0246 | 0.019598 | 5 | 0 | 2956 / 1478 | 2 of 3 |
| silicone-pastry-brush | unbranded generic | finder | **miss** (no match) | unverified | UNRESOLVED | none | ran: 40 new, unverified, used | Product not identified | 26610 | 0.0564 | 0.041405 | 5 | 1 | 7390 / 1478 | 5 of 6 |

Totals: correct exact 1, miss 1.

Engine time per scan: median 26520 ms, p90 26520 ms, max 26520 ms.
Thinking tokens per call (approx.): mean 86, median 90, over 9 calls.

| layer | total ms | scans | mean ms |
|---|---|---|---|
| model:extraction | 4369 | 2 | 2185 |
| model:gate | 21011 | 2 | 10506 |
| search:lens | 9996 | 2 | 4998 |
| search:shopping | 1570 | 2 | 785 |

| model@effort:layer | calls | mean ms | mean thinking | $ total |
|---|---|---|---|---|
| claude-sonnet-5-5@low:extraction | 2 | 2185 | 75 | 0.0143 |
| claude-sonnet-5-5@low:gate | 7 | 3002 | 90 | 0.0467 |

