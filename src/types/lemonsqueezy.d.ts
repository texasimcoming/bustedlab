// lemon.js, Lemon Squeezy's overlay checkout script. Every member is optional
// because the script is third-party, loaded on demand, and can be blocked -
// nothing in this app may assume it arrived. Url.Open and createLemonSqueezy
// are confirmed against Lemon Squeezy's own Next.js template
// (github.com/lmsqueezy/nextjs-billing); see src/lib/lemon-overlay.ts for the
// one member that could not be confirmed from a first-party source here.

interface LemonSqueezyEvent {
  event: string;
  data?: unknown;
}

interface LemonSqueezyUrl {
  Open: (url: string) => void;
  Close?: () => void;
}

interface LemonSqueezyInstance {
  Url?: LemonSqueezyUrl;
  Setup?: (options: { eventHandler?: (event: LemonSqueezyEvent) => void }) => void;
  Refresh?: () => void;
}

declare global {
  interface Window {
    LemonSqueezy?: LemonSqueezyInstance;
    createLemonSqueezy?: () => void;
  }
}

export {};
