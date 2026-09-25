/**
 * OPF handling ported from CrossInk web/pages/files.js: spine parsing,
 * media-type/manifest repairs, cover meta, split-section registration,
 * and NCX identifier sync.
 */
import JSZip from "jszip";
import {
  getElementsByLocalName,
  parseXml,
  safeSerialize,
  type DomNode,
} from "./dom.ts";
import {
  decodeHref,
  relativeZipPath as relativeHref,
  resolvePath,
  xmlEscape,
} from "./text.ts";

export const OPF_NS = "http://www.idpf.org/2007/opf";

export type Zip = Pick<JSZip, "files" | "forEach">;

/** Spine hrefs (zip paths) parsed from the OPF, with regex fallback. */
export function parseOpfSpineHrefs(opfContent: string, opfPath: string): string[] {
  const opfDir = opfPath.includes("/")
    ? opfPath.substring(0, opfPath.lastIndexOf("/"))
    : "";
  const opfBasePath = opfDir ? `${opfDir}/content.opf` : "content.opf";

  const doc = parseXml(opfContent);
  if (doc) {
    const manifest: Record<string, string> = {};
    for (const item of getElementsByLocalName(doc, "item")) {
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      if (id && href) {
        manifest[id] = resolvePath(opfBasePath, decodeHref(href.split("#")[0]!));
      }
    }

    const spineHrefs: string[] = [];
    for (const itemref of getElementsByLocalName(doc, "itemref")) {
      const idref = itemref.getAttribute("idref");
      if (idref && manifest[idref]) spineHrefs.push(manifest[idref]!);
    }
    if (spineHrefs.length > 0) return spineHrefs;
  }

  const manifest: Record<string, string> = {};
  const itemRegex = /<item\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(opfContent)) !== null) {
    const tag = match[0];
    const idMatch = tag.match(/\bid=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
    if (idMatch && hrefMatch) {
      manifest[idMatch[1]!] = resolvePath(
        opfBasePath,
        decodeHref(hrefMatch[1]!.split("#")[0]!),
      );
    }
  }

  const spineHrefs: string[] = [];
  const itemrefRegex = /<itemref\b[^>]*idref=["']([^"']+)["'][^>]*>/gi;
  while ((match = itemrefRegex.exec(opfContent)) !== null) {
    const href = manifest[match[1]!];
    if (href) spineHrefs.push(href);
  }
  return spineHrefs;
}

/**
 * Fix OPF content: media-types for converted images, strip svg
 * properties, ensure cover meta.
 */
