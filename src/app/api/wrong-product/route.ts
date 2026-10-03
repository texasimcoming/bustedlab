import { NextRequest, NextResponse } from "next/server";
import { recordWrongProduct, REPORT_MODES, REPORT_CONFIDENCES, type WrongProductReport } from "@/lib/analytics";
import { countInWindow } from "@/lib/redis";

/**
 * "WRONG PRODUCT? TELL US", the link under every result. One tap records that
 * the product shown is not the one in the photo, against the scan it was
 * shown for: the scan's id, the result's mode and match confidence, and the
 * time. These are free ground-truth labels for the identification engine,
 * counted in /api/stats.
 *
 * Public, so built like the event beacon: only the three fields are read and
 * each must have the expected shape, the first report for a scan id is the
 * only one that counts, and it is rate limited per browser and per address
 * (hashed, as every limit here is). It answers 204 whatever happened, so it
 * teaches a script nothing.
 */
const PER_BROWSER_PER_HOUR = 10;
const PER_ADDRESS_PER_HOUR = 60;
const SCAN_ID = /^[a-z0-9]{8,48}$/;

const noContent = () => new NextResponse(null, { status: 204 });

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const report = {
      scanId: typeof body.scanId === "string" ? body.scanId : "",
      mode: body.mode,
      confidence: body.confidence,
    };
    if (!SCAN_ID.test(report.scanId)) return noContent();
    if (!(REPORT_MODES as readonly unknown[]).includes(report.mode)) return noContent();
    if (!(REPORT_CONFIDENCES as readonly unknown[]).includes(report.confidence)) return noContent();

    try {
      const bid = req.cookies.get("bl_bid")?.value || "";
      const [perAddress, perBrowser] = await Promise.all([
        countInWindow("wrong:a", clientIp(req), 3600),
        /^[0-9a-f]{32}$/.test(bid) ? countInWindow("wrong:b", bid, 3600) : Promise.resolve(0),
      ]);
      if (perAddress > PER_ADDRESS_PER_HOUR || perBrowser > PER_BROWSER_PER_HOUR) return noContent();
    } catch {
      /* limiter unreachable: one bounded record is not worth losing */
    }

    await recordWrongProduct(report as WrongProductReport);
  } catch {
    /* malformed body: nothing recorded, nothing said */
  }
  return noContent();
}
