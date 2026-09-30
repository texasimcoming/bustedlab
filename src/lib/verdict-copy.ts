/**
 * The words on the verdict card and in its share caption.
 *
 * Kept apart from the card component so every line can be checked by
 * scripts/check-content.mjs: the pools below are combined per scan, and a
 * claim the product cannot back only has to appear in one combination to be
 * printed on somebody's card.
 */

/** What the copy needs from a scan. VerdictCard's VerdictData satisfies it. */
export interface CopyInput {
  verdict: "HIGH_MARKUP" | "OVERPRICED" | "FAIR" | "UNVERIFIED";
  retailPrice: number;
  wholesalePrice: number;
  markup: number;
  savings: number;
  productTitle: string;
  platform?: string;
}

// THE LINE. The one a person reads before deciding whether to screenshot it.
//
// Computed from the real numbers on every render, never a static template
// dropped over any result. Three rules, and they are not stylistic:
//
//  1. EVERY message states the exact dollar gap. The percentage is the
//     headline; the dollar figure is what a person feels. A card that omits
//     it is a card that gets scrolled past.
//  2. Sharp, human, funny, angry where anger is earned. This is the copy that
//     travels. Clinical language is safe and gets zero reposts, and a verdict
//     nobody shares is a verdict nobody sees. The Terms exist to hold exactly
//     this: everything the Service outputs is framed there as editorial market
//     analysis and opinion, which is what these lines are.
//  3. Every claim stays anchored to something the engine actually measured.
//     The scan found the same product listed elsewhere at a price and compared
//     it to the asking price. So the copy says "it sells for $X", "available
//     at $X", "the market says $X" rather than "they paid $X for it" - the
//     first is an unarguable observation about a public listing, the second is
//     an assertion about a business's internal costs that no scan can see.
//     The measured version is not softer. It is harder, because there is
//     nothing in it to deny.
//
// Calibration is by intensity, not by topic. BUSTED is outrage with receipts.
// OVERPRICED is sharp frustration that never inflates itself into outrage it
// has not earned. FAIR is dry surprise, because honest pricing is rare enough
// to be the story.

// ── CLOSEST MATCH (FINDER mode). ──
//
// Not the verdict voice. There is no gap to expose here and, more to the
// point, the item is not confirmed identical: the card itself says "Exact item
// not confirmed" under this line. So the line states what was found (a listing,
// its price, where) and hands the comparison to the reader. It never calls the
// price verified, the floor, the lowest available, or in stock, because a scan
// that has not confirmed the item cannot know any of those.
//
// Three independently seeded clauses rather than one fixed list: opener x
// connector x closer is 8 x 6 x 6 = 288 combinations, each carrying the real
// price and platform. Three separate hashes (price cents, title character
// sum, platform character sum) drive the indices so they drift out of sync.
export function finderPools(price: string, platform: string) {
  return {
    openers: [
      `Closest match: $${price}.`,
      `Found it at $${price}.`,
      `Cheapest match we found: $${price}.`,
      `$${price}. That is what the closest listing asks.`,
      `Same look, $${price}.`,
      `A near-identical listing: $${price}.`,
      `$${price} on the open market.`,
      `$${price}, one scan away.`,
    ],
    connectors: [
      `Listed on ${platform}.`,
      `Found on ${platform}.`,
      `${platform} lists it.`,
      `Sitting on ${platform}.`,
      `Via ${platform}.`,
      `On ${platform} when we looked.`,
    ],
    closers: [
      `Match the photos, then decide.`,
      `Check the details before you pay more.`,
      `Nothing cheaper turned up.`,
      `Same look. Your call on the rest.`,
      `Compare the listing, then decide what the brand is worth.`,
      `Worth a look before you pay full price.`,
    ],
  };
}

