/**
 * PRODUCTION EVALUATION, run from GitHub's runners by
 * .github/workflows/production-eval.yml (the development sandbox cannot reach
 * the live site). What a run does is set by evals/run.json:
 *
 *   { "run": 3, "steps": ["preflight", "diagnose", "scan"], "maxUsd": 8 }
 *
 *   preflight  GET /api/preflight
 *   diagnose   GET /api/diagnose (real calls to every provider)
 *   photos     resolve and download every case's photo (evals/cases.json),
 *              compose the price screenshots; no production call
 *   scan       each case through the real production scan, on the intents
 *              in run.intents (default verdict then finder), as evaluation
 *              scans (operator token + x-bustedlab-eval), classified
 *   replay     the candidates each scan's gate saw, replayed on every model
 *              and effort in run.replay.gate; extraction on run.replay.extract
 *   purge      removes what earlier evaluation runs wrote to public data
 *              (POST /api/eval/purge): the ledger record ids and the counter
 *              amounts are computed here from the raw responses committed
 *              in evals/results/run-*.json, so what goes is auditable. Once
 *              per run.purgeId; a repeat changes nothing.
 *
 * run.cases limits the run to some case ids; run.plan sets the exact
 * [case, intent] list. run.scanCapUsd is a hard cap on the scan step's own
 * spend, all-in (Claude as measured, Serper credits as reported, SerpApi
 * searches at the plan's price): a scan that could cross it is not started.
 * run.requireDiagnosePass stops the scans when diagnose did not pass.
 * SerpApi is the engine's backup and the engine keeps it above its own
 * reserve (SEARCH PROVIDERS in src/lib/scan.ts).
 *
 * Every step talks to production with the operator token from the
 * ANALYTICS_TOKEN secret. The token is never written: every byte this script
 * writes (results file, report, job summary, console) goes through redact().
 *
 * Spend is capped twice: per run by run.json's maxUsd, and across all runs by
 * SPEND_CAP_USD, using the ledger committed in evals/results/ledger.json. A
 * step that would cross either stops before it starts.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { identityMatches, isListing } from "./lib/labels.mjs";
import { localModule } from "./lib/engine.mjs";

// Prices read off pages here go through the engine's own parser, so a
// report never shows a price the engine would read differently.
const { parsePrice } = await import(localModule("fx"));

const REPO = resolve(dirname(new URL(import.meta.url).pathname), "..");
const BASE = (process.env.BASE_URL || "https://www.bustedlab.com").replace(/\/$/, "");
const TOKEN = process.env.ANALYTICS_TOKEN || "";
const SPEND_CAP_USD = 25;
// Serper bills about a tenth of a cent per credit; a Shopping search is one
// credit, a Lens search reports its own (trace creditsByProvider). SerpApi's
// per-search price depends on the plan, so it is worked out from the account
// diagnose reports.
const SERPER_PER_CREDIT = 0.001;
const SERPAPI_PER_SEARCH_DEFAULT = 0.01;

const RESULTS = resolve(REPO, "evals/results");
mkdirSync(RESULTS, { recursive: true });

const run = JSON.parse(readFileSync(resolve(REPO, "evals/run.json"), "utf8"));
const ledgerPath = resolve(RESULTS, "ledger.json");
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { capUsd: SPEND_CAP_USD, runs: [] };
const spentBefore = ledger.runs.reduce((sum, r) => sum + (r.totalUsd || 0), 0);
const runCap = Math.min(Number(run.maxUsd) || 1, SPEND_CAP_USD - spentBefore);

// ── redaction ────────────────────────────────────────────────────────────
function redact(text) {
  let out = String(text ?? "");
  if (TOKEN && TOKEN.length >= 8) {
    out = out.split(TOKEN).join("[redacted]").split(encodeURIComponent(TOKEN)).join("[redacted]");
  }
  return out
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(api_key=)[^&"\s]+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, "$1[redacted]");
}
const log = (...parts) => console.log(redact(parts.map(p => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")));

// ── spend ────────────────────────────────────────────────────────────────
const spend = { claudeUsd: 0, serpapiSearches: 0, serperCredits: 0, serpapiPerSearch: SERPAPI_PER_SEARCH_DEFAULT };
const searchUsd = () => spend.serpapiSearches * spend.serpapiPerSearch + spend.serperCredits * SERPER_PER_CREDIT;
/** One traced scan's all-in cost: Claude as measured, Serper credits as reported, SerpApi at the plan's price. */
function scanCost(trace) {
  const serperCredits = Number(trace?.creditsByProvider?.serper ?? trace?.searchesByProvider?.serper) || 0;
  const serpapi = Number(trace?.searchesByProvider?.serpapi) || 0;
  const claude = Number(trace?.claudeUsd) || 0;
  return { claude, serperCredits, serpapi, usd: claude + serperCredits * SERPER_PER_CREDIT + serpapi * spend.serpapiPerSearch };
}
const runUsd = () => spend.claudeUsd + searchUsd();
const canSpend = (nextUsd) => runUsd() + nextUsd <= runCap;

// ── production calls ─────────────────────────────────────────────────────
async function operator(path, init = {}, timeoutMs = 150_000) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${TOKEN}`, "User-Agent": "BustedLabEval/1.0 (production evaluation)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { status: 0, ms: Date.now() - started, json: null, text: String(err?.message || err) };
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* kept as text */ }
  return { status: res.status, ms: Date.now() - started, json, text: json ? "" : text.slice(0, 2000) };
}

// ── steps ────────────────────────────────────────────────────────────────
const results = { run: run.run, note: run.note || "", base: BASE, startedAt: new Date().toISOString(), steps: {} };
const report = [];

async function preflight() {
  const r = await operator("/api/preflight", {}, 30_000);
  results.steps.preflight = r;
  report.push(`## Preflight\n`, `HTTP ${r.status} in ${r.ms} ms.`);
  if (r.json) {
    report.push(`Ready: **${r.json.ready}** (${r.json.environment}).`);
    for (const b of r.json.blockers || []) report.push(`- BLOCKER ${b.check}: ${b.detail}`);
    for (const w of r.json.warnings || []) report.push(`- warning ${w.check}: ${w.detail}`);
    report.push(`- ok: ${(r.json.ok || []).join(", ")}`);
    report.push(`- limits: ${JSON.stringify(r.json.limits)}`);
  } else {
    report.push("```", r.text, "```");
  }
  report.push("");
}

