"use client";

import { useEffect } from "react";
import { track } from "@/lib/track";
import type { EventName } from "@/lib/analytics";

/** Counts one view of a server-rendered page, once per load. Renders nothing. */
export default function ViewBeacon({ event }: { event: EventName }) {
  useEffect(() => { track(event); }, [event]);
  return null;
}
