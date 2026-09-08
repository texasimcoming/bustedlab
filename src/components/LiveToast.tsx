"use client";
import { useState, useEffect, useRef, useMemo } from "react";

/**
 * SIGNAL STRIP.
 *
 * This component used to invent people. It generated a random first name, a
 * random last initial, a random city and a random action, then told the
 * visitor that "Maya B. from London busted a markup" — an event that never
 * happened, attributed to a person who does not exist. Three problems, in
 * ascending order of seriousness:
 *
 *  1. Off-brand. The entire product is an argument that you are being lied
 *     to by people who want your money. Fabricating social proof to sell it
 *     is the exact behaviour BustedLab exists to expose, and a visitor who
 *     notices the same forty names cycling has been handed a reason to
 *     distrust every other number on the page.
 *  2. Legally exposed. Fabricated activity notifications are treated as
 *     deceptive practice by the FTC and by EU consumer-protection law
 *     (Annex I of the UCPD lists false claims about other consumers'
 *     behaviour among the practices that are unfair in all circumstances).
 *  3. Wrong voice. Names and cities are a growth-hack pattern. This brand
 *     speaks as an instrument, not as a shop floor.
 *
 * What replaced it reads the same visual slot but only ever states measured
 * facts pulled from the scan API's real counters. When there is no data
 * behind a line, the line does not render. Nothing here can be disproved by
 * anyone who checks, because everything here is a count of something that
 * actually happened.
 */

interface Signal {
  id: string;
  label: string;
  value: string;
}

interface Telemetry {
  totalScans?: number;
  totalSavings?: number;
  hourlyScans?: number;
  maxMarkup?: number;
  verdictsRecorded?: number;
  bustedRecorded?: number;
}

function buildSignals(t: Telemetry): Signal[] {
  const signals: Signal[] = [];

  if (typeof t.hourlyScans === "number" && t.hourlyScans > 0) {
    signals.push({
      id: "hourly",
      label: "SCANS THIS HOUR",
      value: t.hourlyScans.toLocaleString(),
    });
  }

  if (typeof t.maxMarkup === "number" && t.maxMarkup > 0) {
    signals.push({
      id: "peak",
      label: "HIGHEST MARKUP RECORDED",
      value: `${t.maxMarkup.toLocaleString()}%`,
    });
  }

  // Only shown once there is a real sample behind the ratio. A "0% of 0
  // scans" tile is worse than no tile.
  if (t.verdictsRecorded && t.verdictsRecorded >= 25 && typeof t.bustedRecorded === "number") {
    const rate = Math.round((t.bustedRecorded / t.verdictsRecorded) * 100);
    signals.push({
      id: "rate",
      label: "VERDICTS RETURNING BUSTED",
      value: `${rate}%`,
    });
  }

  if (typeof t.totalSavings === "number" && t.totalSavings >= 100) {
    const v = t.totalSavings >= 1000
      ? `$${(t.totalSavings / 1000).toFixed(1)}K`
      : `$${Math.round(t.totalSavings)}`;
    signals.push({ id: "exposed", label: "OVERCHARGES EXPOSED", value: v });
  }

  return signals;
}

// Telemetry is passed down from the page, which already fetches it for the
// counters. Fetching it a second time here would double the request count on
// every page load to display numbers the page is already holding.
export default function LiveToast({ telemetry }: { telemetry: Telemetry }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signals = useMemo(() => buildSignals(telemetry), [telemetry]);

  useEffect(() => {
    if (signals.length === 0) return;

    const show = () => {
      setVisible(true);
      hideRef.current = setTimeout(() => {
        setVisible(false);
        setIndex(i => (i + 1) % signals.length);
      }, 4200);
    };

    // Irregular by design. A strip that surfaces on a fixed cadence reads as
    // a widget; an irregular one reads as something reporting in.
    const delay = 6000 + Math.random() * 9000;
    const timer = setTimeout(show, delay);
    return () => {
      clearTimeout(timer);
      if (hideRef.current) clearTimeout(hideRef.current);
    };
  }, [signals, index]);

  if (!visible || signals.length === 0) return null;
  const signal = signals[index % signals.length];

  return (
    <div key={signal.id + index} className="toast">
      <div style={{
        width: "6px", height: "6px", borderRadius: "50%",
        background: "var(--green)", flexShrink: 0,
        boxShadow: "0 0 6px rgba(16,217,160,0.5)",
      }} className="animate-pulse" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "9px", letterSpacing: "1.4px",
          color: "rgba(238,238,246,0.28)", textTransform: "uppercase", lineHeight: "1.3",
        }}>
          {signal.label}
        </div>
        <div style={{
          fontFamily: "var(--font-display), sans-serif", fontSize: "15px", fontWeight: "700",
          color: "var(--text)", letterSpacing: "-0.3px", marginTop: "2px", lineHeight: "1.2",
        }}>
          {signal.value}
        </div>
      </div>
    </div>
  );
}