async function diagnose() {
  if (!canSpend(0.15)) { report.push("## Diagnose\n\nSkipped: the spend cap would be crossed.\n"); return; }
  const r = await operator("/api/diagnose", {}, 90_000);
  results.steps.diagnose = r;
  report.push(`## Diagnose\n`, `HTTP ${r.status} in ${r.ms} ms.`);
  const d = r.json;
  if (!d || !Array.isArray(d.layers)) {
    report.push("```", r.text || JSON.stringify(d), "```", "");
    return;
  }
  spend.claudeUsd += Number(d.cost?.claudeUsd) || 0;
  spend.serperCredits += Number(d.cost?.serperCredits) || 0;
  const account = d.layers.find(l => l.layer.startsWith("serpapi account"));
  const perMonth = Number(account?.searchesPerMonth);
  // The free plan's searches cost nothing; a paid plan's cost its price over its allowance.
  const plans = { 250: 0, 1000: 25, 5000: 75, 15000: 150, 30000: 275 };
  if (perMonth in plans) spend.serpapiPerSearch = plans[perMonth] / perMonth;
  results.deployedCommit = d.deployment?.commit || null;
  report.push(`Production is running commit \`${d.deployment?.commit || "unknown"}\` (${d.deployment?.environment || "unknown"}).`);
  report.push(`Pass: **${d.pass}**. Failing: ${(d.failing || []).join(", ") || "none"}. Spend mode: ${d.spend?.mode}, today $${d.spend?.todayUsd} of $${d.spend?.dailyBudgetUsd}. This run's Claude cost: $${d.cost?.claudeUsd}; Serper credits: ${d.cost?.serperCredits ?? "n/a"}. Thinking per call: ${d.thinking?.perCallApprox ?? "n/a"}.`);
  report.push(`Limits in force: ${JSON.stringify(d.limits || null)}. Serper credits left: ${d.serperCredits?.known ? d.serperCredits.creditsLeft : `unknown (${d.serperCredits?.detail || "no answer"})`}.`);
  const lens = d.layers.find(l => l.layer === "lens serper");
  if (lens) report.push(`Serper Lens: ${lens.matches ?? 0} matches, ${lens.usable ?? 0} usable, ${lens.priced ?? 0} priced, ${lens.creditsUsed ?? "?"} credits; response shape ${JSON.stringify(lens.responseShape || null)}; sample ${JSON.stringify(lens.sample || [])}.`);
  report.push("", "| layer | pass | status | ms | detail |", "|---|---|---|---|---|");
  for (const l of d.layers) {
    report.push(`| ${l.layer} | ${l.pass ? "pass" : "FAIL"} | ${l.status} | ${l.latencyMs} | ${String(l.detail || "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 400)} |`);
  }
  report.push("");
}

// ── photos ───────────────────────────────────────────────────────────────
const UA_BOT = "BustedLabEval/1.0 (+https://github.com/texasimcoming/bustedlab; product-photo evaluation)";
const UA_BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const casesFile = JSON.parse(readFileSync(resolve(REPO, "evals/cases.json"), "utf8"));
const CASES = run.cases ? casesFile.cases.filter(c => run.cases.includes(c.id)) : casesFile.cases;
const photos = new Map(); // case id -> { data: Buffer, mimeType, meta }

async function get(url, { ua = UA_BROWSER, accept = "*/*", timeoutMs = 25_000 } = {}) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": ua, Accept: accept, "Accept-Language": "en,fr;q=0.8" }, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status} from ${url}`);
      if (res.status === 404 || res.status === 403) break;
    } catch (err) {
      last = err;
    }
    await sleep(1500 * (attempt + 1));
  }
  throw last;
}

const stripHtml = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const absolute = (url, base) => { try { return new URL(url, base).href; } catch { return ""; } };

