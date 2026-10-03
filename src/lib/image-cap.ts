import sharp from "sharp";

/**
 * The photo the models see, capped at 1568px on its long edge.
 *
 * Claude Opus 5.5 and Sonnet 5.5 read images up to 2576px and bill them by
 * area, about (width x height) / 750 tokens. A phone screenshot at 1170x2532
 * would cost about 3,950 tokens on every call that carries it; capped at
 * 1568px it is about 1,520, the size every earlier model saw and the size
 * the identification checks were calibrated on. Telling one product from
 * another does not need the extra pixels; the bill would.
 *
 * Only the copy sent to the models is resized. Google Lens gets the original
 * upload. Anything that cannot be decoded (or a runtime without sharp) passes
 * through untouched: a larger bill, never a failed scan.
 */
export const MODEL_IMAGE_LONG_EDGE = 1568;

/**
 * Candidate listing images, capped at 512px. Lens and Shopping thumbnails are
 * already smaller (about 150 to 250 tokens each in production traces), so for
 * them nothing changes. What it bounds is the outlier: a full-size merchant
 * photo or a product page's og:image can be 2000px and about 5,000 tokens,
 * and the gate sends up to eight candidates a call. At 512px a candidate
 * costs at most about 350 tokens, whatever the source sent.
 */
export const CANDIDATE_IMAGE_LONG_EDGE = 512;

export async function capForModel(
  image: { data: string; mimeType: string },
  maxLongEdge: number = MODEL_IMAGE_LONG_EDGE
): Promise<{ data: string; mimeType: string }> {
  try {
    const input = Buffer.from(image.data, "base64");
    const meta = await sharp(input).metadata();
    const longEdge = Math.max(meta.width || 0, meta.height || 0);
    if (!longEdge || longEdge <= maxLongEdge) return image;
    const output = await sharp(input)
      .rotate()
      .resize({ width: maxLongEdge, height: maxLongEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return { data: output.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    return image;
  }
}

/**
 * An image scaled to `longEdge`, up or down. Only /api/diagnose uses it: its
 * 320px sample is about 137 image tokens, under the 512-token minimum a
 * prompt prefix needs before Anthropic caches it, so the probes scale it up
 * to exercise prompt caching the way a real photo does.
 */
export async function scaleImage(
  image: { data: string; mimeType: string },
  longEdge: number
): Promise<{ data: string; mimeType: string }> {
  try {
    const output = await sharp(Buffer.from(image.data, "base64"))
      .resize({ width: longEdge, height: longEdge, fit: "inside" })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { data: output.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    return image;
  }
}
