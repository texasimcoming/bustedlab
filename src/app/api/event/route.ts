import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { isClientReportable, recordEvent } from "@/lib/analytics";
import { hashIdentifier } from "@/lib/redis";

/**
 * The beacon.
 *
 * Three of the six tracked events are browser interactions the server cannot
 * observe: a share sheet opening, the paywall appearing, a purchase link being
 * followed. They arrive here.
 *
 * The endpoint is public by necessity, so it is built to be boring to abuse:
 * only three event names are accepted, nothing else in the body is read, and
 * anything that is not on the list is a 400 rather than a new Redis key. That
 * last part matters more than it looks. An endpoint that increments whatever
 * string it is handed lets anyone write unbounded keys into the same database
 * that holds the ledger.
 *
 * It answers 204 in every case, including rejection. A beacon that reports its
 * own failures teaches an attacker what the allowlist is and gives a browser a
 * reason to log an error over a number nobody will miss.
 */

const PER_MINUTE = Number(process.env.EVENT_BURST_PER_MINUTE || 60);

let _limiter: Ratelimit | null | undefined;
function getLimiter(): Ratelimit | null {
  if (_limiter !== undefined) return _limiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _limiter = url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(PER_MINUTE, "60 s"),
        prefix: "event:burst",
        analytics: false,
      })
    : null;
  return _limiter;
}

function clientKey(req: NextRequest): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  // Hashed for the same reason the rate-limit keys are: the address is only
  // ever needed as an opaque bucket, so it is never written down in the clear.
  return hashIdentifier(ip);
}

const NO_CONTENT = new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!isClientReportable(body?.event)) return NO_CONTENT;

    const limiter = getLimiter();
    if (limiter) {
      try {
        const { success } = await limiter.limit(clientKey(req));
        // A real session fires a handful of these. Sixty a minute is a script.
        if (!success) return NO_CONTENT;
      } catch {
        /* limiter unreachable: count it rather than lose it */
      }
    }

    await recordEvent(body.event);
  } catch {
    /* malformed body, no counter, no error */
  }
  return NO_CONTENT;
}
