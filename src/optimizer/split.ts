/**
 * Long-section splitting ported from CrossInk web/pages/files.js.
 * Oversized XHTML sections are split at natural boundaries so the
 * reader's section builder stays within its memory budget; empty spine
 * stubs are collapsed and references rewritten.
 */
import {
  docBody,
  ELEMENT_NODE,
  isElement,
  localName,
  parseHtml,
  parseXhtml,
  parseXml,
  safeSerialize,
  serialize,
  TEXT_NODE,
  type DomDocument,
  type DomElement,
  type DomNode,
} from "./dom.ts";
import { decodeHref, relativeZipPath, resolvePath, utf8ByteLength } from "./text.ts";
import { parseOpfSpineHrefs } from "./opf.ts";

export const SECTION_SPLIT_WORD_THRESHOLD = 8000;
export const SECTION_SPLIT_BYTE_THRESHOLD = 32768;
export const SECTION_SPLIT_HARD_BYTE_LIMIT = 49152;
export const SECTION_SPLIT_NATURAL_BOUNDARY_LOOKAHEAD_BYTES = 8192;
const SECTION_SPLIT_SUFFIX_RE = /__ci_section_\d{3}(?=\.[^.]+$)/i;

export function extractLocationText(xhtmlContent: string): string {
  const xmlDoc = parseXhtml(xhtmlContent);
  if (xmlDoc) {
    xmlDoc
      .querySelectorAll("script,style,svg,metadata")
      .forEach((el) => el.remove());
    const root = docBody(xmlDoc) ?? xmlDoc.documentElement;
    return root?.textContent ?? "";
  }

  const htmlDoc = parseHtml(xhtmlContent);
  if (htmlDoc) {
    htmlDoc
      .querySelectorAll("script,style,svg,metadata")
      .forEach((el) => el.remove());
    const root = docBody(htmlDoc) ?? htmlDoc.documentElement;
    return root?.textContent ?? "";
  }

  return xhtmlContent
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

export function countLocationWords(text: string): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return 0;
  return (
    normalized.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
  ).length;
}

export function countReferenceCharacters(text: string): number {
  return Array.from(text.replace(/\s+/g, " ").trim()).length;
}

function isSafeSectionSplitElement(node: DomNode | null): boolean {
  if (!node || node.nodeType !== ELEMENT_NODE) return true;
  return [
    "p",
    "div",
    "section",
    "article",
    "aside",
    "blockquote",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
  ].includes(localName(node));
}

function isHeadingElement(node: DomNode | null): boolean {
  return (
    node !== null &&
    node !== undefined &&
    node.nodeType === ELEMENT_NODE &&
    /^h[1-6]$/i.test(localName(node))
  );
}

function isIgnorableSectionSplitNode(node: DomNode | null | undefined): boolean {
  return (
    node?.nodeType === TEXT_NODE && !(node.textContent || "").trim()
  );
}

function hasNaturalSectionPageBoundary(node: DomNode | null): boolean {
  if (!node || !isElement(node)) return false;
  const elements: DomElement[] = [node, ...node.querySelectorAll("*")];
  return elements.some((element) => {
    const name = localName(element);
    if (name === "hr") return true;
    const epubType =
      element.getAttribute("epub:type") ||
      element.getAttributeNS?.("http://www.idpf.org/2007/ops", "type") ||
      "";
    const role = element.getAttribute("role") || "";
    const style = element.getAttribute("style") || "";
    return (
      /(^|\s)pagebreak(\s|$)/i.test(epubType) ||
      /(^|\s)doc-pagebreak(\s|$)/i.test(role) ||
      /(?:^|;)\s*(?:-epub-)?(?:page-break|break)-(?:before|after)\s*:\s*(?:always|page|left|right|recto|verso)\b/i.test(
        style,
      )
    );
  });
}

function isNaturalSectionSplitBoundary(
  previous: DomNode | null,
  next: DomNode | null,
): boolean {
  return (
    hasNaturalSectionPageBoundary(previous) ||
    hasNaturalSectionPageBoundary(next) ||
    isHeadingElement(next)
  );
}

