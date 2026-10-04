/**
 * THE AUTOPILOT'S DECISIONS, AS PURE FUNCTIONS.
 *
 * The watchdog (scripts/watchdog.mjs) and the weekly brief
 * (scripts/weekly-brief.mjs) fetch from production and write files and
 * issues; everything they decide is here, so scripts/check-autopilot.mjs
 * can test every rule without a network. Numbers come from code: the one
 * optional model call in the brief writes prose around numbers computed
 * here, and its text is dropped if it states a number that is not among them.
 */
import { shareCaption } from "../../src/lib/verdict-copy.ts";

// ── secrets ──────────────────────────────────────────────────────────────
/** Removes the operator token, API keys and bearer values from any text before it is written anywhere. */
export function redact(text, secrets = []) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join("[redacted]").split(encodeURIComponent(secret)).join("[redacted]");
  }
  return out
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(api_key=)[^&"\s]+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, "$1[redacted]");
}

const clip = (text, n = 300) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// ── watchdog ─────────────────────────────────────────────────────────────
/** A spike: this many server-side scan failures inside the last hour. */
export const FAILURE_SPIKE_PER_HOUR = 5;
/** Or, across today, at least this many failures and this share of scans started. */
export const FAILURE_SPIKE_DAY_MIN = 5;
export const FAILURE_SPIKE_DAY_RATE = 0.25;
const ACCOUNT_FAILURE = /credit_exhausted|spend_cap|credit balance is too low/i;

/**
 * The hourly check: is the site ready, and are scans failing? Returns the
 * problems (each fails the run) and notes (reported, not failed).
 */
export function evaluateHourly({ preflight, stats, now = Date.now() }) {
  const problems = [];
  const notes = [];
  if (!preflight || preflight.status !== 200 || !preflight.json) {
    problems.push({ layer: "preflight", error: `HTTP ${preflight?.status ?? 0}: ${clip(preflight?.text)}` });
  } else if (preflight.json.ready !== true) {
    const blockers = (preflight.json.blockers || []).map(b => `${b.check}: ${b.detail}`).join("; ");
    problems.push({ layer: "preflight", error: `not ready: ${clip(blockers || "no blocker named", 600)}` });
  } else {
    notes.push(`preflight ready (${(preflight.json.warnings || []).length} warning(s))`);
  }

  if (!stats || stats.status !== 200 || !stats.json) {
    problems.push({ layer: "stats", error: `HTTP ${stats?.status ?? 0}: ${clip(stats?.text)}` });
    return { problems, notes };
  }
  const s = stats.json;
  const recent = Array.isArray(s.failures?.recent) ? s.failures.recent : [];
  const within = (ms) => recent.filter(f => { const t = Date.parse(f.at); return Number.isFinite(t) && now - t <= ms; });

  // The account refusing: every scan fails until someone adds credit.
  const account = within(24 * 3600_000).filter(f => (f.layers || []).some(l => ACCOUNT_FAILURE.test(l)));
  if (account.length) {
    problems.push({
      layer: account[0].reason || "gate",
      error: `the Anthropic account refused a scan in the last 24 hours (${account.length}x): ${clip((account[0].layers || []).join(", "))}. Add credit in the Claude Console; every scan fails until then.`,
    });
  }
  const lastHour = within(3600_000);
  if (lastHour.length >= FAILURE_SPIKE_PER_HOUR) {
    const byReason = {};
    for (const f of lastHour) byReason[f.reason] = (byReason[f.reason] || 0) + 1;
    problems.push({
      layer: Object.entries(byReason).sort((a, b) => b[1] - a[1])[0][0],
      error: `${lastHour.length} scans could not be completed in the last hour (${Object.entries(byReason).map(([k, v]) => `${k} ${v}`).join(", ")}); latest: ${clip((lastHour[0].layers || []).join(", "))}`,
    });
  }
  const today = new Date(now).toISOString().slice(0, 10);
  const dayCount = (event) => (s.series || []).find(x => x.event === event)?.days?.find(d => d.day === today)?.count ?? 0;
  const failedToday = dayCount("scan_failed");
  const startedToday = dayCount("scan_started");
  if (failedToday >= FAILURE_SPIKE_DAY_MIN && startedToday > 0 && failedToday / startedToday > FAILURE_SPIKE_DAY_RATE) {
    problems.push({ layer: "scan_failed", error: `${failedToday} of ${startedToday} scans started today failed (${Math.round((100 * failedToday) / startedToday)}%)` });
  }
  notes.push(`scan failures: ${lastHour.length} in the last hour, ${failedToday} of ${startedToday} started today`);
  if (s.spend?.mode === "degraded") notes.push("the engine is degraded (daily model budget spent or the API pushing back)");
  return { problems, notes };
}

