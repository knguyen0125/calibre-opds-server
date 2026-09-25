import type { DeviceTag } from "../auth.ts";

/**
 * Entry titles for CrossInk readers. The device builds the saved
 * filename from the entry title alone (author omitted), sanitized with
 * '/' and friends mapped to '_' (StringUtils.cpp), and the OPDS parser
 * caps titles at 160 bytes (OpdsParser.cpp). Crafting the title here
 * means the X4 saves exactly "<Series> <NN> - <Title>.epub" or
 * "<Title>.epub".
 */

/** Device parser bound (OpdsParser.cpp MAX_TITLE_CHARS). */
export const DEVICE_TITLE_MAX_BYTES = 160;

export type BookSeries = { name: string; index: number };

function sanitizePart(title: string): string {
  return title.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").replace(/[. ]+$/, "");
}

/** Zero-pad integer indices ("02"), keep fractional ones ("2.5"). */
export function formatSeriesIndex(index: number): string {
  if (Number.isInteger(index)) return String(index).padStart(2, "0");
  return String(index).replace(/0+$/, "").replace(/\.$/, "");
}

/** Truncate on a UTF-8 codepoint boundary within the byte budget. */
export function clampToBytes(title: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(title);
  if (bytes.length <= maxBytes) return title;
  let cut = maxBytes;
  // Back off to the start of the last codepoint (continuation bytes
  // are 0b10xxxxxx).
  while (cut > 0 && (bytes[cut]! & 0xc0) === 0x80) cut--;
  return new TextDecoder().decode(bytes.subarray(0, cut));
}

export function deviceTitleFor(
  series: BookSeries | null,
  title: string,
): string {
  const base = series
    ? `${series.name} - ${formatSeriesIndex(series.index)} - ${title}`
    : title;
  return clampToBytes(sanitizePart(base), DEVICE_TITLE_MAX_BYTES);
}
