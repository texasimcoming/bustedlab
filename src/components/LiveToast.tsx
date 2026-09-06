"use client";
import { useState, useEffect, useRef } from "react";

// Large pool of names + cities so no repeat is visible within a session
// Actions avoid "just" to work for returning visitors too
const FIRST_NAMES = [
  "Maya","Jordan","Tyler","Sofia","Amir","Priya","Chris","Lena","Noah","Ines",
  "Zara","Marcus","Layla","Devon","Chloe","Rafi","Elena","Jake","Nadia","Omar",
  "Bianca","Kai","Yasmin","Leo","Sasha","Finn","Mira","Andre","Talia","Hugo",
  "Camille","Ezra","Dani","Theo","Isla","Remy","Jess","Mateo","Quinn","Sage",
];
const LAST_INITIALS = "ABCDEFGHJKLMNPRSTW";
const CITIES = [
  "London","Toronto","Austin","Paris","Dubai","Sydney","New York","Berlin",
  "LA","Madrid","Amsterdam","Singapore","Miami","Stockholm","Barcelona",
  "Montreal","Tokyo","Dublin","Lisbon","Cape Town","Chicago","Melbourne",
  "Seoul","Copenhagen","Vienna","Zurich","Brussels","Oslo","Helsinki",
];
const ACTIONS = [
  "scanned a product",
  "busted a markup",
  "ran an X-ray",
  "exposed a dropship scam",
  "scanned a skincare device",
  "found a cheaper source",
  "busted a TikTok product",
  "scanned a fitness tracker",
  "ran a price check",
  "exposed a markup on a watch",
  "scanned a home gadget",
  "found a better price",
  "busted a viral product",
  "scanned a beauty device",
  "ran a product X-ray",
];

function getRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateActivity() {
  const first = getRandom(FIRST_NAMES);
  const last = LAST_INITIALS[Math.floor(Math.random() * LAST_INITIALS.length)];
  return {
    name: `${first} ${last}.`,
    city: getRandom(CITIES),
    action: getRandom(ACTIONS),
  };
}

export default function LiveToast() {
  const [visible, setVisible] = useState(false);
  const [activity, setActivity] = useState(generateActivity);
  const [key, setKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNext = () => {
    setActivity(generateActivity());
    setKey(k => k + 1);
    setVisible(true);
    timerRef.current = setTimeout(() => setVisible(false), 4000);
  };

  useEffect(() => {
    // First toast after 5 seconds
    const initial = setTimeout(showNext, 5000);
    // Then every 14-22 seconds (randomized so it never feels like a loop)
    const interval = setInterval(() => {
      const delay = Math.random() * 8000 + 14000;
      setTimeout(showNext, delay);
    }, 22000);

    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div key={key} className="toast">
      <div style={{
        width: "32px", height: "32px", borderRadius: "50%",
        background: "linear-gradient(135deg, var(--accent-2), var(--accent))",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "13px", fontWeight: "700", color: "white", flexShrink: 0,
        fontFamily: "'Space Grotesk', sans-serif",
      }}>
        {activity.name[0]}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text)", lineHeight: "1.3" }}>
          {activity.name} from {activity.city}
        </div>
        <div style={{ fontSize: "11px", color: "var(--text-3)", marginTop: "1px", lineHeight: "1.3" }}>
          {activity.action}
        </div>
      </div>
      <div style={{
        width: "6px", height: "6px", borderRadius: "50%",
        background: "var(--green)", flexShrink: 0,
        boxShadow: "0 0 6px rgba(16,217,160,0.5)",
      }} className="animate-pulse" />
    </div>
  );
}
