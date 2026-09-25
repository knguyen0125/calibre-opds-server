/**
 * Image conversion ported from CrossInk web/pages/files.js processImage
 * (state 0 only — the interactive split/rotate states are picker-only).
 *
 * Every raster image is flattened onto white, capped to the device
 * viewport, grayscaled, and re-encoded as baseline JPEG q85 with
 * mozjpeg. sharp replaces the browser canvas; EXIF orientation is
 * applied first, matching browser <img> decoding.
 */
import sharp from "sharp";

export const JPEG_QUALITY = 85;

export type ProcessedImage = {
  data: Uint8Array;
  width: number;
  height: number;
};

export async function processImage(
  data: Uint8Array,
  maxWidth: number,
  maxHeight: number,
): Promise<ProcessedImage> {
  const buffer = Buffer.from(data);
  const meta = await sharp(buffer, { failOn: "none" })
    .rotate()
    .metadata();
  const origWidth = meta.width ?? 0;
  const origHeight = meta.height ?? 0;
  if (!origWidth || !origHeight) {
    throw new Error("image has no intrinsic dimensions");
  }

  const fits = origWidth <= maxWidth && origHeight <= maxHeight;
  const scale = fits ? 1 : Math.min(maxWidth / origWidth, maxHeight / origHeight);
  const width = Math.max(1, Math.round(origWidth * scale));
  const height = Math.max(1, Math.round(origHeight * scale));

  let pipeline = sharp(buffer, { failOn: "none" })
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } });
  if (!fits) {
    // fit:"fill" stretches to the exact rounded target dims, matching
    // canvas drawImage scaling in the reference implementation.
    pipeline = pipeline.resize(width, height, { fit: "fill" });
  }

  const { data: out, info } = await pipeline
    .grayscale()
    .jpeg({
      quality: JPEG_QUALITY,
      progressive: false,
      mozjpeg: true,
    })
    .toBuffer({ resolveWithObject: true });

  return { data: new Uint8Array(out), width: info.width, height: info.height };
}
