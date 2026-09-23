import { NextRequest, NextResponse } from "next/server";
import { markAsPaid, revokeAccess, claimOrder, releaseOrderClaim, storeMagicToken } from "@/lib/redis";
import { detectDeliveryProvider } from "@/lib/payment-provider";
import crypto from "crypto";

/**
 * Purchase webhook, provider-agnostic.
 *
 * Handles Lemon Squeezy, Gumroad and Paddle rather than being rewritten each
 * time the merchant of record moves. Every path fails closed.
 *
 * WHICH PATH RUNS is decided by the delivery itself - each provider signs
 * with its own header - and not by PAYMENT_PROVIDER. It used to be the
 * setting, which defaulted to "gumroad": a Lemon Squeezy store with that
 * default in place had every real purchase checked as a Gumroad ping,
 * rejected, and answered 401. Charged, never fulfilled, and silent on both
 * sides. Reading the delivery removes the configuration from the path
 * entirely, and it keeps refunds from a PREVIOUS provider able to revoke
 * access after a store moves. Choosing a path is not a privilege: every one
 * still requires its own secret. See detectDeliveryProvider.
 *
 * Two things the previous single-provider version did not do, both of which
 * are money problems rather than code-tidiness problems:
 *
 *  1. Refunds and chargebacks could not take access back. markAsPaid() never
 *     expired and nothing ever called the inverse, so a refunded customer
 *     kept lifetime access and the only remedy was hand-editing Redis.
 *  2. Providers retry deliveries. Without an idempotency claim, one order
 *     could send the same welcome email several times and burn Resend quota
 *     on duplicates.
 */

// Constant-time comparison that tolerates unequal lengths without throwing,
// which the raw timingSafeEqual does not.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length is the only thing leaked.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function hmacHex(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

interface PurchaseEvent {
  /**
   * "ignored" is a verified, genuine delivery that must not change access -
   * answered 200 so the provider does not retry it, but never acted on.
   */
  kind: "granted" | "revoked" | "ignored";
  email: string;
  orderId: string;
  note?: string;
}

/**
 * TEST-MODE ORDERS IN PRODUCTION.
 *
 * Lemon Squeezy marks test-mode deliveries with meta.test_mode, and they are
 * paid for with the processor's published test cards - the numbers are in
 * every payments tutorial on the internet. The realistic way one reaches
 * production is CHECKOUT_URL left pointing at a test-mode product after
 * testing the overlay. From then on anyone who types 4242 4242 4242 4242 is
 * granted permanent paid access, for nothing, and it looks exactly like a
 * sale.
 *
 * So on the production deployment a test-mode order is verified, logged
 * loudly, and not granted. LEMONSQUEEZY_ACCEPT_TEST_ORDERS=true lifts that,
 * deliberately and visibly, for the length of an end-to-end test - and it
 * should be unset again afterwards. Preview and local deployments accept test
 * orders without the flag, since that is what they are for.
 */
function testOrdersAllowed(): boolean {
  if (process.env.LEMONSQUEEZY_ACCEPT_TEST_ORDERS === "true") return true;
  return process.env.VERCEL_ENV !== "production";
}

// ── Gumroad: form-encoded ping, no signature header. The documented way to
//    authenticate it is a secret carried on the ping URL, optionally paired
//    with a seller id check. Both are verified here; without the secret
//    configured, nothing is accepted. ──
function parseGumroad(req: NextRequest, rawBody: string): PurchaseEvent | null {
  const secret = process.env.GUMROAD_WEBHOOK_SECRET;
  if (!secret) return null;

  const provided = req.nextUrl.searchParams.get("secret") || "";
  if (!safeEqual(provided, secret)) return null;

  const form = new URLSearchParams(rawBody);
  const expectedSeller = process.env.GUMROAD_SELLER_ID;
  if (expectedSeller && form.get("seller_id") !== expectedSeller) return null;

  // When a product permalink is configured, only that product grants access.
  // Without it, any sale from this seller would unlock BustedLab.
  const expectedProduct = process.env.GUMROAD_PRODUCT_PERMALINK;
  if (expectedProduct) {
    const permalink = form.get("permalink") || form.get("product_permalink") || "";
    if (!permalink.includes(expectedProduct)) return null;
  }

  const email = (form.get("email") || "").trim();
  if (!email) return null;

  const refunded = form.get("refunded") === "true";
  const disputed = form.get("disputed") === "true";
  const chargebacked = form.get("chargebacked") === "true";
  const cancelled = form.get("cancelled") === "true";

  return {
    kind: refunded || disputed || chargebacked || cancelled ? "revoked" : "granted",
    email,
    orderId: form.get("sale_id") || form.get("order_number") || `gumroad:${email}`,
  };
}

