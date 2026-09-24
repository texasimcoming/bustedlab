import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { getScanRecord, getProductAggregate, getRecentRecords, type ScanRecord } from "@/lib/redis";
import { recordToVerdictData, recordHeadline, VERDICT_COLOR, VERDICT_LABEL } from "@/lib/scan-record-view";
import SharedVerdict from "@/components/SharedVerdict";

/**
 * THE PERMANENT PAGE.
 *
 * Before this existed, a shared verdict was a PNG. A PNG cannot be clicked,
 * cannot be indexed, cannot be attributed and cannot lead anywhere, so the
 * growth loop terminated at the exact moment it was working: someone posts
 * their BUSTED card, thousands of people see it, and not one of them has a
 * path back to the scanner. The loop leaked at its last step.
 *
 * Every verified verdict now has an address. The share sheet carries a link
 * alongside the image, the link opens THIS page with THAT verdict rendered,
 * the link preview shows a generated card specific to this scan rather than a
 * generic marketing image, and the page ends in a scanner. Every share becomes
 * an entry point, and the ledger generates indexable pages from real
 * measurements at a rate no content team can match.
 *
 * Records are immutable, so the page is cached for an hour and served from the
 * edge. A card that goes viral costs one Redis read per hour, not one per
 * visitor.
 */

export const revalidate = 3600;
export const dynamicParams = true;

// ── Read-through caching, and it is a cost decision rather than a nicety. ──
//
// A ledger record is immutable: once written it never changes. Without this,
// every visitor to a shared card costs one Redis round trip, so a single post
// that does what this product is designed to do turns a viral moment into a
// per-impression bill and a per-impression latency. Setting `revalidate` on
// the segment alone was not enough, because the Upstash client's own fetch
// opts the route into dynamic rendering, so the data is cached explicitly.
//
// One hour on the record (immutable, so the number is arbitrary and could be
// far longer) and five minutes on the recent-findings rail, which is shared
// across every scan page and therefore the single hottest read on the site.
const cachedRecord = unstable_cache(
  async (id: string) => getScanRecord(id),
  ["scan-record"],
  { revalidate: 3600, tags: ["scan-record"] }
);

const cachedAggregate = unstable_cache(
  async (productKey: string) => getProductAggregate(productKey),
  ["scan-aggregate"],
  { revalidate: 600 }
);

const cachedRecent = unstable_cache(
  async () => getRecentRecords(6),
  ["scan-recent"],
  { revalidate: 300 }
);

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const record = await cachedRecord(id);

  if (!record) {
    return { title: "Scan not found", robots: { index: false, follow: false } };
  }

  const headline = recordHeadline(record);
  const description =
    record.verdict === "FAIR"
      ? `Verified scan: this product lists at $${record.wholesalePrice.toFixed(2)} against a $${record.retailPrice.toFixed(2)} asking price. Scan any product at BustedLab.`
      : `Verified scan: the same product lists at $${record.wholesalePrice.toFixed(2)}. The asking price was $${record.retailPrice.toFixed(2)}. Gap of $${record.savings.toFixed(2)}.`;

  return {
    title: headline,
    description,
    alternates: { canonical: `/scan/${id}` },
    openGraph: {
      title: headline,
      description,
      url: `/scan/${id}`,
      type: "article",
      // opengraph-image.tsx in this folder generates the card for THIS scan.
    },
    twitter: { card: "summary_large_image", title: headline, description },
  };
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card" style={{ borderRadius: "10px", padding: "12px 14px" }}>
      <div style={{
        fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "9px",
        letterSpacing: "1.4px", color: "var(--text-3)", textTransform: "uppercase", marginBottom: "5px",
      }}>{label}</div>
      <div style={{
        fontFamily: "var(--font-display), sans-serif", fontSize: "17px", fontWeight: "700",
        color: color || "var(--text)", letterSpacing: "-0.5px", lineHeight: "1.2",
      }}>{value}</div>
    </div>
  );
}

function RelatedRow({ record }: { record: ScanRecord }) {
  return (
    <Link
      href={`/scan/${record.id}`}
      className="card panel"
      style={{
        display: "flex", alignItems: "center", gap: "12px", padding: "11px 13px",
        borderRadius: "10px", textDecoration: "none",
      }}
    >
      <div style={{
        width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0,
        background: VERDICT_COLOR[record.verdict],
        boxShadow: `0 0 6px ${VERDICT_COLOR[record.verdict]}`,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: "12.5px", color: "var(--text-2)", lineHeight: "1.4",
          overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
        }}>{record.title}</div>
      </div>
      <div style={{
        fontFamily: "var(--font-display), sans-serif", fontSize: "13px", fontWeight: "700",
        color: VERDICT_COLOR[record.verdict], flexShrink: 0, letterSpacing: "-0.3px",
      }}>
        {record.verdict === "FAIR" ? "FAIR" : `$${record.savings.toFixed(2)}`}
      </div>
    </Link>
  );
}

