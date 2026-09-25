/**
 * Alphabet bucketing for large catalogs: fold the first character to
 * its base letter (diacritics stripped via NFD) so "Lã" groups under L;
 * anything that is not A-Z lands in the "other" bucket.
 */
export const OTHER_LETTER = "other";

export function firstLetter(value: string): string {
  // D-with-stroke (Đ/đ) has no canonical decomposition but sorts under
  // D in Vietnamese; map it before folding the remaining marks.
  const stripped = value
    .replace(/[Đđ]/g, "D")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  const char = stripped.charAt(0).toUpperCase();
  return /^[A-Z]$/.test(char) ? char : OTHER_LETTER;
}

export function letterLabel(letter: string): string {
  return letter === OTHER_LETTER ? "#" : letter;
}

export function letterTitle(prefix: string, letter: string): string {
  return `${prefix} - ${letterLabel(letter)}`;
}

/** Distinct letters of all values, A-Z order with "other" last. */
export function distinctSortedLetters(values: Iterable<string>): string[] {
  const letters = new Set<string>();
  for (const value of values) letters.add(firstLetter(value));
  return [...letters].sort((a, b) => {
    if (a === OTHER_LETTER) return 1;
    if (b === OTHER_LETTER) return -1;
    return a.localeCompare(b);
  });
}