/** The diagnose check: every failed layer, named, with its error. */
export function evaluateDiagnose({ diagnose, expectCommit = null }) {
  const problems = [];
  const notes = [];
  if (!diagnose || diagnose.status !== 200 || !diagnose.json || !Array.isArray(diagnose.json.layers)) {
    problems.push({ layer: "diagnose", error: `HTTP ${diagnose?.status ?? 0}: ${clip(diagnose?.text || JSON.stringify(diagnose?.json || ""))}` });
    return { problems, notes };
  }
  const d = diagnose.json;
  for (const l of d.layers.filter(x => !x.pass)) {
    const credit = ACCOUNT_FAILURE.test(l.detail || "") ? " (the Anthropic account is out of credit or at its spend limit: add credit in the Claude Console)" : "";
    problems.push({ layer: l.layer, error: `${l.status ? `HTTP ${l.status}: ` : ""}${clip(l.detail, 500)}${credit}` });
  }
  const commit = d.deployment?.commit || null;
  if (expectCommit && commit && !String(expectCommit).startsWith(commit) && !String(commit).startsWith(String(expectCommit).slice(0, 7))) {
    notes.push(`diagnose answered from ${commit}, not the deployed ${String(expectCommit).slice(0, 7)} (the alias may not have switched yet)`);
  }
  notes.push(`diagnose ${d.pass ? "passed" : "FAILED"} on ${commit || "an unknown commit"}; this run cost $${d.cost?.claudeUsd ?? "?"} of Claude and ${d.cost?.serperCredits ?? "?"} Serper credits`);
  return { problems, notes };
}

/** The run's summary, for the job summary and the alert issue. */
export function watchdogMarkdown({ mode, problems, notes, base, at }) {
  const lines = [
    `## Watchdog (${mode}) ${problems.length ? "FAILED" : "passed"}`,
    "",
    `${base}, ${at}.`,
    "",
  ];
  if (problems.length) {
    lines.push("| layer | error |", "|---|---|");
    for (const p of problems) lines.push(`| ${clip(p.layer, 80).replace(/\|/g, "/")} | ${clip(p.error, 700).replace(/\|/g, "/")} |`);
    lines.push("");
  }
  for (const n of notes) lines.push(`- ${n}`);
  return lines.join("\n");
}

// ── weekly brief ─────────────────────────────────────────────────────────
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const sum = (xs) => xs.reduce((a, b) => a + (Number(b) || 0), 0);

