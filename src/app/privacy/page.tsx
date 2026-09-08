import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy - BustedLab",
  description: "How BustedLab collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 24px 80px", color: "var(--text)", fontFamily: "'Inter', sans-serif" }}>
      <a href="/" style={{ color: "var(--accent-bright)", textDecoration: "none", fontSize: "14px", display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: "32px" }}>
        ← Back to BustedLab
      </a>

      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "32px", fontWeight: "700", letterSpacing: "-0.8px", marginBottom: "8px" }}>Privacy Policy</h1>
      <p style={{ color: "var(--text-3)", fontSize: "13px", marginBottom: "40px" }}>Last updated: September 2026 · BustedLab LLC, Wyoming, USA</p>

      <div style={{ display: "flex", flexDirection: "column", gap: "32px", fontSize: "15px", lineHeight: "1.75", color: "var(--text-2)" }}>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Who We Are</h2>
          <p>BustedLab LLC is a Wyoming-registered consumer intelligence company operating the website bustedlab.com. We are committed to protecting your privacy and handling your data with transparency and respect.</p>
          <p style={{ marginTop: "12px" }}>For GDPR purposes, BustedLab LLC is the data controller. Contact us at <a href="mailto:privacy@bustedlab.com" style={{ color: "var(--accent-bright)" }}>privacy@bustedlab.com</a>.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>What We Collect</h2>
          <p><strong style={{ color: "var(--text)" }}>Email address</strong> - collected only when you purchase unlimited access or request a sign-in link. Used exclusively for authentication and service delivery. We never sell your email or use it for advertising.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>IP address</strong> - collected temporarily to enforce free tier scan limits (2 per day). Stored in encrypted Redis with automatic expiry at midnight UTC daily. Not linked to any personal identity.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>Uploaded images</strong> - product screenshots uploaded for scanning are processed in memory and are not stored on our servers after the scan is complete.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>Payment data</strong> - handled entirely by Lemon Squeezy, our Merchant of Record. BustedLab never sees or stores your card details. We receive only your email address upon successful payment.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>Scan metadata</strong> - anonymized, aggregated data about scan volume and product categories may be retained to improve the service. This data cannot be used to identify individual users.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Legal Basis for Processing (GDPR)</h2>
          <p>We process your data under the following legal bases:</p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <li><strong style={{ color: "var(--text)" }}>Contract</strong> - processing your email to deliver the service you paid for.</li>
            <li><strong style={{ color: "var(--text)" }}>Legitimate interests</strong> - IP-based rate limiting to prevent abuse and ensure fair access for all users.</li>
            <li><strong style={{ color: "var(--text)" }}>Legal obligation</strong> - retaining transaction records as required by applicable law.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>How Long We Keep Your Data</h2>
          <p>Email addresses are retained until you request deletion. IP-based rate limit data expires automatically every 24 hours. Payment transaction records are retained for 7 years as required by US tax law. You may request deletion of all personal data at any time.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Your Rights</h2>
          <p>Under GDPR, CCPA, and equivalent laws, you have the right to:</p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <li>Access the personal data we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your data ("right to be forgotten")</li>
            <li>Object to processing of your data</li>
            <li>Request portability of your data</li>
            <li>Withdraw consent at any time where consent is the legal basis</li>
          </ul>
          <p style={{ marginTop: "12px" }}>To exercise any of these rights, email <a href="mailto:privacy@bustedlab.com" style={{ color: "var(--accent-bright)" }}>privacy@bustedlab.com</a>. We respond to all requests within 30 days.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Third-Party Services</h2>
          <p>BustedLab uses the following third-party processors, each with their own privacy policies:</p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <li><strong style={{ color: "var(--text)" }}>Lemon Squeezy</strong> - payment processing and Merchant of Record (lemonsqueezy.com/privacy)</li>
            <li><strong style={{ color: "var(--text)" }}>Resend</strong> - transactional email delivery (resend.com/privacy)</li>
            <li><strong style={{ color: "var(--text)" }}>Upstash</strong> - encrypted rate-limit data storage (upstash.com/privacy)</li>
            <li><strong style={{ color: "var(--text)" }}>Vercel</strong> - hosting and infrastructure (vercel.com/legal/privacy-policy)</li>
          </ul>
          <p style={{ marginTop: "12px" }}>We do not sell, rent, or trade your personal data to any third party for marketing purposes.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Cookies</h2>
          <p>BustedLab uses a single session cookie (bl_session) to maintain your authenticated state after sign-in. This cookie is essential for service functionality and does not track browsing behavior. No third-party advertising or analytics cookies are used.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Data Security</h2>
          <p>All data is encrypted in transit using TLS. Email addresses are stored encrypted at rest in Upstash Redis. We implement industry-standard security practices and conduct regular security reviews.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Contact & Complaints</h2>
          <p>Privacy inquiries: <a href="mailto:privacy@bustedlab.com" style={{ color: "var(--accent-bright)" }}>privacy@bustedlab.com</a></p>
          <p style={{ marginTop: "8px" }}>EU/UK residents have the right to lodge a complaint with their local data protection authority. For EU residents, this is typically the supervisory authority in your country of residence.</p>
        </section>
      </div>
    </main>
  );
}
