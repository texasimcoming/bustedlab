"use client";
import { useState, useEffect, useRef } from "react";

/**
 * LIVE ACTIVITY, MADE OF FACTS.
 *
 * What was here before: a pool of forty first names, eighteen last initials,
 * twenty-nine cities and fifteen actions, combined at random every fourteen
 * to twenty-six seconds into toasts that read "Maya K. from London / busted
 * a markup". Three hundred thousand combinations of a person who does not
 * exist, presented in the present tense as something that had just happened.
 *
 * It took a `telemetry` prop full of real Redis counters and ignored it.
 *
 * That had to go, and not for squeamish reasons. This product's entire
 * argument is that the numbers it shows you are real and the seller's are
 * not. A fabricated activity feed on the same page as that argument is the
 * single most efficient way to lose it: one screenshot of an invented
 * customer next to a real markup claim and every real number on the site
 * becomes suspect. It is also the easiest thing in the world for a
 * journalist or a competitor to notice, because the names repeat.
 *
 * What replaces it is the same visual object driven by counters that
 * actually exist: scans in the last UTC hour, scans all time, the highest
 * markup any real scan has produced, the share of verdicts that came back
 * BUSTED, and the dollar total of overcharges exposed. Every one is a number
 * a visitor could be shown the source of.
 *
 * When there is no real data - a cold cache, a Redis outage, a brand new
 * deployment - this renders NOTHING. An empty corner is the honest state,
 * and it is strictly better than a placeholder that lies.
 */

interface Telemetry {
  totalScans?: number;
  totalSavings?: number;
  hourlyScans?: number;
  maxMarkup?: number;
  verdictsRecorded?: number;
  bustedRecorded?: number;
}

interface Fact {
  headline: string;
  detail: string;
}

// Only facts with something real behind them are built. Order is most
// immediate first, since "in the last hour" is the one that makes a quiet
// page feel alive without anyone having to invent a person to say it.
function buildFacts(t: Telemetry): Fact[] {
  const facts: Fact[] = [];

  if ((t.hourlyScans || 0) > 0) {
    const n = t.hourlyScans as number;
    facts.push({
      headline: `${n.toLocaleString()} ${n === 1 ? "scan" : "scans"} in the last hour`,
      detail: "counted server-side, UTC hour",
    });
  }

  if ((t.maxMarkup || 0) > 0) {
    facts.push({
      headline: `${(t.maxMarkup as number).toLocaleString()}% highest markup recorded`,
      detail: "the worst single result so far",
    });
  }

  if ((t.totalSavings || 0) > 0) {
    const dollars = t.totalSavings as number;
    const shown = dollars >= 1000
      ? `$${(dollars / 1000).toFixed(1)}K`
      : `$${Math.round(dollars).toLocaleString()}`;
    facts.push({ headline: `${shown} in overcharges exposed`, detail: "summed across every verdict" });
  }

  const verdicts = t.verdictsRecorded || 0;
  const busted = t.bustedRecorded || 0;
  // Only once there are enough verdicts for a percentage to mean anything.
  if (verdicts >= 20 && busted > 0) {
    facts.push({
      headline: `${Math.round((busted / verdicts) * 100)}% of scans come back BUSTED`,
      detail: `${busted.toLocaleString()} of ${verdicts.toLocaleString()} verdicts`,
    });
  }

  if ((t.totalScans || 0) > 0) {
    facts.push({
      headline: `${(t.totalScans as number).toLocaleString()} products scanned`,
      detail: "all time",
    });
  }

  return facts;
}

export default function LiveToast({ telemetry }: { telemetry?: Telemetry }) {
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const facts = buildFacts(telemetry || {});
  const count = facts.length;

  useEffect(() => {
    if (count === 0) return;
    let cycleTimer: ReturnType<typeof setTimeout>;

    const show = () => {
      setIndex(i => (i + 1) % count);
      setVisible(true);
      hideTimer.current = setTimeout(() => setVisible(false), 4200);
      // Random 14-26s interval, so the cadence is not a metronome. This is a
      // display choice; the content underneath it does not change with it.
      cycleTimer = setTimeout(show, Math.random() * 12000 + 14000);
    };

    const first = setTimeout(show, Math.random() * 4000 + 6000);

    return () => {
      clearTimeout(first);
      clearTimeout(cycleTimer);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [count]);

  if (count === 0 || !visible) return null;
  const fact = facts[index % count];

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
          {fact.headline}
        </div>
        <div style={{ fontSize: "11px", color: "var(--text-3)", marginTop: "1px" }}>
          {fact.detail}
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
