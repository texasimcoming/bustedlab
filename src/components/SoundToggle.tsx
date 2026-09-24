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
 * Rendered as a two-state signal readout rather than a speaker icon, because a
 * speaker icon is what every app on a phone uses and this is not one of those.
 * Four bars lit is audio armed; one bar struck through is muted.
 */
export default function SoundToggle() {
  const state = useSyncExternalStore(subscribeSound, getSoundState, getSoundServerState);

  if (state === "unknown" || state === "unsupported") {
    // Reserve the footprint so the nav does not reflow when the real state
    // lands after hydration, and render nothing where Web Audio is absent.
    return <div style={{ width: "28px", height: "22px" }} aria-hidden="true" />;
  }

  const enabled = state === "on";
  const color = enabled ? "var(--accent-bright)" : "var(--text-3)";

  return (
    <button
      onClick={() => setSoundEnabled(!isSoundEnabled())}
      title={enabled ? "Verdict tone on" : "Verdict tone muted"}
      aria-label={enabled ? "Mute verdict tone" : "Unmute verdict tone"}
      aria-pressed={enabled}
      style={{
        position: "relative",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: "4px 5px",
        display: "flex",
        alignItems: "flex-end",
        gap: "1.5px",
        height: "22px",
        lineHeight: 0,
        transition: "opacity 0.18s ease",
        opacity: enabled ? 1 : 0.6,
      }}
    >
      {[0, 1, 2, 3].map(i => (
        <span
          key={i}
          style={{
            display: "block",
            width: "2.5px",
            height: `${4 + i * 2.5}px`,
            borderRadius: "1px",
            background: enabled || i === 0 ? color : "rgba(238,238,246,0.12)",
            boxShadow: enabled ? `0 0 4px ${color}` : "none",
            transition: "background 0.18s ease, box-shadow 0.18s ease",
          }}
        />
      ))}
      {!enabled && (
        <span
          style={{
            position: "absolute",
            left: "1px",
            right: "1px",
            top: "10px",
            height: "1.5px",
            background: "var(--text-3)",
            transform: "rotate(-34deg)",
            pointerEvents: "none",
          }}
        />
      )}
    </button>
  );
}
