# Production eval, run 5

https://www.bustedlab.com, 2026-10-03T17:22:30.118Z to 2026-10-03T17:25:05.632Z. Budget mode (PR #8, merge 49e4ebe): diagnose on the merge commit, the one-time purge of earlier evaluation data, then six scans under a hard $0.60 all-in cap.

Spend this run: $0.2170 (Claude $0.1820, search $0.0350). All runs: $6.4104 of the $25 cap.

## Preflight

HTTP 200 in 379 ms.
Ready: **true** (production).
- warning email: The Resend key is send-only, so the domain could not be checked. Confirm bustedlab.com shows as verified in Resend.
- ok: redis, checkout (lemonsqueezy, overlay), base url, model key, search key, identity salt
- limits: {"dailyModelBudgetUsd":2,"paidScansPerAccountPerDay":500,"freeUncachedScansPerDay":50}

## Diagnose

HTTP 200 in 6291 ms.
Production is running commit `49e4ebe` (production).
Pass: **true**. Failing: none. Spend mode: full, today $0 of $2. This run's Claude cost: $0.020226; Serper credits: 5. Thinking per call: 75.
Limits in force: {"dailyModelBudgetUsd":2,"globalDailyFreeScanCap":50,"serpApiReserve":20,"retailerSweep":false}. Serper credits left: 2362.
Serper Lens: 0 matches, 0 usable, 0 priced, 3 credits; response shape {"list":null,"rows":0,"rowFields":[],"topLevel":["searchParameters","organic","credits"]}; sample [].

| layer | pass | status | ms | detail |
|---|---|---|---|---|
| claude claude-sonnet-5-5 (gate, degraded gate, re-confirmation) | pass | 200 | 1656 | answered and parsed |
| claude claude-opus-5-5 (gate fallback, extraction escalation) | pass | 200 | 4005 | answered and parsed |
| claude claude-sonnet-5-5 (first read, page text, search query) | pass | 200 | 2225 | answered and parsed |
| prompt cache | pass | 200 | 0 | the claude-sonnet-5-5 gate read 806 tokens of the photo from the cache the first read wrote (806 written) |
| blob | pass | 200 | 495 | uploaded, publicly readable, deleted |
| lens serper | pass | 200 | 2101 | the call succeeded but returned no visual matches |
| models api | pass | 200 | 506 | claude-sonnet-5-5 available, claude-opus-5-5 available, claude-fable-5-1 available |
| serpapi account (backup) | pass | 200 | 374 | 36 searches left; the backup may spend down to its reserve of 20 |
| serper shopping | pass | 200 | 1149 | answered; 40 result(s) |
| exchange rates | pass | 200 | 403 | rates for 2026-10-03: EUR 0.88862607, GBP 0.75533999, MAD 9.93526897, CAD 1.42505585 per USD |
| redis | pass | 200 | 352 | write and read |
| photo cap | pass | 200 | 335 | a 1170x2532 screenshot reaches the models at 725x1568 |

## Purge of earlier evaluation data

From run-1.json, run-2.json, run-3.json, run-4.json: 1 ledger record(s) (muq0qsdh30e5c684a68a1959f81360e3); counters {"scans":48,"verdicts":1,"busted":0,"savingsUsd":22.24}. Purge id `eval-runs-1-4`.
Applied.
Removed 1 ledger record(s): muq0qsdh30e5c684a68a1959f81360e3 "Stanley The Quencher H2.0 Flowstate™ 40-Ounce Tumbler ..." (OVERPRICED). Not found: none.
Counters before and after: {"scans":{"before":65,"after":17},"verdicts":{"before":2,"after":1},"busted":{"before":0,"after":0},"savingsUsd":{"before":32.19,"after":9.95}}.

## Photos