/** Every number the brief reports, computed from /api/stats (7 days). */
export function briefNumbers(stats) {
  const w = stats.window || {};
  const failures = (stats.failures?.byReason || []).filter(r => r.windowTotal > 0).sort((a, b) => b.windowTotal - a.windowTotal);
  const spendDays = stats.spend?.days || [];
  const modelUsd = Math.round(sum(spendDays.map(d => d.modelUsd)) * 10000) / 10000;
  const uncached = sum(spendDays.map(d => d.uncachedFreeScans));
  const budget = stats.spend?.dailyModelBudgetUsd ?? null;
  const cap = stats.spend?.globalDailyFreeScanCap ?? null;
  return {
    funnel: {
      landings: w.landings ?? 0,
      inputs: (w.inputs?.photo ?? 0) + (w.inputs?.url ?? 0),
      scanStarts: w.scanStarts ?? 0,
      scans: w.scans ?? 0,
      resultsShown: w.resultsShown ?? 0,
      shares: w.shares ?? 0,
      saves: (w.saves ?? 0) + (w.storySaves ?? 0),
      paywalls: w.paywalls ?? 0,
      checkoutClicks: w.checkoutClicks ?? 0,
      emails: w.emails ?? 0,
    },
    ratios: {
      inputPerLanding: w.inputRate ?? null,
      scanStartPerLanding: w.scanStartRate ?? null,
      failedPerStart: w.scanFailureRate ?? null,
      unresolvedPerScan: w.unresolvedRate ?? null,
      sharesPerScan: w.sharesPerScan ?? null,
      savesPerScan: w.savesPerScan ?? null,
      paywallPerScan: w.paywallRate ?? null,
      checkoutPerPaywall: w.checkoutClickRate ?? null,
    },
    outcomes: {
      verdicts: w.results?.verdict ?? 0,
      busted: w.verdicts?.busted ?? 0,
      overpriced: w.verdicts?.overpriced ?? 0,
      fair: w.verdicts?.fair ?? 0,
      finder: w.results?.finder ?? 0,
      unresolved: w.results?.unresolved ?? 0,
      failed: w.scanFailures ?? 0,
    },
    failures: failures.map(f => ({ reason: f.reason, count: f.windowTotal })),
    wrongProduct: { count: stats.wrongProduct?.windowTotal ?? 0, byResult: stats.wrongProduct?.byResult ?? {} },
    cost: {
      modelUsd,
      uncachedFreeScans: uncached,
      // To a hundredth of a cent: at a few cents a scan, three decimals
      // rounded a real cost to "$0".
      perCompletedScan: (w.scans ?? 0) > 0 ? Math.round((10000 * modelUsd) / w.scans) / 10000 : null,
      perUncachedFreeScan: uncached > 0 ? Math.round((10000 * modelUsd) / uncached) / 10000 : null,
      // The spend history is kept from the day it was added; days before
      // its first entry read as zero because nothing was recorded, not
      // because nothing was spent.
      historyFrom: spendDays.find(d => d.modelUsd > 0 || d.uncachedFreeScans > 0)?.day ?? null,
      windowFrom: spendDays[0]?.day ?? null,
      dailyBudgetUsd: budget,
      daysOverBudget: budget ? spendDays.filter(d => d.modelUsd >= budget).length : 0,
      freeCap: cap,
      daysAtCap: cap ? spendDays.filter(d => d.uncachedFreeScans >= cap).length : 0,
      busiestDayUsd: Math.round(Math.max(0, ...spendDays.map(d => d.modelUsd)) * 100) / 100,
    },
    providers: stats.providers || {},
    ledgerSize: stats.ledgerSize ?? 0,
  };
}

/**
 * The three highest-leverage fixes the numbers point at. Rules, not
 * judgement: each candidate names its evidence. A "wrong product" report
 * always leads, because the owner's first rule is no wrong product shown as
 * a match; the rest are ranked by how many people or scans each touches
 * this week.
 */
export function leverageFixes(n) {
  const out = [];
  const f = n.funnel;
  if (n.wrongProduct.count > 0) {
    const top = Object.entries(n.wrongProduct.byResult).sort((a, b) => b[1] - a[1])[0];
    out.push({ reach: Number.MAX_SAFE_INTEGER, text: `Check the ${n.wrongProduct.count} "wrong product" report(s)${top ? `, mostly on ${top[0]} results` : ""}: each is a match shown that a person says is wrong, the most expensive error this product can make.` });
  }
  if (n.failures.length) {
    const t = n.failures[0];
    out.push({ reach: t.count * 2, text: `Fix the "${t.reason}" layer: ${t.count} scan(s) could not be completed because of it this week (see /api/stats failures.recent).` });
  }
  if (n.outcomes.unresolved > 0 && n.ratios.unresolvedPerScan !== null && n.ratios.unresolvedPerScan >= 30) {
    out.push({ reach: n.outcomes.unresolved, text: `${n.outcomes.unresolved} of ${f.scans} scans (${n.ratios.unresolvedPerScan}%) found nothing: look at which inputs those were before changing the engine.` });
  }
  if (f.landings >= 20 && n.ratios.scanStartPerLanding !== null && n.ratios.scanStartPerLanding < 20) {
    out.push({ reach: f.landings - f.scanStarts, text: `Only ${n.ratios.scanStartPerLanding}% of ${f.landings} landings started a scan: the first screen is where most people leave.` });
  }
  if (f.paywalls >= 5 && f.checkoutClicks === 0) {
    out.push({ reach: f.paywalls, text: `${f.paywalls} people saw the paywall and none clicked through to checkout.` });
  }
  if (n.cost.daysAtCap > 0) {
    out.push({ reach: n.cost.daysAtCap * 10, text: `The free cap of ${n.cost.freeCap} ran out on ${n.cost.daysAtCap} day(s): visitors were turned away. Raise GLOBAL_DAILY_SCAN_CAP only when revenue covers it.` });
  }
  if (typeof n.providers.serperCreditsLeft === "number" && n.providers.serperCreditsLeft < 500) {
    out.push({ reach: 50, text: `Serper has ${n.providers.serperCreditsLeft} credits left, about ${Math.floor(n.providers.serperCreditsLeft / 5)} scans: top up before it runs out.` });
  }
  if (f.scans > 0 && f.shares + f.saves === 0) {
    out.push({ reach: f.scans, text: `${f.scans} scans and no card shared or saved: the card is the growth loop and it is not turning.` });
  }
  return out.sort((a, b) => b.reach - a.reach).slice(0, 3).map(x => x.text);
}

