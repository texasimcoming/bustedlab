"use client";

import { useEffect, useState } from "react";

// Every stage below names a real step scan.ts actually performs. If the
// pipeline changes, this list changes with it. Nothing here is decorative.
//
// The durations follow the measured scans, not a guess. Real scans take 13
// to 41 seconds (production evaluation runs 7 to 10: about 13 to 17 seconds
// when the first image search verifies the product, 27 to 41 when the
// escalation runs). The old script ran 5.6 seconds, so nearly every scan sat
// at 96% for most of its life under a "widening the search" line that was
// not what most of them were doing. A bar that stalls near the end is the
// pacing people tolerate worst (Harrison et al., "Rethinking the progress
// bar", UIST 2007); one that moves steadily through work it can name is the
// one that raises how much the result is worth to them (Buell and Norton,
// "The labor illusion", Management Science 2011).
const SCAN_STAGES = [
  { label: "Reading image signature", detail: "Extracting product identity", duration: 1800 },
  { label: "Reverse image matching", detail: "Searching by pixel signature, not keywords", duration: 3000 },
  { label: "Cross-referencing listings", detail: "Scanning live shopping indexes", duration: 3200 },
  { label: "Verifying visual match", detail: "Confirming candidates against your image", duration: 3600 },
  { label: "Calculating markup", detail: "Comparing verified retail vs wholesale", duration: 1600 },
  { label: "Building verdict", detail: "Compiling confidence-scored report", duration: 1400 },
];

// Shown when a scan outlives the scripted stage list. True of every scan
// still running at that point: each candidate is checked against the photo
// before anything is shown.
const EXTENDED_STAGE = {
  label: "Still verifying matches",
  detail: "Checking each candidate against your image",
};

export default function ScanningScreen({ preview }: { preview: string | null }) {
  const [stageIndex, setStageIndex] = useState(0);
  const [extended, setExtended] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Progress line.
  //
  // The scripted stages run 5.6 seconds. Real scans routinely take longer:
  // the engine has seven layers with multi-tier query fallbacks, and a hard
  // product takes every one of them. The previous version stopped its timer
  // the moment the script ended, which pinned the progress at 97% and froze the
  // stage readout on "Building verdict" for as long as the scan actually
  // needed. A machine that stops moving reads as a machine that has crashed,
  // and that is the moment a person closes the tab.
  //
  // After the script, the line keeps advancing on an asymptotic curve driven
  // by the real clock. It approaches 99% and never reaches it, because the
  // screen genuinely does not know how much is left.
  //
  // One clock drives the line and the elapsed readout, ten times a second.
  // The line's own CSS transition fills the gaps between ticks.
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsedMs(Date.now() - start), 100);
    return () => clearInterval(interval);
  }, []);
  const scripted = SCAN_STAGES.reduce((a, s) => a + s.duration, 0);
  const progress = elapsedMs <= scripted
    ? (elapsedMs / scripted) * 88
    : 88 + 11 * (1 - Math.exp(-(elapsedMs - scripted) / 15000));

  // Stage progression
  useEffect(() => {
    let idx = 0;
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => {
      if (idx < SCAN_STAGES.length - 1) {
        idx++;
        setStageIndex(idx);
        timer = setTimeout(advance, SCAN_STAGES[idx].duration);
      } else {
        // The script is spent and the scan is still running, which means the
        // engine is into its fallback tiers. Say so, rather than sitting on
        // "Building verdict" indefinitely.
        timer = setTimeout(() => setExtended(true), 1400);
      }
    };
    timer = setTimeout(advance, SCAN_STAGES[0].duration);
    // The chain outlived the component: a scan that resolved faster than the
    // stage script kept firing setState against an unmounted tree.
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="scan-screen">
      <div className="scan-top">
        <span className="scan-top-dot animate-pulse" />
        <span>SCAN IN PROGRESS</span>
      </div>

      <div className="scan-body">
        {/* ═══ THE INSTRUMENT ═══
            The visitor's own photo, large, locked in the same brackets as the
            example on the landing page, with the laser measuring it. The line
            under it is the progress, driven by the clock above. */}
        <div className="scan-frame">
          {preview ? (
            // Local data: URL, same as on the landing page. Nothing for the
            // image optimizer to do with it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="scan-photo" />
          ) : (
            <div className="scan-placeholder" aria-hidden="true">
              <svg width="44" height="44" viewBox="0 0 34 34" fill="none" opacity="0.6">
                <circle cx="17" cy="17" r="9" stroke="#a993ff" strokeWidth="1.3" strokeDasharray="3 4" />
                <circle cx="17" cy="17" r="2" fill="#a993ff" />
                <path d="M17 2 L17 7 M17 27 L17 32 M2 17 L7 17 M27 17 L32 17" stroke="#a993ff" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <span>Reading the page</span>
            </div>
          )}
          <div className="hi-plane" aria-hidden="true" />
          <div className="hi-shade" aria-hidden="true" />
          <span className="hi-corner hi-tl" aria-hidden="true" />
          <span className="hi-corner hi-tr" aria-hidden="true" />
          <span className="hi-corner hi-bl" aria-hidden="true" />
          <span className="hi-corner hi-br" aria-hidden="true" />
          {/* The laser. A CSS animation on the compositor (globals.css,
              .scan-beam), so it costs no renders and is not drawn for anyone
              who has asked for reduced motion. */}
          <div className="scan-beam" aria-hidden="true" />
          {/* The one live number on this screen, straight off the clock. The
              layer list that lit up "CONFIRMED" on a timer and a "records
              swept" figure computed from elapsed time are gone: neither was
              reporting anything the scan had actually done. */}
          <div className="scan-elapsed" aria-hidden="true">
            <span>ELAPSED</span>
            <b className="tnum">{(elapsedMs / 1000).toFixed(1)}s</b>
          </div>
        </div>
        <div className="scan-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress / 100})` }} />
        </div>

        {/* ═══ CURRENT STAGE ═══ */}
        <div role="status" aria-live="polite" className="scan-status">
          <h2 key={extended ? "ext" : stageIndex}>
            {extended ? EXTENDED_STAGE.label : SCAN_STAGES[stageIndex].label}
          </h2>
          <p key={extended ? "dext" : `d${stageIndex}`}>
            {extended ? EXTENDED_STAGE.detail : SCAN_STAGES[stageIndex].detail}
          </p>
        </div>

        {/* ═══ THE STEPS ═══
            Every step the scan works through, named, with the current one
            lit. Steps behind it are marked passed, not "confirmed": this list
            follows the clock, and the scan does not report each step back. */}
        <ol className="scan-steps" aria-hidden="true">
          {SCAN_STAGES.map((st, i) => {
            const state = extended || i < stageIndex ? "past" : i === stageIndex ? "now" : "next";
            return (
              <li key={st.label} className={`scan-step scan-step-${state}`}>
                <span className="scan-step-mark" />
                <span>{st.label}</span>
              </li>
            );
          })}
        </ol>

        <div className="scan-foot">
          {extended ? "STILL VERIFYING" : `STAGE ${stageIndex + 1} / ${SCAN_STAGES.length}`}
        </div>
        {/* What to expect, said once and plainly: the measured range from
            the production evaluation runs. A wait that is explained is
            easier to sit through than one that is not. */}
        <p className="scan-expect">
          Usually 10 to 40 seconds. Keep this screen open.
        </p>
      </div>
    </div>
  );
}
