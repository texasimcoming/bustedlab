import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { isOperator } from "@/lib/operator";
import { deleteScanRecord, getScanRecord, subtractPublicCounters, type PublicCounterCorrection } from "@/lib/redis";
import { logEvaluationUse } from "@/lib/eval-log";

/**
 * EVALUATION PURGE. Operator evaluation scans no longer reach public data
 * (THE OPERATOR EVALUATION PATH in the scan route), but the runs before that
 * rule did. This removes what they left, once:
 *
 *   POST /api/eval/purge  (Authorization: Bearer $ANALYTICS_TOKEN)
 *   { "purgeId": "eval-runs-1-4",
 *     "scanIds": ["<ledger record id>", ...],
 *     "counters": { "scans": 48, "verdicts": 1, "busted": 0, "savingsUsd": 22.24 },
 *     "dryRun": false }
 *
 * The ids and the counter amounts are computed by scripts/production-eval.mjs
 * (the "purge" step) from the raw responses the evaluation committed under
 * evals/results/, so what is removed is auditable in the repository. Each id
 * loses its ledger record, its permanent page, its board entries and its
 * share of its product's aggregate; the counters lose exactly what those
 * scans added to them, never going below zero.
 *
 * Applied once per purgeId: a repeat answers with the first result and
 * changes nothing, so re-running the workflow cannot subtract twice. A dry
 * run reports what would be removed and records nothing. Every use is
 * logged (eval-log.ts).
 */
export const dynamic = "force-dynamic";

const MAX_IDS = 100;
const ID_SHAPE = /^[a-z0-9]{8,48}$/;
const PURGE_ID_SHAPE = /^[a-z0-9][a-z0-9-]{2,63}$/;

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

const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

function bounded(value: unknown, max: number): number | null {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

export async function POST(req: NextRequest) {
  if (!isOperator(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest("body must be JSON");
  }
  const purgeId = typeof body.purgeId === "string" ? body.purgeId : "";
  if (!PURGE_ID_SHAPE.test(purgeId)) return badRequest("purgeId must be 3-64 lowercase letters, digits or dashes");
  const scanIds = Array.isArray(body.scanIds) ? body.scanIds : [];
  if (scanIds.length > MAX_IDS || !scanIds.every(id => typeof id === "string" && ID_SHAPE.test(id))) {
    return badRequest(`scanIds must be at most ${MAX_IDS} ledger record ids`);
  }
  const raw = (body.counters || {}) as Record<string, unknown>;
  const counters: PublicCounterCorrection = {
    scans: bounded(raw.scans, 10_000) ?? -1,
    verdicts: bounded(raw.verdicts, 10_000) ?? -1,
    busted: bounded(raw.busted, 10_000) ?? -1,
    savingsUsd: bounded(raw.savingsUsd, 1_000_000) ?? -1,
  };
  if (Object.values(counters).some(v => v < 0)) return badRequest("counters must be non-negative numbers");
  if (counters.busted > counters.verdicts) return badRequest("counters.busted cannot exceed counters.verdicts");
  const dryRun = body.dryRun === true;
  const ids = [...new Set(scanIds as string[])];

  const doneKey = `eval:purge:${purgeId}`;
  const previous = await getRedis().get(doneKey).catch(() => null);
  if (previous) {
    return NextResponse.json({ purgeId, alreadyApplied: true, result: previous }, { headers: { "Cache-Control": "no-store" } });
  }

  if (dryRun) {
    const found = await Promise.all(ids.map(async id => ({ id, record: await getScanRecord(id) })));
    return NextResponse.json({
      purgeId, dryRun: true,
      wouldRemove: found.filter(f => f.record).map(f => ({ id: f.id, title: f.record!.title, verdict: f.record!.verdict, ts: f.record!.ts })),
      notFound: found.filter(f => !f.record).map(f => f.id),
      counters,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  // Claimed before anything is changed, so two concurrent runs cannot both apply.
  const claimed = await getRedis().set(doneKey, JSON.stringify({ status: "in progress" }), { nx: true }).catch(() => null);
  if (!claimed) return NextResponse.json({ error: "purge_in_progress_or_unavailable" }, { status: 409 });

  const removed: { id: string; title: string; verdict: string; ts: number }[] = [];
  const notFound: string[] = [];
  for (const id of ids) {
    const record = await deleteScanRecord(id);
    if (record) removed.push({ id, title: record.title, verdict: record.verdict, ts: record.ts });
    else notFound.push(id);
  }
  const counterChanges = await subtractPublicCounters(counters);
  const result = { removed, notFound, counters: counterChanges, at: new Date().toISOString() };
  await getRedis().set(doneKey, JSON.stringify(result)).catch(() => null);
  await logEvaluationUse("purge", { purgeId, removed: removed.length, notFound: notFound.length, counters });
  return NextResponse.json({ purgeId, alreadyApplied: false, result }, { headers: { "Cache-Control": "no-store" } });
}