// ── Lemon Squeezy: HMAC-SHA256 of the raw body in X-Signature. ──
function parseLemonSqueezy(req: NextRequest, rawBody: string): PurchaseEvent | null {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) return null;

  const signature = req.headers.get("x-signature") || "";
  if (!safeEqual(hmacHex(secret, rawBody), signature)) return null;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const meta = event.meta as Record<string, unknown> | undefined;
  const data = event.data as Record<string, unknown> | undefined;
  const attributes = data?.attributes as Record<string, unknown> | undefined;
  const eventName = String(meta?.event_name || "");

  const email = String(
    attributes?.user_email ||
    (attributes?.customer as Record<string, unknown> | undefined)?.email ||
    ""
  ).trim();
  const orderId = String(data?.id || attributes?.identifier || `ls:${email}`);

  // Verified from here on. A genuine delivery this app does not act on is
  // answered 200 and dropped. It used to be answered 401 "unverified", which
  // is wrong on both ends: Lemon Squeezy treats any non-200 as a failed
  // delivery and retries it, and the log said "signature failed" about a
  // delivery whose signature was fine, which is the one thing that must
  // never be ambiguous when someone says they paid and did not get in.
  const notActedOn = (note?: string): PurchaseEvent => ({ kind: "ignored", email, orderId, note });

  if (eventName === "order_refunded" || eventName === "subscription_cancelled") {
    if (!email) return notActedOn(`${eventName} carried no customer email, so no access was revoked`);
    return { kind: "revoked", email, orderId: `${orderId}:refund` };
  }
  if (eventName === "order_created" || eventName === "order_paid") {
    if (!email) return notActedOn("order carried no customer email, so no access was granted");
    // A created-but-unpaid order must not unlock anything.
    const status = String(attributes?.status || "paid");
    if (status !== "paid" && status !== "active" && status !== "completed") {
      return notActedOn(`order status is "${status}", not paid, so no access was granted`);
    }
    if (meta?.test_mode === true && !testOrdersAllowed()) {
      return {
        kind: "ignored",
        email,
        orderId,
        note:
          "Lemon Squeezy TEST-MODE order received on production and NOT granted. If this was " +
          "your own test, set LEMONSQUEEZY_ACCEPT_TEST_ORDERS=true for the duration of the test. " +
          "If it was not, CHECKOUT_URL is pointing at a test-mode product and needs the live link.",
      };
    }
    return { kind: "granted", email, orderId };
  }
  // Any other event the store is subscribed to. Nothing to do, nothing to log.
  return notActedOn();
}

// ── Paddle Billing: Paddle-Signature header of the form "ts=...;h1=...",
//    HMAC-SHA256 over "<ts>:<rawBody>". ──
function parsePaddle(req: NextRequest, rawBody: string): PurchaseEvent | null {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return null;

  const header = req.headers.get("paddle-signature") || "";
  const parts = Object.fromEntries(
    header.split(";").map(p => p.split("=") as [string, string]).filter(p => p.length === 2)
  );
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) return null;

  // Reject deliveries older than five minutes so a captured request cannot
  // be replayed indefinitely.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return null;

  if (!safeEqual(hmacHex(secret, `${ts}:${rawBody}`), h1)) return null;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const eventType = String(event.event_type || "");
  const data = event.data as Record<string, unknown> | undefined;
  const customer = data?.customer as Record<string, unknown> | undefined;
  const email = String(customer?.email || (data?.custom_data as Record<string, unknown> | undefined)?.email || "").trim();
  if (!email) return null;

  const orderId = String(data?.id || `paddle:${email}`);

  if (eventType === "transaction.completed" || eventType === "transaction.paid") {
    return { kind: "granted", email, orderId };
  }
  if (eventType === "adjustment.updated" || eventType === "transaction.canceled") {
    return { kind: "revoked", email, orderId: `${orderId}:refund` };
  }
  return null;
}

