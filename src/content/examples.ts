/**
 * THE EXAMPLE SCANS.
 *
 * What the landing page shows before anyone has scanned anything: the hero
 * instrument at the top and the example verdict card under it. Both read
 * from here, so the photo, the two prices and the markup can never disagree.
 *
 * Every entry is a real measurement, labelled EXAMPLE wherever it is shown:
 *
 * - Purple teeth whitening strips (14 strips / 7 sessions).
 *   Source $4.30: a live AliExpress "Hello Smile Store" listing for the same
 *   7-pair configuration, at time of writing.
 *   Asking $22.99: the TikTok Shop list price for the identical 14-strip /
 *   7-session configuration of the top-selling purple whitening strips in the
 *   category (992K+ sold). Same product shape, independently verified, not
 *   the same listing.
 *   Markup, gap and verdict computed by calculateVerdict (src/lib/verdict.ts).
 *
 * Adding an example: drop the photo set into public/examples/ (see the shot
 * list in docs/PROJECT.md) and add an entry with the two prices you verified
 * for it; the markup and the verdict are worked out from them. The hero cycles through every entry; with one entry it
 * plays once and holds.
 */
import { calculateVerdict, type Verdict } from "@/lib/verdict";

/** What an example is entered as: the two prices you verified, and its photo. */
interface ExampleInput {
  id: string;
  /** Generic product name, never a brand: the card does not name a business. */
  title: string;
  /** The same name, short enough for the label on the photo. */
  label: string;
  asking: number;
  source: number;
  photo: {
    /** Square photo; sizes are its pixel widths. */
    base: string;
    sizes: number[];
    alt: string;
    /** object-position for the hero's wide crop, so the product stays in frame. */
    focus: string;
  };
  /** Small square for the card's evidence strip. */
  thumb: string;
}

const INPUTS: ExampleInput[] = [
  {
    id: "purple-strips",
    title: "Purple Teeth Whitening Strips (14ct / 7 sessions)",
    label: "Purple whitening strips",
    asking: 22.99,
    source: 4.3,
    photo: {
      base: "/demo/purple-whitening-strips",
      sizes: [480, 720, 960],
      alt: "A purple teeth whitening strip being applied",
      focus: "50% 72%",
    },
    thumb: "/demo/purple-whitening-strips-150.webp",
  },
];

/**
 * An example as the page shows it. The markup, the gap and the verdict are
 * computed by calculateVerdict, the function every real scan uses, so an
 * example can never show a number or a label the engine would not.
 */
export interface ExampleScan extends ExampleInput {
  markup: number;
  savings: number;
  verdict: Verdict;
}

export const EXAMPLE_SCANS: ExampleScan[] = INPUTS.map(input => {
  const { markup, savings, verdict } = calculateVerdict(input.asking, input.source);
  return { ...input, markup, savings, verdict };
});
