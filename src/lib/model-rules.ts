/**
 * CLAUDE REQUEST RULES, ONE TABLE.
 *
 * Every request the engine sends to the Claude API is built here, and every
 * reply is read here. Both used to be done inline in scan.ts, with
 * `temperature: 0` added to every call and the reply read as content[0].text.
 * Opus 5 answers any non-default sampling parameter with HTTP 400, and it
 * thinks by default, so its first block can be a thinking block with no text.
 * The verification gate and the extraction escalation both run on Opus 5, so
 * for as long as that shipped, neither of them ever produced an answer, and
 * both failures were indistinguishable from "nothing verified".
 *
 * The table below is the per-model request surface, from Anthropic's docs as
 * of 2026-10-01 (thinking-troubleshooting: the per-model thinking table;
 * effort: supported models and the disabled-thinking effort cap; the Opus
 * 4.7, Opus 5, Sonnet 5, Opus 5.5, Sonnet 5.5 and Fable 5.1 migration
 * guides). scripts/check-model-contract.mjs holds an independent copy of the
 * documented rules and fails the build if a body built here breaks them.
 *
 * Zero imports, so the contract check and the diagnose route can exercise the
 * real builder rather than a copy.
 */

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

interface ModelRule {
  /** Sent only where the API accepts it. */
  temperature?: number;
  /** Omitted when undefined: the model's own default applies. */
  thinking?: { type: "disabled" } | { type: "between_tools" };
  effort?: Effort;
  /**
   * Extra output room for models whose thinking cannot be turned off.
   * max_tokens caps thinking plus text, so a ceiling sized for a short JSON
   * answer would cut the answer off.
   */
  thinkingHeadroom?: number;
  /** A system instruction specific to how this model is run. */
  systemNote?: string;
}

// Opus 5 with thinking disabled can write internal XML tags into its visible
// text. Anthropic's documented mitigation is this sentence, in this generic
// form: naming the tags is less effective, and telling the model not to think
// makes the leak more likely. readClaudeJson also strips tags if one leaks.
const NO_INTERNAL_TAGS = "Do not include internal or system XML tags in your response.";
const ALWAYS_THINKING_HEADROOM = 8000;

/**
 * Keys are model ids without a date suffix.
 *
 * - Haiku 4.5: sampling accepted, so temperature stays at 0. Thinking is off
 *   unless enabled. Effort is not supported on it (absent from the effort
 *   docs' supported models), so it is never sent.
 * - Opus 5 and Sonnet 5: sampling parameters rejected. Thinking runs by
 *   default, so it is turned off explicitly: the cost model prices these
 *   calls with no thinking tokens, and the gate's answer is a short JSON
 *   array that does not need it. Opus 5 only accepts disabled thinking at
 *   effort high or below, so effort is pinned to high (the default) rather
 *   than left to a default that could move.
 * - Opus 5.5 and Fable 5 / 5.1: thinking cannot be turned off (disabled is a
 *   400 at every effort level), so effort goes to low, the documented lever
 *   for keeping thinking short, and max_tokens gets room for it.
 * - Sonnet 5.5: disabled is a 400; between_tools is its lowest setting, valid
 *   at effort high or below.
 * - Opus 4.7 / 4.8: sampling rejected; thinking is off when omitted.
 * - Any model not listed: no sampling, thinking or effort fields at all. A
 *   guess about an unknown model's request surface is how the original 400
 *   happened.
 */
export const MODEL_RULES: Record<string, ModelRule> = {
  "claude-haiku-4-5": { temperature: 0 },
  "claude-opus-4-7": {},
  "claude-opus-4-8": {},
  "claude-opus-5": { thinking: { type: "disabled" }, effort: "high", systemNote: NO_INTERNAL_TAGS },
  "claude-sonnet-5": { thinking: { type: "disabled" }, effort: "high", systemNote: NO_INTERNAL_TAGS },
  "claude-opus-5-5": { effort: "low", thinkingHeadroom: ALWAYS_THINKING_HEADROOM },
  "claude-sonnet-5-5": { thinking: { type: "between_tools" }, effort: "high", systemNote: NO_INTERNAL_TAGS },
  "claude-fable-5": { effort: "low", thinkingHeadroom: ALWAYS_THINKING_HEADROOM },
  "claude-fable-5-1": { effort: "low", thinkingHeadroom: ALWAYS_THINKING_HEADROOM },
};

/** "claude-haiku-4-5-20251001" -> "claude-haiku-4-5". */
export function canonicalModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

export function rulesFor(model: string): ModelRule | null {
  return MODEL_RULES[canonicalModel(model)] ?? null;
}

/**
 * The request body for one call. Callers pass what is specific to the call
 * (max_tokens, messages); everything model-specific comes from the table, and
 * a caller cannot add a sampling or thinking field the table did not choose.
 */
export function buildClaudeRequest(model: string, payload: Record<string, unknown>): Record<string, unknown> {
  const { temperature, top_p, top_k, thinking, output_config, ...rest } = payload;
  void temperature; void top_p; void top_k; void thinking;
  const rule = rulesFor(model);
  const body: Record<string, unknown> = { model, ...rest };
  const otherOutputConfig = { ...((output_config as Record<string, unknown> | undefined) || {}) };
  delete otherOutputConfig.effort;
  if (Object.keys(otherOutputConfig).length) body.output_config = otherOutputConfig;
  if (!rule) return body;

  if (rule.temperature !== undefined) body.temperature = rule.temperature;
  if (rule.thinking) body.thinking = { ...rule.thinking };
  if (rule.effort) body.output_config = { ...otherOutputConfig, effort: rule.effort };
  if (rule.thinkingHeadroom) body.max_tokens = Number(rest.max_tokens || 0) + rule.thinkingHeadroom;
  if (rule.systemNote) {
    body.system = typeof rest.system === "string" && rest.system ? `${rest.system}\n\n${rule.systemNote}` : rule.systemNote;
  }
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
 * JSON out of a reply's text. Tolerates a code fence, and an internal XML
 * block leaked ahead of the answer (the documented artifact of running Opus 5
 * with thinking disabled), by falling back to the outermost JSON value.
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