async function sendAccessEmail(email: string): Promise<void> {
  if (!process.env.RESEND_API_KEY || !process.env.NEXT_PUBLIC_BASE_URL) {
    // Access is still granted; the customer reaches it through the sign-in
    // form. But a silent skip here is how "I paid and heard nothing" starts,
    // so it is said out loud.
    console.error(
      "Webhook: access granted but NO access email sent - RESEND_API_KEY or NEXT_PUBLIC_BASE_URL is unset."
    );
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  await storeMagicToken(token, email);

  // fetch only rejects on a network failure. A Resend refusal - unverified
  // sending domain, bad key, rate limit - comes back as a normal response
  // with a 4xx status, and the previous version never looked at it. Every
  // customer's access email could have been failing with nothing in the
  // logs to say so.
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "BustedLab <access@bustedlab.com>",
      to: email,
      subject: "Your BustedLab access is live",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; background: #07070e; color: #eeeef6; padding: 40px 32px; border-radius: 16px;">
          <p style="color:#9d7fd4;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin:0 0 18px;">BUSTEDLAB &middot; ACCESS GRANTED</p>
          <h1 style="font-size: 24px; font-weight: 800; margin-bottom: 8px; color: #eeeef6;">You're in.</h1>
          <p style="color: rgba(238,238,246,0.6); margin-bottom: 32px; line-height: 1.6;">Unlimited scans, active on every device. Tap below to sign in.</p>
          <a href="${process.env.NEXT_PUBLIC_BASE_URL}/api/auth?token=${token}"
            style="display: inline-block; background: linear-gradient(135deg, #9d7fd4, #7b5ea7); color: white; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 700; font-size: 15px;">
            Access BustedLab
          </a>
          <p style="color: rgba(238,238,246,0.3); font-size: 12px; margin-top: 32px;">Link expires in 15 minutes. Request a new one any time from the sign-in screen. If you did not purchase this, ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend refused the access email (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const active = detectDeliveryProvider(req.headers);

  const parsed =
    active === "lemonsqueezy" ? parseLemonSqueezy(req, rawBody)
    : active === "paddle" ? parsePaddle(req, rawBody)
    : parseGumroad(req, rawBody);

  // FAIL CLOSED. An unconfigured or unverifiable webhook must mean "reject",
  // never "trust": anyone who can POST here would otherwise be able to mark
  // themselves as a paying customer, permanently, for free.
  if (!parsed) {
    return NextResponse.json({ error: "unverified" }, { status: 401 });
  }

  // A verified delivery that must not change access. Answered before the
  // idempotency claim, deliberately: a claim taken here would make the same
  // order read as "duplicate" if it is resent from the provider's dashboard
  // after the reason for ignoring it has been dealt with.
  if (parsed.kind === "ignored") {
    if (parsed.note) console.error(`Webhook: ${parsed.note} (order ${parsed.orderId}, ${parsed.email})`);
    return NextResponse.json({ received: true, ignored: true });
  }

  // Providers retry. Only the first delivery of an order does the work - but
  // the claim is given back if the work then fails, or the retry it exists to
  // deduplicate would be answered "duplicate" against an order that was never
  // actually fulfilled. That is the worst bug this file can have: the provider
  // sees 200, the customer sees nothing, and nobody finds out until they
  // complain.
  const isFirstDelivery = await claimOrder(parsed.orderId).catch(() => true);
  if (!isFirstDelivery) return NextResponse.json({ received: true, duplicate: true });

  try {
    if (parsed.kind === "revoked") {
      await revokeAccess(parsed.email);
      return NextResponse.json({ received: true });
    }

    await markAsPaid(parsed.email);
    try {
      await sendAccessEmail(parsed.email);
    } catch (mailError) {
      // Access is already granted, and the customer can reach it from the
      // sign-in form, so a failed email must not fail the webhook and drag a
      // fulfilled order back through a retry.
      console.error("Webhook: access granted but access email failed to send", mailError);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    await releaseOrderClaim(parsed.orderId);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
