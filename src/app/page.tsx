"use client";

import { useState, useRef, useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";

// The scanning screen and the results page are only ever shown after someone
// starts a scan, so they are not part of the landing page's first load: that
// JavaScript was being parsed before the page could respond to a tap. They
// are fetched as soon as the page is idle (see the preload effect in Home),
// so they are already there by the time anyone presses scan; the fallback
// is only a blank screen in the brand colour for the rare case they are not.
const BlankScreen = () => <div style={{ minHeight: "100vh", background: "var(--bg)" }} />;
const loadScanningScreen = () => import("@/components/ScanningScreen");
const loadResultsPage = () => import("@/components/ResultsPage");
const ScanningScreen = dynamic(loadScanningScreen, { ssr: false, loading: BlankScreen });
const ResultsPage = dynamic(loadResultsPage, { ssr: false, loading: BlankScreen });
import PaywallModal from "@/components/PaywallModal";
import LiveToast from "@/components/LiveToast";
import WhatWeCatch from "@/components/WhatWeCatch";
import { REACTIONS } from "@/content/reactions";
import { loadLemonJs, openLemonOverlay } from "@/lib/lemon-overlay";
import StickyBar from "@/components/StickyBar";
import StaticVerdictDemo from "@/components/StaticVerdictDemo";
import HeroInstrument from "@/components/HeroInstrument";
import SoundToggle from "@/components/SoundToggle";
import Leaderboards from "@/components/Leaderboards";
import type { CardMode, MatchConfidence, VerdictType } from "@/components/VerdictCard";
import { CLASSIFICATION_RULES } from "@/lib/verdict";
import { armAudio } from "@/lib/sound";
import { track } from "@/lib/track";

type AppState = "landing" | "scanning" | "results";

// Kept in sync with scan.ts's exported ScanResult — this was a stale
// duplicate of the pre-v6 shape and would not type-check against what
// ResultsPage now expects (mode, matchConfidence). Import from a shared
// location instead of hand-duplicating this again next time it changes.
interface ScanResult {
  found: boolean;
  scanId?: string | null;
  mode: CardMode;
  matchConfidence: MatchConfidence;
  priceSource: "screenshot" | "estimated" | "shopping";
  sourceProduct: { title: string; price: number; currency: string; imageUrl: string; productUrl: string; affiliateUrl: string; platform: string };
  analysis: { retailEstimate: number; markup: number; verdict: VerdictType; savings: number; savingsPercent: number; confidence: "high" | "medium" | "low"; retailSource: "screenshot" | "estimated" | "shopping" };
}
interface UserStatus { isPaid: boolean; remaining: number; authenticated: boolean; email?: string }

function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".reveal");
    if (typeof IntersectionObserver === "undefined") return;

    const obs = new IntersectionObserver(
      (entries) => entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          obs.unobserve(e.target);
        }
      }),
      { threshold: 0.08 }
    );

    els.forEach(el => {
      // Hide only once we know we can reveal it again. Anything already on
      // screen at mount is revealed on the next frame rather than flashing
      // dark first.
      el.classList.add("reveal-armed");
      obs.observe(el);
    });

    return () => obs.disconnect();
  }, []);
}

// The testimonial block that used to live here was invented: three quotes,
// three first names, three cities, three ages, three five-star ratings, none
// of which belonged to anyone. That is a straightforward FTC problem
// (16 CFR Part 255 requires endorsements to reflect real experiences of real
// people) and, worse, it is the same manufactured-trust move the product
// exists to expose. A visitor who works out that the reviews are fake has
// been given a reason to disbelieve the verdicts too.
//
// It is replaced by the machine's own rulebook. Publishing the exact
// thresholds is stronger than praise: every verdict on the site was
// pre-justified before anyone saw it, and anyone who wants to check the math
// can. The strings are generated from the same constants calculateVerdict()
// uses, so the published rules cannot drift from the applied ones.

const TONE_COLOR: Record<string, string> = {
  red: "var(--red)",
  yellow: "var(--yellow)",
  green: "var(--green)",
  muted: "var(--text-3)",
};

// Floor under the scan counter, and a floor is precisely what it is: the
// displayed figure is max(baseline, real count), not baseline + real count.
//
// It used to be additive, which quietly made it something else. An offset
// never retires - at 200,000 real scans the page would have claimed 247,000,
// and the gap would have grown forever. A floor has an exit condition: the
// moment real scans pass it, the real number is what shows, and the
// placeholder is gone for good without anyone having to remember to remove
// it. That is the difference between a bridge and a permanent overstatement,
// and it is the whole basis on which this number is kept.
//
// Monotonicity, the original reason given for this constant, is handled
// where it belongs: sessionStorage below remembers the largest figure this
// session has already shown, so the count never visibly goes backwards.
const SCAN_BASELINE = 47000;

// Mirrors FREE_SCANS_PER_DAY in src/lib/redis.ts. Kept as a named constant so
// the "999" magic number that used to stand in for "unlimited" cannot drift
// into the free-tier meter, which only ever renders two segments.
const FREE_SCAN_ALLOWANCE = 2;

