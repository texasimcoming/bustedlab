import { NextRequest, NextResponse } from "next/server";
import { isOperator } from "@/lib/operator";
import { replayExtraction, replayGate } from "@/lib/scan";
import { rulesFor, parseEffort } from "@/lib/model-rules";
import { currentSpendMode } from "@/lib/model-budget";
import { logEvaluationUse, replayAllowed } from "@/lib/eval-log";
import { isPrivateHostname } from "@/lib/net-guard";

/**
 * MODEL REPLAYS, for choosing models on evidence. One extraction or one gate
 * call on a named model and effort, built and read exactly as a scan does:
 *
 *   POST /api/eval  (Authorization: Bearer $ANALYTICS_TOKEN)
 *   { "op": "extract", "model": "claude-sonnet-5-5", "effort": "low",
 *     "image": { "data": "<base64>", "mimeType": "image/jpeg" } }
 *   { "op": "gate", "model": "claude-opus-5-5", "effort": "low",
 *     "image": { ... the photo ... },
 *     "candidates": [{ "image": "https://...", "title": "...", "source": "...", "link": "https://..." }, ...],
 *     "read": { "brand": "...", "productName": "..." } }
 *   (a candidate may also be a bare image URL; "read" is what the scan's
 *   first read saw, and with it the verdicts come back after the match
 *   guards exactly as a scan would act on them: see match-guards.ts)
 *
 * The production evaluation (scripts/production-eval.mjs) runs a labelled
 * scan, takes the candidates the real gate saw from its trace, and replays
 * them here on each model, so every model judges the same candidates and no
 * search is repeated.
 *
 * Only models in the rules table can be named. It refuses while the engine is
 * degraded (that day's budget belongs to visitors) and past
 * EVAL_DAILY_REPLAYS calls a day, and every call is logged. See eval-log.ts.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IMAGE_BASE64 = 5_500_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(req: NextRequest) {
  if (!isOperator(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest("body must be JSON");
  }
  const op = body.op;
  const model = typeof body.model === "string" ? body.model : "";
  const effort = body.effort === undefined || body.effort === null ? null : parseEffort(body.effort);
  const image = body.image as { data?: unknown; mimeType?: unknown } | undefined;
  if (op !== "extract" && op !== "gate") return badRequest('op must be "extract" or "gate"');
  if (!rulesFor(model)) return badRequest("model is not in the rules table");
  if (body.effort !== undefined && body.effort !== null && !effort) return badRequest("unknown effort");
  if (!image || typeof image.data !== "string" || !image.data || image.data.length > MAX_IMAGE_BASE64) {
    return badRequest("image.data must be base64, at most about 4MB");
  }
  const mimeType = typeof image.mimeType === "string" && IMAGE_TYPES.has(image.mimeType) ? image.mimeType : "";
  if (!mimeType) return badRequest("image.mimeType must be a jpeg, png, webp or gif type");
  let candidates: { imageUrl: string; title?: string; source?: string; link?: string }[] = [];
  let read: { brand: string; productName: string } | undefined;
  if (op === "gate") {
    const raw = Array.isArray(body.candidates) ? body.candidates : [];
    candidates = raw.slice(0, 8).map((c: unknown) => {
      if (typeof c === "string") return { imageUrl: c };
      const o = (c || {}) as { image?: unknown; title?: unknown; source?: unknown; link?: unknown };
      return {
        imageUrl: typeof o.image === "string" ? o.image : "",
        title: typeof o.title === "string" ? o.title.slice(0, 200) : undefined,
        source: typeof o.source === "string" ? o.source.slice(0, 80) : undefined,
        link: typeof o.link === "string" ? o.link.slice(0, 300) : undefined,
      };
    });
    const r = body.read as { brand?: unknown; productName?: unknown } | undefined;
    if (r && typeof r === "object") {
      read = {
        brand: typeof r.brand === "string" ? r.brand.slice(0, 80) : "",
        productName: typeof r.productName === "string" ? r.productName.slice(0, 200) : "",
      };
    }
    if (candidates.length === 0) return badRequest("candidates must list one to eight image URLs");
    for (const { imageUrl } of candidates) {
      let parsed: URL;
      try { parsed = new URL(imageUrl); } catch { return badRequest("a candidate is not a URL"); }
      if (parsed.protocol !== "https:" || isPrivateHostname(parsed.hostname)) return badRequest("candidates must be public https URLs");
    }
  }

  if ((await currentSpendMode()) === "degraded") {
    return NextResponse.json({ error: "degraded", detail: "the engine is degraded; replays wait until it is not" }, { status: 409 });
  }
  if (!(await replayAllowed())) {
    return NextResponse.json({ error: "replay_limit", detail: "the daily replay limit is reached" }, { status: 429 });
  }

  const started = Date.now();
  const photo = { data: image.data, mimeType };
  const result = op === "extract"
    ? await replayExtraction(photo, model, effort)
    : await replayGate(photo, candidates, model, effort, read);
  await logEvaluationUse("replay", {
    op, model, effort, ok: result.ok, kind: result.kind, ms: Date.now() - started,
    claudeUsd: result.call?.costUsd ?? 0, candidates: candidates.length || undefined,
  });
  return NextResponse.json({ op, model, effort, ms: Date.now() - started, ...result }, { headers: { "Cache-Control": "no-store" } });
}
