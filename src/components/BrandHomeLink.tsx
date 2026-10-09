import Link from "next/link";

/**
 * The brand mark as a way home, for the pages that sit outside the scanner
 * (the legal pages). It replaces a bare "Back to BustedLab" text link: the
 * mark says whose page this is before anything else is read, which is the
 * job a logo does on a page about terms and data, and it is a full-size tap
 * target rather than a line of 14px text.
 */
export default function BrandHomeLink() {
  return (
    <Link
      href="/"
      aria-label="BustedLab home"
      style={{
        display: "inline-flex", alignItems: "center", gap: "10px",
        padding: "6px 8px 6px 0", minHeight: "44px", marginBottom: "28px",
        textDecoration: "none", color: "var(--text)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-120.webp" alt="" width={32} height={32} style={{ borderRadius: "8px", display: "block", objectFit: "cover" }} />
      <span className="brand-wordmark" style={{ fontSize: "18px" }}>BustedLab</span>
    </Link>
  );
}