/** One source entry to { imageUrl, title, price, currency, page, license, author }. */
async function resolveSource(src) {
  if (src.commons) {
    const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=2000&titles=${encodeURIComponent(`File:${src.commons}`)}`;
    const data = await (await get(api, { ua: UA_BOT, accept: "application/json" })).json();
    const info = data?.query?.pages?.[0]?.imageinfo?.[0];
    if (!info) throw new Error(`Commons has no file "${src.commons}"`);
    const meta = info.extmetadata || {};
    await sleep(1000);
    return {
      imageUrl: info.thumburl || info.url, ua: UA_BOT, title: src.commons, page: info.descriptionurl,
      license: meta.LicenseShortName?.value || "", author: stripHtml(meta.Artist?.value).slice(0, 120),
      description: stripHtml(meta.ImageDescription?.value).slice(0, 300),
    };
  }
  if (src.shopify) {
    const data = await (await get(`${src.shopify.replace(/\/$/, "")}.json`, { accept: "application/json" })).json();
    const product = data?.product;
    const image = product?.images?.[0]?.src || product?.image?.src;
    if (!image) throw new Error(`no product image at ${src.shopify}`);
    return {
      imageUrl: absolute(image, src.shopify), title: product.title, page: src.shopify,
      price: Number(product.variants?.[0]?.price) || null, currency: src.currency || "USD",
    };
  }
  if (src.shopifyCollection) {
    // The first product in a store's collection that has a photo and a price:
    // for when a single product's handle is not known or has moved.
    const data = await (await get(`${src.shopifyCollection.replace(/\/$/, "")}/products.json?limit=10`, { accept: "application/json" })).json();
    const product = (data?.products || []).find(p => p.images?.[0]?.src && Number(p.variants?.[0]?.price) > 0);
    if (!product) throw new Error(`no priced product with a photo in ${src.shopifyCollection}`);
    const base = new URL(src.shopifyCollection).origin;
    return {
      imageUrl: absolute(product.images[0].src, base), title: product.title, page: `${base}/products/${product.handle}`,
      price: Number(product.variants[0].price), currency: src.currency || "USD",
    };
  }
  if (src.page) {
    const html = await (await get(src.page, { accept: "text/html" })).text();
    const meta = (name) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1]
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, "i"))?.[1];
    let currency = meta("product:price:currency") || meta("og:price:currency") || "";
    let price = parsePrice(meta("product:price:amount") || meta("og:price:amount"), currency).amount || null;
    let image = meta("og:image") || meta("twitter:image") || "";
    let title = meta("og:title") || "";
    for (const block of html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []) {
      try {
        const json = JSON.parse(block.replace(/^<script[^>]*>|<\/script>$/gi, ""));
        const nodes = [json, ...(Array.isArray(json) ? json : []), ...(json["@graph"] || [])];
        const product = nodes.find(n => n && /Product/i.test(String(n["@type"])));
        if (!product) continue;
        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        price = price || parsePrice(offer?.price || offer?.lowPrice, offer?.priceCurrency).amount || null;
        currency = currency || offer?.priceCurrency || "";
        image = image || (Array.isArray(product.image) ? product.image[0] : product.image?.url || product.image) || "";
        title = title || product.name || "";
      } catch { /* not JSON */ }
    }
    if (!image) throw new Error(`no product image on ${src.page}`);
    return { imageUrl: absolute(image, src.page), title: stripHtml(title), page: src.page, price, currency: currency || src.currency || "" };
  }
  if (src.url) return { imageUrl: src.url, title: src.title || "", page: src.url };
  throw new Error("unknown source");
}

const escapeXml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function formatPrice(amount, currency, locale) {
  const fixed = amount.toFixed(2);
  if (currency === "MAD") return `${fixed.replace(".", ",")} DH`;
  if (currency === "EUR") return locale === "de" ? `${fixed.replace(".", ",")} €` : `${fixed.replace(".", ",")} €`;
  if (currency === "SEK") return `${Math.round(amount)} kr`;
  return `$${fixed}`;
}
function wrap(text, max = 34, lines = 2) {
  const words = String(text).split(/\s+/);
  const out = [""];
  for (const w of words) {
    if ((out[out.length - 1] + " " + w).trim().length > max) {
      if (out.length === lines) { out[out.length - 1] += "…"; break; }
      out.push(w);
    } else out[out.length - 1] = (out[out.length - 1] + " " + w).trim();
  }
  return out;
}

const shopHost = (page) => { try { return new URL(page).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** A phone screenshot of the listing: its own photo, title and asking price. */
async function composeScreenshot(image, resolved, c) {
  const W = 1080, H = 2340;
  const product = await sharp(image).rotate().resize(1000, 1000, { fit: "contain", background: "#ffffff" }).jpeg().toBuffer();
  const locale = c.screenshot.locale;
  const copy = {
    fr: { cart: "Ajouter au panier", ship: "Livraison offerte dès 50 €", stock: "En stock" },
    de: { cart: "In den Warenkorb", ship: "Kostenloser Versand", stock: "Auf Lager" },
    ma: { cart: "Ajouter au panier", ship: "Livraison partout au Maroc", stock: "En stock" },
  }[locale] || { cart: "Add to cart", ship: "Free shipping", stock: "In stock" };
  const price = formatPrice(resolved.price, resolved.currency, locale);
  const title = wrap(resolved.title || c.id, 34, 2);
  const font = "DejaVu Sans, Liberation Sans, Arial, sans-serif";
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="60" y="70" font-family="${font}" font-size="34" font-weight="bold" fill="#111">9:41</text>
    <text x="${W - 60}" y="70" text-anchor="end" font-family="${font}" font-size="30" fill="#111">5G 87%</text>
    <rect x="40" y="110" width="${W - 80}" height="80" rx="40" fill="#f1f3f4"/>
    <text x="${W / 2}" y="163" text-anchor="middle" font-family="${font}" font-size="32" fill="#333">${escapeXml(shopHost(resolved.page) || c.screenshot.shop)}</text>
    ${title.map((line, i) => `<text x="60" y="${1330 + i * 58}" font-family="${font}" font-size="46" fill="#111">${escapeXml(line)}</text>`).join("")}
    <text x="60" y="${1330 + title.length * 58 + 90}" font-family="${font}" font-size="78" font-weight="bold" fill="#111">${escapeXml(price)}</text>
    <text x="60" y="${1330 + title.length * 58 + 160}" font-family="${font}" font-size="34" fill="#0a7d38">${escapeXml(copy.stock)} · ${escapeXml(copy.ship)}</text>
    <rect x="60" y="${H - 360}" width="${W - 120}" height="130" rx="65" fill="#111"/>
    <text x="${W / 2}" y="${H - 278}" text-anchor="middle" font-family="${font}" font-size="44" font-weight="bold" fill="#fff">${escapeXml(copy.cart)}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).composite([{ input: product, top: 230, left: 40 }]).jpeg({ quality: 88 }).toBuffer();
}

async function photosStep() {
  report.push("## Photos\n", "| case | source | license | size | note |", "|---|---|---|---|---|");
  results.photos = {};
  for (const c of CASES) {
    let lastError = "";
    const errors = [];
    for (const src of c.source) {
      try {
        const resolved = await resolveSource(src);
        const raw = Buffer.from(await (await get(resolved.imageUrl, { ua: resolved.ua || UA_BROWSER, accept: "image/*" })).arrayBuffer());
        let image = sharp(raw).rotate().resize(2000, 2000, { fit: "inside", withoutEnlargement: true });
        if (c.mirror) {
          const m = await sharp(await image.toBuffer()).metadata();
          const dx = Math.round(m.width * 0.06), dy = Math.round(m.height * 0.06);
          image = sharp(await image.toBuffer()).flop().extract({ left: dx, top: dy, width: m.width - 2 * dx, height: m.height - 2 * dy });
        }
        let buffer = await image.jpeg({ quality: 88 }).toBuffer();
        if (c.screenshot) {
          if (!(resolved.price > 0)) throw new Error(`no asking price found on ${resolved.page}`);
          buffer = await composeScreenshot(buffer, resolved, c);
        }
        // Marked with the run, so the bytes (and the result cache key) differ
        // from earlier runs: each run measures the engine, not the cache.
        buffer = await sharp(buffer).withExifMerge({ IFD0: { ImageDescription: `bustedlab eval run ${run.run}` } }).jpeg({ quality: 88 }).toBuffer();
        const meta = await sharp(buffer).metadata();
        const info = {
          source: src, page: resolved.page, title: resolved.title, license: resolved.license || "", author: resolved.author || "",
          description: resolved.description || "", askingPrice: c.screenshot ? { amount: resolved.price, currency: resolved.currency } : null,
          width: meta.width, height: meta.height, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex").slice(0, 16),
        };
        photos.set(c.id, { data: buffer, mimeType: "image/jpeg", meta: info });
        results.photos[c.id] = info;
        report.push(`| ${c.id} | [${escapeMd(resolved.title || "source").slice(0, 60)}](${resolved.page}) | ${info.license || "listing"} | ${meta.width}x${meta.height} | ${c.screenshot ? `screenshot at ${formatPrice(resolved.price, resolved.currency, c.screenshot.locale)}` : c.mirror ? "mirrored, cropped" : ""} |`);
        lastError = "";
        break;
      } catch (err) {
        lastError = String(err?.message || err).slice(0, 200);
        errors.push(lastError);
      }
    }
    if (lastError) {
      results.photos[c.id] = { error: lastError, errors };
      report.push(`| ${c.id} | FAILED | | | ${escapeMd(errors.join(" ; "))} |`);
    } else if (errors.length) {
      results.photos[c.id].skippedSources = errors;
    }
  }
  report.push("");
}
const escapeMd = (t) => String(t ?? "").replace(/\|/g, "/").replace(/\n/g, " ");

// ── scan ─────────────────────────────────────────────────────────────────
const scans = []; // { caseId, intent, status, ms, json, classification }
let stopAll = false;


/** The user's categories, from a result and the label. */
function classify(c, res) {
  if (res.status !== 200 || !res.json) return { label: "error", detail: res.json?.error || res.json?.reason || res.text?.slice(0, 80) || `HTTP ${res.status}` };
  const r = res.json;
  const shown = `${r.sourceProduct?.title || ""} ${r.sourceProduct?.productUrl || ""}`;
  const confident = r.found && (r.matchConfidence === "exact" || r.matchConfidence === "likely");
  if (confident) {
    if (c.findable === false) return { label: "WRONG", detail: `an unfindable item shown as ${r.matchConfidence}` };
    return identityMatches(c, shown)
      ? { label: r.matchConfidence === "exact" ? "correct exact" : "correct likely" }
      : { label: "WRONG", detail: `shown as ${r.matchConfidence}: ${r.sourceProduct?.title}` };
  }
  const lookalike = r.found && r.mode !== "UNRESOLVED";
  if (c.findable !== true) return { label: lookalike ? "honest lookalike" : "honest no-match" };
  return { label: "miss", detail: lookalike ? "only an unverified lookalike" : "no match" };
}

async function evalScan(photo, intent) {
  const form = new FormData();
  form.append("image", new Blob([photo.data], { type: photo.mimeType }), "photo.jpg");
  form.append("intent", intent);
  return operator("/api/scan", { method: "POST", body: form, headers: { "x-bustedlab-eval": "1" } }, 160_000);
}

async function freeAllowanceLeft() {
  const r = await operator("/api/scan", {}, 20_000);
  return typeof r.json?.remaining === "number" ? r.json.remaining : null;
}

async function scanStep() {
  // A run made for a fix must not measure the build before it.
  // A missing commit is an older build than the one that reports it.
  if (run.expectCommit && !String(run.expectCommit).startsWith(results.deployedCommit || "-")) {
    report.push(`## Scans\n\nStopped: production is running \`${results.deployedCommit}\`, not \`${run.expectCommit}\`. The deploy has not finished; push run.json again.\n`);
    stopAll = true;
    return;
  }
  const probe = await operator("/api/eval", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }, 20_000);
  if (probe.status !== 400) {
    report.push(`## Scans\n\nStopped: the evaluation path is not live on ${BASE} yet (POST /api/eval answered ${probe.status}). The deploy may still be building.\n`);
    return;
  }
  if (run.requireDiagnosePass && results.steps.diagnose?.json?.pass !== true) {
    report.push(`## Scans\n\nStopped: diagnose did not pass (failing: ${(results.steps.diagnose?.json?.failing || ["no answer"]).join(", ")}). Nothing was scanned.\n`);
    return;
  }
  const intents = run.intents || ["verdict", "finder"];
  const account = results.steps.diagnose?.json?.layers?.find(l => l.layer.startsWith("serpapi account"));
  let serpapiLeft = Number(account?.totalSearchesLeft);
  if (!Number.isFinite(serpapiLeft)) serpapiLeft = null;
  // The scan step's own hard cap, all-in. A scan is started only if even an
  // expensive one (the dearest seen so far times 1.5, at least 10 cents)
  // cannot cross it.
  const scanCap = Number(run.scanCapUsd) || Infinity;
  let scanSpent = 0;
  let dearest = 0;
  const allowanceBefore = await freeAllowanceLeft();
  let stopped = "";
  // run.plan, when given, is the exact list and order of [case, intent] to
  // scan: the cases most worth the remaining searches first.
  const plan = Array.isArray(run.plan)
    ? run.plan.map(([id, intent]) => ({ c: CASES.find(x => x.id === id), intents: [intent] })).filter(p => p.c)
    : CASES.map(c => ({ c, intents }));
  for (const { c, intents: caseIntents } of plan) {
    const photo = photos.get(c.id);
    if (!photo) { scans.push({ caseId: c.id, intent: "-", status: 0, classification: { label: "error", detail: "no photo" } }); continue; }
    for (const intent of caseIntents) {
      const next = Math.max(0.10, dearest * 1.5);
      if (scanSpent + next > scanCap) { stopped = `the scan step's cap of $${scanCap.toFixed(2)} could be crossed by the next scan ($${scanSpent.toFixed(4)} spent)`; break; }
      if (!canSpend(next)) { stopped = "the spend cap for this run was reached"; break; }
      log(`scan ${c.id} ${intent}`);
      const res = await evalScan(photo, intent);
      const trace = res.json?.evaluation?.trace;
      const cost = scanCost(trace);
      spend.claudeUsd += cost.claude;
      spend.serpapiSearches += cost.serpapi;
      spend.serperCredits += cost.serperCredits;
      scanSpent += cost.usd;
      dearest = Math.max(dearest, cost.usd);
      if (serpapiLeft !== null) serpapiLeft -= cost.serpapi;
      scans.push({ caseId: c.id, intent, status: res.status, ms: res.ms, json: res.json, text: res.text, classification: classify(c, res), costUsd: +cost.usd.toFixed(6) });
      if (scanSpent >= scanCap) { stopped = `the scan step's cap of $${scanCap.toFixed(2)} was reached`; break; }
      await sleep(3000);
    }
    if (stopped) break;
  }
  const allowanceAfter = await freeAllowanceLeft();
  results.scans = scans.map(s => ({ ...s, text: s.text || undefined }));
  results.freeAllowance = { before: allowanceBefore, after: allowanceAfter };
  results.serpapiLeftAfter = serpapiLeft;
  results.scanSpendUsd = +scanSpent.toFixed(6);
  scanReport(stopped, allowanceBefore, allowanceAfter, serpapiLeft, scanSpent, scanCap);
}

