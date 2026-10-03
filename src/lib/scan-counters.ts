import type { ScanResult } from "@/lib/scan";
import {
  incrementScanCount,
  incrementPaidScanCount,
  incrementGlobalScans,
  incrementTotalScans,
  incrementHourlyScans,
  incrementTotalSavings,
  recordMarkup,
  recordVerdict,
  setCachedScan,
} from "@/lib/redis";
import { recordEvents, type EventName } from "@/lib/analytics";

/**
 * Everything a finished scan counts, run by the scan route in after(), once
 * the response has gone: none of it changes what the person sees, and six
 * sequential Redis round trips used to sit between the finished scan and
 * the render. A function of its own so scripts/check-eval.mjs can run it
 * outside Next, where after() cannot.
 *
 * An evaluation scan (THE OPERATOR EVALUATION PATH in the scan route)
 * counts against the global daily cap on uncached free scans, because it
 * spent the same money, and nothing else: not the free allowance, not the
 * lifetime or hourly counter, not the verdict stats, not the result cache a
 * visitor could be served, not the funnel in /api/stats.
 */
export async function countCompletedScan(scan: {
  result: ScanResult;
  evaluation: boolean;
  isPaid: boolean;
  email: string | null;
  ip: string;
  browserId: string | null;
  servedFromCache: boolean;
  cacheKey: string | null;
}): Promise<void> {
  const { result, evaluation, isPaid, email, ip, browserId, servedFromCache, cacheKey } = scan;

  if (evaluation) {
    if (!servedFromCache && !isPaid) await incrementGlobalScans().catch(() => {});
    return;
  }

  // A cache hit still consumes a free scan: otherwise the same product
  // could be rescanned forever for free.
  if (!isPaid) {
    await incrementScanCount(ip).catch(() => {});
    if (browserId) await incrementScanCount(`browser:${browserId}`).catch(() => {});
    if (!servedFromCache) await incrementGlobalScans().catch(() => {});
  } else if (email) {
    // Every scan counts against fair use, including cache hits. A
    // ceiling that counts some scans and not others is one nobody can
    // reason about - "I ran 600 but only 300 counted" is a support
    // conversation with no good ending - and at 500 a day the
    // distinction cannot matter to a real customer either way.
    await incrementPaidScanCount(email).catch(() => {});
  }
  await incrementTotalScans().catch(() => {});
  await incrementHourlyScans().catch(() => {});

  // Only a genuine, visually verified VERDICT carries a real dollar
  // amount worth accumulating. Cache hits are excluded so one viral
  // product cannot inflate the lifetime totals by the number of people
  // who looked at it.
  if (!servedFromCache && result.mode === "VERDICT") {
    await recordVerdict(result.analysis.verdict === "HIGH_MARKUP").catch(() => {});
    if (result.analysis.savings > 0) await incrementTotalSavings(result.analysis.savings).catch(() => {});
    if (result.analysis.markup > 0) await recordMarkup(result.analysis.markup).catch(() => {});
  }

  // ── Cache write. Only real, verified results are worth keeping:
  //    caching an UNRESOLVED would pin a failure in place for 24 hours,
  //    including for the retry the person is about to make. ──
  if (cacheKey && !servedFromCache && result.found && result.mode === "VERDICT") {
    const { shippingNote, ...cacheable } = result;
    void shippingNote;
    await setCachedScan(cacheKey, cacheable).catch(() => {});
  }

  // ── Analytics. Counted here rather than from the browser because this
  //    is the moment the scan actually finished, which makes these two
  //    numbers unforgeable. Every completed scan counts, including cache
  //    hits and failures: "how many scans happened" is a different
  //    question from "how many produced a verdict", and conflating them
  //    hides exactly the failure rate worth watching. ──
  const events: EventName[] = ["scan_completed"];
  if (result.mode === "VERDICT") {
    if (result.analysis.verdict === "HIGH_MARKUP") events.push("verdict_busted");
    else if (result.analysis.verdict === "OVERPRICED") events.push("verdict_overpriced");
    else if (result.analysis.verdict === "FAIR") events.push("verdict_fair");
  } else if (result.mode === "FINDER") {
    events.push("result_finder");
  } else {
    events.push("result_unresolved");
  }
  await recordEvents(events);
}
