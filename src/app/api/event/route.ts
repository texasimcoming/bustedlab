import { NextRequest, NextResponse } from "next/server";
import { isClientReportable, recordEvent } from "@/lib/analytics";
import { countInWindow } from "@/lib/redis";

/**
 * The beacon.
 *
 * The funnel steps the server cannot observe (a landing rendering, a photo
 * being picked, a share sheet opening, the paywall appearing, a purchase link
 * being followed: see CLIENT_EVENTS in src/lib/analytics.ts) arrive here.
 *
 * The endpoint is public by necessity, so it is built to be boring to abuse:
 * only the listed event names are accepted, nothing else in the body is read
 * except one channel label from a fixed list (src/lib/source.ts),
 * and anything that is not on the list is dropped rather than becoming a new
 * Redis key. That last part matters more than it looks. An endpoint that
 * increments whatever string it is handed lets anyone write unbounded keys
 * into the same database that holds the ledger.
 *
 * RATE LIMITS. Per browser (the bl_bid cookie the scan route issues), with a
 * far higher ceiling per IP address. A per-address limit alone was wrong for
 * this traffic: a mobile carrier puts thousands of phones behind one IPv4
 * address, and a campaign landing on one carrier would have had most of its
 * events silently dropped, which is the funnel lying at the exact moment it
 * matters. A request without the cookie (the first beacon of a first visit
 * can beat the cookie) is held to the address ceiling only.
 *
 * It answers 204 in every case, including rejection. A beacon that reports its
 * own failures teaches an attacker what the allowlist is and gives a browser a
 * reason to log an error over a number nobody will miss.
 */

const PER_BROWSER_PER_MINUTE = Number(process.env.EVENT_BURST_PER_MINUTE || 60);
const PER_ADDRESS_PER_MINUTE = Number(process.env.EVENT_BURST_PER_ADDRESS_PER_MINUTE || 1200);

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function browserId(req: NextRequest): string | null {
  const id = req.cookies.get("bl_bid")?.value || "";
  return /^[0-9a-f]{32}$/.test(id) ? id : null;
}

// Built per request on purpose. A Response is a single-use object: sharing
// one module-level instance across every request to a warm serverless
// instance means handing the same object to concurrent responses, which is
// undefined behaviour at best and a consumed-body error at worst. It costs
// nothing to construct.
const noContent = () => new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!isClientReportable(body?.event)) return noContent();

    // A real session fires a handful of these. Sixty a minute from one
    // browser is a script; the address ceiling bounds a script that drops the
    // cookie. Both counters store only a hash of what they count.
    try {
      const browser = browserId(req);
      const [perAddress, perBrowser] = await Promise.all([
        countInWindow("event:a", clientIp(req), 60),
        browser ? countInWindow("event:b", browser, 60) : Promise.resolve(0),
      ]);
      if (perAddress > PER_ADDRESS_PER_MINUTE || perBrowser > PER_BROWSER_PER_MINUTE) return noContent();
    } catch {
      /* counters unreachable: count the event rather than lose it */
    }

    // The visit's channel label (src/lib/source.ts), if it is one of the
    // listed words; anything else is ignored and the event still counts.
    await recordEvent(body.event, new Date(), body.source);
  } catch {
    /* malformed body, no counter, no error */
  }
  return noContent();
}
