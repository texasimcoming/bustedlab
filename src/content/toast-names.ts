import { REACTIONS } from "@/content/reactions";

/**
 * First names for the placeholder activity toasts (src/components/LiveToast.tsx).
 *
 * None of them may be a name used in the reactions section. The quotes there
 * are labelled illustrative; a toast showing "Maya R." while a quote is
 * signed "Maya R., London" presented the same invented person as a live
 * user. Maya, Jordan and Tyler were in this list for exactly that reason and
 * were replaced, and the filter below keeps any future quote name out too.
 */
const POOL = [
  "Nico", "Ava", "Luca", "Sofia", "Amir", "Priya", "Chris", "Lena",
  "Noah", "Ines", "Zara", "Marcus", "Layla", "Devon", "Chloe", "Rafi", "Elena", "Jake",
  "Nadia", "Omar", "Bianca", "Kai", "Yasmin", "Leo", "Sasha", "Finn", "Mira", "Andre",
  "Talia", "Hugo", "Camille", "Ezra", "Dani", "Theo", "Isla", "Remy", "Jess", "Mateo",
  "Quinn", "Sage",
];

const QUOTE_FIRST_NAMES = new Set(REACTIONS.quotes.map(q => q.name.split(" ")[0].toLowerCase()));

export const TOAST_FIRST_NAMES: readonly string[] = POOL.filter(n => !QUOTE_FIRST_NAMES.has(n.toLowerCase()));