function findNaturalSectionSplitIndex(
  splitChildren: DomNode[],
  candidateIndex: number,
  current: DomNode[],
  currentBytes: number,
): number {
  const byteLimit = Math.min(
    SECTION_SPLIT_HARD_BYTE_LIMIT,
    Math.max(currentBytes, SECTION_SPLIT_BYTE_THRESHOLD) +
      SECTION_SPLIT_NATURAL_BOUNDARY_LOOKAHEAD_BYTES,
  );
  let projectedBytes = currentBytes;
  for (let index = candidateIndex; index < splitChildren.length; index++) {
    if (index > candidateIndex) {
      projectedBytes += utf8ByteLength(serialize(splitChildren[index - 1]!));
    }
    if (projectedBytes > byteLimit) break;
    const priorNodes = current.concat(splitChildren.slice(candidateIndex, index));
    const previous = [...priorNodes]
      .reverse()
      .find((node) => !isIgnorableSectionSplitNode(node)) ?? null;
    const next = splitChildren[index]!;
    const canBreakBefore =
      previous !== null &&
      isSafeSectionSplitElement(next) &&
      !shouldKeepSectionSplitCluster(next) &&
      !isHeadingElement(previous);
    if (canBreakBefore && isNaturalSectionSplitBoundary(previous, next)) {
      return index;
    }
  }
  return candidateIndex;
}

function findNaturalSectionSplitOffsetInCurrent(
  current: DomNode[],
): number {
  let trailingBytes = 0;
  for (let offset = current.length - 1; offset > 0; offset--) {
    trailingBytes += utf8ByteLength(serialize(current[offset]!));
    if (trailingBytes > SECTION_SPLIT_NATURAL_BOUNDARY_LOOKAHEAD_BYTES) break;
    const previous =
      [...current.slice(0, offset)].reverse().find((node) => !isIgnorableSectionSplitNode(node)) ??
      null;
    const next = current[offset]!;
    const canBreakBefore =
      previous !== null &&
      isSafeSectionSplitElement(next) &&
      !shouldKeepSectionSplitCluster(next) &&
      !isHeadingElement(previous);
    if (canBreakBefore && isNaturalSectionSplitBoundary(previous, next)) {
      return offset;
    }
  }
  return -1;
}

function chunkHasReaderContent(nodes: DomNode[]): boolean {
  const visit = (node: DomNode, hidden: boolean): boolean => {
    if (node.nodeType === TEXT_NODE) {
      return !hidden && !!(node.textContent || "").trim();
    }
    if (!isElement(node)) return false;
    const name = localName(node);
    const nextHidden =
      hidden ||
      node.hasAttribute("data-AmznRemoved-M8") ||
      ["script", "style", "svg", "metadata"].includes(name);
    if (nextHidden) return false;
    if (name === "img") return true;
    return Array.from(node.childNodes).some((child) =>
      visit(child as DomNode, nextHidden),
    );
  };
  return nodes.some((node) => visit(node, false));
}

function shouldKeepSectionSplitCluster(node: DomNode | null): boolean {
  if (!node || !isElement(node)) return false;
  const name = localName(node);
  return (
    ["table", "figure", "svg"].includes(name) ||
    !!node.querySelector?.("table,figure,svg")
  );
}

function isAtomicSectionSplitContainer(node: DomNode | null): boolean {
  return (
    node !== null &&
    node !== undefined &&
    node.nodeType === ELEMENT_NODE &&
    ["table", "figure", "svg"].includes(localName(node))
  );
}

function findSectionSplitContainer(body: DomNode): {
  container: DomNode;
  childPath: number[];
} | null {
  let container = body;
  const childPath: number[] = [];
  for (;;) {
    const children = Array.from(container.childNodes) as DomNode[];
    const elementChildren = children
      .map((child, index) => ({ child, index }))
      .filter(({ child }) => child.nodeType === ELEMENT_NODE);
    if (elementChildren.length >= 2) return { container, childPath };
    if (elementChildren.length !== 1 || isAtomicSectionSplitContainer(elementChildren[0]!.child)) {
      return null;
    }
    childPath.push(elementChildren[0]!.index);
    container = elementChildren[0]!.child;
  }
}

function makeSectionSplitPath(path: string, partIndex: number): string {
  if (partIndex === 0) return path;
  const dot = path.lastIndexOf(".");
  const suffix = `__ci_section_${String(partIndex + 1).padStart(3, "0")}`;
  return dot > 0
    ? `${path.substring(0, dot)}${suffix}${path.substring(dot)}`
    : `${path}${suffix}.xhtml`;
}

