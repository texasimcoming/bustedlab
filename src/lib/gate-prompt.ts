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
  match: "exact" | "likely" | "similar" | "different";
  reasoning: string;
  /**
   * What ties the candidate to IMAGE A: "logo", "text", "part", "photo" or
   * "none". Anything missing or unrecognised reads as "none", and an "exact"
   * or "likely" with no tie is held to "similar" by match-guards.ts.
   */
  tie: string;
}

/**
 * FOUR ANSWERS, NOT THREE.
 *
 * The scale used to be exact / similar / different, with "similar" defined
 * as "same category, or same brand, but you cannot confirm it is the
 * identical model", and the engine reported every "similar" as a LIKELY
 * match: the "VISUAL MATCH" plate, eligible for a markup verdict. So a
 * different raku pitcher, or a TOLOCO massage gun for a Flowlife one, could
 * be shown as a likely match, which the production evaluation caught on a
 * handmade pitcher that exists nowhere online. "Probably this very product"
 * and "the same kind of thing" are different judgements and now get
 * different answers: "likely" is the first, "similar" the second, and only
 * "exact" and "likely" can ever identify a product.
 *
 * Each candidate also carries its listing title and seller where the search
 * gave one. The photo decides; the text can only rule a candidate out (it
 * names another model, size or quantity, or the page is not selling
 * anything) or back up what the images already show. Without it, the gate
 * had no way to tell a news article that reused the photo from a listing,
 * and called the article "exact" because it was literally the same picture.
 *
 * A NAMED TIE. Every answer also names what ties the listing to the photo:
 * a logo, printed text, a distinctive part, or the identical photograph.
 * The production evaluation's wrong matches were all argued from shape and
 * colour ("same black body, round head and side control panel" for a Cult
 * Flex gun shown a Flowlife one), so a match now has to point at something
 * a different model of the same kind would not share. The prompt asks for
 * it; match-guards.ts enforces it in code, whatever the answer says.
 */
export function buildBatchPrompt(count: number): string {
  return `You are shown IMAGE A (one photo) and ${count} candidate product listing image${count === 1 ? "" : "s"}, numbered 1 to ${count}. Each candidate may come with its listing title and the site it is on.

For EACH candidate, decide whether it is the exact same physical product as IMAGE A — same model, same design, same distinguishing features — or merely a similar item of the same kind.

Judge the product only. IMAGE A is usually a photo or a screenshot, so ignore background, cropping, lighting, viewing angle, scale, watermarks, captions, on-screen text and app interface elements. A candidate is usually a catalogue photo of the same class of object on a plain background.

Weigh these in order, for every candidate:
1. Brand markings. If IMAGE A and a candidate both show a logo, wordmark or label and they belong to DIFFERENT brands, that candidate is "different" no matter how alike the shapes are.
2. Model-defining structure: silhouette, proportions, panel and seam layout, hardware, closures, frame and lens shape, control layout, and the number and placement of parts.
3. Colourway and finish.
4. The listing title and site, as supporting evidence only. A title can rule a candidate out: it names a different model, generation, size, capacity, quantity or variant from the one IMAGE A shows. A title can back up what the images already show. A title never makes a candidate a match on its own.

A candidate that is not a product offered for sale is "different", even when it shows the very same picture as IMAGE A: a news or magazine article, an encyclopedia or wiki page, a social media post, a forum thread, a blog post, a review, a stock photo, a 3D model or an illustration.

Judge each candidate INDEPENDENTLY, in absolute terms, not against the other candidates. Do not rank them, and do not assume one of them must be the match: it is normal and expected for every candidate to be "different", and being the closest of the ones shown is never a reason to call something "exact" or "likely".

Return ONLY a JSON array, one entry per candidate, in order:
[{"candidate": 1, "match": "exact" | "likely" | "similar" | "different", "tie": "logo" | "text" | "part" | "photo" | "none", "why": "a few words naming the feature that decided it"}]
"exact" = the same specific product: the same model in the same colourway, high confidence, and nothing in its title contradicts it.
"likely" = the same model as far as the images show, but one thing cannot be confirmed: a detail is hidden or too small to see, or the colourway differs, or the title neither confirms nor contradicts it. Nothing visible or written says it is a different model.
"similar" = a lookalike: the same kind of product, or the same brand, but a different model or one you cannot tie to IMAGE A.
"different" = clearly not the same product, or not a product offered for sale.
"tie" = the one thing, visible in BOTH images, that ties this listing to the product in IMAGE A rather than to any other model of its kind:
  "logo" = the same logo, wordmark or brand marking;
  "text" = the same printed text, label, pattern or model number;
  "part" = a distinctive part this model has and other models of its kind do not;
  "photo" = the identical product photograph;
  "none" = nothing more specific than colour, overall shape, size, material or the parts every product of this kind has (a handle, a head, a lid, a strap, a button, a panel).
"exact" and "likely" need a tie. With "none", the answer is "similar" or "different".
Be strict. Default to "similar" or "different" when uncertain. Never guess "exact" or "likely".`;
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
  const entry = raw as { match?: unknown; why?: unknown; reasoning?: unknown; tie?: unknown } | null;
  const match = entry?.match;
  if (match !== "exact" && match !== "likely" && match !== "similar" && match !== "different") return null;
  const why = typeof entry?.why === "string" ? entry.why
    : typeof entry?.reasoning === "string" ? entry.reasoning
    : "";
  const tie = typeof entry?.tie === "string" ? entry.tie.trim().toLowerCase() : "none";
  return { match, reasoning: why, tie };
}
