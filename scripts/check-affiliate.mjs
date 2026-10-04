/**
 * AFFILIATE PLUMBING, CONTRACT. Off by default; when on, only the final
 * "Go to this price" link of a closest-match result is wrapped, in each
 * network's documented format, with the direct URL as the fallback;
 * commission cannot reach the engine that chooses the listing; the existing
 * affiliate disclosure is on every result page; a misconfigured key is said
 * out loud by preflight and never echoed.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-affiliate.mjs
 */
import { readFileSync } from "node:fs";
import { importSrc, env, reset, call, check, section, finish } from "./lib/harness.mjs";

const aff = await importSrc("lib/affiliate.ts");
const SOVRN_KEY = "0123456789abcdef0123456789abcdef";
const SKIM_ID = "123456X1234567";
const SOVRN = { AFFILIATE_PROVIDER: "sovrn", AFFILIATE_KEY: SOVRN_KEY };
const SKIM = { AFFILIATE_PROVIDER: "skimlinks", AFFILIATE_KEY: SKIM_ID };
const MERCHANT = "https://www.example-shop.com/products/flowgun-air?variant=12&ref=x y";

section("OFF BY DEFAULT, AND ON ONLY WITH A KEY OF THE RIGHT SHAPE");
check("no settings: off", aff.affiliateConfig({}) === null);
check("a provider and no key: off", aff.affiliateConfig({ AFFILIATE_PROVIDER: "sovrn" }) === null);
check("a malformed Skimlinks id: off", aff.affiliateConfig({ AFFILIATE_PROVIDER: "skimlinks", AFFILIATE_KEY: "123456" }) === null);
check("an unknown network: off", aff.affiliateConfig({ AFFILIATE_PROVIDER: "amazon", AFFILIATE_KEY: SOVRN_KEY }) === null);
check("Sovrn with its API key: on", aff.affiliateConfig(SOVRN)?.provider === "sovrn");
check("Skimlinks with its publisher-and-domain id: on", aff.affiliateConfig(SKIM)?.provider === "skimlinks");

section("THE DOCUMENTED FORMATS");
{
  const s = aff.wrapOutboundLink(MERCHANT, aff.affiliateConfig(SOVRN));
  check("Sovrn: redirect.viglink.com?key=<key>&u=<encoded destination>",
    s === `https://redirect.viglink.com?key=${SOVRN_KEY}&u=${encodeURIComponent(MERCHANT)}`, s);
  const k = aff.wrapOutboundLink(MERCHANT, aff.affiliateConfig(SKIM));
  check("Skimlinks: go.skimresources.com/?id=<id>&url=<encoded destination>&sref=<page>",
    k === `https://go.skimresources.com/?id=${SKIM_ID}&url=${encodeURIComponent(MERCHANT)}&sref=${encodeURIComponent("https://www.bustedlab.com/")}`, k);
  check("only the destination is encoded, so it round-trips exactly", new URL(s).searchParams.get("u") === MERCHANT && new URL(k).searchParams.get("url") === MERCHANT);
}

section("WHAT IS NEVER WRAPPED");
for (const [label, url] of [
  ["a Google search link (no merchant to credit)", "https://www.google.com/search?q=flowgun"],
  ["our own pages", "https://www.bustedlab.com/scan/abc"],
  ["an already wrapped link", `https://redirect.viglink.com?key=${SOVRN_KEY}&u=x`],
  ["a non-web link", "javascript:alert(1)"],
  ["an empty link", ""],
]) check(`${label}: left as it is`, aff.wrapOutboundLink(url, aff.affiliateConfig(SOVRN)) === url);

