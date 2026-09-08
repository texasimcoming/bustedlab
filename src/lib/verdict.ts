/**
 * Verdict classification. The only place these numbers exist.
 *
 * This lives in its own module with zero imports for two reasons. First, the
 * landing page publishes these thresholds to visitors, and published rules
 * that drift from the code that runs them would be worse than not publishing
 * them at all: the page and the engine now read the same constants. Second, a
 * pure module with no dependencies can be executed directly by the calibration
 * check in scripts/check-verdicts.mjs, so the classification cannot be changed
 * without something failing loudly.
 *
 * Two layers, because percentage alone is misleading in both directions. A
 * 300% markup on a $2 item is noise. A 60% markup on a $300 item is real
 * money. The dollar figure leads, since it is what a person actually feels,
 * and the percentage qualifies it.
 */

export type Verdict = "HIGH_MARKUP" | "OVERPRICED" | "FAIR";

export const THRESHOLDS = {
  /** Dollar gap that, paired with MIN_MARKUP_FOR_DOLLAR_RULE, means BUSTED. */
  BUSTED_SAVINGS: 25,
  /**
   * Load-bearing floor. Without it, a $10,000 item carrying an ordinary 5%
   * margin clears $25 of gap on price tag alone and reads as BUSTED, which is
   * simply wrong. 50% is the same boundary FAIR uses to define a normal
   * retail margin.
   */
  MIN_MARKUP_FOR_DOLLAR_RULE: 50,
  /** Percentage that, paired with BUSTED_MARKUP_SAVINGS, means BUSTED. */
  BUSTED_MARKUP: 200,
  BUSTED_MARKUP_SAVINGS: 10,
  /** Both must be under these for a price to be called genuinely fair. */
  FAIR_MARKUP: 50,
  FAIR_SAVINGS: 10,
} as const;

export interface VerdictResult {
  markup: number;
  savings: number;
  savingsPercent: number;
  verdict: Verdict;
}

export function calculateVerdict(retail: number, wholesale: number): VerdictResult {
  const markup = Math.round(((retail - wholesale) / wholesale) * 100);
  const savings = parseFloat((retail - wholesale).toFixed(2));
  const savingsPercent = Math.round((savings / retail) * 100);

  let verdict: Verdict;
  if (
    (savings >= THRESHOLDS.BUSTED_SAVINGS && markup >= THRESHOLDS.MIN_MARKUP_FOR_DOLLAR_RULE) ||
    (markup >= THRESHOLDS.BUSTED_MARKUP && savings >= THRESHOLDS.BUSTED_MARKUP_SAVINGS)
  ) {
    verdict = "HIGH_MARKUP";
  } else if (markup < THRESHOLDS.FAIR_MARKUP && savings < THRESHOLDS.FAIR_SAVINGS) {
    verdict = "FAIR";
  } else {
    verdict = "OVERPRICED";
  }

  return { markup, savings, savingsPercent, verdict };
}

/**
 * The published rulebook, rendered on the landing page. Generated from the
 * constants above so the page can never state a threshold the engine does not
 * apply.
 */
export const CLASSIFICATION_RULES = [
  {
    label: "BUSTED",
    tone: "red" as const,
    rule:
      `Gap of $${THRESHOLDS.BUSTED_SAVINGS} or more at ${THRESHOLDS.MIN_MARKUP_FOR_DOLLAR_RULE}%+ over market, ` +
      `or ${THRESHOLDS.BUSTED_MARKUP}%+ over market with a gap of $${THRESHOLDS.BUSTED_MARKUP_SAVINGS} or more.`,
  },
  {
    label: "OVERPRICED",
    tone: "yellow" as const,
    rule: "Priced above market, short of both BUSTED thresholds. Real gap, ordinary scale.",
  },
  {
    label: "FAIR PRICE",
    tone: "green" as const,
    rule:
      `Under ${THRESHOLDS.FAIR_MARKUP}% over market and under $${THRESHOLDS.FAIR_SAVINGS} of gap. ` +
      "Both small. Genuinely fair.",
  },
  {
    label: "NO CONFIRMED MATCH",
    tone: "muted" as const,
    rule: "Nothing verified. No number is shown, because no number was earned.",
  },
];
