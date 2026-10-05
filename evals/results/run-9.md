# Production eval, run 9

https://www.bustedlab.com, 2026-10-05T00:44:03.849Z to 2026-10-05T00:45:54.108Z. Same-market verdicts and link-scan brand guards (PR #23, merge 38f1677; diagnose passed on it in the watchdog's deploy run): the Stanley euro screenshot once more (it should now be the cheapest-link card, not a verdict), then three production link scans: a small direct-to-consumer brand's own page, an Amazon product page, a niche brand's page. Run cap $0.25 all-in, inside the prompt's $0.30 of Claude ($0.0463 spent before this run).

Spend this run: $0.1339 (Claude $0.0969, search $0.0370). All runs: $7.0515 of the $25 cap.

## Preflight

HTTP 200 in 1092 ms.
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
Scan step spend, all-in: $0.0381 of its $0.10 cap.

| case | kind | intent | class | confidence | mode | engine | SerpApi escalation | shown | ms | $ all-in | $ model | Serper credits | SerpApi | cache read / written | calls reading |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stanley-quencher-eur | screenshot, euro price | verdict | **correct exact** | exact | FINDER | lens_serper+priced_page | not needed | Quencher H2.0 FlowState Tumbler / 1.18L / Stanley 1913 NL | 34932 | 0.0381 | 0.023082 | 5 | 1 | 2956 / 1478 | 2 of 3 |

Totals: correct exact 1.

Engine time per scan: median 34592 ms, p90 34592 ms, max 34592 ms.
Thinking tokens per call (approx.): mean 120, median 123, over 3 calls.

| layer | total ms | scans | mean ms |
|---|---|---|---|
| model:extraction | 2265 | 1 | 2265 |
| model:gate | 7154 | 1 | 7154 |
| search:lens | 3329 | 1 | 3329 |
| search:shopping | 20767 | 1 | 20767 |

| model@effort:layer | calls | mean ms | mean thinking | $ total |
|---|---|---|---|---|
| claude-sonnet-5-5@low:extraction | 1 | 2265 | 89 | 0.0073 |
| claude-sonnet-5-5@low:gate | 2 | 3577 | 135 | 0.0158 |

## Link scans

Link scan spend, all-in: $0.0959 of its $0.18 cap.

| link | kind | the page shows | mode | confidence | matched listing | source price | verdict | escalation | $ Claude | $ all-in | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| flowlife-flowgun-air | small direct-to-consumer brand | Flowgun Air (brand none stated, 79 GBP) | scan_incomplete |  | Merlin High-Flow Blow Gun Kit @Harbor Freight Tools |  |  | not needed | 0.0211 | 0.0361 | 30339 |
| amazon-airpods-pro-2 | Amazon product page | Amazon.com: Apple AirPods Pro 2 Wireless Earbuds, Active Noi (brand none stated,  ) | FINDER | unverified |  | $4.49 | UNVERIFIED | not needed | 0.0142 | 0.0162 | 6562 |
| fellow-stagg-ekg | niche brand | Stagg EKG Electric Kettle (brand Fellow, 199.95 USD) | UNRESOLVED | unverified | Fellow Stagg EKG Pro Electric Gooseneck Kettle - Smoke Green @Brewtay Coffee |  | UNVERIFIED | not needed | 0.0385 | 0.0435 | 18755 |

