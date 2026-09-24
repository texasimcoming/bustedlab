"use client";

import { useEffect, useState } from "react";
import VerdictCard, { type VerdictData } from "@/components/VerdictCard";

/**
 * The card on a shared scan page.
 *
 * A client wrapper exists for one reason: the card renders at two different
 * sizes and the choice depends on viewport width, which a server component
 * cannot know. Getting this wrong is what made every desktop result render the
 * compact phone card for the entire life of the product before the last audit,
 * so it is worth the wrapper.
 *
 * The full slam animation runs. Someone arriving from a shared link is seeing
 * this for the first time and should get the same 90ms landing the scanner
 * gives, not a static image of one. The tone does NOT play: there has been no
 * user gesture on this page, so audio would be both hostile and blocked.
 */
export default function SharedVerdict({ data }: { data: VerdictData }) {
  const [isMobile, setIsMobile] = useState(true);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 600);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return <VerdictCard data={data} animate compact={isMobile} />;
}
