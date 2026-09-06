import { Metadata } from "next";

export const metadata: Metadata = {
  title: "DMCA Policy - BustedLab",
  description: "BustedLab DMCA copyright policy and takedown process.",
};

export default function DmcaPage() {
  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 24px 80px", color: "var(--text)", fontFamily: "'Inter', sans-serif" }}>
      <a href="/" style={{ color: "var(--accent-bright)", textDecoration: "none", fontSize: "14px", display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: "32px" }}>
        ← Back to BustedLab
      </a>

      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "32px", fontWeight: "700", letterSpacing: "-0.8px", marginBottom: "8px" }}>DMCA Policy</h1>
      <p style={{ color: "var(--text-3)", fontSize: "13px", marginBottom: "40px" }}>Last updated: September 2026 · BustedLab LLC, Wyoming, USA</p>

      <div style={{ display: "flex", flexDirection: "column", gap: "32px", fontSize: "15px", lineHeight: "1.75", color: "var(--text-2)" }}>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Safe Harbor</h2>
          <p>BustedLab LLC complies with the Digital Millennium Copyright Act (DMCA) and maintains safe harbor protection under 17 U.S.C. § 512. We have designated a DMCA agent registered with the US Copyright Office to receive copyright infringement notifications.</p>
          <p style={{ marginTop: "12px" }}>BustedLab does not store user-uploaded images after scan processing is complete. Images are processed in memory and discarded. Our scan results display publicly available wholesale marketplace images sourced through licensed commercial APIs.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Filing a Takedown Notice</h2>
          <p>If you believe content on BustedLab infringes your copyright, send a written notification to our designated DMCA agent containing all of the following:</p>
          <ol style={{ paddingLeft: "20px", marginTop: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <li>Your physical or electronic signature</li>
            <li>Identification of the copyrighted work you claim has been infringed</li>
            <li>Identification of the material you claim is infringing, with sufficient detail for us to locate it</li>
            <li>Your contact information (address, telephone, email)</li>
            <li>A statement that you have a good faith belief that the use is not authorized by the copyright owner, its agent, or the law</li>
            <li>A statement, under penalty of perjury, that the information in your notification is accurate and that you are the copyright owner or authorized to act on their behalf</li>
          </ol>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>DMCA Agent Contact</h2>
          <p>Send all DMCA notices to:<br />
          <strong style={{ color: "var(--text)" }}>DMCA Agent - BustedLab LLC</strong><br />
          Email: <a href="mailto:dmca@bustedlab.com" style={{ color: "var(--accent-bright)" }}>dmca@bustedlab.com</a><br />
          Address: c/o Registered Agent, Wyoming, USA</p>
          <p style={{ marginTop: "12px" }}>We respond to all valid DMCA notices within 48 hours.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Counter-Notices</h2>
          <p>If content you submitted was removed due to a DMCA notice and you believe the removal was in error, you may file a counter-notice. We will provide the standard counter-notice requirements upon request to <a href="mailto:dmca@bustedlab.com" style={{ color: "var(--accent-bright)" }}>dmca@bustedlab.com</a>.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Repeat Infringer Policy</h2>
          <p>BustedLab LLC will terminate, in appropriate circumstances, the accounts of users who are repeat infringers of intellectual property rights.</p>
        </section>
      </div>
    </main>
  );
}
