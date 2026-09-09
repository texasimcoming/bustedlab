/**
 * THE CONFIRMATION TONE.
 *
 * The one sensory channel the product never used. Everything else about the
 * verdict lands in under 200ms: the card slams in 90ms, one frame of verdict
 * colour crosses the viewport, the numbers resolve staggered. Then silence,
 * which is the moment the illusion drops back to "a browser rendered a
 * component."
 *
 * WHAT THIS IS NOT: a notification sound. Notifications are designed to be
 * heard across a room by someone not looking at the screen, so they are long,
 * loud, melodic and polite. This is the opposite of all four. It is the sound
 * of a mechanism completing a measurement while you are already looking at it.
 *
 * THE DESIGN, in two parts, 83ms total:
 *
 *   1. A 3ms transient. Filtered noise through a narrow bandpass at 2.4kHz.
 *      This is the part that makes it read as MECHANICAL rather than
 *      electronic: it is the relay, the shutter, the bolt. Without it the
 *      tone is a beep. With it, the tone is the thing the beep is confirming.
 *
 *   2. An 80ms body. A sine at the verdict's own frequency plus a quiet
 *      octave partial, exponentially decaying to silence. No release tail, no
 *      reverb, no second note. It stops rather than fades, the same way the
 *      card lands rather than arrives.
 *
 * THE FREQUENCY CARRIES THE VERDICT. This is the part that makes it an
 * instrument instead of a sound effect. Four readouts drawn from one harmonic
 * set (G# minor), so they are audibly the same device reporting different
 * values rather than four unrelated beeps:
 *
 *   BUSTED      415.30 Hz   G#4   flat, dark, the bottom of the range
 *   OVERPRICED  554.37 Hz   C#5   the fourth above it
 *   FAIR        739.99 Hz   F#5   bright, clean, resolved
 *   UNRESOLVED  311.13 Hz   D#4   below everything, quieter: no lock
 *
 * After two or three scans a person knows the verdict before the card has
 * finished rendering. That is a thing no price comparison tool has ever done,
 * and it costs 3kB and zero dependencies.
 *
 * Everything here is defensive. Web Audio is unavailable in some embedded
 * browsers, blocked until a gesture in all of them, and can throw on
 * construction in private modes. Every failure path is silence, never an
 * error and never a broken scan.
 */

export type VerdictTone = "HIGH_MARKUP" | "OVERPRICED" | "FAIR" | "UNVERIFIED";

const STORAGE_KEY = "bl_sound";

const TONES: Record<VerdictTone, { frequency: number; gain: number }> = {
  HIGH_MARKUP: { frequency: 415.3, gain: 0.16 },
  OVERPRICED: { frequency: 554.37, gain: 0.14 },
  FAIR: { frequency: 739.99, gain: 0.12 },
  UNVERIFIED: { frequency: 311.13, gain: 0.09 },
};

const BODY_SECONDS = 0.08;
const TRANSIENT_SECONDS = 0.003;

type AudioContextConstructor = typeof AudioContext;

let context: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  // Older iOS Safari only exposes the prefixed constructor, and lib.dom does
  // not declare it, so both are read off an explicitly widened window.
  const w = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return w.AudioContext || w.webkitAudioContext || null;
}

export function isSoundSupported(): boolean {
  return getAudioContextConstructor() !== null;
}

/**
 * Preference. Defaults to ON.
 *
 * That is a deliberate choice and worth stating plainly: the tone only ever
 * fires as the terminal response to an explicit click followed by an
 * eight-second wait. It never fires on page load, never on the landing page
 * demo card, never while scrolling. It is the least intrusive shape audio on
 * a website can take, and a feature that defaults off is a feature almost
 * nobody experiences. The mute control is in the nav on every screen, so
 * nobody has to hunt for the off switch.
 */
export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // Private mode, or storage blocked entirely. Default stands.
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    /* preference simply will not persist */
  }
  // Wake every mounted toggle in this tab. There is one in the landing nav and
  // one in the results nav, and a control that disagrees with its twin two
  // screens later is worse than no control.
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* no-op */
  }
}

// ════════════════════════════════════════════════════════════════
// External store, read through useSyncExternalStore.
//
// The preference lives in localStorage, which does not exist during the server
// render. Reading it in a useState initialiser is a hydration mismatch, and
// reading it in an effect is a cascading render (and a visible flicker as the
// control corrects itself). useSyncExternalStore is the primitive built for
// exactly this: a server snapshot, a client snapshot, and a subscription. It
// also gets cross-tab sync for free through the storage event, so muting in
// one tab mutes in all of them.
// ════════════════════════════════════════════════════════════════