/** Every number that appears in the computed data, as strings, for checking a summary against. */
export function allowedNumbers(numbers, fixes = []) {
  const set = new Set();
  const visit = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      set.add(String(v));
      set.add(v.toFixed(2));
      if (Number.isInteger(v)) set.add(v.toLocaleString("en-US"));
    } else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(numbers);
  for (const f of fixes) for (const m of String(f).match(/\d[\d,]*(?:\.\d+)?/g) || []) set.add(m);
  return set;
}

/** A model-written summary is kept only if every number in it is one the code computed. */
export function summaryIsGrounded(text, allowed) {
  const found = String(text || "").match(/\d[\d,]*(?:\.\d+)?/g) || [];
  return found.every(n => allowed.has(n) || allowed.has(n.replace(/,/g, "")) || allowed.has(String(Number(n.replace(/,/g, "")))));
}

/** The brief as markdown. */
export function briefMarkdown({ date, numbers: n, fixes, summary, base }) {
  const r = (v) => (v === null || v === undefined ? "n/a" : `${v}%`);
  const lines = [
    `# Weekly brief, week to ${date}`,
    "",
    `From ${base}/api/stats (7 days) and ${base}/api/leaderboard. Every number is computed by scripts/lib/autopilot.mjs; none comes from a model.`,
    "",
  ];
  if (summary) lines.push("## In short", "", summary, "");
  lines.push(
    "## The three fixes the numbers point at", "",
    ...(fixes.length ? fixes.map((f, i) => `${i + 1}. ${f}`) : ["Not enough data this week to point at anything."]), "",
    "## Funnel", "",
    "| step | count | ratio |", "|---|---|---|",
    `| landings | ${n.funnel.landings} | |`,
    `| photo or link entered | ${n.funnel.inputs} | ${r(n.ratios.inputPerLanding)} of landings |`,
    `| scans started | ${n.funnel.scanStarts} | ${r(n.ratios.scanStartPerLanding)} of landings |`,
    `| scans completed | ${n.funnel.scans} | ${r(n.ratios.failedPerStart)} of starts failed |`,
    `| results shown | ${n.funnel.resultsShown} | |`,
    `| cards shared / saved | ${n.funnel.shares} / ${n.funnel.saves} | ${n.ratios.sharesPerScan ?? "n/a"} shares, ${n.ratios.savesPerScan ?? "n/a"} saves per scan |`,
    `| paywall shown | ${n.funnel.paywalls} | ${r(n.ratios.paywallPerScan)} of scans |`,
    `| checkout clicked | ${n.funnel.checkoutClicks} | ${r(n.ratios.checkoutPerPaywall)} of paywalls |`,
    `| emails captured | ${n.funnel.emails} | |`,
    "",
    "## Scan outcomes", "",
    `Verdicts ${n.outcomes.verdicts} (busted ${n.outcomes.busted}, overpriced ${n.outcomes.overpriced}, fair ${n.outcomes.fair}); closest match ${n.outcomes.finder}; no match ${n.outcomes.unresolved}; could not be completed ${n.outcomes.failed}. Ledger: ${n.ledgerSize} records.`,
    "",
    "## Failure reasons", "",
    n.failures.length ? n.failures.map(f => `- ${f.reason}: ${f.count}`).join("\n") : "None this week.",
    "",
    "## \"Wrong product\" reports", "",
    n.wrongProduct.count ? `${n.wrongProduct.count} this week. By result: ${Object.entries(n.wrongProduct.byResult).map(([k, v]) => `${k} ${v}`).join(", ") || "n/a"}.` : "None this week.",
    "",
    "## Cost against the caps", "",
    ...(n.cost.historyFrom && n.cost.windowFrom && n.cost.historyFrom > n.cost.windowFrom
      ? [`Spend history begins ${n.cost.historyFrom}: the days before it read as zero because nothing was recorded, so this week's cost figures are partial.`] : []),
    `Model spend ${money(n.cost.modelUsd)} this week (busiest day ${money(n.cost.busiestDayUsd)}; daily budget ${n.cost.dailyBudgetUsd === null ? "n/a" : money(n.cost.dailyBudgetUsd)}, crossed on ${n.cost.daysOverBudget} day(s)).`,
    `Per completed scan ${n.cost.perCompletedScan === null ? "n/a" : `$${n.cost.perCompletedScan}`} (cache hits included); per uncached free scan ${n.cost.perUncachedFreeScan === null ? "n/a" : `$${n.cost.perUncachedFreeScan}`} (${n.cost.uncachedFreeScans} of them; free cap ${n.cost.freeCap ?? "n/a"} a day, reached on ${n.cost.daysAtCap} day(s)).`,
    `Search accounts: Serper ${n.providers.serperCreditsLeft ?? "unknown"} credits left, SerpApi ${n.providers.serpApiSearchesLeft ?? "unknown"} searches left.`,
    "",
  );
  return lines.join("\n");
}

