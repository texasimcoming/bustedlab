/**
 * FUNNEL CHECK. The first thousand visitors are only worth anything if every
 * step between landing and paying is counted, and counted right under the
 * traffic a campaign actually brings: thousands of phones behind one carrier
 * address. This runs the real beacon route and the real funnel read-out
 * against the emulated Upstash in scripts/lib/harness.mjs:
 *
 *   node --experimental-strip-types --no-warnings scripts/check-funnel.mjs
 */
import { importSrc, env, reset, call, redis, check, section, finish } from "./lib/harness.mjs";

const beacon = await importSrc("app/api/event/route.ts");
const analytics = await importSrc("lib/analytics.ts");

const send = (event, { ip = "203.0.113.5", browser } = {}) =>
  call(beacon.POST, "/api/event", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ event }),
    cookies: browser ? { bl_bid: browser } : {},
  });
const total = (event) => Number(redis.peek(`stat:${event}:total`) ?? 0);
const browser = (n) => n.toString(16).padStart(32, "0");

// ════════════════════════════════════════════════════════════════
section("EVERY STEP A VISITOR TAKES IS COUNTED");

env(); reset();
const STEPS = ["landing_viewed", "photo_selected", "url_entered", "scan_started", "result_shown",
  "scan_failed", "share_tapped", "paywall_shown", "checkout_clicked"];
for (const step of STEPS) await send(step, { browser: browser(1) });
const missing = STEPS.filter(step => total(step) !== 1);
check("each browser-side step is accepted and counted once", missing.length === 0, missing.join(", "));
check("and answered 204, whatever happens", (await send("landing_viewed")).status === 204);

for (const serverOnly of ["scan_completed", "verdict_busted", "result_unresolved", "email_captured"]) await send(serverOnly);
check("steps only the server can witness cannot be reported from a browser",
      ["scan_completed", "verdict_busted", "result_unresolved", "email_captured"].every(e => total(e) === 0));
await send("anything_else");
check("an unknown name writes nothing", !redis.keys().some(k => k.includes("anything_else")));

// ════════════════════════════════════════════════════════════════
section("A CAMPAIGN BEHIND ONE CARRIER ADDRESS IS COUNTED IN FULL");

env(); reset();
const CARRIER = "100.64.0.1";
for (let phone = 0; phone < 80; phone++) {
  for (const step of ["landing_viewed", "photo_selected", "scan_started", "result_shown", "share_tapped", "paywall_shown", "checkout_clicked"]) {
    await send(step, { ip: CARRIER, browser: browser(1000 + phone) });
  }
}
check("80 phones on one address, 7 steps each, inside one minute: every landing counted",
      total("landing_viewed") === 80, String(total("landing_viewed")));
check("and every checkout click", total("checkout_clicked") === 80, String(total("checkout_clicked")));
check("the address and the browser ids are stored only as hashes",
      !redis.keys().some(k => k.includes("100.64.0.1") || k.includes(browser(1000))));

// ════════════════════════════════════════════════════════════════
section("A SCRIPT CANNOT INFLATE IT FREELY");

env(); reset();
for (let i = 0; i < 100; i++) await send("checkout_clicked", { browser: browser(7) });
check("one browser is held to 60 a minute", total("checkout_clicked") === 60, String(total("checkout_clicked")));

env(); reset();
for (let i = 0; i < 1300; i++) await send("share_tapped", { ip: "198.51.100.9" });
check("a cookieless flood from one address is held to the address ceiling", total("share_tapped") === 1200,
      String(total("share_tapped")));
await send("share_tapped", { ip: "198.51.100.10" });
check("while the next address is unaffected", total("share_tapped") === 1201);

env(); reset();
redis.down = true;
const r = await send("landing_viewed", { browser: browser(3) });
redis.down = false;
check("an Upstash outage does not turn into an error in the visitor's browser", r.status === 204);

// ════════════════════════════════════════════════════════════════
section("THE READ-OUT");

const series = (counts) => analytics.EVENTS.map(event => ({
  event, total: counts[event] ?? 0, windowTotal: counts[event] ?? 0, days: [],
}));
const f = analytics.buildFunnel(series({
  landing_viewed: 1000, photo_selected: 300, url_entered: 100, scan_started: 350,
  scan_completed: 330, verdict_busted: 120, verdict_overpriced: 60, verdict_fair: 20,
  result_finder: 80, result_unresolved: 50, result_shown: 325, scan_failed: 20,
  share_tapped: 66, paywall_shown: 90, checkout_clicked: 9,
}));
check("scan-start rate is scans started per landing", f.scanStartRate === 35, String(f.scanStartRate));
check("input rate counts photos and links per landing", f.inputRate === 40, String(f.inputRate));
check("results split into verdict, closest match and nothing found",
      f.results.verdict === 200 && f.results.finder === 80 && f.results.unresolved === 50, JSON.stringify(f.results));
check("nothing-found rate is per completed scan", f.unresolvedRate === 15.2, String(f.unresolvedRate));
check("failure rate is per scan started", f.scanFailureRate === 5.7, String(f.scanFailureRate));
check("shares per scan and checkout rate still computed",
      f.sharesPerScan === 0.2 && f.checkoutClickRate === 10, `${f.sharesPerScan} ${f.checkoutClickRate}`);
const empty = analytics.buildFunnel(series({}));
check("an empty day reads as no data, not as 0% or a division error",
      empty.scanStartRate === null && empty.unresolvedRate === null && empty.scanFailureRate === null);

finish("funnel");