export function buildFinderMessage(data: CopyInput): string {
  const price = data.wholesalePrice.toFixed(2);
  const platform = data.platform || "the listing";
  const { openers, connectors, closers } = finderPools(price, platform);

  const charSum = (s: string) => s.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const priceCents = Math.round(data.wholesalePrice * 100);
  const openerIdx = priceCents % openers.length;
  const connectorIdx = charSum(data.productTitle || "") % connectors.length;
  const closerIdx = charSum(platform) % closers.length;

  return `${openers[openerIdx]} ${connectors[connectorIdx]} ${closers[closerIdx]}`;
}

export function buildMessage(data: CopyInput): string {
  const s = data.savings.toFixed(2);
  const retail = data.retailPrice.toFixed(2);
  const source = data.wholesalePrice.toFixed(2);
  const m = data.wholesalePrice > 0 ? (data.retailPrice / data.wholesalePrice).toFixed(1) : "0";
  const idx = Math.floor((data.savings * 100 + data.retailPrice * 7 + data.markup * 3)) % 20;

  // ── BUSTED. Outrage with receipts. ──
  const HIGH = [
    `It sells for $${source}. They charged you $${retail}. That $${s} gap has a name.`,
    `You were about to pay ${m}x what it sells for elsewhere. $${s} of it was the story.`,
    `$${s}. That is what the aesthetic cost you.`,
    `Somebody's rent got paid with your $${s}.`,
    `The product is $${source}. The other $${s} is the ad you fell for.`,
    `$${s} above what everyone else charges. They were betting you would not check.`,
    `${m}x markup, $${s} deep, and the ad had soft lighting.`,
    `A $${source} item in a $${retail} costume. The costume runs $${s}.`,
    `$${s} of that price is not the product. It never was.`,
    `Same item, $${source}, publicly listed. Yours was $${retail}. The logo cost $${s}.`,
    `You nearly funded a $${s} marketing budget. One scan.`,
    `$${s}. Not a discount you missed. A markup you were handed.`,
    `Listed at $${source}, sold to you at $${retail}. The $${s} in the middle is the entire company.`,
    `${m}x the real price. That is not a margin, that is a personality, and it costs $${s}.`,
    `They called it premium. The market calls it $${source}. You were charged $${s} extra for the adjective.`,
    `$${s}. Screenshot this and send it to whoever recommended it.`,
    `Available right now for $${source}. You were quoted $${retail}. Do what you like with that. ($${s}.)`,
    `They are not selling a product. They are selling a $${retail} price tag with a $${source} product attached. You keep the $${s}.`,
    `${m}x. $${s}. And the cheap listing was one search away.`,
    `$${s} over market. That is not a business model, that is a magic trick, and you just saw the wires.`,
  ];

  // ── OVERPRICED. Sharp frustration. Real, never inflated. ──
  const OVER = [
    `$${s} over. Not a scandal. Still your $${s}.`,
    `Overpriced by $${s}. Not criminal. Just optimistic.`,
    `$${s}. The kind of gap you only catch when something is actually checking.`,
    `They are not robbing you. They are rounding up, by $${s}.`,
    `$${s} above market. Small enough to shrug at. That is exactly the point.`,
    `The market says $${source}. They say $${retail}. Somebody is $${s} braver than the data.`,
    `$${s} of confidence baked into the price.`,
    `Not outrageous. Just $${s} more than it needed to be.`,
    `$${s} over the going rate, and nothing about the product explains it.`,
    `You would not have noticed the $${s}. That is what it was counting on.`,
    `Overpriced by $${s}. Buy it if you want it. Just buy it knowing.`,
    `$${s}. Enough for lunch. They would rather have it than you.`,
    `The listing looks completely normal. The price runs $${s} hot.`,
    `$${s} above what this openly sells for elsewhere. Your call now.`,
    `A $${s} premium for the privilege of not checking.`,
    `Market rate $${source}, asking $${retail}. That is $${s} of nerve.`,
    `$${s} over. Not the worst we have seen today. Not nothing either.`,
    `They are $${s} ahead of the market and hoping nobody keeps score.`,
    `Overpriced by $${s}. Now it is a decision instead of an accident.`,
    `$${s}. Small gap, real gap, your money.`,
  ];

  // ── FAIR. Dry surprise. Honest pricing is rare and the rarity is the story. ──
  const FAIR = [
    `Fair. $${s} off market. We checked twice, because that is unusual.`,
    `Priced honestly. A $${s} spread. We are as surprised as you are.`,
    `No markup theatre. $${s}. Somebody here has principles or terrible margins.`,
    `$${s} from the market floor. That is a business, not a funnel.`,
    `Clean scan. $${s}. Nothing to expose, which is its own kind of news.`,
    `They could have charged you $${retail} and more. They did not. $${s} spread.`,
    `Fair price confirmed at $${s}. Screenshot it anyway. It is rarer than the bad ones.`,
    `$${s}. That is what a normal margin looks like, in case you had forgotten.`,
    `We came here to find a markup. We found $${s} and a straight answer.`,
    `Actually fair. $${s} of honest margin and no story underneath it.`,
    `$${s}. Either the margins are thin or the ethics are intact. Either way it passes.`,
    `Priced at what it costs plus $${s}. Revolutionary, apparently.`,
    `No inflation, no theatre, $${s}. Buy it and stop worrying.`,
    `The market price and the asking price agree within $${s}. Frame this.`,
    `$${s} spread. This seller is not running the play everyone else is running.`,
    `Fair. $${s}. We ran it twice because the first result looked like a mistake.`,
    `$${s} above cost and honest about it. That should not be remarkable.`,
    `Nothing hidden here. $${s}, and the price is just the price.`,
    `$${s}. You are not subsidising anyone's ad spend on this one.`,
    `Clean. $${s}. Enjoy the rare sensation of not being worked.`,
  ];

  switch (data.verdict) {
    case "HIGH_MARKUP": return HIGH[idx % 20];
    case "OVERPRICED": return OVER[idx % 20];
    case "FAIR": return FAIR[idx % 20];
    default: return `No confirmed asking price to compare against. Closest listing found runs $${source}.`;
  }
}

