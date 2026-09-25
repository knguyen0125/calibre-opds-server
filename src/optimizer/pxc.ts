/**
 * PXC2 sidecar transport ported from CrossInk web/pages/files.js, byte
 * format per CrossInk docs/file-formats.md ("Optimizer image transport").
 *
 * Each image referenced from XHTML gets a 2-bit Bayer-dithered grayscale
 * sidecar under META-INF/crossink/pxc/. The firmware renders those
 * pixels directly and skips on-device JPEG decode and dithering.
 */
import { Jimp } from "jimp";
import type JSZip from "jszip";
import { flattenToWhite, type JimpImage } from "./images.ts";
import { parseHtml, type DomElement } from "./dom.ts";
import { decodeHref, resolvePath, safeReadText } from "./text.ts";
import type { Zip } from "./opf.ts";
export const CROSSINK_OPTIMIZER_MANIFEST_PATH =
  "META-INF/crossink/optimizer-v1.json";
export const CROSSINK_OPTIMIZER_INDEX_PATH =
  "META-INF/crossink/optimizer-images-v1.idx";
export const CROSSINK_PXC_DIR = "META-INF/crossink/pxc";
const CROSSINK_BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard IEEE CRC32 (zlib), table-driven; identical values to the
 * bit-loop reference implementation in files.js. */
export function crossInkCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]!)! & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function crossInkPackBits(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    let run = 1;
    while (run < 128 && i + run < data.length && data[i + run] === data[i]) {
      run++;
    }
    if (run >= 3) {
      out.push(257 - run, data[i]!);
      i += run;
      continue;
    }
    const start = i;
    while (i < data.length && i - start < 128) {
      if (
        i + 2 < data.length &&
        data[i] === data[i + 1] &&
        data[i] === data[i + 2]
      ) {
        break;
      }
      i++;
    }
    out.push(i - start - 1, ...data.subarray(start, i));
  }
  return new Uint8Array(out);
}

/** Pack a legacy PXC payload (u16 LE width, height, then 2bpp rows)
 * into the block-compressed PXC2 transport. */
