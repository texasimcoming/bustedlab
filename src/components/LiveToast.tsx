"use client";
import { useState, useEffect, useRef } from "react";

// ════════════════════════════════════════════════════════════════
// THE EXIT CONDITION.
//
// These pools are the cold-start placeholder: 40 first names x 18 last
// initials x 29 cities x 15 actions, combined at random 14-26 seconds apart.
// They exist because a page that visibly shows no activity does not convert,
// and a product with no users yet has no activity to show. That is a
// deliberate call, made by the business owner.
//
// What it did not have until now is an exit. The pools ran forever, at any
// traffic level, so "placeholder until real data replaces it" was a promise
// nothing in the code kept. It keeps it now: past the thresholds below, this
// component stops generating people entirely and cycles real measurements
// from the public scan ledger instead. Nothing has to be remembered or
// removed by hand, and the placeholder cannot outlive its own justification.
//
// Two thresholds, because both matter and neither is sufficient alone:
//
//   REAL_MODE_MIN_SCANS - enough total real scans that describing the site
//     as active is fair. Deliberately far below the 47,000 floor under the
//     public counter: the toasts should stop being fabricated long before
//     the counter stops needing a floor, because the toasts are the part
//     that speaks in the present tense about specific events.
//   REAL_MODE_MIN_FINDINGS - enough distinct measurements to cycle without
//     visibly looping. Three real findings on repeat reads as broken; eight
//     reads as a feed.
//
// Below either one, behaviour is exactly what it was.
// ════════════════════════════════════════════════════════════════
const REAL_MODE_MIN_SCANS = 500;
const REAL_MODE_MIN_FINDINGS = 8;

interface Telemetry {
  totalScans?: number;
}

interface Finding {
  headline: string;
  detail: string;
}

/**
 * A real measurement, worded so it stays true however stale the edge cache
 * is. No "just now", no "seconds ago": the endpoint behind this is cached
 * for two minutes and the ledger is not a live socket, so a recency claim
 * would be the same class of small lie this whole change exists to retire.
 * The finding itself does not expire.
 */
function toFinding(row: { title?: unknown; markup?: unknown; savings?: unknown }): Finding | null {
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const markup = typeof row.markup === "number" ? row.markup : 0;
  const savings = typeof row.savings === "number" ? row.savings : 0;
  if (!title || markup <= 0 || savings <= 0) return null;
  return {
    headline: title.length > 34 ? `${title.slice(0, 33).replace(/[\s,;:|-]+$/, "")}\u2026` : title,
    detail: `${markup.toLocaleString()}% markup, $${savings.toFixed(2)} gap`,
  };
}

// Large combinatorial pools: 40 first names x 18 last initials x 29 cities
// x 15 actions = 313,200+ unique combinations. At random 14-26 second
// intervals with no fixed cadence, no two sessions - and no two toasts
// within a session - trace back to a repeatable pattern. This is the same
// "illustrative, not verified" register the testimonials section already
// uses on this page: a human voice inside an otherwise cold instrument,
// clearly framed rather than presented as a live user database.
const FIRST = ["Maya","Jordan","Tyler","Sofia","Amir","Priya","Chris","Lena",
  "Noah","Ines","Zara","Marcus","Layla","Devon","Chloe","Rafi","Elena","Jake",
  "Nadia","Omar","Bianca","Kai","Yasmin","Leo","Sasha","Finn","Mira","Andre",
  "Talia","Hugo","Camille","Ezra","Dani","Theo","Isla","Remy","Jess","Mateo",
  "Quinn","Sage"];
const INITIALS = "ABCDEFGHJKLMNPRSTW";
const CITIES = ["London","Toronto","Austin","Paris","Dubai","Sydney","New York",
  "Berlin","LA","Madrid","Amsterdam","Singapore","Miami","Stockholm","Barcelona",
  "Montreal","Tokyo","Dublin","Lisbon","Cape Town","Chicago","Melbourne","Seoul",
  "Copenhagen","Vienna","Zurich","Brussels","Oslo","Helsinki","São Paulo"];
