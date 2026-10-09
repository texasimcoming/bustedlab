/**
 * BustedLab Scan Engine v10 - identify first, price second. Lens-first,
 * verified against the real photo, price/link always from the same record,
 * and honest about locality without sacrificing search depth for it.
 *
 * v10 — IDENTIFICATION IS NEVER SUBORDINATED TO PRICE. This is the
 * accuracy rewrite, and it is worth stating plainly what was wrong,
 * because the failure was not one bug but one mistaken idea repeated in
 * five places: that a candidate's price is a reasonable thing to rank and
 * filter by BEFORE anyone has established what the candidate is.
 *
 *   1. Both Lens readers deleted every visual match that carried no price,
 *      as their first operation. Lens returns visual matches whether or
 *      not Google parsed a price from them, and the single most visually
 *      identical result very often has none (a brand's own product page,
 *      an editorial piece, a marketplace listing with the price behind a
 *      script). Those were thrown away before anything looked at them.
 *   2. Every candidate producer then sorted what survived cheapest-first,
 *      which destroyed Lens's best-match-first ordering — the one
 *      identification signal in the whole response.
 *   3. The verification gate checked the first five candidates, which
 *      after (2) meant the five CHEAPEST, never the five most similar.
 *   4. When none of those five matched, the gate returned candidates[0] —
 *      the cheapest arbitrary row in the list — as the "closest match".
 *   5. The rebrand and direct-retailer layers replaced the chosen product
 *      on price alone, so a cheaper "maybe" could evict a confirmed match.
 *
 * Together those produced exactly the reported failures: a photo of Ralph
 * Lauren eyeglasses answered with an unrelated brand (correct match
 * unpriced, deleted at step 1; nothing else matched; step 4 returned the
 * cheapest row), and a photo of one Under Armour bag answered with a
 * different, cheaper Under Armour bag (correct match priced but not
 * cheapest, buried by step 2, outside the window at step 3).
 *
 * What replaces it, which is the same two-step Google itself runs:
 *   - Every visual match with an image is kept, in the engine's own order.
 *     A missing image disqualifies a candidate (the gate has nothing to
 *     compare); a missing price never does.
 *   - Candidates are reordered only by identity evidence — engine rank,
 *     plus a boost for carrying the brand the vision pass read off the
 *     photo — and that reordering can never remove a candidate.
 *   - The gate checks a wide window in two waves, the second spent only
 *     when the first confirmed nothing, so a correct match sitting at rank
 *     seven is reachable.
 *   - Within the best confidence tier it found, the CHEAPEST record wins.
 *     Identity first, price second. That single rule serves "am I being
 *     overcharged?" and "where is it cheapest?" identically, which is why
 *     there is no longer any asymmetry between the two intents: both need
 *     the real floor price for the object in the photo, and neither is
 *     served by a cheap price for a different object.
 *   - A confirmed product with no price of its own is then PRICED by a
 *     second search against its now-accurate name, whose results go back
 *     through the same visual gate before any of their prices are
 *     believed.
 *   - Nothing verified at all still returns the engine's best-ranked
 *     candidate, labeled unverified, never the cheapest arbitrary one.
 *   - A challenger from a later layer only displaces the chosen product if
 *     it is at least as well identified (shouldReplace).
 *   - If a confirmed product has no price anywhere, the scan resolves to
 *     UNRESOLVED rather than hanging a category-average estimate off a
 *     real merchant link.
 *
 * v9.1 — locality is a DISCLOSURE, not a search filter. Every Serper/SerpApi
 * shopping, Lens, organic-search, and merchant-link-resolution call is
 * hardcoded to the US index (`gl: "us"`) regardless of where the requester
 * is. The US Shopping/Lens index is by far the deepest and is where the
 * real wholesale floor price for dropshipped products (AliExpress/Temu/
 * Wish-style cross-border listings) reliably surfaces — restricting search
 * to the requester's own country doesn't make the verdict more accurate,
 * it just degrades result depth for anyone outside a handful of major
 * markets, which is the opposite of what a global, price-conscious
 * audience needs. The markup exposed is real regardless of which country's
 * index found the floor price.
 * The requester's country is still accepted as an optional parameter on
 * scanProduct()/scanProductUrl(), but it now does exactly one thing: builds
 * an honest `shippingNote` disclosure ("Ships internationally — check
 * delivery time to your region") on the result when the requester isn't in
 * the US, rather than silently filtering what gets found. Amounts are
 * compared and shown in USD, the listings' currency: an asking price read in
 * any other currency is converted at a cached daily rate first (fx.ts), and
 * the card shows the original beside it. Comparing the raw numbers, which
 * is what happened before, made every non-dollar verdict wrong.
 *
 * Image-upload pipeline:
 * Layer 1: Claude Sonnet 5.5 vision → product identity, visible price, visible
 *          store/seller handle, and any URL literally visible in the shot
 *          (escalates to Claude Opus 5.5 when the read fails or is weak)
 * Layer 2: Reverse image search (Google Lens via SerpApi, primary) → exact-pixel candidates
 * Layer 3: Reverse image search (Google Lens via Serper, backup)
 * Layer 3.5: Product-page discovery — if a store name/handle or a visible
 *          URL was captured, find and READ the actual product page (same
 *          JSON-LD/meta/description extraction a pasted URL gets) before
 *          falling back to a keyword guess.
 * Layer 4: Store-name-targeted Shopping text search (Serper → SerpApi) —
 *          fallback if discovery above found nothing usable
 * Layer 5: Generic brand/product Shopping text search (Serper → SerpApi)
 * Layer 6: Visual verification gate — every non-Lens candidate gets checked
 *          against a real reference image before it's allowed to drive a
 *          confident verdict.
 * Layer 7: Category-average estimate — last resort, always labeled as an
 *          estimate, never rendered as a confident BUSTED verdict.
 *
 * URL pipeline:
 * 1. Fetch the real page HTML.
 * 2. Extract real price/title/image/description from JSON-LD, microdata,
 *    and Open Graph meta tags (AggregateOffer ranges deliberately NOT
 *    treated as a single price). Claude TEXT fallback only when structured
 *    data is absent.
 * 3. Full page content builds one highly specific search query via Claude.
 * 4. A real product photo runs through the same Lens + verification gate
 *    the image-upload flow uses.
 * 5. A multi-tier query fallback (enriched → title → top words) means a
 *    valid, readable product page should essentially always produce at
 *    least a FINDER result.
 *
 * Price/link consistency: once a candidate is chosen (Lens matching or
 * visual verification), EVERY downstream field — price, image, url, title
 * — comes from that exact same candidate record via applyVerifiedCandidate().
 * No separate price recalculation can pull a number from a different
 * listing than the one that gets linked.
 *
 * Shopping links: SerpApi/Serper shopping results sometimes link to a
 * Google search/product page rather than the actual merchant. Every final
 * result link is checked and, where possible, resolved to a real merchant
 * URL before it's shown as "view listing" — never a Google redirect.
 *
 * Shopping search relevance: results are filtered so a candidate's title
 * must share the query's actual distinguishing words (not just an
 * overlapping generic category term) — this is what stops a "jade roller"
 * search from accepting a "needle roller" result.
 *
 * Cost per scan. The gate keeps the strongest model - a confident wrong
 * identification is the one failure this product cannot survive, and a
 * cheap one that goes viral is the worst version of it. What makes that
 * affordable is not a weaker model, it is four structural things, all
 * priced in scripts/cost-model.mjs from the published rates:
 *
 *   - The gate compares a whole batch of candidates in ONE call rather than
 *     one call per candidate. Verification input is image-dominated and the
 *     photo is the dominant image, so it is sent once per call, and with
 *     thinking always on, every call saved is also a thinking pass saved.
 *     The rebrand and retailer pools share one call for the same reason.
 *   - The photo is a cached prompt prefix (both models cache from 512
 *     tokens), so later waves and later passes read it at a fraction of the
 *     price: 0.05x of the input rate on Opus 5.5, 0.1x on Sonnet 5.5.
 *   - The photo is capped at 1568px on its long edge before any model sees
 *     it. The 5.5 models read images up to 2576px, which would bill a phone
 *     screenshot at roughly two and a half times the tokens for no gain in
 *     telling two products apart.
 *   - An identification is published for the next person to scan the same
 *     product, so a viral spike pays for identification once rather than
 *     ten thousand times. See reuseIdentification().
 *
 * Model spend per scan is in `npm run cost-model`, priced from the 5.5
 * models' published rates with thinking always on. Thinking is billed as
 * output and is the largest single term, which is why effort is set to low
 * and why the number of gate calls per scan is kept as small as it is.
 * Search calls (Lens, Shopping, retailer, link resolution) are priced there
 * too; all but the Lens search are skipped on a reused identification.
 *
 * Spend is measured from the usage the API reports, counted against a daily
 * budget, and when that budget is gone the engine degrades instead of either
 * failing or spending without a ceiling: cheap gate, cache-first, the
 * enhancement layers dropped, and the gate's strongest label withheld (it
 * can no longer return "exact", so no card can say EXACT MATCH on
 * a cheap judgement). A reused identification keeps full confidence even
 * then, because the strong model made it. See model-budget.ts.
 */

import { put, del } from "@vercel/blob";
import { randomBytes } from "crypto";
import { LENS_BLOB_PREFIX } from "@/lib/constants";
// Classification lives in its own dependency-free module so the landing page
// can publish the same thresholds the engine applies, and so the calibration
// check can execute the real function rather than a copy of it.
import { calculateVerdict } from "@/lib/verdict";
// The gate's prompt and answer parsing live in their own dependency-free
// module so scripts/eval-gate.mjs can measure the REAL prompt against real
// photographs rather than a copy of it.
import { buildBatchPrompt, coerceVerdict, salvageVerdictObjects } from "@/lib/gate-prompt";
import { guardMatch, type GuardName, type GuardRead } from "@/lib/match-guards";
import { proxyImagePath } from "@/lib/image-proxy";
import {
  currentSpendMode, priceUsage, recordModelSpend, reportModelFailure,
  type SpendMode,
} from "@/lib/model-budget";
import {
  lensFingerprint, lookupIdentity, storeIdentity, normalizeListingUrl,
  type CachedIdentity, type Fingerprint,
} from "@/lib/identity-cache";
import { buildClaudeRequest, readClaudeReply, parseReplyJson, parseEffort, type Effort } from "@/lib/model-rules";
import {
  runTraced, decideFailure, hasFailed, firstAnswer, reportProviderFailure, recordProviderFailure, logProviderFailure, errorBody,
  recordModelCall, searchFetch, traceStep, noteSearchCredits,
  type FailureLayer, type ScanFailure, type Severity, type ScanTrace,
} from "@/lib/scan-trace";
import { normalizeCurrency, parsePrice, toUsd } from "@/lib/fx";
import { capForModel, scaleImage, CANDIDATE_IMAGE_LONG_EDGE } from "@/lib/image-cap";
import { fetchPublic } from "@/lib/net-guard";

// ════════════════════════════════════════════════════════════════
// MODELS. Chosen per role from the production evaluation (evals/results,
// run 2 and run 3), by the owner's rule: first, no wrong product shown as a
// match; then the highest hit rate; then the lowest cost among models that
// tie within noise.
//
// One decision in this file matters more than everything else in the
// repository: whether a candidate listing is the same physical object as
// the photo. Every number on the card is downstream of it. It used to run on
// Opus 5.5 on the belief that the strongest model judges it best. Measured
// on the labelled set, Sonnet 5.5 at low effort judged it the same: the same
// outcome on all 19 replayed cases in run 2, and on the new four-level prompt
// the same identity claim on every one of 188 candidates in run 3 (none
// claimed by one model and not the other). It does so for about half the
// cost per call and about a third faster. Fable 5.1 claimed identity a
// little less often (more misses, no fewer wrong matches) at two and a half
// times Opus's price, and higher effort made Sonnet more hesitant, not more
// accurate. Twenty cases cannot separate small differences; this is a tie
// within noise, decided on cost, and the evaluation re-measures it on every
// run (scripts/production-eval.mjs, the "replay" step).
//
//   extraction, first pass     Sonnet 5.5  (reads brand, name, price, store;
//                                            Opus and Fable read the same)
//   extraction, escalation     Opus 5.5    (a weak or failed first read: a
//                                            different model's second look)
//   verification gate          Sonnet 5.5, then Opus 5.5 if Sonnet fails
//   degraded gate              Sonnet 5.5  (daily budget spent: capped at
//                                            "likely", enhancements dropped)
//   cache-hit re-confirmation  Sonnet 5.5  (can only ACCEPT a reuse)
//   page text, search query    Sonnet 5.5
//
// Both models cache a prefix from 512 tokens, and every call that looks at
// the photo opens with it (see THE PHOTO, ONCE PER SCAN), so the first read
// writes it to the cache and the gate and re-confirmation read it back. The
// gate also compares a whole wave of candidates in one call with the photo
// sent once (BATCHING BEATS DOWNGRADING in scripts/cost-model.mjs). Both always think; effort is the only control,
// and it is set to low in model-rules.ts. GATE_EFFORT raises the gate's
// level without a code change if a later evaluation shows it is needed.
//
// What each request carries per model (no sampling, thinking left on,
// effort, max_tokens with thinking room) is not decided here: it comes from
// the one table in model-rules.ts, checked against Anthropic's documented
// rules by scripts/check-model-contract.mjs.
const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const EXTRACT_MODEL = SONNET;
const EXTRACT_ESCALATION_MODEL = OPUS;
const GATE_MODEL = SONNET;
// Next in line when the gate model refuses the request, keeps failing, or
// declines it. A different model, so one model's outage or refusal is not
// the scan's. A full-strength gate: it may still say "exact".
const GATE_MODEL_FALLBACK = OPUS;
// The whole gate when the spend governor has degraded the engine. Its best
// label is "likely". See model-budget.ts, and DEGRADED CONFIDENCE in
// verifyCandidates. With Sonnet 5.5 as the full gate too, degrading saves
// the enhancement layers rather than a cheaper model.
const GATE_MODEL_DEGRADED = SONNET;
// Confirms that a cached identification matches this photo. See
// reuseIdentification: it can only accept a reuse, never make a new one.
const REUSE_CONFIRM_MODEL = SONNET;
// Text-only extractions: reading a price off page text, writing a search
// query. Wrong output costs a retry, not a wrong product.
const TEXT_MODEL = SONNET;

/** The gate's effort, when GATE_EFFORT names a valid level; otherwise the table's. */
const gateEffort = () => parseEffort(process.env.GATE_EFFORT);

/** Every model the engine can call, by role. Read by /api/diagnose. */
export const ENGINE_MODELS = {
  extract: EXTRACT_MODEL,
  extractEscalation: EXTRACT_ESCALATION_MODEL,
  gate: GATE_MODEL,
  gateFallback: GATE_MODEL_FALLBACK,
  gateDegraded: GATE_MODEL_DEGRADED,
  reuseConfirm: REUSE_CONFIRM_MODEL,
  text: TEXT_MODEL,
} as const;

// ════════════════════════════════════════════════════════════════
// The one entry point to the model. Centralised so that every call is
// built from the same rules table, read the same way, and measured: the cost
// is taken from the `usage` the API itself reports, not estimated, and added
// to the day's total before the call returns. The spend is awaited rather
// than fired and forgotten because a floating promise on a serverless
// runtime can be killed when the response goes out, and a budget that loses
// writes is not a budget.
//
// API backpressure (429 from a rate limit, 402 from billing, 529 from an
// overloaded API) trips the breaker, so the next scan takes the cheap path
// instead of hammering a limit that is already saying no.
//
// Every failure is logged here, loudly, with the layer, the model, the HTTP
// status and the start of the error body. It used to return null without a
// word, which is how a 400 on every gate call shipped and read as "nothing
// verified". What the failure MEANS for the scan is decided by the caller,
// which knows whether another model can still answer.
// ════════════════════════════════════════════════════════════════
type ClaudeFailureKind =
  | "unconfigured" | "backpressure" | "spend_cap" | "credit_exhausted" | "client" | "server" | "timeout" | "network"
  | "refusal" | "truncated" | "empty" | "unparseable";

interface ClaudeOutcome {
  ok: boolean;
  model: string;
  text: string | null;
  status: number;
  kind: ClaudeFailureKind | "ok";
  /** Stopped at max_tokens. Text is kept, because a partial answer can be salvaged. */
  truncated: boolean;
  detail: string;
  /** What the call cost, from the usage the API reported. */
  costUsd?: number;
  stopReason?: string | null;
  /** Output tokens as reported: thinking plus the visible answer. */
  outputTokens?: number;
}

const BACKPRESSURE = new Set([402, 429, 529]);

function failureKindForStatus(status: number): ClaudeFailureKind {
  if (BACKPRESSURE.has(status)) return "backpressure";
  return status >= 500 ? "server" : "client";
}

async function callClaude(
  layer: FailureLayer,
  model: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
  options: { effort?: Effort | null } = {}
): Promise<ClaudeOutcome> {
  const started = Date.now();
  const request = buildClaudeRequest(model, payload, options);
  const sentEffort = (request.output_config as { effort?: string } | undefined)?.effort ?? null;
  // Filled in once the API answers; read when the call is recorded.
  const meter: { usage?: Record<string, number> } = {};
  // Every call is recorded against the running scan, whatever its outcome:
  // what it cost, how long it took, how much of its output was thinking.
  const settled = (outcome: ClaudeOutcome): ClaudeOutcome => {
    const answerTokens = Math.ceil((outcome.text || "").length / 4);
    const usage = meter.usage;
    recordModelCall({
      layer, model, effort: sentEffort, ms: Date.now() - started, status: outcome.status, kind: outcome.kind,
      inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens,
      cacheReadTokens: usage?.cache_read_input_tokens, cacheWriteTokens: usage?.cache_creation_input_tokens,
      costUsd: outcome.costUsd, stopReason: outcome.stopReason ?? null,
      thinkingApprox: typeof usage?.output_tokens === "number" ? Math.max(0, usage.output_tokens - answerTokens) : undefined,
    });
    return outcome;
  };
  const fail = (kind: ClaudeFailureKind, status: number, detail: string): ClaudeOutcome => {
    logProviderFailure({ layer, provider: "anthropic", model, status, kind, detail });
    return settled({ ok: false, model, text: null, status, kind, truncated: false, detail });
  };
  // A call that was billed (it answered 200) and still failed: the cost and
  // stop reason belong on the record.
  const failPriced = (kind: ClaudeFailureKind, status: number, detail: string, extra: Partial<ClaudeOutcome>): ClaudeOutcome => {
    logProviderFailure({ layer, provider: "anthropic", model, status, kind, detail });
    return settled({ ok: false, model, text: null, status, kind, truncated: false, detail, ...extra });
  };
  if (!process.env.ANTHROPIC_API_KEY) return fail("unconfigured", 0, "ANTHROPIC_API_KEY is not set");
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = (err as Error)?.name || "";
    return fail(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network", 0, String((err as Error)?.message || err));
  }
  if (!res.ok) {
    // The account's monthly spend cap answers 429 with error_code
    // enforced_spend_limit_reached and no retry-after; a limit set in the
    // Console answers 400 "You have reached your specified ... usage
    // limits"; a prepaid account with no credit left answers 400 "Your
    // credit balance is too low". None of them clears until someone raises
    // the limit or adds credit, so each is named as such in the log, where a
    // plain rate limit or a bad request would send whoever is on call looking
    // in the wrong place. The production evaluation hit the last one: every
    // scan on the site failed from then until credit was added.
    const body = await errorBody(res);
    const spendCap = /enforced_spend_limit_reached|reached your specified (workspace )?API usage limits/i.test(body);
    const noCredit = /credit balance is too low/i.test(body);
    await reportModelFailure(res.status, spendCap || noCredit);
    return fail(spendCap ? "spend_cap" : noCredit ? "credit_exhausted" : failureKindForStatus(res.status), res.status, body);
  }
  let data: Record<string, unknown> | null = null;
  try {
    data = await res.json();
  } catch {
    return fail("unparseable", res.status, "response body was not JSON");
  }
  const usage = data?.usage as Record<string, number> | undefined;
  meter.usage = usage;
  const costUsd = priceUsage(model, usage);
  await recordModelSpend(costUsd);
  const outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined;
  const reply = readClaudeReply(data);
  const extra = { costUsd, stopReason: reply.stopReason, outputTokens };
  if (reply.refusal) return failPriced("refusal", res.status, `stop_reason=refusal category=${reply.refusal}`, extra);
  // No text at all and a max_tokens stop: thinking used the whole budget.
  // That is its own kind, so the gate hands the wave to the next model
  // instead of repeating a request that would stop in the same place.
  if (!reply.text) {
    return failPriced(reply.truncated ? "truncated" : "empty", res.status, `no text block; stop_reason=${reply.stopReason}`, extra);
  }
  if (reply.truncated) {
    // Not a failure yet: the gate can salvage the verdicts written before
    // the cut. Said out loud anyway, because it means the thinking room in
    // model-rules.ts was not enough for this call.
    logProviderFailure({ layer, provider: "anthropic", model, status: res.status, kind: "truncated", detail: "stop_reason=max_tokens", recovered: true });
  }
  return settled({ ok: true, model, text: reply.text, status: res.status, kind: "ok", truncated: reply.truncated, detail: "", ...extra });
}

/** Records a model failure the caller could not recover from. callClaude already logged it. */
function reportClaudeFailure(layer: FailureLayer, outcome: ClaudeOutcome, severity: Severity): void {
  recordProviderFailure({
    layer, provider: "anthropic", model: outcome.model, status: outcome.status,
    kind: outcome.kind, detail: outcome.detail, severity,
  });
}

/**
 * The search layers' equivalent of callClaude's failure path: logged with
 * the layer, provider and status, recorded against the scan, and returned
 * as the same null "no result" the caller already handles. The difference
 * is that the scan now knows the null was an error and not an answer.
 */
async function searchFailed(
  layer: FailureLayer,
  provider: string,
  res: Response | null,
  err: unknown,
  severity: Severity
): Promise<null> {
  const status = res?.status ?? 0;
  const name = (err as Error)?.name || "";
  const kind = res
    ? (status === 429 ? "backpressure" : status >= 500 ? "server" : "client")
    : name === "TimeoutError" || name === "AbortError" ? "timeout"
    : name === "UnreadableAnswer" ? "unparseable"
    : "network";
  const detail = res ? await errorBody(res) : String((err as Error)?.message || err || "");
  reportProviderFailure({ layer, provider, status, kind, detail, severity });
  return null;
}

/**
 * SerpApi answers some failures with HTTP 200 and an `error` field. "No
 * results" is a real answer; anything else (an exhausted plan, a bad
 * parameter) is a failure.
 */
function serpApiError(data: unknown): string | null {
  const error = (data as { error?: unknown } | null)?.error;
  if (typeof error !== "string" || !error) return null;
  return /hasn.t returned any results|no results/i.test(error) ? null : error;
}

/**
 * Listing prices in US dollars. The index is the US one, but a Lens match
 * can still come from a merchant pricing in euros or pounds, and comparing
 * that number as if it were dollars is the raw-number bug fixed in fx.ts. A
 * price that cannot be converted is dropped rather than guessed, which leaves
 * the record as an unpriced identification that the pricing search can still
 * attach a real price to.
 */
