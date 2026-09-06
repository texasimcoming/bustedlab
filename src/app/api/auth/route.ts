import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  isPaidUser,
  storeMagicToken,
  consumeMagicToken,
  storeSession,
  deleteSession,
  getSessionEmail,
} from "@/lib/redis";
import crypto from "crypto";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY || "re_placeholder");
}

// POST /api/auth - request magic link
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const paid = await isPaidUser(normalizedEmail);

    if (!paid) {
      return NextResponse.json({ error: "No paid account found for this email." }, { status: 404 });
    }

    const token = crypto.randomBytes(32).toString("hex");
    await storeMagicToken(token, normalizedEmail);

    const magicUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/auth/verify?token=${token}`;

    await getResend().emails.send({
      from: "BustedLab <access@bustedlab.com>",
      to: normalizedEmail,
      subject: "Your BustedLab sign-in link",
      html: `
<!DOCTYPE html>
<html>
<body style="background:#08080f;margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
  <table width="100%" style="max-width:480px;margin:0 auto;background:#0d0d1c;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
    <tr>
      <td style="padding:32px;text-align:center;">
        <p style="color:#9d7fd4;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin:0 0 20px;">BustedLab</p>
        <h2 style="color:#eeeef8;font-size:22px;font-weight:700;margin:0 0 12px;">Sign in to your account</h2>
        <p style="color:rgba(238,238,248,0.55);font-size:14px;margin:0 0 28px;">Tap the button below to sign in instantly - no password needed.</p>
        <a href="${magicUrl}" style="display:inline-block;background:linear-gradient(135deg,#9d7fd4,#7b5ea7);color:white;font-weight:700;font-size:15px;text-decoration:none;padding:14px 36px;border-radius:10px;">
          Sign in →
        </a>
        <p style="color:rgba(238,238,248,0.3);font-size:12px;margin:20px 0 0;">Expires in 15 minutes. Didn't request this? Ignore it.</p>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });

    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error("Auth error:", err);
    return NextResponse.json({ error: "Failed to send link" }, { status: 500 });
  }
}

// GET /api/auth?token=xxx - verify magic link
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/?auth=failed", req.url));
  }

  try {
    const email = await consumeMagicToken(token);
    if (!email) {
      return NextResponse.redirect(new URL("/?auth=expired", req.url));
    }

    // Create 365-day session
    const sessionToken = crypto.randomBytes(32).toString("hex");
    await storeSession(sessionToken, email);

    const response = NextResponse.redirect(new URL("/?auth=success", req.url));
    response.cookies.set("bl_session", sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365, // 365 days
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("Verify error:", err);
    return NextResponse.redirect(new URL("/?auth=failed", req.url));
  }
}

// DELETE /api/auth - logout
export async function DELETE(req: NextRequest) {
  const sessionToken = req.cookies.get("bl_session")?.value;
  if (sessionToken) {
    await deleteSession(sessionToken).catch(() => {});
  }

  const response = NextResponse.json({ logged_out: true });
  response.cookies.delete("bl_session");
  return response;
}

// PATCH /api/auth - check session status
export async function PATCH(req: NextRequest) {
  const sessionToken = req.cookies.get("bl_session")?.value;
  if (!sessionToken) return NextResponse.json({ authenticated: false });

  try {
    const email = await getSessionEmail(sessionToken);
    if (!email) return NextResponse.json({ authenticated: false });

    const paid = await isPaidUser(email);
    return NextResponse.json({ authenticated: true, email, paid });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}
