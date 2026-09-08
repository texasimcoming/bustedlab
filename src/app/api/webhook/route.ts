import { NextRequest, NextResponse } from "next/server";
import { markAsPaid, revokeAccess, claimOrder, storeMagicToken } from "@/lib/redis";
import crypto from "crypto";

/**
 * Purchase webhook, provider-agnostic.
 *
 * The merchant of record is still moving (Lemon Squeezy rejected the store,
 * Paddle is pending, Gumroad is the bridge), so this handles all three
 * rather than being rewritten each time. PAYMENT_PROVIDER selects which
 * verification path runs; every path fails closed.
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

type Provider = "gumroad" | "lemonsqueezy" | "paddle";

function provider(): Provider {
  const p = (process.env.PAYMENT_PROVIDER || "gumroad").toLowerCase();
  return p === "lemonsqueezy" || p === "paddle" ? p : "gumroad";
}

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
  kind: "granted" | "revoked";
  email: string;
  orderId: string;
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
  if (!email) return null;

  const orderId = String(data?.id || attributes?.identifier || `ls:${email}`);

  if (eventName === "order_refunded" || eventName === "subscription_cancelled") {
    return { kind: "revoked", email, orderId: `${orderId}:refund` };
  }
  if (eventName === "order_created" || eventName === "order_paid") {
    // A created-but-unpaid order must not unlock anything.
    const status = String(attributes?.status || "paid");
    if (status !== "paid" && status !== "active" && status !== "completed") return null;
    return { kind: "granted", email, orderId };
  }
  return null;
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
  if (!process.env.RESEND_API_KEY || !process.env.NEXT_PUBLIC_BASE_URL) return;

  const token = crypto.randomBytes(32).toString("hex");
  await storeMagicToken(token, email);

  await fetch("https://api.resend.com/emails", {
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
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const active = provider();

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

  try {
    // Providers retry. Only the first delivery of an order does the work.
    const isFirstDelivery = await claimOrder(parsed.orderId).catch(() => true);
    if (!isFirstDelivery) return NextResponse.json({ received: true, duplicate: true });

    if (parsed.kind === "revoked") {
      await revokeAccess(parsed.email);
      return NextResponse.json({ received: true });
    }

    await markAsPaid(parsed.email);
    try {
      await sendAccessEmail(parsed.email);
    } catch (mailError) {
      // Access is already granted. A failed email is recoverable by the
      // customer through the sign-in form, so it must not fail the webhook
      // and trigger a provider retry against an order already fulfilled.
      console.error("Webhook: access granted but access email failed to send", mailError);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
