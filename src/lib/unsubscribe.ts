import crypto from "crypto";

/**
 * SIGNED UNSUBSCRIBE LINKS for the product update list.
 *
 * Removing an address used to need nothing but the address: DELETE
 * /api/notify?email=anyone@example.com took anyone off the list. Now a
 * removal needs a token only this server can mint for that address, carried
 * in the link each update email includes.
 *
 * The token never expires, on purpose: an unsubscribe link in a two-year-old
 * email has to work. So the secret behind it must not change once list mail
 * has gone out. Set UNSUBSCRIBE_SECRET before the first send and never
 * rotate it; without it, IDENTITY_SALT is used, and rotating that (which
 * also resets rate limits) would break every unsubscribe link already sent.
 *
 * Sending list mail: put unsubscribeUrl(email) in the body and
 * oneClickUnsubscribeHeaders(email) on the message. The headers are the
 * RFC 8058 one-click form Gmail and Yahoo require of bulk senders; the mail
 * client POSTs to the link and the address is removed with no page visit.
 */

function secret(): string | null {
  return process.env.UNSUBSCRIBE_SECRET || process.env.IDENTITY_SALT || null;
}

const normalize = (email: string) => email.toLowerCase().trim();

/** The token for an address, or null if no secret is configured. */
export function unsubscribeToken(email: string): string | null {
  const key = secret();
  if (!key) return null;
  return crypto.createHmac("sha256", key).update(`unsubscribe:${normalize(email)}`).digest("hex").slice(0, 32);
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = unsubscribeToken(email);
  if (!expected || token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function linkQuery(email: string): string | null {
  const token = unsubscribeToken(email);
  if (!token) return null;
  return new URLSearchParams({ email: normalize(email), token }).toString();
}

/** The link for the body of a list email: a page that asks before removing. */
export function unsubscribeUrl(email: string): string | null {
  const query = linkQuery(email);
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return query && base ? `${base}/unsubscribe?${query}` : null;
}

/** RFC 8058 headers for a list email. */
export function oneClickUnsubscribeHeaders(email: string): Record<string, string> | null {
  const query = linkQuery(email);
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!query || !base) return null;
  return {
    "List-Unsubscribe": `<${base}/api/notify/unsubscribe?${query}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
