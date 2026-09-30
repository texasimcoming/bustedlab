/**
 * WHICH PAYMENT PROVIDER, AND IS IT SAFE TO TAKE MONEY.
 *
 * Zero imports, so scripts/check-webhook.mjs can exercise the real functions.
 *
 * This module exists because of a failure that would have been completely
 * silent. The webhook chose its signature-verification path from
 * PAYMENT_PROVIDER, which defaulted to "gumroad", and .env.example showed
 * PAYMENT_PROVIDER=gumroad as the example value. Point CHECKOUT_URL at a
 * Lemon Squeezy product with that setting in place and every real purchase
 * arrives at the webhook, is checked as a Gumroad ping, fails, and is
 * answered 401. The customer is charged. The provider sees a failed
 * delivery. Nobody is granted anything. The first anyone hears of it is the
 * customer's email, or the chargeback.
 *
 * Three rules close it:
 *
 *  1. The provider is inferred from the checkout link itself when
 *     PAYMENT_PROVIDER is not set, so the common configuration needs no
 *     second variable to agree with the first. CHECKOUT_URL stays the single
 *     source of truth for where checkout goes, and now also for who runs it.
 *
 *  2. When PAYMENT_PROVIDER IS set and the link plainly belongs to a
 *     different provider, checkout refuses to open. A payment that cannot be
 *     fulfilled is worse than a checkout that says it is offline.
 *
 *  3. Checkout also refuses to open when the webhook for that provider
 *     cannot verify anything because its secret is unset. Same principle:
 *     never take money the system cannot turn into access.
 *
 * The webhook itself no longer depends on this configuration at all - it
 * identifies each delivery by its own signature header (see
 * detectDeliveryProvider). That also keeps refunds working for purchases
 * made under a previous provider after the store moves.
 */

export type Provider = "gumroad" | "lemonsqueezy" | "paddle";

const PROVIDERS: readonly Provider[] = ["gumroad", "lemonsqueezy", "paddle"];

const isProvider = (value: string): value is Provider =>
  (PROVIDERS as readonly string[]).includes(value);

/** The configured checkout link, https only, or null. */
export function resolveCheckoutUrl(): string | null {
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

/**
 * The provider a link plainly belongs to, from its hostname. Null when the
 * host says nothing - a custom checkout domain, say - in which case the
 * explicit setting is the only information there is.
 */
export function providerFromUrl(url: string | null): Provider | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (on("lemonsqueezy.com")) return "lemonsqueezy";
  if (on("gumroad.com") || host === "gum.co") return "gumroad";
  if (on("paddle.com")) return "paddle";
  return null;
}

function explicitProvider(): Provider | null {
  const value = (process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();
  return isProvider(value) ? value : null;
}

/** Explicit setting, else inferred from the link, else the historical default. */
export function resolvePaymentProvider(): Provider {
  return explicitProvider() ?? providerFromUrl(resolveCheckoutUrl()) ?? "gumroad";
}

const WEBHOOK_SECRET_VAR: Record<Provider, string> = {
  gumroad: "GUMROAD_WEBHOOK_SECRET",
  lemonsqueezy: "LEMONSQUEEZY_WEBHOOK_SECRET",
  paddle: "PADDLE_WEBHOOK_SECRET",
};

export function webhookSecretVar(provider: Provider): string {
  return WEBHOOK_SECRET_VAR[provider];
}

export function webhookSecretConfigured(provider: Provider): boolean {
  return !!(process.env[WEBHOOK_SECRET_VAR[provider]] || "").trim();
}

export type CheckoutReadiness =
  | { ok: true; url: string; provider: Provider; embed: boolean }
  | {
      ok: false;
      reason: "no_checkout_url" | "provider_mismatch" | "webhook_unverifiable";
      /** Server-log detail. Never sent to the browser. */
      detail: string;
    };

/**
 * Whether it is safe to put a payment button in front of a customer: a
 * valid link, a provider that is not contradicted by that link, and a
 * webhook that can actually verify the purchase it will receive.
 */
export function checkoutReadiness(): CheckoutReadiness {
  const url = resolveCheckoutUrl();
  if (!url) {
    return {
      ok: false,
      reason: "no_checkout_url",
      detail: "CHECKOUT_URL is not set, or is not a valid https URL.",
    };
  }

  const explicit = explicitProvider();
  const inferred = providerFromUrl(url);
  if (explicit && inferred && explicit !== inferred) {
    return {
      ok: false,
      reason: "provider_mismatch",
      detail:
        `PAYMENT_PROVIDER is "${explicit}" but CHECKOUT_URL is a ${inferred} link. Every purchase ` +
        `would reach the webhook as a ${inferred} delivery. Set PAYMENT_PROVIDER=${inferred}, or ` +
        `remove it and the provider is taken from the link.`,
    };
  }

  const provider = explicit ?? inferred ?? "gumroad";
  if (!webhookSecretConfigured(provider)) {
    return {
      ok: false,
      reason: "webhook_unverifiable",
      detail:
        `Checkout is a ${provider} link but ${webhookSecretVar(provider)} is not set, so the ` +
        `webhook would reject every purchase and nobody who paid would get access.`,
    };
  }

  // Lemon Squeezy is the only provider whose overlay this app drives. The
  // others keep the full-page redirect.
  return { ok: true, url, provider, embed: provider === "lemonsqueezy" };
}

/**
 * Which provider a webhook delivery came from, read from the delivery rather
 * than from configuration. Each provider signs with its own header, so this
 * only chooses WHICH verification runs - every path still requires its own
 * secret and fails closed without it, so an attacker who sets these headers
 * gains nothing but a choice of which door to be refused at.
 */
export function detectDeliveryProvider(headers: { get(name: string): string | null }): Provider {
  if (headers.get("paddle-signature")) return "paddle";
  if (headers.get("x-signature")) return "lemonsqueezy";
  return "gumroad";
}
