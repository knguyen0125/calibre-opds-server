/**
 * XML/HTML parsing and serialization over linkedom, replacing the
 * browser DOMParser/XMLSerializer used by the CrossInk web optimizer.
 *
 * linkedom ships unusably loose typings (everything `any`), so this
 * module declares the structural surface the optimizer needs and casts
 * once at the parse boundary; everything downstream is type-checked
 * against these interfaces.
 *
 * Behavioral differences from the browser, absorbed here:
 * - linkedom's XML parser is lenient and never produces <parsererror>,
 *   so parseXhtml/parseXml validate the root element instead and return
 *   null when the tree looks unusable; callers then take the regex
 *   fallback paths ported from files.js.
 * - There is no XMLSerializer export; nodes serialize via toString()
 *   (documents include an <?xml?> prolog, elements do not).
 * - XML-parsed documents have no .body/.head convenience properties, so
 *   docBody() finds the body element by tag name instead.
 */
import { DOMParser } from "linkedom";

import { escapeRegex } from "./text.ts";

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
export interface DomNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: DomNode[];
  parentNode: DomElement | null;
  firstChild: DomNode | null;
  nextSibling: DomNode | null;
  appendChild(node: DomNode): DomNode;
  removeChild(node: DomNode): DomNode;
  insertBefore(node: DomNode, ref: DomNode | null): DomNode;
  replaceChild(newNode: DomNode, oldNode: DomNode): DomNode;
  remove(): void;
  cloneNode(deep?: boolean): DomNode;
  toString(): string;
}

export function isElement(node: DomNode): node is DomElement {
  return node.nodeType === ELEMENT_NODE;
}

export interface DomElement extends DomNode {
  localName: string | null;
  namespaceURI: string | null;
  parentElement: DomElement | null;
  getAttribute(name: string): string | null;
  getAttributeNS(ns: string, name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  getElementsByTagName(tag: string): DomElement[];
  getElementsByTagNameNS(ns: string, tag: string): DomElement[];
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): DomElement[];
  matches(selector: string): boolean;
}

export interface DomDocument extends DomNode {
  documentElement: DomElement;
  createElementNS(ns: string | null, name: string): DomElement;
  importNode(node: DomNode, deep?: boolean): DomNode;
  getElementsByTagName(tag: string): DomElement[];
  getElementsByTagNameNS(ns: string, tag: string): DomElement[];
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): DomElement[];
}

function toDocument(node: unknown): DomDocument {
  // linkedom's own typings are `any`-wide; runtime shape verified against
  // the DOM surface declared above.
  return node as DomDocument;
}

function rootElementName(doc: DomDocument): string {
  const root = doc.documentElement;
  return root ? (root.localName || root.nodeName || "").toLowerCase() : "";
}

export function parseXml(content: string): DomDocument | null {
  try {
    const raw = new DOMParser().parseFromString(content, "text/xml");
    const doc = toDocument(raw);
    if (!doc.documentElement) return null;
    if (doc.getElementsByTagName("parsererror").length > 0) return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * Parse XHTML strictly: the root element must be <html>. Anything else
 * (fragments, HTML soup the XML parser mangled) returns null so callers
 * use their regex fallbacks, matching the browser parsererror behavior.
 */
export function parseXhtml(content: string): DomDocument | null {
  const doc = parseXml(content);
  if (!doc || rootElementName(doc) !== "html") return null;
  return doc;
}

export function parseHtml(content: string): DomDocument | null {
  try {
    return toDocument(new DOMParser().parseFromString(content, "text/html"));
  } catch {
    return null;
  }
}

export function serialize(node: DomNode): string {
  return node.toString();
}

/**
 * Serialize an XML doc back to string, cleaning up namespace prefix
 * noise. linkedom already emits an <?xml?> prolog for documents, so
 * unlike the browser path there is no declaration to restore.
 */
export function safeSerialize(
  doc: DomDocument,
  _originalContent: string,
): string {
  let result = serialize(doc);
  result = result.replace(/ xmlns:ns\d+="[^"]*"/g, "");
  result = result.replace(/ ns\d+:/g, " ");
  return result;
}

export function localName(node: DomNode | null | undefined): string {
  const element = node as DomElement | null | undefined;
  return ((element?.localName || node?.nodeName) || "").toLowerCase();
}

export function docBody(doc: DomDocument): DomElement | null {
  return doc.getElementsByTagName("body")[0] ?? null;
}

export function findFirstByLocalName(
  root: DomElement | DomDocument,
  name: string,
): DomElement | null {
  const target = name.toLowerCase();
  const nodes = root.getElementsByTagName("*");
  for (const node of nodes) {
    if (localName(node) === target) return node;
  }
  return null;
}

export function getElementsByLocalName(
  root: DomElement | DomDocument,
  name: string,
): DomElement[] {
  const seen = new Set<DomElement>();
  const elements: DomElement[] = [];
  const candidates = [
    ...root.getElementsByTagNameNS("*", name),
    ...root.getElementsByTagName(name),
  ];
  for (const element of candidates) {
    if (seen.has(element)) continue;
    seen.add(element);
    elements.push(element);
  }
  return elements;
}

function findXmlDoctypeEnd(content: string, start: number): number {
  let quote: string | null = null;
  let bracketDepth = 0;
  for (let i = start; i < content.length; i++) {
    const ch = content[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "[") {
      bracketDepth++;
    } else if (ch === "]" && bracketDepth > 0) {
      bracketDepth--;
    } else if (ch === ">" && bracketDepth === 0) {
      return i + 1;
    }
  }
  return -1;
}

export function findXmlRootElementStart(content: string): number {
  let index = 0;
  while (index < content.length) {
    while (index < content.length && /\s/.test(content[index]!)) index++;

    if (content.startsWith("<!--", index)) {
      const end = content.indexOf("-->", index + 4);
      if (end < 0) return index;
      index = end + 3;
      continue;
    }

    if (content.startsWith("<?", index)) {
      const end = content.indexOf("?>", index + 2);
      if (end < 0) return index;
      index = end + 2;
      continue;
    }

    if (content.substring(index, index + 9).toLowerCase() === "<!doctype") {
      const end = findXmlDoctypeEnd(content, index + 9);
      if (end < 0) return index;
      index = end;
      continue;
    }

    if (content[index] === "<") return index;
    return 0;
  }
  return 0;
}

/**
 * Replace whitespace-only text nodes with placeholder tokens so the XML
 * parser round-trip does not collapse them; restore() puts them back
 * after serialization.
 */
export function protectWhitespaceOnlyTextNodes(content: string) {
  const preserved: string[] = [];
  const tokenPrefix = "__CROSSINK_PRESERVE_WS_";
  const rootStart = findXmlRootElementStart(content);
  const protectedContent = content.replace(
    />([\s\u00a0]+)</g,
    (match: string, whitespace: string, offset: number) => {
      if (offset < rootStart) return match;

      const token = `${tokenPrefix}${preserved.length}__`;
      preserved.push(whitespace);
      return `>${token}<`;
    },
  );

  return {
    content: protectedContent,
    restore(serialized: string): string {
      return serialized.replace(
        new RegExp(`${escapeRegex(tokenPrefix)}(\\d+)__`, "g"),
        (match: string, indexText: string) => {
          const index = Number(indexText);
          return Number.isInteger(index) && index >= 0 && index < preserved.length
            ? preserved[index]!
            : match;
        },
      );
    },
  };
}
