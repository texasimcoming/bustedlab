# Production eval, run 2

https://www.bustedlab.com, 2026-10-01T20:42:39.976Z to 2026-10-01T21:07:41.750Z. Labelled set on production (after PR #5): 20 cases on both intents, then the gate and extraction replayed on Opus 5.5, Sonnet 5.5 and Fable 5.1, plus Opus 5.5 at medium effort.

Spend this run: $4.5970 (Claude $4.5510, search $0.0460). All runs: $4.6189 of the $25 cap.

## Preflight

HTTP 200 in 693 ms.
Ready: **true** (production).
- warning email: The Resend key is send-only, so the domain could not be checked. Confirm bustedlab.com shows as verified in Resend.
- ok: redis, checkout (lemonsqueezy, overlay), base url, model key, search key, identity salt
- limits: {"dailyModelBudgetUsd":250,"paidScansPerAccountPerDay":500,"freeUncachedScansPerDay":25000}

## Diagnose

HTTP 200 in 6488 ms.
Pass: **true**. Failing: none. Spend mode: full, today $0.01 of $250. This run's Claude cost: $0.010736. Thinking per call: 34.

| layer | pass | status | ms | detail |
|---|---|---|---|---|
| claude claude-opus-5-5 (gate) | pass | 200 | 3028 | answered and parsed |
| claude claude-sonnet-5-5 (gate fallback, degraded gate, re-confirmation) | pass | 200 | 1881 | answered and parsed |
| claude claude-sonnet-5-5 (first read, page text, search query) | pass | 200 | 1809 | answered and parsed |
| blob | pass | 200 | 648 | uploaded, publicly readable, deleted |
| lens serpapi | pass | 200 | 5288 | 40 visual matches; first: Amazon.com: DRDENT Purple Teeth Whitening Strips - 42 Strips ... |
| models api | pass | 200 | 558 | claude-sonnet-5-5 available, claude-opus-5-5 available, claude-fable-5-1 available |
| serpapi account | pass | 200 | 522 | 218 searches left: top up before a traffic push |
| serper | pass | 200 | 1609 | answered; 1 result(s) |
| exchange rates | pass | 200 | 415 | rates for 2026-10-01: EUR 0.88365216, GBP 0.7549139, MAD 9.71943978, CAD 1.42483855 per USD |
| redis | pass | 200 | 493 | write and read |
| photo cap | pass | 200 | 516 | a 1170x2532 screenshot reaches the models at 725x1568 |

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
| carved-spoon | [Spoon by Morriperkele.jpg](https://commons.wikimedia.org/wiki/File:Spoon_by_Morriperkele.jpg) | FAL | 704x476 | mirrored, cropped |
| bukidnon-wooden-spoons | [Giant decorative wooden spoons and forks from Bukidnon, Phil](https://commons.wikimedia.org/wiki/File:Giant_decorative_wooden_spoons_and_forks_from_Bukidnon,_Philippines.jpg) | CC0 | 989x1760 | mirrored, cropped |
| stanley-quencher-eur | [Quencher® H2.0 FlowState™ Tumbler / 1.18L](https://eu.stanley1913.com/fr/products/quencher-h2-0-flowstate-tumbler-1-18-l) | listing | 1080x2340 | screenshot at 55,00 € |
| flowgun-go-eur | [Flowlife Flowgun Go! Massagepistol](https://www.ongoal.com/products/flowlife-flowgun-go-massage-gun) | listing | 1080x2340 | screenshot at 221 kr |
| sunset-lamp-mad | FAILED | | | HTTP 403 from https://www.marjanemall.ma/p/lampe-de-coucher-de-soleil-sunset-lamp-projection-aaamv72782 |

## Scans

Free allowance seen from this runner's address: 2 before, 2 after (an evaluation scan must not use it). SerpApi searches left after: 65.

| case | kind | intent | class | confidence | mode | engine | shown | ms | $ model | serpapi |
|---|---|---|---|---|---|---|---|---|---|---|
| yellowstone-cowboy-hat | branded souvenir/apparel, printed logo | verdict | **correct exact** | exact | FINDER | lens_serpapi | Yellowstone Cowboy Hat by Bailey 10x Western / Yellowstone S | 23498 | 0.045176 | 4 |
| yellowstone-cowboy-hat | branded souvenir/apparel, printed logo | finder | **correct exact** | exact | FINDER | lens_serpapi | Yellowstone Cowboy Hat by Bailey 10x Western / Yellowstone S | 17165 | 0.034105 | 4 |
| flowlife-flowgun-air | small-brand electronics | verdict | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 24504 | 0.03682 | 4 |
| flowlife-flowgun-air | small-brand electronics | finder | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 26051 | 0.034058 | 4 |
| airpods-pro-2 | mainstream branded | verdict | **correct exact** | exact | FINDER | lens_serpapi+priced_serper | Apple AirPods Pro with MagSafe Case | 37251 | 0.066748 | 4 |
| airpods-pro-2 | mainstream branded | finder | **correct exact** | exact | FINDER | lens_serpapi+reused | Apple AirPods Pro with MagSafe Case | 9355 | 0.016725 | 1 |
| switch-oled | mainstream branded | verdict | **WRONG** (shown as exact: Nintendo Switch With Docking Station, Charger, HDMI 55GB / eBay) | exact | FINDER | lens_serpapi | Nintendo Switch With Docking Station, Charger, HDMI 55GB / e | 27229 | 0.050579 | 4 |
| switch-oled | mainstream branded | finder | **correct exact** | exact | FINDER | unbranded_serper | Oled Red And Blue Joy Cons Nintendo Switch OLED Model Game C | 24868 | 0.047882 | 4 |
| kitchenaid-mixer | mainstream branded | verdict | **correct exact** | exact | FINDER | unbranded_serper | KitchenAid Artisan Series 5 Quart Tilt-Head Stand Mixer in W | 23658 | 0.057277 | 4 |
| kitchenaid-mixer | mainstream branded | finder | **correct exact** | exact | FINDER | lens_serpapi+reused | KitchenAid Artisan Series 5 Quart Tilt-Head Stand Mixer in W | 10994 | 0.016643 | 1 |
| crocs-clog | mainstream branded | verdict | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 40833 | 0.056594 | 5 |
| crocs-clog | mainstream branded | finder | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 25262 | 0.043944 | 5 |
| owala-freesip | mainstream branded | verdict | **correct exact** | exact | FINDER | lens_serpapi | Owala 24 fl oz Stainless Steel FreeSip Water Bottle - Out of | 23491 | 0.045818 | 4 |
| owala-freesip | mainstream branded | finder | **correct exact** | exact | FINDER | lens_serpapi+reused | Owala 24 fl oz Stainless Steel FreeSip Water Bottle - Out of | 7430 | 0.018853 | 1 |
| rayban-wayfarer | mainstream branded | verdict | **correct exact** | exact | FINDER | lens_serpapi | Ray Ban™ New Wayfarer NON-POLARIZED RB 2132 Sunglasses Italy | 17377 | 0.040998 | 4 |
| rayban-wayfarer | mainstream branded | finder | **correct exact** | exact | FINDER | lens_serpapi+reused | Ray Ban™ New Wayfarer NON-POLARIZED RB 2132 Sunglasses Italy | 13318 | 0.014145 | 1 |
| led-fidget-spinner | unbranded generic | verdict | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 27125 | 0.050386 | 4 |
| led-fidget-spinner | unbranded generic | finder | **correct exact** | exact | FINDER | lens_serpapi | UPGRADE VERSION SWITCH CONTROL 3 MODE LED HAND SPINNER EDC . | 28809 | 0.04241 | 4 |
| jade-roller-gua-sha | unbranded generic | verdict | **error** (scan_incomplete) |  | scan_incomplete |  |  | 64130 | 0.059014 | 5 |
| jade-roller-gua-sha | unbranded generic | finder | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 27444 | 0.040576 | 4 |
| kitchen-spatula | unbranded generic | verdict | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 46517 | 0.042213 | 6 |
| kitchen-spatula | unbranded generic | finder | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 24665 | 0.035765 | 4 |
| silicone-pastry-brush | unbranded generic | verdict | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 27051 | 0.035457 | 4 |
| silicone-pastry-brush | unbranded generic | finder | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 24851 | 0.034929 | 4 |
| car-phone-holder | unbranded generic | verdict | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 22515 | 0.045788 | 4 |
| car-phone-holder | unbranded generic | finder | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 24596 | 0.036076 | 5 |
| raku-pitcher | unfindable: handmade one-off | verdict | **honest no-match** | unverified | UNRESOLVED | none | Product not identified | 27931 | 0.056602 | 4 |
| raku-pitcher | unfindable: handmade one-off | finder | **WRONG** (an unfindable item shown as likely) | likely | FINDER | direct_ebay | Raku Pottery Pitcher - Irredesent Glaze Pottery Pitcher | 35076 | 0.054677 | 4 |
| knitted-hat | unfindable: handmade one-off | verdict | **honest no-match** | unverified | UNRESOLVED | none | Product not identified | 48780 | 0.017534 | 4 |
| knitted-hat | unfindable: handmade one-off | finder | **honest no-match** | unverified | UNRESOLVED | none | Product not identified | 46267 | 0.025242 | 7 |
| carved-spoon | unfindable: handmade one-off | verdict | **WRONG** (an unfindable item shown as exact) | exact | FINDER | lens_serpapi | I Have A Spoon // illustration - Gone With The Blastwave ... | 25758 | 0.033078 | 4 |
| carved-spoon | unfindable: handmade one-off | finder | **WRONG** (an unfindable item shown as exact) | exact | FINDER | lens_serpapi | I Have A Spoon // illustration - Gone With The Blastwave ... | 22940 | 0.0385 | 4 |
| bukidnon-wooden-spoons | unfindable: regional craft | verdict | **honest no-match** | unverified | UNRESOLVED | none | Product not identified | 31254 | 0.048454 | 5 |
| bukidnon-wooden-spoons | unfindable: regional craft | finder | **honest no-match** | unverified | UNRESOLVED | none | Product not identified | 30960 | 0.038976 | 5 |
| stanley-quencher-eur | screenshot, euro price | verdict | **correct exact** | exact | VERDICT | lens_serpapi | Stanley The Quencher H2.0 Flowstate™ 40-Ounce Tumbler ... | 17253 | 0.03259 | 4 |
| stanley-quencher-eur | screenshot, euro price | finder | **correct exact** | exact | FINDER | unbranded_serper | Stanley The Quencher H2.0 Flowstate 40-Ounce Tumbler in Rose | 22927 | 0.038586 | 4 |
| flowgun-go-eur | screenshot, euro price | verdict | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 55284 | 0.023872 | 4 |
| flowgun-go-eur | screenshot, euro price | finder | **miss** (no match) | unverified | UNRESOLVED | none | Product not identified | 55029 | 0.034925 | 6 |
| sunset-lamp-mad | screenshot, dirham price, unbranded generic | - | **error** (no photo) |  |  |  |  |  |  |  |

Totals: correct exact 14, miss 14, WRONG 4, error 2, honest no-match 5.

Engine time per scan: median 25698 ms, p90 48664 ms, max 64010 ms.
Thinking tokens per call (approx.): mean 112, median 77, over 132 calls.

| layer | total ms | scans | mean ms |
|---|---|---|---|
| model:extraction | 80163 | 38 | 2110 |
| model:gate | 476100 | 38 | 12529 |
| search:lens | 152620 | 38 | 4016 |
| search:retailer | 310030 | 32 | 9688 |
| search:shopping | 230791 | 29 | 7958 |

| model@effort:layer | calls | mean ms | mean thinking | $ total |
|---|---|---|---|---|
| claude-opus-5-5@low:gate | 88 | 5273 | 135 | 1.1764 |
| claude-sonnet-5-5@low:extraction | 38 | 2110 | 72 | 0.2731 |
| claude-sonnet-5-5@low:gate | 6 | 2010 | 31 | 0.0425 |

## Model replays: the gate

Each model judged the same candidates the production gate saw for each case (identification waves of the verdict scan). "WRONG" means it would have shown a wrong product as a match.

| model@effort | WRONG shown | hits | misses (reachable) | honest on unfindable | errors | $ total | mean ms/case | mean thinking/call |
|---|---|---|---|---|---|---|---|---|
| claude-opus-5-5@low | 8 | 11 | 0 of 15 reachable | 0 of 4 | 0 | 0.4126 | 6231 | 171 |
| claude-sonnet-5-5@low | 8 | 11 | 0 of 15 reachable | 0 of 4 | 0 | 0.2053 | 4821 | 116 |
| claude-fable-5-1@low | 7 | 12 | 0 of 15 reachable | 0 of 4 | 0 | 1.0004 | 8378 | 114 |
| claude-opus-5-5@medium | 8 | 11 | 0 of 15 reachable | 0 of 4 | 0 | 0.3289 | 8479 | 397 |

Per case (outcome / confidence):

| case | claude-opus-5-5@low | claude-sonnet-5-5@low | claude-fable-5-1@low | claude-opus-5-5@medium |
|---|---|---|---|---|
| yellowstone-cowboy-hat | hit/exact | hit/likely | hit/exact | hit/exact |
| flowlife-flowgun-air | hit/exact | hit/exact | hit/exact | hit/exact |
| airpods-pro-2 | WRONG/exact: Apple's New AirPods Boast Impressive Noise-Cancell | WRONG/exact: Apple's New AirPods Boast Impressive Noise-Cancell | WRONG/exact: Apple's New AirPods Boast Impressive Noise-Cancell | WRONG/exact: Apple's New AirPods Boast Impressive Noise-Cancell |
| switch-oled | WRONG/exact: Nintendo Switch With Docking Station, Charger, HDM | WRONG/exact: Nintendo Switch With Docking Station, Charger, HDM | hit/exact | WRONG/exact: Nintendo Switch With Docking Station, Charger, HDM |
| kitchenaid-mixer | hit/exact | hit/exact | hit/exact | hit/exact |
| crocs-clog | hit/exact | hit/exact | hit/exact | hit/exact |
| owala-freesip | hit/exact | hit/exact | hit/exact | hit/exact |
| rayban-wayfarer | hit/exact | hit/likely | hit/exact | hit/exact |
| led-fidget-spinner | hit/exact | hit/exact | hit/exact | hit/exact |
| jade-roller-gua-sha | hit/exact | hit/exact | hit/exact | hit/exact |
| kitchen-spatula | WRONG/exact: Photos from Avenue Supermarts Limited, Mumbai - Re | WRONG/exact: Photos from Avenue Supermarts Limited, Mumbai - Re | WRONG/exact: Photos from Avenue Supermarts Limited, Mumbai - Re | WRONG/exact: Photos from Avenue Supermarts Limited, Mumbai - Re |
| silicone-pastry-brush | hit/exact | hit/exact | hit/exact | hit/exact |
| car-phone-holder | WRONG/exact: Suporte de celular para cama: como escolher um mod | WRONG/exact: Suporte de celular para cama: como escolher um mod | WRONG/exact: Suporte de celular para cama: como escolher um mod | WRONG/exact: Suporte de celular para cama: como escolher um mod |
| raku-pitcher | WRONG/exact: File:Colorful Handmade Raku Pottery Pitcher.jpg -  | WRONG/exact: File:Colorful Handmade Raku Pottery Pitcher.jpg -  | WRONG/exact: File:Colorful Handmade Raku Pottery Pitcher.jpg -  | WRONG/exact: File:Colorful Handmade Raku Pottery Pitcher.jpg -  |
| knitted-hat | WRONG/exact: File:Knitting.jpg - Wikimedia Commons / https://co | WRONG/exact: File:Knitting.jpg - Wikimedia Commons / https://co | WRONG/exact: File:Knitting.jpg - Wikimedia Commons / https://co | WRONG/exact: File:Knitting.jpg - Wikimedia Commons / https://co |
| carved-spoon | WRONG/exact: I Have A Spoon // illustration - Gone With The Bla | WRONG/exact: I Have A Spoon // illustration - Gone With The Bla | WRONG/exact: I Have A Spoon // illustration - Gone With The Bla | WRONG/exact: I Have A Spoon // illustration - Gone With The Bla |
| bukidnon-wooden-spoons | WRONG/exact: Wooden spoon - Wikipedia / https://en.wikipedia.or | WRONG/exact: Wooden spoon - Wikipedia / https://en.wikipedia.or | WRONG/exact: Wooden spoon - Wikipedia / https://en.wikipedia.or | WRONG/exact: Wooden spoon - Wikipedia / https://en.wikipedia.or |
| stanley-quencher-eur | hit/exact | hit/exact | hit/exact | hit/exact |
| flowgun-go-eur | hit/exact | hit/exact | hit/exact | hit/exact |
| sunset-lamp-mad |  |  |  |  |

## Model replays: extraction

| model@effort | reads | brand right | screenshot price+currency right | $ total | mean ms | mean thinking |
|---|---|---|---|---|---|---|
| claude-sonnet-5-5@low | 19/19 | 17/19 | 1/2 | 0.1365 | 2418 | 71 |
| claude-opus-5-5@low | 19/19 | 17/19 | 1/2 | 0.2851 | 3834 | 102 |
| claude-fable-5-1@low | 19/19 | 17/19 | 1/2 | 0.6794 | 5570 | 70 |

