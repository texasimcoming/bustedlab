import crypto from "crypto";
import type { NextRequest } from "next/server";

/**
 * The operator endpoints - /api/stats and /api/preflight - answer only a
 * bearer token matching ANALYTICS_TOKEN, compared in constant time. With no
 * token configured there is no way in at all, rather than a default that
 * somebody forgets to change.
 */
export function isOperator(req: NextRequest): boolean {
  const secret = process.env.ANALYTICS_TOKEN;
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