export default async function ScanPage({ params }: Props) {
  const { id } = await params;
  const record = await cachedRecord(id);
  if (!record) notFound();

  const [aggregate, recent] = await Promise.all([
    cachedAggregate(record.productKey),
    cachedRecent(),
  ]);

  const related = recent.filter(r => r.id !== record.id).slice(0, 4);
  const scannedAt = new Date(record.ts).toISOString();
  const timestamp = `${scannedAt.slice(0, 10)} ${scannedAt.slice(11, 19)} UTC`;

  // Only surfaced once a product has genuinely been scanned more than once.
  // "Scanned 1 time" is noise, and an average built from one sample is not an
  // average.
  const repeatScans = aggregate && aggregate.count > 1 ? aggregate : null;

  return (
    <main style={{ position: "relative", zIndex: 1, minHeight: "100vh", fontFamily: "var(--font-sans), sans-serif" }}>
      <nav style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 24px", position: "relative", zIndex: 2, borderBottom: "1px solid var(--border)",
      }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "9px", textDecoration: "none" }}>
          {/* Fixed 32px mark; next/image would add an optimizer round trip for
              an asset never rendered at another size. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="BustedLab" width={40} height={40} style={{ borderRadius: "9px", display: "block", objectFit: "cover" }} />
          <span style={{
            fontFamily: "var(--font-display), sans-serif", fontWeight: "800",
            fontSize: "20px", letterSpacing: "-0.5px", color: "var(--text)",
          }}>BustedLab</span>
        </Link>
        <Link href="/" className="btn-primary" style={{
          borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: "600",
          fontFamily: "var(--font-display), sans-serif", textDecoration: "none",
        }}>
          Scan a product
        </Link>
      </nav>

      <div style={{ maxWidth: "520px", margin: "0 auto", padding: "20px 24px 64px", position: "relative", zIndex: 2 }}>
        <div style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "9px",
          letterSpacing: "2px", color: "rgba(184,160,232,0.35)", textTransform: "uppercase",
          marginBottom: "14px", textAlign: "center",
        }}>
          ARCHIVED SCAN RECORD
        </div>

        <SharedVerdict data={recordToVerdictData(record)} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "16px" }}>
          <Stat label="Asking price" value={`$${record.retailPrice.toFixed(2)}`} color="#ef4444" />
          <Stat label="Market price" value={`$${record.wholesalePrice.toFixed(2)}`} color="#10d9a0" />
          <Stat label="Markup" value={`${record.markup.toLocaleString()}%`} color={VERDICT_COLOR[record.verdict]} />
          <Stat label="Gap" value={`$${record.savings.toFixed(2)}`} color={VERDICT_COLOR[record.verdict]} />
        </div>

        <div style={{
          marginTop: "10px", padding: "13px 15px", borderRadius: "10px",
          background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)",
          display: "flex", flexDirection: "column", gap: "7px",
        }}>
          {[
            ["Verdict", VERDICT_LABEL[record.verdict]],
            ["Category", record.category],
            ["Source", record.platform || "unknown"],
            ["Recorded", timestamp],
            ...(repeatScans
              ? ([[
                  "Times scanned",
                  `${repeatScans.count.toLocaleString()}, averaging ${Math.round(repeatScans.sumMarkup / repeatScans.count).toLocaleString()}% markup`,
                ]] as [string, string][])
              : []),
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: "14px", fontSize: "11.5px" }}>
              <span style={{
                fontFamily: "var(--font-mono), ui-monospace, monospace",
                color: "var(--text-3)", letterSpacing: "0.5px", textTransform: "uppercase", fontSize: "9.5px", paddingTop: "2px",
              }}>{label}</span>
              <span style={{ color: "var(--text-2)", textAlign: "right" }}>{value}</span>
            </div>
          ))}
        </div>

        {record.sourceUrl && (
          <a
            href={record.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            style={{
              display: "block", width: "100%", padding: "12px", borderRadius: "10px",
              fontSize: "13px", textAlign: "center", textDecoration: "none", fontWeight: "500",
              marginTop: "10px", color: "var(--text-2)", border: "1px solid var(--border-mid)",
            }}
          >
            View the listing this was measured against
          </a>
        )}

        <div style={{
          marginTop: "22px", borderRadius: "14px", padding: "22px 20px", textAlign: "center",
          background: "linear-gradient(135deg, rgba(123,94,167,0.1) 0%, rgba(123,94,167,0.02) 100%)",
          border: "1px solid rgba(123,94,167,0.18)",
        }}>
          <h2 style={{
            fontFamily: "var(--font-display), sans-serif", fontSize: "19px", fontWeight: "800",
            letterSpacing: "-0.6px", marginBottom: "6px", color: "var(--text)",
          }}>
            Check the one you were about to buy
          </h2>
          <p style={{ color: "var(--text-2)", fontSize: "13px", lineHeight: "1.6", marginBottom: "16px" }}>
            Drop a link or a screenshot. Two free scans a day, no account.
          </p>
          <Link href="/" className="btn-primary" style={{
            display: "inline-block", padding: "12px 30px", borderRadius: "10px",
            fontSize: "14px", fontWeight: "700", fontFamily: "var(--font-display), sans-serif",
            textDecoration: "none",
          }}>
            Run a scan
          </Link>
        </div>

        {related.length > 0 && (
          <div style={{ marginTop: "26px" }}>
            <div style={{
              fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "9px",
              letterSpacing: "2px", color: "rgba(184,160,232,0.35)",
              textTransform: "uppercase", marginBottom: "10px",
            }}>
              RECENT FINDINGS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {related.map(r => <RelatedRow key={r.id} record={r} />)}
            </div>
          </div>
        )}

        <p style={{
          fontSize: "10px", color: "rgba(238,238,246,0.2)", lineHeight: "1.6",
          marginTop: "26px", textAlign: "center",
        }}>
          Market analysis based on publicly available listings for the identified product at the
          time of the scan. Prices change. Results are editorial market analysis, not verified
          statements about any specific product or brand.{" "}
          <Link href="/terms" style={{ color: "rgba(184,160,232,0.45)", textDecoration: "none" }}>Terms</Link>
        </p>
      </div>
    </main>
  );
}
