import { NextResponse } from "next/server";
import { checkoutReadiness } from "@/lib/payment-provider";

/**
 * Checkout, provider-agnostic.
 *
 * CHECKOUT_URL is the single source of truth for where checkout goes, and -
 * unless PAYMENT_PROVIDER overrides it - for which provider runs it. See
 * src/lib/payment-provider.ts for why that inference exists: a provider
 * setting that disagreed with the link used to mean every purchase was
 * charged and then rejected at the webhook.
 *
 *   CHECKOUT_URL=https://<store>.lemonsqueezy.com/checkout/buy/<variant>
 *   LEMONSQUEEZY_WEBHOOK_SECRET=<the signing secret on the store's webhook>
 *
 * Checkout is offered only when it is safe to take money: a valid link, a
 * provider the link does not contradict, and a webhook secret for that
 * provider so the purchase can actually be verified and fulfilled. Otherwise
 * this returns 503 and the UI renders its closed state. A dead link that
 * looks alive is worse than an honest closed door, and a working link whose
 * purchases can never be fulfilled is worse than both.
 *
 * The reason is logged on the server and deliberately not returned: it
 * names which secret is missing, which is nobody's business but the
 * operator's.
 *
 * `embed` tells the client whether to open the Lemon Squeezy overlay rather
 * than navigate. The URL returned is always the plain configured link; the
 * overlay's `embed=1` parameter is added client-side at the moment the
 * overlay opens, so the full-page fallback never receives a URL meant for an
 * iframe.
 */

export type CheckoutResponse =
  | { url: string; provider: string; embed: boolean }
  | { error: string };

function logUnavailable(detail: string): void {
  console.error(`BustedLab checkout offline: ${detail}`);
}

export async function POST() {
  const ready = checkoutReadiness();

  if (!ready.ok) {
    logUnavailable(ready.detail);
    return NextResponse.json(
      { error: "checkout_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    { url: ready.url, provider: ready.provider, embed: ready.embed },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// Lets the client know whether checkout is live - and whether it will be an
// overlay - without attempting a purchase, so the UI renders the right state
// on first paint and can warm the overlay script before the click.
export async function GET() {
  const ready = checkoutReadiness();
  if (!ready.ok) logUnavailable(ready.detail);
  return NextResponse.json(
    ready.ok
      ? { available: true, provider: ready.provider, embed: ready.embed }
      : { available: false },
    { headers: { "Cache-Control": "no-store" } }
  );
}
