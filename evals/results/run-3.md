# Production eval, run 3

https://www.bustedlab.com, 2026-10-01T21:25:44.091Z to 2026-10-01T21:36:12.506Z. After PR #6 (four-level gate, listing titles, non-listing hosts, text identification, own-page prices, advisory price searches): re-scan the failed cases in priority order within the SerpApi reserve; replay the gate for all 20 cases on the new prompt (candidates from run 2 where this run did not scan), on all three models and Sonnet 5.5 at higher effort; extraction replays on the three models.

Spend this run: $1.5735 (Claude $1.5575, search $0.0160). All runs: $6.1924 of the $25 cap.

## Preflight

HTTP 200 in 1752 ms.
Ready: **true** (production).
- warning email: The Resend key is send-only, so the domain could not be checked. Confirm bustedlab.com shows as verified in Resend.
- ok: redis, checkout (lemonsqueezy, overlay), base url, model key, search key, identity salt
- limits: {"dailyModelBudgetUsd":250,"paidScansPerAccountPerDay":500,"freeUncachedScansPerDay":25000}

## Diagnose

HTTP 200 in 4250 ms.
Production is running commit `unknown` (unknown).
Pass: **true**. Failing: none. Spend mode: full, today $4.56 of $250. This run's Claude cost: $0.011026. Thinking per call: 35.

| layer | pass | status | ms | detail |
|---|---|---|---|---|
| claude claude-opus-5-5 (gate) | pass | 200 | 2970 | answered and parsed |
| claude claude-sonnet-5-5 (gate fallback, degraded gate, re-confirmation) | pass | 200 | 1916 | answered and parsed |
| claude claude-sonnet-5-5 (first read, page text, search query) | pass | 200 | 1826 | answered and parsed |
| blob | pass | 200 | 503 | uploaded, publicly readable, deleted |
| lens serpapi | pass | 200 | 2046 | 40 visual matches; first: Purple Teeth Whitening Strips with Purple Gel, 28 Strips, 14 ... |
| models api | pass | 200 | 428 | claude-sonnet-5-5 available, claude-opus-5-5 available, claude-fable-5-1 available |
| serpapi account | pass | 200 | 306 | 83 searches left: top up before a traffic push |
| serper | pass | 200 | 1960 | answered; 1 result(s) |
| exchange rates | pass | 200 | 284 | rates for 2026-10-01: EUR 0.88365216, GBP 0.7549139, MAD 9.71943978, CAD 1.42483855 per USD |
| redis | pass | 200 | 359 | write and read |
| photo cap | pass | 200 | 381 | a 1170x2532 screenshot reaches the models at 725x1568 |

## Photos

