/**
 * CLAUDE REQUEST RULES, ONE TABLE.
 *
 * Every request the engine sends to the Claude API is built here, and every
 * reply is read here. Both used to be done inline in scan.ts, with
 * `temperature: 0` added to every call and the reply read as content[0].text,
 * which is how a 400 on every gate call shipped and read as "nothing
 * verified".
 *
 * The product runs on exactly two models: Claude Opus 5.5 and Claude Sonnet
 * 5.5. Their request surface, from Anthropic's migration guides and the
 * effort and thinking docs as of 2026-10-01:
 *
 *   - Sampling: temperature, top_p and top_k at any non-default value are a
 *     400. They are never sent.
 *   - Thinking: adaptive thinking runs on every request. Opus 5.5 rejects
 *     thinking "disabled" and manual budgets with a 400; Sonnet 5.5 rejects
 *     "disabled" too. Omitting the field is the same as {type: "adaptive"},
 *     so the field is never sent. (Sonnet 5.5 also accepts "between_tools",
 *     its no-up-front-thinking setting; it is not used, by the owner's
 *     decision that thinking stays on.)
 *   - Effort: the only control over how much the model thinks. Opus 5.5
 *     defaults to medium, Sonnet 5.5 to high with recalibrated levels; both
 *     are set to low here, the lowest level, and the gate's level can be
 *     raised with GATE_EFFORT once an eval shows it is needed.
 *   - max_tokens is a hard cap on thinking PLUS the answer. So every request
 *     gets the answer's own budget plus THINKING_HEADROOM tokens on top, up to
 *     MAX_TOKENS_CEILING: thinking would have to run past 15,000 tokens at low
 *     effort to touch the JSON answer, and if it ever did, the reply stops
 *     with stop_reason max_tokens, which the engine treats as a failed call
 *     and hands to the next model rather than reading a cut-off answer.
 *     The ceiling stays at 16,000 because Anthropic's guidance is to stream
 *     anything above about 16K output, and these calls are not streamed.
 *   - Replies can open with thinking blocks (empty text under the default
 *     display), so replies are read by block type.
 *   - No assistant prefill (a 400), no forced tool use (not used).
 *
 * Any model not in the table gets no sampling, thinking or effort fields at
 * all, which is a valid request on every current model. scripts/
 * check-model-contract.mjs holds an independent copy of the documented rules
 * and fails the build if a body built here breaks them.
 *
 * Zero imports, so the contract check, eval-gate and the diagnose route
 * exercise the real builder rather than a copy.
 */

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

interface ModelRule {
  /** Default effort for this model. */
  effort: Effort;
  /** Effort levels the model accepts. */
  efforts: readonly Effort[];
}

/** Thinking room added on top of every call's own answer budget. */
export const THINKING_HEADROOM = 15_000;
/** Upper bound on max_tokens for a non-streamed call. */
export const MAX_TOKENS_CEILING = 16_000;

/** Keys are model ids without a date suffix. */
export const MODEL_RULES: Record<string, ModelRule> = {
  "claude-opus-5-5": { effort: "low", efforts: EFFORTS },
  "claude-sonnet-5-5": { effort: "low", efforts: EFFORTS },
};

/** "claude-sonnet-5-5-20261001" -> "claude-sonnet-5-5". Current ids carry no date. */
export function canonicalModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

export function rulesFor(model: string): ModelRule | null {
  return MODEL_RULES[canonicalModel(model)] ?? null;
}

export function parseEffort(value: unknown): Effort | null {
  return typeof value === "string" && (EFFORTS as readonly string[]).includes(value) ? (value as Effort) : null;
}

/**
 * The request body for one call. Callers pass what is specific to the call:
 * messages and `max_tokens` as the budget for the ANSWER alone; thinking
 * room is added here. Everything model-specific comes from the table, and a
 * caller cannot add a sampling or thinking field the table did not choose.
 * `effort` overrides the model's default when the model accepts that level.
 */
export function buildClaudeRequest(
  model: string,
  payload: Record<string, unknown>,
  options: { effort?: Effort | null } = {}
): Record<string, unknown> {
  const { temperature, top_p, top_k, thinking, output_config, ...rest } = payload;
  void temperature; void top_p; void top_k; void thinking;
  const rule = rulesFor(model);
  const body: Record<string, unknown> = { model, ...rest };
  const otherOutputConfig = { ...((output_config as Record<string, unknown> | undefined) || {}) };
  delete otherOutputConfig.effort;
  if (Object.keys(otherOutputConfig).length) body.output_config = otherOutputConfig;
  if (!rule) return body;

  const effort = options.effort && rule.efforts.includes(options.effort) ? options.effort : rule.effort;
  body.output_config = { ...otherOutputConfig, effort };
  body.max_tokens = Math.min(Number(rest.max_tokens || 0) + THINKING_HEADROOM, MAX_TOKENS_CEILING);
  return body;
}

export interface ClaudeReply {
  /** The first text block's text, or null when there is none. */
  text: string | null;
  stopReason: string | null;
  /** The refusal category when the model declined, otherwise null. */
  refusal: string | null;
  /** Stopped at max_tokens: the text, if any, is cut off. */
  truncated: boolean;
}

/**
 * Reads a Messages API reply by block type, never by position: a reply can
 * open with one or more thinking blocks whose text is empty, and the answer
 * is the first block of type "text". A refusal is a successful HTTP 200 with
 * stop_reason "refusal" and no usable content; it is reported as such so the
 * caller can try another model rather than read it as an empty answer.
 */
export function readClaudeReply(data: unknown): ClaudeReply {
  const reply = (data || {}) as { content?: unknown; stop_reason?: unknown; stop_details?: unknown };
  const stopReason = typeof reply.stop_reason === "string" ? reply.stop_reason : null;
  if (stopReason === "refusal") {
    const category = (reply.stop_details as { category?: unknown } | undefined)?.category;
    return { text: null, stopReason, refusal: typeof category === "string" ? category : "unspecified", truncated: false };
  }
  const blocks = Array.isArray(reply.content) ? (reply.content as { type?: unknown; text?: unknown }[]) : [];
  const block = blocks.find(b => b?.type === "text" && typeof b.text === "string");
  const text = typeof block?.text === "string" && block.text.trim() ? block.text : null;
  return { text, stopReason, refusal: null, truncated: stopReason === "max_tokens" };
}

/**
 * JSON out of a reply's text. Tolerates a code fence, prose around the
 * answer, and an internal XML block leaked ahead of it, by falling back to
 * the outermost JSON value.
 */
export function parseReplyJson(text: string | null): unknown {
  if (!text) return null;
  const unfenced = text.replace(/```(?:json)?/gi, "").trim();
  const attempts = [unfenced, unfenced.replace(/<([a-z_][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, "").trim()];
  const start = unfenced.search(/[[{]/);
  if (start >= 0) {
    const close = unfenced[start] === "[" ? "]" : "}";
    const end = unfenced.lastIndexOf(close);
    if (end > start) attempts.push(unfenced.slice(start, end + 1));
  }
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      /* next attempt */
    }
  }
  return null;
}
