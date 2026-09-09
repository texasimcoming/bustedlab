import { ImageResponse } from "next/og";
import { unstable_cache } from "next/cache";
import { getScanRecord } from "@/lib/redis";
import { VERDICT_COLOR, VERDICT_LABEL } from "@/lib/scan-record-view";

/**
 * The link preview for one scan.
 *
 * The site-wide opengraph-image is a generic marketing card, which is the
 * right thing for the homepage and the wrong thing for a share. Somebody who
 * posts a 2079% BUSTED and gets a preview reading "They built the price" has
 * had the single most persuasive artifact they will ever produce replaced with
 * a slogan. This renders THEIR verdict: the label, the markup, both prices and
 * the gap, at 1200x630, in the same visual language as the card itself.
 *
 * Generated once per scan and cached, so a card that goes viral renders here
 * once rather than once per impression.
 */
// Same read-through cache as the page. A link preview is fetched by every
// platform the card is posted to, several times each, and none of those
// fetches should reach Redis.
const cachedRecord = unstable_cache(
  async (id: string) => getScanRecord(id),
  ["scan-record-og"],
  { revalidate: 3600 }
);

export const alt = "BustedLab scan result";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Props = { params: Promise<{ id: string }> };

export default async function ScanOgImage({ params }: Props) {
  // Next 16: params reaches image generators as a Promise.
  const { id } = await params;
  const record = await cachedRecord(id);

  const accent = record ? VERDICT_COLOR[record.verdict] : "#b8a0e8";
  const label = record ? VERDICT_LABEL[record.verdict] : "BUSTEDLAB";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#07070e",
          padding: "58px 68px",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -260,
            left: 200,
            width: 800,
            height: 680,
            background: `radial-gradient(circle at center, ${accent}33 0%, rgba(7,7,14,0) 68%)`,
            display: "flex",
          }}
        />
        <div style={{ position: "absolute", top: 30, left: 30, width: 42, height: 42, borderTop: `3px solid ${accent}88`, borderLeft: `3px solid ${accent}88`, display: "flex" }} />
        <div style={{ position: "absolute", top: 30, right: 30, width: 42, height: 42, borderTop: `3px solid ${accent}88`, borderRight: `3px solid ${accent}88`, display: "flex" }} />
        <div style={{ position: "absolute", bottom: 30, left: 30, width: 42, height: 42, borderBottom: `3px solid ${accent}88`, borderLeft: `3px solid ${accent}88`, display: "flex" }} />
        <div style={{ position: "absolute", bottom: 30, right: 30, width: 42, height: 42, borderBottom: `3px solid ${accent}88`, borderRight: `3px solid ${accent}88`, display: "flex" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: "#10d9a0", display: "flex" }} />
          <div style={{ fontSize: 19, letterSpacing: 6, color: "rgba(184,160,232,0.6)", display: "flex" }}>
            BUSTEDLAB VERIFIED SCAN
          </div>
        </div>

        {record ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 30 }}>
              <div style={{ fontSize: 112, fontWeight: 800, color: accent, letterSpacing: 6, lineHeight: 1, display: "flex" }}>
                {label}
              </div>
              <div style={{ fontSize: 46, fontWeight: 700, color: accent, opacity: 0.75, lineHeight: 1.2, display: "flex" }}>
                {record.markup.toLocaleString()}%
              </div>
            </div>

            <div style={{ fontSize: 40, color: "#eeeef6", marginTop: 22, lineHeight: 1.3, display: "flex" }}>
              {record.verdict === "FAIR"
                ? `$${record.savings.toFixed(2)} off market`
                : `$${record.savings.toFixed(2)} above market`}
            </div>

            <div style={{ display: "flex", gap: 14, marginTop: 26 }}>
              <div style={{ display: "flex", flexDirection: "column", padding: "16px 24px", borderRadius: 12, background: "rgba(239,68,68,0.09)", border: "1px solid rgba(239,68,68,0.28)" }}>
                <div style={{ fontSize: 17, color: "rgba(238,238,246,0.42)", letterSpacing: 2, display: "flex" }}>ASKING</div>
                <div style={{ fontSize: 42, fontWeight: 700, color: "#ef4444", marginTop: 6, display: "flex" }}>
                  ${record.retailPrice.toFixed(2)}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", padding: "16px 24px", borderRadius: 12, background: "rgba(16,217,160,0.09)", border: "1px solid rgba(16,217,160,0.26)" }}>
                <div style={{ fontSize: 17, color: "rgba(238,238,246,0.42)", letterSpacing: 2, display: "flex" }}>MARKET</div>
                <div style={{ fontSize: 42, fontWeight: 700, color: "#10d9a0", marginTop: 6, display: "flex" }}>
                  ${record.wholesalePrice.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 74, fontWeight: 800, color: "#eeeef6", letterSpacing: -2, lineHeight: 1.08, display: "flex" }}>
              They built the price.
            </div>
            <div style={{ fontSize: 74, fontWeight: 800, color: "#b8a0e8", letterSpacing: -2, lineHeight: 1.08, marginTop: 4, display: "flex" }}>
              We built the scanner.
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 26, color: "rgba(238,238,246,0.55)", maxWidth: 760, display: "flex", overflow: "hidden" }}>
            {record ? record.title.slice(0, 62) : "Scan any product"}
          </div>
          <div style={{ fontSize: 20, color: "rgba(238,238,246,0.3)", letterSpacing: 2, display: "flex" }}>
            bustedlab.com
          </div>
        </div>
      </div>
    ),
    size
  );
}