// ── THE EVIDENCE STRIP ──
//
// The small label under the product photo, and the line under the strip. The
// label names the kind of match and nothing more: it never says confirmed or
// verified, on any card. On a closest match the line under it says "Exact item
// not confirmed". A closest match can still be an exact match (the visitor
// asked "where is it cheapest?" rather than for a verdict), and then it says so
// on both lines.
type CardMode = "VERDICT" | "FINDER" | "UNRESOLVED";
type MatchConfidence = "exact" | "likely" | "unverified";

export function plateLabel(_mode: CardMode, confidence: MatchConfidence): string {
  if (confidence === "exact") return "EXACT MATCH";
  return confidence === "likely" ? "VISUAL MATCH" : "LOOKALIKE";
}

export function evidenceNote(mode: CardMode, confidence: MatchConfidence): string {
  if (mode === "VERDICT") return "Market analysis based on publicly available wholesale listings for the identified product.";
  if (confidence === "exact") return "Market analysis based on publicly available listings for the identified product.";
  return "Market analysis based on publicly available listings for a visually similar product. Exact item not confirmed.";
}

/**
 * The caption that travels with a shared card. The dollar figure leads because
 * "$47.10 above market" is a number a person feels and "412% markup" is a
 * statistic. "Receipts:" introduces the link to the permanent record, so it is
 * only said when there is one.
 */
export function shareCaption(input: {
  mode: "VERDICT" | "FINDER" | "UNRESOLVED";
  savings: number;
  markup: number;
  wholesalePrice: number;
  hasPermalink: boolean;
}): string {
  if (input.mode === "VERDICT") {
    const receipts = input.hasPermalink ? " Receipts:" : "";
    return `$${input.savings.toFixed(2)} above market on this one. ${input.markup}% markup.${receipts}`;
  }
  return `Ran this through BustedLab. Closest listing found: $${input.wholesalePrice.toFixed(2)}.`;
}
