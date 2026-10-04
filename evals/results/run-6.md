# Production eval, run 6

https://www.bustedlab.com, 2026-10-04T18:41:00.761Z to 2026-10-04T18:42:46.053Z. Match guards and the SerpApi Lens escalation (PR #16, merge 7971053): the stored candidates behind every wrong match the offline guards could not settle, then behind the right matches, replayed on the shipped gate (Sonnet 5.5 low) with each case's stored first read, under a $0.25 Claude cap (the owner's replay cap is $0.30; the rest is kept for the live scans under the $0.60 total). No search is repeated.

Spend this run: $0.1805 (Claude $0.1805, search $0.0000). All runs: $6.5909 of the $25 cap.

## Preflight

HTTP 200 in 657 ms.
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
| kitchen-spatula | [Kitchen-spatula.jpg](https://commons.wikimedia.org/wiki/File:Kitchen-spatula.jpg) | Public domain | 2000x1226 |  |
| silicone-pastry-brush | [Kitchen-Silicone-Brush.jpg](https://commons.wikimedia.org/wiki/File:Kitchen-Silicone-Brush.jpg) | Public domain | 2000x903 |  |
| car-phone-holder | [Car universal holder for smartphones and phablets, Oude Peke](https://commons.wikimedia.org/wiki/File:Car_universal_holder_for_smartphones_and_phablets,_Oude_Pekela_(2018)_01.jpg) | CC BY-SA 4.0 | 1125x2000 |  |
| raku-pitcher | [Colorful Handmade Raku Pottery Pitcher.jpg](https://commons.wikimedia.org/wiki/File:Colorful_Handmade_Raku_Pottery_Pitcher.jpg) | CC BY-SA 4.0 | 1610x1760 | mirrored, cropped |
| knitted-hat | [Knitting.jpg](https://commons.wikimedia.org/wiki/File:Knitting.jpg) | CC BY-SA 3.0 | 704x528 | mirrored, cropped |
| stanley-quencher-eur | [Quencher® H2.0 FlowState™ Tumbler / 1.18L](https://eu.stanley1913.com/fr/products/quencher-h2-0-flowstate-tumbler-1-18-l) | listing | 1080x2340 | screenshot at 55,00 € |
| flowgun-go-eur | [Flowlife Flowgun GO 2.0 Blue Massagepistol](https://www.ongoal.eu/products/flowlife-flowgun-go-2-0-blue) | listing | 1080x2340 | screenshot at 238,95 € |

## Replay of stored candidates on the shipped gate and guards

89 candidate(s) judged by claude-sonnet-5-5@low; Claude $0.1805 of the $0.25 cap.

| case | from run | purpose | listing | label | gate | tie | guard | now | why |
|---|---|---|---|---|---|---|---|---|---|
| flowlife-flowgun-air | 5 | identify | MVPmini 5 in 1 Percussion Massager with Carrying Case and 4  | **wrong** | likely | part | no_brand_likely | similar | MVPmini gun with the same compact T-shape, side power panel and LED dots; the kit has extr |
| flowlife-flowgun-air | 5 | identify | Playmakar MVP Mini Percussion Massage System Massage Gun MVP | **wrong** | likely | part | no_brand_likely | similar | Playmakar MVP Mini with the same body shape and side control panel; a vent detail and the  |
| flowlife-flowgun-air | 3 | identify | Flowgun Air Reuse – Percussive Massage Gun / Flowlife | right | exact | part |  | exact | Flowgun Air, with the same side LED strip and power button, the same body shape and the sa |
| flowlife-flowgun-air | 3 | identify | Flowlife Flowgun Air Ultralight Massage Gun 340g, 20W ... | right | likely | part | no_brand_likely | similar | Flowgun Air by title and similar body, but the view shows a vented end cap and the side pa |
| flowlife-flowgun-air | 3 | identify | Flowlife Flowgun Air - buy at Galaxus | right | exact | part |  | exact | Same compact T-shaped black gun: round ball head, side panel with dot indicators and power |
| knitted-hat | 2 | identify | J.Crew Men's Hats for sale / eBay | **wrong** | likely | part | no_brand_likely | similar | Navy hat with a cream stripe bordered by gray, a top loop and a ribbed brim, matching A's  |
| car-phone-holder | 2 | identify | Amazon.co.jp: Car Tablet Holder, Seat Rail Mount Car Holder  | **wrong** | likely | part | no_brand_likely | similar | Same gooseneck arm, suction cup and tablet clamp with round center disc and side pads; the |
| car-phone-holder | 2 | identify | Suporte de celular para cama: como escolher um modelo ... | **wrong** | exact | photo |  | exact | Identical photo of the holder under a frosted windshield, but it's a health-site article,  |
| silicone-pastry-brush | 2 | identify | Amazon.com: Silicone Basting Brush 9" Kitchen Cooking ... | right | likely | part | no_brand_likely | similar | Same clear handle with teardrop hole and red silicone head; the listing is a multi-colour  |
| silicone-pastry-brush | 2 | identify | 2018R SILICONE BASTING / PASTRY BRUSH-RED - Norpro, Inc. | right | likely | part | no_brand_likely | similar | Same clear handle with oval hole and red silicone bristles; small image, so details are ha |
| silicone-pastry-brush | 2 | identify | KD ZONE Non Stick 12 Cavity Appam Maker with Lid and Side .. | **wrong** | likely | part | no_brand_likely | similar | Same clear handle shape and red head, but the title is for an unrelated appam maker, so it |
| silicone-pastry-brush | 2 | identify | Single Silicone Brush - Syed Bakers Mart | right | likely | part | no_brand_likely | similar | Same clear handle and red silicone head; bakery shop listing |
| silicone-pastry-brush | 2 | identify | Silicone Brush - Medium - Assorted Color : Buy Online at ... | right | likely | part | no_brand_likely | similar | Same clear handle with teardrop hole and red bristles; listing says assorted colors |
| kitchen-spatula | 2 | identify | Photos from Avenue Supermarts Limited, Mumbai - Retailer of  | **wrong** | likely | part | no_brand_likely | similar | same steel handle with oval hole and same irregular slot layout on black head; retailer li |
| airpods-pro-2 | 5 | rebrand+retailer | AirPods Pro Apple | right | likely | part |  | likely | Pro-style earbuds with a case; the stem vent patch matches the first-gen Pro, but the case |
| airpods-pro-2 | 5 | rebrand+retailer | Apple AirPods Pro White with Magsafe Charging Case In Ear He | right | likely | part |  | likely | AirPods Pro earbuds with silicone tips and stem match; case/MagSafe variant not visible in |
| switch-oled | 2 | identify | Nintendo Switch With Docking Station, Charger, HDMI 55GB / e | **wrong** | likely | part |  | likely | thin-bezel OLED screen, neon Joy-Cons; title unclear |
| switch-oled | 2 | identify | Nintendo Switch OLED Console with Assorted Color Joy-Cons .. | right | likely | part |  | likely | OLED thin bezel, neon blue/red |
| switch-oled | 2 | identify | Nintendo Switch OLED Model / HonestyHive | right | likely | part |  | likely | OLED model, neon colors, thin bezel |
| switch-oled | 3 | identify | Nintendo Switch OLED Model Console Edition with Red & Blue . | right | likely | part |  | likely | OLED thin bezel, neon blue/red |
| stanley-quencher-eur | 5 | identify | Stanley 1913 Quencher H2.0 Water Bottle with Straw 1.18L - R | right | likely | logo |  | likely | 1.18L Rose Quartz Quencher H2.0, but the image shows two sizes and the lid and size can't  |
| stanley-quencher-eur | 5 | identify | Stanley Quencher H2.0 FlowState Drinking Bottle with Straw,  | right | likely | logo |  | likely | Rose Quartz 40oz Quencher, about 1.2L; the title is generic and the image is a lifestyle s |
| stanley-quencher-eur | 5 | identify | STANLEY QUENCHER 40OZ - Tooth of Time Traders | right | likely | logo |  | likely | 40oz Stanley Quencher in pink with a similar shape, but the colourway looks slightly diffe |
| flowgun-go-eur | 3 | identify | Flowlife Flowgun Go 2.0 massagepistol, blå - Punkt1.dk | right | likely | part |  | likely | Blue Flowgun GO 2.0 with the same five heads, but the head arrangement differs and the han |

Wrong products the gate called exact or likely: 8, held by the guards 6, **still shown 2**. Right products kept 11, held 5.

