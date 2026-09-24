import { NextRequest, NextResponse } from "next/server";
import { consumeMagicToken } from "@/lib/redis";
import { startSession } from "@/lib/session";

/**
 * Where a sign-in link's page posts to. The only request that turns a link
 * into a session, and it is a POST: link scanners open links, they do not
 * submit forms. See consumeMagicToken for why that matters.
 *
 * A plain form post answered with a 303, so it works with scripts off, and
 * the browser lands on the home page with its new cookie.
 */
const TOKEN_FORMAT = /^[0-9a-f]{64}$/;

export async function POST(req: NextRequest) {
  const land = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);

  let token = "";
  try {
    token = String((await req.formData()).get("token") || "");
  } catch {
    /* not a form post */
  }
  if (!TOKEN_FORMAT.test(token)) return land("/?auth=failed");

  try {
    const email = await consumeMagicToken(token);
    if (!email) return land("/?auth=expired");
    const res = land("/?auth=success");
    await startSession(res, email);
    return res;
  } catch (err) {
    console.error("Verify error:", err);
    return land("/?auth=failed");
  }
}
