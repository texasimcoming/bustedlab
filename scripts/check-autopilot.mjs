/**
 * THE AUTOPILOT, CHECKED. The watchdog's rules (what fails a run), the
 * weekly brief's numbers and fixes, the guard on the one model-written
 * summary, the content pack's copy, and both scripts end to end against a
 * local stand-in for production: the right endpoints, a non-zero exit on a
 * problem, and no token in anything written.
 *
 *   node --experimental-strip-types --no-warnings scripts/check-autopilot.mjs
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateHourly, evaluateDiagnose, redact, briefNumbers, leverageFixes, briefMarkdown,
  contentPack, allowedNumbers, summaryIsGrounded,
} from "./lib/autopilot.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `\n        ${String(detail).slice(0, 600)}` : ""}`);
  if (!ok) failures++;
};
const section = (t) => console.log(`\n── ${t} ──`);

const NOW = Date.parse("2026-10-05T12:00:00Z");
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const ready = { status: 200, json: { ready: true, blockers: [], warnings: [] } };
const statsOf = (over = {}) => ({
  status: 200,
  json: {
    failures: { byReason: [], recent: [] },
    series: [{ event: "scan_started", days: [{ day: "2026-10-05", count: 40 }] }, { event: "scan_failed", days: [{ day: "2026-10-05", count: 1 }] }],
    spend: { mode: "full" },
    ...over,
  },
});

section("WATCHDOG: WHAT FAILS A RUN");
{
  const ok = evaluateHourly({ preflight: ready, stats: statsOf(), now: NOW });
  check("a healthy site: no problem", ok.problems.length === 0, JSON.stringify(ok.problems));
  const notReady = evaluateHourly({ preflight: { status: 200, json: { ready: false, blockers: [{ check: "model key", detail: "ANTHROPIC_API_KEY is not set" }] } }, stats: statsOf(), now: NOW });
  check("not ready fails, naming the blocker", notReady.problems.some(p => p.layer === "preflight" && /model key/.test(p.error)), JSON.stringify(notReady.problems));
  const down = evaluateHourly({ preflight: { status: 0, text: "fetch failed" }, stats: { status: 401, json: { error: "unauthorized" } }, now: NOW });
  check("an unreachable site or a refused token fails", down.problems.length === 2, JSON.stringify(down.problems));
  const credit = evaluateHourly({ preflight: ready, now: NOW, stats: statsOf({ failures: { byReason: [], recent: [
    { at: ago(300), reason: "extraction", layers: ["extraction:anthropic:claude-sonnet-5-5:400:credit_exhausted"] },
  ] } }) });
  check("one credit-exhausted failure in the last day fails, and says to add credit",
    credit.problems.some(p => /add credit/i.test(p.error)), JSON.stringify(credit.problems));
  const spike = evaluateHourly({ preflight: ready, now: NOW, stats: statsOf({ failures: { byReason: [], recent: [
    ...Array.from({ length: 5 }, (_, i) => ({ at: ago(5 + i), reason: "lens", layers: ["lens:serper:0"] })),
  ] } }) });
  check("five failures in the last hour is a spike, naming the layer", spike.problems.some(p => p.layer === "lens" && /5 scans/.test(p.error)), JSON.stringify(spike.problems));
  const old = evaluateHourly({ preflight: ready, now: NOW, stats: statsOf({ failures: { byReason: [], recent: [
    ...Array.from({ length: 8 }, (_, i) => ({ at: ago(90 + i), reason: "lens", layers: ["lens:serper:0"] })),
  ] } }) });
  check("the same failures two hours ago are not a spike now", old.problems.length === 0, JSON.stringify(old.problems));
  const rate = evaluateHourly({ preflight: ready, now: NOW, stats: statsOf({ series: [
    { event: "scan_started", days: [{ day: "2026-10-05", count: 20 }] }, { event: "scan_failed", days: [{ day: "2026-10-05", count: 8 }] },
  ] }) });
  check("8 of 20 scans failing today is a spike", rate.problems.some(p => p.layer === "scan_failed"), JSON.stringify(rate.problems));
}
{
  const pass = evaluateDiagnose({ diagnose: { status: 200, json: { pass: true, layers: [{ layer: "redis", pass: true }], deployment: { commit: "abc1234" }, cost: {} } } });
  check("diagnose passing: no problem", pass.problems.length === 0);
  const fail = evaluateDiagnose({ diagnose: { status: 200, json: { pass: false, deployment: { commit: "abc1234" }, cost: {}, layers: [
    { layer: "claude claude-sonnet-5-5 (first read)", pass: false, status: 400, detail: "credit_exhausted: Your credit balance is too low to access the Anthropic API" },
    { layer: "lens serper", pass: false, status: 0, detail: "unparseable: unreadable Lens answer" },
  ] } } });
  check("each failed layer is named with its error body", fail.problems.length === 2 && fail.problems[1].layer === "lens serper" && /unreadable/.test(fail.problems[1].error));
  check("a credit error says what to do", /add credit/i.test(fail.problems[0].error), fail.problems[0].error);
  check("no answer at all fails", evaluateDiagnose({ diagnose: { status: 504, text: "timeout" } }).problems.length === 1);
}

section("SECRETS");
{
  const t = "op-token-0123456789abcdef";
  const out = redact(`Bearer ${t} and ${t} and sk-ant-api03-abcDEF and ?api_key=xyz123`, [t]);
  check("the token, keys and bearer values are scrubbed", !out.includes(t) && !out.includes("sk-ant-api03") && !out.includes("xyz123"), out);
}

section("WEEKLY BRIEF: NUMBERS FROM CODE");
const STATS = {
  ledgerSize: 12,
  window: {
    landings: 200, inputs: { photo: 50, url: 10 }, inputRate: 30, scanStarts: 30, scanStartRate: 15, scans: 26,
    results: { verdict: 6, finder: 8, unresolved: 12 }, unresolvedRate: 46.2, resultsShown: 24, scanFailures: 4, scanFailureRate: 13.3,
    verdicts: { busted: 2, overpriced: 3, fair: 1 }, shares: 0, sharesPerScan: 0, saves: 0, savesPerScan: 0, storySaves: 0,
    paywalls: 9, paywallRate: 34.6, emails: 1, checkoutClicks: 0, checkoutClickRate: 0,
  },
  failures: { byReason: [{ reason: "lens", windowTotal: 3, total: 9 }, { reason: "gate", windowTotal: 1, total: 2 }], recent: [] },
  wrongProduct: { windowTotal: 2, total: 2, byResult: { "FINDER likely": 2 } },
  spend: { mode: "full", dailyModelBudgetUsd: 2, globalDailyFreeScanCap: 50, days: [
    { day: "2026-09-29", modelUsd: 0.2, uncachedFreeScans: 6 }, { day: "2026-09-30", modelUsd: 0.31, uncachedFreeScans: 10 },
    { day: "2026-10-01", modelUsd: 0.11, uncachedFreeScans: 4 }, { day: "2026-10-02", modelUsd: 0, uncachedFreeScans: 0 },
  ] },
  providers: { serperCreditsLeft: 2362, serpApiSearchesLeft: 35 },
};
const numbers = briefNumbers(STATS);
const fixes = leverageFixes(numbers);
check("cost per completed scan and per uncached free scan come from the spend history",
  numbers.cost.modelUsd === 0.62 && numbers.cost.perCompletedScan === 0.024 && numbers.cost.perUncachedFreeScan === 0.031, JSON.stringify(numbers.cost));
check("outcome mix, failure reasons and wrong-product counts carried through",
  numbers.outcomes.unresolved === 12 && numbers.failures[0].reason === "lens" && numbers.wrongProduct.count === 2);
check("three fixes: the wrong-product reports first (the owner's first rule), then by reach: landings lost, cards never shared",
  fixes.length === 3 && /wrong product/.test(fixes[0]) && /landings started a scan/.test(fixes[1]) && /no card shared/.test(fixes[2]), fixes.join(" | "));
const md = briefMarkdown({ date: "2026-10-05", numbers, fixes, summary: "", base: "https://example.test" });
check("the brief carries funnel ratios, outcomes, failures, wrong-product counts and cost against the caps",
  /\| scans started \| 30 \| 15% of landings \|/.test(md) && /lens: 3/.test(md) && /2 this week/.test(md) && /daily budget \$2\.00/.test(md) && /2362 credits left/.test(md), md.slice(0, 400));
check("the brief uses no em dash", !md.includes("—"));

section("THE ONE MODEL-WRITTEN PARAGRAPH");
{
  const allowed = allowedNumbers(numbers, fixes);
  check("a summary using only computed numbers is kept", summaryIsGrounded("Of 200 landings, 30 started a scan and 12 found nothing; 2 people reported a wrong product.", allowed));
  check("a summary with an invented number is dropped", !summaryIsGrounded("Conversion rose 40% this week.", allowed));
}

section("CONTENT PACK");
{
  const pack = contentPack({ base: "https://example.test", date: "2026-10-05", weekTop: [
    { id: "a1", title: "LED Face Mask Pro 7 Colors", category: "beauty", retailPrice: 89, wholesalePrice: 14.5, markup: 514, savings: 74.5, matchConfidence: "exact", platform: "AliExpress" },
    { id: "a2", title: "LED Face Mask Pro 7 colors!", category: "beauty", retailPrice: 79, wholesalePrice: 15, markup: 427, savings: 64, matchConfidence: "exact" },
    { id: "a3", title: "Posture Corrector Brace", category: "fitness", retailPrice: 39.99, wholesalePrice: 6.2, markup: 545, savings: 33.79, matchConfidence: "likely", platform: "Temu" },
    { id: "a4", title: "Mystery lookalike", category: "home", retailPrice: 30, wholesalePrice: 3, markup: 900, savings: 27, matchConfidence: "unverified" },
  ] });
  check("near-identical titles appear once, and an unverified match never", pack.rows.map(r => r.id).join(",") === "a1,a3", pack.rows.map(r => r.id).join(","));
  check("each item has its caption, three hooks, hashtags, scan page and share image",
    (pack.markdown.match(/\*\*Caption:\*\*/g) || []).length === 2 && (pack.markdown.match(/^- /gm) || []).length === 6 &&
    pack.markdown.includes("https://example.test/scan/a1") && pack.markdown.includes("https://example.test/scan/a1/opengraph-image") && pack.markdown.includes("#bustedlab"));
  check("the caption is the card's own share caption", pack.markdown.includes("$74.50 above market on this one. 514% markup. Receipts: https://example.test/scan/a1"));
  check("'the same product' is claimed only for an exact match", /The same product is listed at \$14\.50/.test(pack.markdown) && /A near-identical listing is listed at \$6\.20/.test(pack.markdown), pack.markdown);
  check("no data, no invented content", /nothing to post/.test(contentPack({ weekTop: [], base: "x", date: "d" }).markdown));
}

