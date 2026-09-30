/**
 * CONTENT-SECURITY-POLICY CHECK.
 *
 * The enforced policy is only as good as three things staying true: scripts
 * need the per-request nonce (nothing inline or eval'd runs without it), the
 * proxy actually stamps every page and none of the assets, and a violation
 * in the wild is counted where the operator reads the numbers. Runs the real
 * policy builder, proxy and report route:
 *
 *   node --experimental-strip-types --no-warnings scripts/check-csp.mjs
 *
 * The browser half - every page and flow loaded under the enforced policy
 * with zero violations - needs a running production build and a browser,
 * so it is not part of npm run check; DEPLOY.md says how to confirm it on a
 * deployment.
 */
import { importSrc, env, reset, call, check, section, finish } from "./lib/harness.mjs";

const { buildContentSecurityPolicy, checkoutFrameOrigins } = await importSrc("lib/csp.ts");
const { proxy, config } = await importSrc("proxy.ts");
const report = await importSrc("app/api/csp-report/route.ts");
const stats = await importSrc("app/api/stats/route.ts");
const { NextRequest } = await import("next/server");

const directives = (policy) => Object.fromEntries(policy.split(";").map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

// ════════════════════════════════════════════════════════════════
section("THE POLICY");

env({ CHECKOUT_URL: "https://pay.bustedlab.com/checkout/buy/x" });
let p = directives(buildContentSecurityPolicy({ nonce: "abc123", frameAncestors: "'none'", upgradeInsecureRequests: true }));
check("scripts need the nonce, and trust flows from it", p["script-src"].includes("'nonce-abc123'") && p["script-src"].includes("'strict-dynamic'"));
check("no inline or eval'd script is allowed", !p["script-src"].includes("'unsafe-inline'") && !p["script-src"].includes("'unsafe-eval'"));
check("no plugins, no <base> rewriting, forms post only here",
      p["object-src"][0] === "'none'" && p["base-uri"][0] === "'none'" && p["form-action"][0] === "'self'");
check("nothing loads images, fonts or connections from other hosts (CSS cannot exfiltrate)",
      p["img-src"].every(s => ["'self'", "data:", "blob:"].includes(s)) && p["font-src"].join() === "'self'" &&
      p["connect-src"].every(s => s === "'self'" || s.endsWith("lemonsqueezy.com")));
check("the checkout can be framed, including a custom checkout domain",
      p["frame-src"].includes("https://*.lemonsqueezy.com") && p["frame-src"].includes("https://pay.bustedlab.com"));
check("the site itself cannot be framed", p["frame-ancestors"].join() === "'none'");
check("violations are reported", p["report-uri"]?.[0] === "/api/csp-report");
check("upgrade-insecure-requests on https", "upgrade-insecure-requests" in p);
p = directives(buildContentSecurityPolicy({ nonce: "n", frameAncestors: "'self'", upgradeInsecureRequests: false, development: true }));
check("/success may be framed by this origin only", p["frame-ancestors"].join() === "'self'");
check("next dev gets eval, production never", p["script-src"].includes("'unsafe-eval'"));
check("no upgrade on plain http, where it would break every request", !("upgrade-insecure-requests" in p));
env({ CHECKOUT_URL: undefined });
check("with no checkout link, only Lemon Squeezy is frameable", checkoutFrameOrigins().join() === "https://*.lemonsqueezy.com");

// ════════════════════════════════════════════════════════════════
section("THE PROXY");

const through = (path, headers = {}) => proxy(new NextRequest(`https://bustedlab.test${path}`, { headers }));
env();
let r1 = through("/");
let r2 = through("/");
const csp1 = r1.headers.get("content-security-policy") || "";
const nonce1 = csp1.match(/'nonce-([^']+)'/)?.[1];
check("every page gets an enforced policy", !!csp1 && !r1.headers.has("content-security-policy-report-only"));
check("a fresh, unguessable nonce per request", !!nonce1 && nonce1.length >= 24 && !(r2.headers.get("content-security-policy") || "").includes(nonce1));
check("Next is handed the same nonce to put on its scripts",
      r1.headers.get("x-middleware-request-content-security-policy") === csp1 && r1.headers.get("x-middleware-request-x-nonce") === nonce1);
check("/success allows this origin to frame it", (through("/success").headers.get("content-security-policy") || "").includes("frame-ancestors 'self'"));
check("every other page refuses all framing", (through("/scan/abc").headers.get("content-security-policy") || "").includes("frame-ancestors 'none'"));
env({ CSP_REPORT_ONLY: "true" });
const ro = through("/");
check("CSP_REPORT_ONLY=true is the break-glass switch", ro.headers.has("content-security-policy-report-only") && !ro.headers.has("content-security-policy"));
env();