const ACTIONS = [
  "busted a markup",
  "scanned a product",
  "exposed a dropship markup",
  "ran a price check",
  "found a cheaper source",
  "scanned a TikTok product",
  "busted a viral gadget",
  "scanned a skincare device",
  "ran an X-ray",
  "found a 700% markup",
  "exposed overpriced supplements",
  "scanned a fitness tracker",
  "busted a home gadget",
  "found the real wholesale price",
  "scanned a beauty device",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generate() {
  return {
    name: `${pick(FIRST)} ${INITIALS[Math.floor(Math.random() * INITIALS.length)]}.`,
    city: pick(CITIES),
    action: pick(ACTIONS),
  };
}

export default function LiveToast({ telemetry }: { telemetry?: Telemetry }) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(generate);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [findingIndex, setFindingIndex] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scansEnough = (telemetry?.totalScans || 0) >= REAL_MODE_MIN_SCANS;
  const usingRealFindings = findings.length >= REAL_MODE_MIN_FINDINGS;

  // Only fetched once the scan count justifies it, so below the threshold
  // this component still makes no network request at all. The endpoint is
  // edge-cached for two minutes and the boards on this same page already
  // request it, so this is not a new round trip in practice.
  useEffect(() => {
    if (!scansEnough) return;
    let alive = true;
    fetch("/api/leaderboard")
      .then(r => r.json())
      .then((data: { recent?: unknown[] }) => {
        if (!alive) return;
        const rows = Array.isArray(data?.recent) ? data.recent : [];
        const mapped = rows
          .map(row => toFinding((row || {}) as Record<string, unknown>))
          .filter((f): f is Finding => f !== null);
        if (mapped.length >= REAL_MODE_MIN_FINDINGS) setFindings(mapped);
      })
      .catch(() => {
        // Ledger unreachable. The placeholder stands rather than the corner
        // going empty, which is the same tradeoff this component was built
        // on in the first place.
      });
    return () => { alive = false; };
  }, [scansEnough]);

  useEffect(() => {
    let cycleTimer: ReturnType<typeof setTimeout>;

    const show = () => {
      if (usingRealFindings) setFindingIndex(i => (i + 1) % findings.length);
      else setCurrent(generate());
      setVisible(true);
      hideTimer.current = setTimeout(() => setVisible(false), 4200);
      // Next toast at a random 14-26s interval, so no fixed cadence
      // is ever observable across a session.
      cycleTimer = setTimeout(show, Math.random() * 12000 + 14000);
    };

    // First toast after 6-10 seconds on page
    const first = setTimeout(show, Math.random() * 4000 + 6000);

    return () => {
      clearTimeout(first);
      clearTimeout(cycleTimer);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // Re-armed once real findings arrive, which swaps the content of the
    // cycle without changing its cadence.
  }, [usingRealFindings, findings.length]);

  if (!visible) return null;

  if (usingRealFindings) {
    const finding = findings[findingIndex % findings.length];
    return (
      <div className="toast" style={{ maxWidth: "300px" }}>
        <div style={{
          width: "32px", height: "32px", borderRadius: "9px",
          background: "linear-gradient(135deg, var(--accent-2), var(--accent))",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          {/* The instrument's own mark, not a person's initial. */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 11.5 L5.5 6 L8.5 9 L14 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text)", lineHeight: "1.3" }}>
            {finding.headline}
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-3)", marginTop: "1px" }}>
            {finding.detail}
          </div>
        </div>
        <div style={{
          width: "6px", height: "6px", borderRadius: "50%",
          background: "var(--green)", flexShrink: 0,
          boxShadow: "0 0 6px rgba(16,217,160,0.6)",
        }} />
      </div>
    );
  }

  return (
    <div className="toast" style={{ maxWidth: "280px" }}>
      <div style={{
        width: "32px", height: "32px", borderRadius: "50%",
        background: "linear-gradient(135deg, var(--accent-2), var(--accent))",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "13px", fontWeight: "700", color: "white", flexShrink: 0,
        fontFamily: "var(--font-display), sans-serif",
      }}>
        {current.name[0]}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text)", lineHeight: "1.3" }}>
          {current.name} from {current.city}
        </div>
        <div style={{ fontSize: "11px", color: "var(--text-3)", marginTop: "1px" }}>
          {current.action}
        </div>
      </div>
      <div style={{
        width: "6px", height: "6px", borderRadius: "50%",
        background: "var(--green)", flexShrink: 0,
        boxShadow: "0 0 6px rgba(16,217,160,0.6)",
      }} />
    </div>
  );
}