/** Whether the scan asked SerpApi's Lens after Serper's could not verify (ESCALATION in scan.ts). */
function escalationOf(trace) {
  const steps = (trace?.steps || []).filter(x => x.step === "escalation");
  if (steps.length === 0) return "not needed";
  return steps.map(x => (x.ran ? `ran: ${x.fresh ?? 0} new, ${x.confidence}${x.fromEscalation ? ", used" : ""}` : `skipped: ${x.reason}`)).join("; ");
}

function scanReport(stopped, before, after, serpapiLeft, scanSpent = 0, scanCap = Infinity) {
  report.push("## Scans\n");
  if (stopped) report.push(`Stopped early: ${stopped}.\n`);
  report.push(`Free allowance seen from this runner's address: ${before} before, ${after} after (an evaluation scan must not use it). SerpApi searches left after: ${serpapiLeft ?? "unknown"}.`);
  report.push(`Scan step spend, all-in: $${scanSpent.toFixed(4)}${Number.isFinite(scanCap) ? ` of its $${scanCap.toFixed(2)} cap` : ""}.\n`);
  report.push("| case | kind | intent | class | confidence | mode | engine | SerpApi escalation | shown | ms | $ all-in | $ model | Serper credits | SerpApi | cache read / written | calls reading |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of scans) {
    const c = CASES.find(x => x.id === s.caseId);
    const r = s.json || {};
    const t = r.evaluation?.trace || {};
    const cost = scanCost(t);
    report.push(`| ${s.caseId} | ${c?.kind || ""} | ${s.intent} | **${s.classification.label}**${s.classification.detail ? ` (${escapeMd(s.classification.detail).slice(0, 80)})` : ""} | ${r.matchConfidence || ""} | ${r.mode || r.error || ""} | ${r.engineUsed || ""} | ${escalationOf(t)} | ${escapeMd(r.sourceProduct?.title || "").slice(0, 60)} | ${s.ms ?? ""} | ${cost.usd.toFixed(4)} | ${t.claudeUsd ?? ""} | ${cost.serperCredits} | ${cost.serpapi} | ${t.cache ? `${t.cache.readTokens} / ${t.cache.writeTokens}` : ""} | ${t.cache ? `${t.cache.callsReading} of ${t.cache.calls}` : ""} |`);
  }
  const counts = {};
  for (const s of scans) counts[s.classification.label] = (counts[s.classification.label] || 0) + 1;
  report.push("", `Totals: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}.`, "");
  // Where the time and the thinking went, across every traced scan.
  const layerMs = {}, layerN = {}, thinking = [], perModel = {};
  for (const s of scans) {
    const t = s.json?.evaluation?.trace;
    if (!t) continue;
    for (const [k, v] of Object.entries(t.msByLayer || {})) { layerMs[k] = (layerMs[k] || 0) + v; layerN[k] = (layerN[k] || 0) + 1; }
    for (const call of t.calls || []) {
      if (typeof call.thinkingApprox === "number") thinking.push(call.thinkingApprox);
      const key = `${call.model}@${call.effort}:${call.layer}`;
      perModel[key] = perModel[key] || { n: 0, ms: 0, think: 0, usd: 0 };
      perModel[key].n++; perModel[key].ms += call.ms; perModel[key].think += call.thinkingApprox || 0; perModel[key].usd += call.costUsd || 0;
    }
  }
  const totalMs = scans.map(s => s.json?.evaluation?.trace?.totalMs).filter(Boolean).sort((a, b) => a - b);
  const pct = (p) => totalMs.length ? totalMs[Math.min(totalMs.length - 1, Math.floor(p * totalMs.length))] : null;
  report.push(`Engine time per scan: median ${pct(0.5)} ms, p90 ${pct(0.9)} ms, max ${totalMs[totalMs.length - 1] ?? null} ms.`);
  report.push(`Thinking tokens per call (approx.): mean ${thinking.length ? Math.round(thinking.reduce((a, b) => a + b, 0) / thinking.length) : "n/a"}, median ${thinking.length ? thinking.sort((a, b) => a - b)[Math.floor(thinking.length / 2)] : "n/a"}, over ${thinking.length} calls.`, "");
  report.push("| layer | total ms | scans | mean ms |", "|---|---|---|---|");
  for (const [k, v] of Object.entries(layerMs).sort()) report.push(`| ${k} | ${v} | ${layerN[k]} | ${Math.round(v / layerN[k])} |`);
  report.push("", "| model@effort:layer | calls | mean ms | mean thinking | $ total |", "|---|---|---|---|---|");
  for (const [k, v] of Object.entries(perModel).sort()) report.push(`| ${k} | ${v.n} | ${Math.round(v.ms / v.n)} | ${Math.round(v.think / v.n)} | ${v.usd.toFixed(4)} |`);
  report.push("");
}

