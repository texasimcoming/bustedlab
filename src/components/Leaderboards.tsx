"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadLeaderboard } from "@/lib/leaderboard-client";

/**
 * THE BOARDS.
 *
 * Three things the dataset can say that a lookup tool cannot say at all: what
 * everyone is checking this week, the worst thing ever measured, and which
 * corner of the consumer economy carries the steepest spread. Numbers like
 * these are the reason a visitor stops and reads instead of scanning once and
 * leaving, because they are evidence of a machine that has been watching for a
 * while rather than a form that answers a question.
 *
 * Every figure is read from the ledger. Nothing here is seeded, and a board
 * with no data behind it does not render at all: an empty leaderboard tells a
 * visitor exactly how new this is, which is the one thing the brand cannot
 * afford to say.
 */

interface TrendingRow { title: string; scans: number; maxMarkup: number; id: string }
interface MarkupRow { title: string; markup: number; savings: number; id: string }
interface CategoryRow { category: string; averageMarkup: number; count: number }

interface Boards {
  ledgerSize: number;
  trending: TrendingRow[];
  topMarkup: MarkupRow[];
  categories: CategoryRow[];
}

type BoardKey = "markup" | "trending" | "category";

const TABS: { key: BoardKey; label: string }[] = [
  { key: "markup", label: "Worst ever" },
  { key: "trending", label: "Checked most" },
  { key: "category", label: "By category" },
];

function Rank({ n }: { n: number }) {
  return (
    <span style={{
      fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px",
      color: n <= 3 ? "var(--accent-bright)" : "var(--text-3)",
      width: "18px", flexShrink: 0, textAlign: "right",
    }}>{n}</span>
  );
}

function RowShell({ children, href }: { children: React.ReactNode; href?: string }) {
  const style: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: "10px",
    padding: "12px 14px", borderRadius: "12px", textDecoration: "none",
    background: "rgba(255,255,255,0.022)", border: "1px solid var(--border)",
  };
  return href
    ? <Link href={href} className="panel" style={style}>{children}</Link>
    : <div style={style}>{children}</div>;
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      flex: 1, minWidth: 0, fontSize: "13px", color: "var(--text)", lineHeight: "1.4",
      overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
    }}>{children}</span>
  );
}

function Value({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      fontFamily: "var(--font-display), sans-serif", fontSize: "14px", fontWeight: "700",
      color: color || "var(--text)", flexShrink: 0, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums",
    }}>{children}</span>
  );
}

export default function Leaderboards() {
  const [boards, setBoards] = useState<Boards | null>(null);
  const [tab, setTab] = useState<BoardKey>("markup");

  useEffect(() => {
    let cancelled = false;
    loadLeaderboard<Boards>()
      .then(data => { if (!cancelled) setBoards(data); })
      .catch(() => { /* no boards, no section */ });
    return () => { cancelled = true; };
  }, []);

  if (!boards) return null;

  const has: Record<BoardKey, boolean> = {
    markup: boards.topMarkup?.length > 0,
    trending: boards.trending?.length > 0,
    category: boards.categories?.length > 0,
  };
  const usable = TABS.filter(t => has[t.key]);
  if (usable.length === 0) return null;

  const active = has[tab] ? tab : usable[0].key;

  return (
    <section className="section reveal">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "14px" }}>
        <div className="label" style={{ marginBottom: 0, flex: 1 }}>
          THE BOARDS
        </div>
        <Link href="/the-index" style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px",
          letterSpacing: "1px", color: "var(--accent-bright)", textDecoration: "none", textTransform: "uppercase",
          // A 15px-tall link was the smallest target on the page; the padding
          // makes it tappable without moving the label.
          padding: "14px 0 14px 12px", margin: "-14px 0",
        }}>
          Full index &rarr;
        </Link>
      </div>

      <div style={{ display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap" }}>
        {usable.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="panel"
            aria-pressed={active === t.key}
            style={{
              borderRadius: "999px", padding: "10px 16px", cursor: "pointer",
              fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px",
              letterSpacing: "0.6px", textTransform: "uppercase",
              color: active === t.key ? "#ece5ff" : "var(--text-3)",
              borderColor: active === t.key ? "rgba(169,147,255,0.6)" : "var(--border-mid)",
              background: active === t.key ? "rgba(138,111,240,0.16)" : undefined,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        {active === "markup" && boards.topMarkup.map((r, i) => (
          <RowShell key={r.id} href={`/scan/${r.id}`}>
            <Rank n={i + 1} />
            <Title>{r.title}</Title>
            <Value color="#ff6b79">{r.markup.toLocaleString("en-US")}%</Value>
          </RowShell>
        ))}

        {active === "trending" && boards.trending.map((r, i) => (
          <RowShell key={r.id || r.title} href={r.id ? `/scan/${r.id}` : undefined}>
            <Rank n={i + 1} />
            <Title>{r.title}</Title>
            <Value>{r.scans.toLocaleString("en-US")}<span style={{ color: "var(--text-3)", fontWeight: 400 }}> scans</span></Value>
          </RowShell>
        ))}

        {active === "category" && boards.categories.map((r, i) => (
          <RowShell key={r.category}>
            <Rank n={i + 1} />
            <Title>
              <span style={{ textTransform: "capitalize" }}>{r.category}</span>
              <span style={{ color: "var(--text-3)", fontSize: "11px" }}> &middot; {r.count} measured</span>
            </Title>
            <Value color="#f59e0b">{r.averageMarkup.toLocaleString("en-US")}% avg</Value>
          </RowShell>
        ))}
      </div>

      <p style={{
        fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px",
        color: "var(--text-2)", marginTop: "10px", letterSpacing: "0.4px", lineHeight: "1.6",
      }}>
        {active === "trending"
          ? "MOST CHECKED THIS WEEK. RESETS MONDAY."
          : active === "category"
            ? "AVERAGE MEASURED MARKUP. MINIMUM FIVE SCANS PER CATEGORY."
            : "STEEPEST MARKUPS EVER MEASURED. ONE ROW PER PRODUCT."}
      </p>
    </section>
  );
}