export function encodeCrossInkPxc2(legacy: Uint8Array): Uint8Array {
  const input = new DataView(
    legacy.buffer,
    legacy.byteOffset,
    legacy.byteLength,
  );
  const width = input.getUint16(0, true);
  const height = input.getUint16(2, true);
  const raw = legacy.subarray(4);
  const rowBytes = Math.ceil(width / 4);
  if (
    !width ||
    !height ||
    width > 1024 ||
    height > 1024 ||
    raw.length !== rowBytes * height ||
    raw.length > 131072
  ) {
    throw new Error("Unsupported optimized image dimensions");
  }
  const blocks: { block: Uint8Array; encoded: Uint8Array; codec: number }[] = [];
  let size = 32;
  for (let offset = 0; offset < raw.length; offset += 2048) {
    const block = raw.subarray(offset, offset + 2048);
    let encoded = crossInkPackBits(block);
    let codec = 2;
    if (encoded.length >= block.length) {
      encoded = block;
      codec = 0;
    }
    blocks.push({ block, encoded, codec });
    size += 12 + encoded.length;
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([80, 88, 67, 50, 2, 1]);
  view.setUint16(6, 32, true);
  view.setUint16(8, width, true);
  view.setUint16(10, height, true);
  view.setUint16(12, rowBytes, true);
  view.setUint16(14, 2048, true);
  view.setUint16(16, blocks.length, true);
  view.setUint32(20, raw.length, true);
  view.setUint32(24, crossInkCrc32(raw), true);
  view.setUint32(28, size, true);
  let offset = 32;
  blocks.forEach(({ block, encoded, codec }, sequence) => {
    out[offset] = codec;
    view.setUint16(offset + 2, block.length, true);
    view.setUint16(offset + 4, encoded.length, true);
    view.setUint16(offset + 6, sequence, true);
    view.setUint32(offset + 8, crossInkCrc32(block), true);
    out.set(encoded, offset + 12);
    offset += 12 + encoded.length;
  });
  return out;
}

export function crossInkIndexPath(path: string, limit: number): boolean {
  return (
    !!path &&
    !path.startsWith("/") &&
    !path.includes("..") &&
    !/[\x00-\x1f\\:%]/.test(path) &&
    new TextEncoder().encode(path).length <= limit
  );
}

export type OptimizerIndexEntry = {
  href: string;
  pxc: string;
  width: number;
  height: number;
  pxcFormat: "pxc2";
  pxcBytes: number;
  pixelCrc32: number;
};

/** Build the COIX binary index over the optimizer manifest entries. */
export function buildCrossInkImageIndex(
  manifest: Uint8Array,
  entries: OptimizerIndexEntry[],
): Uint8Array {
  if (entries.length > 256) throw new Error("Too many optimizer index records");
  const out = new Uint8Array(32 + 208 * entries.length);
  const view = new DataView(out.buffer);
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  entries.forEach((e, i) => {
    if (
      seen.has(e.href) ||
      !crossInkIndexPath(e.href, 128) ||
      !crossInkIndexPath(e.pxc, 64)
    ) {
      throw new Error("Invalid optimizer index path");
    }
    seen.add(e.href);
    const at = 32 + 208 * i;
    out.set(encoder.encode(e.href), at);
    out.set(encoder.encode(e.pxc), at + 129);
    view.setUint16(at + 194, e.width, true);
    view.setUint16(at + 196, e.height, true);
    out[at + 198] = 2;
    view.setUint32(at + 200, e.pxcBytes, true);
    view.setUint32(at + 204, e.pixelCrc32, true);
  });
  out.set([67, 79, 73, 88]);
  view.setUint16(4, 1, true);
  view.setUint16(6, 32, true);
  view.setUint16(8, 208, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(16, crossInkCrc32(manifest), true);
  view.setUint32(20, manifest.length, true);
  view.setUint32(24, crossInkCrc32(out.subarray(32)), true);
  view.setUint32(28, crossInkCrc32(out.subarray(0, 28)), true);
  return out;
}

type CssRule = { selector: string; declarations: Record<string, string> };

export function crossInkPxcRules(text: string): CssRule[] {
  const rules: CssRule[] = [];
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations: Record<string, string> = {};
    for (const declaration of match[2]!.matchAll(
      /(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g,
    )) {
      declarations[declaration[1]!.toLowerCase()] = declaration[2]!.trim().toLowerCase();
    }
    if (Object.keys(declarations).length === 0) continue;
    for (const selector of match[1]!.split(",")) {
      rules.push({ selector: selector.trim(), declarations });
    }
  }
  return rules;
}

export function crossInkPxcStyle(
  rules: CssRule[],
  image: DomElement,
): Record<string, string> {
  const style: Record<string, string> = {};
  for (const rule of rules) {
    try {
      if (image.matches(rule.selector)) Object.assign(style, rule.declarations);
    } catch {
      // Unsupported/invalid selectors must not style unrelated images.
    }
  }
  const inline = crossInkPxcRules(`x{${image.getAttribute("style") || ""}}`)[0];
  if (inline) Object.assign(style, inline.declarations);
  return style;
}

function crossInkPxcLength(
  value: string | undefined,
  relative: number,
): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return undefined;
  if (value.endsWith("%") || value.endsWith("vw")) {
    return Math.max(1, Math.round((relative * parsed) / 100));
  }
  if (!value.endsWith("px") && !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  return Math.max(1, Math.round(parsed));
}

export function crossInkPxcSize(
  width: number,
  height: number,
  style: Record<string, string>,
  viewportWidth: number,
  viewportHeight: number,
): { width: number; height: number } {
  const resolvedWidth = crossInkPxcLength(style["width"], viewportWidth);
  const resolvedHeight = crossInkPxcLength(style["height"], viewportHeight);
  if (!resolvedWidth && !resolvedHeight) return { width, height };
  const finalWidth =
    resolvedWidth ??
    Math.max(1, Math.round(((resolvedHeight ?? height) * width) / height));
  const finalHeight =
    resolvedHeight ??
    Math.max(1, Math.round(((resolvedWidth ?? width) * height) / width));
  if (finalWidth > viewportWidth || finalHeight > viewportHeight) {
    const scale = Math.min(viewportWidth / finalWidth, viewportHeight / finalHeight);
    return {
      width: Math.max(1, Math.round(finalWidth * scale)),
      height: Math.max(1, Math.round(finalHeight * scale)),
    };
  }
  return { width: finalWidth, height: finalHeight };
}

function crossInkPxcPathKey(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Rasterize a decoded image at the exact display size, grayscale +
 * Bayer 4x4 dither to 2bpp, and pack as PXC2. The dither arithmetic is
 * the reference implementation verbatim; Jimp bitmaps are RGBA.
 */
export async function buildCrossInkPxc(
  image: JimpImage,
  width: number,
  height: number,
): Promise<Uint8Array> {
  if (image.width !== width || image.height !== height) {
    image.resize({ w: width, h: height });
  }
  flattenToWhite(image);
  const pixels = image.bitmap.data;
  const rowBytes = Math.ceil(width / 4);
  const output = new Uint8Array(4 + rowBytes * height);
  const view = new DataView(output.buffer);
  view.setUint16(0, width, true);
  view.setUint16(2, height, true);
  let offset = 4;
  for (let y = 0; y < height; y++) {
    let packed = 0;
    let shift = 6;
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const grayBase = Math.round(
        pixels[index]! * 0.299 +
          pixels[index + 1]! * 0.587 +
          pixels[index + 2]! * 0.114,
      );
      const gray = Math.max(
        0,
        Math.min(255, grayBase + (CROSSINK_BAYER_4X4[y & 3]![x & 3]! - 8) * 5),
      );
      const level = gray < 64 ? 0 : gray < 128 ? 1 : gray < 192 ? 2 : 3;
      packed |= level << shift;
      if (shift === 0) {
        output[offset++] = packed;
        packed = 0;
        shift = 6;
      } else {
        shift -= 2;
      }
    }
    if (shift !== 6) output[offset++] = packed;
  }
  return encodeCrossInkPxc2(output);
}

function resolveCrossInkPxcPath(basePath: string, reference: string | null): string {
  const source = decodeHref((reference || "").split("#")[0]!);
  if (!source || source.startsWith("data:")) return "";
  return resolvePath(basePath, source);
}

/**
 * Build PXC2 sidecars for every <img> referenced from the (already
 * processed) XHTML files, resolving display size from CSS the same way
 * the firmware layout does. The display is landscape while the device
 * profile bounds are portrait, so viewport width/height are swapped.
 * Reads images back from the output zip, which already holds the
 * converted JPEGs.
 */
export async function buildCrossInkPxcSidecars(
  out: JSZip,
  zip: Zip,
  xhtmlFiles: Record<string, string>,
  profileWidth: number,
  profileHeight: number,
  onProgress?: (done: number) => void,
): Promise<OptimizerIndexEntry[]> {
  const cssRules = new Map<string, CssRule[]>();
  for (const [path, fileObj] of Object.entries(zip.files)) {
    if (!fileObj.dir && path.toLowerCase().endsWith(".css")) {
      cssRules.set(path, crossInkPxcRules(await safeReadText(fileObj)));
    }
  }
  const entries: OptimizerIndexEntry[] = [];
  const seen = new Set<string>();
  const viewportWidth = profileHeight;
  const viewportHeight = profileWidth;
  for (const [xhtmlPath, xhtml] of Object.entries(xhtmlFiles)) {
    const doc = parseHtml(xhtml);
    if (!doc) continue;
    const rules: CssRule[] = [];
    doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      const fromCss = cssRules.get(
        resolveCrossInkPxcPath(xhtmlPath, link.getAttribute("href")),
      );
      if (fromCss) rules.push(...fromCss);
    });
    doc.querySelectorAll("style").forEach((style) => {
      rules.push(...crossInkPxcRules(style.textContent || ""));
    });
    for (const image of doc.querySelectorAll("img")) {
      const href = resolveCrossInkPxcPath(xhtmlPath, image.getAttribute("src"));
      const imageFile = href ? out.files[href] : undefined;
      if (!imageFile || imageFile.dir) continue;
      try {
        const data = new Uint8Array(await imageFile.async("arraybuffer"));
        const decoded = (await Jimp.read(
          Buffer.from(data),
        )) as unknown as JimpImage;
        if (!decoded.width || !decoded.height) continue;
        const size = crossInkPxcSize(
          decoded.width,
          decoded.height,
          crossInkPxcStyle(rules, image),
          viewportWidth,
          viewportHeight,
        );
        if (
          entries.length >= 256 ||
          entries.some((e) => e.href === href) ||
          !crossInkIndexPath(href, 128)
        ) {
          continue;
        }
        const key = `${href}:${size.width}x${size.height}`;
        if (seen.has(key)) continue;
        const pxcPath = `${CROSSINK_PXC_DIR}/${crossInkPxcPathKey(key)}.pxc2`;
        const payload = await buildCrossInkPxc(decoded, size.width, size.height);
        out.file(pxcPath, payload, { compression: "STORE", createFolders: false });
        seen.add(key);
        entries.push({
          href,
          pxc: pxcPath,
          ...size,
          pxcFormat: "pxc2",
          pxcBytes: payload.length,
          pixelCrc32: new DataView(
            payload.buffer,
            payload.byteOffset,
            payload.byteLength,
          ).getUint32(24, true),
        });
        onProgress?.(entries.length);
      } catch {
        // Sidecars are optional; keep the source EPUB image when it
        // cannot be decoded.
      }
    }
  }
  return entries;
}
