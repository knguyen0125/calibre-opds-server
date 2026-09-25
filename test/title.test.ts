import { describe, expect, test } from "bun:test";
import {
  clampToBytes,
  deviceTitleFor,
  formatSeriesIndex,
} from "../src/opds/deviceTitle.ts";

describe("formatSeriesIndex", () => {
  test("zero-pads integers to two digits", () => {
    expect(formatSeriesIndex(2)).toBe("02");
    expect(formatSeriesIndex(13)).toBe("13");
    expect(formatSeriesIndex(107)).toBe("107");
  });

  test("keeps fractional indices without padding zeros", () => {
    expect(formatSeriesIndex(2.5)).toBe("2.5");
    expect(formatSeriesIndex(0.5)).toBe("0.5");
  });
});

describe("deviceTitleFor", () => {
  test("series books become '<Series> <NN> - <Title>'", () => {
    expect(deviceTitleFor({ name: "Mistborn", index: 2 }, "The Well of Ascension")).toBe(
      "Mistborn - 02 - The Well of Ascension",
    );
  });

  test("standalone books keep their title", () => {
    expect(deviceTitleFor(null, "Project Hail Mary")).toBe("Project Hail Mary");
  });

  test("filename-illegal characters map to underscores", () => {
    expect(deviceTitleFor({ name: "SF", index: 1 }, 'Part 1: "The End?"')).toBe(
      'SF - 01 - Part 1_ _The End__',
    );
  });

  test("truncates on a codepoint boundary within 160 bytes", () => {
    const long = "ä".repeat(200); // 2 bytes per char
    const result = deviceTitleFor(null, long);
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(160);
    expect(result.endsWith("�")).toBe(false);
    expect(result.length).toBe(80);
  });
});

describe("clampToBytes", () => {
  test("returns short strings unchanged", () => {
    expect(clampToBytes("hello", 160)).toBe("hello");
  });
});
