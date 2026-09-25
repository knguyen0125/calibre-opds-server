/**
 * SVG repairs ported from CrossInk web/pages/files.js: convert
 * SVG-wrapped covers and inline images to plain <img> tags, which the
 * CrossInk reader renders reliably.
 */
import {
  parseXhtml,
  protectWhitespaceOnlyTextNodes,
  safeSerialize,
  type DomElement,
} from "./dom.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

export type FixResult = { content: string; fixed: boolean; count: number };

function imageElementIn(svg: DomElement): DomElement | null {
  return (
    svg.getElementsByTagName("image")[0] ??
    svg.getElementsByTagNameNS(SVG_NS, "image")[0] ??
    svg.getElementsByTagNameNS("*", "image")[0] ??
    null
  );
}

function hrefOf(imageEl: DomElement): string | null {
  return (
    imageEl.getAttributeNS(XLINK_NS, "href") ||
    imageEl.getAttribute("xlink:href") ||
    imageEl.getAttribute("href") ||
    null
  );
}

function coverReplacement(href: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta content="text/html; charset=UTF-8" http-equiv="default-style"/><title>Cover</title></head>
<body><section epub:type="cover"><img style="max-width:100%;height:auto" alt="Cover" src="${href}"/></section></body>
</html>`;
}

const firstXlinkHref = (content: string): string | null =>
  content.match(/xlink:href=["']([^"']+)["']/)?.[1] ?? null;

/** Convert an SVG-wrapped cover page into a plain <img> cover page. */
export function fixSvgCover(content: string): FixResult {
  const hasSvg = content.includes("<svg") || content.includes("<svg:");
  if (!hasSvg || !content.includes("xlink:href")) {
    return { content, fixed: false, count: 0 };
  }
  if (
    !content.includes("calibre:cover") &&
    !content.includes('name="cover"') &&
    !content.includes("<title>Cover</title>")
  ) {
    return { content, fixed: false, count: 0 };
  }

  const doc = parseXhtml(content);
  if (doc) {
    const svgs = [
      ...doc.getElementsByTagName("svg"),
      ...doc.getElementsByTagNameNS(SVG_NS, "svg"),
      ...doc.getElementsByTagName("svg:svg"),
    ];
    for (const svg of svgs) {
      const imageEl = imageElementIn(svg);
      const href = imageEl ? hrefOf(imageEl) : null;
      if (href) {
        return { content: coverReplacement(href), fixed: true, count: 1 };
      }
    }
  }

  const fallback = firstXlinkHref(content);
  return fallback
    ? { content: coverReplacement(fallback), fixed: true, count: 1 }
    : { content, fixed: false, count: 0 };
}

const SVG_IMAGE_RE =
  /<(?:svg:)?svg\b[^>]*>[\s\S]*?<(?:svg:)?image\b[^>]*xlink:href=["']([^"']+)["'][^>]*\/?>\s*<\/(?:svg:)?svg>/gi;

/** Unwrap SVG-wrapped images into plain <img> elements. */
export function fixSvgWrappedImages(content: string): FixResult {
  const hasSvg = content.includes("<svg") || content.includes("<svg:");
  if (!hasSvg || !content.includes("xlink:href")) {
    return { content, fixed: false, count: 0 };
  }

  const whitespaceGuard = protectWhitespaceOnlyTextNodes(content);
  const doc = parseXhtml(whitespaceGuard.content);

  if (doc) {
    const svgElements = [
      ...doc.querySelectorAll("svg"),
      ...doc.getElementsByTagNameNS(SVG_NS, "svg"),
    ];
    const uniqueSvgs = [...new Set<DomElement>(svgElements)];
    let fixedCount = 0;

    for (const svg of uniqueSvgs) {
      const imageEl = imageElementIn(svg);
      if (!imageEl) continue;
      const href = hrefOf(imageEl);
      if (!href) continue;
      const width = imageEl.getAttribute("width") || svg.getAttribute("width");
      const height =
        imageEl.getAttribute("height") || svg.getAttribute("height");
      const img = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "img",
      );
      img.setAttribute("src", href);
      img.setAttribute("alt", "");
      img.setAttribute("style", "max-width:100%;height:auto");
      if (width) img.setAttribute("width", width);
      if (height) img.setAttribute("height", height);
      svg.parentNode?.replaceChild(img, svg);
      fixedCount++;
    }

    if (fixedCount > 0) {
      return {
        content: whitespaceGuard.restore(
          safeSerialize(doc, whitespaceGuard.content),
        ),
        fixed: true,
        count: fixedCount,
      };
    }
    return { content, fixed: false, count: 0 };
  }

  // Regex fallback for XHTML the XML parser rejected.
  let fixedCount = 0;
  const newContent = content.replace(
    SVG_IMAGE_RE,
    (_match: string, href: string) => {
      fixedCount++;
      return `<img style="max-width:100%;height:auto" src="${href}" alt="" />`;
    },
  );
  return { content: newContent, fixed: fixedCount > 0, count: fixedCount };
}

