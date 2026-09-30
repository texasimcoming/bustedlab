import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "DMCA Policy - BustedLab",
  description: "BustedLab DMCA copyright policy and takedown process.",
};

export default function DmcaPage() {
  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 24px 80px", color: "var(--text)", fontFamily: "var(--font-sans), sans-serif" }}>
      <Link href="/" style={{ color: "var(--accent-bright)", textDecoration: "none", fontSize: "14px", display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: "32px" }}>
        ← Back to BustedLab
      </Link>

      <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "32px", fontWeight: "700", letterSpacing: "-0.8px", marginBottom: "8px" }}>DMCA Policy</h1>
      <p style={{ color: "var(--text-3)", fontSize: "13px", marginBottom: "40px" }}>DMCA policy version 3.0 · BustedLab LLC, Wyoming, USA</p>

      <div style={{ display: "flex", flexDirection: "column", gap: "32px", fontSize: "15px", lineHeight: "1.75", color: "var(--text-2)" }}>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Safe Harbor</h2>
          <p>BustedLab LLC complies with the Digital Millennium Copyright Act (DMCA) and responds to notifications sent to the designated agent below.</p>
          <p style={{ marginTop: "12px" }}>BustedLab does not host a user-content library. Images you upload for a scan are processed for that scan and deleted; see the <a href="/privacy" style={{ color: "var(--accent-bright)" }}>Privacy Policy</a> for exactly how and when. Product images shown in scan results are retrieved from publicly available merchant listings through commercial search APIs and displayed for price comparison and commentary.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Filing a Takedown Notice</h2>
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
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>DMCA Agent Contact</h2>
          <p>Send all DMCA notices to:<br />
          <strong style={{ color: "var(--text)" }}>DMCA Agent - BustedLab LLC</strong><br />
          Email: <a href="mailto:dmca@bustedlab.com" style={{ color: "var(--accent-bright)" }}>dmca@bustedlab.com</a><br />
          Address: c/o Registered Agent, Wyoming, USA</p>
          <p style={{ marginTop: "12px" }}>Valid notices are actioned promptly, and in any case within the timeframes required by 17 U.S.C. § 512.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Counter-Notices</h2>
          <p>If content you submitted was removed due to a DMCA notice and you believe the removal was in error, you may file a counter-notice. We will provide the standard counter-notice requirements upon request to <a href="mailto:dmca@bustedlab.com" style={{ color: "var(--accent-bright)" }}>dmca@bustedlab.com</a>.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Repeat Infringer Policy</h2>
          <p>BustedLab LLC will terminate, in appropriate circumstances, the accounts of users who are repeat infringers of intellectual property rights.</p>
        </section>
      </div>
    </main>
  );
}
