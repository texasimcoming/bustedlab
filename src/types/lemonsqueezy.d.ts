interface LemonSqueezyUrl {
  Open: (url: string) => void;
}

interface LemonSqueezyInstance {
  Url?: LemonSqueezyUrl;
}

declare global {
  interface Window {
    LemonSqueezy?: LemonSqueezyInstance;
  }
}

export {};
