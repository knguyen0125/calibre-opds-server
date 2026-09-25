import { describe, expect, test } from "bun:test";
import { firstLetter, letterLabel } from "../src/opds/letters.ts";

describe("firstLetter", () => {
  test("plain ASCII letters pass through uppercased", () => {
    expect(firstLetter("Brandon Sanderson")).toBe("B");
    expect(firstLetter("mistborn")).toBe("M");
  });

  test("diacritics fold to the base letter", () => {
    expect(firstLetter("Lã Quán Trung")).toBe("L");
    expect(firstLetter("Ánh Nguyễn Nhật")).toBe("A");
    expect(firstLetter("Émile Zola")).toBe("E");
  });

  test("D-with-stroke folds to D (no canonical decomposition)", () => {
    expect(firstLetter("Đi Qua Hoa Cúc")).toBe("D");
    expect(firstLetter("đời thừa")).toBe("D");
  });

  test("digits, symbols, and non-Latin share the other bucket", () => {
    expect(firstLetter("$100 Startup")).toBe("other");
    expect(firstLetter("1984")).toBe("other");
    expect(firstLetter("三国演義")).toBe("other");
  });

  test("other bucket renders as #", () => {
    expect(letterLabel("other")).toBe("#");
    expect(letterLabel("Q")).toBe("Q");
  });
});
