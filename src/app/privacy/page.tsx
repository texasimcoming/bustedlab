import { Metadata } from "next";
import BrandHomeLink from "@/components/BrandHomeLink";
import { activeAffiliateNetwork } from "@/lib/affiliate";

export const metadata: Metadata = {
  title: "Privacy Policy - BustedLab",
  description: "How BustedLab collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  // Named only while links are actually wrapped (AFFILIATE_PROVIDER set with
  // a well-formed key): see src/lib/affiliate.ts.
  const affiliate = activeAffiliateNetwork();
  return (
    <main className="legal-page">
      <div className="page-light" aria-hidden="true" />
      <BrandHomeLink />
      <div className="label">LEGAL · PRIVACY</div>

      <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "38px", fontWeight: "760", letterSpacing: "-0.04em", lineHeight: "1.08", marginBottom: "8px" }}>Privacy Policy</h1>
      <p style={{ color: "var(--text-3)", fontSize: "13px", marginBottom: "40px" }}>Policy version 3.4 · BustedLab LLC, Wyoming, USA</p>

      <div style={{ display: "flex", flexDirection: "column", gap: "32px", fontSize: "15px", lineHeight: "1.75", color: "var(--text-2)" }}>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "19px", fontWeight: "700", letterSpacing: "-0.02em", color: "var(--text)", marginBottom: "12px" }}>Who We Are</h2>
          <p>BustedLab LLC is a Wyoming-registered consumer intelligence company operating the website bustedlab.com. We are committed to protecting your privacy and handling your data with transparency and respect.</p>
          <p style={{ marginTop: "12px" }}>For GDPR purposes, BustedLab LLC is the data controller. Contact us at <a href="mailto:privacy@bustedlab.com" style={{ color: "var(--accent-bright)" }}>privacy@bustedlab.com</a>.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "19px", fontWeight: "700", letterSpacing: "-0.02em", color: "var(--text)", marginBottom: "12px" }}>What We Collect</h2>
          <p><strong style={{ color: "var(--text)" }}>Email address</strong> - collected only when you purchase unlimited access or request a sign-in link. Used exclusively for authentication and service delivery. We never sell your email or use it for advertising.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>IP address</strong> - used only to enforce usage limits: a daily ceiling on free scans from one address, and limits on how quickly any one address can scan, sign up or start a checkout. Your address is never written to storage in readable form: it is converted to a salted, one-way hash that serves purely as a counter key, and every such key expires within a day. The original address cannot be recovered from what we hold.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>Uploaded images</strong> - product screenshots you scan are processed in memory and are never stored in our database. To identify the product, the image (reduced to at most 1568 pixels on its longest side) is sent to Anthropic&apos;s API. Reverse-image search requires the image to be briefly retrievable by URL, so during a scan a copy is also written to temporary object storage (Vercel Blob) at an unguessable address. That address is given to our search provider (Serper first; SerpApi when Serper fails, or when nothing Serper found can be confirmed as your product), which passes it to Google Lens, and Google Lens fetches the image from it. The copy is deleted as soon as each search returns, and a daily scheduled job removes any copy left behind by an interrupted scan. Images are never associated with your email address or used for any purpose other than completing your scan.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>Payment data</strong> - handled entirely by our payment provider, which acts as Merchant of Record. BustedLab never sees or stores your card details. We receive only your email address upon successful payment. The current provider is named on the checkout page before you enter any details.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>Scan records</strong> - when a scan produces a confirmed verdict, we permanently record the product, its category, the two prices compared, the resulting markup, the verdict and the time. These records describe a product, never a person: they contain no IP address, no email address, no session identifier and no copy of anything you uploaded, and they cannot be linked back to you or to any other record you created. Confirmed verdicts are published at a permanent address of the form /scan/[id], which is how a shared result opens to a real page, and appear in the public index at /the-index and in the leaderboards on the home page. We do not record or publish the retail web address you scanned.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>Usage counts</strong> - we keep a daily tally of how many times a handful of things happen across the whole site: the home page being viewed, a photo being picked or a link entered, a scan starting, finishing or failing (with the step that failed), each type of result being returned and shown, a card being saved or shared, a shared verdict page being opened, the upgrade screen appearing, an email being submitted, and a purchase link being followed. These are counters and nothing else. The counts from your browser can carry one word saying which channel the visit came from (TikTok, Instagram, X, Facebook, WhatsApp, a shared verdict link, a search engine, direct, or other), worked out in your browser from the link&apos;s tag, the app the page opened in, or the site that linked here, and not stored on your device. Only that word is sent. There is no session, no visitor identifier, no page path, no referring address, no device and no location attached to them, so a count cannot be traced back to you or matched with anything else we hold. The counts that come from your browser are rate limited using a one-way hash of your IP address and of the bl_bid browser identifier described below, and that hash is used for nothing else.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>&ldquo;Wrong product?&rdquo; reports</strong> - if you tap &ldquo;Wrong product? Tell us&rdquo; under a result, we record the report against that scan: the scan&apos;s reference, the kind of result, its match label and the time. Nothing about you is attached to it. We use these reports to check and improve how products are identified, and keep the most recent 500.</p>
          <p style={{ marginTop: "12px" }}><strong style={{ color: "var(--text)" }}>Product update list</strong> - if you choose to submit your email for product updates, we store that address, the time you submitted it, and which part of the site it came from. This is optional, it is never a condition of using the Service, and we use it only to send occasional updates about BustedLab. We do not sell, rent or share it. Unsubscribe at any time with the link in any update we send, or by emailing <a href="mailto:privacy@bustedlab.com" style={{ color: "var(--accent-bright)" }}>privacy@bustedlab.com</a>, and the address is deleted.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "19px", fontWeight: "700", letterSpacing: "-0.02em", color: "var(--text)", marginBottom: "12px" }}>Legal Basis for Processing (GDPR)</h2>
          <p>We process your data under the following legal bases:</p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <li><strong style={{ color: "var(--text)" }}>Contract</strong> - processing your email to deliver the service you paid for.</li>
            <li><strong style={{ color: "var(--text)" }}>Legitimate interests</strong> - IP-based rate limiting to prevent abuse and ensure fair access for all users.</li>
            <li><strong style={{ color: "var(--text)" }}>Legal obligation</strong> - retaining transaction records as required by applicable law.</li>
            <li><strong style={{ color: "var(--text)" }}>Consent</strong> - the optional product update list. Given when you submit the form, withdrawable at any time.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "19px", fontWeight: "700", letterSpacing: "-0.02em", color: "var(--text)", marginBottom: "12px" }}>How Long We Keep Your Data</h2>
          <p>Email addresses are retained until you request deletion. Rate limit data, which holds only a one-way hash, expires automatically every 24 hours. Payment transaction records are retained for 7 years as required by US tax law. You may request deletion of all personal data at any time.</p>
          <p style={{ marginTop: "12px" }}>Scan records are retained indefinitely because they contain no personal data: they are measurements of products and prices. Deleting your account does not delete them, because there is nothing in them to connect to you.</p>
          <p style={{ marginTop: "12px" }}>Scanned images: our temporary copy is deleted as soon as the reverse-image search returns, and the daily cleanup removes any copy an interrupted scan left behind. Under its commercial terms, Anthropic deletes API inputs and outputs within 30 days of receiving them, unless its automated safety systems flag a request, and does not use them to train models. Serper, SerpApi and Google keep what they receive under their own privacy policies.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "19px", fontWeight: "700", letterSpacing: "-0.02em", color: "var(--text)", marginBottom: "12px" }}>Your Rights</h2>
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
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "19px", fontWeight: "700", letterSpacing: "-0.02em", color: "var(--text)", marginBottom: "12px" }}>Third-Party Services</h2>
          <p>BustedLab uses the following third-party processors, each with their own privacy policies:</p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <li><strong style={{ color: "var(--text)" }}>Our payment provider</strong> - payment processing and Merchant of Record. Named on the checkout page.</li>
            <li><strong style={{ color: "var(--text)" }}>Resend</strong> - transactional email delivery (resend.com/privacy)</li>
            <li><strong style={{ color: "var(--text)" }}>Upstash</strong> - encrypted storage for rate-limit counters, sessions and cached scan results (upstash.com/privacy)</li>
            <li><strong style={{ color: "var(--text)" }}>Vercel</strong> - hosting, infrastructure, and Vercel Blob, which holds the temporary copy of a scanned image during reverse-image search (vercel.com/legal/privacy-policy)</li>
            <li><strong style={{ color: "var(--text)" }}>Anthropic</strong> - the vision model that identifies the product. It receives the scanned image itself. Images sent for this purpose are not used to train models and are deleted within 30 days (anthropic.com/legal/privacy)</li>
            <li><strong style={{ color: "var(--text)" }}>Serper and SerpApi</strong> - reverse-image and shopping search: Serper first, SerpApi as a backup and when nothing Serper found can be confirmed. They receive the temporary image address and the search query, never your email address (serper.dev, serpapi.com/privacy)</li>
            <li><strong style={{ color: "var(--text)" }}>Google</strong> - Google Lens, the reverse-image engine those services query, fetches the image from the temporary address during the search (policies.google.com/privacy)</li>
            {affiliate && (
              <li><strong style={{ color: "var(--text)" }}>{affiliate.name}</strong> - affiliate links. When you follow a &quot;Go to this price&quot; link on a closest-match result, it passes through {affiliate.name}&apos;s redirect ({affiliate.redirectHost}) on its way to the store, which records the click and may set its own cookies there, so the store can credit BustedLab with a commission if you buy. It never changes which listing we show or its price, and it receives neither your email address nor your scanned image ({affiliate.policy})</li>
            )}
          </ul>
          <p style={{ marginTop: "12px" }}>We do not sell, rent, or trade your personal data to any third party for marketing purposes.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "19px", fontWeight: "700", letterSpacing: "-0.02em", color: "var(--text)", marginBottom: "12px" }}>Cookies</h2>
          <p>BustedLab sets three cookies, all strictly necessary and none used for advertising or analytics:</p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <li><strong style={{ color: "var(--text)" }}>bl_session</strong> - keeps you signed in after you use a sign-in link. Set only once you sign in.</li>
            <li><strong style={{ color: "var(--text)" }}>bl_claim</strong> - set when you start a purchase, so the browser you pay in can sign itself in once the payment is confirmed. It holds a random value, and is removed when used or after two hours.</li>
            <li><strong style={{ color: "var(--text)" }}>bl_bid</strong> - a random identifier, expiring after 30 days, that counts free scans from this browser. The free allowance (2 scans a day) belongs to the browser rather than the IP address, because mobile networks change your address mid-session and many people can share one address. It contains no information about you, is never linked to your email address, and is not used to track you across other websites.</li>
          </ul>
          <p style={{ marginTop: "12px" }}>No third-party advertising or analytics cookies are used on this site.{affiliate && <> A &quot;Go to this price&quot; link on a closest-match result leaves it through {affiliate.name}&apos;s redirect, which may set its own cookies on its own domain to credit the referral (see Third-Party Services).</>} One third-party script runs on this site, and only when you start to buy: our payment provider&apos;s checkout script, which loads when the upgrade screen opens or you point at or tap a buy button, so the payment form can open on this page instead of sending you to another site. If you never start a purchase, it never loads. While the payment form is open, the provider may set the cookies it needs to process your payment, under its own privacy policy. Your card details are entered into the provider&apos;s own secure frame, which this site cannot read. Our usage measurement is first-party, sets no cookie, and stores only aggregate daily counts.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "19px", fontWeight: "700", letterSpacing: "-0.02em", color: "var(--text)", marginBottom: "12px" }}>Data Security</h2>
          <p>All data is encrypted in transit using TLS and at rest by our storage provider. IP addresses are stored only as salted one-way hashes. We implement industry-standard security practices and review them regularly.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "19px", fontWeight: "700", letterSpacing: "-0.02em", color: "var(--text)", marginBottom: "12px" }}>Contact & Complaints</h2>
          <p>Privacy inquiries: <a href="mailto:privacy@bustedlab.com" style={{ color: "var(--accent-bright)" }}>privacy@bustedlab.com</a></p>
          <p style={{ marginTop: "8px" }}>EU/UK residents have the right to lodge a complaint with their local data protection authority. For EU residents, this is typically the supervisory authority in your country of residence.</p>
        </section>
      </div>
    </main>
  );
}
