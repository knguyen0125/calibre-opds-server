/**
 * Image conversion ported from CrossInk web/pages/files.js processImage
 * (state 0 only — the interactive split/rotate states are picker-only).
 *
 * Every raster image is flattened onto white, capped to the device
 * viewport, grayscaled, and re-encoded as baseline JPEG q85. Jimp
 * (pure JS) replaces the browser canvas so single-file `bun build
 * --compile` executables work on every platform. WebP and SVG are not
 * decodable; those images stay as-is and callers keep the original.
 *
 * Note: Jimp's greyscale uses Rec. 709 luminosity while the reference
 * canvas pipeline used Rec. 601; the PXC2 sidecars compute their own
 * Rec. 601 gray, so device rendering is unaffected.
 */
import { Jimp } from "jimp";

/**
 * The surface the optimizer uses. Jimp's real instance type is generic
 * over registered formats and does not unify across call sites, so
 * consumers share this structural view; assigned once at Jimp.read.
 */
export type JimpImage = {
  readonly width: number;
  readonly height: number;
  bitmap: { width: number; height: number; data: Uint8ClampedArray };
  resize(size: { w: number; h: number }): unknown;
  greyscale(): unknown;
  getBuffer(
    mime: "image/jpeg",
    options?: { quality?: number },
  ): Promise<Buffer>;
};

async function readImage(data: Uint8Array): Promise<JimpImage> {
  return (await Jimp.read(Buffer.from(data))) as unknown as JimpImage;
}

export const JPEG_QUALITY = 85;

export type ProcessedImage = {
  data: Uint8Array;
  width: number;
  height: number;
};

/** Composite RGBA pixels onto white, in place (matches canvas
 * white-fill + drawImage in the reference implementation). */
export function flattenToWhite(image: JimpImage): void {
  const { data } = image.bitmap;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!;
    if (alpha === 255) continue;
    const a = alpha / 255;
    data[i] = Math.round(data[i]! * a + 255 * (1 - a));
    data[i + 1] = Math.round(data[i + 1]! * a + 255 * (1 - a));
    data[i + 2] = Math.round(data[i + 2]! * a + 255 * (1 - a));
    data[i + 3] = 255;
  }
}

export async function processImage(
  data: Uint8Array,
  maxWidth: number,
  maxHeight: number,
): Promise<ProcessedImage> {
  const image = await readImage(data);
  if (!image.width || !image.height) {
    throw new Error("image has no intrinsic dimensions");
  }

  const fits = image.width <= maxWidth && image.height <= maxHeight;
  if (!fits) {
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    // resize({w,h}) stretches to the exact rounded target dims,
    // matching canvas drawImage scaling in the reference implementation.
    image.resize({
      w: Math.max(1, Math.round(image.width * scale)),
      h: Math.max(1, Math.round(image.height * scale)),
    });
  }

  flattenToWhite(image);
  image.greyscale();
  const jpeg = await image.getBuffer("image/jpeg", { quality: JPEG_QUALITY });
  return {
    data: new Uint8Array(jpeg),
    width: image.width,
    height: image.height,
  };
}
