import { Redis } from "@upstash/redis";

/**
 * MODEL SPEND GOVERNOR.
 *
 * The premise of this product is virality, and the free tier gives away
 * scans with no revenue attached. A video landing means tens of thousands of
 * scans in a day, nearly all of them free. That day should be the best day
 * this company has ever had, not the day it goes into debt to an
 * infrastructure provider. So the identification pipeline is not allowed to
 * spend without a ceiling, and the ceiling is denominated in DOLLARS rather
 * than in scans.
 *
 * That distinction is not pedantic. There was already a global daily cap in
 * redis.ts, GLOBAL_DAILY_SCAN_CAP, set to 25,000 uncached scans. It was
 * chosen when a scan cost less than a cent of model spend. Raising the
 * quality of the identification raised the cost per scan, and because that
 * cap counts scans, the actual dollar exposure behind the same unchanged
 * number moved with it. A cap you have to re-derive every time the pipeline
 * changes is not a cap. This one is in the unit that matters.
 *
 * Three layers, deliberately:
 *
 *   1. This soft budget. Measured from real `usage` on every API response
 *      (thinking included: it is billed as output), not estimated. When the
 *      day's spend crosses DAILY_MODEL_BUDGET_USD the engine DEGRADES rather
 *      than failing: the rebrand and direct-retailer layers are dropped and
 *      the gate (Sonnet 5.5, with Opus 5.5 only if Sonnet cannot answer) is
 *      barred from its strongest label.
 *      A scan still answers: a match the degraded gate calls exact AND that
 *      independently carries the brand read off the photo is "likely" and
 *      can still reach a verdict; anything else is a closest match. A reused
 *      identification is unaffected, since the full gate is what made it.
 *      The budget never refuses a scan. What bounds a day's total is the
 *      number of uncached scans that can reach the models at all
 *      (GLOBAL_DAILY_SCAN_CAP for the free tier, the fair-use ceiling per
 *      paid account); `npm run cost-model` prints the worst day for each
 *      budget value.
 *   2. The circuit breaker below, which trips on the API's own backpressure
 *      (429 rate limited, 402 billing, 529 overloaded) and degrades for a
 *      cooldown instead of hammering a limit that is already saying no.
 *   3. A workspace-level spend limit and, more importantly, a workspace
 *      RATE limit in the Claude Console. That is the only one of the three
 *      that does not depend on this application's own infrastructure being
 *      healthy, which is why it exists (see the note on failing open below).
 *
 * FAILING OPEN. Every function here swallows its errors and reports the
 * permissive answer: a Redis outage degrades to spending, not to refusing
 * every scan, which matches how the burst limiter in the scan route already
 * behaves. That is a deliberate choice and it is exactly why layer 3 is not
 * optional - a ceiling enforced by the thing that might be broken is not a
 * ceiling.
 */

export type SpendMode = "full" | "degraded";

// USD per million tokens, from the published price list as of 2026-10-01,
// for the two models the product uses. Cache writes (5-minute TTL) cost
// 1.25x input on both; cache reads cost 0.05x input on Opus 5.5 and 0.1x on
// Sonnet 5.5 ($0.20 per million on both). Thinking tokens are billed as
// output and arrive inside usage.output_tokens, so they are priced here
// without any special case.
// https://platform.claude.com/docs/en/about-claude/pricing
const PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4.0, output: 20.0, cacheRead: 0.05 },
  "claude-sonnet-5-5": { input: 2.0, output: 10.0, cacheRead: 0.1 },
  // Measured by the evaluation route; cache reads are 0.025x on Fable 5.1.
  "claude-fable-5-1": { input: 10.0, output: 50.0, cacheRead: 0.025 },
};
// What a model missing from the table is priced at: the most expensive rate
// on the list, so an unpriced model can only make the budget trip early,
// never late.
const UNKNOWN_MODEL_RATE = { input: 10.0, output: 50.0, cacheRead: 0.1 };
const CACHE_WRITE_MULTIPLIER = 1.25;

export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * What a call actually cost, from the usage the API reported. An unknown
 * model prices at the most expensive rate on the list rather than at zero:
 * an un-priced model silently costing nothing is how a budget stops working
 * the day someone adds a model.
 */
