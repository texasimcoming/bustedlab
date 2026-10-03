import { NextRequest, NextResponse } from "next/server";
import { isOperator } from "@/lib/operator";
import { checkoutReadiness, resolvePaymentProvider } from "@/lib/payment-provider";
import { emailFrom, emailFromDomain } from "@/lib/email";
import { GLOBAL_DAILY_CAP, PAID_DAILY_SCAN_CEILING, redisRoundTrip } from "@/lib/redis";
import { DAILY_MODEL_BUDGET_USD } from "@/lib/model-budget";

/**
 * LAUNCH PREFLIGHT. One request that says whether this deployment can take
 * money, deliver what was bought, and run the scanner - and names exactly
 * what is wrong if not. Run it after every configuration change and before
 * sending anyone to the site:
 *
 *   curl -s -H "Authorization: Bearer $ANALYTICS_TOKEN" https://<domain>/api/preflight
 *
 * "blockers" lose money or customers the moment traffic arrives; "warnings"
 * are worth fixing but do not. It reports whether each thing is set and
 * working, never a value: the answer is safe to paste anywhere. Behind the
 * same token as /api/stats.
 */
export const dynamic = "force-dynamic";

type Finding = { check: string; detail: string };

async function resendDomainStatus(domain: string): Promise<"verified" | "restricted" | "missing" | "unreachable" | string> {
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 401 || res.status === 403) return "restricted";
    if (!res.ok) return "unreachable";
    const body = (await res.json()) as { data?: { name?: string; status?: string }[] };
    const match = (body.data || []).find(d => (d.name || "").toLowerCase() === domain);
    return match ? String(match.status || "unknown") : "missing";
  } catch {
    return "unreachable";
  }
}

export async function GET(req: NextRequest) {
  if (!isOperator(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const ok: string[] = [];
  const production = process.env.VERCEL_ENV === "production";

  // ── Storage: everything - access, sessions, limits, the ledger - lives here.
  if (await redisRoundTrip()) ok.push("redis");
  else blockers.push({ check: "redis", detail: "Upstash did not answer a write and read. Check UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN." });

  // ── Taking money.
  const checkout = checkoutReadiness();
  if (checkout.ok) ok.push(`checkout (${checkout.provider}${checkout.embed ? ", overlay" : ""})`);
  else blockers.push({ check: "checkout", detail: `Checkout is offline: ${checkout.detail}` });
  if (process.env.LEMONSQUEEZY_ACCEPT_TEST_ORDERS === "true" && production) {
    warnings.push({ check: "test orders", detail: "LEMONSQUEEZY_ACCEPT_TEST_ORDERS=true on production: anyone with a test card gets free access. Unset it once your test is done." });
  }
  if (process.env.GUMROAD_PRODUCT_PERMALINK && resolvePaymentProvider() !== "gumroad") {
    warnings.push({ check: "gumroad settings", detail: "GUMROAD_PRODUCT_PERMALINK is set but checkout is not Gumroad; it has no effect." });
  }

  // ── Delivering what was bought: the access email and sign-in links.
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").trim();
  if (!base) {
    blockers.push({ check: "base url", detail: "NEXT_PUBLIC_BASE_URL is not set: no access email is sent after a purchase, and share links point nowhere." });
  } else if (!base.startsWith("https://")) {
    blockers.push({ check: "base url", detail: "NEXT_PUBLIC_BASE_URL is not https." });
  } else if (production && new URL(base).host !== req.nextUrl.host) {
    warnings.push({ check: "base url", detail: `NEXT_PUBLIC_BASE_URL is ${new URL(base).host}, but this request came to ${req.nextUrl.host}. Emails will link to the former.` });
  } else {
    ok.push("base url");
  }
  const domain = emailFromDomain();
  if (!process.env.RESEND_API_KEY) {
    blockers.push({ check: "email", detail: "RESEND_API_KEY is not set: buyers get no access email and nobody can sign in by link." });
  } else if (!domain) {
    blockers.push({ check: "email", detail: `EMAIL_FROM is not a valid address: ${emailFrom()}` });
  } else {
    const status = await resendDomainStatus(domain);
    if (status === "verified") ok.push(`email (${domain} verified)`);
    else if (status === "restricted") warnings.push({ check: "email", detail: `The Resend key is send-only, so the domain could not be checked. Confirm ${domain} shows as verified in Resend.` });
    else if (status === "unreachable") warnings.push({ check: "email", detail: "Resend did not answer; the sending domain could not be checked." });
    else if (status === "missing") blockers.push({ check: "email", detail: `${domain} is not a domain in this Resend account, so every email is refused. Add and verify it, or set EMAIL_FROM to an address on a verified domain.` });
    else blockers.push({ check: "email", detail: `${domain} is "${status}" in Resend, not verified, so every email is refused until it is.` });
  }

  // ── The scanner.
  if (process.env.ANTHROPIC_API_KEY) ok.push("model key");
  else blockers.push({ check: "model key", detail: "ANTHROPIC_API_KEY is not set: no scan can identify a product." });
  if (process.env.SERPER_API_KEY || process.env.SERPAPI_KEY) ok.push("search key");
  else blockers.push({ check: "search key", detail: "Neither SERPER_API_KEY nor SERPAPI_KEY is set: no scan can find a price." });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    warnings.push({ check: "blob", detail: "BLOB_READ_WRITE_TOKEN is not set: photo scans cannot use reverse-image search and will match less often." });
  }
  // Budget mode: Serper is the primary for Lens and Shopping, SerpApi the
  // backup used only above its reserve (SEARCH PROVIDERS in scan.ts).
  if (!process.env.SERPAPI_KEY && process.env.SERPER_API_KEY) {
    warnings.push({ check: "lens", detail: "SERPAPI_KEY is not set: there is no backup when Serper fails, and the direct-retailer price check cannot be turned on." });
  }
  if (process.env.SERPAPI_KEY && !process.env.SERPER_API_KEY) {
    warnings.push({ check: "lens", detail: "SERPER_API_KEY is not set: Lens and Shopping run on SerpApi alone, and only until its remaining searches reach the reserve; after that, scans cannot search." });
  }

  // ── Promises the site makes.
  if (process.env.IDENTITY_SALT) ok.push("identity salt");
  else blockers.push({ check: "identity salt", detail: "IDENTITY_SALT is not set: the privacy policy's hashed-IP claim is not true with the built-in salt." });
  if (!process.env.CRON_SECRET) {
    warnings.push({ check: "cron", detail: "CRON_SECRET is not set: the nightly cleanup of orphaned scan uploads is refused." });
  }
  if (!process.env.UNSUBSCRIBE_SECRET) {
    warnings.push({ check: "unsubscribe", detail: "UNSUBSCRIBE_SECRET is not set. Set it before the first email to the update list and never change it." });
  }
  if (process.env.CSP_REPORT_ONLY === "true") {
    warnings.push({ check: "csp", detail: "CSP_REPORT_ONLY=true: the Content-Security-Policy is not being enforced. Unset it once the fix it was for is live." });
  }

  return NextResponse.json(
    {
      ready: blockers.length === 0,
      environment: process.env.VERCEL_ENV || "unknown",
      blockers,
      warnings,
      ok,
      // Configuration present is not configuration working. /api/diagnose
      // calls every provider for real with the engine's own requests.
      next: "GET /api/diagnose with the same token: real calls to every model and provider",
      limits: {
        dailyModelBudgetUsd: DAILY_MODEL_BUDGET_USD,
        paidScansPerAccountPerDay: PAID_DAILY_SCAN_CEILING,
        freeUncachedScansPerDay: GLOBAL_DAILY_CAP,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