export function splitBaseHref(href: string): string {
  return href.replace(SECTION_SPLIT_SUFFIX_RE, "");
}

function readerSectionIdentity(content: string): string | null {
  const doc = parseXhtml(content);
  const body = doc ? docBody(doc) : null;
  if (!doc || !body) return null;
  const id = body.getAttribute("id") || "";
  const title = doc.querySelector("title")?.textContent?.trim() || "";
  return id && title ? `${id}\u0000${title}` : null;
}

function hasReaderContent(content: string): boolean {
  const doc = parseXhtml(content);
  const body = doc ? docBody(doc) : null;
  if (!doc || !body) return true;
  const clone = body.cloneNode(true) as DomElement;
  clone
    .querySelectorAll("script,style,svg,metadata,[data-AmznRemoved-M8]")
    .forEach((node) => node.remove());
  return !!(clone.textContent || "").trim() || !!clone.querySelector("img");
}

export function collapseReaderEmptySpineItems(
  xhtmlFiles: Record<string, string>,
  opfContent: string,
  opfPath: string,
): { opfContent: string; redirects: Map<string, string> } {
  const doc = parseXml(opfContent);
  const redirects = new Map<string, string>();
  if (!doc) return { opfContent, redirects };
  const manifestById = new Map<string | null, DomElement>(
    Array.from(doc.getElementsByTagNameNS("*", "item")).map((item) => [
      item.getAttribute("id"),
      item,
    ]),
  );
  const spine = doc.getElementsByTagNameNS("*", "spine")[0];
  if (!spine) return { opfContent, redirects };
  const refs = Array.from(spine.getElementsByTagNameNS("*", "itemref"));
  for (let index = 0; index + 1 < refs.length; index++) {
    const item = manifestById.get(refs[index]!.getAttribute("idref"));
    const nextItem = manifestById.get(refs[index + 1]!.getAttribute("idref"));
    const href = item?.getAttribute("href");
    const nextHref = nextItem?.getAttribute("href");
    if (!href || !nextHref) continue;
    const path = resolvePath(opfPath, decodeHref(href.split("#")[0]!));
    const nextPath = resolvePath(opfPath, decodeHref(nextHref.split("#")[0]!));
    const content = xhtmlFiles[path];
    const nextContent = xhtmlFiles[nextPath];
    if (!content || !nextContent || hasReaderContent(content) || !hasReaderContent(nextContent)) {
      continue;
    }
    const identity = readerSectionIdentity(content);
    if (!identity || identity !== readerSectionIdentity(nextContent)) continue;
    redirects.set(path, nextPath);
    spine.removeChild(refs[index]!);
  }
  return { opfContent: safeSerialize(doc, opfContent), redirects };
}