// ── replay ───────────────────────────────────────────────────────────────
// What the engine would show from one model's verdicts, by the engine's own
// rule (settleVerdict): the cheapest "exact", else the best-ranked "likely";
// "similar" is a lookalike and never identifies anything.
function pickFrom(candidates, verdicts) {
  const judged = candidates.map((c, i) => ({ c, v: verdicts[i]?.match || "different" }));
  const tier = (m) => judged.filter(j => j.v === m);
  const exact = tier("exact");
  if (exact.length) {
    const priced = exact.filter(j => j.c.price > 0);
    const best = priced.length ? priced.reduce((a, b) => (b.c.price < a.c.price ? b : a)) : exact[0];
    return { confidence: "exact", candidate: best.c };
  }
  const likely = tier("likely");
  if (likely.length) return { confidence: "likely", candidate: likely.find(j => j.c.price > 0)?.c || likely[0].c };
  return { confidence: "none", candidate: null };
}

function judgePick(c, pick) {
  if (pick.confidence === "none") return c.findable === true ? "miss" : "honest";
  if (c.findable === false) return "WRONG";
  return identityMatches(c, `${pick.candidate.title} ${pick.candidate.link}`) ? "hit" : "WRONG";
}

// Pages on the hosts in scripts/lib/labels.mjs (isListing) never reach the
// gate, so replays do not send them either.

/** The identification candidates a case's gate saw, from this run or an earlier one. */
function identifyBatches(caseId) {
  const fromScans = (list) => {
    const scan = (list || []).find(x => x.caseId === caseId && x.json?.evaluation?.trace);
    const steps = scan?.json?.evaluation?.trace?.steps || [];
    return steps.filter(st => st.step === "gate" && (st.purpose || "identify") === "identify").map(st => st.candidates || []);
  };
  let batches = fromScans(scans);
  // Earlier runs, latest first: the most recent engine's candidates win.
  for (const prior of earlier) if (batches.length === 0) batches = fromScans(prior.scans);
  // Re-batched after the listing filter, eight to a call as the engine does.
  const flat = batches.flat().filter(c => isListing(c.link));
  const out = [];
  for (let i = 0; i < flat.length; i += 8) out.push(flat.slice(i, i + 8));
  return out;
}
const earlier = [].concat(run.replayFrom || [])
  .filter(f => existsSync(resolve(RESULTS, f)))
  .map(f => JSON.parse(readFileSync(resolve(RESULTS, f), "utf8")));

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function replayStep() {
  if (stopAll) { report.push("## Model replays\n\nSkipped: see Scans.\n"); return; }
  if (Array.isArray(run.replay?.sets)) return storedReplayStep();
  const gateConfigs = run.replay?.gate || [];
  const extractConfigs = run.replay?.extract || [];
  const parse = (cfg) => { const [model, effort] = cfg.split("@"); return { model, effort: effort || null, key: cfg }; };
  const jobs = [];
  for (const c of CASES) {
    const photo = photos.get(c.id);
    if (!photo) continue;
    const batches = identifyBatches(c.id);
    for (const cfg of gateConfigs.map(parse)) {
      batches.forEach((batch, b) => jobs.push({ op: "gate", c, photo, cfg, batch, b }));
    }
    for (const cfg of extractConfigs.map(parse)) jobs.push({ op: "extract", c, photo, cfg });
  }
  log(`replay: ${jobs.length} calls`);
  const outcomes = await pool(jobs, 3, async (job) => {
    if (!canSpend(0.12)) return { ...job, skipped: true };
    const body = {
      op: job.op, model: job.cfg.model, effort: job.cfg.effort,
      image: { data: job.photo.data.toString("base64"), mimeType: job.photo.mimeType },
      ...(job.op === "gate" ? { candidates: job.batch.map(x => ({ image: x.image, title: x.title, source: x.source })) } : {}),
    };
    const res = await operator("/api/eval", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, 90_000);
    spend.claudeUsd += Number(res.json?.call?.costUsd) || 0;
    return { ...job, res };
  });
  // Gate: per config, rebuild what each case would have shown from its batches.
  const gate = {};
  for (const cfg of gateConfigs) {
    const rows = [];
    for (const c of CASES) {
      const mine = outcomes.filter(o => o.op === "gate" && o.cfg.key === cfg && o.c.id === c.id);
      if (mine.length === 0) continue;
      const candidates = mine.flatMap(o => o.batch);
      const verdicts = mine.flatMap(o => (o.res?.json?.verdicts || o.batch.map(() => ({ match: "different" }))));
      const failed = mine.some(o => !o.res || o.res.status !== 200 || o.res.json?.ok === false);
      const pick = pickFrom(candidates, verdicts);
      const reachable = c.findable === true && candidates.some(x => identityMatches(c, `${x.title} ${x.link}`));
      rows.push({
        caseId: c.id, findable: c.findable, reachable, failed, confidence: pick.confidence, outcome: failed ? "error" : judgePick(c, pick),
        shown: pick.candidate ? `${pick.candidate.title} | ${pick.candidate.link}` : "",
        usd: mine.reduce((sum, o) => sum + (Number(o.res?.json?.call?.costUsd) || 0), 0),
        ms: mine.reduce((sum, o) => sum + (Number(o.res?.json?.call?.ms) || 0), 0),
        thinking: mine.map(o => o.res?.json?.call?.thinkingApprox).filter(n => typeof n === "number"),
        verdicts: verdicts.map(v => v.match), errors: mine.filter(o => o.res?.json?.ok === false || o.res?.status !== 200).map(o => `${o.res?.status} ${o.res?.json?.kind || o.res?.json?.error || ""} ${String(o.res?.json?.detail || "").slice(0, 120)}`),
      });
    }
    gate[cfg] = rows;
  }
  // Extraction: brand, and on screenshots the price and its currency.
  const extract = {};
  for (const cfg of extractConfigs) {
    extract[cfg] = outcomes.filter(o => o.op === "extract" && o.cfg.key === cfg).map(o => {
      const read = o.res?.json?.read || null;
      const asking = photos.get(o.c.id)?.meta?.askingPrice;
      const brandOk = !o.c.brand ? !(read?.brand) || true : String(read?.brand || "").toLowerCase().includes(o.c.brand.toLowerCase().split(/[\s-]/)[0]);
      const priceOk = asking ? Math.abs((read?.visiblePrice || 0) - asking.amount) < 0.011 && read?.currency === (o.c.expectCurrency || asking.currency) : null;
      return {
        caseId: o.c.id, ok: !!read, brand: read?.brand || "", productName: read?.productName || "", visiblePrice: read?.visiblePrice ?? null,
        currency: read?.currency || "", brandOk, priceOk, usd: Number(o.res?.json?.call?.costUsd) || 0, ms: Number(o.res?.json?.call?.ms) || 0,
        thinking: o.res?.json?.call?.thinkingApprox ?? null, error: read ? "" : `${o.res?.status} ${o.res?.json?.kind || o.res?.json?.error || ""}`,
      };
    });
  }
  results.replay = { gate, extract };
  replayReport(gate, extract);
}

