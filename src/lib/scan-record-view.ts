import type { ScanRecord } from "@/lib/redis";
import type { VerdictData } from "@/components/VerdictCard";

/**
 * One ledger record, rendered as the same card the scanner produces.
 *
 * A permanent page has to show exactly what the person saw at the moment of
 * the scan, and the card is the canonical rendering of a verdict, so the
 * record is mapped back into its shape rather than given a second, divergent
 * presentation that would eventually disagree with it.
 */
export function recordToVerdictData(record: ScanRecord): VerdictData {
  return {
    verdict: record.verdict,
    mode: "VERDICT",
    matchConfidence: record.matchConfidence,
    retailPrice: record.retailPrice,
    wholesalePrice: record.wholesalePrice,
    markup: record.markup,
    savings: record.savings,
    productTitle: record.title,
    productImageUrl: record.imageUrl || undefined,
    productUrl: record.sourceUrl || undefined,
    platform: record.platform || undefined,
    confidence: record.confidence,
    scanId: `SCAN #${record.id.slice(0, 10).toUpperCase()}`,
    // The card is stamped with when the measurement happened, not when the
    // page was opened.
    recordedAt: record.ts,
    isDemo: false,
  };
}

export const VERDICT_LABEL: Record<ScanRecord["verdict"], string> = {
  HIGH_MARKUP: "BUSTED",
  OVERPRICED: "OVERPRICED",
  FAIR: "FAIR PRICE",
};

export const VERDICT_COLOR: Record<ScanRecord["verdict"], string> = {
  HIGH_MARKUP: "#ef4444",
  OVERPRICED: "#f59e0b",
  FAIR: "#10d9a0",
};

/**
 * The share caption and the page title both lead with the dollar gap, because
 * that is the number a person feels. The percentage qualifies it.
 */
export function recordHeadline(record: ScanRecord): string {
  if (record.verdict === "FAIR") {
    return `${record.title}: priced fairly, $${record.savings.toFixed(2)} off market`;
  }
  return `${record.title}: $${record.savings.toFixed(2)} above market, ${record.markup}% markup`;
}