export function rewriteCollapsedSpineReferences(
  content: string,
  sourcePath: string,
  redirects: Map<string, string>,
): string {
  if (redirects.size === 0) return content;
  const doc = parseXml(content);
  if (!doc) return content;
  let changed = false;
  for (const element of Array.from(doc.getElementsByTagName("*"))) {
    for (const attribute of ["href", "src", "xlink:href"]) {
      const value = element.getAttribute(attribute);
      if (!value || value.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
        continue;
      }
      const [href, fragment = ""] = value.split(/#(.*)/s, 2) as [string, string];
      const target = redirects.get(resolvePath(sourcePath, decodeHref(href)));
      if (!target) continue;
      element.setAttribute(
        attribute,
        `${relativeZipPath(sourcePath, target)}${fragment ? `#${fragment}` : ""}`,
      );
      changed = true;
    }
  }
  return changed ? safeSerialize(doc, content) : content;
}

export function rewriteSplitSectionReferences(
  content: string,
  sourcePath: string,
  anchorTargets: Map<string, Map<string, string>>,
): string {
  if (anchorTargets.size === 0) return content;
  const doc = parseXml(content);
  if (!doc) return content;
  let changed = false;
  for (const element of Array.from(doc.getElementsByTagName("*"))) {
    for (const attribute of ["href", "xlink:href"]) {
      const value = element.getAttribute(attribute);
      if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
      const [href, fragment = ""] = value.split(/#(.*)/s, 2) as [string, string];
      if (!fragment) continue;
      const targetPath = href
        ? resolvePath(sourcePath, decodeHref(href))
        : sourcePath;
      const partPath = anchorTargets.get(targetPath)?.get(decodeHref(fragment));
      if (!partPath) continue;
      element.setAttribute(
        attribute,
        `${relativeZipPath(sourcePath, partPath)}#${fragment}`,
      );
      changed = true;
    }
  }
  return changed ? safeSerialize(doc, content) : content;
}

export type SourceSpineMap = {
  version: number;
  spineCount: number;
  sourceByHref: Record<
    string,
    | { sourceSpineIndex: number }
    | {
        sourceSpineIndex: number;
        containerDepth: number;
        childRanges: { name: string; offset: number; count: number }[];
      }
  >;
};

export type SectionSplitResult = {
  files: Record<string, string>;
  splitSections: Record<string, string[]>;
  anchorTargets: Map<string, Map<string, string>>;
  sourceSpineMap: SourceSpineMap | null;
};

export function splitLongXhtmlSections(
  xhtmlFiles: Record<string, string>,
  opfContent: string,
  opfPath: string,
  enabled: boolean,
): SectionSplitResult {
  if (!enabled) {
    return {
      files: xhtmlFiles,
      splitSections: {},
      anchorTargets: new Map(),
      sourceSpineMap: null,
    };
  }

  const out: Record<string, string> = {};
  const splitSections: Record<string, string[]> = {};
  const anchorTargets = new Map<string, Map<string, string>>();
  const originalSpineHrefs = parseOpfSpineHrefs(opfContent, opfPath);
  const spinePaths = new Set(originalSpineHrefs);
  const sourceByHref: SourceSpineMap["sourceByHref"] = {};
  originalSpineHrefs.forEach((href, sourceSpineIndex) => {
    sourceByHref[href] = { sourceSpineIndex };
  });

  for (const [path, content] of Object.entries(xhtmlFiles)) {
    if (!spinePaths.has(path)) {
      out[path] = content;
      continue;
    }
    const totalWords = countLocationWords(extractLocationText(content));
    const totalBytes = utf8ByteLength(content);
    if (totalWords <= SECTION_SPLIT_WORD_THRESHOLD && totalBytes <= SECTION_SPLIT_BYTE_THRESHOLD) {
      out[path] = content;
      continue;
    }

    const doc = parseXhtml(content);
    const body = doc ? docBody(doc) : null;
    if (!doc || !body) {
      out[path] = content;
      continue;
    }
    const splitContainer = findSectionSplitContainer(body);
    if (!splitContainer) {
      out[path] = content;
      continue;
    }
    const splitChildren = Array.from(splitContainer.container.childNodes) as DomNode[];
    const fixedBytes = Math.max(
      0,
      totalBytes -
        splitChildren.reduce(
          (sum, child) => sum + utf8ByteLength(serialize(child)),
          0,
        ),
    );

    const chunks: DomNode[][] = [];
    let current: DomNode[] = [];
    let currentWords = 0;
    let currentBytes = fixedBytes;
    const flush = () => {
      if (current.length === 0) return;
      chunks.push(current);
      current = [];
      currentWords = 0;
      currentBytes = fixedBytes;
    };

    for (let childIndex = 0; childIndex < splitChildren.length; childIndex++) {
      const child = splitChildren[childIndex]!;
      const childWords = countLocationWords(child.textContent || "");
      const childBytes = utf8ByteLength(serialize(child));
      const lastContentNode =
        [...current].reverse().find((node) => !isIgnorableSectionSplitNode(node)) ??
        null;
      const wouldExceed =
        lastContentNode !== null &&
        (currentWords + childWords > SECTION_SPLIT_WORD_THRESHOLD ||
          currentBytes + childBytes > SECTION_SPLIT_BYTE_THRESHOLD);
      const canBreakBefore =
        lastContentNode !== null &&
        isSafeSectionSplitElement(child) &&
        !shouldKeepSectionSplitCluster(child) &&
        !isHeadingElement(lastContentNode);
      const naturalSplitOffset =
        wouldExceed && currentBytes <= SECTION_SPLIT_HARD_BYTE_LIMIT
          ? findNaturalSectionSplitOffsetInCurrent(current)
          : -1;
      if (naturalSplitOffset > 0) {
        const completed = current.splice(0, naturalSplitOffset);
        chunks.push(completed);
        currentWords = current.reduce(
          (sum, node) => sum + countLocationWords(node.textContent || ""),
          0,
        );
        currentBytes =
          fixedBytes +
          current.reduce((sum, node) => sum + utf8ByteLength(serialize(node)), 0);
      } else if (wouldExceed && canBreakBefore) {
        const naturalSplitIndex = findNaturalSectionSplitIndex(
          splitChildren,
          childIndex,
          current,
          currentBytes,
        );
        if (naturalSplitIndex > childIndex) {
          for (let index = childIndex; index < naturalSplitIndex; index++) {
            const node = splitChildren[index]!;
            current.push(node);
            currentWords += countLocationWords(node.textContent || "");
            currentBytes += utf8ByteLength(serialize(node));
          }
          flush();
          childIndex = naturalSplitIndex - 1;
          continue;
        }
        flush();
      }

      current.push(child);
      currentWords += childWords;
      currentBytes += childBytes;

      const canBreakAfter =
        !isIgnorableSectionSplitNode(child) &&
        isSafeSectionSplitElement(child) &&
        !shouldKeepSectionSplitCluster(child) &&
        !isHeadingElement(child);
      if (currentBytes >= SECTION_SPLIT_HARD_BYTE_LIMIT && canBreakAfter) flush();
    }
    flush();
    const mergedChunks: DomNode[][] = [];
    let pending: DomNode[] = [];
    for (const chunk of chunks) {
      if (chunkHasReaderContent(chunk)) {
        mergedChunks.push([...pending, ...chunk]);
        pending = [];
      } else {
        pending.push(...chunk);
      }
    }
    if (pending.length > 0 && mergedChunks.length > 0) {
      mergedChunks[mergedChunks.length - 1]!.push(...pending);
    }
    chunks.splice(0, chunks.length, ...mergedChunks);

    if (chunks.length < 2) {
      out[path] = content;
      continue;
    }

    splitSections[path] = [];
    const sectionAnchors = new Map<string, string>();
    anchorTargets.set(path, sectionAnchors);
    const tagOffsets = new Map<string, number>();
    chunks.forEach((chunk, partIndex) => {
      const partPath = makeSectionSplitPath(path, partIndex);
      const partDoc = doc.cloneNode(true) as DomDocument;
      let partContainer: DomNode | null = docBody(partDoc);
      for (const childIndex of splitContainer.childPath) {
        partContainer = (partContainer?.childNodes[childIndex] ?? null) as DomNode | null;
      }
      if (!partContainer) return;
      while (partContainer.firstChild) partContainer.removeChild(partContainer.firstChild);
      for (const node of chunk) partContainer.appendChild(partDoc.importNode(node, true));
      for (const element of Array.from(partDoc.getElementsByTagName("*"))) {
        const anchor =
          element.getAttribute("id") ||
          (localName(element) === "a" ? element.getAttribute("name") : null);
        if (anchor && !sectionAnchors.has(anchor)) sectionAnchors.set(anchor, partPath);
      }
      out[partPath] = safeSerialize(partDoc, content);
      splitSections[path]!.push(partPath);
      const rangesByName = new Map<
        string,
        { name: string; offset: number; count: number }
      >();
      for (const node of chunk) {
        if (node.nodeType !== ELEMENT_NODE) continue;
        const name = localName(node);
        const range = rangesByName.get(name) ?? {
          name,
          offset: tagOffsets.get(name) || 0,
          count: 0,
        };
        range.count++;
        rangesByName.set(name, range);
        tagOffsets.set(name, (tagOffsets.get(name) || 0) + 1);
      }
      sourceByHref[partPath] = {
        sourceSpineIndex: originalSpineHrefs.indexOf(path),
        containerDepth: splitContainer.childPath.length,
        childRanges: Array.from(rangesByName.values()),
      };
    });
  }

  const hasSplits = Object.keys(splitSections).length > 0;
  return {
    files: out,
    splitSections,
    anchorTargets,
    sourceSpineMap: hasSplits
      ? { version: 1, spineCount: originalSpineHrefs.length, sourceByHref }
      : null,
  };
}