// ── replay of stored candidates through the shipped gate and guards ───────
// run.replay = { model: "claude-sonnet-5-5@low", capUsd: 0.30,
//   sets: [{ run: 5, caseId: "flowlife-flowgun-air", intent: "finder", purposes: ["identify"] }, ...] }
// Each set is the candidates one stored scan's gate saw (its trace), for the
// purposes named (identify by default). Within a case they are deduplicated by
// link across sets, pages on non-listing hosts are dropped (the engine never
// sends them), and they go eight to a call to the shipped gate with the
// case's stored first read, so every verdict comes back after the match guards exactly as a scan
// would act on it. No search is repeated. A call is started only if even an
// expensive one (the dearest so far times 1.5, at least 3 cents) cannot cross
// capUsd. scripts/check-match-guards.mjs then judges the answers.
async function storedReplayStep() {
  const cfg = run.replay;
  const [model, effort] = String(cfg.model || "claude-sonnet-5-5@low").split("@");
  const cap = Number(cfg.capUsd) || 0.30;
  // Per case: the candidates of every set naming it, deduplicated, with the
  // first set's read (the same photo, so the same read), eight to a call.
  const byCase = new Map(); // case id -> { read, photo, links, queue }
  for (const set of cfg.sets) {
    const file = resolve(RESULTS, `run-${set.run}.json`);
    if (!existsSync(file)) { log(`replay: no run-${set.run}.json`); continue; }
    const stored = JSON.parse(readFileSync(file, "utf8"));
    const scan = (stored.scans || []).find(x => x.caseId === set.caseId && (!set.intent || x.intent === set.intent));
    const steps = scan?.json?.evaluation?.trace?.steps || [];
    const ext = steps.find(x => x.step === "extraction");
    const photo = photos.get(set.caseId);
    if (!ext || !photo) { log(`replay: ${set.caseId} from run ${set.run}: ${ext ? "no photo" : "no stored read"}`); continue; }
    if (!byCase.has(set.caseId)) {
      byCase.set(set.caseId, { read: { brand: ext.brand || "", productName: ext.productName || "" }, photo, links: new Set(), queue: [] });
    }
    const entry = byCase.get(set.caseId);
    const purposes = set.purposes || ["identify"];
    for (const g of steps.filter(x => x.step === "gate" && purposes.includes(x.purpose || "identify"))) {
      for (const k of g.candidates || []) {
        const key = k.link || k.image;
        if (!isListing(k.link) || entry.links.has(key)) continue;
        entry.links.add(key);
        entry.queue.push({ ...k, purpose: g.purpose || "identify", from: set.run, intent: set.intent || "" });
      }
    }
  }
  const jobs = [];
  for (const [caseId, entry] of byCase) {
    for (let i = 0; i < entry.queue.length; i += 8) jobs.push({ caseId, read: entry.read, photo: entry.photo, batch: entry.queue.slice(i, i + 8) });
  }
  log(`replay: ${jobs.length} gate call(s) on ${model}@${effort}`);
  const answers = [];
  let spent = 0, dearest = 0, stopped = "";
  for (const job of jobs) {
    const next = Math.max(0.03, dearest * 1.5);
    if (spent + next > cap) { stopped = `the replay cap of $${cap.toFixed(2)} could be crossed by the next call ($${spent.toFixed(4)} spent)`; break; }
    if (!canSpend(next)) { stopped = "the spend cap for this run was reached"; break; }
    const body = {
      op: "gate", model, effort,
      image: { data: job.photo.data.toString("base64"), mimeType: job.photo.mimeType },
      candidates: job.batch.map(x => ({ image: x.image, title: x.title, source: x.source, link: x.link })),
      read: job.read,
    };
    const res = await operator("/api/eval", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, 90_000);
    const usd = Number(res.json?.call?.costUsd) || 0;
    spend.claudeUsd += usd;
    spent += usd;
    dearest = Math.max(dearest, usd);
    const verdicts = res.json?.verdicts || [];
    // The build before the match guards answers without a tie: every later
    // call would measure the old gate, so the replay stops here.
    if (res.status === 200 && verdicts.length > 0 && !verdicts.some(v => "tie" in v)) {
      stopped = "production answered without a tie, so it is not yet running the guarded gate; push run.json again once the deploy is live";
      break;
    }
    job.batch.forEach((k, i) => {
      const v = verdicts[i] || {};
      answers.push({
        caseId: job.caseId, intent: k.intent, purpose: k.purpose, from: k.from, read: job.read,
        title: k.title, source: k.source, link: k.link, price: k.price || 0,
        gate: v.gateMatch || v.match || "unjudged", match: v.match || "unjudged", guard: v.guard || null, tie: v.tie ?? null,
        why: String(v.reasoning || "").slice(0, 200), status: res.status, ok: res.json?.ok ?? false, loaded: res.json?.loaded ?? null,
      });
    });
    await sleep(1000);
  }
  results.replay = { model: `${model}@${effort}`, capUsd: cap, spentUsd: +spent.toFixed(6), stopped: stopped || null, answers };
  storedReplayReport(results.replay);
}

function storedReplayReport(replay) {
  report.push("## Replay of stored candidates on the shipped gate and guards\n");
  if (replay.stopped) report.push(`Stopped early: ${replay.stopped}.\n`);
  report.push(`${replay.answers.length} candidate(s) judged by ${replay.model}; Claude $${replay.spentUsd.toFixed(4)} of the $${replay.capUsd.toFixed(2)} cap.\n`);
  report.push("| case | from run | purpose | listing | label | gate | tie | guard | now | why |", "|---|---|---|---|---|---|---|---|---|---|");
  const tally = { wrongHeld: 0, wrongShown: 0, rightKept: 0, rightHeld: 0 };
  for (const a of replay.answers) {
    const c = casesFile.cases.find(x => x.id === a.caseId);
    const right = c?.findable === true && identityMatches(c, `${a.title} ${a.link}`);
    const claimed = a.gate === "exact" || a.gate === "likely";
    const shown = a.match === "exact" || a.match === "likely";
    if (claimed && !right) tally[shown ? "wrongShown" : "wrongHeld"]++;
    if (claimed && right) tally[shown ? "rightKept" : "rightHeld"]++;
    if (!claimed && !shown) continue;
    report.push(`| ${a.caseId} | ${a.from} | ${a.purpose} | ${escapeMd(a.title || "").slice(0, 60)} | ${right ? "right" : "**wrong**"} | ${a.gate} | ${a.tie ?? ""} | ${a.guard || ""} | ${a.match} | ${escapeMd(a.why).slice(0, 90)} |`);
  }
  report.push("", `Wrong products the gate called exact or likely: ${tally.wrongHeld + tally.wrongShown}, held by the guards ${tally.wrongHeld}, **still shown ${tally.wrongShown}**. Right products kept ${tally.rightKept}, held ${tally.rightHeld}.`, "");
}

