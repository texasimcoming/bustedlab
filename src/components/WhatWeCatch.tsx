"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CategoryGlyph from "@/components/CategoryGlyph";
import { ILLUSTRATIVE_CATCHES, REAL_CATCHES_MINIMUM, type RealCatch } from "@/content/catches";
import { loadLeaderboard } from "@/lib/leaderboard-client";

// "What we catch". Real ledger records once there are enough of them, the
// labelled illustrative set until then; see src/content/catches.ts. The
// illustrative set is what renders first, so the section is never empty
// while the ledger data loads, and it is below the fold, so the swap happens
// before anyone scrolls to it.
const money = (n: number) => `$${n.toFixed(2)}`;

function isRealCatch(value: unknown): value is RealCatch {
  const r = value as RealCatch;
  return !!r && typeof r.id === "string" && typeof r.title === "string" && typeof r.category === "string" &&
    [r.retailPrice, r.wholesalePrice, r.savings].every(n => typeof n === "number" && Number.isFinite(n));
}

export default function WhatWeCatch() {
  const [real, setReal] = useState<RealCatch[] | null>(null);

  useEffect(() => {
    let live = true;
    loadLeaderboard<{ catches?: unknown }>()
      .then(data => {
        const catches = Array.isArray(data?.catches) ? data.catches.filter(isRealCatch) : [];
        if (live && catches.length >= REAL_CATCHES_MINIMUM) setReal(catches.slice(0, REAL_CATCHES_MINIMUM));
      })
      .catch(() => { /* the illustrative set stays */ });
    return () => { live = false; };
  }, []);

  const card = { borderRadius: "14px", padding: "14px", display: "flex", alignItems: "center", gap: "11px" } as const;

  return (
    <section className="section reveal">
      <div className="label">
        WHAT WE CATCH
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
        {real
          ? real.map(r => (
              <Link key={r.id} href={`/scan/${r.id}`} className="card" style={{ ...card, minWidth: 0, textDecoration: "none" }}>
                {/* A fixed slot: "food" and "other" have no glyph, and every card keeps the same indent. */}
                <span style={{ width: "20px", height: "20px", flexShrink: 0, display: "flex" }}>
                  <CategoryGlyph type={r.category} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: "600", fontSize: "13px", color: "var(--text)", marginBottom: "3px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    {r.title}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-3)", lineHeight: "1.3", fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ textDecoration: "line-through", color: "#ff6b79" }}>{money(r.retailPrice)}</span> → <span style={{ color: "var(--green)" }}>{money(r.wholesalePrice)} real</span>
                  </div>
                </div>
              </Link>
            ))
          : ILLUSTRATIVE_CATCHES.map(c => (
              <div key={c.c} className="card" style={card}>
                <CategoryGlyph type={c.icon} />
                <div>
                  <div style={{ fontWeight: "600", fontSize: "13px", color: "var(--text)", marginBottom: "3px" }}>{c.c}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-3)", lineHeight: "1.3", fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ textDecoration: "line-through", color: "#ff6b79" }}>{c.x}</span> → <span style={{ color: "var(--green)" }}>{c.r}</span>
                  </div>
                </div>
              </div>
            ))}
      </div>
      {!real && (
        <p style={{ fontSize: "12px", color: "var(--text-2)", marginTop: "10px", textAlign: "center" }}>
          Illustrative examples.
        </p>
      )}
    </section>
  );
}
