"use client";

import VerdictCard, { type VerdictData } from "@/components/VerdictCard";

/**
 * The card on a shared scan page.
 *
 * The card renders at two different sizes and the choice depends on viewport
 * width, which the server cannot know. Getting this wrong is what made every
 * desktop result render the compact phone card for the entire life of the
 * product before an earlier audit. Choosing in JavaScript after mount fixed
 * that but drew the phone card first and swapped it a moment later, so both
 * are rendered and CSS shows the one that fits.
 *
 * The full slam animation runs. Someone arriving from a shared link is seeing
 * this for the first time and should get the same 90ms landing the scanner
 * gives, not a static image of one. The tone does NOT play: there has been no
 * user gesture on this page, so audio would be both hostile and blocked.
 */
export default function SharedVerdict({ data }: { data: VerdictData }) {
  // Both sizes are rendered and CSS shows the one that fits (globals.css,
  // .demo-compact / .demo-full), so the card never swaps size after load.
  return (
    <>
      <div className="demo-compact"><VerdictCard data={data} animate compact /></div>
      <div className="demo-full"><VerdictCard data={data} animate /></div>
    </>
  );
}