section("ONE LINK, ONE RESULT TYPE");
{
  const finder = { mode: "FINDER", sourceProduct: { productUrl: MERCHANT, affiliateUrl: MERCHANT, linkIsDirect: true } };
  const wrapped = aff.withAffiliateLink(finder, SOVRN);
  check("a closest-match result's 'Go to this price' link is wrapped", wrapped.sourceProduct.affiliateUrl.startsWith("https://redirect.viglink.com?"));
  check("and nothing else on it changes: the product link stays direct", wrapped.sourceProduct.productUrl === MERCHANT && wrapped.mode === "FINDER");
  check("the result the engine returned is not modified in place (the cache and ledger keep the direct link)", finder.sourceProduct.affiliateUrl === MERCHANT);
  const verdict = { mode: "VERDICT", sourceProduct: { productUrl: MERCHANT, affiliateUrl: MERCHANT, linkIsDirect: true } };
  check("a verdict's link is not wrapped", aff.withAffiliateLink(verdict, SOVRN) === verdict);
  const search = { mode: "FINDER", sourceProduct: { productUrl: MERCHANT, affiliateUrl: MERCHANT, linkIsDirect: false } };
  check("a link that is not a direct merchant page is not wrapped", aff.withAffiliateLink(search, SOVRN) === search);
  check("with wrapping off, the direct URL goes out", aff.withAffiliateLink(finder, {}) === finder);
}

section("COMMISSION CANNOT CHOOSE THE LISTING");
{
  const engine = readFileSync(new URL("../src/lib/scan.ts", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../src/lib/affiliate.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/scan/route.ts", import.meta.url), "utf8");
  check("the engine never imports the affiliate module or reads its settings", !/affiliate"|AFFILIATE_/.test(engine));
  check("the affiliate module imports nothing", !/^import /m.test(lib));
  check("the route wraps only in the response, after the ledger write and with the direct result counted and cached",
    route.indexOf("withAffiliateLink(result)") > route.indexOf("recordScan({") &&
    route.indexOf("withAffiliateLink(result)") > route.indexOf("countCompletedScan({") &&
    (route.match(/withAffiliateLink\(/g) || []).length === 1);
}

section("THE DISCLOSURE IS ON EVERY RESULT");
{
  const page = readFileSync(new URL("../src/components/ResultsPage.tsx", import.meta.url), "utf8");
  const at = page.indexOf("Affiliate Disclosure:");
  // The box the disclosure sits in, and what comes right before it: a
  // conditional would end in "(" (an "&& (" or "? (" opening it).
  const box = page.lastIndexOf("<div", page.lastIndexOf("Market Analysis Disclaimer:", at));
  const lead = page.slice(0, box).trimEnd();
  check("the results page carries the affiliate disclosure", at > 0 && box > 0);
  check("and not behind any condition: its box opens straight after the closed result branches", !/\($/.test(lead) && /(\)\}|<\/div>)$/.test(lead), lead.slice(-120));
}

section("PREFLIGHT");
{
  const route = await importSrc("app/api/preflight/route.ts");
  const run = async () => (await call(route.GET, "/api/preflight", { headers: { authorization: "Bearer op-token-affiliate-0123" } })).json;
  env({ ANALYTICS_TOKEN: "op-token-affiliate-0123", AFFILIATE_PROVIDER: "skimlinks", AFFILIATE_KEY: "not-an-id-secret-value" }); reset();
  const bad = await run();
  check("a malformed key is a warning that says the links go out direct", (bad?.warnings || []).some(w => w.check === "affiliate" && /go out direct/.test(w.detail)), JSON.stringify(bad?.warnings));
  check("and the key is never echoed", !JSON.stringify(bad).includes("not-an-id-secret-value"));
  env({ ANALYTICS_TOKEN: "op-token-affiliate-0123", ...SKIM }); reset();
  const good = await run();
  check("a well-formed id is listed as on", (good?.ok || []).includes("affiliate links (skimlinks)") && !JSON.stringify(good).includes(SKIM_ID));
  env({ ANALYTICS_TOKEN: "op-token-affiliate-0123", AFFILIATE_PROVIDER: undefined, AFFILIATE_KEY: undefined }); reset();
  const off = await run();
  check("unset: nothing said, nothing wrapped", !(off?.warnings || []).some(w => w.check === "affiliate") && !(off?.ok || []).some(o => /affiliate/.test(o)));
}

finish("affiliate");