export function fixOPF(opfText: string, opfOriginal: string): string {
  let t = opfText;
  const doc = parseXml(t);

  if (doc) {
    const items = [...doc.getElementsByTagNameNS("*", "item")];
    for (const item of items) {
      const href = item.getAttribute("href") || "";
      const type = item.getAttribute("media-type") || "";
      if (href.endsWith(".jpg") && type.match(/^image\/(png|gif|webp|bmp|svg\+xml)$/)) {
        item.setAttribute("media-type", "image/jpeg");
      }
    }

    for (const item of items) {
      const props = item.getAttribute("properties") || "";
      if (props.includes("svg")) {
        const newProps = props
          .split(/\s+/)
          .filter((p) => p !== "svg")
          .join(" ")
          .trim();
        if (newProps) item.setAttribute("properties", newProps);
        else item.removeAttribute("properties");
      }
    }
    t = safeSerialize(doc, opfOriginal);
  } else {
    // Regex fallback when the OPF is not parseable XML
    t = t.replace(
      /(<(?:\w+:)?item\b[^>]*href="[^"]+\.jpg"[^>]*)media-type="image\/(png|gif|webp|bmp|svg\+xml)"/g,
      '$1media-type="image/jpeg"',
    );
    t = t.replace(
      /(<(?:\w+:)?item\b[^>]*)media-type="image\/(png|gif|webp|bmp|svg\+xml)"([^>]*href="[^"]+\.jpg")/g,
      '$1media-type="image/jpeg"$3',
    );
    t = t.replace(/\s+svg(?=["'\s>])/g, "");
  }

  const cm = ensureCoverMeta(t);
  if (cm.fixed) t = cm.content;
  return t;
}

/** Ensure a <meta name="cover" content="..."/> exists in the OPF metadata. */
export function ensureCoverMeta(opfString: string): {
  content: string;
  fixed: boolean;
} {
  const doc = parseXml(opfString);
  if (!doc) return ensureCoverMetaRegex(opfString);

  const items = [...doc.getElementsByTagNameNS("*", "item")];
  let coverId: string | null = null;
  for (const item of items) {
    const props = item.getAttribute("properties") || "";
    const id = item.getAttribute("id") || "";
    const type = item.getAttribute("media-type") || "";
    if (!type.startsWith("image/")) continue;
    if (props.includes("cover-image")) {
      coverId = id;
      break;
    }
  }
  if (!coverId) {
    for (const item of items) {
      const id = item.getAttribute("id") || "";
      const href = item.getAttribute("href") || "";
      const type = item.getAttribute("media-type") || "";
      if (!type.startsWith("image/")) continue;
      if (id.toLowerCase().includes("cover") || href.toLowerCase().includes("cover")) {
        coverId = id;
        break;
      }
    }
  }
  if (!coverId) return { content: opfString, fixed: false };

  const metas = [...doc.getElementsByTagNameNS("*", "meta")];
  const coverMeta = metas.find((m) => m.getAttribute("name") === "cover");
  if (coverMeta) {
    if (coverMeta.getAttribute("content") === coverId) {
      return { content: opfString, fixed: false };
    }
    coverMeta.setAttribute("content", coverId);
  } else {
    const metadata = doc.getElementsByTagNameNS("*", "metadata")[0];
    if (!metadata) return { content: opfString, fixed: false };
    const ns = metadata.namespaceURI || OPF_NS;
    const newMeta = doc.createElementNS(ns, "meta");
    newMeta.setAttribute("name", "cover");
    newMeta.setAttribute("content", coverId);
    metadata.appendChild(newMeta);
  }
  return { content: safeSerialize(doc, opfString), fixed: true };
}

function ensureCoverMetaRegex(o: string): { content: string; fixed: boolean } {
  let coverId: string | null = null;
  let m: RegExpMatchArray | null;
  if ((m = o.match(/<\w+:?item[^>]+id="([^"]+)"[^>]+properties="[^"]*cover-image[^"]*"/i)))
    coverId = m[1]!;
  if (!coverId && (m = o.match(/<\w+:?item[^>]+properties="[^"]*cover-image[^"]*"[^>]+id="([^"]+)"/i)))
    coverId = m[1]!;
  if (!coverId && (m = o.match(/<\w+:?item[^>]*id="([^"]+)"[^>]*href="[^"]*cover[^"]*"[^>]*media-type="image\//i)))
    coverId = m[1]!;
  if (!coverId && (m = o.match(/<\w+:?item[^>]*href="[^"]*cover[^"]*"[^>]*id="([^"]+)"[^>]*media-type="image\//i)))
    coverId = m[1]!;
  if (!coverId && (m = o.match(/<\w+:?item[^>]*id="([^"]*cover[^"]*)"[^>]*media-type="image\//i)))
    coverId = m[1]!;
  if (!coverId && (m = o.match(/<\w+:?item[^>]*media-type="image\/[^"]*"[^>]*id="([^"]*cover[^"]*)"/i)))
    coverId = m[1]!;
  if (!coverId) return { content: o, fixed: false };
  const metaMatch =
    o.match(/<\w+:?meta\s+name=["']cover["']\s+content=["']([^"']+)["']/i) ||
    o.match(/<\w+:?meta\s+content=["']([^"']+)["']\s+name=["']cover["']/i);
  if (metaMatch) {
    if (metaMatch[1] === coverId && !metaMatch[1].includes("/")) {
      return { content: o, fixed: false };
    }
    const esc = xmlEscape(coverId);
    return {
      content: o
        .replace(
          /<\w+:?meta\s+name=["']cover["']\s+content=["'][^"']+["']\s*\/?>/gi,
          `<meta name="cover" content="${esc}" />`,
        )
        .replace(
          /<\w+:?meta\s+content=["'][^"']+["']\s+name=["']cover["']\s*\/?>/gi,
          `<meta name="cover" content="${esc}" />`,
        ),
      fixed: true,
    };
  }
  const idx = o.indexOf("</metadata>");
  if (idx !== -1) {
    return {
      content:
        o.substring(0, idx) +
        `    <meta name="cover" content="${xmlEscape(coverId)}"/>\n  </metadata>` +
        o.substring(idx + 11),
      fixed: true,
    };
  }
  return { content: o, fixed: false };
}

/** Register split XHTML sections in the OPF manifest and spine. */
export function addSplitSectionsToOpf(
  opfContent: string,
  opfPath: string,
  splitSections: Record<string, string[]>,
): string {
  if (Object.keys(splitSections).length === 0) return opfContent;

  const doc = parseXml(opfContent);
  if (!doc) return opfContent;
  const manifest = doc.getElementsByTagNameNS("*", "manifest")[0];
  const spine = doc.getElementsByTagNameNS("*", "spine")[0];
  if (!manifest || !spine) return opfContent;

  const byPath = new Map<string, { id: string; item: DomNode }>();
  const items = [...doc.getElementsByTagNameNS("*", "item")];
  for (const item of items) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) {
      byPath.set(resolvePath(opfPath, decodeHref(href.split("#")[0]!)), {
        id,
        item,
      });
    }
  }
  const usedIds = new Set(items.map((item) => item.getAttribute("id") || ""));

  for (const [originalPath, parts] of Object.entries(splitSections)) {
    const original = byPath.get(originalPath);
    if (!original || parts.length < 2) continue;

    const addedIds: string[] = [];
    for (let index = 1; index < parts.length; index++) {
      let id = `${original.id}-ci-${index + 1}`;
      while (usedIds.has(id)) id += "x";
      usedIds.add(id);

      const item = doc.createElementNS(manifest.namespaceURI || OPF_NS, "item");
      item.setAttribute("id", id);
      item.setAttribute("href", relativeHref(opfPath, parts[index]!));
      item.setAttribute("media-type", "application/xhtml+xml");
      manifest.appendChild(item);
      addedIds.push(id);
    }

    const itemref = [...doc.getElementsByTagNameNS("*", "itemref")].find(
      (ref) => ref.getAttribute("idref") === original.id,
    );
    if (!itemref) continue;
    let insertAfter: DomNode = itemref;
    for (const id of addedIds) {
      const ref = doc.createElementNS(spine.namespaceURI || OPF_NS, "itemref");
      ref.setAttribute("idref", id);
      if (insertAfter.nextSibling) spine.insertBefore(ref, insertAfter.nextSibling);
      else spine.appendChild(ref);
      insertAfter = ref;
    }
  }

  return safeSerialize(doc, opfContent);
}

/** Extract the OPF main identifier, with regex fallback. */
export function extractIdentifier(opfContent: string): string | null {
  let mainIdentifier: string | null = null;
  const doc = parseXml(opfContent);
  if (doc) {
    const pkg = doc.getElementsByTagNameNS("*", "package")[0];
    const uid = pkg ? pkg.getAttribute("unique-identifier") : null;
    if (uid) {
      const el = [...doc.getElementsByTagNameNS("*", "identifier")].find(
        (e) => e.getAttribute("id") === uid,
      );
      if (el) mainIdentifier = (el.textContent || "").trim();
    }
    if (!mainIdentifier) {
      const el = doc.getElementsByTagNameNS("*", "identifier")[0];
      if (el) mainIdentifier = (el.textContent || "").trim();
    }
  }
  if (!mainIdentifier) {
    const uniqueIdMatch = opfContent.match(
      /<(?:\w+:)?package[^>]*unique-identifier=["']([^"']+)["']/i,
    );
    if (uniqueIdMatch) {
      const idRegex = new RegExp(
        `<dc:identifier[^>]*id=["']${uniqueIdMatch[1]}["'][^>]*>([^<]+)</dc:identifier>`,
        "i",
      );
      const idMatch = opfContent.match(idRegex);
      if (idMatch) mainIdentifier = idMatch[1]!.trim();
    }
    if (!mainIdentifier) {
      const firstIdMatch = opfContent.match(/<dc:identifier[^>]*>([^<]+)</i);
      if (firstIdMatch) mainIdentifier = firstIdMatch[1]!.trim();
    }
  }
  return mainIdentifier;
}

/** Sync NCX dtb:uid with the given identifier. */
export function syncNCXIdentifier(
  ncxText: string,
  mainIdentifier: string | null,
): string {
  if (!mainIdentifier) return ncxText;
  const doc = parseXml(ncxText);
  if (doc) {
    const meta = [...doc.getElementsByTagNameNS("*", "meta")].find(
      (m) => m.getAttribute("name") === "dtb:uid",
    );
    if (meta) {
      meta.setAttribute("content", mainIdentifier);
      return safeSerialize(doc, ncxText);
    }
    return ncxText;
  }
  return ncxText.replace(
    /<meta\s+name=["']dtb:uid["']\s+content=["'][^"']*["']\s*\/?>/gi,
    `<meta name="dtb:uid" content="${xmlEscape(mainIdentifier)}"/>`,
  );
}

