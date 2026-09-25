import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCrossInkImageIndex,
  crossInkCrc32,
  crossInkIndexPath,
  crossInkPackBits,
  crossInkPxcRules,
  crossInkPxcStyle,
  encodeCrossInkPxc2,
} from "../src/optimizer/pxc.ts";
import type { DomElement } from "../src/optimizer/dom.ts";

const golden = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(import.meta.dir, "golden/pxc_v2", name)));

/**
 * Golden vectors are CrossInk's own (test/pxc_v2/golden): the browser
 * encoder output must match byte-for-byte, and the COIX index must be
 * internally consistent per docs/file-formats.md.
 */
describe("PXC2 encoder", () => {
  test("matches CrossInk browser golden bytes", () => {
    const output = encodeCrossInkPxc2(golden("pixels.pxc"));
    expect(Buffer.from(output).equals(Buffer.from(golden("browser.pxc2")))).toBe(
      true,
    );
    expect(Buffer.from(output).equals(Buffer.from(golden("packbits.pxc2")))).toBe(
      true,
    );
  });

  test("rejects out-of-spec dimensions", () => {
    const bogus = new Uint8Array(4 + 4);
    new DataView(bogus.buffer).setUint16(0, 2000, true); // width > 1024
    new DataView(bogus.buffer).setUint16(2, 4, true);
    expect(() => encodeCrossInkPxc2(bogus)).toThrow();
  });
});

describe("PackBits", () => {
  test("packs runs and literals per spec", () => {
    const input = new Uint8Array([7, 7, 7, 7, 7, 1, 2, 3, 9, 9, 9, 9]);
    const packed = crossInkPackBits(input);
    expect(Array.from(packed)).toEqual([252, 7, 2, 1, 2, 3, 253, 9]);
    // Decoding: 257-252=5 sevens, then 3 literals (2,1,2,3 -> control 2
    // means copy next 3), then 257-253=4 nines.
    const out: number[] = [];
    for (let i = 0; i < packed.length; ) {
      const control = packed[i++]!;
      if (control > 127) {
        const count = 257 - control;
        const value = packed[i++]!;
        for (let k = 0; k < count; k++) out.push(value);
      } else {
        for (let k = 0; k <= control; k++) out.push(packed[i++]!);
      }
    }
    expect(out).toEqual(Array.from(input));
  });
});

describe("COIX index", () => {
  test("header, crcs, and record layout are consistent", () => {
    const pxc2 = encodeCrossInkPxc2(golden("pixels.pxc"));
    const pixelCrc = new DataView(pxc2.buffer).getUint32(24, true);
    const entries = Array.from({ length: 89 }, (_, i) => ({
      href: `EPUB/${i}.jpg`,
      pxc: "META-INF/crossink/pxc/x.pxc2",
      width: 127,
      height: 131,
      pxcFormat: "pxc2" as const,
      pxcBytes: pxc2.length,
      pixelCrc32: pixelCrc,
    }));
    const manifest = new TextEncoder().encode(JSON.stringify({ images: entries }));
    const index = buildCrossInkImageIndex(manifest, entries);
    const view = new DataView(index.buffer);

    expect(index.length).toBe(32 + 208 * 89);
    expect(Array.from(index.subarray(0, 4))).toEqual([67, 79, 73, 88]);
    expect(view.getUint16(4, true)).toBe(1); // version
    expect(view.getUint16(8, true)).toBe(208); // record bytes
    expect(view.getUint16(10, true)).toBe(89); // record count
    expect(view.getUint32(16, true)).toBe(crossInkCrc32(manifest));
    expect(view.getUint32(20, true)).toBe(manifest.length);
    expect(view.getUint32(24, true)).toBe(crossInkCrc32(index.subarray(32)));
    expect(view.getUint32(28, true)).toBe(crossInkCrc32(index.subarray(0, 28)));

    // First record fields
    const first = 32;
    const decoder = new TextDecoder();
    const hrefEnd = index.indexOf(0, first);
    expect(decoder.decode(index.subarray(first, hrefEnd))).toBe("EPUB/0.jpg");
    expect(view.getUint16(first + 194, true)).toBe(127);
    expect(view.getUint16(first + 196, true)).toBe(131);
    expect(index[first + 198]).toBe(2); // PXC2 format
    expect(view.getUint32(first + 200, true)).toBe(pxc2.length);
    expect(view.getUint32(first + 204, true)).toBe(pixelCrc);
  });

  test("rejects duplicate hrefs and too many records", () => {
    const entry = {
      href: "EPUB/a.jpg",
      pxc: "META-INF/crossink/pxc/a.pxc2",
      width: 8,
      height: 8,
      pxcFormat: "pxc2" as const,
      pxcBytes: 40,
      pixelCrc32: 1,
    };
    const manifest = new TextEncoder().encode("[]");
    expect(() =>
      buildCrossInkImageIndex(manifest, [entry, entry]),
    ).toThrow();
    expect(() =>
      buildCrossInkImageIndex(
        manifest,
        Array.from({ length: 257 }, () => entry),
      ),
    ).toThrow();
  });
});

describe("PXC css sizing", () => {
  const rules = crossInkPxcRules("div.full img { width:100px; height:200px }");
  const imageFor = (matches: (selector: string) => boolean): DomElement =>
    ({
      getAttribute: () => "",
      matches,
    }) as unknown as DomElement;

  test("applies matching selectors only", () => {
    expect(crossInkPxcStyle(rules, imageFor((s) => s === "div.full img"))).toEqual(
      { width: "100px", height: "200px" },
    );
    expect(crossInkPxcStyle(rules, imageFor(() => false))).toEqual({});
  });

  test("invalid selectors are ignored", () => {
    expect(crossInkPxcStyle(rules, imageFor(() => { throw new Error("bad"); }))).toEqual({});
  });

  test("path validation rejects traversal, escapes, and oversize", () => {
    for (const bad of ["", "/x", "../x", "a\\b", "a%00", "x".repeat(129)]) {
      expect(crossInkIndexPath(bad, 128)).toBe(false);
    }
    expect(crossInkIndexPath("EPUB/img 1.jpg", 128)).toBe(true);
  });
});
