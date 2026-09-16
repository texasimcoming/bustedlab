"use client";
import { useState, useEffect, useRef } from "react";

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

export default function LiveToast({ telemetry }: { telemetry?: unknown }) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(generate);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cycleTimer: ReturnType<typeof setTimeout>;

    const show = () => {
      setCurrent(generate());
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
  }, []);

  if (!visible) return null;

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
