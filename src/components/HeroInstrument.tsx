"use client";

import { useEffect, useRef, useState } from "react";
import { EXAMPLE_SCANS } from "@/content/examples";

/**
 * THE HERO INSTRUMENT.
 *
 * The first screen shows the product doing its one job, on a real photo of a
 * real cheap object, in under three seconds: the brackets lock on, the laser
 * sweeps it once, the gap between the asking price and the source price is
 * measured, and the verdict lands. Visitors arriving from short video expect
 * the payoff first; this is the payoff, with the numbers labelled EXAMPLE.
 *
 * The whole sequence is CSS (globals.css, "THE HERO INSTRUMENT"), so it plays
 * from the first paint with no script and costs the main thread nothing. Under
 * reduced motion every element is drawn at its final frame. Nothing loops: with
 * one example it plays once and holds; with several, it moves to the next one
 * every few seconds while it is on screen, at most twice round the set.
 */
const HOLD_MS = 6500;
const MAX_CYCLES = 2;

const money = (n: number) => `$${n.toFixed(2)}`;

// The stamp, in the card's own words and colours for each verdict.
const STAMP: Record<string, { label: string; tone: string }> = {
  HIGH_MARKUP: { label: "BUSTED", tone: "red" },
  OVERPRICED: { label: "OVERPRICED", tone: "amber" },
  FAIR: { label: "FAIR PRICE", tone: "green" },
};

export default function HeroInstrument() {
  const [index, setIndex] = useState(0);
  const figureRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (EXAMPLE_SCANS.length < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let visible = true;
    let shown = 0;
    const obs = typeof IntersectionObserver === "undefined" ? null
      : new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.3 });
    if (obs && figureRef.current) obs.observe(figureRef.current);
    const timer = setInterval(() => {
      if (!visible || document.visibilityState !== "visible") return;
      shown += 1;
      if (shown >= EXAMPLE_SCANS.length * MAX_CYCLES) { clearInterval(timer); return; }
      setIndex(i => (i + 1) % EXAMPLE_SCANS.length);
    }, HOLD_MS);
    return () => { clearInterval(timer); obs?.disconnect(); };
  }, []);

  const ex = EXAMPLE_SCANS[index];
  const stamp = STAMP[ex.verdict];
  const srcSet = ex.photo.sizes.map(w => `${ex.photo.base}-${w}.webp ${w}w`).join(", ");

  return (
    <figure ref={figureRef} className="hi">
      {/* Remounted per example, so the sequence replays for each one. */}
      <div className="hi-frame" key={ex.id}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="hi-photo"
          src={`${ex.photo.base}-720.webp`}
          srcSet={srcSet}
          sizes="(min-width: 1100px) 520px, calc(100vw - 48px)"
          width={720}
          height={720}
          alt={ex.photo.alt}
          fetchPriority={index === 0 ? "high" : "auto"}
          decoding="async"
          style={{ objectPosition: ex.photo.focus }}
        />
        <div className="hi-plane" aria-hidden="true" />
        <div className="hi-shade" aria-hidden="true" />
        <span className="hi-corner hi-tl" aria-hidden="true" />
        <span className="hi-corner hi-tr" aria-hidden="true" />
        <span className="hi-corner hi-bl" aria-hidden="true" />
        <span className="hi-corner hi-br" aria-hidden="true" />
        <div className="hi-sweep" aria-hidden="true" />
        <div className="hi-hud" aria-hidden="true"><span className="hi-hud-dot" />MATCH LOCKED</div>
        <div className="hi-tag" aria-hidden="true"><span className="hi-tag-k">EXAMPLE</span>{ex.label}</div>
        <div className={`hi-stamp hi-stamp-${stamp.tone}`} aria-hidden="true">{stamp.label}</div>
      </div>

      <div className="hi-measure" key={`${ex.id}-m`} aria-hidden="true">
        <div className="hi-price hi-ask">
          <span className="hi-plabel">Asking</span>
          <span className="hi-pval"><span className="hi-strike">{money(ex.asking)}</span></span>
        </div>
        <div className="hi-line">
          <span className="hi-readout">
            <span className="hi-num"><span className="hi-count" style={{ "--to": ex.markup } as React.CSSProperties} />%</span>
            <span className="hi-readout-label">markup</span>
          </span>
          <span className="hi-track">
            <span className="hi-beam" />
            <span className="hi-node hi-node-a" />
            <span className="hi-node hi-node-b" />
          </span>
        </div>
        <div className="hi-price hi-src">
          <span className="hi-plabel">Source</span>
          <span className="hi-pval">{money(ex.source)}</span>
        </div>
      </div>

      <figcaption className="sr-only">
        Example scan of {ex.title}: asking {money(ex.asking)}, source {money(ex.source)}, a {ex.markup}% markup, verdict {stamp.label.toLowerCase()}.
      </figcaption>
    </figure>
  );
}
