"use client";

import type { EventName } from "@/lib/analytics";

/**
 * The client half of the counter. Three lines of real work and one important
 * choice inside them.
 *
 * sendBeacon, not fetch. The most valuable of the three events is the purchase
 * click, and that click is immediately followed by a navigation away from the
 * page. A fetch() started in that handler is cancelled the moment the browser
 * begins unloading, so the single event that sits closest to revenue would be
 * the one that never arrived. sendBeacon is queued by the browser and survives
 * unload, which is the entire reason the API exists.
 *
 * Fire and forget in every sense: no await, no error path, no return value.
 * Nothing on this page should ever slow down or break because a counter did.
 */
export function track(event: EventName): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({ event });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/event", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* a counter is never worth an exception */
  }
}
