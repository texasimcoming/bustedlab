# Production eval, run 7

https://www.bustedlab.com, 2026-10-04T18:53:02.441Z to 2026-10-04T18:55:42.313Z. Live validation of the match guards and the SerpApi Lens escalation on production (PR #17, merge 5fa0d34; diagnose passed on it in the watchdog's deploy run): the six run-5 cases through the evaluation path, the wrong and missed ones first, under a $0.35 all-in scan cap that keeps the job's Claude total under $0.60.

Spend this run: $0.2457 (Claude $0.1857, search $0.0600). All runs: $6.8366 of the $25 cap.

## Preflight

HTTP 200 in 637 ms.
Ready: **true** (production).
- warning email: The Resend key is send-only, so the domain could not be checked. Confirm bustedlab.com shows as verified in Resend.
- ok: redis, checkout (lemonsqueezy, overlay), base url, model key, search key, identity salt
- limits: {"dailyModelBudgetUsd":2,"paidScansPerAccountPerDay":500,"freeUncachedScansPerDay":50}

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

Stopped early: the scan step's cap of $0.35 could be crossed by the next scan ($0.2457 spent).

Free allowance seen from this runner's address: 2 before, 2 after (an evaluation scan must not use it). SerpApi searches left after: unknown.
Scan step spend, all-in: $0.2457 of its $0.35 cap.

| case | kind | intent | class | confidence | mode | engine | SerpApi escalation | shown | ms | $ all-in | $ model | Serper credits | SerpApi | cache read / written | calls reading |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| yellowstone-cowboy-hat | branded souvenir/apparel, printed logo | verdict | **miss** (no match) | unverified | UNRESOLVED | none | ran: 37 new, unverified, used | Product not identified | 33563 | 0.0637 | 0.048671 | 5 | 1 | 14690 / 2938 | 5 of 6 |
| flowlife-flowgun-air | small-brand electronics | finder | **correct exact** | exact | FINDER | lens_serper+escalated_serpapi+priced_page | ran: 38 new, exact, used | Flowgun Air Reuse - Percussive Massage Gun / Flowlife | 32783 | 0.0426 | 0.029584 | 3 | 1 | 0 / 0 | 0 of 4 |
| car-phone-holder | unbranded generic | finder | **miss** (no match) | unverified | UNRESOLVED | none | ran: 37 new, unverified, used | Product not identified | 32711 | 0.0642 | 0.049217 | 5 | 1 | 9070 / 1814 | 5 of 6 |
| airpods-pro-2 | mainstream branded | verdict | **correct likely** | likely | FINDER | lens_serper+escalated_serpapi+priced_serper | ran: 40 new, likely, used | Apple Airpods Pro A2700, A2699, A2698 (g124595-1 (io) By-9x) | 41084 | 0.0752 | 0.058187 | 7 | 1 | 14580 / 2430 | 6 of 7 |

Totals: miss 2, correct exact 1, correct likely 1.

Engine time per scan: median 33256 ms, p90 40967 ms, max 40967 ms.
Thinking tokens per call (approx.): mean 118, median 116, over 23 calls.

| layer | total ms | scans | mean ms |
|---|---|---|---|
| model:extraction | 8594 | 4 | 2149 |
| model:gate | 78081 | 4 | 19520 |
| search:lens | 43030 | 4 | 10758 |
| search:shopping | 6059 | 3 | 2020 |

| model@effort:layer | calls | mean ms | mean thinking | $ total |
|---|---|---|---|---|
| claude-sonnet-5-5@low:extraction | 4 | 2149 | 68 | 0.0324 |
| claude-sonnet-5-5@low:gate | 19 | 4110 | 128 | 0.1533 |

