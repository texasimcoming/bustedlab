import { Redis } from "@upstash/redis";
import type { NextRequest } from "next/server";
import { isOperator } from "@/lib/operator";

/**
 * THE OPERATOR EVALUATION PATH, ON THE RECORD.
 *
 * Two things answer the operator token (ANALYTICS_TOKEN) and spend money:
 *
 *   - An evaluation scan: POST /api/scan with the token and the
 *     `x-bustedlab-eval: 1` header. It is the real scan with two differences:
 *     it does not check or count the FREE allowance (two scans per browser a
 *     day, forty per address), because a labelled evaluation run from one
 *     machine is forty scans from one address; and it never reaches public
 *     data (no ledger record, public counter, stats or cached result).
 *     Everything that protects the budget still applies to it: the burst
 *     limit, the global daily cap on uncached free scans (and the counter
 *     behind it), and the model spend governor inside the engine.
 *   - A replay: POST /api/eval runs one extraction or one gate call on a
 *     named model, so models and effort levels can be compared on the same
 *     photos and candidates without repeating the searches. It refuses to run
 *     while the engine is degraded (the day's budget belongs to visitors
 *     then) and past EVAL_DAILY_REPLAYS calls a day.
 *   - A purge: POST /api/eval/purge removes what evaluation runs wrote to
 *     public data before evaluation scans were kept out of it, once.
 *
 * Every use is logged: one console line in the runtime log and an entry in
 * a short Redis list that /api/diagnose shows under `evaluation`, with
 * per-day counts. Nothing about a person is in either; these requests come
 * from the operator.
 */

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

export type EvaluationKind = "scan" | "replay" | "purge";

/** The header that, with the operator token, makes a scan an evaluation scan. */
export const EVAL_HEADER = "x-bustedlab-eval";

/** Both are needed: the header alone is ignored, and so is the token alone. */
export function isEvaluationRequest(req: NextRequest): boolean {
  return req.headers.get(EVAL_HEADER) === "1" && isOperator(req);
}

/** Replay calls allowed per day: a leaked token can only spend this much. */
export const EVAL_DAILY_REPLAYS = Number(process.env.EVAL_DAILY_REPLAYS || 600);
const RECENT_KEPT = 100;
const DAY_TTL_SECONDS = 60 * 60 * 24 * 8;

const day = (date = new Date()) => date.toISOString().slice(0, 10);
const keys = {
  count: (kind: EvaluationKind, d: string) => `eval:${kind}:${d}`,
  recent: "eval:recent",
};

/** Logs one use of the evaluation path. Never throws. */
export async function logEvaluationUse(kind: EvaluationKind, detail: Record<string, unknown>): Promise<void> {
  const entry = { at: new Date().toISOString(), kind, ...detail };
  console.log(`[eval] ${kind} ${JSON.stringify(detail).slice(0, 400)}`);
  try {
    const pipeline = getRedis().pipeline();
    pipeline.incr(keys.count(kind, day()));
    pipeline.expire(keys.count(kind, day()), DAY_TTL_SECONDS);
    pipeline.lpush(keys.recent, JSON.stringify(entry).slice(0, 600));
    pipeline.ltrim(keys.recent, 0, RECENT_KEPT - 1);
    await pipeline.exec();
  } catch {
    /* the console line above is the record of last resort */
  }
}

/**
 * Whether one more replay may run today. Counted before the call, so a
 * burst of parallel requests cannot all slip under the limit. A Redis outage
 * refuses: unlike a visitor's scan, nothing is lost by a replay not running.
 */
export async function replayAllowed(): Promise<boolean> {
  try {
    const key = `eval:replay-budget:${day()}`;
    const used = await getRedis().incr(key);
    await getRedis().expire(key, DAY_TTL_SECONDS);
    return used <= EVAL_DAILY_REPLAYS;
  } catch {
    return false;
  }
}

export interface EvaluationUsage {
  today: { scans: number; replays: number };
  replayLimit: number;
  recent: unknown[];
}

export async function evaluationUsage(): Promise<EvaluationUsage> {
  try {
    const redis = getRedis();
    const [scans, replays, recent] = await Promise.all([
      redis.get<number | null>(keys.count("scan", day())),
      redis.get<number | null>(keys.count("replay", day())),
      redis.lrange<unknown>(keys.recent, 0, 19),
    ]);
    return {
      today: { scans: Number(scans || 0), replays: Number(replays || 0) },
      replayLimit: EVAL_DAILY_REPLAYS,
      recent: (recent || []).map(e => {
        try { return typeof e === "string" ? JSON.parse(e) : e; } catch { return e; }
      }),
    };
  } catch {
    return { today: { scans: 0, replays: 0 }, replayLimit: EVAL_DAILY_REPLAYS, recent: [] };
  }
}
