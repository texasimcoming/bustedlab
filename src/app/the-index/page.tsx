import type { Metadata } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { getIndexEntries, getRecordsSince, countByCategory, CATEGORIES, type IndexEntry } from "@/lib/redis";
import { VERDICT_COLOR, VERDICT_LABEL } from "@/lib/scan-record-view";
import SoundToggle from "@/components/SoundToggle";

/**
 * THE PUBLIC INDEX, served at /the-index.
 *
 * NOT at /index, and this is not a preference. Next.js normalizes the request
 * path /index to / before routing, a behaviour inherited from the Pages Router
 * where pages/index.js was the root. An app/index/page.tsx builds without
 * complaint, appears in the route manifest, and is then unreachable forever:
 * every request to /index silently renders the homepage instead. The page
 * would have shipped, indexed nothing, and looked like it worked.
 *
 * The ledger was write-only. Every measurement the engine made was stored and
 * then seen by exactly one person, which is a dataset that persuades nobody
 * and proves nothing. This is the page that makes it an instrument: the
 * steepest markups measured in the last thirty days, ranked, filterable, every
 * row linking to the permanent record behind it.
 *
 * It is also the search surface. Each row is a real product someone is
 * Googling right now to find out whether they are being overcharged, and each
 * one links to a page that answers exactly that question with a measurement
 * rather than an opinion. That is an SEO engine that cannot be bought, only
 * accumulated.
 *
 * Nothing on this page is generated, seeded or illustrative. Every row is a
 * verified scan record. When the ledger is empty, the page says so.
 */

export const revalidate = 60;

const WINDOW_DAYS = 30;

const cachedIndex = unstable_cache(
  async (category?: string) => getIndexEntries({ days: WINDOW_DAYS, category, limit: 60 }),
  ["public-index"],
  { revalidate: 60 }
);

const cachedCategoryCounts = unstable_cache(
  async () => {
    const records = await getRecordsSince(Date.now() - WINDOW_DAYS * 86400000);
    return countByCategory(records.filter(r => !r.cached));
  },
  ["public-index-categories"],
  { revalidate: 300 }
);

export const metadata: Metadata = {
  title: "The Index: every markup we have measured",
  description:
    "A live index of the steepest product markups verified in the last 30 days. Real prices, real sources, every entry backed by a permanent scan record.",
  alternates: { canonical: "/the-index" },
  openGraph: {
    title: "The Index: every markup we have measured",
    description: "The steepest product markups verified in the last 30 days. Every entry is a real scan.",
    url: "/the-index",
    type: "website",
  },
};

type Props = { searchParams: Promise<{ category?: string }> };

function Row({ entry, rank }: { entry: IndexEntry; rank: number }) {
  const color = VERDICT_COLOR[entry.verdict];
  return (
    <Link
      href={`/scan/${entry.id}`}
      className="card panel"
      style={{
        display: "flex", alignItems: "center", gap: "12px",
        padding: "13px 14px", borderRadius: "11px", textDecoration: "none",
      }}
    >
      <div style={{
        fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px",
        color: "var(--text-3)", width: "22px", flexShrink: 0, textAlign: "right",
      }}>
        {rank}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: "13px", color: "var(--text)", lineHeight: "1.4", marginBottom: "4px",
          overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
        }}>
          {entry.title}
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
          fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "9.5px",
          color: "var(--text-3)", letterSpacing: "0.5px", textTransform: "uppercase",
        }}>
          <span style={{ color }}>{VERDICT_LABEL[entry.verdict]}</span>
          <span>{entry.category}</span>
          <span>${entry.wholesalePrice.toFixed(2)} vs ${entry.retailPrice.toFixed(2)}</span>
          {entry.scanCount > 1 && <span>scanned {entry.scanCount}x</span>}
        </div>
      </div>

      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{
          fontFamily: "var(--font-display), sans-serif", fontSize: "17px", fontWeight: "800",
          color, letterSpacing: "-0.5px", lineHeight: "1.15",
        }}>
          {entry.markup.toLocaleString()}%
        </div>
        <div style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "9.5px",
          color: "var(--text-3)", marginTop: "2px",
        }}>
          ${entry.savings.toFixed(2)}
        </div>
      </div>
    </Link>
  );
}

