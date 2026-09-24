import crypto from "crypto";
import type { NextRequest } from "next/server";
import {
  CHECKOUT_CLAIM_SECONDS,
  countInWindow,
  isPaidUser,
  openCheckoutClaim,
  readCheckoutClaim,
  redeemCheckoutClaim,
} from "@/lib/redis";

/**
 * THE PAYING BROWSER UNLOCKS ITSELF.
 *
 * Before this, paying got you an email, and the browser you paid in stayed
 * locked until you went to your inbox and tapped a link. On a phone that is
 * an app switch at the exact moment the purchase should feel finished, and
 * everyone who did not make the switch had paid for something that looked
 * broken.
 *
 * The flow:
 *   1. The buy click (POST /api/checkout) opens a claim: a random value,
 *      stored as "pending", set in an httpOnly cookie on this browser and
 *      passed to Lemon Squeezy as checkout[custom][claim].
 *   2. Lemon Squeezy returns it on the order_created webhook as
 *      meta.custom_data.claim. Once the order is verified and access
 *      granted, the webhook attaches the buyer's address to the claim.
 *   3. The browser asks PATCH /api/auth - on page load, and every few
 *      seconds while a checkout is open - and the first answer after step 2
 *      redeems the claim and signs this browser in.
 *
 * The email still goes out. It is how every other device gets in, and it is
 * the whole path if any step here does not happen: nothing about the
 * purchase depends on this.
 *
 * WHAT A CLAIM CAN AND CANNOT DO. It only ever signs in the browser holding
 * its cookie, as the address that paid on it, once, within two hours. It
 * grants nothing on its own; access still comes only from the verified
 * webhook. The claim is visible in the checkout link, so someone could hand
 * another person a checkout link carrying their own claim; if that person
 * bought through it within two hours, the link's author would be signed in
 * to the account the other person just paid for. They gain the same $4.99
 * of access the buyer bought, and the buyer keeps theirs. The two-hour life
 * is what bounds it.
 */

export const CLAIM_COOKIE = "bl_claim";
const CLAIM_FORMAT = /^[0-9a-f]{48}$/;

// Claims opened per visitor per hour. A real buyer clicks buy a handful of
// times; past this, checkout still opens, just without a claim, so a script
// hammering the button cannot fill Redis with them.
const CLAIMS_PER_HOUR = 20;

export function isClaim(value: unknown): value is string {
  return typeof value === "string" && CLAIM_FORMAT.test(value);
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Opens a claim for a checkout that is starting. Returns null rather than
 * failing when one cannot be opened: the checkout goes ahead either way.
 */
export async function openClaimFor(req: NextRequest): Promise<string | null> {
  try {
    if ((await countInWindow("claim", clientIp(req), 3600)) > CLAIMS_PER_HOUR) return null;
    const claim = crypto.randomBytes(24).toString("hex");
    await openCheckoutClaim(claim);
    return claim;
  } catch (err) {
    console.error("Checkout: could not open a claim; this purchase will unlock by email only.", err);
    return null;
  }
}

export const claimCookie = (claim: string) => ({
  name: CLAIM_COOKIE,
  value: claim,
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: CHECKOUT_CLAIM_SECONDS,
  path: "/",
});

export type ClaimState =
  | { kind: "none" }
  | { kind: "pending" }
  | { kind: "redeemed"; email: string };

/**
 * Where this browser's claim stands. "redeemed" means the claim was just
 * used up by this call and the caller must sign the browser in.
 */
export async function claimStateFor(req: NextRequest): Promise<ClaimState> {
  const claim = req.cookies.get(CLAIM_COOKIE)?.value;
  if (!isClaim(claim)) return { kind: "none" };

  const value = await readCheckoutClaim(claim);
  if (!value) return { kind: "none" };
  if (value === "pending") return { kind: "pending" };

  const email = await redeemCheckoutClaim(claim);
  if (!email || !(await isPaidUser(email))) return { kind: "none" };
  return { kind: "redeemed", email };
}
