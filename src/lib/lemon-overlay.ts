/**
 * THE LEMON SQUEEZY OVERLAY.
 *
 * Checkout opens as an in-page modal instead of sending the visitor to
 * another domain. Every navigation away from a payment page is a chance to
 * lose the sale; an overlay keeps the product, the verdict that sold it, and
 * the "$4.99" all on screen while the card goes in.
 *
 * THREE DECISIONS WORTH KNOWING ABOUT.
 *
 * 1. LOADED ON INTENT, NOT ON EVERY PAGE VIEW. lemon.js is a third-party
 *    script, and until now the privacy policy could truthfully say no third-
 *    party script ran on this site. Loading it globally would put Lemon
 *    Squeezy's code on every visitor's page view, including the vast
 *    majority who never open checkout. Instead it is fetched the moment
 *    purchase intent appears - the upgrade screen opening, or a pointer or
 *    focus landing on a buy button - so by the time the click lands it is
 *    almost always already there, and the policy needs one narrow, honest
 *    exception rather than a blanket one. A dynamically inserted script
 *    never blocks rendering, which is the whole point of `defer` on a
 *    parser-inserted one. To load it on every page instead - for example if
 *    Lemon Squeezy's affiliate program is ever switched on, which needs the
 *    script present on landing pages to see referral links - call
 *    loadLemonJs() once from a top-level effect.
 *
 * 2. A PURCHASE CAN NEVER DEPEND ON THIS SCRIPT. Ad blockers, corporate
 *    proxies, a CSP someone tightens later, or the CDN having a bad minute
 *    can all stop it loading. If it has not loaded within a short wait, or
 *    loads but will not open, the caller falls back to the full-page checkout
 *    this app used before. The overlay is an improvement to the purchase,
 *    not a new way for it to fail.
 *
 * 3. TWO SOURCES. The integration spec named
 *    https://assets.lemonsqueezy.com/lemon.js. Lemon Squeezy's own Next.js
 *    template loads https://app.lemonsqueezy.com/js/lemon.js. Both are
 *    tried, in that order, so neither being retired breaks checkout.
 *
 * ONE UNCONFIRMED DETAIL. Url.Open and createLemonSqueezy are confirmed
 * against Lemon Squeezy's template. The success event - Setup({ eventHandler
 * }) and the "Checkout.Success" name - could not be checked against a
 * first-party source from the environment this was written in, so nothing
 * depends on it. Access is granted by the verified webhook, and the
 * confirmation modal is rendered by Lemon Squeezy itself. The handler only
 * tidies the page underneath: if the name were wrong, the sole effect would
 * be the on-page confirmation message not appearing behind the overlay.
 */

const SCRIPT_SOURCES = [
  "https://assets.lemonsqueezy.com/lemon.js",
  "https://app.lemonsqueezy.com/js/lemon.js",
] as const;

// How long a click is allowed to wait for the script before the full-page
// checkout takes over. Long enough for a slow mobile connection to fetch a
// small file; short enough that nobody is left looking at a button that did
// nothing.
const OPEN_TIMEOUT_MS = 4000;
const LOAD_TIMEOUT_MS = 8000;

let loading: Promise<boolean> | null = null;
let setupDone = false;
let onSuccess: (() => void) | null = null;

const overlayReady = () =>
  typeof window !== "undefined" && typeof window.LemonSqueezy?.Url?.Open === "function";

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); }
    );
  });
}

function injectScript(src: string): Promise<boolean> {
  return new Promise(resolve => {
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      script.remove();
      resolve(false);
    };
    document.head.appendChild(script);
  });
}

/**
 * After the script arrives. createLemonSqueezy() is what Lemon Squeezy's
 * template calls on mount in a client-rendered app; Setup registers the
 * event handler once for the page's lifetime and dispatches to whichever
 * callback the most recent open() supplied.
 */
function initialise(): void {
  try {
    window.createLemonSqueezy?.();
  } catch {
    /* an initialisation error surfaces as overlayReady() being false */
  }
  if (setupDone || typeof window.LemonSqueezy?.Setup !== "function") return;
  try {
    window.LemonSqueezy.Setup({
      eventHandler: event => {
        if (event?.event === "Checkout.Success") onSuccess?.();
      },
    });
    setupDone = true;
  } catch {
    /* see the note on the unconfirmed detail above */
  }
}

/** Fetches lemon.js once. Safe to call as often as intent is detected. */
export function loadLemonJs(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (overlayReady()) return Promise.resolve(true);
  if (loading) return loading;

  loading = (async () => {
    for (const src of SCRIPT_SOURCES) {
      const loaded = await withTimeout(injectScript(src), LOAD_TIMEOUT_MS, false);
      if (!loaded) continue;
      initialise();
      if (overlayReady()) return true;
    }
    // Leave the door open for a later attempt - a flaky network now is not a
    // reason to refuse the overlay for the rest of the session.
    loading = null;
    return false;
  })();
  return loading;
}

/**
 * The overlay wants embed=1 on the checkout URL. Added here, at the moment of
 * opening, and never to the configured link itself, so the full-page
 * fallback always receives the plain URL.
 */
export function withEmbed(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("embed", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Opens checkout as an overlay. Resolves true if it opened; false means the
 * caller must fall back to navigating to the plain URL.
 */
export async function openLemonOverlay(
  url: string,
  options: { onSuccess?: () => void } = {}
): Promise<boolean> {
  onSuccess = options.onSuccess ?? null;
  const ready = await withTimeout(loadLemonJs(), OPEN_TIMEOUT_MS, false);
  if (!ready || !overlayReady()) return false;
  try {
    window.LemonSqueezy!.Url!.Open(withEmbed(url));
    return true;
  } catch {
    return false;
  }
}
