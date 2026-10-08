"use client";

import { useSyncExternalStore } from "react";
import {
  getSoundServerState,
  getSoundState,
  isSoundEnabled,
  setSoundEnabled,
  subscribeSound,
} from "@/lib/sound";

/**
 * The mute control.
 *
 * Present in the nav on every screen, which is the whole justification for the
 * tone defaulting on: nobody has to discover a settings panel to turn it off,
 * and the off switch is visible before the first scan rather than after it.
 *
 * Four bars lit is audio armed; one bar struck through is muted. The bars
 * alone read as a phone's signal strength, so the state is also written out:
 * "Sound on" / "Sound off".
 */
export default function SoundToggle() {
  const state = useSyncExternalStore(subscribeSound, getSoundState, getSoundServerState);

  if (state === "unknown" || state === "unsupported") {
    // Reserve the footprint so the nav does not reflow when the real state
    // lands after hydration, and render nothing where Web Audio is absent.
    return <div style={{ width: "80px", height: "24px" }} aria-hidden="true" />;
  }

  const enabled = state === "on";
  const color = enabled ? "var(--accent-bright)" : "var(--text-3)";

  return (
    <button
      onClick={() => setSoundEnabled(!isSoundEnabled())}
      title={enabled ? "Verdict tone on" : "Verdict tone muted"}
      // The accessible name starts with the words on screen, so a voice
      // control user who says "Sound on" reaches it (WCAG 2.5.3).
      aria-label={enabled ? "Sound on: mute the verdict tone" : "Sound off: turn the verdict tone on"}
      aria-pressed={enabled}
      style={{
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: "10px 8px",
        margin: "-6px -4px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        minHeight: "36px",
        transition: "opacity 0.18s ease",
        opacity: enabled ? 1 : 0.75,
      }}
    >
      <span style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: "1.5px", height: "12px" }}>
        {[0, 1, 2, 3].map(i => (
          <span
            key={i}
            style={{
              display: "block",
              width: "2.5px",
              height: `${4 + i * 2.5}px`,
              borderRadius: "1px",
              background: enabled || i === 0 ? color : "rgba(238,238,246,0.12)",
              transition: "background 0.18s ease",
            }}
          />
        ))}
        {!enabled && (
          <span
            style={{
              position: "absolute",
              left: "-2px",
              right: "-2px",
              top: "5px",
              height: "1.5px",
              background: "var(--text-3)",
              transform: "rotate(-34deg)",
              pointerEvents: "none",
            }}
          />
        )}
      </span>
      {/* The bars alone read as a phone's signal strength. The word says
          what the control is. */}
      <span style={{ fontSize: "12px", color: enabled ? "var(--text-2)" : "var(--text-3)", whiteSpace: "nowrap", lineHeight: 1 }}>
        {enabled ? "Sound on" : "Sound off"}
      </span>
    </button>
  );
}
