import { NextRequest, NextResponse } from "next/server";
import { addNotifyEntry, claimOrder, countInWindow } from "@/lib/redis";
import { recordEvent } from "@/lib/analytics";

/**
 * INTENT CAPTURE.
 *
 * Everyone who scans, hits the daily limit and does not pay was previously
 * lost the moment they closed the tab. They are also the most qualified
 * audience this product will ever have: they did not read about it, they used
 * it, and they ran out of it. An address from that moment is worth more than
 * any amount of cold traffic.
 *
 * Storing an address for future marketing is not the same legal basis as
 * storing one to deliver a purchase, so this route only accepts a submission
 * that carried explicit consent, records when consent was given, and the
 * privacy policy describes the list. Leaving it is POST
 * /api/notify/unsubscribe with a signed link; see src/lib/unsubscribe.ts.
 *
 * Every address on this list will one day be mailed from the same domain
 * that sends access emails to paying customers. Addresses nobody consented
 * to - a script filling the form - turn into bounces and spam complaints on
 * that first send, and the domain's reputation is what gets the next access
 * email into an inbox. So each visitor can add only a few addresses an
 * hour, on top of the per-address limit.
 */

const VALID_SOURCES = new Set(["paywall", "limit", "results", "footer"]);

// Sign-ups accepted per visitor (hashed IP) per hour. A household or an
// office behind one address can still sign up several people. A value that
// is not a positive number falls back to the default rather than turning
// every sign-up away.
function perVisitorPerHour(): number {
  const configured = Number(process.env.NOTIFY_PER_IP_PER_HOUR);
  return Number.isFinite(configured) && configured > 0 ? configured : 5;
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function visitorWithinRate(req: NextRequest): Promise<boolean> {
  try {
    return (await countInWindow("notify", clientIp(req), 3600)) <= perVisitorPerHour();
  } catch {
    return true; // Redis unreachable: the write below will fail on its own
  }
}

// Deliberately conservative. This is a signup field on a public page, so the
// realistic failure mode is a script filling it, not a person typing quickly.
function looksLikeEmail(value: string): boolean {
  if (value.length < 6 || value.length > 254) return false;
  return /^[^\s@,;:<>()[\]\\]+@[^\s@.,;:<>()[\]\\]+\.[a-z]{2,}$/i.test(value);
}

async function withinRate(key: string): Promise<boolean> {
  // One submission per address per minute, reusing the same single-use claim
  // the magic-link sender uses.
  try {
    return await claimOrder(`notify-rate:${key}:${Math.floor(Date.now() / 60000)}`);
  } catch {
    return true;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = String(body?.email || "").toLowerCase().trim();
    const source = VALID_SOURCES.has(String(body?.source)) ? String(body.source) : "paywall";
    const consent = body?.consent === true;

    if (!looksLikeEmail(email)) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }

    // The form states what the address is for and submitting it is the
    // consent. Refusing the write without the flag keeps a stray API call
    // from creating a record nobody agreed to.
    if (!consent) {
      return NextResponse.json({ error: "consent_required" }, { status: 400 });
    }

    if (!(await visitorWithinRate(req)) || !(await withinRate(email))) {
      // Same response as success. A rate-limited reply that differs from a
      // successful one turns this endpoint into a way to test whether an
      // address is already on the list, or to learn where the limit sits.
      return NextResponse.json({ saved: true });
    }

    await addNotifyEntry(email, source);
    // Counted after the rate-limit gate, so a resubmission of the same address
    // inside a minute cannot inflate the capture count.
    await recordEvent("email_captured");
    return NextResponse.json({ saved: true });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
