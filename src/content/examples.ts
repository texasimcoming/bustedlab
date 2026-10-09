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
 *   Markup computed with the formula scan.ts uses: (22.99 - 4.30) / 4.30.
 *
 * Adding an example: drop the photo set into public/examples/ (see the shot
 * list in the design pull request) and add an entry with the two prices you
 * verified for it. The hero cycles through every entry; with one entry it
 * plays once and holds.
 */
export interface ExampleScan {
  id: string;
  /** Generic product name, never a brand: the card does not name a business. */
  title: string;
  /** The same name, short enough for the label on the photo. */
  label: string;
  asking: number;
  source: number;
  /** Percent, as calculateVerdict rounds it. */
  markup: number;
  savings: number;
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

export const EXAMPLE_SCANS: ExampleScan[] = [
  {
    id: "purple-strips",
    title: "Purple Teeth Whitening Strips (14ct / 7 sessions)",
    label: "Purple whitening strips",
    asking: 22.99,
    source: 4.3,
    markup: 435,
    savings: 18.69,
    photo: {
      base: "/demo/purple-whitening-strips",
      sizes: [480, 720, 960],
      alt: "A purple teeth whitening strip being applied",
      focus: "50% 72%",
    },
    thumb: "/demo/purple-whitening-strips-150.webp",
  },
];
