/**
 * The quotes in the landing page's reactions section. This file is content,
 * not code: replacing the quotes here changes the page without touching any
 * component.
 *
 * These are illustrative: written to show what the moment of a verdict
 * landing sounds like in a human voice, not collected from named customers.
 * While `illustrative` is true the section carries the label "Illustrative
 * reactions." under them. Set it to false only when every quote in `quotes`
 * is a real customer's, used with their permission; the label then goes away.
 */
export interface Reaction {
  name: string;
  loc: string;
  quote: string;
}

export const REACTIONS: { illustrative: boolean; quotes: Reaction[] } = {
  illustrative: true,
  quotes: [
    { name: "Maya R.", loc: "London", quote: "I scanned the face roller I almost bought for $74. $2.90. I screamed." },
    { name: "Jordan K.", loc: "Toronto", quote: "Showed my whole group chat. Now we scan everything before buying anything." },
    { name: "Tyler M.", loc: "Austin", quote: "Sent the verdict card straight to the brand's comments. They deleted it within the hour." },
  ],
};
