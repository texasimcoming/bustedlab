/**
 * "What we catch" on the landing page.
 *
 * The section shows real ledger records - one per product, the biggest
 * verified gaps, each linking to its permanent /scan/[id] page - once the
 * ledger holds at least REAL_CATCHES_MINIMUM distinct products that qualify
 * (see getTopSavingsProducts in src/lib/redis.ts). Until then it shows the
 * set below, under the label "Illustrative examples." These are not
 * measurements.
 */
export const REAL_CATCHES_MINIMUM = 8;

export interface IllustrativeCatch {
  /** Category glyph: see src/components/CategoryGlyph.tsx. */
  icon: string;
  /** Category name shown in bold. */
  c: string;
  /** The asking price, struck through. */
  x: string;
  /** The source price. */
  r: string;
}

export const ILLUSTRATIVE_CATCHES: IllustrativeCatch[] = [
  { icon: "beauty", c: "Beauty", x: "$68 serum", r: "$7.80 real" },
  { icon: "accessories", c: "Accessories", x: "$95 watch", r: "$8.20 real" },
  { icon: "fitness", c: "Fitness", x: "$120 set", r: "$14.80 real" },
  { icon: "home", c: "Home", x: "$85 diffuser", r: "$9.40 real" },
  { icon: "fashion", c: "Fashion", x: "$110 dress", r: "$18.60 real" },
  { icon: "pet", c: "Pet products", x: "$55 feeder", r: "$6.90 real" },
  { icon: "tech", c: "Tech gadgets", x: "$89 massage gun", r: "$12.40 real" },
  { icon: "skincare", c: "Skincare", x: "$140 LED device", r: "$16.80 real" },
];

/**
 * A real record as the landing page receives it from /api/leaderboard: only
 * fields the public index already shows for the same record.
 */
export interface RealCatch {
  id: string;
  title: string;
  category: string;
  retailPrice: number;
  wholesalePrice: number;
  savings: number;
}