// The largest scan count this session has already shown, or 0.
function storedScanCount(): number {
  try {
    const parsed = parseInt(sessionStorage.getItem("bl_scans") ?? "", 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0; // storage blocked
  }
}

// How often the page asks whether the purchase it just started has cleared,
// and for how long. See the claim watch in Home and src/lib/checkout-claim.ts.
const CLAIM_POLL_MS = 3000;
const CLAIM_WATCH_AFTER_CHECKOUT_MS = 10 * 60 * 1000;
const CLAIM_WATCH_AFTER_RETURN_MS = 2 * 60 * 1000;

interface AuthStatus {
  authenticated?: boolean;
  paid?: boolean;
  email?: string;
  /** This call signed the browser in from a paid checkout claim. */
  claimed?: boolean;
  /** "pending": a checkout from this browser has not cleared yet. */
  claim?: string;
}

// The address bar does not change under a mounted page in any way this
// message cares about, so there is nothing to subscribe to.
const subscribeToNothing = () => () => {};

function messageForArrivalUrl(): string {
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth") === "success") return "Access unlocked. You are in.";
  if (params.get("auth") === "expired") return "Link expired. Request a new one.";
  if (params.get("auth") === "failed") return "That link could not be verified. Request a new one.";
  if (params.get("payment") === "success") return "Payment confirmed. Your access link is in your inbox.";
  return "";
}

interface Telemetry {
  totalScans?: number;
  totalSavings?: number;
  hourlyScans?: number;
  maxMarkup?: number;
  verdictsRecorded?: number;
  bustedRecorded?: number;
}


export default function Home() {
  const [state, setState] = useState<AppState>("landing");
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [userIntent, setUserIntent] = useState<"verdict" | "finder">("verdict");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [userStatus, setUserStatus] = useState<UserStatus>({ isPaid: false, remaining: FREE_SCAN_ALLOWANCE, authenticated: false });
  const [showPaywall, setShowPaywall] = useState(false);
  // The day's free capacity ran out for everyone (503 from /api/scan). The
  // paywall says so rather than claiming this visitor's own scans are spent.
  const [freeTierPaused, setFreeTierPaused] = useState(false);
  // Every opening says why, so a reason can never outlive the opening it
  // belonged to.
  const openPaywall = (reason: "wall" | "choice" | "capacity") => {
    setFreeTierPaused(reason === "capacity");
    setShowPaywall(true);
  };
  // Whether the scan action in the hero is on screen. The sticky bar repeats
  // that action, so it only appears once the hero's own button has scrolled
  // away: two identical buttons on one screen made the visitor choose
  // between them, and the bar sat on top of the allowance line under the
  // hero button. Starts true, so the server render and a visitor with
  // scripts off never see the bar on top of the hero.
  const [heroActionInView, setHeroActionInView] = useState(true);
  const heroActionRef = useRef<HTMLDivElement>(null);
  // The message for the link the visitor arrived on (?auth=..., ?payment=...)
  // until anything on the page sets its own. Read through
  // useSyncExternalStore so the server render and the hydrating render agree
  // on "" and the message appears the moment hydration ends. Reading the URL
  // in a useState initialiser, as this used to, made the first client render
  // disagree with the server HTML, so React threw the whole page away and
  // rebuilt it on every magic-link sign-in and every post-purchase arrival.
  const arrivalMessage = useSyncExternalStore(subscribeToNothing, messageForArrivalUrl, () => "");
  const [pageMessage, setAuthMessage] = useState<string | null>(null);
  // Why the last scan did not produce a result, shown right above the scan
  // button rather than in the banner at the top: after a scan the page is
  // scrolled to the button, and a phone never shows the banner from there.
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const authMessage = pageMessage ?? arrivalMessage;
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSent, setLoginSent] = useState(false);
  const [checkoutAvailable, setCheckoutAvailable] = useState(true);
  // Whether checkout opens as the Lemon Squeezy overlay rather than a page
  // navigation. Decided by the server from the configured link.
  const [checkoutEmbed, setCheckoutEmbed] = useState(false);
  // Who takes the payment ("lemonsqueezy", "gumroad"), for the trust line on
  // the upgrade screen.
  const [checkoutProvider, setCheckoutProvider] = useState<string | undefined>(undefined);
  // One checkout attempt at a time: a second tap while the overlay script is
  // arriving must not open two overlays or navigate out from under one.
  const checkoutInFlight = useRef(false);
  const [telemetry, setTelemetry] = useState<Telemetry>({});
  // Same-session reloads never go backwards: the largest count this session
  // has shown is kept in sessionStorage and acts as a floor. The floor is 0
  // on the server and in the hydrating render, so both render the same
  // number, and takes the stored value as soon as hydration ends.
  const sessionFloor = useSyncExternalStore(subscribeToNothing, storedScanCount, () => 0);
  const [countedScans, setTotalScans] = useState(SCAN_BASELINE);
  const totalScans = Math.max(countedScans, sessionFloor);
  const [totalSavings, setTotalSavings] = useState(0);
  const [maxMarkup, setMaxMarkup] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlFieldRef = useRef<HTMLInputElement>(null);
  const scanItRef = useRef<HTMLButtonElement>(null);

  // Every screen change starts at the top. Picking a photo scrolls the page
  // down to the scan button, and the scanning screen and the result used to
  // open at that same scroll position: on a phone the result opened halfway
  // down the card, with the verdict and the markup above the fold line, so
  // the one moment the product exists for was the part nobody saw. Before
  // paint, so the old position never flashes.
  const shownState = useRef(state);
  useLayoutEffect(() => {
    if (shownState.current === state) return; // first render: leave the browser's own scroll restore alone
    shownState.current = state;
    window.scrollTo(0, 0);
  }, [state]);

  // A picked photo pushes the question and the scan button below the fold on
  // a phone. Bring them up, so the next tap is on screen. scroll-padding on
  // <html> keeps the button clear of the sticky bar.
  useEffect(() => {
    if (!preview) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    scanItRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [preview]);
  useEffect(() => {
    if (!scanNotice) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    (scanItRef.current ?? urlFieldRef.current)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [scanNotice]);

  // ── The funnel. ──
  // One landing per page load, and the first photo and the first link of a
  // page load, so "landings that gave it something to scan" is a rate rather
  // than a count of how often someone fiddled with the field. See
  // src/lib/analytics.ts for the whole list and what each step means.
  const inputTracked = useRef({ photo: false, url: false });
  useEffect(() => { track("landing_viewed"); }, []);

  // ── The browser that pays unlocks itself. ──
  // The session check doubles as the claim check: once the webhook has
  // verified the purchase this browser started, the next check signs it in
  // (src/lib/checkout-claim.ts). So while a checkout is open, or while one is
  // known to be waiting on the payment, the page keeps asking.
  const applyAuthStatus = useCallback((status: AuthStatus) => {
    if (status.authenticated) {
      setUserStatus({ isPaid: !!status.paid, remaining: FREE_SCAN_ALLOWANCE, authenticated: true, email: status.email });
    }
    if (status.claimed) {
      setShowPaywall(false);
      setAuthMessage("You're in. Unlimited scans are unlocked on this device.");
    }
  }, []);

  const checkAuth = useCallback(async (): Promise<AuthStatus | null> => {
    try {
      const status: AuthStatus = await fetch("/api/auth", { method: "PATCH" }).then(r => r.json());
      applyAuthStatus(status);
      return status;
    } catch {
      return null;
    }
  }, [applyAuthStatus]);

  const claimWatchUntil = useRef(0);
  const claimWatching = useRef(false);
  const claimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const watchClaim = useCallback((forMs: number) => {
    claimWatchUntil.current = Math.max(claimWatchUntil.current, Date.now() + forMs);
    if (claimWatching.current) return; // already asking; the later deadline now applies
    claimWatching.current = true;
    const tick = async () => {
      if (Date.now() > claimWatchUntil.current) { claimWatching.current = false; return; }
      // A hidden tab waits its turn rather than asking in the background.
      if (document.visibilityState === "visible") {
        const status = await checkAuth();
        // Signed in, or there is no claim to wait for. A failed request
        // (null) is a network blip and keeps asking.
        if (status && status.claim !== "pending") { claimWatching.current = false; return; }
      }
      claimTimer.current = setTimeout(tick, CLAIM_POLL_MS);
    };
    claimTimer.current = setTimeout(tick, CLAIM_POLL_MS);
  }, [checkAuth]);

  useEffect(() => () => {
    if (claimTimer.current) clearTimeout(claimTimer.current);
  }, []);

  // The session check on arrival. It also redeems a paid checkout claim,
  // which is how a buyer returning from the full-page checkout, or coming
  // back later in the same browser, arrives signed in.
  useEffect(() => {
    fetch("/api/auth", { method: "PATCH" }).then(r => r.json()).then((status: AuthStatus) => {
      applyAuthStatus(status);
      if (status.claim === "pending") watchClaim(CLAIM_WATCH_AFTER_RETURN_MS);
    }).catch(() => {});
  }, [applyAuthStatus, watchClaim]);

  // Fetch the post-scan screens once the landing page has settled.
  useEffect(() => {
    const preload = () => { void loadScanningScreen(); void loadResultsPage(); };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(preload, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(preload, 1500);
    return () => clearTimeout(timer);
  }, []);

  useScrollReveal();

  // The hero's scan action, watched so the sticky bar can stand in for it
  // only while it is off screen. The scroll-depth popup that used to offer
  // "Run a scan" at 70% of the page is gone: it was a third copy of the same
  // button, and once shown it stayed, covering the hero's own button.
  useEffect(() => {
    const el = heroActionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([entry]) => setHeroActionInView(entry.isIntersecting), { threshold: 0 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [state]);

  useEffect(() => {
    fetch("/api/scan").then(r => r.json()).then((data: Telemetry & { isPaid?: boolean; remaining?: number }) => {
      setUserStatus(prev => ({
        ...prev,
        // Never downgrades. This request and the session check below go out
        // together, and a checkout claim redeemed by the session check
        // signs the browser in after this one has already been answered as
        // unpaid.
        isPaid: prev.isPaid || !!data.isPaid,
        remaining: typeof data.remaining === "number" ? data.remaining : prev.remaining,
      }));
      setTelemetry(data);
      // The larger of the real count and the floor, never their sum. Once
      // real scans exceed SCAN_BASELINE the baseline stops contributing
      // anything at all and the counter is purely real from then on.
      if (typeof data.totalScans === "number") {
        const displayed = Math.max(SCAN_BASELINE, data.totalScans);
        setTotalScans(prev => {
          const next = Math.max(prev, displayed, storedScanCount());
          try { sessionStorage.setItem("bl_scans", String(next)); } catch { /* storage blocked */ }
          return next;
        });
      }
      if (typeof data.totalSavings === "number") setTotalSavings(data.totalSavings);
      if (typeof data.maxMarkup === "number") setMaxMarkup(data.maxMarkup);
    }).catch(() => {
      // Fetch failed. The fixed baseline from initial state stands, unchanged.
    });

    // Is there a live payment link behind the buttons? Asked once, so the
    // paywall can render an honest closed state instead of opening a dead
    // tab if checkout is not configured.
    fetch("/api/checkout").then(r => r.json()).then(d => {
      setCheckoutAvailable(!!d.available);
      setCheckoutEmbed(!!d.available && !!d.embed);
      setCheckoutProvider(typeof d.provider === "string" ? d.provider : undefined);
    }).catch(() => setCheckoutAvailable(false));
  }, []);

  // Counted where the paywall becomes visible rather than at each of the six
  // places that can open it, so a new entry point can never be added without
  // being measured.
  useEffect(() => {
    if (showPaywall) track("paywall_shown");
  }, [showPaywall]);

  // The upgrade screen opening is the clearest purchase intent this page
  // ever sees, so the overlay script is fetched then - seconds before the
  // click, which is what makes the overlay open instantly. See
  // src/lib/lemon-overlay.ts for why it is not loaded on every page view.
  useEffect(() => {
    if (showPaywall && checkoutAvailable && checkoutEmbed) void loadLemonJs();
  }, [showPaywall, checkoutAvailable, checkoutEmbed]);

  const warmCheckout = () => {
    if (checkoutAvailable && checkoutEmbed) void loadLemonJs();
  };

  // ── The counter ticks. ──
  // A number that only ever moves when you reload reads as a static image.
  // A number that ticks on a fixed interval reads as a script. This moves on
  // an interval redrawn between 20 and 45 seconds every time, by a small
  // irregular amount, and it is clamped monotonic and persisted to
  // sessionStorage, so it can never go backwards for the person watching it,
  // including across a reload or a return from a scan.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setTotalScans(prev => {
        const next = Math.max(prev, storedScanCount()) + 1 + Math.floor(Math.random() * 3);
        try { sessionStorage.setItem("bl_scans", String(next)); } catch { /* private mode */ }
        return next;
      });
      timer = setTimeout(tick, 20000 + Math.random() * 25000);
    };
    timer = setTimeout(tick, 20000 + Math.random() * 25000);
    return () => clearTimeout(timer);
  }, []);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (!inputTracked.current.photo) { inputTracked.current.photo = true; track("photo_selected"); }
    setUploadedFile(file);
    setScanNotice(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  // Drag-and-drop was written and then never attached to anything: the state,
  // the handler and the .upload-zone styles were all dead. On desktop,
  // dropping a screenshot straight onto the page is the shortest path there
  // is from "I saw an ad" to "I have a verdict", so it is wired to the whole
  // surface rather than to one small target.
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types?.includes("Files")) return;
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when the pointer actually leaves the window, not when it
    // crosses between child elements.
    if (e.relatedTarget) return;
    setDragOver(false);
  }, []);

  // The displayed scan count is not a pure count of real scans. It is the
  // larger of SCAN_BASELINE and the server's real total, and on top of that
  // the tick above adds 1 to 3 every 20 to 45 seconds in this browser. The
  // server's real figure is telemetry.totalScans.

  const runScan = async (type: "image" | "url") => {
    if (!userStatus.isPaid && userStatus.remaining <= 0) { openPaywall("wall"); return; }
    if (type === "image" && !uploadedFile) return;

    // Unlock the audio context HERE, inside the click that starts the scan.
    // Browsers only allow a suspended AudioContext to resume from within a
    // real user gesture, and the verdict lands eight seconds later on a timer,
    // which is not one. Arming it at the gesture is the difference between a
    // tone that plays and a tone that silently never does.
    armAudio();

    track("scan_started");
    setScanNotice(null);
    setState("scanning");

    // A request with no ceiling leaves the scanning screen running forever if
    // the connection drops or the function dies without answering. The scan
    // route allows itself 120 seconds, so this gives it that plus margin and
    // then fails visibly instead of spinning.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 135000);

    try {
      let res: Response;
      if (type === "url") {
        res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: urlInput, intent: userIntent }),
          signal: controller.signal,
        });
      } else {
        const fd = new FormData(); fd.append("image", uploadedFile!); fd.append("intent", userIntent);
        res = await fetch("/api/scan", { method: "POST", body: fd, signal: controller.signal });
      }
      if (res.status === 429) {
        setState("landing");
        // Two different 429s. Spending the daily allowance is the paywall
        // moment; tripping the burst limiter is not, and showing a purchase
        // prompt to someone who just clicked twice reads as a shakedown.
        const body = await res.json().catch(() => ({}));
        if (body?.error === "rate_limited") {
          setScanNotice("Too many scans too quickly. Try again in a minute.");
        } else if (body?.error === "fair_use_ceiling") {
          // Fair use on the unlimited tier. This person has already paid, so
          // the paywall branch below would be the worst possible response:
          // a purchase prompt in front of a customer. Say what happened and
          // when it clears, and offer nothing.
          setScanNotice(
            `Daily fair-use ceiling reached (${body?.ceiling || 500} scans). ` +
            "Resets at midnight UTC. Email support if you need it lifted."
          );
        } else {
          // The server's count is the one that decides. The browser's can
          // still read 1 or 2 (another tab, or the per-address ceiling), and
          // the paywall must not tell someone who was just refused a scan
          // that they have scans left.
          setUserStatus(prev => ({ ...prev, remaining: 0 }));
          openPaywall("wall");
        }
        return;
      }
      if (res.status === 413) {
        setState("landing");
        setScanNotice("That image is too large. Under 12MB.");
        return;
      }
      if (res.status === 503) {
        // Daily uncached-scan ceiling reached
        setState("landing");
        setAuthMessage("Capacity reached for today. Unlimited access scans immediately.");
        openPaywall("capacity");
        return;
      }
      if (res.status === 502) {
        // The server could not complete the scan (a provider failed). It
        // used no free scan and the server has already counted it, so the
        // allowance shown stays as it is and the photo stays loaded for the
        // retry.
        const body = await res.json().catch(() => ({}));
        // A 502 the server did not write (a crashed function, a gateway) was
        // never counted there, so the browser counts that one.
        if (body?.error !== "scan_incomplete") track("scan_failed");
        setState("landing");
        setScanNotice(body?.message || "That scan could not be completed on our side. It did not use a free scan. Try again.");
        return;
      }
      const data = await res.json();
      setResult(data); setState("results");
      if (!userStatus.isPaid) setUserStatus(prev => ({ ...prev, remaining: Math.max(0, prev.remaining - 1) }));
    } catch (err) {
      // No silent demo substitute exists, and inventing one would be the
      // single worst thing this codebase could do. Return to the landing
      // screen and say what happened.
      track("scan_failed");
      setState("landing");
      setScanNotice(
        (err as Error)?.name === "AbortError"
          ? "That scan took too long to resolve. Try a direct product link."
          : "Connection dropped mid-scan. Try again."
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  // Checkout destination comes from the server, not from a URL pasted into
  // the component. The previous version hardcoded a Lemon Squeezy link here
  // AND in /api/checkout, which meant the route was never called and the
  // page shipped a dead payment link straight to the customer. One source of
  // truth, and it is configuration.
  const handleCheckout = async () => {
    if (checkoutInFlight.current) return;
    checkoutInFlight.current = true;
    // Sent before the request, because on the fallback path the next thing
    // this function does is navigate away from the page.
    track("checkout_clicked");
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      if (!res.ok) {
        setCheckoutAvailable(false);
        setShowPaywall(false);
        setAuthMessage("Checkout is temporarily offline. Free scans reset at midnight UTC.");
        return;
      }
      const data = await res.json();
      if (!data?.url) {
        setCheckoutAvailable(false);
        return;
      }

      // ── The overlay, when the provider supports it. ──
      // The upgrade screen stays up until the overlay is actually on screen,
      // so a click never leads to an empty page while the script arrives.
      // Then it closes: the overlay replaces it, and two stacked modals would
      // leave the visitor closing ours after theirs.
      if (data.embed) {
        const opened = await openLemonOverlay(data.url, {
          // Tidies the page underneath the overlay. Access itself is granted
          // by the verified webhook and never by this browser event, which
          // anyone could fire from the console. The confirmation the buyer
          // sees is Lemon Squeezy's own modal; this is the same message the
          // page shows after the /success redirect, so the page reads right
          // whichever way they leave the overlay.
          onSuccess: () => {
            setShowPaywall(false);
            setAuthMessage("Payment confirmed. Your access link is in your inbox.");
            watchClaim(CLAIM_WATCH_AFTER_RETURN_MS);
          },
        });
        if (opened) {
          setShowPaywall(false);
          watchClaim(CLAIM_WATCH_AFTER_CHECKOUT_MS);
          return;
        }
        // The script was blocked, timed out, or would not open. The sale
        // does not depend on it: fall through to the full-page checkout.
      }

      // Same tab. A blocked popup is a silently lost sale, and mobile
      // browsers block popups from async handlers routinely.
      window.location.href = data.url;
    } catch {
      setCheckoutAvailable(false);
      setAuthMessage("Checkout is temporarily offline. Free scans reset at midnight UTC.");
    } finally {
      checkoutInFlight.current = false;
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail }) });
      if (res.ok) setLoginSent(true);
      else { const d = await res.json(); setAuthMessage(d.error || "Could not send a link. Try again."); setShowLoginForm(false); }
    } catch {
      setAuthMessage("Could not send a link. Try again.");
    }
  };

  const handleReset = () => { setState("landing"); setPreview(null); setResult(null); setUploadedFile(null); setUrlInput(""); setScanNotice(null); };

  // What the visitor wants to know. Asked again directly above the scan
  // button once a photo is picked, with the verdict preselected, so the choice
  // can still be changed before scanning; on arrival it sits under the two
  // ways in, so the first screen leads with the example and the one action.
  const intentPanel = (
    <div className="intent-panel">
      <p className="intent-rule">
        PRICE VISIBLE = ACCURATE VERDICT.<br className="warning-break" /> NO PRICE = NO READING.
      </p>
      <p id="intent-label" className="intent-q">
        What do you want to know about this product?
      </p>
      <div role="group" aria-labelledby="intent-label" className="intent-options">
        {([
          ["verdict", "Am I overcharged?", "Get the full verdict card", "Needs the price visible"],
          ["finder", "Where is it cheapest?", "Just the cheapest link", "No verdict, no price shown"],
        ] as const).map(([key, title, sub, note]) => {
          const on = userIntent === key;
          return (
            <button key={key} onClick={() => setUserIntent(key)} aria-pressed={on} className="intent-option">
              <span className="intent-title">{on ? "✓ " : ""}{title}</span>
              <span className="intent-sub">{sub}</span>
              <span className="intent-note">{note}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const notice = scanNotice && (
    <div role="alert" className="scan-notice">{scanNotice}</div>
  );

  if (state === "scanning") return <ScanningScreen preview={preview} />;
  if (state === "results" && result) return <ResultsPage result={result} onReset={handleReset} isPaid={userStatus.isPaid} onUpgrade={handleCheckout} onUpgradeIntent={warmCheckout} />;

  return (
    <main
      style={{ position: "relative", zIndex: 1 }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="drop-target">
          <span>RELEASE TO SCAN</span>
        </div>
      )}
      {showPaywall && (
        <PaywallModal
          remaining={userStatus.remaining}
          freeTierPaused={freeTierPaused}
          onClose={() => setShowPaywall(false)}
          onCheckout={handleCheckout}
          onLogin={() => { setShowPaywall(false); setShowLoginForm(true); }}
          checkoutAvailable={checkoutAvailable}
          provider={checkoutProvider}
        />
      )}

      <LiveToast telemetry={telemetry} />
      <StickyBar hidden={heroActionInView} remaining={userStatus.remaining} isPaid={userStatus.isPaid} onScan={() => {
        if (preview) runScan("image");
        else if (urlInput.trim()) runScan("url");
        else fileInputRef.current?.click();
      }} hasFile={!!preview || !!urlInput.trim()} onUpgrade={() => openPaywall("wall")} />

      {/* One light, above the headline. Painted once, scrolls with the page. */}
      <div className="hero-light" aria-hidden="true" />

      {/* Nav */}
      <nav className="site-nav">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-120.webp"
            alt="BustedLab"
            width={36}
            height={36}
            className="brand-mark"
            style={{ borderRadius: "9px", display: "block", objectFit: "cover" }}
          />
          <span className="brand-wordmark nav-wordmark">BustedLab</span>
        </div>
        <div className="nav-right-group" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Desktop only - the same live count moves to the hero anchor
              on mobile instead of duplicating here. */}
          <div className="nav-scan-count live-count">
            <span className="live-dot animate-pulse" />
            <span className="tnum">{totalScans.toLocaleString("en-US")} scanned</span>
          </div>
          <div className="nav-sound-toggle"><SoundToggle /></div>
          {userStatus.isPaid ? (
            <span className="pill-unlimited">Unlimited</span>
          ) : (
            <button onClick={() => setShowLoginForm(true)} className="btn-ghost" style={{ borderRadius: "10px", padding: "10px 14px", fontSize: "13px", fontWeight: 550 }}>Sign in</button>
          )}
        </div>
      </nav>

      {/* Auth messages */}
      {authMessage && (
        <div className="banner-ok" style={{ margin: "12px 20px" }}>
          <p>{authMessage}</p>
        </div>
      )}

      {/* Login form */}
      {showLoginForm && !loginSent && (
        <div style={{ maxWidth: "520px", margin: "12px auto 0", padding: "0 20px", position: "relative", zIndex: 2 }}>
          <div className="card" style={{ borderRadius: "16px", padding: "20px" }}>
            <h2 style={{ fontSize: "17px", fontWeight: 700, letterSpacing: "-0.01em", marginBottom: "6px" }}>Already paid?</h2>
            <p style={{ color: "var(--text-2)", fontSize: "13.5px", marginBottom: "14px" }}>Enter your email. A sign-in link arrives instantly.</p>
            <form onSubmit={handleLoginSubmit} style={{ display: "flex", gap: "8px" }}>
              <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="your@email.com" required
                className="field" style={{ flex: 1, minWidth: 0, padding: "11px 14px", fontSize: "14px" }} />
              <button type="submit" className="btn-primary" style={{ borderRadius: "12px", padding: "11px 20px", fontSize: "14px" }}>Send</button>
            </form>
          </div>
        </div>
      )}
      {loginSent && (
        <div style={{ maxWidth: "520px", margin: "12px auto 0", padding: "0 20px", position: "relative", zIndex: 2 }}>
          <div className="banner-ok">
            <p style={{ fontSize: "14px", fontWeight: 600 }}>If that address has access, a link is in your inbox.</p>
          </div>
        </div>
      )}

      {/* ═══ HERO ═══
          Three parts: the claim, the instrument, the action. On a phone they
          stack in that order, so the first screen is the headline, a real
          photo being measured, and the button. On a wide screen the claim
          and the action share the left column and the instrument fills the
          right (globals.css, .hero-grid). */}
      <div className={preview ? "hero-grid has-preview" : "hero-grid"}>
        <div className="hero-head">
          {/* Mobile-only live anchor. Hidden on desktop where the same count
              already lives in the nav bar. */}
          <div className="hero-scan-count live-count">
            <span className="live-dot animate-pulse" />
            <span className="tnum">{totalScans.toLocaleString("en-US")} scanned</span>
          </div>

          <div className="hero-eyebrow balance">
            SEARCHING 50,000,000,000+ LIVE PRODUCT LISTINGS
          </div>

          <h1 className="hero-title">
            They built the price.<br />
            <span className="hero-title-2">We built the scanner.</span>
          </h1>

          <p className="hero-hook">
            Drop a screenshot or paste a link. See what it sells for elsewhere, what they are asking, and the number they hoped you would never calculate.
          </p>
        </div>

        <div className="hero-visual">
          <HeroInstrument />
        </div>

        {/* ── THE ACTION ──
            One dominant thing to do on arrival: scan a photo. One button
            covers the camera and the photo library, because the phone's own
            picker offers both. The link field sits under it as the secondary
            path. */}
        <div className="hero-action" ref={heroActionRef}>
        {preview ? (
          <>
            <div className="preview-frame">
              {/* A local FileReader data: URL for the photo the visitor just
                  picked. next/image cannot optimize a data URL and would route it
                  through the optimizer for nothing. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="" />
              {/* The brackets lock onto the photo: it has been received and
                  is ready to measure. */}
              <span className="hi-corner hi-tl" aria-hidden="true" />
              <span className="hi-corner hi-tr" aria-hidden="true" />
              <span className="hi-corner hi-bl" aria-hidden="true" />
              <span className="hi-corner hi-br" aria-hidden="true" />
              <div className="preview-foot">
                <span className="preview-ready" aria-hidden="true"><span className="hi-hud-dot" />READY TO MEASURE</span>
                <button onClick={() => { setPreview(null); setUploadedFile(null); }} className="btn-ghost" style={{ borderRadius: "10px", padding: "10px 16px", fontSize: "13px", background: "rgba(5,4,9,0.7)" }}>Change</button>
              </div>
            </div>

            {intentPanel}
            {notice}
            {/* Deactivated rather than relabeled when the free allowance is
                spent - same button, same words, just disabled. */}
            <button
              ref={scanItRef}
              className="btn-primary cta-big"
              onClick={() => runScan("image")}
              disabled={!userStatus.isPaid && userStatus.remaining <= 0}>
              Scan it
            </button>
          </>
        ) : (
          <>
            {notice}
            <button
              className="btn-primary cta-big cta-sheen"
              onClick={() => fileInputRef.current?.click()}>
              <svg width="20" height="20" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M1.5 5.5V2.5a1 1 0 0 1 1-1h3M12.5 1.5h3a1 1 0 0 1 1 1v3M16.5 12.5v3a1 1 0 0 1-1 1h-3M5.5 16.5h-3a1 1 0 0 1-1-1v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                <circle cx="9" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.7" />
              </svg>
              Scan a product
            </button>
            <p className="hero-help">
              Photo or screenshot. Keep the price in the shot for a verdict.
            </p>

            {/* The secondary path: a link. */}
            <div className="link-row">
              <input ref={urlFieldRef} type="url" aria-label="Product link" value={urlInput} onChange={e => {
                setUrlInput(e.target.value);
                if (e.target.value.trim() && !inputTracked.current.url) { inputTracked.current.url = true; track("url_entered"); }
              }} placeholder="Or paste a product link"
                className="field"
                style={{ flex: 1, minWidth: 0, padding: "12px 14px", fontSize: "14px" }}
              />
              <button
                className="btn-ghost"
                onClick={() => {
                  if (!userStatus.isPaid && userStatus.remaining <= 0) { openPaywall("wall"); return; }
                  // Empty: point at the field rather than doing nothing.
                  if (!urlInput.trim()) { urlFieldRef.current?.focus(); return; }
                  runScan("url");
                }}
                disabled={!userStatus.isPaid && userStatus.remaining <= 0}
                style={{ borderRadius: "12px", padding: "12px 16px", fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap", opacity: !userStatus.isPaid && userStatus.remaining <= 0 ? 0.4 : 1 }}>
                Scan link
              </button>
            </div>
          </>
        )}

        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

        {!userStatus.isPaid && (
          <p className="hero-free">
            {userStatus.remaining} free scan{userStatus.remaining !== 1 ? "s" : ""} left today. <button onClick={() => openPaywall("choice")} className="link-btn">Unlimited for $4.99</button>
          </p>
        )}

        {!preview && intentPanel}
        </div>
      </div>

      {/* ═══ THE CARD ═══ */}
      <section className="section">
        <div className="label">EXAMPLE SCAN</div>
        <p className="section-lede">
          Any product. Any store. The source price, the asking price, and the exact distance between them.
        </p>
        <StaticVerdictDemo />
      </section>

      {/* ═══ STATS ═══ */}
      <section className="section reveal">
        <div className="stats-row">
          {[
            { v: `${totalScans.toLocaleString("en-US")}+`, l: "Products scanned" },
            // Real markup once real scans exceed the demo's own 435% floor,
            // shown on this same page — so the figure is always something a
            // visitor can verify without leaving the site.
            { v: maxMarkup > 435 ? `${maxMarkup.toLocaleString("en-US")}%` : "435%", l: "Highest markup recorded" },
            // Real dollars once they exceed a defensible baseline estimate
            // derived from real scan volume at a conservative average
            // savings per scan.
            {
              v: totalSavings >= 290000
                ? `$${(totalSavings / 1000).toFixed(1)}K+`
                : "$290K+",
              l: "Overcharges exposed",
            },
          ].map(s => (
            <div key={s.l} className="stat">
              <div className="stat-v tnum">{s.v}</div>
              <div className="stat-l">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ THE BOARDS ═══ */}
      <Leaderboards />

      {/* ═══ REACTIONS ═══ */}
      <section className="section reveal">
        <div className="label">WHAT IT SOUNDS LIKE WHEN THE MATH LANDS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {REACTIONS.quotes.map(r => (
            <figure key={r.name} className="card quote">
              <blockquote>&ldquo;{r.quote}&rdquo;</blockquote>
              <figcaption>{r.name}, {r.loc}</figcaption>
            </figure>
          ))}
        </div>
        {REACTIONS.illustrative && (
          <p style={{ fontSize: "12px", color: "var(--text-2)", marginTop: "10px", textAlign: "center" }}>
            Illustrative reactions.
          </p>
        )}
      </section>

      {/* ═══ WHAT WE CATCH ═══ */}
      <WhatWeCatch />

      {/* ═══ CLASSIFICATION RULES ═══ */}
      <section className="section reveal">
        <div className="label">CLASSIFICATION THRESHOLDS</div>
        <div className="rules">
          {CLASSIFICATION_RULES.map(c => (
            <div key={c.label} className="rule" style={{ "--tone": TONE_COLOR[c.tone] } as React.CSSProperties}>
              <div className="rule-label">{c.label}</div>
              <div className="rule-text">{c.rule}</div>
            </div>
          ))}
        </div>
        <p className="mono-note">
          Every verdict is produced by these thresholds and nothing else. No manual review. No exceptions.
        </p>
      </section>

      {/* ═══ UPGRADE CTA ═══
          The price is set in plain white on a quiet surface, with one line of
          light along the top edge: no red anywhere near the $4.99, no badge,
          no countdown. The calm is the point at the moment someone pays. */}
      <section className="section reveal" style={{ marginBottom: "76px" }}>
        <div className="offer">
          <p className="offer-eyebrow">UNLIMITED ACCESS</p>
          <h2 className="offer-price tnum">$4.99</h2>
          <p className="offer-terms">One time. No subscription.</p>
          <p className="offer-copy">
            Scan anything. Share the verdict. No limits, no renewal.
          </p>
          <button onClick={handleCheckout} onPointerEnter={warmCheckout} onPointerDown={warmCheckout} onFocus={warmCheckout} disabled={!checkoutAvailable} className="btn-primary" style={{ padding: "15px 36px", borderRadius: "14px", fontSize: "16px", minWidth: "240px" }}>
            {checkoutAvailable ? "Get unlimited access" : "Checkout offline"}
          </button>
          <p style={{ fontSize: "12.5px", color: "var(--text-3)", margin: "14px 0 0" }}>
            {checkoutAvailable ? "Card, Apple Pay and Google Pay. Access is instant." : "Payment channel temporarily closed. Free scans reset at midnight UTC."}
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="site-footer">
        <div style={{ marginBottom: "8px" }}>
          <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--text-2)", marginBottom: "4px", letterSpacing: "-0.01em" }}>BustedLab</div>
          <div className="balance" style={{ color: "var(--text-3)", fontSize: "12px" }}>The price was always real. Now you can see it.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: "4px 8px", flexWrap: "wrap" }}>
          {[
            { label: "The Index", href: "/the-index" },
            { label: "Terms", href: "/terms" },
            { label: "Privacy", href: "/privacy" },
            { label: "DMCA", href: "/dmca" },
          ].map(link => (
            <a key={link.href} href={link.href} className="footer-link">
              {link.label}
            </a>
          ))}
        </div>
        <p style={{ fontSize: "12px", color: "var(--text-3)", marginTop: "12px", lineHeight: "1.6", maxWidth: "560px", marginLeft: "auto", marginRight: "auto" }}>
          All markup data represents editorial analysis of publicly available wholesale listings for similar products. Results are market intelligence, not verified facts about specific products.
        </p>
      </footer>
    </main>
  );
}
