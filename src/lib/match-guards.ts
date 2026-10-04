/**
 * MATCH GUARDS: what the gate's "exact" and "likely" must also survive.
 *
 * The gate is a model looking at pictures, and the production evaluation
 * caught it calling lookalikes the product: a Cuernos Chuecos hat for a
 * Yellowstone one, a Cult Flex massage gun for a Flowlife Flowgun Air, a
 * single replacement earbud for a pair of AirPods. Every one of those came
 * with its reason written next to it, and the reasons were shape and colour.
 * These rules are applied to every answer after the model gives it, in
 * code, so they hold whatever the model says:
 *
 *   brand_veto       a brand was read off the photo and the listing does not
 *                    carry it (title, seller or link): never exact or likely.
 *   no_brand_likely  no brand was read off the photo: only "exact" counts,
 *                    and "likely" is an honest lookalike.
 *   part_listing     the listing sells a piece, a part or an accessory (one
 *                    earbud, the case only, a replacement part, for parts)
 *                    and the photo's read does not say it shows one: never
 *                    exact or likely.
 *   no_tie           the gate named nothing that ties the photo to the
 *                    listing (a logo, printed text, a distinctive part, the
 *                    identical product photo): never exact or likely.
 *
 * A guarded answer becomes "similar", which is what the engine already does
 * with a lookalike: it can still be shown, labelled for what it is, and it
 * never carries a markup verdict. scripts/check-match-guards.mjs runs these
 * same functions over every stored labelled result.
 *
 * Zero imports, like gate-prompt.ts, so that check runs the shipped rules.
 */
export type GateMatch = "exact" | "likely" | "similar" | "different";

/** What ties a candidate to the photo, as the gate names it. See buildBatchPrompt. */
export const TIE_KINDS = ["logo", "text", "part", "photo", "none"] as const;
export type TieKind = (typeof TIE_KINDS)[number];

export type GuardName = "brand_veto" | "no_brand_likely" | "part_listing" | "no_tie";

export interface GuardCandidate {
  title: string;
  source?: string;
  link?: string;
}

/**
 * What the first read saw on the photo. `brand` is undefined when there was
 * no first read at all (a link scan reads the page, not a photo): the two
 * brand rules then have nothing to compare and do not apply.
 */
export interface GuardRead {
  brand?: string;
  productName?: string;
}

export interface GuardAnswer {
  match: GateMatch;
  /** The gate's tie. Undefined only for answers recorded before the gate named one. */
  tie?: string;
}

const fold = (text: string): string =>
  String(text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const squash = (text: string): string => fold(text).replace(/[^a-z0-9]/g, "");
const words = (text: string): string[] => fold(text).split(/[^a-z0-9]+/).filter(Boolean);

// Words a brand name can start with that say nothing about the brand.
const BRAND_FILLER = new Set(["the", "by", "and", "les", "der", "die", "das", "los", "las"]);

/**
 * Whether a listing carries the brand read off the photo. Compared without
 * spaces, case, accents or punctuation, so "Ray-Ban", "RayBan" and "ray ban"
 * agree; a brand read with a suffix ("Stanley 1913") is also carried by its
 * first word. Short brands ("LG", "HP") must be a whole word, so "lg" is not
 * found inside "bulgaria".
 */
export function carriesBrand(brand: string, candidate: GuardCandidate): boolean {
  const wanted = squash(brand);
  if (!wanted) return true;
  const text = `${candidate.title || ""} ${candidate.source || ""} ${linkWords(candidate.link || "")}`;
  const tokens = new Set(words(text));
  if (wanted.length <= 3) return tokens.has(wanted);
  if (squash(text).includes(wanted)) return true;
  const first = words(brand).find(w => !BRAND_FILLER.has(w)) || "";
  return first.length >= 4 && tokens.has(first);
}

/** A link's host and path as words: "stanley1913.com/products/quencher" carries "stanley". */
function linkWords(link: string): string {
  try {
    const url = new URL(link);
    return `${url.hostname} ${decodeURIComponent(url.pathname)}`;
  } catch {
    return "";
  }
}

// A listing for a piece of a product, a part of it, or something sold for it.
const PART_WORDS = "case|box|charger|lid|strap|band|cable|cover|remote|dock|stand|base|tips?|cushions?|pads?|refills?|filters?|heads?";
const PIECE = /\b(left|right)\b[^|()]{0,30}\bonly\b|\bonly\b[^|()]{0,12}\b(left|right)\b|\b(left|right|single|one)\s+(side\s+|ear\s+)?(airpods?|ear\s?buds?|buds?|earphones?|headphones?)\b/;
const PART_ONLY = new RegExp(`\\b(${PART_WORDS})\\s+only\\b`);
const SPARE = /\breplacement\b|\bfor parts\b|\bparts only\b|\bempty box\b|\bnot working\b/;

/**
 * Whether a listing sells a piece or a part of a product rather than the
 * product the photo shows. A photo that is itself of the piece or the part
 * (its read names it among its first words: "left AirPods Pro earbud",
 * "charging case for AirPods Pro", "replacement brush head") exempts it.
 */
export function isPartListing(candidate: GuardCandidate, read: GuardRead): boolean {
  const title = fold(candidate.title || "");
  const shown = fold(read.productName || "");
  const lead = shown.split(/[^a-z0-9]+/).filter(Boolean).slice(0, 4).join(" ");
  if (PIECE.test(title) && !/\b(left|right|single|one)\b/.test(lead)) return true;
  const part = title.match(PART_ONLY)?.[1];
  if (part && !new RegExp(`\\b${part}\\b`).test(lead)) return true;
  if (SPARE.test(title) && !/\b(replacement|parts?|spare)\b/.test(lead)) return true;
  return false;
}

/** The tie as a known kind; anything missing or unrecognised is "none". */
export function readTie(raw: unknown): TieKind {
  const text = String(raw ?? "").trim().toLowerCase();
  return (TIE_KINDS as readonly string[]).includes(text) ? (text as TieKind) : "none";
}

/**
 * The answer the engine acts on, and the guard that changed it, if any.
 * Only "exact" and "likely" are ever changed, and only ever to "similar".
 */
export function guardMatch(
  answer: GuardAnswer,
  candidate: GuardCandidate,
  read: GuardRead
): { match: GateMatch; guard: GuardName | null } {
  const { match } = answer;
  if (match !== "exact" && match !== "likely") return { match, guard: null };
  if (read.brand !== undefined) {
    const brand = String(read.brand).trim();
    if (squash(brand) && !carriesBrand(brand, candidate)) return { match: "similar", guard: "brand_veto" };
    if (!squash(brand) && match === "likely") return { match: "similar", guard: "no_brand_likely" };
  }
  if (isPartListing(candidate, read)) return { match: "similar", guard: "part_listing" };
  if (answer.tie !== undefined && readTie(answer.tie) === "none") return { match: "similar", guard: "no_tie" };
  return { match, guard: null };
}