| case | source | license | size | note |
|---|---|---|---|---|
| yellowstone-cowboy-hat | [Yellowstone x Bailey Cowboy Western 10x Hat](https://yellowstonetvshop.com/products/yellowstone-fur-single-hat) | listing | 1500x1500 |  |
| flowlife-flowgun-air | [Flowgun Air – Percussive Therapy Massage Gun / Flowlife](https://www.flowlife.com/en-GB/product/flowgun-air) | listing | 480x600 |  |
| airpods-pro-2 | [AirPods Pro 2.jpg](https://commons.wikimedia.org/wiki/File:AirPods_Pro_2.jpg) | CC BY-SA 4.0 | 2000x1501 |  |
| switch-oled | [Nintendo Switch OLED Model.jpg](https://commons.wikimedia.org/wiki/File:Nintendo_Switch_OLED_Model.jpg) | CC BY-SA 4.0 | 2000x1500 |  |
| kitchenaid-mixer | [White KitchenAid mixer (KSM150PSWH).jpg](https://commons.wikimedia.org/wiki/File:White_KitchenAid_mixer_(KSM150PSWH).jpg) | CC BY 2.0 | 1692x1264 |  |
| crocs-clog | [Crocs.JPG](https://commons.wikimedia.org/wiki/File:Crocs.JPG) | Public domain | 2000x1500 |  |
| owala-freesip | [Freesip Stainless Steel 24 oz](https://highcountryoutfitters.com/products/freesip-stainless-steel-24-oz) | listing | 1500x1500 |  |
| rayban-wayfarer | [RayBanWayfarer.jpg](https://commons.wikimedia.org/wiki/File:RayBanWayfarer.jpg) | CC BY 2.5 | 2000x1171 |  |
| led-fidget-spinner | [LED Fidget Spinner.jpg](https://commons.wikimedia.org/wiki/File:LED_Fidget_Spinner.jpg) | CC BY-SA 4.0 | 1500x2000 |  |
| jade-roller-gua-sha | [Jade roller & Gua Sha (Dirk van den Broek), Hillegersberg, R](https://commons.wikimedia.org/wiki/File:Jade_roller_%26_Gua_Sha_(Dirk_van_den_Broek),_Hillegersberg,_Rotterdam_(2023)_02.jpg) | CC BY-SA 4.0 | 2000x1125 |  |
| kitchen-spatula | [Kitchen-spatula.jpg](https://commons.wikimedia.org/wiki/File:Kitchen-spatula.jpg) | Public domain | 2000x1226 |  |
| silicone-pastry-brush | [Kitchen-Silicone-Brush.jpg](https://commons.wikimedia.org/wiki/File:Kitchen-Silicone-Brush.jpg) | Public domain | 2000x903 |  |
| car-phone-holder | [Car universal holder for smartphones and phablets, Oude Peke](https://commons.wikimedia.org/wiki/File:Car_universal_holder_for_smartphones_and_phablets,_Oude_Pekela_(2018)_01.jpg) | CC BY-SA 4.0 | 1125x2000 |  |
| raku-pitcher | [Colorful Handmade Raku Pottery Pitcher.jpg](https://commons.wikimedia.org/wiki/File:Colorful_Handmade_Raku_Pottery_Pitcher.jpg) | CC BY-SA 4.0 | 1610x1760 | mirrored, cropped |
| knitted-hat | [Knitting.jpg](https://commons.wikimedia.org/wiki/File:Knitting.jpg) | CC BY-SA 3.0 | 704x528 | mirrored, cropped |
| mary-rose-spoon | [MaryRose-wooden spoon2.JPG](https://commons.wikimedia.org/wiki/File:MaryRose-wooden_spoon2.JPG) | CC BY-SA 3.0 | 1760x1122 | mirrored, cropped |
| bukidnon-wooden-spoons | [Giant decorative wooden spoons and forks from Bukidnon, Phil](https://commons.wikimedia.org/wiki/File:Giant_decorative_wooden_spoons_and_forks_from_Bukidnon,_Philippines.jpg) | CC0 | 989x1760 | mirrored, cropped |
| stanley-quencher-eur | [Quencher® H2.0 FlowState™ Tumbler / 1.18L](https://eu.stanley1913.com/fr/products/quencher-h2-0-flowstate-tumbler-1-18-l) | listing | 1080x2340 | screenshot at 55,00 € |
| flowgun-go-eur | [Flowlife Flowgun GO 2.0 Blue Massagepistol](https://www.ongoal.eu/products/flowlife-flowgun-go-2-0-blue) | listing | 1080x2340 | screenshot at 238,95 € |
| solar-lamps-mad | FAILED | | | no asking price found on https://kelvins.ma/products/pack-4-lampes-led-solaires ; HTTP 404 from https://kelvins.ma/products/pack-4-lampes-led-solaires.json |

## Scans

Free allowance seen from this runner's address: 2 before, 2 after (an evaluation scan must not use it). SerpApi searches left after: 35.

| case | kind | intent | class | confidence | mode | engine | shown | ms | $ model | serpapi |
|---|---|---|---|---|---|---|---|---|---|---|
| crocs-clog | mainstream branded | verdict | **correct likely** | likely | FINDER | generic_serper | Crocs Men's 4 / Women's 6 - Baya Clogs Ultra Light Waterproo | 53821 | 0.118991 | 4 |
| flowlife-flowgun-air | small-brand electronics | finder | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 50717 | 0.04734 | 6 |
| switch-oled | mainstream branded | verdict | **correct exact** | exact | FINDER | direct_amazon | Nintendo Switch (OLED Model) - Neon Blue/Neon Red (Renewed) | 27955 | 0.069898 | 4 |
| raku-pitcher | unfindable: handmade one-off | finder | **honest lookalike** | unverified | FINDER | lens_serpapi | VINTAGE LARGE MAJOLICA CERAMIC VESSEL PITCHER JUG ARTIST ... | 36219 | 0.091635 | 4 |
| kitchen-spatula | unbranded generic | verdict | **miss** (only an unverified lookalike) | unverified | FINDER | lens_serpapi | Oxo Good Grips Silicone Flexible Omelet Turner - KitchenKape | 46017 | 0.094689 | 4 |
| solar-lamps-mad | screenshot, dirham price, unbranded generic | - | **error** (no photo) |  |  |  |  |  |  |  |
| flowgun-go-eur | screenshot, euro price | verdict | **correct exact** | exact | FINDER | lens_serpapi+priced_page | Flowlife Flowgun Go 2.0 massagepistol, blå - Punkt1.dk | 51797 | 0.040428 | 6 |
| silicone-pastry-brush | unbranded generic | finder | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 33352 | 0.057513 | 4 |
| mary-rose-spoon | unfindable: one-off artefact | verdict | **honest lookalike** | unverified | FINDER | lens_serpapi | Antique Primitive Hand Carved Wooden Spoon, Long Wooden ... | 38339 | 0.07878 | 4 |
| car-phone-holder | unbranded generic | finder | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 34876 | 0.071214 | 4 |
| led-fidget-spinner | unbranded generic | verdict | **correct likely** | likely | FINDER | lens_serpapi | Promotional LIGHT-UP FIDGET SPINNERS / Everything Promo | 37311 | 0.065157 | 4 |
| jade-roller-gua-sha | regional store brand (Peach Beauty, Dutch supermarket) | verdict | **honest lookalike** | unverified | FINDER | lens_serpapi | Jade Face Roller & Gua Sha Massage Tool Set - Premium Skin . | 30622 | 0.07275 | 4 |

Totals: correct likely 2, miss 4, correct exact 2, honest lookalike 3, error 1.

Engine time per scan: median 36867 ms, p90 51495 ms, max 53150 ms.
Thinking tokens per call (approx.): mean 128, median 92, over 53 calls.

| layer | total ms | scans | mean ms |
|---|---|---|---|
| model:extraction | 22013 | 11 | 2001 |
| model:gate | 247251 | 11 | 22477 |
| search:lens | 56873 | 11 | 5170 |
| search:retailer | 94116 | 11 | 8556 |
| search:shopping | 65170 | 10 | 6517 |

| model@effort:layer | calls | mean ms | mean thinking | $ total |
|---|---|---|---|---|
| claude-opus-5-5@low:gate | 40 | 6077 | 149 | 0.7112 |
| claude-sonnet-5-5@low:extraction | 11 | 2001 | 70 | 0.0792 |
| claude-sonnet-5-5@low:gate | 2 | 2086 | 32 | 0.0179 |

## Model replays: the gate

Each model judged the same candidates the production gate saw for each case (identification waves of the verdict scan). "WRONG" means it would have shown a wrong product as a match.

| model@effort | WRONG shown | hits | misses (reachable) | honest on unfindable | errors | $ total | mean ms/case | mean thinking/call |
|---|---|---|---|---|---|---|---|---|
| claude-opus-5-5@low | 0 | 4 | 1 of 14 reachable | 0 of 3 | 13 | 0.1326 | 2000 | 247 |
| claude-sonnet-5-5@low | 0 | 4 | 1 of 14 reachable | 0 of 3 | 13 | 0.0592 | 1360 | 116 |
| claude-fable-5-1@low | 0 | 3 | 1 of 14 reachable | 0 of 3 | 14 | 0.2324 | 2374 | 120 |
| claude-sonnet-5-5@medium | 0 | 4 | 1 of 14 reachable | 0 of 3 | 13 | 0.0378 | 1405 | 129 |
| claude-sonnet-5-5@high | 0 | 2 | 2 of 14 reachable | 0 of 3 | 14 | 0.0338 | 1593 | 265 |

Candidate-level agreement with claude-opus-5-5@low:

| model@effort | candidates | same answer | claims identity where reference does not | reference claims, this one does not |
|---|---|---|---|---|
| claude-sonnet-5-5@low | 188 | 179 | 0 | 0 |
| claude-fable-5-1@low | 188 | 179 | 0 | 6 |
| claude-sonnet-5-5@medium | 188 | 179 | 0 | 0 |
| claude-sonnet-5-5@high | 188 | 177 | 0 | 5 |

Per case (outcome / confidence):

| case | claude-opus-5-5@low | claude-sonnet-5-5@low | claude-fable-5-1@low | claude-sonnet-5-5@medium | claude-sonnet-5-5@high |
|---|---|---|---|---|---|
| yellowstone-cowboy-hat | hit/exact | hit/exact | hit/exact | hit/likely | miss/none |
| flowlife-flowgun-air | hit/exact | hit/exact | hit/exact | hit/exact | hit/exact |
| airpods-pro-2 | miss/none | miss/none | miss/none | miss/none | miss/none |
| switch-oled | hit/exact | hit/exact | hit/exact | hit/exact | hit/exact |
| kitchenaid-mixer | hit/exact | hit/likely | error/none | hit/likely | error/none |
| crocs-clog | error/none | error/none | error/none | error/none | error/none |
| owala-freesip | error/none | error/none | error/none | error/none | error/none |
| rayban-wayfarer | error/none | error/none | error/none | error/none | error/none |
| led-fidget-spinner | error/none | error/none | error/none | error/none | error/none |
| jade-roller-gua-sha | error/none | error/none | error/none | error/none | error/none |
| kitchen-spatula | error/none | error/none | error/none | error/none | error/none |
| silicone-pastry-brush | error/none | error/none | error/none | error/none | error/none |
| car-phone-holder | error/none | error/none | error/none | error/none | error/none |
| raku-pitcher | error/none | error/none | error/none | error/none | error/none |
| knitted-hat | error/none | error/none | error/none | error/none | error/none |
| mary-rose-spoon | error/none | error/none | error/none | error/none | error/none |
| bukidnon-wooden-spoons |  |  |  |  |  |
| stanley-quencher-eur | error/none | error/none | error/none | error/none | error/none |
| flowgun-go-eur | error/none | error/none | error/none | error/none | error/none |
| solar-lamps-mad |  |  |  |  |  |

## Model replays: extraction

| model@effort | reads | brand right | screenshot price+currency right | $ total | mean ms | mean thinking |
|---|---|---|---|---|---|---|
| claude-sonnet-5-5@low | 4/19 | 9/19 | 0/2 | 0.0297 | 667 | 69 |
| claude-opus-5-5@low | 4/19 | 10/19 | 0/2 | 0.0650 | 988 | 135 |
| claude-fable-5-1@low | 4/19 | 10/19 | 0/2 | 0.1476 | 1595 | 66 |

