/**
 * Text/zip-path helpers ported from CrossInk web/pages/files.js
 * ("EPUB Utilities — ported from EPUB Optimizer Pro").
 */

export const SCRUBBED_BLANK_CODEPOINT_RANGES: readonly [number, number][] = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
];

const SCRUBBED_BLANK_CODEPOINT_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFE00-\uFE0F\uFEFF]/g;
const NUMERIC_CHARACTER_REFERENCE_RE = /&#(?:x([0-9A-Fa-f]+)|([0-9]+));/g;

const encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

export function xmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function isScrubbedBlankCodepoint(codePoint: number): boolean {
  return SCRUBBED_BLANK_CODEPOINT_RANGES.some(
    ([start, end]) => codePoint >= start && codePoint <= end,
  );
}

export function scrubBlankCodepoints(text: string): { text: string; count: number } {
  let count = 0;
  const withoutLiterals = text.replace(SCRUBBED_BLANK_CODEPOINT_RE, () => {
    count++;
    return "";
  });

  const cleaned = withoutLiterals.replace(
    NUMERIC_CHARACTER_REFERENCE_RE,
    (match, hexValue: string, decimalValue: string) => {
      const rawValue = hexValue || decimalValue;
      const codePoint = Number.parseInt(rawValue, hexValue ? 16 : 10);
      if (Number.isFinite(codePoint) && isScrubbedBlankCodepoint(codePoint)) {
        count++;
        return "";
      }
      return match;
    },
  );

  return { text: cleaned, count };
}

/**
 * Read a zip text entry, stripping the UTF-8 BOM and falling back to the
 * declared or meta-tag encoding when the bytes are not valid UTF-8.
 */
export async function safeReadText(
  fileObj: { async(type: "uint8array"): Promise<Uint8Array> },
): Promise<string> {
  const raw = await fileObj.async("uint8array");

  let offset = 0;
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    offset = 3;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw.subarray(offset));
  } catch {
    /* not valid UTF-8 */
  }

  // Peek at the XML declaration or meta charset for an encoding hint.
  // Bun decodes these labels at runtime; the DOM typings whitelist fewer.
  const head = new TextDecoder("windows-1252" as "utf-8", {
    fatal: false,
  }).decode(raw.subarray(offset, offset + 512));
  const encodingMatch =
    head.match(/encoding=["']([^"']+)["']/i) ||
    head.match(/charset=["']?([^"'\s;]+)/i);
  const encoding = encodingMatch
    ? encodingMatch[1]!.toLowerCase()
    : "windows-1252";
  return new TextDecoder(encoding as "utf-8", { fatal: false }).decode(
    raw.subarray(offset),
  );
}


/**
 * Resolve a relative href against a base file path inside the zip.
 * Handles ../, ./, absolute /, and bare relative paths.
 */
export function resolvePath(basePath: string, href: string): string {
  if (href.startsWith("/")) return href.substring(1);
  href = href.replace(/^\.\//, "");
  const baseDir = basePath.includes("/")
    ? basePath.substring(0, basePath.lastIndexOf("/"))
    : "";
  const baseParts = baseDir ? baseDir.split("/") : [];
  const hrefParts = href.split("/");
  while (hrefParts.length > 0 && hrefParts[0] === "..") {
    hrefParts.shift();
    if (baseParts.length > 0) baseParts.pop();
  }
  return [...baseParts, ...hrefParts].join("/").replace(/\/+/g, "/");
}

export function normalizeZipPath(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.substring(0, index);
}

export function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.substring(index + 1);
}

export function joinZipPath(base: string, path: string): string {
  if (!path) return normalizeZipPath(base);
  if (path.startsWith("/")) return normalizeZipPath(path.substring(1));
  return normalizeZipPath((base ? base + "/" : "") + path);
}

export function relativeZipPath(fromFile: string, toPath: string): string {
  const fromParts = dirname(fromFile).split("/").filter(Boolean);
  const toParts = toPath.split("/").filter(Boolean);
  while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  return [...fromParts.map(() => ".."), ...toParts].join("/") || basename(toPath);
}

/** Remove XML comments from XHTML source text, preserving CDATA/PI/DOCTYPE. */
export function stripComments(xml: string): { text: string; count: number; bytes: number } {
  const skippedSections = [
    { open: "<![CDATA[", close: "]]>" },
    { open: "<?", close: "?>" },
  ];
  const out: string[] = [];
  let index = 0;
  let count = 0;
  let bytes = 0;

  const doctypeEnd = (from: number): number => {
    const gt = xml.indexOf(">", from);
    const subset = xml.indexOf("[", from);
    if (subset < 0 || (gt >= 0 && subset > gt)) return gt < 0 ? xml.length : gt + 1;
    const close = xml.indexOf("]>", subset);
    return close < 0 ? xml.length : close + 2;
  };

  while (index < xml.length) {
    const next = xml.indexOf("<", index);
    if (next < 0) {
      out.push(xml.slice(index));
      break;
    }
    if (next > index) out.push(xml.slice(index, next));

    if (xml.startsWith("<!--", next)) {
      const close = xml.indexOf("-->", next + 4);
      const end = close < 0 ? xml.length : close + 3;
      count++;
      bytes += utf8ByteLength(xml.slice(next, end));
      index = end;
      continue;
    }

    if (xml.startsWith("<!DOCTYPE", next)) {
      const end = doctypeEnd(next + 9);
      out.push(xml.slice(next, end));
      index = end;
      continue;
    }

    const skipped = skippedSections.find((section) =>
      xml.startsWith(section.open, next),
    );
    if (skipped) {
      const close = xml.indexOf(skipped.close, next + skipped.open.length);
      const end = close < 0 ? xml.length : close + skipped.close.length;
      out.push(xml.slice(next, end));
      index = end;
      continue;
    }

    out.push("<");
    index = next + 1;
  }

  return { text: out.join(""), count, bytes };
}
