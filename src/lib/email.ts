/**
 * The From line on every email this app sends: access emails after a
 * purchase and sign-in links. Its domain has to be verified in Resend, or
 * Resend refuses every send - and a refused access email is a customer who
 * paid and heard nothing. GET /api/preflight checks the domain's status.
 */
const DEFAULT_FROM = "BustedLab <access@bustedlab.com>";

export function emailFrom(): string {
  return (process.env.EMAIL_FROM || "").trim() || DEFAULT_FROM;
}

/** The domain part of the From address, lower-cased, or null if malformed. */
export function emailFromDomain(): string | null {
  const match = emailFrom().match(/@([a-z0-9.-]+)>?\s*$/i);
  return match ? match[1].toLowerCase() : null;
}