function replayReport(gate, extract) {
  report.push("## Model replays: the gate\n", "Each model judged the same candidates the production gate saw for each case (identification waves of the verdict scan). \"WRONG\" means it would have shown a wrong product as a match.\n");
  report.push("| model@effort | WRONG shown | hits | misses (reachable) | honest on unfindable | errors | $ total | mean ms/case | mean thinking/call |", "|---|---|---|---|---|---|---|---|---|");
  for (const [cfg, rows] of Object.entries(gate)) {
    const n = (f) => rows.filter(f).length;
    const think = rows.flatMap(r => r.thinking);
    report.push(`| ${cfg} | ${n(r => r.outcome === "WRONG")} | ${n(r => r.outcome === "hit")} | ${n(r => r.outcome === "miss" && r.reachable)} of ${n(r => r.reachable)} reachable | ${n(r => !r.findable && r.outcome === "honest")} of ${n(r => !r.findable)} | ${n(r => r.outcome === "error")} | ${rows.reduce((s, r) => s + r.usd, 0).toFixed(4)} | ${Math.round(rows.reduce((s, r) => s + r.ms, 0) / Math.max(1, rows.length))} | ${think.length ? Math.round(think.reduce((a, b) => a + b, 0) / think.length) : "n/a"} |`);
  }
  // Candidate by candidate, against the first configuration (the production
  // gate): where each model claims identity (exact or likely) that the
  // reference does not, and the reverse.
  const configs = Object.keys(gate);
  if (configs.length > 1) {
    const ref = gate[configs[0]];
    const claims = (v) => v === "exact" || v === "likely";
    report.push("", `Candidate-level agreement with ${configs[0]}:`, "", "| model@effort | candidates | same answer | claims identity where reference does not | reference claims, this one does not |", "|---|---|---|---|---|");
    for (const cfg of configs.slice(1)) {
      let n = 0, same = 0, more = 0, fewer = 0;
      for (const row of gate[cfg]) {
        const r = ref.find(x => x.caseId === row.caseId);
        if (!r) continue;
        row.verdicts.forEach((v, i) => {
          if (r.verdicts[i] === undefined) return;
          n++;
          if (v === r.verdicts[i]) same++;
          if (claims(v) && !claims(r.verdicts[i])) more++;
          if (!claims(v) && claims(r.verdicts[i])) fewer++;
        });
      }
      report.push(`| ${cfg} | ${n} | ${same} | ${more} | ${fewer} |`);
    }
  }
  report.push("", "Per case (outcome / confidence):", "", `| case | ${Object.keys(gate).join(" | ")} |`, `|---|${Object.keys(gate).map(() => "---").join("|")}|`);
  for (const c of CASES) {
    const cells = Object.values(gate).map(rows => { const r = rows.find(x => x.caseId === c.id); return r ? `${r.outcome}/${r.confidence}${r.outcome === "WRONG" ? `: ${escapeMd(r.shown).slice(0, 50)}` : ""}` : ""; });
    report.push(`| ${c.id} | ${cells.join(" | ")} |`);
  }
  report.push("", "## Model replays: extraction\n", "| model@effort | reads | brand right | screenshot price+currency right | $ total | mean ms | mean thinking |", "|---|---|---|---|---|---|---|");
  for (const [cfg, rows] of Object.entries(extract)) {
    const priced = rows.filter(r => r.priceOk !== null);
    const think = rows.map(r => r.thinking).filter(n => typeof n === "number");
    report.push(`| ${cfg} | ${rows.filter(r => r.ok).length}/${rows.length} | ${rows.filter(r => r.brandOk).length}/${rows.length} | ${priced.filter(r => r.priceOk).length}/${priced.length} | ${rows.reduce((s, r) => s + r.usd, 0).toFixed(4)} | ${Math.round(rows.reduce((s, r) => s + r.ms, 0) / Math.max(1, rows.length))} | ${think.length ? Math.round(think.reduce((a, b) => a + b, 0) / think.length) : "n/a"} |`);
  }
  report.push("");
}

// ── purge ────────────────────────────────────────────────────────────────
// What earlier evaluation runs wrote to public data, from their own raw
// responses: every completed scan added one to the lifetime counter; every
// uncached VERDICT added one to the verdict total (and to the busted total
// when HIGH_MARKUP) and its savings to the "exposed" total; every scanId is a
// ledger record. The same rules countCompletedScan applies to a visitor.
function evaluationFootprint() {
  const files = readdirSync(RESULTS).filter(f => /^run-\d+\.json$/.test(f) && f !== `run-${run.run}.json`).sort();
  const scanIds = [];
  const counters = { scans: 0, verdicts: 0, busted: 0, savingsUsd: 0 };
  for (const f of files) {
    const r = JSON.parse(readFileSync(resolve(RESULTS, f), "utf8"));
    for (const s of r.scans || []) {
      if (s.status !== 200 || !s.json) continue;
      counters.scans++;
      const j = s.json;
      if (!j.evaluation?.cached && j.mode === "VERDICT") {
        counters.verdicts++;
        if (j.analysis?.verdict === "HIGH_MARKUP") counters.busted++;
        if (j.analysis?.savings > 0) counters.savingsUsd += j.analysis.savings;
      }
      if (j.scanId) scanIds.push(j.scanId);
    }
  }
  counters.savingsUsd = Math.round(counters.savingsUsd * 100) / 100;
  return { files, scanIds, counters };
}

async function purgeStep() {
  report.push("## Purge of earlier evaluation data\n");
  if (run.expectCommit && !String(run.expectCommit).startsWith(results.deployedCommit || "-")) {
    report.push(`Stopped: production is running \`${results.deployedCommit}\`, not \`${run.expectCommit}\`, which has the purge route.\n`);
    return;
  }
  const footprint = evaluationFootprint();
  const purgeId = run.purgeId || `eval-runs-before-${run.run}`;
  report.push(`From ${footprint.files.join(", ")}: ${footprint.scanIds.length} ledger record(s) (${footprint.scanIds.join(", ") || "none"}); counters ${JSON.stringify(footprint.counters)}. Purge id \`${purgeId}\`.`);
  const r = await operator("/api/eval/purge", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ purgeId, scanIds: footprint.scanIds, counters: footprint.counters }),
  }, 60_000);
  results.steps.purge = { request: { purgeId, ...footprint }, status: r.status, json: r.json, text: r.text };
  if (r.status !== 200) {
    report.push(`The purge answered HTTP ${r.status}: ${r.text || JSON.stringify(r.json)}\n`);
    return;
  }
  const out = r.json?.result || {};
  report.push(r.json?.alreadyApplied ? "Already applied by an earlier run; nothing changed now." : "Applied.");
  report.push(`Removed ${(out.removed || []).length} ledger record(s): ${(out.removed || []).map(x => `${x.id} "${x.title}" (${x.verdict})`).join("; ") || "none"}. Not found: ${(out.notFound || []).join(", ") || "none"}.`);
  report.push(`Counters before and after: ${JSON.stringify(out.counters || {})}.\n`);
}