async function pricesInUsd(candidates: ShoppingCandidate[]): Promise<ShoppingCandidate[]> {
  const out: ShoppingCandidate[] = [];
  for (const c of candidates) {
    if (!c.currency || c.currency === "USD" || c.price <= 0) { out.push(c); continue; }
    const converted = await toUsd(c.price, c.currency);
    out.push({ ...c, price: converted && converted.usd > 0.5 ? converted.usd : 0, currency: "USD", statedCurrency: c.currency });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════
// TIME BUDGET.
//
// The API route this runs behind has a hard ceiling, and a response that
// never arrives is not a more accurate response - it is no result at all,
// which is strictly the worst outcome available. So the layers that ADD
// to an answer already established (the second verification wave, the
// pricing search for a confirmed-but-unpriced product, the rebrand and
// direct-retailer sweeps) check the clock before they start and are
// skipped when there is not enough time left to finish them honestly.
//
// Nothing that establishes identity is ever skipped for time: the Lens
// call and the first verification wave always run.
//
// Both models think on every call, which makes each call slower than it was
// with thinking off, so the budget and the per-layer estimates are sized for
// that. They are estimates until /api/diagnose reports real latencies from
// production; tune them from its numbers. The route's maxDuration (120s) and
// the browser's own timeout (135s) sit above SCAN_BUDGET_MS with room for
// the call still in flight when the budget runs out.
const SCAN_BUDGET_MS = 85_000;
const VERIFY_WAVE_COST_MS = 25_000;
const PRICING_SEARCH_COST_MS = 35_000;
const PAGE_PRICE_COST_MS = 12_000;
const ALTERNATIVE_LAYER_COST_MS = 40_000;
// Per call. A call that takes longer is a failed call, and the next model
// in the chain gets the work.
const EXTRACT_TIMEOUT_MS = 35_000;
const GATE_TIMEOUT_MS = 45_000;
const TEXT_TIMEOUT_MS = 20_000;

function createBudget(totalMs = SCAN_BUDGET_MS) {
  const startedAt = Date.now();
  return {
    remaining: () => totalMs - (Date.now() - startedAt),
    allows: (costMs: number) => totalMs - (Date.now() - startedAt) >= costMs,
  };
}
type Budget = ReturnType<typeof createBudget>;

const CONFIDENCE_RANK = { unverified: 0, likely: 1, exact: 2 } as const;
function rankConfidence(confidence: "exact" | "likely" | "unverified"): number {
  return CONFIDENCE_RANK[confidence];
}

export interface ScanResult {
  found: boolean;
  mode: "VERDICT" | "FINDER" | "UNRESOLVED";
  priceSource: "screenshot" | "estimated" | "shopping";
  engineUsed?: string;
  matchConfidence: "exact" | "likely" | "unverified";
  // Product category. Present on every result so the scan ledger can be
  // sliced by category later: "average markup by category" is one of the few
  // genuinely new things a dataset of this shape can say, and it is
  // impossible to reconstruct after the fact from a title alone.
  category: string;
  // Locality disclosure — NOT a search filter. The search itself always
  // targets the US index (see sanitizeCountry usage below); this is purely
  // an honest heads-up when the requester isn't in that market, so the
  // real markup can still be shown without implying "this ships to you
  // tomorrow." undefined when the requester is in the US (search already
  // matches their own market) or when there's no linked source to caveat.
  shippingNote?: string;
  /** Why a scan that could have had a verdict has none: PLAUSIBLE GAP. */
  priceNote?: string;
  sourceProduct: {
    title: string;
    price: number;
    currency: string;
    imageUrl: string;
    productUrl: string;
    affiliateUrl: string;
    // False when affiliateUrl could only be resolved to a Google-hosted
    // fallback rather than a genuine direct merchant page. The UI must
    // never label a non-direct link as if it goes straight to the
    // product — that mismatch is exactly what a real scan surfaced.
    linkIsDirect?: boolean;
    platform: string;
    rating?: number;
    reviews?: number;
  };
  analysis: {
    retailEstimate: number;
    retailSource: "screenshot" | "estimated" | "shopping";
    markup: number;
    verdict: "HIGH_MARKUP" | "OVERPRICED" | "FAIR" | "UNVERIFIED";
    savings: number;
    savingsPercent: number;
    confidence: "high" | "medium" | "low";
    // The asking price as the seller showed it, when that was not in US
    // dollars. Every amount above is in USD (the listings are), so the card
    // shows this beside the converted figure rather than a raw number in
    // the wrong currency.
    retailOriginal?: RetailOriginal;
  };
  // Present only when the scan could NOT be completed because a provider
  // failed (see scan-trace.ts). The route answers it as "try again", never as
  // "no match", and never charges a free scan for it.
  failure?: ScanFailure;
}

export interface RetailOriginal {
  amount: number;
  currency: string;
  /** Units of `currency` per 1 USD. */
  rate: number;
  /** The day the rate is for. */
  asOf: string;
}

/**
 * An observed asking price in USD. A price whose currency has no rate today
 * is not converted by guesswork: it is treated as not observed, which keeps
 * the scan from printing a markup it cannot compute (no verdict, the
 * cheapest listing still shown).
 */
async function observedPriceInUsd(
  amount: number,
  currency: string
): Promise<{ usd: number; original?: RetailOriginal } | null> {
  const code = normalizeCurrency(currency) || "USD";
  if (code === "USD") return { usd: amount };
  const converted = await toUsd(amount, code);
  if (!converted) {
    reportProviderFailure({
      layer: "fx", provider: "exchange-api", status: 0, kind: "no-rate",
      detail: `no USD rate for ${code}; asking price treated as unknown`, severity: "advisory",
    });
    return null;
  }
  return { usd: converted.usd, original: { amount, currency: code, rate: converted.rate, asOf: converted.asOf } };
}

interface VisionExtraction {
  productName: string;
  brand: string;
  visiblePrice: number | null;
  currency: string;
  quantity: string;         // pack/bundle size if stated, e.g. "3-pack" — keeps comparisons apples-to-apples
  category: string;
  platform: string;
  storeName: string;        // seller handle / watermark / caption store name, if visible
  visibleUrl: string;       // an actual URL visible in the screenshot (browser bar, caption link, etc.) — empty if none
  priceConfidence: "visible" | "inferred" | "none";
  imageQuality: "good" | "poor";
}

interface ShoppingCandidate {
  // 0 means this record publishes no price. That is a normal, common state
  // for a Google Lens visual match (a brand's own page, an editorial
  // write-up, a marketplace listing Google parsed no price from) and it is
  // NOT a reason to discard the record: it is frequently the most visually
  // identical result in the whole response. A price for it gets found
  // separately, after identification (see priceVerifiedIdentity).
  price: number;
  imageUrl: string;
  productUrl: string;
  source: string;
  title: string;
  productId?: string; // SerpApi product_id, when present — enables merchant-link resolution
  // ISO currency of `price` as the listing stated it. Converted to USD by
  // pricesInUsd before anything compares it; absent means USD.
  currency?: string;
  // The currency the listing stated before that conversion, kept so a
  // verdict can tell which market the price is from (SAME-MARKET VERDICTS).
  statedCurrency?: string;
  // Position in the ENGINE's own ordering, 0 being its best match. Google
  // Lens returns visual matches best-match-first, and that ordering is the
  // identification signal — it is the part of the response that says "this
  // is the same object". It used to be destroyed by a price sort before
  // anything had looked at it, which is how price became a precondition
  // for being identified at all.
  rank: number;
}

// What an earlier layer already read about the product, used to ORDER
// candidates for the identification gate. Never used to filter them.
interface IdentityHints {
  brand?: string;
  productName?: string;
}

interface ShoppingMatch {
  title: string;
  lowestPrice: number;
  /**
   * The currency `lowestPrice` was stated in by its own listing (before
   * conversion to USD), or null when it is not known (an identification
   * reused from the cache before this was recorded). See SAME-MARKET
   * VERDICTS.
   */
  priceCurrency?: string | null;
  highestPrice: number;
  imageUrl: string;
  productUrl: string;
  source: string;
  productId?: string;
  rating?: number;
  reviews?: number;
  candidates: ShoppingCandidate[];
}

interface VerificationResult {
  match: "exact" | "likely" | "similar" | "different";
  reasoning: string;
  /** What the gate said ties the candidate to the photo. See buildBatchPrompt. */
  tie?: string;
  /** The gate's own answer, when a match guard changed it. See match-guards.ts. */
  gateMatch?: "exact" | "likely" | "similar" | "different";
  guard?: GuardName | null;
}

/** What the gate is shown for one candidate: its image, and its listing text where known. */
interface GateCandidate {
  imageUrl: string;
  title?: string;
  source?: string;
}

interface PageProductData {
  title: string;
  /** The brand the page's own product data states (schema.org brand, product:brand), when it states one. */
  brand?: string;
  price: number | null;
  currency: string;
  imageUrl: string;
  description: string;   // full product description text, when available — feeds query enrichment
  searchQuery: string;   // specific search query built from title + description + page content
}

// ════════════════════════════════════════════════════════════════
// Region handling (v9) — validated ISO 3166-1 alpha-2 code, defaulting to
// "us" for anything missing/malformed. Threaded through as `gl` on every
// Lens/Shopping/organic search call below.
// ════════════════════════════════════════════════════════════════
function sanitizeCountry(country?: string): string {
  const c = (country || "").trim().toLowerCase();
  return /^[a-z]{2}$/.test(c) ? c : "us";
}

// v9.1: locality is a disclosure, not a filter. The search always targets
// the US index regardless of where the requester is (see file header) — so
// when the requester ISN'T in the US, the linked source may or may not ship
// to them, and that's worth an honest heads-up rather than silently
// omitting it OR silently filtering search results down to "guaranteed
// local" at the cost of finding the real floor price. This never claims a
// specific verified shipping fact — it's a general prompt to check, sized
// to whether the source is a known cross-border platform.
const KNOWN_CROSS_BORDER_PLATFORMS = [
  "aliexpress.com", "temu.com", "dhgate.com", "wish.com", "banggood.com", "1688.com",
];

/** The currency a candidate's own listing stated its price in; absent means USD. */
function statedCurrencyOf(c: ShoppingCandidate): string {
  return normalizeCurrency(c.statedCurrency || c.currency) || "USD";
}

/**
 * A listing's price as a search provider gives it: the provider's own price
 * text, read by parsePrice, checked against the number the provider
 * extracted from that text. When both are there they must agree, or the
 * format was ambiguous and neither is trusted; a number alone (no text with
 * digits in it) is taken as given. 0 when there is no price.
 */
export function listedPrice(text: unknown, extracted: unknown, currencyHint?: unknown): { amount: number; currency: string } {
  const read = parsePrice(text, currencyHint);
  const theirs = typeof extracted === "number" && Number.isFinite(extracted) && extracted > 0 ? extracted : null;
  const written = typeof text === "string" || typeof text === "number" ? /\d/.test(String(text)) : false;
  let amount: number | null;
  if (!written) amount = theirs;
  else if (read.amount === null || theirs === null) amount = read.amount;
  else amount = Math.abs(read.amount - theirs) <= Math.max(0.01, theirs * 0.01) ? read.amount : null;
  return { amount: amount && amount > 0 ? amount : 0, currency: read.currency };
}

// ════════════════════════════════════════════════════════════════
// SAME-MARKET VERDICTS.
//
// A verdict (BUSTED / OVERPRICED / FAIR PRICE) compares the asking price
// with the source price, and it is only made when both are in the same
// currency. A euro screenshot against a store pricing in Indonesian rupiah,
// or a dirham one against a US listing, crosses regional pricing, VAT and
// import duty, and shipping, none of which the engine sees, so the gap is
// not a markup anyone can be accused of. Such a scan returns the
// cheapest-link card instead, with the regional-shipping note, and keeps
// both prices converted for display. An unknown source currency is not the
// same market either.
// ════════════════════════════════════════════════════════════════
export function sameMarket(askingCurrency: string | null | undefined, sourceCurrency: string | null | undefined): boolean {
  const asking = normalizeCurrency(askingCurrency || "") || "";
  const source = normalizeCurrency(sourceCurrency || "") || "";
  return !!asking && asking === source;
}

// ════════════════════════════════════════════════════════════════
// PLAUSIBLE GAP.
//
// A misread price is off by a factor, not by a few percent: "55,00" read as
// 5,500 is 100 times too high, and a lost decimal point or the wrong
// currency is 100 or 1,000 times off. A gap of more than 50 times between
// the asking price and the source price, in either direction, is far more
// likely a misread than a markup, so no verdict is made on it. The scan
// returns the cheapest-link card with a short note instead.
// ════════════════════════════════════════════════════════════════
export const IMPLAUSIBLE_GAP = 50;
export const IMPLAUSIBLE_GAP_NOTE = "These two prices are too far apart to compare, so there is no verdict. Check both listings.";

/** Whether two prices in the same currency (USD here) are more than IMPLAUSIBLE_GAP times apart. */
export function implausibleGap(askingUsd: number, sourceUsd: number): boolean {
  if (!(askingUsd > 0) || !(sourceUsd > 0)) return false;
  return Math.max(askingUsd / sourceUsd, sourceUsd / askingUsd) > IMPLAUSIBLE_GAP;
}

/** The regional-shipping note; always present when the source is from another market. */
function regionalNote(sourceUrl: string, country: string, crossMarket: boolean): string | undefined {
  return buildShippingNote(sourceUrl, country) ?? (crossMarket ? "Check shipping availability to your region before ordering" : undefined);
}

export function buildShippingNote(sourceUrl: string, country: string): string | undefined {
  if (country === "us" || !sourceUrl) return undefined;
  try {
    const host = new URL(sourceUrl).hostname;
    const isKnownCrossBorder = KNOWN_CROSS_BORDER_PLATFORMS.some(d => host.includes(d));
    return isKnownCrossBorder
      ? "Ships internationally. Check delivery time to your region."
      : "Check shipping availability to your region before ordering";
  } catch {
    return "Check shipping availability to your region before ordering";
  }
}

// ════════════════════════════════════════════════════════════════
// LAYER 1: vision extraction (Sonnet 5.5, escalating to Opus 5.5)
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// THE PHOTO, ONCE PER SCAN, AS A CACHED PREFIX.
//
// Every call that looks at the scanned photo (the first read, each gate
// wave, the cache-hit re-confirmation, and the Opus 5.5 escalation and
// fallback) opens with the same two blocks: a label, then the photo marked
// as a cache breakpoint. Prompt caching is a prefix match, so the first call
// on a model writes the photo to the cache and every later call on that
// model within five minutes reads it back, at $0.20 per million tokens
// instead of $2 on Sonnet 5.5 ($4 on Opus 5.5). Sonnet 5.5 runs both the
// first read and the gate, so a scan pays for the photo in full once, plus
// the 25% write premium, instead of on every call. What varies between calls
// (the instructions, the candidates) comes after it.
//
// Both models cache from 512 tokens (Anthropic's prompt-caching docs,
// checked 2026-10-03); a capped photo is about 1,500. Three things keep the
// prefix identical, and scripts/check-model-contract.mjs asserts each: the
// same blocks in the same order, no system prompt and no tools, and the same
// effort on every role that shares a model (an effort change invalidates the
// cache, so GATE_EFFORT set to anything but the table's level costs the gate
// its cache reads). /api/diagnose measures the read on every run.
// ════════════════════════════════════════════════════════════════
function photoPrefix(photo: { data: string; mimeType: string }): Record<string, unknown>[] {
  return [
    { type: "text", text: "IMAGE A (the photo being scanned):" },
    {
      type: "image",
      source: { type: "base64", media_type: photo.mimeType, data: photo.data },
      cache_control: { type: "ephemeral" },
    },
  ];
}

/** The extraction request, as sent. Also what /api/diagnose sends. */
function extractionPayload(imageBase64: string, mimeType: string): Record<string, unknown> {
  return {
    max_tokens: 350,
    messages: [{
      role: "user",
      content: [
        ...photoPrefix({ data: imageBase64, mimeType }),
        {
          type: "text",
          text: `Product intelligence scan. Return ONLY JSON:
{
  "productName": "exact product name, generic type if brand unknown",
  "brand": "brand or empty",
  "visiblePrice": null or number (ONLY if a price is clearly visible on screen),
  "currency": "ISO 4217 code of the visible price's currency, from its symbol, code or the screen's country cues (e.g. USD, EUR, GBP, MAD). A bare $ with no other cue is USD. Empty string if no price is visible",
  "quantity": "pack/bundle size if stated anywhere, e.g. '3-pack', '1 unit', '2-in-1'. Empty string if not specified. Comparing a 3-pack retail price against a single-unit wholesale listing produces a false markup, so this matters as much as the product name.",
  "category": "beauty|fitness|tech|fashion|home|pet|skincare|accessories|food|other",
  "platform": "tiktok|instagram|amazon|shopify|facebook|aliexpress|website|unknown",
  "storeName": "the seller/shop/store name or @handle if visible anywhere in the screenshot (watermark, caption, URL bar, product page header, checkout logo). Empty string if none is visible",
  "visibleUrl": "an actual URL/website address/domain visibly written or shown anywhere in the screenshot (browser address bar, a link in a caption or bio, a 'shop at ___' text overlay). Empty string if no URL text is actually visible. Do not construct or guess a URL. Only report one if it is literally shown as text.",
  "priceConfidence": "visible|inferred|none",
  "imageQuality": "good|poor"
}
CRITICAL: visiblePrice must be null unless a price number is clearly visible. Never guess.
CRITICAL: check every part of the image for a price, not just near the product. Video screenshots (TikTok/Reels) often show the price in a caption, a corner overlay, or a graphic banner rather than next to the item itself. Scan the full frame, all four corners and any text overlay, before concluding no price is visible.
CRITICAL: storeName must be read directly from visible text/logos/handles/URLs in the image. Never guess or infer a store name that isn't actually shown.
CRITICAL: visibleUrl must be an actual URL string visible as text in the image. Never invent one from a store name or brand guess.
CRITICAL: productName must include the defining material/type descriptor whenever visible or inferable. Use "jade roller" not "roller", "rose quartz gua sha" not "gua sha tool", "copper straightening brush" not "hair brush". A bare generic category word causes wrong-product matches against visually similar but materially different items (e.g. jade rollers vs needle/derma rollers both being "rollers"). Never drop a visible distinguishing word to make the name shorter.`,
        },
      ],
    }],
  };
}

const EMPTY_READ: VisionExtraction = {
  productName: "", brand: "", visiblePrice: null,
  currency: "", quantity: "", category: "other", platform: "unknown",
  storeName: "", visibleUrl: "", priceConfidence: "none", imageQuality: "poor",
};

async function extractFromImage(
  imageBase64: string,
  mimeType: string,
  mode: SpendMode = "full",
  intent?: "verdict" | "finder"
): Promise<VisionExtraction> {
  const read = await readFromImage(imageBase64, mimeType, mode, intent);
  traceStep("extraction", {
    brand: read.brand, productName: read.productName, visiblePrice: read.visiblePrice, currency: read.currency,
    quantity: read.quantity, category: read.category, storeName: read.storeName, visibleUrl: read.visibleUrl,
    imageQuality: read.imageQuality,
  });
  return read;
}

async function readFromImage(
  imageBase64: string,
  mimeType: string,
  mode: SpendMode,
  intent?: "verdict" | "finder"
): Promise<VisionExtraction> {
  const defaults = EMPTY_READ;

  const body = extractionPayload(imageBase64, mimeType);

  // A read that never arrived is not a photo with nothing on it. For a
  // verdict, the asking price comes from this read and nowhere else, so if
  // neither model could produce one the scan cannot be completed honestly.
  // For "where is it cheapest" the photo alone still identifies the product,
  // so it only matters when nothing else identified it either.
  const severity: Severity = intent === "finder" ? "identity" : "critical";
  const readOf = (outcome: ClaudeOutcome): Partial<VisionExtraction> | null => {
    if (!outcome.ok) return null;
    const parsed = parseReplyJson(outcome.text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Partial<VisionExtraction>;
    logProviderFailure({
      layer: "extraction", provider: "anthropic", model: outcome.model, status: outcome.status,
      kind: "unparseable", detail: outcome.text || "",
    });
    return null;
  };

  const first = await callClaude("extraction", EXTRACT_MODEL, body, EXTRACT_TIMEOUT_MS);
  const firstRead = readOf(first);
  if (firstRead) {
    const read = cleanExtraction({ ...defaults, ...firstRead });
    if (mode === "degraded" || !readFailed(read)) return read;
    // Escalation. The brand and the product words this pass returns are what
    // order candidates for the gate, and a missed brand is how a listing that
    // actually carries the logo on the photo fails to reach the front of the
    // queue. When the read comes back weak on an image the model itself called
    // good, the one call is worth spending on Opus 5.5 - it is a single call
    // per scan, and only on the scans where the first read visibly
    // underperformed. If the escalation itself fails, the weak read
    // is still a real read, so it stands (the failure is already logged).
    const second = readOf(await callClaude("extraction", EXTRACT_ESCALATION_MODEL, body, EXTRACT_TIMEOUT_MS));
    return second ? cleanExtraction({ ...defaults, ...second }) : read;
  }

  // The first read failed outright: an error, a refusal, or an answer that
  // was not JSON. Opus 5.5 gets the same request, in either spend mode,
  // because without a read the scan has no asking price at all.
  const retry = await callClaude("extraction", EXTRACT_ESCALATION_MODEL, body, EXTRACT_TIMEOUT_MS);
  const retryRead = readOf(retry);
  if (retryRead) return cleanExtraction({ ...defaults, ...retryRead });
  reportClaudeFailure("extraction", retry.ok ? { ...retry, ok: false, kind: "unparseable" } : retry, severity);
  return defaults;
}

/**
 * Types as the rest of the engine assumes them. A model can return a price as
 * a string or a currency as a symbol, and both used to flow through as-is.
 */
function cleanExtraction(read: VisionExtraction): VisionExtraction {
  const price = parsePrice(read.visiblePrice, read.currency).amount ?? 0;
  return {
    ...read,
    productName: String(read.productName || ""),
    brand: String(read.brand || ""),
    visiblePrice: price > 0 ? price : null,
    currency: normalizeCurrency(read.currency),
    quantity: String(read.quantity || ""),
    storeName: String(read.storeName || ""),
    visibleUrl: String(read.visibleUrl || ""),
  };
}

/**
 * Worth a second, stronger look? The trigger is deliberately narrow: an
 * INTERNALLY INCONSISTENT read, where the model called the photo good and
 * then returned no product name at all. That is a read that plainly failed,
 * as opposed to a photo that genuinely has little to read.
 *
 * The wider triggers are tempting and wrong. "No brand" is the obvious one -
 * the brand feeds the ranking boost that pulls a matching listing forward -
 * but plenty of photos genuinely show no brand at all, and a stronger model
 * will not invent one, so escalating there pays full price for the same
 * empty field. It also is not load-bearing: the boost changes the ORDER
 * candidates are judged in, while the thing that guarantees a buried match
 * is still reached is the twelve-wide window, and that runs either way. Same
 * for a one-word product name next to a brand that did read: "Ralph Lauren"
 * plus "eyeglasses" is a perfectly usable hint.
 *
 * Getting this wrong is expensive rather than harmful, and the first version
 * of it got it wrong: it escalated on nearly every scan in the test suite,
 * which is how a cheap extraction quietly becomes an expensive one.
 */
function readFailed(read: VisionExtraction): boolean {
  return read.imageQuality === "good" && !(read.productName || "").trim();
}

// ════════════════════════════════════════════════════════════════
// LAYER 6: the visual verification gate.
//
// ONE CALL PER WAVE, NOT ONE CALL PER CANDIDATE. The reference photo is
// roughly 1,600 tokens (capped at 1568px on its long edge, see
// capForModel) and a candidate thumbnail roughly 150, so a pairwise call
// spends nearly all of its input re-sending the same photo. Sending it once
// alongside a batch of candidates costs a fraction of the pairwise calls,
// and with thinking always on every call saved is also a thinking pass
// saved. Numbers in scripts/cost-model.mjs.
//
// The risk this shape introduces is real and is handled in the prompt: a
// model shown six candidates at once can slide from judging each one
// absolutely into ranking them against each other, and "the closest of
// these six" is exactly the wrong answer. The instruction says so
// explicitly, and says that every candidate being "different" is a normal
// outcome. Comparative context also cuts the other way and helps: a
// different colourway is easier to spot next to the right colourway than
// alone.
//
// A candidate whose image will not load cannot be judged and stays
// "different". An unjudgeable candidate is not given the benefit of the
// doubt.
// ════════════════════════════════════════════════════════════════
// Eight, so the rebrand and retailer pools (four each) fit one call. Wave one
// of the identification window is six.
const VERIFY_BATCH_MAX = 8;

interface BatchOutcome {
  results: VerificationResult[];
  /** False when the call produced no usable verdict, so it is worth a retry. */
  ok: boolean;
  /** How many candidate images loaded and were sent to the model. */
  loaded?: number;
  /** The model call behind a failed batch, for the fallback decision. */
  call?: ClaudeOutcome;
}

/** The gate request for one wave, as sent. Also what /api/diagnose sends. */
function gatePayload(
  reference: { data: string; mimeType: string },
  candidates: { data: string; mimeType: string; title?: string; source?: string }[]
): Record<string, unknown> {
  // The photo first, exactly as the first read sent it: see THE PHOTO, ONCE
  // PER SCAN. Every wave in a scan reads it back from the cache.
  const content: Record<string, unknown>[] = [...photoPrefix(reference)];
  candidates.forEach((image, slot) => {
    // The listing's own words, bounded and on one line. See buildBatchPrompt:
    // they can rule a candidate out or back up the images, never match alone.
    const title = (image.title || "").replace(/\s+/g, " ").trim().slice(0, 160);
    const source = (image.source || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const label = [title && `listing title "${title}"`, source && `on ${source}`].filter(Boolean).join(", ");
    content.push({ type: "text", text: `CANDIDATE ${slot + 1}${label ? ` (${label})` : ""}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mimeType, data: image.data },
    });
  });
  content.push({ type: "text", text: buildBatchPrompt(candidates.length) });

  return {
    // Generous on purpose: see salvageVerdictObjects. A wave truncated
    // mid-answer is a far more expensive failure than an unused ceiling.
    max_tokens: 250 + candidates.length * 90,
    messages: [{ role: "user", content }],
  };
}

async function verifyVisualMatchBatch(
  reference: { data: string; mimeType: string },
  candidates: GateCandidate[],
  model: string,
  layer: FailureLayer = "gate",
  effort: Effort | null = gateEffort()
): Promise<BatchOutcome> {
  const unavailable = (): VerificationResult => ({ match: "different", reasoning: "verification unavailable", tie: "none" });
  const results: VerificationResult[] = candidates.map(unavailable);
  let judged = 0;
  if (candidates.length === 0) return { results, ok: false };

  // Each candidate capped at 512px: see CANDIDATE_IMAGE_LONG_EDGE.
  const images = await Promise.all(
    candidates.map(async c => {
      const image = c.imageUrl ? await fetchImageAsBase64(c.imageUrl) : null;
      return image ? capForModel(image, CANDIDATE_IMAGE_LONG_EDGE) : null;
    })
  );
  const present: { index: number; image: { data: string; mimeType: string; title?: string; source?: string } }[] = [];
  images.forEach((image, index) => {
    if (image) present.push({ index, image: { ...image, title: candidates[index].title, source: candidates[index].source } });
  });
  // No candidate image loaded at all. Nothing was judged, but nothing can
  // be judged either, so a retry would not help: not a failed call.
  if (present.length === 0) return { results, ok: true, loaded: 0 };
  const loaded = present.length;

  const call = await callClaude(layer, model, gatePayload(reference, present.map(p => p.image)), GATE_TIMEOUT_MS, { effort });
  if (!call.ok) return { results, ok: false, call, loaded };

  const parsed = parseReplyJson(call.text);
  let list: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { verdicts?: unknown[] } | null)?.verdicts)
      ? (parsed as { verdicts: unknown[] }).verdicts
      : [];

  if (list.length === 0) list = salvageVerdictObjects(call.text || "");
  if (list.length === 0) {
    logProviderFailure({ layer, provider: "anthropic", model, status: call.status, kind: "unparseable", detail: call.text || "" });
    return { results, ok: false, loaded, call: { ...call, ok: false, kind: call.truncated ? "truncated" : "unparseable", detail: (call.text || "").slice(0, 300) } };
  }

  // Read the candidate number the model echoed back rather than trusting
  // position, and fall back to position when it omitted one. A verdict that
  // cannot be tied to a candidate is dropped, leaving that candidate
  // unjudged rather than mislabeled.
  list.forEach((raw, position) => {
    const verdict = coerceVerdict(raw);
    if (!verdict) return;
    const stated = (raw as { candidate?: unknown }).candidate;
    const slot = typeof stated === "number" && stated >= 1 && stated <= present.length
      ? stated - 1
      : position;
    if (slot < 0 || slot >= present.length) return;
    results[present[slot].index] = verdict;
    judged++;
  });

  return { results, ok: judged > 0, call, loaded };
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") || "image/jpeg";
    if (!mimeType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 4_500_000) return null;
    return { data: buf.toString("base64"), mimeType };
  } catch {
    return null;
  }
}

// Google Lens can only be handed a URL, so the uploaded photo has to be
// publicly reachable for the few seconds the reverse-image call takes. The
// URL is unguessable (128 bits of randomness in the filename) and the blob
// is deleted by discardLensUpload() the moment the search returns, with the
// daily cron as a backstop for anything a crashed request left behind.
// The privacy policy describes exactly this, because it has to.
async function uploadForLensSearch(imageBase64: string, mimeType: string): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const ext = mimeType.split("/")[1]?.split("+")[0] || "jpg";
    const buf = Buffer.from(imageBase64, "base64");
    const secret = randomBytes(16).toString("hex");
    const blob = await put(`${LENS_BLOB_PREFIX}${Date.now()}-${secret}.${ext}`, buf, {
      access: "public",
      contentType: mimeType,
      addRandomSuffix: false,
    });
    return blob.url;
  } catch (err) {
    return searchFailed("upload", "vercel-blob", null, err, "identity");
  }
}

// Deleted as soon as the reverse-image search that needed it has returned.
// A scan should not leave a copy of someone's screenshot sitting on a public
// URL for up to a day waiting on a cron job.
async function discardLensUpload(url: string | null): Promise<void> {
  if (!url || !process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(url);
  } catch { /* the daily cleanup cron is the backstop */ }
}

// ════════════════════════════════════════════════════════════════
// SEARCH PROVIDERS, BUDGET MODE. Serper answers Lens and Shopping first: it
// is prepaid credits at about a tenth of a cent each. SerpApi is the last
// resort, asked only when Serper FAILED (an error, a timeout, an answer this
// engine could not read; "nothing found" is an answer and stops there), and
// only while the SerpApi account has more than SERPAPI_RESERVE searches left
// this month, so a Serper outage cannot spend the free plan to zero. The
// Amazon, Walmart and eBay sweep, three SerpApi searches a scan, is off
// unless RETAILER_SWEEP=1.
//
// The remaining count comes from SerpApi's account endpoint, which is free
// and does not count as a search. It is read at most every ten minutes per
// instance, and the local copy is decremented as searches are spent so a
// burst cannot overshoot. A lookup that fails holds the backup: an unknown
// balance is not a balance above the reserve.
// ════════════════════════════════════════════════════════════════
export const SERPAPI_RESERVE = Number(process.env.SERPAPI_RESERVE || 20);
const SERPAPI_BALANCE_TTL_MS = 10 * 60_000;
let serpApiBalance: { left: number | null; at: number } | null = null;

/** Test seam: forget the cached SerpApi balance. */
export function resetSerpApiBalance(): void {
  serpApiBalance = null;
}

async function serpApiSearchesLeft(): Promise<number | null> {
  if (serpApiBalance && Date.now() - serpApiBalance.at < SERPAPI_BALANCE_TTL_MS) return serpApiBalance.left;
  let left: number | null = null;
  try {
    const res = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(process.env.SERPAPI_KEY || "")}`, {
      signal: AbortSignal.timeout(4000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const n = Number(body.total_searches_left ?? body.plan_searches_left);
    left = res.ok && Number.isFinite(n) ? n : null;
  } catch {
    left = null;
  }
  serpApiBalance = { left, at: Date.now() };
  return left;
}

/** Whether SerpApi may spend `searches` more searches now. Logged when it may not. */
async function serpApiAllowed(searches = 1): Promise<boolean> {
  if (!process.env.SERPAPI_KEY) return false;
  const left = await serpApiSearchesLeft();
  const allowed = left !== null && left - searches >= SERPAPI_RESERVE;
  traceStep("serpapi", { left, reserve: SERPAPI_RESERVE, searches, allowed });
  if (!allowed) {
    console.error(`[scan] serpapi held at its reserve: ${left === null ? "balance unknown" : `${left} searches left`}, reserve ${SERPAPI_RESERVE}`);
  } else if (serpApiBalance && serpApiBalance.left !== null) {
    serpApiBalance.left -= searches;
  }
  return allowed;
}

/** The Amazon, Walmart and eBay sweep: three SerpApi searches a scan, so off unless RETAILER_SWEEP=1. */
export const retailerSweepOn = (): boolean => process.env.RETAILER_SWEEP === "1";

// ════════════════════════════════════════════════════════════════
// Google Lens reverse image search via SerpApi (the backup)
// ════════════════════════════════════════════════════════════════
// v9.1: hardcoded to the US index regardless of the requester's location.
// The US Shopping/Lens index is by far the deepest and is where the actual
// wholesale floor price for dropshipped products (AliExpress/Temu/Wish-style
// cross-border listings) reliably surfaces. Restricting to the user's own
// country degrades search depth without making the verdict more accurate —
// the markup is real regardless of which country's index found the floor
// price. Locality is handled separately via the shippingNote disclosure.
/**
 * Lens through Serper, then SerpApi only if Serper failed and SerpApi is
 * above its reserve (SEARCH PROVIDERS, BUDGET MODE). See firstAnswer for how
 * failures count.
 */
async function searchLens(imageUrl: string): Promise<{ match: ShoppingMatch | null; engine: "serpapi" | "serper" | "" }> {
  const { value, index } = await firstAnswer("lens", [
    { configured: !!process.env.SERPER_API_KEY, run: () => searchLensViaSerper(imageUrl) },
    { configured: () => serpApiAllowed(), run: () => searchLensViaSerpApi(imageUrl) },
  ], { onEmpty: "stop" });
  return { match: value, engine: index === 0 ? "serper" : index === 1 ? "serpapi" : "" };
}

async function searchLensViaSerpApi(imageUrl: string, severity: Severity = "identity"): Promise<ShoppingMatch | null> {
  if (!process.env.SERPAPI_KEY) return null;

  try {
    const params = new URLSearchParams({
      engine: "google_lens",
      url: imageUrl,
      api_key: process.env.SERPAPI_KEY,
      hl: "en",
      country: "us",
    });

    const res = await searchFetch("lens", "serpapi", "google_lens", `https://serpapi.com/search.json?${params}`, {
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) return searchFailed("lens", "serpapi", res, null, severity);
    const data = await res.json();
    const failure = serpApiError(data);
    if (failure) return searchFailed("lens", "serpapi", null, new Error(failure), severity);

    // ── THE IDENTIFICATION FIX ──
    // Lens answers "what is this object". It only sometimes also answers
    // "what does it cost", and those are two different questions.
    //
    // What used to happen here: every match without a price was deleted as
    // the very first operation, and what survived was then sorted
    // cheapest-first. Both halves of that destroyed identification. The
    // filter threw away the most visually identical result in the response
    // whenever Google had no price for it — routine for a brand's own
    // product page — and the sort replaced Lens's best-match-first
    // ordering, the one real identification signal in the payload, with an
    // ordering that knows nothing about what the photo shows. The
    // verification gate downstream then saw the five CHEAPEST rows instead
    // of the five most similar ones, and when none of them matched it
    // presented the cheapest row as the "closest match". That is the exact
    // mechanism by which a photo of Ralph Lauren eyeglasses came back as an
    // unrelated brand, and by which a photo of one Under Armour bag came
    // back as a different, cheaper Under Armour bag.
    //
    // Now: every match Google returned is kept in the order Google returned
    // it, with `exact_matches` (its own "this is the same image" set, when
    // present) ahead of `visual_matches`. Price is recorded when there is
    // one and left at 0 when there is not. Nothing is ranked, filtered or
    // discarded by price before the gate has had a chance to check it.
    //
    // (The exact_matches shape is SerpApi-documented but not verified
    // against a live response from here, so it is parsed defensively: a
    // missing or differently-shaped field simply contributes nothing.)
    const ordered = [
      ...(Array.isArray(data.exact_matches) ? data.exact_matches : []),
      ...(Array.isArray(data.visual_matches) ? data.visual_matches : []),
    ] as Record<string, unknown>[];

    const candidates: ShoppingCandidate[] = [];
    const seen = new Set<string>();
    for (const m of ordered) {
      // A thumbnail is the ONE genuinely required field. The gate compares
      // images, so a candidate with no image cannot be checked, and an
      // uncheckable candidate is not a candidate. Everything else,
      // including the price, is optional.
      const imageUrl = String(m.thumbnail || "");
      if (!imageUrl) continue;

      const productUrl = String(m.link || "");
      const dedupeKey = productUrl || imageUrl;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const price = m.price as { extracted_value?: number; currency?: string; value?: string } | undefined;
      const listed = listedPrice(price?.value, price?.extracted_value, price?.currency);
      candidates.push({
        price: listed.amount > 0.5 ? listed.amount : 0,
        currency: normalizeCurrency(price?.currency) || listed.currency || undefined,
        title: String(m.title || ""),
        imageUrl,
        productUrl,
        source: String(m.source || ""),
        productId: m.product_id ? String(m.product_id) : undefined,
        rank: candidates.length,
      });
      // Far more than the gate will ever check. Bounded only so a
      // hundred-row response does not get carried around for no reason.
      if (candidates.length >= 40) break;
    }

    return buildShoppingMatch(await pricesInUsd(candidates));
  } catch (err) {
    return searchFailed("lens", "serpapi", null, err, severity);
  }
}

// ════════════════════════════════════════════════════════════════
// Google Lens reverse image search via Serper (the primary)
//
// No production scan read Serper's Lens answer before budget mode (every
// one ran on SerpApi), so this reader is deliberately tolerant: it takes the
// first list of results under any of the names Serper gives result lists,
// and each row's image, link, source and price under their usual names. A
// thumbnail is preferred to the full image: it is what the gate compares,
// it is small, and Google's thumbnail host answers where a merchant's
// hotlink protection may not.
//
// What it will not do is fail quietly. A 200 whose rows this reader cannot
// use is a failure of this layer, logged with the field names Serper sent,
// so a schema change shows on /api/diagnose and in the log instead of
// reading as "no visual matches" on every scan; the SerpApi backup then
// answers while it is above its reserve. /api/diagnose reports the live
// shape on every run (the serper_lens trace step).
// ════════════════════════════════════════════════════════════════
const SERPER_RESULT_LISTS = ["organic", "visualMatches", "visual_matches", "matches", "images", "results"];

const firstHttpUrl = (...values: unknown[]): string =>
  (values.find(v => typeof v === "string" && /^https?:\/\//i.test(v)) as string | undefined) || "";

async function searchLensViaSerper(imageUrl: string): Promise<ShoppingMatch | null> {
  if (!process.env.SERPER_API_KEY) return null;

  try {
    const res = await searchFetch("lens", "serper", "lens", "https://google.serper.dev/lens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": process.env.SERPER_API_KEY,
      },
      body: JSON.stringify({ url: imageUrl, gl: "us", hl: "en" }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return searchFailed("lens", "serper", res, null, "identity");
    const data = (await res.json()) as Record<string, unknown>;
    noteSearchCredits("serper", data.credits);

    // The known list names first; then any other top-level list of objects,
    // so results moved to a name not listed here are reported, not missed.
    const listKey = SERPER_RESULT_LISTS.find(k => Array.isArray(data[k]) && (data[k] as unknown[]).length > 0)
      ?? Object.keys(data).find(k => Array.isArray(data[k]) && (data[k] as unknown[]).some(v => v && typeof v === "object"))
      ?? null;
    const rows = (listKey ? (data[listKey] as unknown[]) : []).filter(
      (v): v is Record<string, unknown> => !!v && typeof v === "object"
    );

    // Same two fixes as the SerpApi reader: an unpriced visual match is kept
    // (it is often the best match), and the engine's own best-match-first
    // order is kept instead of a price sort. A missing image is still
    // disqualifying, because the gate has nothing to compare without one.
    const candidates: ShoppingCandidate[] = [];
    const seen = new Set<string>();
    for (const m of rows) {
      const image = firstHttpUrl(m.thumbnailUrl, m.thumbnail, m.imageUrl, m.image);
      if (!image) continue;
      const productUrl = String(m.link || m.url || "");
      const dedupeKey = productUrl || image;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const listed = listedPrice(m.price, m.extractedPrice);
      candidates.push({
        price: listed.amount > 0.5 ? listed.amount : 0,
        currency: listed.currency || undefined,
        title: String(m.title || ""),
        imageUrl: image,
        productUrl,
        source: String(m.source || m.domain || ""),
        rank: candidates.length,
      });
      if (candidates.length >= 40) break;
    }
    traceStep("serper_lens", {
      list: listKey, rows: rows.length, usable: candidates.length,
      priced: candidates.filter(c => c.price > 0).length,
      fields: rows[0] ? Object.keys(rows[0]).slice(0, 15) : [],
      topLevel: Object.keys(data).slice(0, 15),
    });
    if (rows.length > 0 && candidates.length === 0) {
      const fields = Object.keys(rows[0]).slice(0, 15).join(",");
      const unreadable = new Error(`unreadable Lens answer: ${rows.length} rows under "${listKey}", none with an image URL; row fields: ${fields}`);
      unreadable.name = "UnreadableAnswer";
      return searchFailed("lens", "serper", null, unreadable, "identity");
    }

    return buildShoppingMatch(await pricesInUsd(candidates));
  } catch (err) {
    return searchFailed("lens", "serper", null, err, "identity");
  }
}

const STOPWORDS = new Set([
  "the", "a", "an", "for", "with", "and", "or", "of", "to", "in", "on", "at",
  "new", "best", "pro", "set", "kit", "pack", "piece", "pcs", "premium",
]);

function significantWords(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// Keeps a shopping-search candidate only if its title shares enough of the
// query's SIGNIFICANT words — not just an overlapping generic category term.
// Short queries (2-3 significant words) require ALL of them; longer queries
// (full page titles, which carry marketing filler) only need a majority.
// If filtering would wipe out every result, returns the original list
// unfiltered — a loose match plus the downstream visual verification gate
// is better than no result at all.
function filterRelevantCandidates(candidates: ShoppingCandidate[], query: string): ShoppingCandidate[] {
  const queryWords = significantWords(query);
  if (queryWords.length <= 1) return candidates;

  const required = queryWords.length <= 3 ? queryWords.length : Math.ceil(queryWords.length * 0.6);
  const filtered = candidates.filter(c => {
    const titleWords = new Set(significantWords(c.title));
    const overlap = queryWords.filter(w => titleWords.has(w)).length;
    return overlap >= required;
  });

  return filtered.length > 0 ? filtered : candidates;
}

// A shorter, blunter fallback query — top N significant words only. Used
// when a rich/specific query returns nothing: sometimes "most specific
// possible" is too narrow for what's actually listed elsewhere online.
function simplifyQuery(text: string, maxWords = 4): string {
  return significantWords(text).slice(0, maxWords).join(" ");
}

// ════════════════════════════════════════════════════════════════
// LAYER 4 + 5: Shopping text search (store-targeted, then generic)
// ════════════════════════════════════════════════════════════════
async function searchShoppingViaSerper(query: string, severity: Severity = "identity"): Promise<ShoppingMatch | null> {
  if (!process.env.SERPER_API_KEY) return null;
  try {
    const res = await searchFetch("shopping", "serper", "shopping", "https://google.serper.dev/shopping", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": process.env.SERPER_API_KEY },
      body: JSON.stringify({ q: query, gl: "us", hl: "en", num: 10 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return searchFailed("shopping", "serper", res, null, severity);
    const data = await res.json();
    noteSearchCredits("serper", data?.credits);

    // A text shopping search is a PRICE source, so a row with no price
    // contributes nothing here — unlike a Lens visual match, which is an
    // IDENTIFICATION source and is kept whether it carries a price or not.
    // What is no longer done is the price sort: the engine's own relevance
    // order is what decides which rows the verification gate looks at, and
    // sorting by price meant a correct match could only be identified if
    // it also happened to be the cheapest thing in the response. The
    // cheapest CONFIRMED row is still what wins — chosen after
    // identification, in verifyCandidates, rather than before it.
    const priced = ((data.shopping || []) as Record<string, unknown>[])
      .map((r) => {
        const listed = listedPrice(r.price, r.extractedPrice);
        return {
          price: listed.amount,
          currency: listed.currency || undefined,
          title: String(r.title || ""),
          imageUrl: String(r.imageUrl || r.thumbnailUrl || ""),
          productUrl: String(r.link || ""),
          source: String(r.source || ""),
        };
      })
      .filter((r) => r.price > 0.5 && r.imageUrl);
    const results: ShoppingCandidate[] = priced.map((r, i) => ({ ...r, rank: i }));

    return buildShoppingMatch(filterRelevantCandidates(await pricesInUsd(results), query));
  } catch (err) {
    return searchFailed("shopping", "serper", null, err, severity);
  }
}

async function searchShoppingViaSerpApi(query: string, severity: Severity = "identity"): Promise<ShoppingMatch | null> {
  if (!process.env.SERPAPI_KEY) return null;
  try {
    const params = new URLSearchParams({
      engine: "google_shopping", q: query, api_key: process.env.SERPAPI_KEY,
      num: "10", gl: "us", hl: "en",
    });
    const res = await searchFetch("shopping", "serpapi", "google_shopping", `https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return searchFailed("shopping", "serpapi", res, null, severity);
    const data = await res.json();
    const failure = serpApiError(data);
    if (failure) return searchFailed("shopping", "serpapi", null, new Error(failure), severity);

    // Relevance order preserved, price sort removed — same reasoning as
    // the Serper shopping path above.
    const results: ShoppingCandidate[] = ((data.shopping_results || []) as Record<string, unknown>[])
      .map((r) => ({ row: r, listed: listedPrice(r.price, r.extracted_price) }))
      .filter(({ row, listed }) => listed.amount > 0.5 && row.thumbnail)
      .map(({ row: r, listed }, i) => ({
        price: listed.amount,
        currency: listed.currency || undefined,
        title: String(r.title || ""),
        imageUrl: String(r.thumbnail || ""),
        productUrl: String(r.product_link || r.link || ""),
        source: String(r.source || ""),
        productId: r.product_id ? String(r.product_id) : undefined,
        rank: i,
      }));

    return buildShoppingMatch(filterRelevantCandidates(await pricesInUsd(results), query));
  } catch (err) {
    return searchFailed("shopping", "serpapi", null, err, severity);
  }
}

// ════════════════════════════════════════════════════════════════
// DIRECT-RETAILER LAYER — the general fix, not an Amazon special case.
//
// Google's Shopping graph is not a neutral index of the whole internet.
// Several of the largest retailers deliberately limit how much of their
// catalog surfaces there, because each wants searches happening on their
// own site, not leaking traffic through Google. For a mainstream product
// enough secondary indexing usually exists that a listing leaks through
// anyway. For a smaller or less-searched product, it frequently does not
// — the only thing the generic search sees is whatever the brand itself
// is paying to promote, while a genuinely cheaper listing on a major
// retailer sits completely invisible to that search. That is exactly
// backwards for a tool that exists to catch inflated direct pricing.
//
// The correct fix is not attempting to out-engineer anti-bot systems on
// arbitrary sites — that is a losing, constantly-breaking arms race, and
// on many sites amounts to circumventing access controls the site put up
// on purpose, which is not something to build. SerpApi's job is exactly
// this: legally, reliably retrieving structured data from these
// retailers' own search systems, maintaining that infrastructure so this
// product does not have to. This is a list of direct-retailer engines
// run in parallel on every scan, generalized so adding a fourth or fifth
// retailer later is one array entry, not a new function.
// ════════════════════════════════════════════════════════════════

interface RetailerProvider {
  name: string;
  engine: string;
  extraParams: Record<string, string>;
  parse: (data: Record<string, unknown>) => Array<{ price: number; title: string; imageUrl: string; productUrl: string; productId?: string }>;
}

const DIRECT_RETAILERS: RetailerProvider[] = [
  {
    name: "Amazon",
    engine: "amazon",
    extraParams: { amazon_domain: "amazon.com" },
    parse: (data) => {
      const results = (data.organic_results as Record<string, unknown>[]) || [];
      return results
        .map(r => ({ r, price: listedPrice(r.price, r.extracted_price).amount }))
        .filter(({ r, price }) => price > 0.5 && r.thumbnail)
        .map(({ r, price }) => ({
          price,
          title: String(r.title || ""),
          imageUrl: String(r.thumbnail || ""),
          productUrl: String(r.link || r.link_clean || ""),
          productId: r.asin ? String(r.asin) : undefined,
        }));
    },
  },
  {
    name: "Walmart",
    engine: "walmart",
    extraParams: {},
    parse: (data) => {
      const results = (data.organic_results as Record<string, unknown>[]) || [];
      return results
        .filter(r => typeof r.primary_offer === "object" && r.primary_offer !== null)
        .map(r => {
          const offer = r.primary_offer as Record<string, unknown>;
          return {
            price: typeof offer.offer_price === "number" ? offer.offer_price : 0,
            title: String(r.title || ""),
            imageUrl: String(r.thumbnail || ""),
            productUrl: String(r.product_page_url || ""),
            productId: r.us_item_id ? String(r.us_item_id) : undefined,
          };
        })
        .filter(r => r.price > 0.5 && r.imageUrl);
    },
  },
  {
    name: "eBay",
    engine: "ebay",
    extraParams: { _nkw: "" }, // overwritten with the real query at call time
    parse: (data) => {
      const results = (data.organic_results as Record<string, unknown>[]) || [];
      return results
        .filter(r => typeof r.price === "object" && r.price !== null)
        .map(r => {
          const price = r.price as Record<string, unknown>;
          return {
            price: typeof price.extracted === "number" ? price.extracted : 0,
            title: String(r.title || ""),
            imageUrl: String(r.thumbnail || ""),
            productUrl: String(r.link || ""),
            productId: r.epid ? String(r.epid) : undefined,
          };
        })
        .filter(r => r.price > 0.5 && r.imageUrl);
    },
  },
];

async function searchDirectRetailer(provider: RetailerProvider, query: string): Promise<ShoppingMatch | null> {
  if (!process.env.SERPAPI_KEY) return null;
  try {
    const baseParams: Record<string, string> = {
      engine: provider.engine,
      api_key: process.env.SERPAPI_KEY,
      ...provider.extraParams,
    };
    // Each engine names its query parameter differently.
    if (provider.engine === "amazon") baseParams.k = query;
    else if (provider.engine === "ebay") baseParams._nkw = query;
    else baseParams.query = query;

    const params = new URLSearchParams(baseParams);
    const res = await searchFetch("retailer", "serpapi", provider.engine, `https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return searchFailed("retailer", "serpapi", res, null, "advisory");
    const data = await res.json();
    const failure = serpApiError(data);
    if (failure) return searchFailed("retailer", "serpapi", null, new Error(failure), "advisory");

    // The retailer's own relevance ranking is a better first guess at
    // WHICH product this is than its price is, so that order is kept and
    // the cheapest verified listing is picked downstream, after the gate.
    const results: ShoppingCandidate[] = provider.parse(data)
      .map((r, i) => ({ ...r, source: provider.name, rank: i }));

    return buildShoppingMatch(filterRelevantCandidates(results, query));
  } catch (err) {
    return searchFailed("retailer", "serpapi", null, err, "advisory");
  }
}

// Runs every direct-retailer provider in parallel and merges what they
// found into ONE pool, interleaved by each retailer's own relevance rank, for
// the gate to judge. It used to keep only the retailer whose cheapest row was
// cheapest and throw the others away before anything looked at them, so an
// eBay page of unrelated cheap listings beat the Amazon page that carried
// the product: price deciding identity again, one layer down. `source` names
// the retailer of the pool's lead; the verified winner carries its own.
async function searchAllDirectRetailers(query: string): Promise<{ match: ShoppingMatch; source: string } | null> {
  // Off by default, and never below the SerpApi reserve when on: see
  // SEARCH PROVIDERS, BUDGET MODE.
  if (!retailerSweepOn() || !(await serpApiAllowed(DIRECT_RETAILERS.length))) return null;
  const attempts = await Promise.all(DIRECT_RETAILERS.map(provider => searchDirectRetailer(provider, query)));
  const pools = attempts.filter((m): m is ShoppingMatch => m !== null).map(m => m.candidates);
  if (pools.length === 0) return null;
  const merged: ShoppingCandidate[] = [];
  for (let i = 0; pools.some(p => i < p.length); i++) {
    for (const pool of pools) if (i < pool.length) merged.push({ ...pool[i], rank: merged.length });
  }
  const match = buildShoppingMatch(merged);
  return match ? { match, source: match.source } : null;
}

// v9: tries progressively simpler queries instead of giving up after one.
// A highly specific enriched query is great when it works, but "most
// specific possible" can mean "matches nothing" for a niche product. This
// is the core fix for a valid product URL/screenshot coming back with no
// match at all — retry with the plain title, then a blunt top-words query,
// before conceding nothing can be found.
async function searchShoppingWithFallbacks(
  queries: string[],
  // "identity" while the search is what identifies the product; "advisory"
  // once it is identified and the search only looks for a price or a cheaper
  // copy. A pricing search timing out is not a reason to tell someone their
  // scan could not be completed, which is what it used to do.
  severity: Severity = "identity"
): Promise<{ match: ShoppingMatch; engineUsed: string } | null> {
  const seen = new Set<string>();
  for (const raw of queries) {
    const q = (raw || "").trim();
    if (!q || q.length < 3 || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());

    const { value: match, index } = await firstAnswer("shopping", [
      { configured: !!process.env.SERPER_API_KEY, run: () => searchShoppingViaSerper(q, severity) },
      { configured: () => serpApiAllowed(), run: () => searchShoppingViaSerpApi(q, severity) },
    ], { onEmpty: "stop" });
    if (match) return { match, engineUsed: index === 0 ? "serper" : "serpapi" };
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
// Candidate lists are no longer price-ordered, so nothing here may be read
// positionally. `candidates` arrives in the engine's own best-match-first
// order and stays that way, because that order is what the identification
// gate needs; the price range is computed across the whole list instead of
// being taken from its two ends, and the list may legitimately contain
// records with no price at all.
//
// The pre-verification lead is still the cheapest priced record — what it
// has always been — and lowestPrice is still that same record's own price
// rather than a minimum borrowed from a different row, because price and
// link have to come from one record (see applyVerifiedCandidate). Every
// path that has a reference image overwrites this lead with the verified
// winner. The one path that does not is a URL scan of a page with no
// usable product photo, where there is no visual identification signal to
// prefer and "cheapest relevant listing" is the honest answer.
// ════════════════════════════════════════════════════════════════
function buildShoppingMatch(candidates: ShoppingCandidate[]): ShoppingMatch | null {
  if (candidates.length === 0) return null;
  const priced = candidates.filter(c => c.price > 0);
  const lead = priced.length > 0
    ? priced.reduce((best, c) => (c.price < best.price ? c : best), priced[0])
    : candidates[0];
  return {
    title: lead.title,
    lowestPrice: lead.price,
    priceCurrency: statedCurrencyOf(lead),
    highestPrice: priced.length > 0 ? Math.max(...priced.map(c => c.price)) : 0,
    imageUrl: lead.imageUrl,
    productUrl: lead.productUrl,
    source: lead.source,
    productId: lead.productId,
    candidates,
  };
}

// ════════════════════════════════════════════════════════════════
// v9 FIX 1 — price/link consistency.
// Once verifyCandidates() picks a "best" candidate, EVERY field shown to
// the person — price, image, url, title, source — must come from that
// SAME candidate record. The previous version spread the verified
// candidate's fields onto the match but then separately recalculated
// lowestPrice as the minimum across ALL original candidates, which could
// be a DIFFERENT candidate than the one whose link/image was kept. That's
// exactly "price from one listing, link to a different listing."
// highestPrice is left as the original range's top end deliberately — it
// only ever feeds a retail ESTIMATE, which carries no link, so it isn't
// subject to the same must-match-the-link constraint.
//
// v10 FIX — the verified candidate is not necessarily the cheapest one in
// the list. Overwriting lowestPrice with a candidate priced above the
// original range's top end produced an inverted range (lowest > highest),
// which downstream reads as a negative markup and a negative "savings"
// number on a FINDER card. The range is re-widened so it always contains
// the price actually being shown.
// ════════════════════════════════════════════════════════════════
function applyVerifiedCandidate(
  match: ShoppingMatch,
  verified: { best: ShoppingCandidate; confidence: "exact" | "likely" | "unverified" }
): ShoppingMatch {
  return {
    ...match,
    title: verified.best.title,
    imageUrl: verified.best.imageUrl,
    productUrl: verified.best.productUrl,
    source: verified.best.source,
    productId: verified.best.productId,
    lowestPrice: verified.best.price,
    priceCurrency: statedCurrencyOf(verified.best),
    highestPrice: Math.max(match.highestPrice, verified.best.price),
  };
}

// ════════════════════════════════════════════════════════════════
// Merchant-link resolution — SerpApi/Serper shopping results sometimes
// link to a Google search/product page rather than the actual merchant.
// ════════════════════════════════════════════════════════════════
function isGoogleDomain(url: string): boolean {
  if (!url) return true;
  try {
    return new URL(url).hostname.includes("google.");
  } catch {
    return true;
  }
}

// NOTE: response shape (sellers_results.online_sellers[].link) is SerpApi's
// documented Google Product API pattern — not verified against a live
// response from here, so it degrades to null rather than throwing.
async function resolveSerpApiMerchantLink(productId: string): Promise<string | null> {
  if (!process.env.SERPAPI_KEY || !productId) return null;
  try {
    const params = new URLSearchParams({
      engine: "google_product",
      product_id: productId,
      api_key: process.env.SERPAPI_KEY,
      gl: "us", hl: "en",
    });
    const res = await searchFetch("link", "serpapi", "google_product", `https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return searchFailed("link", "serpapi", res, null, "advisory");
    const data = await res.json();
    const failure = serpApiError(data);
    if (failure) return searchFailed("link", "serpapi", null, new Error(failure), "advisory");
    const sellers: Record<string, unknown>[] = data.sellers_results?.online_sellers || [];
    const direct = sellers.find(s => typeof s.link === "string" && !isGoogleDomain(String(s.link)));
    return direct ? String(direct.link) : null;
  } catch (err) {
    return searchFailed("link", "serpapi", null, err, "advisory");
  }
}

async function resolveMerchantLink(url: string, productId?: string): Promise<{ url: string; isDirect: boolean }> {
  if (url && !isGoogleDomain(url)) return { url, isDirect: true };
  // Only SerpApi's results carry a product id, so this runs only after
  // Serper failed, and only above the reserve.
  if (productId && await serpApiAllowed()) {
    const resolved = await resolveSerpApiMerchantLink(productId);
    if (resolved) return { url: resolved, isDirect: true };
  }
  // No genuine direct merchant link could be resolved. Returning the raw
  // Google-hosted URL as a last resort is still better than no link at all,
  // but it must never be labeled as if it goes straight to the product —
  // that is exactly the "it just searched it in Google" complaint a real
  // user hit. isDirect: false lets the UI be honest about which kind of
  // link this actually is.
  return { url: url || "", isDirect: false };
}

// ════════════════════════════════════════════════════════════════
// PRODUCT-PAGE DISCOVERY — when a screenshot shows a store name, seller
// handle, or a visible URL, try to find and read the ACTUAL product page
// before falling back to a generic text search.
// ════════════════════════════════════════════════════════════════
const SEARCH_EXCLUDED_DOMAINS = [
  "google.", "facebook.com", "instagram.com", "tiktok.com", "pinterest.com",
  "youtube.com", "twitter.com", "x.com", "reddit.com", "linkedin.com",
];

function isExcludedSearchDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return SEARCH_EXCLUDED_DOMAINS.some(d => host.includes(d));
  } catch {
    return true;
  }
}

function normalizeUrlCandidate(raw: string): string | null {
  const candidate = raw.trim();
  if (!candidate) return null;
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.hostname.includes(".") ? withScheme : null;
  } catch {
    return null;
  }
}

async function searchOrganicViaSerper(query: string): Promise<string[]> {
  if (!process.env.SERPER_API_KEY) return [];
  try {
    const res = await searchFetch("shopping", "serper", "search", "https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": process.env.SERPER_API_KEY },
      body: JSON.stringify({ q: query, gl: "us", hl: "en", num: 5 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { await searchFailed("shopping", "serper", res, null, "identity"); return []; }
    const data = await res.json();
    noteSearchCredits("serper", data?.credits);
    const organic: Record<string, unknown>[] = data.organic || [];
    return organic.map(r => String(r.link || "")).filter(Boolean);
  } catch (err) {
    await searchFailed("shopping", "serper", null, err, "identity");
    return [];
  }
}

async function searchOrganicViaSerpApi(query: string): Promise<string[]> {
  if (!process.env.SERPAPI_KEY) return [];
  try {
    const params = new URLSearchParams({
      engine: "google", q: query, api_key: process.env.SERPAPI_KEY, num: "5", gl: "us", hl: "en",
    });
    const res = await searchFetch("shopping", "serpapi", "google", `https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) { await searchFailed("shopping", "serpapi", res, null, "identity"); return []; }
    const data = await res.json();
    const failure = serpApiError(data);
    if (failure) { await searchFailed("shopping", "serpapi", null, new Error(failure), "identity"); return []; }
    const organic: Record<string, unknown>[] = data.organic_results || [];
    return organic.map(r => String(r.link || "")).filter(Boolean);
  } catch (err) {
    await searchFailed("shopping", "serpapi", null, err, "identity");
    return [];
  }
}

async function findStoreProductUrl(storeName: string, brand: string, productName: string): Promise<string | null> {
  const bareStoreName = storeName.replace(/^@/, "").trim();
  const looksLikeDomain = /\.[a-z]{2,}$/i.test(bareStoreName) && !bareStoreName.includes(" ");
  const query = looksLikeDomain
    ? `site:${bareStoreName.replace(/^https?:\/\//i, "").replace(/^www\./i, "")} ${productName}`
    : `${bareStoreName} ${brand} ${productName}`.trim();

  const { value: found } = await firstAnswer("shopping", [
    { configured: !!process.env.SERPER_API_KEY, run: async () => { const l = await searchOrganicViaSerper(query); return l.length ? l : null; } },
    { configured: () => serpApiAllowed(), run: async () => { const l = await searchOrganicViaSerpApi(query); return l.length ? l : null; } },
  ], { onEmpty: "stop" });
  const links = found || [];

  const candidate = links.find(l => !isExcludedSearchDomain(l));
  return candidate || null;
}

// Social-platform redirect links (Instagram's /s/ swipe-up shortlinks,
// TikTok's t.tiktok.com shortlinks, generic link-in-bio shorteners) resolve
// to a JS-rendered interstitial, not real product HTML — fetching them
// wastes a round trip and never produces usable data. When a visible URL
// matches one of these, treat it as a signal (platform confirmed) rather
// than a fetchable page, and go straight to store-name search discovery.
const REDIRECT_ONLY_DOMAINS = ["instagram.com/s/", "t.tiktok.com", "vm.tiktok.com", "lnk.bio", "linktr.ee"];

function isRedirectOnlyUrl(url: string): boolean {
  return REDIRECT_ONLY_DOMAINS.some(d => url.includes(d));
}

async function discoverAndFetchProductPage(vision: VisionExtraction): Promise<PageProductData | null> {
  let targetUrl: string | null = null;

  if (vision.visibleUrl && !isRedirectOnlyUrl(vision.visibleUrl)) {
    targetUrl = normalizeUrlCandidate(vision.visibleUrl);
  }
  if (!targetUrl && vision.storeName) {
    targetUrl = await findStoreProductUrl(vision.storeName, vision.brand, vision.productName);
  }
  if (!targetUrl) return null;

  const html = await fetchProductPageHtml(targetUrl);
  if (!html) return null;

  const pageData = await extractPageProductData(html);
  if (!pageData.title && !pageData.price) return null;

  return pageData;
}

// ════════════════════════════════════════════════════════════════
// LAYER 7: Category-average fallback — always an explicit estimate
// ════════════════════════════════════════════════════════════════
const CATEGORY_DATA: Record<string, { wholesaleRatio: number; avgRetail: number }> = {
  beauty:      { wholesaleRatio: 0.11, avgRetail: 48 },
  skincare:    { wholesaleRatio: 0.09, avgRetail: 68 },
  fitness:     { wholesaleRatio: 0.13, avgRetail: 58 },
  tech:        { wholesaleRatio: 0.15, avgRetail: 85 },
  fashion:     { wholesaleRatio: 0.17, avgRetail: 62 },
  accessories: { wholesaleRatio: 0.12, avgRetail: 48 },
  home:        { wholesaleRatio: 0.14, avgRetail: 52 },
  pet:         { wholesaleRatio: 0.15, avgRetail: 42 },
  food:        { wholesaleRatio: 0.28, avgRetail: 28 },
  other:       { wholesaleRatio: 0.14, avgRetail: 52 },
};

// The image pipeline gets its category from the vision model. The URL
// pipeline has no vision step, so rather than spend another paid call on a
// field that only feeds analytics, it is inferred from the text the page
// already gave us. Deterministic, free, and using the exact same vocabulary
// the vision prompt uses so the two halves of the ledger stay comparable.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  skincare: ["serum", "moisturis", "moisturiz", "cleanser", "skincare", "retinol", "hyaluronic", "gua sha", "jade roller", "spf", "sunscreen", "toner"],
  beauty: ["makeup", "lipstick", "mascara", "foundation", "whitening", "lash", "nail", "hair", "shampoo", "perfume", "fragrance", "brush"],
  fitness: ["workout", "fitness", "gym", "dumbbell", "resistance band", "yoga", "massage gun", "treadmill", "protein"],
  tech: ["charger", "earbud", "headphone", "bluetooth", "usb", "laptop", "phone case", "camera", "speaker", "smart watch", "led", "projector"],
  fashion: ["dress", "shirt", "hoodie", "jacket", "jeans", "shoes", "sneaker", "skirt", "coat", "sweater"],
  accessories: ["watch", "bag", "wallet", "sunglasses", "jewelry", "jewellery", "necklace", "bracelet", "ring", "belt", "earring"],
  home: ["diffuser", "lamp", "cushion", "kitchen", "blanket", "organiser", "organizer", "storage", "candle", "vacuum", "decor"],
  pet: ["dog", "cat", "pet", "puppy", "kitten", "leash", "litter", "aquarium"],
  food: ["snack", "coffee", "tea", "supplement", "vitamin", "powder", "gummies", "protein bar"],
};

function inferCategory(...parts: string[]): string {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  if (!text) return "other";
  let best = "other";
  let bestHits = 0;
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    const hits = words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0);
    if (hits > bestHits) {
      bestHits = hits;
      best = category;
    }
  }
  return best;
}

// Signed, so the proxy route will only ever fetch an image this engine
// chose to show. See src/lib/image-proxy.ts for why a signature rather
// than a rate limit.
function proxyImage(url: string): string {
  return proxyImagePath(url);
}

// Titles arrive from merchant listings and product pages, so they carry
// whatever punctuation and boilerplate the seller typed. Two things get
// normalized before the card renders one: em/en dashes (BustedLab renders
// none anywhere, and a stray one from a scraped title breaks the typographic
// signature the card is built on), and runaway length, since the evidence
// strip is a single ellipsized line and a 200-character SEO title tells the
// reader nothing the first 90 characters didn't.
function cleanTitle(raw: string): string {
  const normalized = (raw || "")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= 90) return normalized;
  return normalized.slice(0, 89).replace(/[\s,;:|-]+$/, "") + "\u2026";
}

// ════════════════════════════════════════════════════════════════
// THE IDENTIFICATION GATE.
//
// This function decides what the photo shows. Everything on the card —
// the price, the link, the markup, the verdict — is downstream of it, so
// it is the single most accuracy-critical function in the codebase. Four
// things about it are deliberate:
//
// 1. It reads candidates in the ENGINE's relevance order, not in price
//    order. Price order used to decide which five candidates got checked
//    at all, which made being cheap a precondition for being identified.
// 2. It reorders that list by the identity hints an earlier layer already
//    read off the photo — the brand, the product words — as a ranking
//    boost that never deletes anything. This is what puts a listing that
//    actually carries the brand on the photo ahead of an unrelated brand
//    with a similar shape.
// 3. It checks a WIDE window, in two waves. The first wave covers the
//    engine's top few; the second only runs when nothing in the first
//    came back "exact", which is exactly the case where the right answer
//    is sitting further down the list. A correct match at rank seven used
//    to be unreachable.
// 4. Within the best confidence tier it found, it picks the CHEAPEST
//    record. That one rule serves both questions this product answers:
//    "am I being overcharged" needs the real floor price for the thing in
//    the photo, and "where is it cheapest" needs the same floor price for
//    the same thing. Neither is served by a cheap listing for a different
//    object, which is what price-first ordering produced.
//
// When nothing verifies at all, it returns the engine's own best-ranked
// candidate and the caller labels it unverified. The old fallback returned
// candidates[0] of a price-sorted list: an arbitrary cheap item, presented
// as "closest match". That is how a clear photo of Ralph Lauren glasses
// came back as a completely unrelated brand.
// ════════════════════════════════════════════════════════════════
// How wide the gate looks. Two different numbers, because two different
// things are at stake.
//
// When IDENTITY is being established, the window is wide: this is where a
// correct match sitting at rank seven has to be reachable, and it is the
// whole reason the narrow window was a bug. Batching makes the width nearly
// free - two calls cover twelve candidates.
//
// When identity is already established and only a PRICE REPLACEMENT is at
// stake - the pricing search for a confirmed-but-unpriced product, the
// rebrand sweep, the direct-retailer sweep - the window is narrow. Those
// pools are searched with a name the gate has already confirmed, and the
// worst case for missing an entry is that the incumbent listing (already
// confirmed, already priced) is kept. Failing to find a cheaper copy of the
// right product is a smaller harm than naming the wrong product, and it is
// the only place in this engine where that asymmetry is used to save money.
const VERIFY_WAVE_ONE = 6;
const VERIFY_WINDOW = 12;
const VERIFY_WINDOW_PRICING = 4;

interface GateOptions {
  hints?: IdentityHints;
  budget?: Budget;
  /** Defaults to the wide identification window. */
  window?: number;
  /** "degraded" moves the gate to Sonnet 5.5 alone and caps what it may claim. */
  mode?: SpendMode;
  /** What this gate pass is deciding, for the evaluation trace. */
  purpose?: string;
}

/**
 * Does this candidate carry the brand the vision pass read off the photo?
 * Used twice: to pull such candidates forward in the queue, and - when the
 * gate has been degraded - as the second, independent signal without which a
 * degraded "exact" is not allowed to claim anything.
 */
function brandConsistent(candidate: ShoppingCandidate, hints?: IdentityHints): boolean {
  const brandWords = significantWords(hints?.brand || "");
  if (brandWords.length === 0) return false;
  const titleWords = new Set(significantWords(candidate.title));
  const sourceWords = new Set(significantWords(candidate.source));
  return brandWords.every(w => titleWords.has(w) || sourceWords.has(w));
}

// A free relevance boost, applied to the ORDER candidates are checked in
// and never used to remove any of them. The vision pass has already read
// the brand and the product words off the photo, so a candidate whose
// title or merchant carries that brand is likelier to be the same object
// than one that does not, and it deserves to be looked at first. It cannot
// manufacture a false positive on its own: every candidate it promotes
// still has to pass the visual gate to count for anything.
function rankForVerification(candidates: ShoppingCandidate[], hints?: IdentityHints): ShoppingCandidate[] {
  const brandWords = significantWords(hints?.brand || "");
  const nameWords = significantWords(hints?.productName || "");
  if (brandWords.length === 0 && nameWords.length === 0) return candidates;

  const scored = candidates.map((candidate, index) => {
    const titleWords = new Set(significantWords(candidate.title));
    const nameHits = nameWords.filter(w => titleWords.has(w)).length;
    // Engine rank stays the primary signal. A full brand match is worth
    // four places and each matching product word half a place: enough to
    // pull the right candidate into the first wave, never enough to bury a
    // strong visual match under keyword noise.
    const score = candidate.rank - (brandConsistent(candidate, hints) ? 4 : 0) - nameHits * 0.5;
    return { candidate, index, score };
  });

  scored.sort((a, b) => (a.score === b.score ? a.index - b.index : a.score - b.score));
  return scored.map(s => s.candidate);
}

type Verified = {
  best: ShoppingCandidate;
  confidence: "exact" | "likely" | "unverified";
  /** The other candidates the gate put in the same tier as `best`, in rank order. */
  tier?: ShoppingCandidate[];
};
type Checked = { candidate: ShoppingCandidate; result: VerificationResult; judge: string };

// Who judges, in order: Sonnet 5.5, then Opus 5.5 when Sonnet cannot answer.
// In degraded spend mode the degraded gate judges first and Opus 5.5 is
// called only if it cannot answer at all, so a budget-spent day never turns
// a Sonnet outage into failed scans. Either way the degraded cap in
// settleVerdict applies.
const gateChain = (options: GateOptions): string[] =>
  options.mode === "degraded" ? [GATE_MODEL_DEGRADED, GATE_MODEL_FALLBACK] : [GATE_MODEL, GATE_MODEL_FALLBACK];

/**
 * Judges candidates against the reference photo, in batches of up to
 * VERIFY_BATCH_MAX per call, walking the model chain for each batch.
 *
 * NEVER SILENTLY SKIP VERIFICATION. A batch no model could judge used to
 * come back as "different" verdicts, which is how a 400 on every gate call
 * became a confident-looking "closest match". Now each batch walks the chain
 * until a model answers:
 *   - a 5xx, or a 200 whose answer could not be read, is retried once on the
 *     same model, since the same request can succeed a second time;
 *   - a 4xx is not retried there (the same request gets the same 400), and
 *     neither is backpressure (the limit is still there), a refusal (the
 *     other model has different classifiers), a max_tokens stop (the same
 *     request stops in the same place) or a timeout: the next model gets it.
 * A batch no model could judge is recorded against the scan, and the scan
 * reports that it could not be completed unless the product was still
 * verified some other way. See scan-trace.ts.
 */
async function judgeCandidates(
  candidates: ShoppingCandidate[],
  reference: { data: string; mimeType: string },
  options: GateOptions
): Promise<Checked[]> {
  const chain = gateChain(options);
  const timeAllows = () => !options.budget || options.budget.allows(VERIFY_WAVE_COST_MS);
  const checked: Checked[] = [];
  const judgeSlice = async (urls: GateCandidate[]): Promise<{ outcome: BatchOutcome; judge: string }> => {
    let last: BatchOutcome = { results: urls.map(() => ({ match: "different", reasoning: "verification unavailable" })), ok: false };
    // Once every model in the chain has failed on this scan, the next batch
    // would only repeat the same failing calls and spend the clock doing it.
    // The failure is already recorded; this batch is simply not judged.
    if (hasFailed("gate")) return { outcome: last, judge: "" };
    for (let m = 0; m < chain.length; m++) {
      if (m > 0 && !timeAllows()) break;
      const model = chain[m];
      last = await verifyVisualMatchBatch(reference, urls, model);
      if (last.ok) return { outcome: last, judge: model };
      const kind = last.call?.kind;
      // The account, not the model, is refusing: every model on it will.
      if (kind === "spend_cap" || kind === "credit_exhausted") break;
      const sameModelAgain = kind === "server" || kind === "unparseable" || kind === "empty" || kind === undefined || kind === "ok";
      if (sameModelAgain && timeAllows()) {
        last = await verifyVisualMatchBatch(reference, urls, model);
        if (last.ok) return { outcome: last, judge: model };
      }
    }
    const failed = last.call;
    reportProviderFailure({
      layer: "gate", provider: "anthropic", model: failed?.model || chain[chain.length - 1],
      status: failed?.status ?? 0, kind: failed?.kind || "unjudged",
      detail: `no model in [${chain.join(", ")}] could judge ${urls.length} candidate(s): ${failed?.detail || "no answer"}`,
      severity: "identity",
    });
    return { outcome: last, judge: "" };
  };
  for (let i = 0; i < candidates.length; i += VERIFY_BATCH_MAX) {
    const slice = candidates.slice(i, i + VERIFY_BATCH_MAX);
    const { outcome, judge } = await judgeSlice(slice.map(c => ({ imageUrl: c.imageUrl, title: c.title, source: c.source })));
    // Every answer passes the match guards before anything acts on it.
    const results = slice.map((candidate, j) => guardResult(outcome.results[j], candidate, options.hints));
    slice.forEach((candidate, j) => checked.push({ candidate, result: results[j], judge }));
    traceStep("gate", {
      purpose: options.purpose || "identify",
      judge: judge || null,
      loaded: outcome.loaded ?? null,
      candidates: slice.map((c, j) => ({
        ...traceCandidate(c),
        match: results[j]?.match,
        tie: results[j]?.tie ?? null,
        ...(results[j]?.guard ? { gate: results[j].gateMatch, guard: results[j].guard } : {}),
        why: String(results[j]?.reasoning || "").slice(0, 160),
      })),
    });
  }
  return checked;
}

/**
 * What the first read saw, as the match guards take it. A link scan has no
 * first read (its hints carry no brand field at all), so the brand rules
 * have nothing to compare there; a photo scan always passes its brand, read
 * or empty.
 */
function guardReadOf(hints?: IdentityHints): GuardRead {
  return { brand: hints?.brand, productName: hints?.productName || "" };
}

/** One gate answer after the match guards (see match-guards.ts). */
function guardResult(
  result: VerificationResult,
  candidate: Pick<ShoppingCandidate, "title" | "source" | "productUrl">,
  hints?: IdentityHints
): VerificationResult {
  if (!result) return result;
  const { match, guard } = guardMatch(
    { match: result.match, tie: result.tie, why: result.reasoning },
    { title: candidate.title, source: candidate.source, link: candidate.productUrl },
    guardReadOf(hints)
  );
  return guard ? { ...result, match, gateMatch: result.match, guard } : result;
}

/** A candidate as the evaluation trace shows it: enough to judge it, and to replay it. */
function traceCandidate(c: ShoppingCandidate): Record<string, unknown> {
  return {
    rank: c.rank, title: c.title.slice(0, 120), source: c.source.slice(0, 60), price: c.price,
    link: c.productUrl.slice(0, 200), image: c.imageUrl.slice(0, 300),
  };
}

/**
 * Turns judged candidates into one answer.
 *
 * The two tiers are not the same decision, and treating them as one would
 * smuggle the original bug back in a smaller form.
 *
 * "exact" means identity is CONFIRMED, so the cheapest confirmed record
 * wins: identity first, price second. Every record in that tier is the same
 * object, so choosing the cheapest is choosing a better price for the thing
 * in the photo, which is what both intents want.
 *
 * "similar" means identity is NOT confirmed — same category, or same brand,
 * nothing more. In that tier the engine's own ranking is the strongest
 * evidence available, and price must not override it: a cheaper lookalike
 * eight places down is not a better price, it is a likelier wrong product
 * wearing a smaller number. So the best-ranked record wins there, preferring
 * one that publishes a price because a record without one cannot carry the
 * figure on the card.
 *
 * In both tiers, when the chosen record has no price at all — normal for
 * Lens, where the best match is often a brand's own page — the caller prices
 * it with a second, now-accurate search (priceVerifiedIdentity).
 */
function settleVerdict(checked: Checked[], ordered: ShoppingCandidate[], options: GateOptions): Verified {
  const verified = settleVerdictOf(checked, ordered, options);
  traceStep("settled", {
    purpose: options.purpose || "identify", confidence: verified.confidence,
    ...(verified.best ? traceCandidate(verified.best) : {}),
  });
  return verified;
}

function settleVerdictOf(checked: Checked[], ordered: ShoppingCandidate[], options: GateOptions): Verified {
  const pick = (tier: VerificationResult["match"], rule: "cheapest" | "best-ranked"): Checked | null => {
    // `checked` is in ranked order, so index 0 of a tier is its best-ranked
    // member.
    const inTier = checked.filter(c => c.result.match === tier);
    if (inTier.length === 0) return null;
    const priced = inTier.filter(c => c.candidate.price > 0);
    return rule === "best-ranked" || priced.length === 0
      ? (priced[0] || inTier[0])
      : priced.reduce((best, c) => (c.candidate.price < best.candidate.price ? c : best), priced[0]);
  };

  // DEGRADED CONFIDENCE. When the spend governor has degraded the engine,
  // the gate runs on the cheaper path and is no longer allowed to say
  // "exact": the card's strongest label has to mean what it says, and it
  // was calibrated on the full gate. Its best available answer becomes
  // "likely", and only for a candidate that ALSO carries the brand read off
  // the photo, which is a second signal the model did not produce. Anything
  // less corroborated is "unverified", which still returns a full FINDER
  // result and simply never carries a markup accusation. That is the honest
  // shape of "we are running cheap right now", and it is why degrading is
  // survivable: the product keeps answering, it just stops making its
  // strongest claim. Outside degraded mode, Sonnet 5.5 standing in for a
  // failed Opus 5.5 is a full-strength gate, by the owner's decision.
  const settle = (picked: Checked, confidence: "exact" | "likely"): Verified => {
    const { candidate } = picked;
    const tier = checked.filter(c => c.result.match === picked.result.match && c.candidate !== candidate).map(c => c.candidate);
    if (options.mode !== "degraded") return { best: candidate, confidence, tier };
    if (brandConsistent(candidate, options.hints)) return { best: candidate, confidence: "likely" };
    return { best: candidate, confidence: "unverified" };
  };

  const exact = pick("exact", "cheapest");
  if (exact) return settle(exact, "exact");
  const likely = pick("likely", "best-ranked");
  if (likely) return settle(likely, "likely");

  // Nothing identified. "similar" is a lookalike (the same kind of product,
  // not this one), so it never becomes a match; it is only the better
  // candidate to show as the closest lookalike, labeled unverified. After
  // it, the engine's own top-ranked candidate, never the cheapest arbitrary
  // one. A priced record is preferred only because a record with no price
  // cannot carry the one number this product exists to show; if none of them
  // has a price, the top-ranked one is returned and the caller refuses to
  // invent a number for it.
  const lookalike = pick("similar", "best-ranked");
  if (lookalike && lookalike.candidate.price > 0) return { best: lookalike.candidate, confidence: "unverified" };
  return { best: ordered.find(c => c.price > 0) || ordered[0], confidence: "unverified" };
}

// ════════════════════════════════════════════════════════════════
// NOT EVERY PAGE THAT SHOWS THE PRODUCT IS SELLING IT.
//
// Google Lens answers "where else does this picture appear", and for a photo
// that has been published anywhere, the best answers are the pages that
// published it: a Wikipedia article, a news story, a Reddit thread. The gate
// rightly called those "exact" (it is literally the same picture), and the
// engine then treated a USA Today headline as the product's name, searched
// for a price with it, and found nothing; that is how a photo of Crocs Baya
// clogs came back "not identified". Pages on hosts that never sell anything
// are left out of the window here, before any model looks at them; the gate
// prompt rules out the long tail (any other article, post or forum) by its
// title. A page with the same picture still proves nothing about which
// LISTING is the product, which is the only thing the card can show.
// ════════════════════════════════════════════════════════════════
const NON_LISTING_HOSTS = [
  "wikipedia.org", "wikimedia.org", "wikiwand.com", "fandom.com", "reddit.com", "pinterest.",
  "youtube.com", "youtu.be", "instagram.com", "tiktok.com", "twitter.com", "x.com", "threads.net",
  "tumblr.com", "flickr.com", "imgur.com", "quora.com", "medium.com", "substack.com", "deviantart.com",
  "artstation.com", "behance.net", "dribbble.com", "cgtrader.com", "sketchfab.com", "turbosquid.com",
  "manuals.plus", "manualslib.com",
];

export function isListingCandidate(candidate: { productUrl: string; source?: string }): boolean {
  let host = "";
  let path = "";
  try {
    const url = new URL(candidate.productUrl);
    host = url.hostname.toLowerCase();
    path = url.pathname;
  } catch {
    return true; // no URL to judge by: the gate judges it
  }
  // Facebook sells only on Marketplace; the rest of it is posts.
  if (host === "facebook.com" || host.endsWith(".facebook.com")) return path.startsWith("/marketplace/");
  return !NON_LISTING_HOSTS.some(h => (h.endsWith(".") ? host.includes(h) : host === h || host.endsWith(`.${h}`)));
}

/**
 * The price an identified listing states on its own page, from the page's
 * structured data only (schema.org Product offers, microdata, product meta
 * tags), never from a model reading the page. Lens often returns the right
 * listing with no price - a brand's own store is the usual case - and the
 * page itself carries one. Price and link then come from the same record,
 * which is the rule everything else on the card follows.
 */
async function priceFromListingPage(url: string): Promise<{ usd: number; amount: number; currency: string } | null> {
  if (!url || isGoogleDomain(url)) return null;
  const html = await fetchProductPageHtml(url);
  if (!html) return null;
  const jsonLd = extractJsonLdProduct(html);
  const micro = extractMicrodataPrice(html);
  const meta = extractMetaProduct(html);
  const amount = jsonLd.price ?? micro.price ?? meta.price ?? null;
  const currency = normalizeCurrency(jsonLd.currency || micro.currency || meta.currency || "");
  // A price with no stated currency is not converted by guesswork.
  if (!amount || !(amount > 0) || !currency) return null;
  if (currency === "USD") return { usd: amount, amount, currency };
  const converted = await toUsd(amount, currency);
  return converted && converted.usd > 0.5 ? { usd: converted.usd, amount, currency } : null;
}

/** A candidate pool after the gate, before it is settled into one answer. */
interface JudgedPool {
  pool: ShoppingMatch;
  /** The listings sent to the gate, in the order they were judged. */
  ordered: ShoppingCandidate[];
  checked: Checked[];
}

async function judgePool(
  match: ShoppingMatch,
  reference: { data: string; mimeType: string },
  options: GateOptions = {}
): Promise<JudgedPool> {
  const window = options.window ?? VERIFY_WINDOW;
  const ordered = rankForVerification(match.candidates.filter(isListingCandidate), options.hints).slice(0, window);
  if (ordered.length === 0) return { pool: match, ordered, checked: [] };

  const checked = await judgeCandidates(ordered.slice(0, VERIFY_WAVE_ONE), reference, options);

  // Second wave, only when the first produced no confirmed identity. A
  // buried correct match is precisely what a narrow window misses, and it
  // is worth the extra call. When the top of the list has already
  // confirmed, spending it would only be hunting for a cheaper copy of
  // something the direct-retailer layer downstream already hunts for.
  const secondWave = ordered.slice(VERIFY_WAVE_ONE);
  const confirmed = checked.some(c => c.result.match === "exact");
  if (!confirmed && secondWave.length > 0 && (!options.budget || options.budget.allows(VERIFY_WAVE_COST_MS))) {
    checked.push(...(await judgeCandidates(secondWave, reference, options)));
  }
  return { pool: match, ordered, checked };
}

function settlePool(judged: JudgedPool, options: GateOptions): Verified {
  if (judged.ordered.length === 0) return { best: judged.pool.candidates[0], confidence: "unverified" };
  return settleVerdict(judged.checked, judged.ordered, options);
}

async function verifyCandidates(
  match: ShoppingMatch,
  reference: { data: string; mimeType: string },
  options: GateOptions = {}
): Promise<Verified> {
  return settlePool(await judgePool(match, reference, options), options);
}

// ════════════════════════════════════════════════════════════════
// ESCALATION: THE CHEAPEST PROVIDER FIRST, THE BETTER ONE WHEN THE CHEAP
// ONE CANNOT VERIFY.
//
// Serper's Lens costs three credits, a fraction of a cent, and answers most
// scans. What it does not return is Google's "exact matches": the pages that
// show this very photo, which is where SerpApi found the right listing for
// the Yellowstone hat and the Flowgun Air in the production evaluation. So
// when not one candidate Serper brought survives the gate and its guards (no
// "exact", no "likely"), SerpApi's Lens is asked once, the listings it adds
// are judged the same way, and the two sets are settled together.
//
// It runs only while SerpApi has more than SERPAPI_RESERVE searches left
// this month (an unknown balance is not one: see serpApiAllowed), only when
// the time budget leaves room for a search and a gate wave, never on a
// degraded day (its model budget is spent), and never when SerpApi already
// answered this scan. Every run and every skip is an
// "escalation" trace step, the search is counted like any other, and a
// SerpApi failure here is logged and recorded as advisory: the scan still
// has Serper's answer.
// ════════════════════════════════════════════════════════════════
const ESCALATION_COST_MS = 14_000 + VERIFY_WAVE_COST_MS;

async function escalateLens(
  image: { data: string; mimeType: string },
  first: JudgedPool | null,
  reference: { data: string; mimeType: string },
  gate: GateOptions,
  budget: Budget
): Promise<{ pool: ShoppingMatch; verified: Verified; fromEscalation: boolean } | null> {
  // `skip` is what /api/stats counts the skip under (see scanCostFacts in
  // analytics.ts); `reason` is for a person reading the trace.
  const skip = (code: "no_key" | "degraded" | "time" | "reserve" | "upload", reason: string): null => {
    traceStep("escalation", { to: "serpapi", ran: false, skip: code, reason });
    return null;
  };
  if (!process.env.SERPAPI_KEY) return skip("no_key", "no SerpApi key");
  // A degraded day has spent its model budget: no extra gate waves on it.
  if (gate.mode === "degraded") return skip("degraded", "degraded: the day's model budget is spent");
  if (!budget.allows(ESCALATION_COST_MS)) return skip("time", "time budget");
  if (!(await serpApiAllowed(1))) return skip("reserve", "SerpApi at its reserve, or its balance unknown");
  const url = await uploadForLensSearch(image.data, image.mimeType);
  if (!url) return skip("upload", "the photo could not be uploaded for Lens");
  let second: ShoppingMatch | null = null;
  try {
    second = await searchLensViaSerpApi(url, "advisory");
  } finally {
    await discardLensUpload(url);
  }
  // Only listings the first set did not already judge, ranked after it.
  const key = (c: ShoppingCandidate) => normalizeListingUrl(c.productUrl) || c.imageUrl;
  const seen = new Set((first?.pool.candidates || []).map(key));
  const offset = first?.pool.candidates.length ?? 0;
  const fresh = (second?.candidates || []).filter(c => !seen.has(key(c))).map((c, i) => ({ ...c, rank: offset + i }));
  const added = buildShoppingMatch(fresh);
  if (!added) {
    traceStep("escalation", { to: "serpapi", ran: true, candidates: second?.candidates.length ?? 0, fresh: 0, confidence: "unverified" });
    return null;
  }
  const judged = await judgePool(added, reference, gate);
  const merged: JudgedPool = {
    pool: first ? { ...first.pool, candidates: [...first.pool.candidates, ...fresh] } : added,
    ordered: [...(first?.ordered || []), ...judged.ordered],
    checked: [...(first?.checked || []), ...judged.checked],
  };
  const verified = settlePool(merged, gate);
  const fromEscalation = fresh.includes(verified.best);
  traceStep("escalation", {
    to: "serpapi", ran: true, candidates: second?.candidates.length ?? 0, fresh: fresh.length,
    judged: judged.checked.length, confidence: verified.confidence, fromEscalation,
  });
  return { pool: merged.pool, verified, fromEscalation };
}

/**
 * Several candidate pools from independent searches, judged together and
 * settled separately. The rebrand and direct-retailer searches each bring a
 * narrow window of candidates; judging them in ONE call (they fit in a
 * single batch) instead of one call each saves a full call's thinking and
 * latency on every cold scan, and each pool still gets its own answer from
 * its own candidates.
 */
async function verifyPools(
  pools: (ShoppingMatch | null)[],
  reference: { data: string; mimeType: string },
  options: GateOptions
): Promise<(Verified | null)[]> {
  const window = options.window ?? VERIFY_WINDOW_PRICING;
  const ordered = pools.map(pool => (pool ? rankForVerification(pool.candidates.filter(isListingCandidate), options.hints).slice(0, window) : []));
  const union = ordered.flat();
  if (union.length === 0) return pools.map(() => null);
  const checked = await judgeCandidates(union, reference, options);
  return pools.map((pool, i) => {
    if (!pool || ordered[i].length === 0) return null;
    const mine = new Set(ordered[i]);
    return settleVerdict(checked.filter(c => mine.has(c.candidate)), ordered[i], options);
  });
}

// ════════════════════════════════════════════════════════════════
// IDENTIFY, THEN PRICE.
//
// Google Lens answers "what is this". It answers "what does it cost" only
// when a merchant happened to publish a price Google could parse, which
// for the single most visually identical result is often not the case.
// Deleting those results was the original bug. Finding their price is the
// fix, and it is the same two-step Google itself runs: once the gate has
// CONFIRMED which product the photo shows, the confirmed product's own
// title is a far better search string than anything a vision pass could
// guess, so it drives a precise pricing search — and every listing that
// search returns goes back through the same visual gate before a single
// one of its prices is believed.
//
// The price is only adopted from a listing verified at no less confidence
// than the identification it is pricing, and price, link, image and title
// then all come from that one record. A title search can drift onto a
// different variant, and an unverified price hung off a verified identity
// would be exactly the "price from one listing, link to another" failure
// this engine is built to refuse.
// ════════════════════════════════════════════════════════════════
/**
 * A listing title as a search query. Lens and Shopping titles carry the site
 * around the product name ("Amazon.com: ...", "... | Flowlife", "... -
 * Walmart.com") and are often cut off with an ellipsis; searching with that
 * noise is how a confirmed Flowgun Air came back priced as a Theragun. The
 * product name is what is left.
 */
const MARKETPLACES = /^(amazon|ebay|walmart|target|etsy|temu|aliexpress|best buy|home depot|wayfair|newegg|shein|mercari|poshmark)\b/i;

export function cleanListingTitle(title: string, source = ""): string {
  let t = (title || "").replace(/\s+/g, " ").trim();
  t = t.replace(/^[A-Za-z0-9.-]*amazon\.[a-z.]+\s*:\s*/i, "");
  t = t.replace(/\s*(\.\.\.|…)\s*$/, "");
  // "galaxus.at" -> "galaxus", "Norpro Wholesale" -> "norpro".
  const site = source.toLowerCase().trim().split(/[\s.]/)[0] || "";
  // A trailing segment that names the site: anything after " | ", or after a
  // dash when it is a domain, a marketplace, or the seller the listing came
  // from. "Apple AirPods Pro - 2nd Generation" keeps its generation.
  for (let i = 0; i < 2; i++) {
    const m = t.match(/^(.{12,}?)\s+([|–—-])\s+([^|–—]{2,40})$/);
    if (!m) break;
    const tail = m[3].trim();
    const namesSite = m[2] === "|" || /\.(com|net|org|co|shop|store)\b/i.test(tail) || MARKETPLACES.test(tail)
      || (site.length >= 3 && tail.toLowerCase().includes(site));
    if (!namesSite) break;
    t = m[1].trim();
  }
  return t;
}

function queryFromTitle(title: string, source = ""): string {
  const cleaned = cleanListingTitle(title, source);
  return cleaned.length <= 110 ? cleaned : cleaned.slice(0, 110).replace(/\s+\S*$/, "");
}

async function priceVerifiedIdentity(
  identified: ShoppingMatch,
  confidence: "exact" | "likely",
  reference: { data: string; mimeType: string },
  gate: GateOptions
): Promise<{ match: ShoppingMatch; engineUsed: string; confidence: "exact" | "likely" } | null> {
  const title = queryFromTitle(identified.title, identified.source);
  if (title.length < 3) return null;
  if (gate.budget && !gate.budget.allows(PRICING_SEARCH_COST_MS)) return null;

  const queries = [title, simplifyQuery(title, 6)];
  const hinted = `${gate.hints?.brand || ""} ${gate.hints?.productName || ""}`.trim();
  if (hinted.length >= 3) queries.push(hinted);

  const found = await searchShoppingWithFallbacks(queries, "advisory");
  if (!found || found.match.lowestPrice <= 0) return null;

  // Identity is already settled; this pool exists only to attach a price to
  // it, so the narrow window applies.
  const verified = await verifyCandidates(found.match, reference, { ...gate, window: VERIFY_WINDOW_PRICING, purpose: "pricing" });
  if (verified.confidence === "unverified" || verified.best.price <= 0) return null;
  // A price at the identification's own confidence is adopted as it is. An
  // exact identification that only a "likely" listing can price (the same
  // model in another colour, say) is shown as that likely listing, labeled
  // likely, rather than as "not identified": the card then claims exactly
  // what the price's own listing supports, and no more.
  return {
    match: applyVerifiedCandidate(found.match, verified),
    engineUsed: found.engineUsed,
    confidence: rankConfidence(verified.confidence) < rankConfidence(confidence) ? verified.confidence : confidence,
  };
}

// ════════════════════════════════════════════════════════════════
// REUSING AN IDENTIFICATION SOMEONE ELSE ALREADY PAID FOR.
//
// The traffic pattern this product is built to create is thousands of
// people photographing ONE product within a few hours. Every one of those
// photos is a different file, so the byte-keyed scan cache in redis.ts
// misses on all of them, and each one paid for a fresh identification.
// That is the largest avoidable cost in exactly the moment that matters.
//
// What makes reuse safe here is that a cache hit is a HYPOTHESIS, not a
// conclusion, and it is checked against this specific photo before it is
// used:
//
//   1. The fingerprint has to match (see identity-cache.ts - it is derived
//      from Google's own answer, not from the pixels, so no client can
//      forge it).
//   2. The cached listing has to appear in THIS scan's candidate set too,
//      which means Google, looking at this photo, returned the same listing
//      it returned for the earlier one.
//   3. The brand read off THIS photo has to be consistent with the cached
//      title.
//   4. One visual comparison has to come back "exact".
//
// That fourth check runs on Sonnet 5.5 rather than the full gate on
// purpose. It is safe because of what it is allowed to do: it can only
// ACCEPT an identification the gate already made for a photo that
// fingerprinted the same way, and anything short of "exact" falls straight
// through to the full gate. It cannot produce a new identification, and a
// wrong answer from it costs a wasted call, not a wrong product.
//
// A hit keeps full confidence even when the engine is degraded, because the
// identification being reused was made by the full gate. That is what
// keeps a viral product producing full-strength verdicts during exactly the
// spike that would otherwise have spent the budget.
// ════════════════════════════════════════════════════════════════
async function reuseIdentification(
  pool: ShoppingMatch,
  fingerprint: Fingerprint | null,
  reference: { data: string; mimeType: string },
  gate: GateOptions
): Promise<ShoppingMatch | null> {
  if (!fingerprint) return null;

  const present = new Set(
    pool.candidates.map(c => normalizeListingUrl(c.productUrl)).filter(Boolean)
  );
  const hit = await lookupIdentity(fingerprint, (entry: CachedIdentity, via) => {
    // Overlap is measured against the LENS LISTINGS the entry was
    // identified from, not against the winning record's own URL - the
    // winner usually comes from a downstream pricing layer and is not in
    // any Lens pool. See CachedIdentity.anchors.
    const overlap = (entry.anchors || []).filter(url => present.has(url)).length;
    // The two lookup paths do not carry the same weight. A "set" hit means
    // the whole top-of-response listing set was identical, which is already
    // a strong same-product signal, so one confirming listing is enough. A
    // "listing" hit means only ONE listing matched - and one shared listing
    // can happen between two different products of the same brand, which is
    // exactly the confusion this engine exists to avoid - so that path has
    // to show at least two.
    if (overlap < (via === "set" ? 1 : 2)) return false;
    const brandWords = significantWords(gate.hints?.brand || "");
    if (brandWords.length === 0) return true;
    const titleWords = new Set(significantWords(entry.title));
    return brandWords.every(w => titleWords.has(w));
  });
  if (!hit) return null;

  const confirmation = await verifyVisualMatchBatch(
    reference, [{ imageUrl: hit.entry.imageUrl, title: hit.entry.title, source: hit.entry.source }], REUSE_CONFIRM_MODEL
  );
  // A failed confirmation call is not a confirmation. Falling through to the
  // full gate costs money; accepting an unconfirmed reuse costs correctness.
  // The confirmation passes the same match guards as any gate answer.
  if (!confirmation.ok) return null;
  const confirmed = guardResult(confirmation.results[0], hit.entry, gate.hints);
  if (confirmed.match !== "exact") return null;

  return {
    title: hit.entry.title,
    lowestPrice: hit.entry.price,
    priceCurrency: hit.entry.priceCurrency ?? null,
    highestPrice: Math.max(hit.entry.highestPrice, hit.entry.price),
    imageUrl: hit.entry.imageUrl,
    productUrl: hit.entry.productUrl,
    source: hit.entry.source,
    productId: hit.entry.productId,
    candidates: pool.candidates,
  };
}

// A challenger from a later layer only displaces the incumbent if it is at
// least as well identified. Price alone used to be enough, which meant a
// cheaper "likely" match could evict a confirmed "exact" one — trading the
// thing in the photo for something that merely resembles it. A strictly
// better identification wins even at a higher price, because a price for
// the wrong product is not a cheaper price, it is a wrong answer.
function shouldReplace(
  incumbentConfidence: "exact" | "likely" | "unverified",
  incumbentPrice: number,
  challengerConfidence: "exact" | "likely" | "unverified",
  challengerPrice: number
): boolean {
  if (challengerConfidence === "unverified" || challengerPrice <= 0) return false;
  const incumbentRank = rankConfidence(incumbentConfidence);
  const challengerRank = rankConfidence(challengerConfidence);
  if (challengerRank !== incumbentRank) return challengerRank > incumbentRank;
  return challengerPrice < (incumbentPrice > 0 ? incumbentPrice : Infinity);
}

// ════════════════════════════════════════════════════════════════
// URL PAGE FETCHING + STRUCTURED EXTRACTION
// ════════════════════════════════════════════════════════════════
// Every page this fetches was chosen by someone else (a pasted link, a store
// address read off a screenshot, a search result), so it goes through
// fetchPublic: no private or internal address, at any redirect hop.
async function fetchProductPageHtml(url: string): Promise<string | null> {
  try {
    const res = await fetchPublic(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!res || !res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("xml")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractMetaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

// What a page's product data says as its brand when it has none to state.
const NO_BRAND = /^(generic|unbranded|no ?brand|non ?branded|n\/?a|none|unknown|oem|other|various|-+)$/i;

/** A schema.org brand ("Acme", { name: "Acme" }, or a list of them) as one real brand name, or undefined. */
function brandName(raw: unknown): string | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const name = typeof first === "string" ? first : typeof (first as { name?: unknown })?.name === "string" ? (first as { name: string }).name : "";
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
  return clean && !NO_BRAND.test(clean) ? clean : undefined;
}

function extractJsonLdProduct(html: string): Partial<PageProductData> {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const block of blocks) {
    const inner = block.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!inner) continue;
    try {
      const parsed = JSON.parse(inner[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : (parsed["@graph"] || [parsed]);
      for (const node of nodes) {
        const type = node?.["@type"];
        const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
        if (!isProduct) continue;

        const price = extractCanonicalOfferPrice(node.offers);
        const rawImage = node.image;
        const imageUrl = Array.isArray(rawImage) ? rawImage[0] : (typeof rawImage === "object" && rawImage ? rawImage.url : rawImage);
        const offersForCurrency = Array.isArray(node.offers) ? node.offers[0] : node.offers;

        return {
          title: typeof node.name === "string" ? node.name : undefined,
          brand: brandName(node.brand),
          price: price,
          currency: typeof offersForCurrency?.priceCurrency === "string" ? offersForCurrency.priceCurrency : undefined,
          imageUrl: typeof imageUrl === "string" ? imageUrl : undefined,
          description: typeof node.description === "string" ? node.description : undefined,
        };
      }
    } catch {
      continue;
    }
  }
  return {};
}

function extractCanonicalOfferPrice(offers: unknown): number | null {
  if (!offers) return null;

  if (Array.isArray(offers)) {
    const SUBSCRIPTION_HINTS = /subscri|installment|per\s*month|\/mo\b|autoship|klarna|afterpay|affirm/i;
    const candidates = offers.filter((o: Record<string, unknown>) => {
      const text = `${o?.name || ""} ${o?.description || ""}`;
      return typeof o?.price !== "undefined" && !SUBSCRIPTION_HINTS.test(String(text));
    });
    const pool = candidates.length > 0 ? candidates : offers;
    const prices = pool
      .map((o: Record<string, unknown>) => parsePrice(o?.price, o?.priceCurrency).amount)
      .filter((p): p is number => p !== null && p > 0);
    return prices.length > 0 ? Math.max(...prices) : null;
  }

  const single = offers as Record<string, unknown>;
  if (typeof single.price !== "undefined") {
    const p = parsePrice(single.price, single.priceCurrency).amount;
    return p !== null && p > 0 ? p : null;
  }

  return null;
}

function extractMicrodataPrice(html: string): { price: number | null; currency: string | null } {
  const priceMatch =
    html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i);
  const currencyMatch =
    html.match(/itemprop=["']priceCurrency["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]*itemprop=["']priceCurrency["']/i);

  const currency = currencyMatch ? currencyMatch[1] : null;
  const price = priceMatch ? parsePrice(priceMatch[1], currency).amount : null;
  return {
    price: price && price > 0 ? price : null,
    currency,
  };
}

function extractMetaProduct(html: string): Partial<PageProductData> {
  const priceRaw = extractMetaContent(html, "product:price:amount") || extractMetaContent(html, "og:price:amount");
  const currency = extractMetaContent(html, "product:price:currency") || extractMetaContent(html, "og:price:currency") || undefined;
  const price = priceRaw ? parsePrice(priceRaw, currency).amount : null;
  return {
    title: extractMetaContent(html, "og:title") || undefined,
    brand: brandName(extractMetaContent(html, "product:brand") || extractMetaContent(html, "og:brand") || ""),
    price: price && price > 0 ? price : null,
    currency,
    imageUrl: extractMetaContent(html, "og:image") || undefined,
    description: extractMetaContent(html, "og:description") || extractMetaContent(html, "description") || undefined,
  };
}

function stripHtmlForText(html: string, maxLength = 6000): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const text = withoutScripts.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, maxLength);
}

async function extractProductViaClaudeText(html: string, severity: Severity): Promise<Partial<PageProductData>> {
  const text = stripHtmlForText(html);
  if (text.length < 50) return {};

  const call = await callClaude("text", TEXT_MODEL, {
    max_tokens: 200,
    messages: [{
      role: "user",
      content: `Extract the product name and price from this product page text. Return ONLY JSON:
{"title": "product name or empty string", "price": null or number, "currency": "ISO 4217 code of that price, e.g. USD, EUR, GBP, MAD"}
CRITICAL: price must be the main one-time purchase price of this exact product as currently displayed by default. Never a per-installment amount ("4 payments of $X"), a subscription/subscribe-and-save price, a shipping cost, or a price for a different variant/bundle than the one shown by default. If several prices appear and it's unclear which is the main displayed price, return null rather than guessing.
CRITICAL: title must include defining material/type descriptors, not a bare generic category word. Use "jade roller" not "roller".

PAGE TEXT:
${text}`,
    }],
  }, TEXT_TIMEOUT_MS);

  const parsed = (call.ok ? parseReplyJson(call.text) : null) as { title?: unknown; price?: unknown; currency?: unknown } | null;
  if (!parsed || typeof parsed !== "object") {
    // This read is the only source of the asking price on a page with no
    // structured data, so for a verdict it decides whether there can be one.
    reportClaudeFailure("text", call.ok ? { ...call, ok: false, kind: "unparseable", detail: call.text || "" } : call, severity);
    return {};
  }
  return {
    title: typeof parsed.title === "string" && parsed.title ? parsed.title : undefined,
    price: parsePrice(parsed.price, parsed.currency).amount || null,
    currency: normalizeCurrency(parsed.currency) || undefined,
  };
}

async function buildEnrichedSearchQuery(title: string, description: string, rawText: string): Promise<string> {
  const fallback = title;
  const context = [title, description, rawText].filter(Boolean).join("\n\n").slice(0, 8000);
  if (context.length < 20) return fallback;

  const call = await callClaude("query", TEXT_MODEL, {
    max_tokens: 120,
    messages: [{
      role: "user",
      content: `Based on this product page content, write the single most specific shopping search query for finding this exact product (or the closest possible match) elsewhere online.

Include distinguishing descriptors the content actually mentions: material, specific type or variant, notable features (e.g. "dual-head", "2-in-1", number of pieces, mechanism, size). Do not include the brand or store name. Do not include marketing filler words ("premium", "best-selling", "amazing"). Do not invent details the text doesn't support.

Return ONLY the search query text. No quotes, no JSON, no explanation, nothing else.

PRODUCT TITLE: ${title || "(none given)"}

PAGE CONTENT:
${context}`,
    }],
  }, TEXT_TIMEOUT_MS);

  // The page title is a usable query on its own, so a failure here costs
  // precision, not the scan. Logged by callClaude; nothing else to do.
  const query = String(call.text || "").trim().replace(/^["']|["']$/g, "");
  return query.length >= 3 ? query : fallback;
}

// `priceSeverity` says how much a failed price read matters to the caller: on
// a pasted link asking for a verdict, the page is the only source of the
// asking price; during store discovery from a photo, it is a fallback.
async function extractPageProductData(html: string, priceSeverity: Severity = "identity"): Promise<PageProductData> {
  const jsonLd = extractJsonLdProduct(html);
  const microdata = extractMicrodataPrice(html);
  const meta = extractMetaProduct(html);

  let title = jsonLd.title || meta.title || "";
  const brand = jsonLd.brand || meta.brand;
  let price = jsonLd.price ?? microdata.price ?? meta.price ?? null;
  let currency = normalizeCurrency(jsonLd.currency || microdata.currency || meta.currency) || "USD";
  const imageUrl = jsonLd.imageUrl || meta.imageUrl || "";
  const description = jsonLd.description || meta.description || "";

  if (!price) {
    const viaClaude = await extractProductViaClaudeText(html, priceSeverity);
    title = title || viaClaude.title || "";
    price = price ?? viaClaude.price ?? null;
    currency = currency !== "USD" ? currency : (viaClaude.currency || currency);
  }

  const rawText = stripHtmlForText(html, 9000);
  const searchQuery = await buildEnrichedSearchQuery(title, description, rawText);

  return { title, ...(brand ? { brand } : {}), price, currency, imageUrl, description, searchQuery: searchQuery || title };
}

// ════════════════════════════════════════════════════════════════
// MAIN SCAN — image upload
//
// `country` is used ONLY for the shippingNote disclosure below — it does
// NOT affect what gets searched (see file header: search is always
// targeted at the US index). Should be a 2-letter ISO code detected from
// the requester's IP. On Vercel, the API route can read this directly from
// a header Vercel sets automatically — no separate geo-IP service needed:
//
//   const country = req.headers.get("x-vercel-ip-country") || "us";
//   const result = await scanProduct(imageBase64, mimeType, country);
//
// If omitted, defaults to "us" (no shipping note shown).
// ════════════════════════════════════════════════════════════════
/** For the operator evaluation path: receives the scan's full trace when it settles. */
export interface ScanHooks {
  onTrace?: (trace: ScanTrace) => void;
}

export async function scanProduct(
  imageBase64: string, mimeType: string, country?: string, intent?: "verdict" | "finder", hooks: ScanHooks = {}
): Promise<ScanResult> {
  return settleScan(() => scanImage(imageBase64, mimeType, country, intent), hooks);
}

/**
 * Runs one scan with its failures recorded, then decides whether the result
 * stands. A result reached after a provider error is replaced by "could not
 * be completed" unless the product was still verified (scan-trace.ts says
 * which failures can be outweighed and which cannot). An exception anywhere
 * in the engine is the same state, never a "no match".
 */
async function settleScan(run: () => Promise<ScanResult>, hooks: ScanHooks = {}): Promise<ScanResult> {
  let traced: Awaited<ReturnType<typeof runTraced<ScanResult>>>;
  try {
    traced = await runTraced(run);
  } catch (err) {
    logProviderFailure({ layer: "engine", provider: "engine", status: 0, kind: "exception", detail: String((err as Error)?.stack || err) });
    return { ...getUnresolvedResult(), failure: { reason: "engine", layers: ["engine"] } };
  }
  const { value: result, failures } = traced;
  hooks.onTrace?.(traced.trace);
  const verified = result.found && result.mode !== "UNRESOLVED" && result.matchConfidence !== "unverified";
  const failure = decideFailure(failures, verified);
  return failure ? { ...getUnresolvedResult(), failure } : result;
}

async function scanImage(imageBase64: string, mimeType: string, country?: string, intent?: "verdict" | "finder"): Promise<ScanResult> {
  const requesterCountry = sanitizeCountry(country);
  const budget = createBudget();
  // Read once, applied for the whole scan. "degraded" means the day's model
  // budget is spent or the API is pushing back: the gate moves to Sonnet 5.5
  // alone, caps what it is allowed to claim, and the enhancement layers are
  // skipped. See model-budget.ts.
  const spendMode = await currentSpendMode();
  // What the models see: the photo capped at 1568px (see image-cap.ts).
  // Lens still gets the original upload below.
  const modelPhoto = await capForModel({ data: imageBase64, mimeType });
  const vision = await extractFromImage(modelPhoto.data, modelPhoto.mimeType, spendMode, intent);
  // No read at all, on a scan that needs one: the result is already decided
  // (could not be completed), so nothing else is worth paying for. During a
  // model outage this keeps a failing scan from spending a Lens search.
  if (hasFailed("extraction", "critical")) return getUnresolvedResult();
  // What the vision pass read off the photo. Used to ORDER candidates for
  // the identification gate and to build fallback queries — never to
  // filter a candidate out. See rankForVerification.
  const hints: IdentityHints = { brand: vision.brand || "", productName: vision.productName };

  let shopping: ShoppingMatch | null = null;
  let engineUsed = "none";
  let confidence: "exact" | "likely" | "unverified" = "unverified";
  // The other listings the gate placed in the identified record's tier: the
  // same product, so any of them can carry its price. See page_price below.
  let identifiedTier: ShoppingCandidate[] = [];
  // The image every candidate is compared against. It is the scanned photo,
  // unless identification ends up running off a product photo found on the
  // seller's own page, in which case the whole verification chain stays
  // consistent with the image that actually established the identity.
  let reference = modelPhoto;
  const gate: GateOptions = { hints, budget, mode: spendMode };

  // ── Try Lens first: match on pixels, not words ──
  const lensImageUrl = await uploadForLensSearch(imageBase64, mimeType);
  // Whether Serper's Lens answered this scan (with matches or with none),
  // which is what makes the SerpApi escalation below worth asking.
  let serperAnswered = false;
  if (lensImageUrl) {
    const lens = await searchLens(lensImageUrl);
    shopping = lens.match;
    serperAnswered = lens.engine === "serper" || (lens.engine === "" && !!process.env.SERPER_API_KEY && !hasFailed("lens"));
    if (shopping) engineUsed = `lens_${lens.engine}`;
    // The temporary public copy exists only for the duration of the Lens
    // call. It goes as soon as that call is done.
    await discardLensUpload(lensImageUrl);
    traceStep("lens", {
      engine: lens.engine || null, candidates: shopping?.candidates.length ?? 0,
      top: (shopping?.candidates || []).slice(0, 12).map(traceCandidate),
    });
  }

  // ── Has someone already identified this product? ──
  //    Checked before the gate runs, because a hit replaces the entire gate
  //    with one cheap confirmation. Only the image pipeline does this: a URL
  //    scan of the same page already collapses onto one entry in the
  //    route's own cache, so there is nothing here for it to win.
  let fingerprint: Fingerprint | null = null;
  let servedFromIdentityCache = false;
  if (shopping) {
    fingerprint = lensFingerprint(shopping.candidates.map(c => c.productUrl));
    const reused = await reuseIdentification(shopping, fingerprint, reference, gate);
    traceStep("reuse", { hit: !!reused });
    if (reused) {
      shopping = reused;
      confidence = "exact";
      engineUsed = `${engineUsed}+reused`;
      servedFromIdentityCache = true;
    }
  }

  let lensJudged: JudgedPool | null = null;
  if (shopping && !servedFromIdentityCache) {
    lensJudged = await judgePool(shopping, reference, gate);
    const verified = settlePool(lensJudged, gate);
    // Honest pass-through: a genuinely unverified visual match stays
    // unverified. It used to be silently upgraded to "likely" here, which
    // rendered as "VISUAL MATCH CONFIRMED" on a product that was never
    // actually confirmed - the exact mismatch a real scan surfaced (a
    // different colorway of the same shoe, badged as confirmed).
    confidence = verified.confidence;
    identifiedTier = verified.tier || [];
    shopping = applyVerifiedCandidate(shopping, verified);
  }

  // ── Escalation: Serper's Lens could not verify anything, so SerpApi's
  //    Lens (with Google's exact-image matches) is asked once, while it is
  //    above its reserve. See ESCALATION. ──
  if (serperAnswered && !servedFromIdentityCache && confidence === "unverified") {
    const escalated = await escalateLens({ data: imageBase64, mimeType }, lensJudged, reference, gate, budget);
    if (escalated && (escalated.verified.confidence !== "unverified" || !shopping)) {
      shopping = applyVerifiedCandidate(escalated.pool, escalated.verified);
      confidence = escalated.verified.confidence;
      identifiedTier = escalated.verified.tier || [];
      if (escalated.fromEscalation) engineUsed = engineUsed === "none" ? "lens_serpapi_escalated" : `${engineUsed}+escalated_serpapi`;
    }
  }

  // ── Product-page discovery: if Lens found nothing and vision saw a store
  //    name or a visible URL, find and READ the actual product page before
  //    falling back to a generic text search. ──
  let discoveredPage: PageProductData | null = null;
  if (!shopping && (vision.storeName || vision.visibleUrl)) {
    discoveredPage = await discoverAndFetchProductPage(vision);
    traceStep("discovery", { found: !!discoveredPage, title: discoveredPage?.title?.slice(0, 120) || null });

    if (discoveredPage) {
      if (discoveredPage.imageUrl) {
        const pageImage = await fetchImageAsBase64(discoveredPage.imageUrl);
        if (pageImage) {
          const lensUrl = await uploadForLensSearch(pageImage.data, pageImage.mimeType);
          if (lensUrl) {
            const lens = await searchLens(lensUrl);
            shopping = lens.match;
            if (shopping) engineUsed = `store_page_lens_${lens.engine}`;
            await discardLensUpload(lensUrl);
          }
          if (shopping) {
            // Identity is being established from the photo on the seller's
            // own product page, so that photo becomes the reference every
            // later check in this scan compares against.
            reference = await capForModel(pageImage);
            const verified = await verifyCandidates(shopping, reference, gate);
            // Same honesty fix as above - no artificial upgrade of a
            // genuinely unverified match.
            confidence = verified.confidence;
            shopping = applyVerifiedCandidate(shopping, verified);
          }
        }
      }

      if (!shopping && discoveredPage.searchQuery) {
        const found = await searchShoppingWithFallbacks(
          [discoveredPage.searchQuery, discoveredPage.title, simplifyQuery(discoveredPage.searchQuery)]
        );
        if (found) {
          shopping = found.match;
          engineUsed = `store_page_${found.engineUsed}`;
          const verified = await verifyCandidates(shopping, reference, gate);
          confidence = verified.confidence;
          shopping = applyVerifiedCandidate(shopping, verified);
        }
      }
    }
  }

  // ── Text identification: what the photo SAYS, searched as text, when the
  //    pixels did not identify it. It used to run only when Lens returned
  //    nothing at all, so a Lens answer made only of pages that reuse the
  //    photo (news stories, an encyclopedia) shut out the one clean product
  //    name the scan had: the vision read. A text pool's answer replaces
  //    what is there only when it is better identified (a Lens lookalike
  //    stays ahead of a text-search lookalike). When Lens did answer, a
  //    failure here costs an alternative, not the scan, so it is advisory. ──
  const identified = () => !!shopping && confidence !== "unverified";
  const textSeverity: Severity = shopping ? "advisory" : "identity";
  const adopt = (pool: ShoppingMatch, verified: Verified, label: string): void => {
    if (shopping && rankConfidence(verified.confidence) <= rankConfidence(confidence)) return;
    shopping = applyVerifiedCandidate(pool, verified);
    confidence = verified.confidence;
    identifiedTier = verified.tier || [];
    engineUsed = label;
  };

  //    Store-name-targeted first, when the photo shows a store. ──
  if (!identified() && vision.storeName && (!shopping || budget.allows(VERIFY_WAVE_COST_MS))) {
    const storeQuery = `${vision.storeName} ${vision.brand} ${vision.productName} ${vision.quantity}`.trim();
    const found = await searchShoppingWithFallbacks([storeQuery, `${vision.brand} ${vision.productName} ${vision.quantity}`.trim()], textSeverity);
    traceStep("store_search", { query: storeQuery.slice(0, 120), found: found?.match.candidates.length ?? 0 });
    if (found) adopt(found.match, await verifyCandidates(found.match, reference, gate), `store_${found.engineUsed}`);
  }

  //    Then brand and product name. ──
  if (!identified() && (!shopping || budget.allows(VERIFY_WAVE_COST_MS))) {
    const base = vision.brand ? `${vision.brand} ${vision.productName}` : (vision.productName || "");
    const genericQuery = `${base} ${vision.quantity}`.trim();
    if (base) {
      const found = await searchShoppingWithFallbacks([genericQuery, base, vision.productName], textSeverity);
      traceStep("generic_search", { query: genericQuery.slice(0, 120), found: found?.match.candidates.length ?? 0 });
      if (found) adopt(found.match, await verifyCandidates(found.match, reference, gate), `generic_${found.engineUsed}`);
    }
  }

  // ── The identified listing's own page. Lens often finds the right listing
  //    without a price (a brand's own store is the usual case); the page
  //    states one in its structured data. ──
  //    Up to three listings from the identified record's tier are read in
  //    parallel (the first one tried was often a store that blocks reading,
  //    while the brand's own page, also confirmed, was never tried); the
  //    best-ranked one with a price becomes the record, with its own link,
  //    title and image, so price and link still come from one listing. ──
  if (shopping && !servedFromIdentityCache && confidence !== "unverified" && shopping.lowestPrice <= 0 && budget.allows(PAGE_PRICE_COST_MS)) {
    const current = shopping;
    const seen = new Set<string>();
    const tries = [
      { title: current.title, imageUrl: current.imageUrl, productUrl: current.productUrl, source: current.source, productId: current.productId, price: 0, rank: -1 } as ShoppingCandidate,
      ...identifiedTier,
    ].filter(c => c.productUrl && !seen.has(c.productUrl) && seen.add(c.productUrl) && isListingCandidate(c)).slice(0, 3);
    const prices = await Promise.all(tries.map(c => priceFromListingPage(c.productUrl)));
    const hit = tries.findIndex((_, i) => prices[i]);
    traceStep("page_price", {
      tried: tries.map((c, i) => ({ url: c.productUrl.slice(0, 160), found: !!prices[i], amount: prices[i]?.amount ?? null, currency: prices[i]?.currency ?? null })),
    });
    if (hit >= 0) {
      const own = prices[hit]!;
      const listing = tries[hit];
      shopping = {
        ...current,
        title: listing.title, imageUrl: listing.imageUrl, productUrl: listing.productUrl, source: listing.source, productId: listing.productId,
        lowestPrice: own.usd, highestPrice: Math.max(current.highestPrice, own.usd), priceCurrency: own.currency,
      };
      engineUsed = `${engineUsed}+priced_page`;
    }
  }

  // ── Identify, then price. The gate has confirmed WHAT this is; if the
  //    record it confirmed publishes no price of its own, the confirmed
  //    name now drives a precise pricing search whose results go back
  //    through the same gate. This is what makes keeping unpriced visual
  //    matches safe, and it is the half of the flow Google performs
  //    separately too. ──
  if (shopping && !servedFromIdentityCache && confidence !== "unverified" && shopping.lowestPrice <= 0) {
    const priced = await priceVerifiedIdentity(shopping, confidence, reference, gate);
    traceStep("pricing", { adopted: !!priced, confidence: priced?.confidence ?? null });
    if (priced) {
      shopping = priced.match;
      confidence = priced.confidence;
      engineUsed = `${engineUsed}+priced_${priced.engineUsed}`;
    }
  }

  // ── Rebrand check + direct-retailer check, run as one step.
  //
  //    Rebrand: many products sold under a brand name are the same
  //    unbranded item from the original manufacturer with a label added,
  //    so the product gets searched once more with the brand stripped and
  //    described only by its generic features.
  //
  //    Direct retailer (off unless RETAILER_SWEEP=1, since it costs three
  //    SerpApi searches a scan; see SEARCH PROVIDERS, BUDGET MODE):
  //    Google's Shopping graph structurally
  //    under-represents several major retailers' own catalogs — a niche or
  //    smaller-brand product frequently shows up there only via the
  //    brand's own paid listing, with a genuinely cheaper Amazon, Walmart
  //    or eBay listing entirely invisible to that search. Now that the
  //    product has been identified, the CONFIRMED title drives that query
  //    instead of the vision pass's guess at a name, which is a better
  //    search string for the same reason it is a better pricing query.
  //
  //    Both are independent searches for a cheaper source of the same
  //    product, both verified against the same reference image, and
  //    neither depends on the other's result — running them sequentially
  //    only spent a clock this scan does not have. Both apply to every
  //    scan regardless of which intent the visitor chose: they happen
  //    before the VERDICT/FINDER branch below, not after it.
  //
  //    Adoption goes through shouldReplace(), so a cheaper challenger can
  //    no longer evict a better-identified incumbent. ──
  //    Skipped on two conditions beyond the clock. On a reused
  //    identification, because the cached record is what the SAME layers
  //    produced for this product within the last hour - the stored price is
  //    already the cheapest verified one, so re-running them buys a
  //    re-measurement of the same answer. And in degraded mode, because
  //    these layers only ever improve a price that already exists, which is
  //    the first thing worth giving up when the budget is gone. ──
  if (shopping && !servedFromIdentityCache && spendMode === "full" && budget.allows(ALTERNATIVE_LAYER_COST_MS)) {
    const identifiedTitle = confidence !== "unverified" ? queryFromTitle(shopping.title, shopping.source) : "";
    const visionQuery = (vision.brand ? `${vision.brand} ${vision.productName}` : (vision.productName || "")).trim();
    const retailerQuery = identifiedTitle.length >= 3 ? identifiedTitle : visionQuery;
    const unbrandedQuery = `${vision.productName} ${vision.category} ${vision.quantity}`.trim();
    const canRebrand = !!(vision.brand && vision.productName);

    const [unbrandedFound, retailerFound] = await Promise.all([
      canRebrand
        ? searchShoppingWithFallbacks([unbrandedQuery, vision.productName], "advisory")
        : Promise.resolve(null),
      retailerQuery.length >= 3
        ? searchAllDirectRetailers(retailerQuery)
        : Promise.resolve(null),
    ]);

    // Both pools judged in one gate call, each settled on its own; then
    // applied in order, the retailer challenger measured against whatever
    // the rebrand step left in place.
    const unbrandedPool = unbrandedFound && unbrandedFound.match.lowestPrice > 0 ? unbrandedFound.match : null;
    const retailerPool = retailerFound && retailerFound.match.lowestPrice > 0 ? retailerFound.match : null;
    traceStep("alternatives", {
      retailerQuery: retailerQuery.slice(0, 120), unbranded: unbrandedPool?.candidates.length ?? 0,
      retailer: retailerPool?.candidates.length ?? 0, retailerSource: retailerFound?.source ?? null,
      retailerSweep: retailerSweepOn(),
    });
    if ((unbrandedPool || retailerPool) && budget.allows(VERIFY_WAVE_COST_MS)) {
      const [unbrandedVerified, retailerVerified] = await verifyPools(
        [unbrandedPool, retailerPool], reference, { ...gate, window: VERIFY_WINDOW_PRICING, purpose: "rebrand+retailer" }
      );
      if (unbrandedFound && unbrandedPool && unbrandedVerified &&
          shouldReplace(confidence, shopping.lowestPrice, unbrandedVerified.confidence, unbrandedVerified.best.price)) {
        shopping = applyVerifiedCandidate(unbrandedPool, unbrandedVerified);
        engineUsed = `unbranded_${unbrandedFound.engineUsed}`;
        confidence = unbrandedVerified.confidence;
      }
      if (retailerFound && retailerPool && retailerVerified &&
          shouldReplace(confidence, shopping.lowestPrice, retailerVerified.confidence, retailerVerified.best.price)) {
        shopping = applyVerifiedCandidate(retailerPool, retailerVerified);
        engineUsed = `direct_${retailerVerified.best.source.toLowerCase()}`;
        confidence = retailerVerified.confidence;
      }
    }
  }

  // ── Identified, but unpriceable.
  //    Every layer above has run, including a pricing search against the
  //    confirmed product name, and nothing anywhere published a price for
  //    this item. There is no honest card to render: the whole result is
  //    built around a real number attached to a real link, and pulling a
  //    number out of a category average while linking to a listing that
  //    never stated a price is precisely the fabrication this engine
  //    refuses to commit. Same outcome the URL pipeline has always
  //    produced in this situation. Only reachable now that unpriced
  //    candidates survive to the gate at all. ──
  const hasSourcePrice = !!shopping && shopping.lowestPrice > 0;
  traceStep("identified", { engineUsed, confidence, title: shopping?.title.slice(0, 120) || null, priced: hasSourcePrice });
  if (shopping && !hasSourcePrice) return getUnresolvedResult();

  // ── Publish the identification for the next person to scan this product.
  //    Written here, at the end, so what gets stored is the answer AFTER
  //    every pricing layer has run - which is why a later scan can reuse it
  //    and skip those layers rather than having to redo them. Only a
  //    confirmed, priced identification is worth storing, and never one the
  //    cache itself supplied: refreshing an entry on every hit would let an
  //    hour-old price live forever. ──
  if (shopping && !servedFromIdentityCache && confidence === "exact" && hasSourcePrice) {
    await storeIdentity(fingerprint, {
      title: shopping.title,
      price: shopping.lowestPrice,
      priceCurrency: shopping.priceCurrency ?? undefined,
      highestPrice: shopping.highestPrice,
      imageUrl: shopping.imageUrl,
      productUrl: shopping.productUrl,
      source: shopping.source,
      productId: shopping.productId,
      engineUsed,
      confidence: "exact",
      anchors: fingerprint?.listings || [],
      at: Date.now(),
    });
  }

  // ── Determine retail price ──
  //    Observed prices are converted to USD before anything compares them:
  //    the listings are in dollars, and a 299 dirham asking price is not a
  //    $299 one. See fx.ts.
  let retailPrice: number;
  let retailSource: "screenshot" | "estimated";
  let retailOriginal: RetailOriginal | undefined;
  const observed = vision.visiblePrice && vision.visiblePrice > 0
    ? await observedPriceInUsd(vision.visiblePrice, vision.currency)
    : discoveredPage?.price && discoveredPage.price > 0
      ? await observedPriceInUsd(discoveredPage.price, discoveredPage.currency)
      : null;
  if (observed && observed.usd > 0) {
    retailPrice = observed.usd;
    retailSource = "screenshot";
    retailOriginal = observed.original;
  } else if (shopping && shopping.highestPrice > 0) {
    retailPrice = shopping.highestPrice;
    retailSource = "estimated";
  } else {
    const cat = CATEGORY_DATA[vision.category] || CATEGORY_DATA.other;
    retailPrice = cat.avgRetail;
    retailSource = "estimated";
  }

  // ── Determine wholesale price ──
  // v9: no longer silently invents a number when the found price isn't
  // actually cheaper than retail (the old `retailPrice * 0.35` fabrication
  // — a fake number with no real link behind it, the same bug class as
  // Fix 1, just self-inflicted instead of from a mismatched candidate).
  // If the real found price doesn't support a markup claim, that's handled
  // honestly below by downgrading to FINDER instead of faking a VERDICT.
  const wholesalePrice = shopping && shopping.lowestPrice > 0
    ? shopping.lowestPrice
    : retailPrice * (CATEGORY_DATA[vision.category] || CATEGORY_DATA.other).wholesaleRatio;

  const { markup, savings, savingsPercent, verdict } = calculateVerdict(retailPrice, wholesalePrice);

  // ── Gate: a confident VERDICT requires THREE things, not two.
  //    1. a visually verified match,
  //    2. pricing that actually supports a markup claim (wholesale really
  //       is cheaper than retail), and
  //    3. an OBSERVED retail price — one read off the screenshot itself or
  //       off the seller's own product page.
  //
  //    (3) is the accuracy fix that matters most. Without it, a scan with
  //    no visible price fell back to `shopping.highestPrice`: the most
  //    expensive listing found on some third merchant. The card would then
  //    print "Retail asking $X" and accuse a seller of a markup using a
  //    price that seller never charged, which is both wrong and the one
  //    kind of wrong that is trivially disprovable by anyone who opens the
  //    listing. An estimated retail figure still produces a full FINDER
  //    result with the real source price attached; it just never carries a
  //    confident BUSTED. ──
  const engineHadRealMatch = !!shopping;
  // hasSourcePrice is stated explicitly rather than inferred: a wholesale
  // figure derived from a category ratio is an estimate, and an estimate
  // can never be the basis of a markup accusation against a named seller.
  const pricingSupportsVerdict = hasSourcePrice && wholesalePrice > 0 && wholesalePrice < retailPrice;
  const retailPriceWasObserved = retailSource === "screenshot";
  // SAME-MARKET VERDICTS: the asking price's currency against the currency
  // the source listing stated its own price in.
  const askingCurrency = !retailPriceWasObserved ? null
    : vision.visiblePrice && vision.visiblePrice > 0 ? (normalizeCurrency(vision.currency) || "USD")
    : (normalizeCurrency(discoveredPage?.currency || "") || "USD");
  const crossMarket = retailPriceWasObserved && hasSourcePrice && !sameMarket(askingCurrency, shopping?.priceCurrency);
  if (retailPriceWasObserved && hasSourcePrice) {
    traceStep("market", { asking: askingCurrency, source: shopping?.priceCurrency ?? null, same: !crossMarket });
  }
  // PLAUSIBLE GAP: two real prices more than 50 times apart are not compared.
  const gapImplausible = retailPriceWasObserved && hasSourcePrice && implausibleGap(retailPrice, wholesalePrice);
  if (gapImplausible) traceStep("plausibility", { askingUsd: retailPrice, sourceUsd: wholesalePrice, limit: IMPLAUSIBLE_GAP });
  // "Where is it cheapest?" is an explicit request to skip the markup
  // framing entirely, even when a confirmed verdict would otherwise be
  // possible. It is a display choice the visitor made, not an accuracy
  // fallback, so it overrides VERDICT unconditionally rather than only
  // applying when something else already failed.
  const mode: ScanResult["mode"] =
    intent === "finder" ? (engineHadRealMatch ? "FINDER" : "UNRESOLVED")
    : engineHadRealMatch && confidence !== "unverified" && pricingSupportsVerdict && retailPriceWasObserved && !crossMarket && !gapImplausible ? "VERDICT"
    : engineHadRealMatch ? "FINDER"
    : "UNRESOLVED";

  const finalConfidence: "high" | "medium" | "low" =
    confidence === "exact" && vision.visiblePrice ? "high"
    : confidence === "exact" || (confidence === "likely" && vision.visiblePrice) ? "high"
    : confidence === "likely" ? "medium"
    : "low";

  const linkResolution = shopping?.productUrl
    ? await resolveMerchantLink(shopping.productUrl, shopping.productId)
    : { url: "", isDirect: false };
  const resolvedUrl = linkResolution.url;
  const linkIsDirect = linkResolution.isDirect;

  return {
    found: engineHadRealMatch,
    mode,
    priceSource: retailSource,
    engineUsed,
    matchConfidence: confidence,
    category: vision.category || "other",
    shippingNote: regionalNote(resolvedUrl, requesterCountry, crossMarket),
    ...(gapImplausible ? { priceNote: IMPLAUSIBLE_GAP_NOTE } : {}),
    sourceProduct: {
      title: cleanTitle(shopping?.title || discoveredPage?.title || vision.productName) || "Similar product found",
      price: parseFloat(wholesalePrice.toFixed(2)),
      // The listing's price, which is in USD. This used to be the currency
      // read off the screenshot, which labelled a dollar figure as euros.
      currency: "USD",
      imageUrl: proxyImage(shopping?.imageUrl || ""),
      productUrl: resolvedUrl,
      affiliateUrl: resolvedUrl,
      linkIsDirect,
      platform: shopping?.source || vision.platform || "Web",
    },
    analysis: {
      retailEstimate: parseFloat(retailPrice.toFixed(2)),
      retailSource,
      markup,
      verdict: mode === "VERDICT" ? verdict : "UNVERIFIED",
      savings,
      savingsPercent,
      confidence: finalConfidence,
      ...(retailOriginal && retailSource === "screenshot" ? { retailOriginal } : {}),
    },
  };
}

// ════════════════════════════════════════════════════════════════
// URL SCAN — fetches the real page, reads it fully, and uses a multi-tier
// search fallback so a valid, readable product page should essentially
// always produce at least a FINDER result.
//
// `country` is used ONLY for the shippingNote disclosure — search always
// targets the US index regardless of the requester's location (see file
// header).
// ════════════════════════════════════════════════════════════════
export async function scanProductUrl(
  url: string, country?: string, intent?: "verdict" | "finder", hooks: ScanHooks = {}
): Promise<ScanResult> {
  return settleScan(() => scanUrl(url, country, intent), hooks);
}

async function scanUrl(url: string, country?: string, intent?: "verdict" | "finder"): Promise<ScanResult> {
  const requesterCountry = sanitizeCountry(country);
  const budget = createBudget();
  const spendMode = await currentSpendMode();

  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return getUnresolvedResult();
    }

    // ── Step 1: fetch the real page and extract real product data ──
    const html = await fetchProductPageHtml(url);
    const pageData: PageProductData = html
      ? await extractPageProductData(html, intent === "finder" ? "identity" : "critical")
      : { title: "", price: null, currency: "USD", imageUrl: "", description: "", searchQuery: "" };

    let baseQuery = pageData.searchQuery || pageData.title;
    if (!baseQuery) {
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1] || "";
      baseQuery = lastPart.replace(/[-_]/g, " ").replace(/[^a-zA-Z0-9 ]/g, " ").trim();
    }
    if (!baseQuery || baseQuery.length < 3) return getUnresolvedResult();

    const pageImage = pageData.imageUrl ? await fetchImageAsBase64(pageData.imageUrl) : null;
    // The page's own product photo is the reference every check on this
    // path compares against: capped for the models, original for Lens.
    const pageReference = pageImage ? await capForModel(pageImage) : null;
    // There is no vision pass on this path, so the page's own title is the
    // identity hint for ordering candidates, and the brand its own product
    // data states (when it states one) is what the match guards compare
    // listings with, as a brand read off a photo is. With no stated brand,
    // the brand rules have nothing to compare and do not apply.
    const hints: IdentityHints = { productName: pageData.title, ...(pageData.brand ? { brand: pageData.brand } : {}) };
    const gate: GateOptions = { hints, budget, mode: spendMode };

    // ── Step 2: search, Lens-first if we have a real photo ──
    let shopping: ShoppingMatch | null = null;
    let engineUsed = "none";
    let confidence: "exact" | "likely" | "unverified" = "unverified";

    if (pageImage) {
      const lensImageUrl = await uploadForLensSearch(pageImage.data, pageImage.mimeType);
      if (lensImageUrl) {
        const lens = await searchLens(lensImageUrl);
        shopping = lens.match;
        if (shopping) engineUsed = `url_lens_${lens.engine}`;
        await discardLensUpload(lensImageUrl);
      }
    }

    // Multi-tier query fallback (enriched -> plain title -> blunt top
    // words) instead of one narrow attempt. This is the core fix for a
    // valid URL coming back UNRESOLVED — a specific query is great when it
    // works, but "most specific possible" can mean "matches nothing" for a
    // niche product.
    if (!shopping) {
      const found = await searchShoppingWithFallbacks(
        [baseQuery, pageData.title, simplifyQuery(baseQuery)]
      );
      if (found) {
        shopping = found.match;
        engineUsed = `url_${found.engineUsed}`;
      }
    }

    if (!shopping) return getUnresolvedResult();

    // ── Step 3: visual verification — only possible with a real photo.
    //    Without one, confidence honestly stays "unverified" (FINDER). ──
    if (pageImage) {
      const judged = await judgePool(shopping, pageReference!, gate);
      const verified = settlePool(judged, gate);
      confidence = verified.confidence;
      shopping = applyVerifiedCandidate(shopping, verified);

      // The same escalation as the photo path, when the pool came from
      // Serper's Lens and nothing in it could be verified. See ESCALATION.
      if (confidence === "unverified" && engineUsed === "url_lens_serper") {
        const escalated = await escalateLens(pageImage, judged, pageReference!, gate, budget);
        if (escalated && escalated.verified.confidence !== "unverified") {
          shopping = applyVerifiedCandidate(escalated.pool, escalated.verified);
          confidence = escalated.verified.confidence;
          if (escalated.fromEscalation) engineUsed = `${engineUsed}+escalated_serpapi`;
        }
      }

      // Identify, then price — same second step as the image pipeline. A
      // Lens match confirmed against this page's own product photo can
      // easily be a record with no published price; the confirmed name is
      // then what finds one.
      if (confidence !== "unverified" && shopping.lowestPrice <= 0) {
        const priced = await priceVerifiedIdentity(shopping, confidence, pageReference!, gate);
        if (priced) {
          shopping = priced.match;
          confidence = priced.confidence;
          engineUsed = `${engineUsed}+priced_${priced.engineUsed}`;
        }
      }
    }

    // ── Direct-retailer check: same structural fix as the image-scan
    //    path. A URL scan of a smaller brand's own product page is
    //    exactly the case where Google's Shopping graph is most likely
    //    to only show that brand's own listing, with a cheaper Amazon,
    //    Walmart, or eBay copy invisible to it. Applies before the
    //    VERDICT/FINDER branch below, so it holds for every intent. ──
    if (shopping && pageImage && spendMode === "full" && budget.allows(ALTERNATIVE_LAYER_COST_MS)) {
      // Once the product has been identified, the confirmed title is a
      // better retailer query than the page-derived one, for the same
      // reason it is a better pricing query.
      const identifiedTitle = confidence !== "unverified" ? queryFromTitle(shopping.title, shopping.source) : "";
      const retailerQuery = identifiedTitle.length >= 3 ? identifiedTitle : baseQuery.trim();
      if (retailerQuery.length >= 3) {
        const retailerFound = await searchAllDirectRetailers(retailerQuery);
        if (retailerFound && retailerFound.match.lowestPrice > 0) {
          const retailerVerified = await verifyCandidates(
            retailerFound.match, pageReference!, { ...gate, window: VERIFY_WINDOW_PRICING }
          );
          // Same rule as the image pipeline: a cheaper challenger never
          // evicts a better-identified incumbent.
          if (shouldReplace(confidence, shopping.lowestPrice, retailerVerified.confidence, retailerVerified.best.price)) {
            shopping = applyVerifiedCandidate(retailerFound.match, retailerVerified);
            engineUsed = `url_direct_${retailerVerified.best.source.toLowerCase()}`;
            confidence = retailerVerified.confidence;
          }
        }
      }
    }

    // ── Step 4: retail price. A price read directly off the real page is
    //    as trustworthy as a visible price in a screenshot. ──
    let retailPrice: number;
    let retailSource: "screenshot" | "estimated";
    let retailOriginal: RetailOriginal | undefined;
    const observed = pageData.price && pageData.price > 0
      ? await observedPriceInUsd(pageData.price, pageData.currency)
      : null;
    if (observed && observed.usd > 0) {
      retailPrice = observed.usd;
      retailSource = "screenshot";
      retailOriginal = observed.original;
    } else if (shopping.highestPrice > 0) {
      retailPrice = shopping.highestPrice;
      retailSource = "estimated";
    } else {
      return getUnresolvedResult();
    }

    const wholesalePrice = shopping.lowestPrice;
    // Only bail on truly invalid data (no usable price at all). Whether the
    // pricing actually supports a "you're overpaying" claim is decided
    // below by VERDICT-vs-FINDER, not by refusing to return a result.
    if (wholesalePrice <= 0) return getUnresolvedResult();

    const { markup, savings, savingsPercent, verdict } = calculateVerdict(retailPrice, wholesalePrice);
    const pricingSupportsVerdict = wholesalePrice < retailPrice;
    // SAME-MARKET VERDICTS: the page's own currency against the source's.
    const crossMarket = retailSource === "screenshot" && !sameMarket(pageData.currency, shopping.priceCurrency);
    if (retailSource === "screenshot") {
      traceStep("market", { asking: pageData.currency || null, source: shopping.priceCurrency ?? null, same: !crossMarket });
    }
    // PLAUSIBLE GAP, as in the image pipeline.
    const gapImplausible = retailSource === "screenshot" && implausibleGap(retailPrice, wholesalePrice);
    if (gapImplausible) traceStep("plausibility", { askingUsd: retailPrice, sourceUsd: wholesalePrice, limit: IMPLAUSIBLE_GAP });
    // Same three-part gate as the image pipeline: a confident verdict needs
    // a verified match, a real gap, AND a retail price actually read off
    // the seller's own page. A markup claim built on some other merchant's
    // listing price is a claim the seller can disprove in one click.
    const retailPriceWasObserved = retailSource === "screenshot";
    // Same override as the image path - an explicit "just find the
    // cheapest price" request always suppresses the verdict framing.
    const mode: ScanResult["mode"] =
      intent === "finder" ? "FINDER"
      : confidence !== "unverified" && pricingSupportsVerdict && retailPriceWasObserved && !crossMarket && !gapImplausible ? "VERDICT" : "FINDER";
    const linkResolution = await resolveMerchantLink(shopping.productUrl, shopping.productId);
    const resolvedUrl = linkResolution.url;
    const linkIsDirect = linkResolution.isDirect;

    return {
      found: true,
      mode,
      priceSource: retailSource,
      engineUsed,
      matchConfidence: confidence,
      category: inferCategory(pageData.title, pageData.description, shopping.title),
      shippingNote: regionalNote(resolvedUrl, requesterCountry, crossMarket),
      ...(gapImplausible ? { priceNote: IMPLAUSIBLE_GAP_NOTE } : {}),
      sourceProduct: {
        title: cleanTitle(pageData.title || shopping.title),
        price: parseFloat(wholesalePrice.toFixed(2)),
        currency: "USD",
        imageUrl: proxyImage(shopping.imageUrl || pageData.imageUrl || ""),
        productUrl: resolvedUrl,
        affiliateUrl: resolvedUrl,
        linkIsDirect,
        platform: shopping.source,
      },
      analysis: {
        retailEstimate: parseFloat(retailPrice.toFixed(2)),
        retailSource,
        markup,
        verdict: mode === "VERDICT" ? verdict : "UNVERIFIED",
        savings,
        savingsPercent,
        confidence: mode === "VERDICT" ? (confidence === "exact" ? "high" : "medium") : "low",
        ...(retailOriginal && retailSource === "screenshot" ? { retailOriginal } : {}),
      },
    };
  } catch (err) {
    // An exception is the engine failing, not the page having nothing on
    // it. It used to come back as "no match"; now it is said out loud.
    reportProviderFailure({
      layer: "engine", provider: "engine", status: 0, kind: "exception",
      detail: String((err as Error)?.stack || err), severity: "critical",
    });
    return getUnresolvedResult();
  }
}

// ════════════════════════════════════════════════════════════════
// UNRESOLVED — only reached when every real layer has failed. Never
// carries a fabricated verdict or a fake "BUSTED" number.
// ════════════════════════════════════════════════════════════════
export function getUnresolvedResult(): ScanResult {
  return {
    found: false,
    mode: "UNRESOLVED",
    priceSource: "estimated",
    engineUsed: "none",
    matchConfidence: "unverified",
    category: "other",
    sourceProduct: {
      title: "Product not identified",
      price: 0, currency: "USD", imageUrl: "", productUrl: "", affiliateUrl: "",
      platform: "unknown",
    },
    analysis: {
      retailEstimate: 0, retailSource: "estimated", markup: 0,
      verdict: "UNVERIFIED", savings: 0, savingsPercent: 0, confidence: "low",
    },
  };
}

// ════════════════════════════════════════════════════════════════
// DIAGNOSE. What /api/diagnose runs: one real call to each Claude model the
// engine uses, built by the same builder with the same payload a scan sends
// (the gate shape on Opus 5.5 and on Sonnet 5.5, the extraction shape on
// Sonnet 5.5), and one real Lens search on a sample photo through the same
// Blob upload and delete a scan does. The test suite cannot do this: it
// stubs every provider, which is exactly how a request every provider would
// have refused shipped green.
// ════════════════════════════════════════════════════════════════
export interface LayerProbe {
  layer: string;
  pass: boolean;
  latencyMs: number;
  status: number;
  detail: string;
  [extra: string]: unknown;
}

const roundUsd = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return ""; } };
// The diagnose photo's long edge: enough image tokens to clear the 512-token
// caching minimum, so the probes exercise prompt caching.
const DIAGNOSE_PHOTO_EDGE = 768;

/**
 * The Lens layer as /api/diagnose reports it: Serper, the primary, on a
 * public image URL, with the shape of its live answer (the list it used, the
 * field names on a row, the top-level keys) and the credits it reported.
 * SerpApi, the backup, is not searched here: its account lookup in the
 * diagnose route is free, a search is not.
 */
export async function probeSerperLens(url: string): Promise<LayerProbe> {
  if (!process.env.SERPER_API_KEY) {
    return { layer: "lens serper", pass: false, latencyMs: 0, status: 0, detail: "SERPER_API_KEY is not set: Lens has no primary provider" };
  }
  const started = Date.now();
  const lens = await runTraced(() => searchLensViaSerper(url));
  const failure = lens.failures[0];
  const candidates = lens.value?.candidates || [];
  const shape = (lens.trace.steps.find(st => st.step === "serper_lens") || {}) as Record<string, unknown>;
  const credits = lens.trace.searches.find(x => x.provider === "serper")?.credits ?? null;
  // Usable means the gate could judge it and the card could link it: an
  // image URL and a listing link.
  const usable = candidates.filter(c => c.imageUrl && c.productUrl).length;
  const priced = candidates.filter(c => c.price > 0).length;
  return {
    layer: "lens serper",
    pass: !failure,
    latencyMs: Date.now() - started,
    status: failure?.status ?? 200,
    detail: failure ? `${failure.kind}: ${failure.detail}`
      : candidates.length ? `${candidates.length} visual matches, ${usable} usable (image and link), ${priced} priced; first: ${candidates[0]?.title?.slice(0, 80) || "(untitled)"}`
      : "the call succeeded but returned no visual matches",
    matches: candidates.length,
    usable,
    priced,
    creditsUsed: credits,
    responseShape: { list: shape.list ?? null, rows: shape.rows ?? 0, rowFields: shape.fields ?? [], topLevel: shape.topLevel ?? [] },
    sample: candidates.slice(0, 3).map(c => ({ title: c.title.slice(0, 80), source: c.source, price: c.price || null, imageHost: hostOf(c.imageUrl) })),
  };
}

export async function diagnoseEngine(sample: { data: string; mimeType: string }): Promise<LayerProbe[]> {
  const isExtraction = (text: string | null) => {
    const parsed = parseReplyJson(text);
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed) && "productName" in (parsed as object);
  };
  const isVerdict = (text: string | null) => {
    const parsed = parseReplyJson(text);
    const list = Array.isArray(parsed) ? parsed : salvageVerdictObjects(text || "");
    return list.some(entry => coerceVerdict(entry) !== null);
  };
  // The sample is 320px, about 137 image tokens: under the 512-token minimum
  // a prefix needs before it caches. Scaled to 768px it is about 790, so the
  // probes cache the photo the way a real scan does (THE PHOTO, ONCE PER
  // SCAN). The gate compares it with the original sample: a working gate
  // answers "exact".
  const photo = await scaleImage(sample, DIAGNOSE_PHOTO_EDGE);
  const gate = gatePayload(photo, [sample]);
  const extraction = extractionPayload(photo.data, photo.mimeType);

  const probe = async (
    role: string, layer: FailureLayer, model: string, payload: Record<string, unknown>,
    accept: (t: string | null) => boolean, effort: Effort | null
  ): Promise<LayerProbe & { cacheReadTokens: number; cacheWriteTokens: number; ok: boolean }> => {
    const started = Date.now();
    const { value: call, trace } = await runTraced(() =>
      callClaude(layer, model, payload, layer === "gate" ? GATE_TIMEOUT_MS : EXTRACT_TIMEOUT_MS, { effort })
    );
    const usage = trace.calls[0];
    const parsed = call.ok && accept(call.text);
    const { messages, ...shape } = buildClaudeRequest(model, payload, { effort });
    void messages;
    // Output tokens are thinking plus the visible answer. The answer is
    // estimated at four characters a token; the rest is thinking, which is
    // the number scripts/cost-model.mjs needs (--thinking).
    const answerTokens = Math.ceil((call.text || "").length / 4);
    const thinkingTokens = typeof call.outputTokens === "number" ? Math.max(0, call.outputTokens - answerTokens) : null;
    return {
      layer: `claude ${model} (${role})`,
      pass: parsed && !call.truncated,
      ok: call.ok,
      latencyMs: Date.now() - started,
      status: call.status,
      detail: parsed ? (call.truncated ? "answered, but stopped at max_tokens: thinking needs more room" : "answered and parsed")
        : call.ok ? `answered but the reply did not parse: ${(call.text || "").slice(0, 200)}`
        : `${call.kind}: ${call.detail.slice(0, 300)}`,
      stopReason: call.stopReason ?? null,
      costUsd: roundUsd(call.costUsd || 0),
      outputTokens: call.outputTokens ?? null,
      thinkingTokensApprox: thinkingTokens,
      inputTokens: usage?.inputTokens ?? null,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      maxTokens: shape.max_tokens,
      reply: call.ok ? (call.text || "").slice(0, 200) : null,
      request: shape,
    };
  };

  // Every model the engine uses, each in the role that matters most for it:
  // Sonnet 5.5 as the first read and as the gate (also the degraded gate and
  // the cache-hit re-confirmation); Opus 5.5 as the gate it falls back to
  // (and the extraction escalation). The order is the point: the first read
  // writes the photo to Sonnet's cache, and the Sonnet gate, which starts
  // after it has answered, must read it back. That read is the standing
  // proof that prompt caching works in production, and the "prompt cache"
  // layer fails when it does not happen, because a cache that silently
  // stops hitting raises the cost of every scan without any other symptom.
  const claude = (async (): Promise<LayerProbe[]> => {
    const [firstRead, fallback] = await Promise.all([
      probe("first read, page text, search query", "extraction", EXTRACT_MODEL, extraction, isExtraction, null),
      probe("gate fallback, extraction escalation", "gate", GATE_MODEL_FALLBACK, gate, isVerdict, gateEffort()),
    ]);
    const gateProbe = await probe("gate, degraded gate, re-confirmation", "gate", GATE_MODEL, gate, isVerdict, gateEffort());
    const measured = firstRead.ok && gateProbe.ok;
    const cache: LayerProbe = {
      layer: "prompt cache",
      pass: measured && gateProbe.cacheReadTokens > 0,
      latencyMs: 0,
      status: measured ? 200 : 0,
      detail: !measured
        ? "not measured: the first read or the gate call failed (see those layers)"
        : gateProbe.cacheReadTokens > 0
          ? `the ${GATE_MODEL} gate read ${gateProbe.cacheReadTokens} tokens of the photo from the cache the first read wrote (${firstRead.cacheWriteTokens} written)`
          : `the ${GATE_MODEL} gate read nothing from the cache (the first read wrote ${firstRead.cacheWriteTokens}): every call pays for the photo in full. ` +
            "Check that the first read and the gate open with the same photo blocks and run at the same effort (GATE_EFFORT).",
      firstReadWriteTokens: firstRead.cacheWriteTokens,
      gateReadTokens: gateProbe.cacheReadTokens,
      gateWriteTokens: gateProbe.cacheWriteTokens,
    };
    const strip = ({ ok, ...rest }: LayerProbe & { ok: boolean }): LayerProbe => { void ok; return rest; };
    return [strip(gateProbe), strip(fallback), strip(firstRead), cache];
  })();

  const lensAndBlob = (async (): Promise<LayerProbe[]> => {
    const out: LayerProbe[] = [];
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return [{ layer: "blob", pass: false, latencyMs: 0, status: 0, detail: "BLOB_READ_WRITE_TOKEN is not set: Lens cannot run at all" }];
    }
    const started = Date.now();
    const upload = await runTraced(() => uploadForLensSearch(sample.data, sample.mimeType));
    const url = upload.value;
    if (!url) {
      const f = upload.failures[0];
      return [{ layer: "blob", pass: false, latencyMs: Date.now() - started, status: f?.status ?? 0, detail: `upload failed: ${f?.detail || "unknown"}` }];
    }
    let readable = 0;
    try {
      readable = (await fetch(url, { signal: AbortSignal.timeout(6000) })).status;
    } catch { /* reported below */ }
    const uploadMs = Date.now() - started;

    out.push(await probeSerperLens(url));

    const deleteStarted = Date.now();
    let deleted = true;
    let deleteError = "";
    try {
      await del(url);
    } catch (err) {
      deleted = false;
      deleteError = String((err as Error)?.message || err).slice(0, 200);
    }
    out.unshift({
      layer: "blob",
      pass: readable === 200 && deleted,
      latencyMs: uploadMs + (Date.now() - deleteStarted),
      status: readable,
      detail: readable !== 200 ? `uploaded, but the public URL answered ${readable || "nothing"}: Lens could not read it`
        : deleted ? "uploaded, publicly readable, deleted"
        : `uploaded and readable, but delete failed (the daily cleanup cron will remove it): ${deleteError}`,
    });
    return out;
  })();

  const [claudeProbes, lensProbes] = await Promise.all([claude, lensAndBlob]);
  return [...claudeProbes, ...lensProbes];
}

// ════════════════════════════════════════════════════════════════
// REPLAYS, for the operator evaluation route (/api/eval). One extraction or
// one gate call on a named model and effort, built and read exactly as a
// scan builds and reads it, so models can be compared on the same photo and
// the same candidates without repeating any search. The route decides who
// may call these; see eval-log.ts.
// ════════════════════════════════════════════════════════════════
export interface ReplayCall {
  ok: boolean;
  kind: string;
  status: number;
  detail: string;
  call: ScanTrace["calls"][number] | null;
}

export async function replayExtraction(
  image: { data: string; mimeType: string },
  model: string,
  effort: Effort | null
): Promise<ReplayCall & { read: VisionExtraction | null }> {
  const capped = await capForModel(image);
  const { value, trace } = await runTraced(async () => {
    const outcome = await callClaude("extraction", model, extractionPayload(capped.data, capped.mimeType), EXTRACT_TIMEOUT_MS, { effort });
    const parsed = outcome.ok ? parseReplyJson(outcome.text) : null;
    const read = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? cleanExtraction({ ...EMPTY_READ, ...(parsed as Partial<VisionExtraction>) })
      : null;
    return { outcome, read };
  });
  const { outcome, read } = value;
  return {
    ok: outcome.ok && !!read, kind: read || !outcome.ok ? outcome.kind : "unparseable", status: outcome.status,
    detail: outcome.detail, call: trace.calls[0] ?? null, read,
  };
}

/**
 * One gate call on stored candidates, answered as a scan would act on it:
 * each verdict after the match guards, with the gate's own answer kept
 * beside it when a guard changed it. `read` is what the scan's first read
 * saw (omitted, the brand rules do not apply, as on a link scan).
 */
export async function replayGate(
  reference: { data: string; mimeType: string },
  candidates: (GateCandidate & { link?: string })[],
  model: string,
  effort: Effort | null,
  read?: { brand: string; productName: string }
): Promise<ReplayCall & { verdicts: VerificationResult[]; loaded: number }> {
  const capped = await capForModel(reference);
  const sent = candidates.slice(0, VERIFY_BATCH_MAX);
  const { value, trace } = await runTraced(() => verifyVisualMatchBatch(capped, sent, model, "gate", effort));
  const verdicts = value.results.map((result, i) =>
    guardResult(result, { title: sent[i].title || "", source: sent[i].source || "", productUrl: sent[i].link || "" }, read)
  );
  return {
    ok: value.ok, kind: value.call?.kind || (value.ok ? "ok" : "no-images"), status: value.call?.status ?? 0,
    detail: value.call?.detail || "", call: trace.calls[0] ?? null, verdicts, loaded: value.loaded ?? 0,
  };
}
