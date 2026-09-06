import { NextResponse } from "next/server";

// Lemon Squeezy handles all payment processing
// No Stripe needed - LS is our Merchant of Record
export async function POST() {
  return NextResponse.json({
    url: "https://getbustedlab.lemonsqueezy.com/checkout/buy/ebbbdfc5-e62c-4404-9b8c-0609b9aa85be",
  });
}
