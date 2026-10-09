# Production eval, run 11

https://www.bustedlab.com, 2026-10-09T21:06:10.610Z to 2026-10-09T21:13:18.466Z. Is Claude Haiku 5.5 a safe gate? Every stored candidate (373, from runs 2 to 10) through the shipped gate prompt and match guards on Haiku 5.5 at low effort, with each case its stored first read; run 6 sets first, so its 89 hard candidates get the same reads Sonnet 5.5 had there. The replay repeats no search and runs no scan, and nothing in this run writes public data. Haiku 5.5 is $0.10 / $0.50 per million tokens against Sonnet 5.5 at $2 / $10. Cap $0.15 of Claude. Plus one real link scan through the evaluation path, an http link that redirects to https, to prove the new page-fetch address check (fetchPublic, PR #30) on the live runtime; link cap $0.10. Run total cap $0.27.

Spend this run: $0.0726 (Claude $0.0656, search $0.0070). All runs: $7.1574 of the $25 cap.

## Preflight

HTTP 200 in 789 ms.
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
| flowgun-go-eur | [Flowlife Flowgun GO 2.0 Blue Massagepistol](https://www.ongoal.eu/products/flowlife-flowgun-go-2-0-blue) | listing | 1080x2340 | screenshot at 240,95 € |

## Replay of stored candidates on the shipped gate and guards

370 candidate(s) judged by claude-haiku-5-5@low; Claude $0.0461 of the $0.15 cap.

| case | from run | purpose | listing | label | gate | tie | guard | now | why |
|---|---|---|---|---|---|---|---|---|---|
| flowlife-flowgun-air | 5 | identify | MVPmini 5 in 1 Percussion Massager with Carrying Case and 4  | **wrong** | likely | part | no_brand_likely | similar | Body with the same LED indicator panel and rounded top as IMAGE A; title names MVPmini, th |
| flowlife-flowgun-air | 5 | identify | Playmakar MVP Mini Percussion Massage System Massage Gun MVP | **wrong** | likely | part | no_brand_likely | similar | Same MVPmini body shape and black finish as IMAGE A; title names MVP Mini, with the view s |
| flowlife-flowgun-air | 3 | identify | Flowgun Air Reuse – Percussive Massage Gun / Flowlife | right | likely | part | no_brand_likely | similar | Same black body with the same vertical side panel of indicator dots and power button and t |
| flowlife-flowgun-air | 3 | identify | Flowlife Flowgun Air - buy at Galaxus | right | likely | part | no_brand_likely | similar | Gun body with ball head and side LED dot panel matches Flowgun Air design; accessories sho |
| flowlife-flowgun-air | 2 | identify | Flowgun Air – Lightweight Percussive Massage Gun / Flowlife | right | exact | photo |  | exact | Identical product photograph to IMAGE A; Flowlife Flowgun Air title confirms the model |
| flowlife-flowgun-air | 2 | identify | Flowgun Air – Lightweight Percussive Massage Gun / Flowlife | right | exact | photo |  | exact | Identical product photograph to IMAGE A; Flowlife Flowgun Air title confirms the model |
| car-phone-holder | 3 | identify | WAOCEO Tablet Holder Tablet Car Mount Holder for Windshield  | **wrong** | likely | part | no_brand_likely | similar | Same gooseneck mount with the same central disc, grey grips and black body; title says 'ta |
| silicone-pastry-brush | 2 | identify | Amazon.com: Silicone Basting Brush 9" Kitchen Cooking ... | right | likely | part | no_brand_likely | similar | Same red silicone head and clear handle with hanging loop; title's 9-inch basting brush fi |
| kitchen-spatula | 2 | identify | Photos from Avenue Supermarts Limited, Mumbai - Retailer of  | **wrong** | likely | part | no_brand_likely | similar | Same steel handle with end hanging hole and black four-slot head, in the same layout; only |
| airpods-pro-2 | 7 | identify | Apple Airpods Pro: (Right SIDE ONLY) for Replacement Pro 1st | **wrong** | likely | part | part_listing | similar | Right AirPods Pro 1st gen earbud with the same stem, black oval vent and glossy white fini |
| airpods-pro-2 | 7 | identify | White Airpods Pro Wireless Earbuds – Unclaimed Baggage | right | likely | part | brand_veto | similar | White AirPods Pro with the same black mesh pill on the stem; no brand marking visible to c |
| airpods-pro-2 | 7 | identify | APPLE AIRPODS PRO A2700, A2699, A2698 (G124595-1 (IO) BY-9X  | right | likely | part |  | likely | White AirPods Pro with the same black stem pill; title model numbers fit the Pro line but  |
| switch-oled | 2 | identify | Nintendo Switch OLED Model / HonestyHive | right | exact | photo |  | exact | Identical product photograph (same couch, same console and Joy-Cons); title names the OLED |
| yellowstone-cowboy-hat | 2 | identify | Yellowstone Cowboy Hat by Bailey 10x Western / Yellowstone S | right | likely | part | no_brand_likely | similar | Same pinched crown and gold hatband ornament on the right side as IMAGE A; the Yellowstone |
| yellowstone-cowboy-hat | 2 | identify | Yellowstone Bailey Cowboy Western 10x Hat by Bollman Hats .. | right | likely | part | no_brand_likely | similar | Same photo style and hat as candidate 1, with the same pinched crown and right-side hatban |
| yellowstone-cowboy-hat | 7 | identify | Larry Mahan Opulento 30X Black Copa 65 – Resistol & Stetson  | **wrong** | likely | part | no_brand_likely | similar | Black felt hat with the same pinched crown and gold-accented hatband ornament on the right |
| yellowstone-cowboy-hat | 7 | identify | Larry Mahan 30X Opulento (MF3065OPUL40-Black) – El Herradero | **wrong** | likely | part | no_brand_likely | similar | Front view matches IMAGE A's crown pinch, brim and gold hatband ornament; title names Larr |
| yellowstone-cowboy-hat | 7 | identify | Larry Mahan Opulento 30X Felt Cowboy Hat / Boot Barn | **wrong** | likely | part | no_brand_likely | similar | Larry Mahan Opulento with the same gold hatband ornament and crown; the angle differs, so  |
| stanley-quencher-eur | 5 | identify | STANLEY QUENCHER 40OZ - Tooth of Time Traders | right | likely | logo |  | likely | Same rose quartz 40oz Quencher with the Stanley logo on the body; the title matches the si |
| stanley-quencher-eur | 5 | identify | world.taobao.com: Stanley Shaker Cup Large Capacity Portable | **wrong** | likely | logo |  | likely | Stanley logo and matching rose colour on a similar Quencher-style cup; the generic title n |
| stanley-quencher-eur | 2 | identify | Amazon.com: STANLEY Quencher H2.0 Tumbler with Handle and .. | right | likely | logo |  | likely | Same Stanley Quencher H2.0 design with the handle, straw and pink colourway; the truncated |
| stanley-quencher-eur | 2 | identify | Quencher H2.0 FlowState Tumbler / 1.18L / Stanley 1913 NL | right | exact | logo |  | exact | Same Stanley logo, Quencher H2.0 FlowState silhouette and rose colourway; title names the  |
| stanley-quencher-eur | 2 | identify | Stanley 40 oz Stainless Steel H2.0 FlowState Quencher ... | right | likely | logo |  | likely | Same Stanley logo and H2.0 design; the title's 40 oz matches 1.18L, but the shade looks sl |
| stanley-quencher-eur | 2 | identify | Stanley 40 oz. Quencher Tumbler / AnthroHome | right | likely | logo |  | likely | Same Stanley logo and Quencher shape, but the handle is a different shade, suggesting a va |
| stanley-quencher-eur | 2 | identify | Other accessories STANLEY The Quencher H2.O FlowState ... | right | likely | logo |  | likely | Same Stanley Quencher H2.0 design and pink colour with 1.18L spec text, but the image is a |
| stanley-quencher-eur | 2 | identify | Stanley The Quencher H2.0 Flowstate™ 40-Ounce Tumbler ... | right | likely | logo |  | likely | Same Stanley Quencher H2.0 40-oz design and pink colourway with the logo; the title does n |
| stanley-quencher-eur | 2 | identify | Quencher H2.0 FlowState Tumbler / 1.18L / Stanley 1913 NL | right | exact | logo |  | exact | Same Stanley logo, Quencher H2.0 FlowState silhouette and rose colourway; title names the  |
| stanley-quencher-eur | 2 | identify | Stanley Quencher H2.0 FlowState Tumbler 1.2L - Cold for 11 . | right | likely | text |  | likely | Same pink Stanley Quencher H2.0 FlowState tumbler; printed model name matches, and the 1.2 |
| stanley-quencher-eur | 2 | identify | The Quencher H2.0 Flowstate Tumbler / 40oz / Stanley 1913 US | right | likely | logo |  | likely | Same pink Quencher H2.0 with Stanley logo; 40oz equals 1.18L, but the photo is not the sam |
| stanley-quencher-eur | 8 | identify | THE QUENCHER 2.0™ TUMBLER – Stanley 1913 Indonesia | right | likely | text |  | likely | Same pink Quencher 2.0 tumbler with Stanley branding and matching model name; colourway ma |
| stanley-quencher-eur | 9 | identify | Stanley Quencher H2.0FlowState Stainless Steel Vacuum Insula | right | likely | text |  | likely | Same pink Quencher H2.0 tumbler with '40 oz Quencher' printed on the bundled carry-all box |
| stanley-quencher-eur | 10 | identify | New Arrivals: The Latest Stanley 1913 Cups / Stanley 1913 –  | **wrong** | likely | part | collection_page | similar | Same Quencher H2.0 tumbler silhouette with straw, handle and pink colourway on a plain bac |
| stanley-quencher-eur | 10 | identify | Stanley Cups - JD Sports Malaysia | **wrong** | likely | logo | collection_page | similar | Stanley Quencher in the same light pink with the Stanley logo on the body and matching han |
| flowgun-go-eur | 3 | identify | Flowgun Go 2.0 Flowlife - Pistolet de massage musculaire | right | likely | logo |  | likely | Blue body with a visible Flowlife wordmark and the same five attachments; the listing adds |
| flowgun-go-eur | 3 | identify | Flowlife Flowgun GO 2.0 Blue + Flowtank + Flowband 2-pack .. | right | exact | text |  | exact | Blue Flowgun GO 2.0 with the same five attachments; the title names GO 2.0 Blue, and the e |
| flowgun-go-eur | 3 | identify | Flowlife Flowgun Go 2.0 massagepistol, blå - Punkt1.dk | right | exact | logo |  | exact | Navy-blue Flowgun GO 2.0 with the visible Flowgun wordmark on the body and the same five a |
| flowgun-go-eur | 3 | identify | Flowlife Flowgun GO 2.0 Green + Flowtank + Flowband 2-pack . | right | likely | part |  | likely | Same gun shape and five attachments, but the title says Green and the body colour is a dif |
| kitchenaid-mixer | 2 | identify | Amazon.com: KitchenAid Artisan, 5-Qt Tilt Head Stand Mixer . | right | likely | logo |  | likely | Same Artisan tilt-head silhouette, silver head trim and stainless bowl with handle; the co |
| kitchenaid-mixer | 2 | identify | KitchenAid 5-Quart Artisan Tilt-Head Stand Mixer / White / e | right | likely | logo |  | likely | Artisan tilt-head shape, visible KitchenAid badge and stainless bowl match; it is a lifest |
| kitchenaid-mixer | 2 | identify | KitchenAid, Stand Mixer, White, 5 Quart, Tilt-Head, Artisan  | right | likely | logo |  | likely | Artisan badge, tilt-head silhouette, speed lever and stainless bowl with handle match; the |
| kitchenaid-mixer | 2 | identify | KitchenAid Artisan Series Matte White 5-Quart Tilt-Head ... | right | exact | logo |  | exact | Artisan tilt-head design with a visible KitchenAid mark and matte white finish, which the  |
| crocs-clog | 3 | identify | Crocs Men's 4 / Women's 6 - Baya Clogs Ultra Light Waterproo | right | likely | logo |  | likely | Brown Baya clog with the Crocs wordmark on the side band, matching the brown pair in IMAGE |
| crocs-clog | 3 | identify | Crocs Adult Unisex Baya Clog - Size M8/w10 | right | likely | part |  | likely | Baya clog silhouette and cutout pattern match, brown colourway matches IMAGE A; no visible |
| crocs-clog | 3 | identify | Crocs Unisex-adults Baya Clogs - Black - Sizes - Womens 8 Me | right | likely | part |  | likely | Baya clog shape and cutouts match, black colourway matches; IMAGE A's black pair has red s |
| owala-freesip | 2 | identify | Owala 24 fl oz Stainless Steel FreeSip Water Bottle - Out of | right | likely | logo |  | likely | Owala wordmark, same FreeSip silhouette and light blue colourway; the title is truncated s |
| owala-freesip | 2 | identify | Amazon.com: Owala FreeSip Stainless Steel Water Bottle 24 oz | right | likely | logo |  | likely | Owala wordmark, same 24 oz FreeSip shape and periwinkle blue colourway; title does not nam |
| rayban-wayfarer | 2 | identify | Ray Ban™ New Wayfarer NON-POLARIZED RB 2132 Sunglasses Italy | right | likely | logo |  | likely | Same New Wayfarer shape, glossy black frame and green lenses with Ray-Ban lens logo; title |
| rayban-wayfarer | 2 | identify | Amazon.com: Ray-Ban Unisex Sunglasses Black Frame, Green ... | right | likely | logo |  | likely | Glossy black New Wayfarer with green lenses and lens logo; title says black frame, green l |
| rayban-wayfarer | 2 | identify | NEW WAYFARER CLASSIC Sunglasses in Black and G-15 Green (55  | right | likely | logo |  | likely | Glossy black New Wayfarer with green G-15 lenses; the lens and temple branding is consiste |
| rayban-wayfarer | 2 | identify | Ray-Ban New Wayfarer Classic Green Unisex Sunglasses RB2132  | right | likely | logo |  | likely | Glossy black New Wayfarer with green lenses and a visible Ray-Ban lens mark; title RB2132  |
| rayban-wayfarer | 2 | identify | The Icon Will Remain - nJoy Vision | **wrong** | exact | photo | brand_veto | similar | Same product photograph as IMAGE A, glossy black New Wayfarer with green lenses and Ray-Ba |
| led-fidget-spinner | 2 | identify | LED Black Fidget Toy Spinner / GlowUniverse.com | right | likely | part | no_brand_likely | similar | Black tri-spinner with three white glowing caps and a black centre bearing, matching IMAGE |

Wrong products the gate called exact or likely: 12, held by the guards 11, **still shown 1**. Right products kept 33, held 7.

## Link scans

Link scan spend, all-in: $0.0264 of its $0.10 cap.

| link | kind | the page shows | mode | confidence | matched listing | source price | verdict | escalation | $ Claude | $ all-in | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| flowlife-flowgun-air-http | small-brand electronics; plain http, so the page fetch follows a redirect through the new address check | Flowgun Air (brand none stated, 79 GBP) | UNRESOLVED | unverified | Lola Lola Massage Gun 2.0 @Cult Beauty |  | UNVERIFIED | not needed | 0.0194 | 0.0264 | 12913 |

