import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy - BustedLab",
  description: "How BustedLab collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 24px 80px", color: "var(--text)", fontFamily: "var(--font-sans), sans-serif" }}>
      <Link href="/" style={{ color: "var(--accent-bright)", textDecoration: "none", fontSize: "14px", display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: "32px" }}>
        ← Back to BustedLab
      </Link>

      <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "32px", fontWeight: "700", letterSpacing: "-0.8px", marginBottom: "8px" }}>Privacy Policy</h1>
      <p style={{ color: "var(--text-3)", fontSize: "13px", marginBottom: "40px" }}>Policy version 3.2 · BustedLab LLC, Wyoming, USA</p>

      <div style={{ display: "flex", flexDirection: "column", gap: "32px", fontSize: "15px", lineHeight: "1.75", color: "var(--text-2)" }}>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Who We Are</h2>
          <p>BustedLab LLC is a Wyoming-registered consumer intelligence company operating the website bustedlab.com. We are committed to protecting your privacy and handling your data with transparency and respect.</p>
          <p style={{ marginTop: "12px" }}>For GDPR purposes, BustedLab LLC is the data controller. Contact us at <a href="mailto:privacy@bustedlab.com" style={{ color: "var(--accent-bright)" }}>privacy@bustedlab.com</a>.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>What We Collect</h2>
          <p><strong style={{ color: "var(--text)" }}>Email address</strong> - collected only when you purchase unlimited access or request a sign-in link. Used exclusively for authentication and service delivery. We never sell your email or use it for advertising.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>IP address</strong> - used only to enforce the free tier scan limit (2 per day). Your address is never written to storage in readable form: it is converted to a salted, one-way hash that serves purely as a counter key, and the key expires at midnight UTC. The original address cannot be recovered from what we hold.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>Uploaded images</strong> - product screenshots you scan are processed in memory. Reverse-image search requires the image to be briefly retrievable by URL, so during a scan a copy is written to temporary object storage at an unguessable address and deleted as soon as the search returns. A scheduled job removes any copy left behind by an interrupted scan. Images are never associated with your email address or used for any purpose other than completing your scan.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>Payment data</strong> - handled entirely by our payment provider, which acts as Merchant of Record. BustedLab never sees or stores your card details. We receive only your email address upon successful payment. The current provider is named on the checkout page before you enter any details.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>Scan records</strong> - when a scan produces a confirmed verdict, we permanently record the product, its category, the two prices compared, the resulting markup, the verdict and the time. These records describe a product, never a person: they contain no IP address, no email address, no session identifier and no copy of anything you uploaded, and they cannot be linked back to you or to any other record you created. Confirmed verdicts are published at a permanent address of the form /scan/[id], which is how a shared result opens to a real page, and appear in the public index at /the-index and in the leaderboards on the home page. We do not record or publish the retail web address you scanned.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>Product update list</strong> - if you choose to submit your email for product updates, we store that address, the time you submitted it, and which part of the site it came from. This is optional, it is never a condition of using the Service, and we use it only to send occasional updates about BustedLab. We do not sell, rent or share it. Unsubscribe at any time by emailing <a href="mailto:privacy@bustedlab.com" style={{ color: "var(--accent-bright)" }}>privacy@bustedlab.com</a>, and the address is deleted.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Legal Basis for Processing (GDPR)</h2>
          <p>We process your data under the following legal bases:</p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <li><strong style={{ color: "var(--text)" }}>Contract</strong> - processing your email to deliver the service you paid for.</li>
            <li><strong style={{ color: "var(--text)" }}>Legitimate interests</strong> - IP-based rate limiting to prevent abuse and ensure fair access for all users.</li>
            <li><strong style={{ color: "var(--text)" }}>Legal obligation</strong> - retaining transaction records as required by applicable law.</li>
            <li><strong style={{ color: "var(--text)" }}>Consent</strong> - the optional product update list. Given when you submit the form, withdrawable at any time.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>How Long We Keep Your Data</h2>
          <p>Email addresses are retained until you request deletion. Rate limit data, which holds only a one-way hash, expires automatically every 24 hours. Payment transaction records are retained for 7 years as required by US tax law. You may request deletion of all personal data at any time.</p>
          <p style={{ marginTop: "12px" }}>Scan records are retained indefinitely because they contain no personal data: they are measurements of products and prices. Deleting your account does not delete them, because there is nothing in them to connect to you.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Your Rights</h2>
          <p>Under GDPR, CCPA, and equivalent laws, you have the right to:</p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <li>Access the personal data we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your data (the &ldquo;right to be forgotten&rdquo;)</li>
            <li>Object to processing of your data</li>
            <li>Request portability of your data</li>
            <li>Withdraw consent at any time where consent is the legal basis</li>
          </ul>
          <p style={{ marginTop: "12px" }}>To exercise any of these rights, email <a href="mailto:privacy@bustedlab.com" style={{ color: "var(--accent-bright)" }}>privacy@bustedlab.com</a>. We respond to all requests within 30 days.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Third-Party Services</h2>
          <p>BustedLab uses the following third-party processors, each with their own privacy policies:</p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <li><strong style={{ color: "var(--text)" }}>Our payment provider</strong> - payment processing and Merchant of Record. Named on the checkout page.</li>
            <li><strong style={{ color: "var(--text)" }}>Resend</strong> - transactional email delivery (resend.com/privacy)</li>
            <li><strong style={{ color: "var(--text)" }}>Upstash</strong> - encrypted storage for rate-limit counters, sessions and cached scan results (upstash.com/privacy)</li>
            <li><strong style={{ color: "var(--text)" }}>Vercel</strong> - hosting, temporary image storage during a scan, and infrastructure (vercel.com/legal/privacy-policy)</li>
            <li><strong style={{ color: "var(--text)" }}>Anthropic</strong> - the vision model that identifies the product in an uploaded image. Images sent for this purpose are not used to train models (anthropic.com/legal/privacy)</li>
            <li><strong style={{ color: "var(--text)" }}>SerpApi and Serper</strong> - reverse-image and shopping search. They receive the temporary image URL and the search query, never your email address (serpapi.com/privacy, serper.dev)</li>
          </ul>
          <p style={{ marginTop: "12px" }}>We do not sell, rent, or trade your personal data to any third party for marketing purposes.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Cookies</h2>
          <p>BustedLab sets two cookies, both strictly necessary and neither used for advertising or analytics:</p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <li><strong style={{ color: "var(--text)" }}>bl_session</strong> - keeps you signed in after you use a sign-in link. Set only once you sign in.</li>
            <li><strong style={{ color: "var(--text)" }}>bl_bid</strong> - a random identifier, expiring after 30 days, that counts free scans from this browser. It exists because mobile networks change your IP address mid-session, which would otherwise reset the free tier. It contains no information about you, is never linked to your email address, and is not used to track you across other websites.</li>
          </ul>
          <p style={{ marginTop: "12px" }}>No third-party advertising or analytics cookies are used, and no third-party scripts run on this site.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Data Security</h2>
          <p>All data is encrypted in transit using TLS and at rest by our storage provider. IP addresses are stored only as salted one-way hashes. We implement industry-standard security practices and review them regularly.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "18px", fontWeight: "700", color: "var(--text)", marginBottom: "12px" }}>Contact & Complaints</h2>
          <p>Privacy inquiries: <a href="mailto:privacy@bustedlab.com" style={{ color: "var(--accent-bright)" }}>privacy@bustedlab.com</a></p>
          <p style={{ marginTop: "8px" }}>EU/UK residents have the right to lodge a complaint with their local data protection authority. For EU residents, this is typically the supervisory authority in your country of residence.</p>
        </section>
      </div>
    </main>
  );
}
