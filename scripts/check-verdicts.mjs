/**
 * Calibration guard for the verdict classifier.
 *
 * Runs the REAL calculateVerdict from src/lib/verdict.ts against the products
 * the thresholds were calibrated on. The landing page publishes these rules to
 * visitors, so a silent change to them is a credibility problem, not just a
 * behaviour change.
 *
 *   node --experimental-strip-types scripts/check-verdicts.mjs
 */
import { calculateVerdict } from "../src/lib/verdict.ts";

const CASES = [
  // [name, retail, source, expected verdict, why this case exists]
  ["massage gun",        99.00, 58.60, "HIGH_MARKUP", "69% markup, $40.40 gap. Dollar rule."],
  ["whitening strips",   22.99,  4.30, "HIGH_MARKUP", "435% markup, $18.69 gap. Percentage rule."],
  ["face roller",        74.99,  2.90, "HIGH_MARKUP", "Both rules, comfortably."],
  ["high-ticket item", 10000.00, 9523.81, "OVERPRICED", "5% margin. Big dollars, ordinary pricing."],
  ["cheap gadget",       12.00,  3.00, "OVERPRICED",  "300% markup but only a $9 gap."],
  ["thin margin",        30.00, 22.00, "FAIR",        "36% markup, $8 gap. Both small."],
  ["low margin, mid price", 60.00, 52.00, "FAIR",     "15% markup, $8 gap."],
  ["just under BUSTED",  40.00, 25.00, "OVERPRICED",  "60% markup, $15 gap. Clears neither rule."],
  ["exactly at the line", 50.00, 25.00, "HIGH_MARKUP", "100% markup, $25 gap. Boundary is inclusive."],
];

let failures = 0;
for (const [name, retail, source, expected, why] of CASES) {
  const got = calculateVerdict(retail, source);
  const ok = got.verdict === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(22)} ` +
    `${String(got.markup).padStart(5)}%  $${got.savings.toFixed(2).padStart(8)}  ` +
    `-> ${got.verdict.padEnd(11)} ${ok ? "" : `(expected ${expected})`}  ${why}`
  );
}

if (failures > 0) {
  console.error(`\n${failures} calibration case(s) failed. The published thresholds on the landing page no longer match the engine.`);
  process.exit(1);
}
console.log("\nAll calibration cases match the published thresholds.");