// ── content pack ─────────────────────────────────────────────────────────
const HASHTAGS = {
  beauty: ["#beautydupes", "#makeuphacks"], skincare: ["#skincaredupes", "#skincare"], fitness: ["#fitnessgear", "#gymtok"],
  tech: ["#techdeals", "#gadgets"], fashion: ["#fashiondupes", "#thriftfinds"], accessories: ["#accessories", "#dupes"],
  home: ["#homefinds", "#amazonfinds"], pet: ["#petproducts", "#dogsoftiktok"], food: ["#foodie", "#kitchenhacks"], other: ["#shoppinghacks"],
};
const BASE_TAGS = ["#bustedlab", "#overpriced", "#dontoverpay"];

const titleKey = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 6).join(" ");
const short = (t, n = 48) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1).trim()}…` : s; };

/**
 * The week's five biggest verified markups, de-duplicated (one per product
 * and per near-identical title), each with copy that claims only what the
 * record backs: "the same listing" only for an exact match.
 */
export function contentPack({ weekTop = [], base, date }) {
  const seen = new Set();
  const rows = [];
  for (const r of weekTop) {
    if (!(r.markup > 0) || !(r.savings > 0) || r.matchConfidence === "unverified") continue;
    const k = titleKey(r.title);
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(r);
    if (rows.length === 5) break;
  }
  const lines = [`# Content pack, week to ${date}`, "", "The week's biggest verified markups from the public ledger (evaluation scans never reach it), one per product. Posting stays manual.", ""];
  if (!rows.length) {
    lines.push("No verified markup this week, so nothing to post from real data.");
    return { rows, markdown: lines.join("\n") };
  }
  rows.forEach((r, i) => {
    const page = `${base}/scan/${r.id}`;
    const image = `${base}/scan/${r.id}/opengraph-image`;
    const same = r.matchConfidence === "exact" ? "the same product" : "a near-identical listing";
    const retail = money(r.retailPrice);
    const source = money(r.wholesalePrice);
    // The card's own share caption, so the post says what the card says.
    const caption = `${shareCaption({ mode: "VERDICT", savings: r.savings, markup: r.markup, wholesalePrice: r.wholesalePrice, hasPermalink: true })} ${page}`;
    const hooks = [
      `Sold for ${retail}. ${same[0].toUpperCase()}${same.slice(1)} is listed at ${source}.`,
      `${r.markup}% markup, checked against a real listing.`,
      `Before you pay ${retail} for ${short(r.title, 40)}, look at this.`,
    ];
    const tags = [...BASE_TAGS, ...(HASHTAGS[r.category] || HASHTAGS.other)];
    lines.push(
      `## ${i + 1}. ${short(r.title, 80)}`, "",
      `${r.markup}% markup: ${retail} asked, ${source} at ${r.platform || "the source listing"} (${r.matchConfidence === "exact" ? "exact match" : "visual match"}).`, "",
      `**Caption:** ${caption}`, "",
      "**Hooks:**", ...hooks.map(h => `- ${h}`), "",
      `**Hashtags:** ${tags.join(" ")}`, "",
      `**Scan page:** ${page}  `, `**Share image:** ${image}`, "",
    );
  });
  return { rows, markdown: lines.join("\n") };
}
