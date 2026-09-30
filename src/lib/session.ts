import crypto from "crypto";
import type { NextResponse } from "next/server";
import { storeSession } from "@/lib/redis";

export const SESSION_COOKIE = "bl_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Signs this browser in as a paid address: mints a 365-day session and sets
 * its cookie on the response. The one place a session is created, whichever
 * way the browser proved it may have one - a sign-in link, or the checkout it
 * just paid through.
 */
export async function startSession(res: NextResponse, email: string): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  await storeSession(token, email);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}
