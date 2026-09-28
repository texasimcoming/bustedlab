// Custom category glyphs, drawn in the site's own visual grammar (thin
// strokes, open geometry, the same accent palette used everywhere else)
// rather than pulling in stock emoji. Each one is a small original mark,
// not a recognizable pictogram borrowed from elsewhere.
export default function CategoryGlyph({ type }: { type: string }) {
  const s = "var(--accent-2)";
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none" as const };
  switch (type) {
    case "beauty": // a single droplet caught mid-fall inside an open ring
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="13" r="7.5" stroke={s} strokeWidth="1.2" opacity="0.35" />
          <path d="M12 6 C14.5 9.5 15.8 11.8 15.8 13.6 C15.8 15.8 14.1 17.2 12 17.2 C9.9 17.2 8.2 15.8 8.2 13.6 C8.2 11.8 9.5 9.5 12 6 Z" stroke={s} strokeWidth="1.3" />
        </svg>
      );
    case "accessories": // two interlocked open rings, offset
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="9.5" cy="12" r="5.5" stroke={s} strokeWidth="1.3" />
          <circle cx="15.5" cy="12" r="5.5" stroke={s} strokeWidth="1.3" opacity="0.5" />
        </svg>
      );
    case "fitness": // asymmetric weight bar, mid-lift
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 12 L20 12" stroke={s} strokeWidth="1.4" strokeLinecap="round" />
          <rect x="2.5" y="9" width="3" height="6" rx="1" stroke={s} strokeWidth="1.2" />
          <rect x="6.5" y="7" width="2.5" height="10" rx="1" stroke={s} strokeWidth="1.2" opacity="0.7" />
          <rect x="18.5" y="9" width="3" height="6" rx="1" stroke={s} strokeWidth="1.2" />
        </svg>
      );
    case "home": // an open pentagon roofline over a single floating dot
      return (
        <svg {...common} aria-hidden="true">
          <path d="M5 12 L12 6 L19 12 L19 18 L5 18 Z" stroke={s} strokeWidth="1.3" strokeLinejoin="round" />
          <circle cx="12" cy="15" r="1.3" fill={s} opacity="0.8" />
        </svg>
      );
    case "fashion": // a hanger reduced to its essential triangle and hook
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 5.5 C12 6.8 11 7 11 8" stroke={s} strokeWidth="1.2" strokeLinecap="round" />
          <path d="M12 8 L4 14.5 L20 14.5 Z" stroke={s} strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M4 14.5 L2.5 17.5 L21.5 17.5 L20 14.5" stroke={s} strokeWidth="1.1" opacity="0.6" />
        </svg>
      );
    case "pet": // a small paw reduced to four offset circles
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="15" r="3.2" stroke={s} strokeWidth="1.2" />
          <circle cx="7.5" cy="9.5" r="1.6" stroke={s} strokeWidth="1.1" opacity="0.75" />
          <circle cx="12" cy="7.5" r="1.6" stroke={s} strokeWidth="1.1" opacity="0.75" />
          <circle cx="16.5" cy="9.5" r="1.6" stroke={s} strokeWidth="1.1" opacity="0.75" />
        </svg>
      );
    case "tech": // an open bracket around a single pulse line
      return (
        <svg {...common} aria-hidden="true">
          <path d="M8 5.5 L5 5.5 L5 18.5 L8 18.5" stroke={s} strokeWidth="1.3" strokeLinecap="round" />
          <path d="M16 5.5 L19 5.5 L19 18.5 L16 18.5" stroke={s} strokeWidth="1.3" strokeLinecap="round" />
          <path d="M9 12 L11 12 L12.5 8.5 L14 15.5 L15.5 12 L17 12" stroke={s} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
        </svg>
      );
    case "skincare": // a radiant point, four rays, off-axis
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="12" r="3" stroke={s} strokeWidth="1.3" />
          <path d="M12 3.5 L12 6.5" stroke={s} strokeWidth="1.2" strokeLinecap="round" />
          <path d="M12 17.5 L12 20.5" stroke={s} strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
          <path d="M20.5 12 L17.5 12" stroke={s} strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
          <path d="M6.5 12 L3.5 12" stroke={s} strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}