const matcher = new RegExp(`^${config.matcher[0].source}$`);
const pages = ["/", "/the-index", "/scan/muigsar10f20dcf6f3203b77a3cfa17b", "/success", "/terms", "/privacy", "/dmca", "/login", "/auth/verify", "/unsubscribe", "/no-such-page"];
const notPages = ["/api/scan", "/api/csp-report", "/_next/static/chunks/main.js", "/favicon-32.png", "/apple-touch-icon.png",
  "/robots.txt", "/sitemap.xml", "/opengraph-image", "/scan/abc/opengraph-image", "/demo/purple-whitening-strips.jpg"];
check("the proxy runs on every page", pages.every(x => matcher.test(x)), pages.filter(x => !matcher.test(x)).join(" "));
check("and on no API route, asset or share image", notPages.every(x => !matcher.test(x)), notPages.filter(x => matcher.test(x)).join(" "));
check("prefetches are skipped", config.matcher[0].missing.some(m => m.key === "next-router-prefetch"));

// ════════════════════════════════════════════════════════════════
section("VIOLATIONS ARE COUNTED WHERE THE NUMBERS ARE READ");

const post = (body, ip = "203.0.113.5") =>
  call(report.POST, "/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report", "x-forwarded-for": ip }, body: JSON.stringify(body) });
const legacy = (over = {}) => ({ "csp-report": {
  "document-uri": "https://bustedlab.test/scan/abc", "blocked-uri": "inline", "effective-directive": "script-src-elem", disposition: "enforce", ...over } });
const readStats = async () => (await call(stats.GET, "/api/stats?days=1", { headers: { authorization: "Bearer stats-token" } })).json;

env({ ANALYTICS_TOKEN: "stats-token" }); reset();
let r = await post(legacy());
check("a report is answered 204", r.status === 204);
await post(legacy({ "blocked-uri": "https://evil.example/x.js?token=secret", "document-uri": "https://bustedlab.test/the-index?category=tech" }));
r = await call(report.POST, "/api/csp-report", {
  method: "POST", headers: { "content-type": "application/reports+json" },
  body: JSON.stringify([{ type: "csp-violation", url: "https://bustedlab.test/", body: {
    documentURL: "https://bustedlab.test/", blockedURL: "eval", effectiveDirective: "script-src", disposition: "enforce" } }]),
});
let counts = (await readStats()).csp?.[0]?.counts || {};
check("it appears in /api/stats, by kind", counts["enforce script-src-elem inline /scan/[id]"] === 1, JSON.stringify(counts));
check("reduced to the blocked origin: no path, no query, nothing verbatim",
      counts["enforce script-src-elem https://evil.example /the-index"] === 1);
check("the Reporting API's format is understood too", counts["enforce script-src eval /"] === 1);

reset();
await post(legacy({ "source-file": "chrome-extension://abcdef/content.js" }));
await post(legacy({ "blocked-uri": "moz-extension://x/y.js" }));
await post(legacy({ "document-uri": "https://someone-else.example/page" }));
await post(legacy({ "effective-directive": "<script>alert(1)</script>" }));
await call(report.POST, "/api/csp-report", { method: "POST", body: "not json" });
counts = (await readStats()).csp?.[0]?.counts || {};
check("browser extensions, other sites, junk and malformed bodies are not counted", Object.keys(counts).length === 0, JSON.stringify(counts));

reset();
for (let i = 0; i < 35; i++) await post(legacy(), "198.51.100.3");
counts = (await readStats()).csp?.[0]?.counts || {};
check("one visitor can report at most 30 times a minute", counts["enforce script-src-elem inline /scan/[id]"] === 30,
      String(counts["enforce script-src-elem inline /scan/[id]"]));

reset();
for (let i = 0; i < 320; i++) await post(legacy({ "blocked-uri": `https://h${i}.example/x.js` }), `192.0.2.${i % 250}`);
await post(legacy({ "blocked-uri": "https://h0.example/x.js" }), "192.0.2.251");
counts = (await readStats()).csp?.[0]?.counts || {};
check("distinct kinds are capped at 300 a day, and known kinds keep counting",
      Object.keys(counts).length === 300 && counts["enforce script-src-elem https://h0.example /scan/[id]"] === 2, String(Object.keys(counts).length));

env({ ANALYTICS_TOKEN: undefined });
r = await call(stats.GET, "/api/stats?days=1");
check("the counts sit behind the stats token", r.status === 401);

finish("content-security-policy");