const CHANGE_EVENT = "bl:sound-change";

/** "unknown" only ever appears in the server snapshot, before hydration. */
export type SoundState = "unknown" | "unsupported" | "on" | "off";

export function subscribeSound(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function getSoundState(): SoundState {
  if (typeof window === "undefined") return "unknown";
  if (!isSoundSupported()) return "unsupported";
  return isSoundEnabled() ? "on" : "off";
}

export function getSoundServerState(): SoundState {
  return "unknown";
}

/**
 * Call this from inside the click handler that starts a scan.
 *
 * Every browser starts an AudioContext suspended until a user gesture resumes
 * it, and the resume has to happen synchronously within a real gesture: doing
 * it eight seconds later when the verdict lands is far too late and silently
 * produces nothing. The scan button IS the gesture, so the context is created
 * and unlocked there and is warm by the time the verdict needs it.
 */
export function armAudio(): void {
  if (!isSoundEnabled()) return;
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return;

  try {
    if (!context) context = new Ctor();
    if (context.state === "suspended") {
      void context.resume().catch(() => { /* blocked; stay silent */ });
    }
  } catch {
    context = null;
  }
}

// One tiny buffer of white noise, built once and reused. This is the raw
// material for the mechanical transient.
function getNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
  if (noiseBuffer) return noiseBuffer;
  try {
    const frames = Math.max(1, Math.ceil(ctx.sampleRate * TRANSIENT_SECONDS));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) channel[i] = Math.random() * 2 - 1;
    noiseBuffer = buffer;
    return buffer;
  } catch {
    return null;
  }
}

/**
 * Fires the tone for a verdict. Safe to call unconditionally: it checks the
 * preference, the context state and browser support itself, and does nothing
 * at all if any of them says no.
 */
export function playVerdictTone(verdict: VerdictTone): void {
  if (!isSoundEnabled() || !context || context.state !== "running") return;

  const spec = TONES[verdict] || TONES.UNVERIFIED;
  const ctx = context;
  const now = ctx.currentTime;

  try {
    // Master gain for the whole event, so the transient and the body are
    // shaped and stopped together.
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);

    // ── 1. The mechanism. 3ms of noise through a narrow bandpass. ──
    const buffer = getNoiseBuffer(ctx);
    if (buffer) {
      const click = ctx.createBufferSource();
      click.buffer = buffer;

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.value = 2400;
      bandpass.Q.value = 1.4;

      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(spec.gain * 0.55, now);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, now + TRANSIENT_SECONDS);

      click.connect(bandpass).connect(clickGain).connect(master);
      click.start(now);
      click.stop(now + TRANSIENT_SECONDS + 0.001);
    }

    // ── 2. The confirmation. Sine at the verdict's frequency, plus a quiet
    //      octave for body. Attack is 1.5ms: fast enough to read as an event
    //      rather than a note, slow enough not to click on its own. ──
    const attack = 0.0015;

    const fundamental = ctx.createOscillator();
    fundamental.type = "sine";
    fundamental.frequency.value = spec.frequency;

    const partial = ctx.createOscillator();
    partial.type = "sine";
    partial.frequency.value = spec.frequency * 2;

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(spec.gain, now + attack);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + BODY_SECONDS);

    const partialGain = ctx.createGain();
    partialGain.gain.setValueAtTime(0.0001, now);
    partialGain.gain.exponentialRampToValueAtTime(spec.gain * 0.18, now + attack);
    partialGain.gain.exponentialRampToValueAtTime(0.0001, now + BODY_SECONDS * 0.7);

    fundamental.connect(bodyGain).connect(master);
    partial.connect(partialGain).connect(master);

    fundamental.start(now);
    partial.start(now);
    fundamental.stop(now + BODY_SECONDS + 0.01);
    partial.stop(now + BODY_SECONDS + 0.01);

    // Release the graph once it has finished rather than leaving a node per
    // scan attached to the destination for the lifetime of the page.
    fundamental.onended = () => {
      try { master.disconnect(); } catch { /* already gone */ }
    };
  } catch {
    /* silence is the only acceptable failure mode */
  }
}