export default async function IndexPage({ searchParams }: Props) {
  const { category: raw } = await searchParams;
  const category = raw && (CATEGORIES as readonly string[]).includes(raw) ? raw : undefined;

  const [entries, counts] = await Promise.all([
    cachedIndex(category),
    cachedCategoryCounts(),
  ]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const available = CATEGORIES.filter(c => (counts[c] || 0) > 0);

  return (
    <main style={{ position: "relative", zIndex: 1, minHeight: "100vh", fontFamily: "var(--font-sans), sans-serif" }}>
      <nav style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 24px", position: "relative", zIndex: 2, borderBottom: "1px solid var(--border)",
      }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "9px", textDecoration: "none" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="BustedLab" width={32} height={32} style={{ borderRadius: "8px", display: "block", objectFit: "cover" }} />
          <span style={{
            fontFamily: "var(--font-display), sans-serif", fontWeight: "700",
            fontSize: "16px", letterSpacing: "-0.4px", color: "var(--text)",
          }}>BustedLab</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <SoundToggle />
          <Link href="/" className="btn-primary" style={{
            borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: "600",
            fontFamily: "var(--font-display), sans-serif", textDecoration: "none",
          }}>
            Scan a product
          </Link>
        </div>
      </nav>

      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "28px 24px 70px", position: "relative", zIndex: 2 }}>
        <div style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px",
          letterSpacing: "2.4px", color: "rgba(184,160,232,0.4)", textTransform: "uppercase", marginBottom: "12px",
        }}>
          THE INDEX &middot; LAST {WINDOW_DAYS} DAYS
        </div>

        <h1 style={{
          fontFamily: "var(--font-display), sans-serif", fontSize: "clamp(26px,5vw,38px)",
          fontWeight: "800", letterSpacing: "-1.2px", lineHeight: "1.1",
          color: "var(--text)", marginBottom: "12px",
        }}>
          Everything we have caught
        </h1>

        <p style={{ fontSize: "14.5px", color: "var(--text-2)", lineHeight: "1.65", marginBottom: "20px" }}>
          {total > 0
            ? `${total.toLocaleString()} verified measurements in the last ${WINDOW_DAYS} days, ranked by how far the asking price sits above the market. Every row links to the record behind it.`
            : `Verified measurements appear here the moment they are made. Nothing on this page is seeded, estimated or illustrative, so it stays empty until the scans are real.`}
        </p>

        {available.length > 0 && (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "18px" }}>
            <Link
              href="/the-index"
              className="panel"
              style={{
                borderRadius: "20px", padding: "6px 14px", textDecoration: "none",
                fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10.5px",
                letterSpacing: "0.6px", textTransform: "uppercase",
                color: !category ? "var(--accent-bright)" : "var(--text-3)",
                borderColor: !category ? "var(--accent-2)" : "var(--border-mid)",
              }}
            >
              All {total}
            </Link>
            {available.map(c => (
              <Link
                key={c}
                href={`/the-index?category=${c}`}
                className="panel"
                style={{
                  borderRadius: "20px", padding: "6px 14px", textDecoration: "none",
                  fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10.5px",
                  letterSpacing: "0.6px", textTransform: "uppercase",
                  color: category === c ? "var(--accent-bright)" : "var(--text-3)",
                  borderColor: category === c ? "var(--accent-2)" : "var(--border-mid)",
                }}
              >
                {c} {counts[c]}
              </Link>
            ))}
          </div>
        )}

        {entries.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {entries.map((e, i) => <Row key={e.id} entry={e} rank={i + 1} />)}
          </div>
        ) : (
          <div className="card" style={{ borderRadius: "12px", padding: "34px 24px", textAlign: "center" }}>
            <div style={{
              fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "10px",
              letterSpacing: "2px", color: "var(--text-3)", textTransform: "uppercase", marginBottom: "10px",
            }}>
              NO RECORDS IN THIS WINDOW
            </div>
            <p style={{ fontSize: "13.5px", color: "var(--text-2)", lineHeight: "1.6", marginBottom: "18px" }}>
              {category
                ? "Nothing measured in this category yet."
                : "The index fills itself. Every confirmed verdict lands here automatically."}
            </p>
            <Link href="/" className="btn-primary" style={{
              display: "inline-block", padding: "11px 26px", borderRadius: "10px",
              fontSize: "13.5px", fontWeight: "700",
              fontFamily: "var(--font-display), sans-serif", textDecoration: "none",
            }}>
              Add the first one
            </Link>
          </div>
        )}

        <div style={{
          marginTop: "26px", borderRadius: "14px", padding: "22px 20px", textAlign: "center",
          background: "linear-gradient(135deg, rgba(123,94,167,0.1) 0%, rgba(123,94,167,0.02) 100%)",
          border: "1px solid rgba(123,94,167,0.18)",
        }}>
          <h2 style={{
            fontFamily: "var(--font-display), sans-serif", fontSize: "19px", fontWeight: "800",
            letterSpacing: "-0.6px", marginBottom: "6px", color: "var(--text)",
          }}>
            Your product is not on this list yet
          </h2>
          <p style={{ color: "var(--text-2)", fontSize: "13px", lineHeight: "1.6", marginBottom: "16px" }}>
            Drop a link or a screenshot. Whatever it finds goes in the index.
          </p>
          <Link href="/" className="btn-primary" style={{
            display: "inline-block", padding: "12px 30px", borderRadius: "10px",
            fontSize: "14px", fontWeight: "700", fontFamily: "var(--font-display), sans-serif",
            textDecoration: "none",
          }}>
            Run a scan
          </Link>
        </div>

        <p style={{ fontSize: "10px", color: "rgba(238,238,246,0.2)", lineHeight: "1.6", marginTop: "24px", textAlign: "center" }}>
          Every entry is a real scan record. Market analysis based on publicly available listings at the
          time of each scan; prices change. Results are editorial market analysis, not verified statements
          about any specific product or brand.{" "}
          <Link href="/terms" style={{ color: "rgba(184,160,232,0.45)", textDecoration: "none" }}>Terms</Link>
        </p>
      </div>
    </main>
  );
}