export function priceUsage(model: string, usage: ClaudeUsage | undefined): number {
  if (!usage) return 0;
  const rate = PRICING[model.replace(/-\d{8}$/, "")] || UNKNOWN_MODEL_RATE;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const write = usage.cache_creation_input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  return (
    (input * rate.input +
      write * rate.input * CACHE_WRITE_MULTIPLIER +
      read * rate.input * rate.cacheRead +
      output * rate.output) /
    1_000_000
  );
}

// The number to tune. In `npm run cost-model`, at 1,000 thinking tokens a
// call, a cold scan is about $0.105 of model spend on the full path, a scan
// of an already-identified product about $0.032, and a degraded scan about
// $0.048. So $250 buys roughly 2,400 cold scans on the full path, or several
// times that when the traffic is concentrated on a few products, which is
// what a viral moment produces. Replace those figures with measured ones:
// /api/diagnose reports real thinking tokens per call.
export const DAILY_MODEL_BUDGET_USD = Number(process.env.DAILY_MODEL_BUDGET_USD || 250);

// How long the engine stays degraded after the API pushes back. Long enough
// that a tripped limit is not retried into the ground, short enough that a
// brief spike does not degrade the product for an hour.
const BREAKER_COOLDOWN_SECONDS = Number(process.env.MODEL_BREAKER_COOLDOWN || 300);
// A billing failure will not clear on its own, so there is no point probing
// it every five minutes.
const BILLING_COOLDOWN_SECONDS = 1800;

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL || "https://placeholder.upstash.io",
      token: process.env.UPSTASH_REDIS_REST_TOKEN || "placeholder",
    });
  }
  return _redis;
}

const dayKey = () => `spend:model:${new Date().toISOString().slice(0, 10)}`;
const BREAKER_KEY = "spend:model:breaker";

/**
 * Adds one call's real cost to today's total. Awaited rather than fired and
 * forgotten: on a serverless runtime a floating promise can be killed when
 * the response returns, and a budget that loses writes is not a budget. It
 * is one INCRBYFLOAT against a counter, which is cheap enough to pay for on
 * each of the handful of model calls a scan makes.
 */
export async function recordModelSpend(usd: number): Promise<void> {
  if (!(usd > 0)) return;
  try {
    const key = dayKey();
    await getRedis().incrbyfloat(key, usd);
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    await getRedis().expireat(key, Math.floor(midnight.getTime() / 1000));
  } catch {
    /* see FAILING OPEN above */
  }
}

export async function todayModelSpend(): Promise<number> {
  try {
    const raw = await getRedis().get(dayKey());
    return Number(raw) || 0;
  } catch {
    return 0;
  }
}

/**
 * Trips the breaker when the API itself pushes back. 429 is what a workspace
 * rate limit produces, 402 a billing problem, 529 an overloaded API. None of
 * them are improved by sending the same request again immediately, and all
 * three mean the next scan should take the degraded path.
 */
export async function reportModelFailure(status: number, spendCap = false): Promise<void> {
  if (status !== 429 && status !== 402 && status !== 529 && !spendCap) return;
  // A spend cap (the account tier's monthly cap, or a limit set in the
  // Console) does not lift in minutes either; probe it at the billing pace.
  const cooldown = status === 402 || spendCap ? BILLING_COOLDOWN_SECONDS : BREAKER_COOLDOWN_SECONDS;
  try {
    await getRedis().set(BREAKER_KEY, String(status), { ex: cooldown });
  } catch {
    /* see FAILING OPEN above */
  }
}

// Read once per scan, then reused for the whole scan. Cached briefly in the
// process because a serverless instance handles several scans and the answer
// cannot meaningfully change between two of them.
let _modeCache: { mode: SpendMode; at: number } | null = null;
const MODE_CACHE_MS = 10_000;

export async function currentSpendMode(): Promise<SpendMode> {
  if (_modeCache && Date.now() - _modeCache.at < MODE_CACHE_MS) return _modeCache.mode;
  let mode: SpendMode = "full";
  try {
    const [breaker, spend] = await Promise.all([
      getRedis().get(BREAKER_KEY),
      getRedis().get(dayKey()),
    ]);
    if (breaker) mode = "degraded";
    else if ((Number(spend) || 0) >= DAILY_MODEL_BUDGET_USD) mode = "degraded";
  } catch {
    mode = "full";
  }
  _modeCache = { mode, at: Date.now() };
  return mode;
}

/** Test seam: forget the cached mode so a changed budget takes effect now. */
export function resetSpendModeCache(): void {
  _modeCache = null;
}
