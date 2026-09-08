import { NextRequest, NextResponse } from "next/server";
import { markAsPaid } from "@/lib/redis";
import crypto from "crypto";

// Verify Lemon Squeezy webhook signature
function verifySignature(payload: string, signature: string, secret: string): boolean {
  try {
    const hmac = crypto.createHmac("sha256", secret);
    const digest = hmac.update(payload).digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(digest, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  const rawBody = await req.text();

  // FAIL CLOSED: if the secret isn't configured, reject everything rather
  // than silently trusting every request. The previous version skipped
  // verification entirely when the secret was missing, which meant anyone
  // could POST a fake { event_name: "order_paid", user_email: "..." }
  // payload here and get marked as a paying user for free, permanently —
  // markAsPaid() never expires. An unconfigured secret must mean "reject",
  // never "trust."
  if (!secret) {
    console.error("BustedLab webhook: LEMONSQUEEZY_WEBHOOK_SECRET is not configured — rejecting all webhook events until it is set.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const signature = req.headers.get("x-signature") || "";
  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const event = JSON.parse(rawBody);
    const eventName = event.meta?.event_name;

    // Handle successful orders
    if (eventName === "order_created" || eventName === "order_paid") {
      const email = event.data?.attributes?.user_email
        || event.data?.attributes?.customer?.email
        || event.data?.relationships?.customer?.data?.attributes?.email;

      if (email) {
        await markAsPaid(email);
        console.log(`BustedLab: marked ${email} as paid`);

        // Send magic link email so they can sign in
        if (process.env.RESEND_API_KEY && process.env.NEXT_PUBLIC_BASE_URL) {
          const token = crypto.randomBytes(32).toString("hex");
          // Store token in Redis
          const { storeMagicToken } = await import("@/lib/redis");
          await storeMagicToken(token, email);

          // Send email
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
                  <h1 style="font-size: 24px; font-weight: 800; margin-bottom: 8px; color: #eeeef6;">You're in.</h1>
                  <p style="color: rgba(238,238,246,0.6); margin-bottom: 32px; line-height: 1.6;">Your BustedLab unlimited access is active. Tap below to sign in and start scanning.</p>
                  <a href="${process.env.NEXT_PUBLIC_BASE_URL}/auth/verify?token=${token}" 
                    style="display: inline-block; background: linear-gradient(135deg, #9d7fd4, #7b5ea7); color: white; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 700; font-size: 15px;">
                    Access BustedLab
                  </a>
                  <p style="color: rgba(238,238,246,0.3); font-size: 12px; margin-top: 32px;">Link expires in 24 hours. If you didn't purchase this, ignore this email.</p>
                </div>
              `,
            }),
          });
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
