/**
 * THE GATE'S PROMPT AND ANSWER FORMAT.
 *
 * This lives in its own module with zero imports for the same reason
 * verdict.ts does: so a measurement script can exercise the REAL prompt
 * rather than a copy of it that drifts. scripts/eval-gate.mjs imports these
 * to score one model's identification judgement against another's on real
 * photographs, which is the only way to answer "would a cheaper model have
 * got this right" with a number instead of an opinion.
 *
 * If you change the prompt, you change what that measurement measures. That
 * is the intent - the measurement should follow the shipped prompt - but it
 * does mean an old result set is not comparable with a new one.
 */

export interface GateVerdict {
  match: "exact" | "similar" | "different";
  reasoning: string;
}

export function buildBatchPrompt(count: number): string {
  return `You are shown IMAGE A (one photo) and ${count} candidate product listing image${count === 1 ? "" : "s"}, numbered 1 to ${count}.

For EACH candidate, decide whether it is the exact same physical product as IMAGE A — same model, same design, same distinguishing features — or merely a similar item of the same kind.

Judge the product only. IMAGE A is usually a photo or a screenshot, so ignore background, cropping, lighting, viewing angle, scale, watermarks, captions, on-screen text and app interface elements. A candidate is usually a catalogue photo of the same class of object on a plain background.

Weigh these in order, for every candidate:
1. Brand markings. If IMAGE A and a candidate both show a logo, wordmark or label and they belong to DIFFERENT brands, that candidate is "different" no matter how alike the shapes are.
2. Model-defining structure: silhouette, proportions, panel and seam layout, hardware, closures, frame and lens shape, control layout, and the number and placement of parts.
3. Colourway and finish. A different colour of the same model is "similar", not "exact".

Judge each candidate INDEPENDENTLY, in absolute terms, not against the other candidates. Do not rank them, and do not assume one of them must be the match: it is normal and expected for every candidate to be "different", and being the closest of the ones shown is never a reason to call something "exact".

Return ONLY a JSON array, one entry per candidate, in order:
[{"candidate": 1, "match": "exact" | "similar" | "different", "why": "a few words naming the feature that decided it"}]
"exact" = the same specific product and the same model, high confidence.
"similar" = same category, or same brand, but you cannot confirm it is the identical model.
"different" = clearly not the same product.
Be strict. Default to "similar" or "different" when uncertain. Never guess "exact".`;
}

/**
 * The fragility batching introduced, and the fix for it.
 *
 * With one call per candidate, a truncated or malformed answer cost one
 * candidate. With one call per wave, the same truncation costs SIX - the
 * whole wave comes back unjudged, the scan reports nothing verified, and a
 * correct identification is lost to a formatting accident rather than to a
 * judgement. That is not an acceptable way to lose a match.
 *
 * Three things guard it. max_tokens is set generously (a ceiling costs
 * nothing unless it is reached, and output is billed on what is actually
 * generated). This function salvages individual verdict objects when the
 * whole-array parse fails, so a wave truncated at candidate five still
 * yields four judgements. And a call that produces no usable verdict at all
 * is reported as such rather than as six "different" answers, so the caller
 * can retry it instead of silently believing it.
 */
export function salvageVerdictObjects(text: string): unknown[] {
  const out: unknown[] = [];
  for (const chunk of text.match(/\{[^{}]*\}/g) || []) {
    try {
      out.push(JSON.parse(chunk));
    } catch {
      /* a half-written object at the truncation point is simply skipped */
    }
  }
  return out;
}

export function coerceVerdict(raw: unknown): GateVerdict | null {
  const entry = raw as { match?: unknown; why?: unknown; reasoning?: unknown } | null;
  const match = entry?.match;
  if (match !== "exact" && match !== "similar" && match !== "different") return null;
  const why = typeof entry?.why === "string" ? entry.why
    : typeof entry?.reasoning === "string" ? entry.reasoning
    : "";
  return { match, reasoning: why };
}
