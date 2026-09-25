/**
 * X-locations manifest ported from CrossInk web/pages/files.js
 * buildXLocationManifest: word/character counts per spine item so
 * readers can map reading positions without laying out the book.
 */
import { basename, decodeHref } from "./text.ts";
import { parseOpfSpineHrefs } from "./opf.ts";
import {
  countLocationWords,
  countReferenceCharacters,
  extractLocationText,
  splitBaseHref,
  type SourceSpineMap,
} from "./split.ts";

export const X_LOCATION_MANIFEST_PATH = "META-INF/x-locations.json";
export const X_LOCATION_WORDS_PER_UNIT = 64;
export const X_DEFAULT_REFERENCE_CHARACTERS_PER_PAGE = 1500;

export function normalizedReferenceCharactersPerPage(value: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(10000, Math.round(value)))
    : X_DEFAULT_REFERENCE_CHARACTERS_PER_PAGE;
}

function resolveXhtmlContentForLocation(
  path: string,
  xhtmlFiles: Record<string, string>,
): string | null {
  if (xhtmlFiles[path]) return xhtmlFiles[path]!;
  const decoded = decodeHref(path);
  if (xhtmlFiles[decoded]) return xhtmlFiles[decoded]!;
  const filename = decoded.split("/").pop() ?? "";
  const match = Object.entries(xhtmlFiles).find(
    ([candidate]) => candidate === decoded || candidate.endsWith("/" + filename),
  );
  return match ? match[1]! : null;
}

export type XLocationManifest = {
  format: "x-locations";
  version: 1;
  generator: string;
  unit: "word";
  referencePageUnit: "character";
  wordsPerLocation: number;
  charactersPerReferencePage: number;
  totalWords: number;
  totalCharacters: number;
  totalLocations: number;
  totalReferencePages: number;
  spine: Record<string, unknown>[];
  chapterGroups?: Record<string, unknown>[];
  sourceSpineMap?: Record<string, unknown>;
};

export function buildXLocationManifest(
  opfContent: string,
  opfPath: string,
  xhtmlFiles: Record<string, string>,
  charactersPerReferencePage: number,
  sourceSpineMap: SourceSpineMap | null,
  generator: string,
): XLocationManifest | null {
  const perPage = normalizedReferenceCharactersPerPage(charactersPerReferencePage);
  const spineHrefs = parseOpfSpineHrefs(opfContent, opfPath);
  if (spineHrefs.length === 0) return null;

  const spine: Record<string, unknown>[] = [];
  const splitBases = new Set(
    spineHrefs
      .map(splitBaseHref)
      .filter((base, index) => base !== spineHrefs[index]),
  );
  const groupByBase = new Map(
    Array.from(splitBases)
      .sort()
      .map((base, index) => [base, index] as const),
  );
  const chapterGroups = new Map<number, Record<string, unknown>>();
  let totalWords = 0;
  let totalCharacters = 0;
  let nextLocation = 1;

  for (let index = 0; index < spineHrefs.length; index++) {
    const href = spineHrefs[index]!;
    const content = resolveXhtmlContentForLocation(href, xhtmlFiles);
    const visibleText = content ? extractLocationText(content) : "";
    const wordCount = countLocationWords(visibleText);
    const characterCount = countReferenceCharacters(visibleText);
    const locationCount = Math.ceil(wordCount / X_LOCATION_WORDS_PER_UNIT);
    const startLocation = locationCount > 0 ? nextLocation : 0;
    const endLocation = locationCount > 0 ? nextLocation + locationCount - 1 : 0;
    const startReferencePage =
      characterCount > 0 ? Math.floor(totalCharacters / perPage) + 1 : 0;
    const endReferencePage =
      characterCount > 0 ? Math.ceil((totalCharacters + characterCount) / perPage) : 0;

    const spineEntry: Record<string, unknown> = {
      index,
      href,
      wordStart: totalWords,
      wordCount,
      characterStart: totalCharacters,
      characterCount,
      startLocation,
      endLocation,
      startReferencePage,
      endReferencePage,
    };
    const baseHref = splitBaseHref(href);
    const chapterGroup = groupByBase.get(baseHref);
    if (chapterGroup !== undefined) {
      spineEntry.chapterGroup = chapterGroup;
      const group =
        chapterGroups.get(chapterGroup) ??
        ({
          index: chapterGroup,
          title: basename(baseHref).replace(/\.[^.]+$/, ""),
          firstSpineIndex: index,
          lastSpineIndex: index,
          startLocation,
          endLocation,
          wordStart: totalWords,
          wordCount: 0,
          characterStart: totalCharacters,
          characterCount: 0,
          referencePageStart: startReferencePage,
          referencePageEnd: endReferencePage,
        } as Record<string, unknown>);
      group.firstSpineIndex = Math.min(group.firstSpineIndex as number, index);
      group.lastSpineIndex = Math.max(group.lastSpineIndex as number, index);
      if (startLocation > 0 && (group.startLocation === 0 || startLocation < (group.startLocation as number))) {
        group.startLocation = startLocation;
      }
      group.endLocation = Math.max(group.endLocation as number, endLocation);
      group.wordCount = (group.wordCount as number) + wordCount;
      group.characterCount = (group.characterCount as number) + characterCount;
      if (
        startReferencePage > 0 &&
        (group.referencePageStart === 0 ||
          startReferencePage < (group.referencePageStart as number))
      ) {
        group.referencePageStart = startReferencePage;
      }
      group.referencePageEnd = Math.max(
        group.referencePageEnd as number,
        endReferencePage,
      );
      chapterGroups.set(chapterGroup, group);
    }
    spine.push(spineEntry);

    totalWords += wordCount;
    totalCharacters += characterCount;
    nextLocation += locationCount;
  }

  const manifest: XLocationManifest = {
    format: "x-locations",
    version: 1,
    generator,
    unit: "word",
    referencePageUnit: "character",
    wordsPerLocation: X_LOCATION_WORDS_PER_UNIT,
    charactersPerReferencePage: perPage,
    totalWords,
    totalCharacters,
    totalLocations: Math.max(0, nextLocation - 1),
    totalReferencePages: Math.ceil(totalCharacters / perPage),
    spine,
  };
  if (chapterGroups.size > 0) {
    manifest.chapterGroups = Array.from(chapterGroups.values()).sort(
      (a, b) => (a.index as number) - (b.index as number),
    );
  }
  if (sourceSpineMap) {
    const mappedSpine = spineHrefs.map((href, index) => ({
      index,
      ...sourceSpineMap.sourceByHref[href],
    }));
    if (
      mappedSpine.every(
        (entry) => Number.isInteger((entry as { sourceSpineIndex?: number }).sourceSpineIndex),
      )
    ) {
      manifest.sourceSpineMap = {
        version: sourceSpineMap.version,
        spineCount: sourceSpineMap.spineCount,
        spine: mappedSpine,
      };
    }
  }
  return manifest;
}