| case | source | license | size | note |
|---|---|---|---|---|
| yellowstone-cowboy-hat | [Yellowstone x Bailey Cowboy Western 10x Hat](https://yellowstonetvshop.com/products/yellowstone-fur-single-hat) | listing | 1500x1500 |  |
| flowlife-flowgun-air | [Flowgun Air – Percussive Therapy Massage Gun / Flowlife](https://www.flowlife.com/en-GB/product/flowgun-air) | listing | 480x600 |  |
| airpods-pro-2 | [AirPods Pro 2.jpg](https://commons.wikimedia.org/wiki/File:AirPods_Pro_2.jpg) | CC BY-SA 4.0 | 2000x1501 |  |
| silicone-pastry-brush | [Kitchen-Silicone-Brush.jpg](https://commons.wikimedia.org/wiki/File:Kitchen-Silicone-Brush.jpg) | Public domain | 2000x903 |  |
| car-phone-holder | [Car universal holder for smartphones and phablets, Oude Peke](https://commons.wikimedia.org/wiki/File:Car_universal_holder_for_smartphones_and_phablets,_Oude_Pekela_(2018)_01.jpg) | CC BY-SA 4.0 | 1125x2000 |  |
| stanley-quencher-eur | [Quencher® H2.0 FlowState™ Tumbler / 1.18L](https://eu.stanley1913.com/fr/products/quencher-h2-0-flowstate-tumbler-1-18-l) | listing | 1080x2340 | screenshot at 55,00 € |

## Scans

Free allowance seen from this runner's address: 2 before, 2 after (an evaluation scan must not use it). SerpApi searches left after: 35.
Scan step spend, all-in: $0.1918 of its $0.60 cap.

| case | kind | intent | class | confidence | mode | engine | shown | ms | $ all-in | $ model | Serper credits | SerpApi | cache read / written | calls reading |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| yellowstone-cowboy-hat | branded souvenir/apparel, printed logo | verdict | **WRONG** (shown as likely: Cuernos Chuecos 6X Oscar Black Felt Cowboy Hat) | likely | FINDER | lens_serper+priced_page | Cuernos Chuecos 6X Oscar Black Felt Cowboy Hat | 13995 | 0.0285 | 0.025484 | 3 | 0 | 5876 / 2938 | 2 of 3 |
| airpods-pro-2 | mainstream branded | verdict | **correct exact** | exact | FINDER | unbranded_serper | Apple AirPods Pro White with Magsafe Charging Case In Ear He | 28918 | 0.0507 | 0.043683 | 7 | 0 | 9720 / 2430 | 4 of 5 |
| stanley-quencher-eur | screenshot, euro price | verdict | **correct likely** | likely | VERDICT | lens_serper+priced_page | STANLEY QUENCHER 40OZ - Tooth of Time Traders | 16668 | 0.0296 | 0.024628 | 5 | 0 | 4434 / 1478 | 3 of 4 |
| flowlife-flowgun-air | small-brand electronics | finder | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 15182 | 0.0282 | 0.023196 | 5 | 0 | 0 / 0 | 0 of 4 |
| silicone-pastry-brush | unbranded generic | finder | **correct likely** | likely | FINDER | lens_serper+priced_serper | Silicone Basting Brush 9" Kitchen Tool Cooking Utensil Bakin | 11587 | 0.0218 | 0.016826 | 5 | 0 | 2956 / 1478 | 2 of 3 |
| car-phone-holder | unbranded generic | finder | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 35387 | 0.0329 | 0.027939 | 5 | 1 | 5442 / 1814 | 3 of 4 |

Totals: WRONG 1, correct exact 1, correct likely 2, miss 2.

Engine time per scan: median 16588 ms, p90 35286 ms, max 35286 ms.
Thinking tokens per call (approx.): mean 97, median 82, over 23 calls.

| layer | total ms | scans | mean ms |
|---|---|---|---|
| model:extraction | 12840 | 6 | 2140 |
| model:gate | 61224 | 6 | 10204 |
| search:lens | 11802 | 6 | 1967 |
| search:shopping | 28909 | 5 | 5782 |

| model@effort:layer | calls | mean ms | mean thinking | $ total |
|---|---|---|---|---|
| claude-sonnet-5-5@low:extraction | 6 | 2140 | 71 | 0.0467 |
| claude-sonnet-5-5@low:gate | 17 | 3601 | 107 | 0.1151 |

