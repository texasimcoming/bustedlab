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

export async function capForModel(image: { data: string; mimeType: string }): Promise<{ data: string; mimeType: string }> {
  try {
    const input = Buffer.from(image.data, "base64");
    const meta = await sharp(input).metadata();
    const longEdge = Math.max(meta.width || 0, meta.height || 0);
    if (!longEdge || longEdge <= MODEL_IMAGE_LONG_EDGE) return image;
    const output = await sharp(input)
      .rotate()
      .resize({ width: MODEL_IMAGE_LONG_EDGE, height: MODEL_IMAGE_LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return { data: output.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    return image;
  }
}