// ── link scans ───────────────────────────────────────────────────────────
// run.links = [{ id, url, intent, kind }]: each page scanned through the real
// production link path as an evaluation scan, under run.linkCapUsd all-in
// (the same rule as the scan step: a scan is started only if even an
// expensive one cannot cross it). Beside each result, what the page itself
// shows, read here on the runner (title, stated brand, price and currency
// from its own structured data), so the match can be judged against it.
async function pageFacts(url) {
  try {
    const res = await get(url, { accept: "text/html" });
    const html = await res.text();
    const meta = (key) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1] || "";
    let ld = {};
    for (const block of html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []) {
      try {
        const parsed = JSON.parse(block.replace(/^<script[^>]*>|<\/script>$/gi, "").trim());
        const nodes = Array.isArray(parsed) ? parsed : (parsed["@graph"] || [parsed]);
        const product = nodes.find(n => n?.["@type"] === "Product" || (Array.isArray(n?.["@type"]) && n["@type"].includes("Product")));
        if (product) { ld = product; break; }
      } catch { /* not JSON */ }
    }
    const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
    const brand = typeof ld.brand === "string" ? ld.brand : ld.brand?.name || meta("product:brand") || "";
    const currency = offer?.priceCurrency || meta("product:price:currency") || "";
    return {
      read: true, title: (ld.name || meta("og:title") || (html.match(/<title>([^<]*)<\/title>/i)?.[1] || "")).trim().slice(0, 160),
      brand, price: parsePrice(offer?.price ?? meta("product:price:amount"), currency).amount, currency,
    };
  } catch (err) {
    return { read: false, error: String(err?.message || err).slice(0, 160) };
  }
}

async function linksStep() {
  const links = Array.isArray(run.links) ? run.links : [];
  const cap = Number(run.linkCapUsd) || 0.2;
  let spent = 0, dearest = 0, stopped = "";
  const out = [];
  for (const link of links) {
    const next = Math.max(0.08, dearest * 1.5);
    if (spent + next > cap) { stopped = `the link cap of $${cap.toFixed(2)} could be crossed by the next scan ($${spent.toFixed(4)} spent)`; break; }
    if (!canSpend(next)) { stopped = "the spend cap for this run was reached"; break; }
    log(`link ${link.id}`);
    const page = await pageFacts(link.url);
    const res = await operator("/api/scan", {
      method: "POST", body: JSON.stringify({ url: link.url, intent: link.intent || "verdict" }),
      headers: { "content-type": "application/json", "x-bustedlab-eval": "1" },
    }, 160_000);
    const trace = res.json?.evaluation?.trace;
    const cost = scanCost(trace);
    spend.claudeUsd += cost.claude;
    spend.serpapiSearches += cost.serpapi;
    spend.serperCredits += cost.serperCredits;
    spent += cost.usd;
    dearest = Math.max(dearest, cost.usd);
    const identified = (trace?.steps || []).filter(x => x.step === "settled").pop();
    out.push({ ...link, page, status: res.status, ms: res.ms, json: res.json, text: res.text || undefined, matched: identified ? { title: identified.title, source: identified.source, confidence: identified.confidence } : null, costUsd: +cost.usd.toFixed(6), claudeUsd: cost.claude });
    await sleep(3000);
  }
  results.links = out;
  report.push("## Link scans\n");
  if (stopped) report.push(`Stopped early: ${stopped}.\n`);
  report.push(`Link scan spend, all-in: $${spent.toFixed(4)} of its $${cap.toFixed(2)} cap.\n`);
  report.push("| link | kind | the page shows | mode | confidence | matched listing | source price | verdict | escalation | $ Claude | $ all-in | ms |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const l of out) {
    const r = l.json || {};
    const t = r.evaluation?.trace || {};
    const shows = l.page.read ? `${escapeMd(l.page.title).slice(0, 60)} (brand ${escapeMd(l.page.brand || "none stated")}, ${l.page.price ?? "no price"} ${l.page.currency || ""})` : `could not read: ${escapeMd(l.page.error)}`;
    report.push(`| ${l.id} | ${l.kind || ""} | ${shows} | ${r.mode || r.error || l.status} | ${r.matchConfidence || ""} | ${escapeMd(l.matched?.title || "").slice(0, 60)}${l.matched?.source ? ` @${escapeMd(l.matched.source)}` : ""} | ${r.sourceProduct?.price ? `$${r.sourceProduct.price}` : ""} | ${r.analysis?.verdict || ""} | ${escalationOf(t)} | ${(l.claudeUsd || 0).toFixed(4)} | ${l.costUsd.toFixed(4)} | ${l.ms ?? ""} |`);
  }
  report.push("");
}

const STEPS = { preflight, diagnose, photos: photosStep, scan: scanStep, links: linksStep, replay: replayStep, purge: purgeStep };

// ── main ─────────────────────────────────────────────────────────────────
if (!TOKEN) {
  console.error("ANALYTICS_TOKEN is not set for this job");
  process.exit(1);
}
log(`run ${run.run}: steps ${run.steps.join(", ")}; spent before $${spentBefore.toFixed(4)}; this run may spend $${runCap.toFixed(2)}`);
// run.waitFor: a free, operator-only request that answers a known status only
// once the build this run is for is serving (a route it adds, say), polled
// every 20 seconds for up to maxMinutes before any step runs. Nothing in it
// spends money; it keeps a run from paying for a diagnose of the old build.
if (run.waitFor?.path) {
  const { method = "POST", path, status = 400, maxMinutes = 10, body = "{}" } = run.waitFor;
  const deadline = Date.now() + maxMinutes * 60_000;
  let last = 0;
  for (;;) {
    const r = await operator(path, method === "GET" ? {} : { method, body, headers: { "content-type": "application/json" } }, 20_000);
    last = r.status;
    if (r.status === status) { log(`build ready: ${method} ${path} answered ${status}`); break; }
    if (Date.now() > deadline) { log(`build not ready after ${maxMinutes} min: ${method} ${path} still answers ${last}`); break; }
    await sleep(20_000);
  }
  results.waitedFor = { path, wanted: status, got: last };
}
for (const name of run.steps || []) {
  const step = STEPS[name];
  if (!step) { report.push(`Unknown step "${name}"; skipped.`); continue; }
  log(`step ${name}`);
  try {
    await step();
  } catch (err) {
    report.push(`## ${name}\n\nThe step threw: ${String(err?.stack || err)}\n`);
  }
}

results.finishedAt = new Date().toISOString();
results.spend = { ...spend, searchUsd: searchUsd(), totalUsd: runUsd(), spentBeforeUsd: spentBefore, capUsd: SPEND_CAP_USD };
ledger.runs = ledger.runs.filter(r => r.run !== run.run);
ledger.runs.push({ run: run.run, at: results.finishedAt, claudeUsd: +spend.claudeUsd.toFixed(4), searchUsd: +searchUsd().toFixed(4), totalUsd: +runUsd().toFixed(4) });
ledger.totalUsd = +ledger.runs.reduce((sum, r) => sum + r.totalUsd, 0).toFixed(4);

const header = [
  `# Production eval, run ${run.run}`,
  "",
  `${BASE}, ${results.startedAt} to ${results.finishedAt}. ${run.note || ""}`,
  "",
  `Spend this run: $${runUsd().toFixed(4)} (Claude $${spend.claudeUsd.toFixed(4)}, search $${searchUsd().toFixed(4)}). All runs: $${ledger.totalUsd.toFixed(4)} of the $${SPEND_CAP_USD} cap.`,
  "",
];
const markdown = redact([...header, ...report].join("\n"));
writeFileSync(resolve(RESULTS, `run-${run.run}.json`), redact(JSON.stringify(results, null, 2)) + "\n");
writeFileSync(resolve(RESULTS, `run-${run.run}.md`), markdown + "\n");
writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
log(markdown);