section("BOTH SCRIPTS AGAINST A STAND-IN FOR PRODUCTION");
{
  const TOKEN = "watchdog-op-token-0123456789";
  const seen = [];
  let preflightReady = true;
  const anthropicBodies = [];
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    seen.push(`${req.method} ${req.url.split("?")[0]} ${req.headers.authorization === `Bearer ${TOKEN}` ? "auth" : "anon"}`);
    const send = (o, s = 200) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url === "/v1/messages") {
      anthropicBodies.push(JSON.parse(body));
      return send({ stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 180 }, content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Of 200 landings, 30 started a scan." }] });
    }
    if (req.url.startsWith("/api/preflight")) return send({ ready: preflightReady, blockers: preflightReady ? [] : [{ check: "redis", detail: `no answer (token ${TOKEN})` }], warnings: [] });
    if (req.url.startsWith("/api/stats")) return send({ ...STATS, series: [] });
    if (req.url.startsWith("/api/diagnose")) return send({ pass: true, failing: [], layers: [{ layer: "redis", pass: true, status: 200, detail: "ok" }], deployment: { commit: "abc1234" }, cost: { claudeUsd: 0.02, serperCredits: 5 } });
    if (req.url.startsWith("/api/leaderboard")) return send({ weekTop: [{ id: "a1", title: "LED Face Mask", category: "beauty", retailPrice: 89, wholesalePrice: 14.5, markup: 514, savings: 74.5, matchConfidence: "exact" }] });
    send({ error: "not found" }, 404);
  });
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = (script, env, cwd) => new Promise(resolveRun => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", join(REPO, script)], {
      cwd, env: { ...process.env, BASE_URL: base, ANALYTICS_TOKEN: TOKEN, GITHUB_STEP_SUMMARY: "", ...env },
    });
    let out = ""; child.stdout.on("data", d => (out += d)); child.stderr.on("data", d => (out += d));
    child.on("close", code => resolveRun({ code, out }));
  });

  const dir = mkdtempSync(join(tmpdir(), "autopilot-"));
  const healthy = await run("scripts/watchdog.mjs", { MODE: "diagnose" }, dir);
  check("watchdog, healthy: exits 0 after preflight, stats and diagnose, each with the token",
    healthy.code === 0 && ["GET /api/preflight auth", "GET /api/stats auth", "GET /api/diagnose auth"].every(s => seen.includes(s)), healthy.out.slice(0, 400));
  const hourlySeen = seen.length;
  preflightReady = false;
  const broken = await run("scripts/watchdog.mjs", { MODE: "hourly" }, dir);
  const result = existsSync(join(dir, "watchdog-result.md")) ? readFileSync(join(dir, "watchdog-result.md"), "utf8") : "";
  check("watchdog, not ready: exits non-zero and names the layer and the error", broken.code === 1 && /\| preflight \| not ready: redis/.test(result), result);
  check("hourly mode does not call diagnose (it costs money)", !seen.slice(hourlySeen).some(s => s.includes("/api/diagnose")));
  check("the token appears in nothing the watchdog wrote or printed", !result.includes(TOKEN) && !broken.out.includes(TOKEN));

  const out = join(dir, "reports");
  const noKey = await run("scripts/weekly-brief.mjs", { OUT_DIR: out, ANTHROPIC_API_KEY: "" }, dir);
  const date = existsSync(join(out, "date.txt")) ? readFileSync(join(out, "date.txt"), "utf8") : "";
  check("brief without a key: numbers only, no model call, files written",
    noKey.code === 0 && anthropicBodies.length === 0 && existsSync(join(out, `weekly-${date}.md`)) && existsSync(join(out, `content-${date}.md`)), noKey.out.slice(-400));
  check("it read only /api/stats (with the token) and /api/leaderboard",
    seen.includes("GET /api/stats auth") && seen.some(s => s.startsWith("GET /api/leaderboard")));
  const withKey = await run("scripts/weekly-brief.mjs", { OUT_DIR: out, ANTHROPIC_API_KEY: "sk-ant-brief-test-key", ANTHROPIC_URL: `${base}/v1/messages` }, dir);
  const body = anthropicBodies[0] || {};
  check("brief with a key: exactly one Sonnet 5.5 call, effort low, no sampling, max_tokens 1200",
    withKey.code === 0 && anthropicBodies.length === 1 && body.model === "claude-sonnet-5-5" && body.output_config?.effort === "low" &&
    !("temperature" in body) && !("thinking" in body) && body.max_tokens === 1200, JSON.stringify({ ...body, messages: undefined }));
  const brief = readFileSync(join(out, `weekly-${date}.md`), "utf8");
  check("its summary is kept (grounded) and its cost reported, under $0.02", /Of 200 landings, 30 started a scan\./.test(brief) && /it cost \$0\.0036/.test(brief), brief.slice(-300));
  check("no key or token in the files", !brief.includes("sk-ant-brief-test-key") && !brief.includes(TOKEN));
  server.close();
}

console.log(`\n${failures === 0 ? "All autopilot checks passed." : `${failures} autopilot check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
