import { NextRequest, NextResponse } from "next/server";
import { countInWindow, recordCspViolation } from "@/lib/redis";

/**
 * Where browsers report what the Content-Security-Policy blocked
 * (src/lib/csp.ts). Each report is reduced to one short "kind" and counted
 * per day; GET /api/stats returns the counts. Nothing about the visitor is
 * kept, and nothing from the report is stored verbatim.
 *
 * The policy uses report-uri, whose body is {"csp-report": {...}} in every
 * browser. The Reporting API's batched array is accepted too, so switching
 * the policy to report-to later needs no change here.
 *
 * Public by necessity, so it is built to be dull to abuse: it always answers
 * 204, it reads a bounded body, it counts only reports about this site's own
 * pages, each visitor gets a small budget per minute, and the number of
 * distinct kinds per day is capped in recordCspViolation.
 */

const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTS_PER_REQUEST = 10;
const REQUESTS_PER_MINUTE = 30;

const KNOWN_PAGES = new Set([
  "/", "/the-index", "/success", "/terms", "/privacy", "/dmca", "/login", "/auth/verify", "/unsubscribe",
]);
const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "trusted-types-policy", "trusted-types-sink", "self"]);

interface RawReport {
  documentUrl?: unknown;
  blocked?: unknown;
  directive?: unknown;
  disposition?: unknown;
  sourceFile?: unknown;
}

const noContent = () => new NextResponse(null, { status: 204 });
const str = (v: unknown) => (typeof v === "string" ? v : "");
const isExtension = (url: string) => /^(chrome|moz|safari-web|ms-browser)-extension:|^chrome:/i.test(url);

function pageOf(documentUrl: string, ownOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(documentUrl);
  } catch {
    return null;
  }
  // Only this site's own pages. Anyone can point a policy at this endpoint.
  if (url.origin !== ownOrigin) return null;
  if (url.pathname.startsWith("/scan/")) return "/scan/[id]";
  return KNOWN_PAGES.has(url.pathname) ? url.pathname : "other";
}

function blockedKind(blocked: string): string {
  if (!blocked) return "inline";
  const lower = blocked.toLowerCase();
  if (KEYWORDS.has(lower)) return lower;
  for (const scheme of ["data", "blob", "about", "filesystem"]) if (lower.startsWith(`${scheme}:`) || lower === scheme) return scheme;
  try {
    return new URL(blocked).origin;
  } catch {
    return "other";
  }
}

function toKind(report: RawReport, ownOrigin: string): string | null {
  const blocked = str(report.blocked);
  if (isExtension(blocked) || isExtension(str(report.sourceFile))) return null; // a browser extension, not the site
  const page = pageOf(str(report.documentUrl), ownOrigin);
  if (!page) return null;
  const directive = str(report.directive).split(" ")[0].toLowerCase();
  if (!/^[a-z-]{3,40}$/.test(directive)) return null;
  const disposition = report.disposition === "report" ? "report" : "enforce";
  return `${disposition} ${directive} ${blockedKind(blocked)} ${page}`.slice(0, 200);
}

function parse(body: unknown): RawReport[] {
  if (Array.isArray(body)) {
    return body
      .filter(r => r && typeof r === "object" && (r as { type?: unknown }).type === "csp-violation")
      .map(r => {
        const b = ((r as { body?: unknown }).body || {}) as Record<string, unknown>;
        return {
          documentUrl: b.documentURL ?? (r as { url?: unknown }).url,
          blocked: b.blockedURL,
          directive: b.effectiveDirective,
          disposition: b.disposition,
          sourceFile: b.sourceFile,
        };
      });
  }
  const legacy = (body as { "csp-report"?: Record<string, unknown> } | null)?.["csp-report"];
  if (!legacy || typeof legacy !== "object") return [];
  return [{
    documentUrl: legacy["document-uri"],
    blocked: legacy["blocked-uri"],
    directive: legacy["effective-directive"] || legacy["violated-directive"],
    disposition: legacy.disposition,
    sourceFile: legacy["source-file"],
  }];
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: NextRequest) {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return noContent();
    const kinds = parse(JSON.parse(text))
      .slice(0, MAX_REPORTS_PER_REQUEST)
      .map(r => toKind(r, req.nextUrl.origin))
      .filter((k): k is string => !!k);
    if (kinds.length === 0) return noContent();
    if ((await countInWindow("csp-report", clientIp(req), 60)) > REQUESTS_PER_MINUTE) return noContent();
    for (const kind of kinds) await recordCspViolation(kind);
  } catch {
    /* malformed, or Redis unreachable: a report is never worth an error */
  }
  return noContent();
}
