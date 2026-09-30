import { NextRequest, NextResponse } from "next/server";
import { removeNotifyEntry } from "@/lib/redis";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";

/**
 * Removes an address from the product update list. POST only, and only with
 * the signed token from that address's own unsubscribe link.
 *
 * Two callers. A mail client doing RFC 8058 one-click unsubscribe posts
 * "List-Unsubscribe=One-Click" here directly and reads the status. A person
 * confirms on /unsubscribe, whose form posts here and is sent back to that
 * page. A GET does nothing: mail filters open every link in a message, and
 * a filter must not be able to take someone off a list they chose to join.
 */
export async function POST(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email") || "";
  const token = req.nextUrl.searchParams.get("token") || "";
  const oneClick = (await req.text().catch(() => "")).includes("List-Unsubscribe=One-Click");
  const valid = !!email && verifyUnsubscribeToken(email, token);

  let outcome: "done" | "invalid" | "failed" = valid ? "done" : "invalid";
  if (valid) {
    try {
      await removeNotifyEntry(email);
    } catch (err) {
      console.error("Unsubscribe failed; the address is still on the list:", err);
      outcome = "failed";
    }
  }

  if (oneClick) {
    const status = outcome === "done" ? 200 : outcome === "invalid" ? 403 : 503;
    return new NextResponse(outcome === "done" ? "Unsubscribed" : outcome === "invalid" ? "Invalid unsubscribe link" : "Try again", { status });
  }
  const page = new URL("/unsubscribe", req.url);
  page.searchParams.set(outcome, "1");
  if (outcome === "failed") {
    page.searchParams.set("email", email);
    page.searchParams.set("token", token);
  }
  return NextResponse.redirect(page, 303);
}
