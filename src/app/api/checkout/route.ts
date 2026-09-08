import { NextResponse } from "next/server";

/**
 * Checkout, provider-agnostic.
 *
 * The previous version hardcoded a single Lemon Squeezy checkout URL in two
 * places (here and again inline in the landing page, which meant this route
 * was never even called). That store application was rejected, so the URL
 * resolves to nothing: every "Unlock $4.99" button on the site led to a dead
 * page. A hardcoded processor is also the wrong shape for a product whose
 * merchant of record is still moving — Gumroad now as the bridge, Paddle
 * when it clears, something else later — so the destination is configuration,
 * not code.
 *
 * To take money: set CHECKOUT_URL to the live payment link and deploy.
 * Nothing else in the codebase needs to change, and nothing here needs a
 * rebuild to switch processors.
 *
 *   CHECKOUT_URL=https://<seller>.gumroad.com/l/<product>
 *   PAYMENT_PROVIDER=gumroad
 *
 * With CHECKOUT_URL unset, this returns 503 with a machine-readable reason
 * so the UI can say something true ("checkout is offline") instead of
 * opening a broken tab. A dead link that looks alive is worse than an
 * honest closed door.
 */

export type CheckoutResponse =
  | { url: string; provider: string; embed: boolean }
  | { error: string };

// Only https payment links are accepted. A misconfigured env var should fail
// loudly at the route rather than send a customer somewhere unexpected.
function resolveCheckoutUrl(): string | null {
  const raw = (process.env.CHECKOUT_URL || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function POST() {
  const url = resolveCheckoutUrl();

  if (!url) {
    console.error(
      "BustedLab checkout: CHECKOUT_URL is not set. Payment links are configuration, not code. " +
      "Set CHECKOUT_URL to the live payment link (and PAYMENT_PROVIDER to match) to enable purchases."
    );
    return NextResponse.json(
      { error: "checkout_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    {
      url,
      provider: (process.env.PAYMENT_PROVIDER || "gumroad").toLowerCase(),
      // Gumroad overlays require their script; the current flow opens the
      // link directly, which works for every provider without loading a
      // third-party script into the page.
      embed: false,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// Lets the client know whether checkout is live without attempting a purchase,
// so the UI can render the correct state on first paint.
export async function GET() {
  return NextResponse.json(
    { available: !!resolveCheckoutUrl(), provider: (process.env.PAYMENT_PROVIDER || "gumroad").toLowerCase() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
