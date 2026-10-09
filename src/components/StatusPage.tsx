import BrandHomeLink from "@/components/BrandHomeLink";

/**
 * The frame for every one-message page: not found, a broken page, signing
 * in, unsubscribing. The same light from above as the rest of the site, the
 * brand mark as the way home, and the instrument's brackets around a short
 * readout, so a visitor who lands here from a cut-off link is still plainly
 * inside BustedLab and one tap from the scanner.
 */
export default function StatusPage({
  label,
  readout,
  children,
}: {
  /** The mono caption above the headline. */
  label?: string;
  /** A few characters in the brackets (for example "404"). None: no brackets. */
  readout?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="status-page">
      <div className="page-light" aria-hidden="true" />
      <header className="status-head"><BrandHomeLink /></header>
      <div className="status-body">
        {readout && (
          <div className="status-reticle" aria-hidden="true">
            <span className="hi-corner hi-tl" />
            <span className="hi-corner hi-tr" />
            <span className="hi-corner hi-bl" />
            <span className="hi-corner hi-br" />
            <span className="status-readout">{readout}</span>
          </div>
        )}
        {label && <div className="status-label">{label}</div>}
        {children}
      </div>
    </main>
  );
}
