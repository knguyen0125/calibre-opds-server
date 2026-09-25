/**
 * EPUB optimizer orchestrator ported from CrossInk web/pages/files.js
 * convertEpubFile: image conversion, text scrubbing, SVG repairs,
 * defensive CSS injection, long-section splitting, X-locations, and
 * CrossInk PXC2 sidecars, rebuilt into a fresh OCF zip.
 *
 * The web uploader's interactive pieces (image picker states, cover
 * color preservation, progress/log UI) are not ported; the pipeline is
 * otherwise faithful. On any failure callers should fall back to the
 * original file, mirroring the web uploader's behavior.
 */
import JSZip from "jszip";
import type { DeviceTag } from "../auth.ts";
import { DOMParser } from "linkedom";
import { DEVICE_PROFILES } from "./device.ts";
import { processImage } from "./images.ts";
import {
  addSplitSectionsToOpf,
  extractIdentifier,
  fixOPF,
  syncNCXIdentifier,
  type Zip,
} from "./opf.ts";
import {
  buildCrossInkImageIndex,
  buildCrossInkPxcSidecars,
  CROSSINK_OPTIMIZER_INDEX_PATH,
  CROSSINK_OPTIMIZER_MANIFEST_PATH,
  CROSSINK_PXC_DIR,
} from "./pxc.ts";
import {
  collapseReaderEmptySpineItems,
  rewriteCollapsedSpineReferences,
  rewriteSplitSectionReferences,
  splitLongXhtmlSections,
  type SectionSplitResult,
} from "./split.ts";
import { fixSvgCover, fixSvgWrappedImages } from "./svg.ts";
import {
  decodeHref,
  resolvePath,
  safeReadText,
  scrubBlankCodepoints,
  stripComments,
} from "./text.ts";
import {
  parseXhtml,
  protectWhitespaceOnlyTextNodes,
  safeSerialize,
} from "./dom.ts";
import {
  buildXLocationManifest,
  X_DEFAULT_REFERENCE_CHARACTERS_PER_PAGE,
  X_LOCATION_MANIFEST_PATH,
} from "./xlocation.ts";

/** Bump when the pipeline changes in a way that alters output bytes;
 * cache keys include it so stale results are never served. */
export const OPTIMIZER_VERSION = 1;

export const GENERATOR = "calibre-opds-server";

const DEFENSIVE_STYLE =
  '<style type="text/css">img,svg{max-width:100%;height:auto}body{overflow-wrap:break-word}table{max-width:100%;table-layout:fixed}pre,code{white-space:pre-wrap;word-wrap:break-word}*{box-sizing:border-box}</style>';

const DEFLATE_OPTS = {
  compression: "DEFLATE",
  compressionOptions: { level: 8 },
  createFolders: false,
} as const;

const STORE_OPTS = { compression: "STORE", createFolders: false } as const;

const FONT_OBFUSCATION_ALGORITHMS = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);
export type OptimizeStats = {
  device: DeviceTag;
  originalBytes: number;
  optimizedBytes: number;
  images: number;
  imagesTotal: number;
  imageErrors: number;
  fixes: number;
  splitSections: number;
  splitParts: number;
  pxcEntries: number;
  elapsedMs: number;
};

export type OptimizeProgress = {
  phase: "images" | "pxc";
  done: number;
  total: number;
  elapsedMs: number;
};

export class DrmError extends Error {}

async function assertEpubHasNoContentEncryption(zip: Zip): Promise<void> {
  const entry = Object.entries(zip.files).find(
    ([path, fileObj]) => !fileObj.dir && path.toLowerCase() === "meta-inf/encryption.xml",
  );
  if (!entry) return;
  const encryptionXml = await safeReadText(entry[1]);
  const doc = new DOMParser().parseFromString(encryptionXml, "text/xml");
  for (const encryptedData of doc.getElementsByTagNameNS("*", "EncryptedData")) {
    const method = encryptedData.getElementsByTagNameNS("*", "EncryptionMethod")[0];
    const algorithm = method?.getAttribute("Algorithm");
    // Publishers often store obfuscated fonts as .dat files, so the
    // algorithm is the reliable signal; the filename is not.
    if (!algorithm || !FONT_OBFUSCATION_ALGORITHMS.has(algorithm)) {
      throw new DrmError("EPUB is DRM-protected; cannot be optimized");
    }
  }
}

export async function optimizeEpub(
  input: Uint8Array,
  device: DeviceTag,
  onProgress?: (progress: OptimizeProgress) => void,
): Promise<{ data: Uint8Array; stats: OptimizeStats }> {
  const startTime = Date.now();
  const profile = DEVICE_PROFILES[device];
  const stats: OptimizeStats = {
    device,
    originalBytes: input.byteLength,
    optimizedBytes: 0,
    images: 0,
    imagesTotal: 0,
    imageErrors: 0,
    fixes: 0,
    splitSections: 0,
    splitParts: 0,
    pxcEntries: 0,
    elapsedMs: 0,
  };

  const zip = await JSZip.loadAsync(input);
  await assertEpubHasNoContentEncryption(zip);

  // Raster images become .jpg (name changes tracked for reference rewrites).
  const renamed: Record<string, string> = {};
  zip.forEach((p) => {
    const l = p.toLowerCase();
    if (l.match(/\.(png|gif|webp|bmp|jpeg|svg)$/)) {
      renamed[p] = p.replace(/\.(png|gif|webp|bmp|jpeg|svg)$/i, ".jpg");
    }
  });

  const out = await JSZip();
  const entries = Object.entries(zip.files);
  const xhtmlFiles: Record<string, string> = {};
  let processedXhtmlFiles: Record<string, string> = {};
  const extraTextFiles: Record<string, string> = {};
  let opfPath: string | null = null;
  let opfContent: string | null = null;
  let mainIdentifier: string | null = null;
  let optimizedOpfContent: string | null = null;

  // mimetype first per EPUB OCF spec
  if (zip.files["mimetype"]) {
    const mimetypeData = await zip.files["mimetype"]!.async("uint8array");
    out.file("mimetype", mimetypeData, STORE_OPTS);
  }

  // First pass: images
  const imagesTotal = entries.filter(
    ([p, f]) =>
      !f.dir &&
      p !== "mimetype" &&
      p.toLowerCase().match(/\.(png|gif|webp|bmp|jpg|jpeg|svg)$/),
  ).length;
  stats.imagesTotal = imagesTotal;
  for (const [path, fileObj] of entries) {
    if (fileObj.dir || path === "mimetype") continue;
    const low = path.toLowerCase();

    if (low.match(/\.(png|gif|webp|bmp|jpg|jpeg|svg)$/)) {
      const data = new Uint8Array(await fileObj.async("arraybuffer"));
      try {
        const result = await processImage(data, profile.width, profile.height);
        stats.images++;
        const newPath = renamed[path] ?? path.replace(/\.[^.]+$/, ".jpg");
        out.file(newPath, result.data, STORE_OPTS);
      } catch {
        // Keep the original image when it cannot be processed.
        stats.imageErrors++;
        delete renamed[path];
        out.file(path, data, STORE_OPTS);
      }
      onProgress?.({
        phase: "images",
        done: stats.images + stats.imageErrors,
        total: imagesTotal,
        elapsedMs: Date.now() - startTime,
      });
    } else if (low.match(/\.(xhtml|html|htm)$/)) {
      xhtmlFiles[path] = await safeReadText(fileObj);
    } else if (low.endsWith(".opf")) {
      opfPath = path;
      opfContent = await safeReadText(fileObj);
    }
  }

  // Second pass: XHTML scrub, SVG repairs, img normalization, defensive CSS
  for (const [xhtmlPath, content] of Object.entries(xhtmlFiles)) {
    let t = content;
    if (scrubBlankCodepoints(t).count > 0) {
      t = scrubBlankCodepoints(t).text;
      stats.fixes++;
    }

    const stripped = stripComments(t);
    if (stripped.count > 0) {
      t = stripped.text;
      stats.fixes++;
    }

    const coverFix = fixSvgCover(t);
    if (coverFix.fixed) {
      t = coverFix.content;
      stats.fixes++;
    }

    const svgFix = fixSvgWrappedImages(t);
    if (svgFix.fixed) {
      t = svgFix.content;
      stats.fixes++;
    }

    const whitespaceGuard = protectWhitespaceOnlyTextNodes(t);
    const doc = parseXhtml(whitespaceGuard.content);
    if (doc) {
      let modified = false;

      // Remove width/height from all imgs; dimensions may have changed.
      for (const img of doc.querySelectorAll("img")) {
        if (img.hasAttribute("width")) {
          img.removeAttribute("width");
          modified = true;
        }
        if (img.hasAttribute("height")) {
          img.removeAttribute("height");
          modified = true;
        }

        const src = img.getAttribute("src");
        if (src) {
          const decodedSrc = decodeHref(src);
          const resolved = resolvePath(xhtmlPath, decodedSrc);
          const renameTarget = Object.entries(renamed).find(
            ([oldPath, newPath]) => resolved === oldPath || resolved === newPath,
          );
          if (renameTarget) {
            const oldName = renameTarget[0].split("/").pop()!;
            const newName = renameTarget[1].split("/").pop()!;
            const updatedSrc = decodedSrc.replace(oldName, newName);
            if (updatedSrc !== decodedSrc) {
              img.setAttribute("src", updatedSrc);
              modified = true;
            }
          }
        }
      }

      if (modified) {
        t = whitespaceGuard.restore(safeSerialize(doc, whitespaceGuard.content));
        stats.fixes++;
      }
    } else {
      // Regex fallback for XHTML the XML parser rejected
      const rewritten = t.replace(
        /(<(?:\w+:)?img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
        (match, prefix: string, quote: string, src: string) => {
          const decodedSrc = decodeHref(src);
          const resolved = resolvePath(xhtmlPath, decodedSrc);
          const renameTarget = Object.entries(renamed).find(
            ([oldPath, newPath]) => resolved === oldPath || resolved === newPath,
          );
          if (!renameTarget) return match;
          const oldName = renameTarget[0].split("/").pop()!;
          const newName = renameTarget[1].split("/").pop()!;
          const updatedSrc = decodedSrc.replace(oldName, newName);
          return updatedSrc === decodedSrc
            ? match
            : `${prefix}${quote}${updatedSrc}${quote}`;
        },
      );
      if (rewritten !== t) {
        t = rewritten;
        stats.fixes++;
      }
    }

    // Universal image constraint — prevents overflow on e-ink displays
    if (t.includes("</head>")) {
      t = t.replace("</head>", DEFENSIVE_STYLE + "</head>");
    }

    processedXhtmlFiles[xhtmlPath] = t;
  }

  // Collapse empty spine stubs, then split long sections
  const collapseRedirects = new Map<string, string>();
  const splitAnchorTargets = new Map<string, Map<string, string>>();
  let splitSections: Record<string, string[]> = {};
  let sourceSpineMap: SectionSplitResult["sourceSpineMap"] = null;
  if (opfContent && opfPath) {
    const collapseResult = collapseReaderEmptySpineItems(
      processedXhtmlFiles,
      opfContent,
      opfPath,
    );
    opfContent = collapseResult.opfContent;
    if (collapseResult.redirects.size > 0) stats.fixes++;
    for (const [xhtmlPath, content] of Object.entries(processedXhtmlFiles)) {
      processedXhtmlFiles[xhtmlPath] = rewriteCollapsedSpineReferences(
        content,
        xhtmlPath,
        collapseResult.redirects,
      );
    }
    for (const [from, to] of collapseResult.redirects) collapseRedirects.set(from, to);

    const sectionSplitResult = splitLongXhtmlSections(
      processedXhtmlFiles,
      opfContent,
      opfPath,
      true,
    );
    processedXhtmlFiles = sectionSplitResult.files;
    for (const [xhtmlPath, content] of Object.entries(processedXhtmlFiles)) {
      processedXhtmlFiles[xhtmlPath] = rewriteSplitSectionReferences(
        content,
        xhtmlPath,
        sectionSplitResult.anchorTargets,
      );
    }
    for (const [from, anchors] of sectionSplitResult.anchorTargets) {
      splitAnchorTargets.set(from, anchors);
    }
    splitSections = sectionSplitResult.splitSections;
    sourceSpineMap = sectionSplitResult.sourceSpineMap;
    stats.splitSections = Object.keys(splitSections).length;
    stats.splitParts = Object.values(splitSections).reduce(
      (sum, parts) => sum + parts.length,
      0,
    );

    mainIdentifier = extractIdentifier(opfContent);
  }


  // Text resources that share the collapse/split reference rewrites
  if (opfContent && opfPath) {
    for (const [path, fileObj] of entries) {
      if (fileObj.dir || path === "mimetype") continue;
      const low = path.toLowerCase();
      if (low.endsWith(".ncx") || low.match(/\.(xml|svg)$/)) {
        const scrubbed = scrubBlankCodepoints(await safeReadText(fileObj));
        let content = scrubbed.text;
        if (scrubbed.count > 0) stats.fixes++;
        content = rewriteCollapsedSpineReferences(content, path, collapseRedirects);
        extraTextFiles[path] = rewriteSplitSectionReferences(
          content,
          path,
          splitAnchorTargets,
        );
      }
    }
  }


  // Third pass: OPF + X-locations
  if (opfContent && opfPath) {
    let t = opfContent;
    const scrubbed = scrubBlankCodepoints(t);
    if (scrubbed.count > 0) {
      t = scrubbed.text;
      stats.fixes++;
    }
    for (const [o, n] of Object.entries(renamed)) {
      t = t.split(o.split("/").pop()!).join(n.split("/").pop()!);
    }
    t = fixOPF(t, opfContent);
    t = addSplitSectionsToOpf(t, opfPath, splitSections);
    t = rewriteSplitSectionReferences(t, opfPath, splitAnchorTargets);
    optimizedOpfContent = t;
    if (t !== opfContent) stats.fixes++;
    out.file(opfPath, t, DEFLATE_OPTS);

    const locationManifest = buildXLocationManifest(
      t,
      opfPath,
      processedXhtmlFiles,
      X_DEFAULT_REFERENCE_CHARACTERS_PER_PAGE,
      sourceSpineMap,
      GENERATOR,
    );
    if (locationManifest) {
      out.file(X_LOCATION_MANIFEST_PATH, JSON.stringify(locationManifest), DEFLATE_OPTS);
    }
  }

  for (const [xhtmlPath, content] of Object.entries(processedXhtmlFiles)) {
    out.file(xhtmlPath, content, DEFLATE_OPTS);
  }

  // PXC2 sidecars + optimizer manifest and COIX index
  const pxcEntries = await buildCrossInkPxcSidecars(
    out,
    zip,
    processedXhtmlFiles,
    profile.width,
    profile.height,
    (done) =>
      onProgress?.({
        phase: "pxc",
        done,
        total: imagesTotal,
        elapsedMs: Date.now() - startTime,
      }),
  );
  stats.pxcEntries = pxcEntries.length;
  if (optimizedOpfContent) {
    const manifest = new TextEncoder().encode(
      JSON.stringify({
        format: "crossink-optimizer",
        version: 1,
        target: {
          device: device.toLowerCase(),
          width: profile.height,
          height: profile.width,
          grayscaleLevels: 4,
        },
        generator: GENERATOR,
        features: {
          htmlNormalized: true,
          cssFlattened: false,
          xLocations: true,
          prebuiltPxc: pxcEntries.length > 0,
        },
        images: pxcEntries,
      }),
    );
    out.file(CROSSINK_OPTIMIZER_MANIFEST_PATH, manifest, STORE_OPTS);
    out.file(
      CROSSINK_OPTIMIZER_INDEX_PATH,
      buildCrossInkImageIndex(manifest, pxcEntries),
      STORE_OPTS,
    );
  }

  // Copy remaining files (fonts, css with renamed refs, ncx, misc)
  for (const [path, fileObj] of entries) {
    if (fileObj.dir || path === "mimetype") continue;
    const low = path.toLowerCase();
    if (
      low === X_LOCATION_MANIFEST_PATH.toLowerCase() ||
      low === CROSSINK_OPTIMIZER_MANIFEST_PATH.toLowerCase() ||
      low === CROSSINK_OPTIMIZER_INDEX_PATH.toLowerCase() ||
      low.startsWith(CROSSINK_PXC_DIR.toLowerCase() + "/")
    ) {
      continue;
    }
    if (
      low.match(/\.(png|gif|webp|bmp|jpg|jpeg|svg)$/) ||
      low.match(/\.(xhtml|html|htm)$/) ||
      low.endsWith(".opf")
    ) {
      continue;
    }

    let data = await fileObj.async("uint8array");
    if (low.endsWith(".css")) {
      let t = (await safeReadText(fileObj)).replace(/\0/g, "");
      for (const [o, n] of Object.entries(renamed)) {
        t = t.split(o.split("/").pop()!).join(n.split("/").pop()!);
      }
      data = new TextEncoder().encode(t);
    } else if (low.endsWith(".ncx")) {
      let t = extraTextFiles[path] ?? (await safeReadText(fileObj)).replace(/\0/g, "");
      for (const [o, n] of Object.entries(renamed)) {
        t = t.split(o.split("/").pop()!).join(n.split("/").pop()!);
      }
      t = syncNCXIdentifier(t, mainIdentifier);
      data = new TextEncoder().encode(t);
    } else if (low.match(/\.(xml|svg)$/)) {
      const t = extraTextFiles[path] ?? (await safeReadText(fileObj)).replace(/\0/g, "");
      data = new TextEncoder().encode(t);
    }
    out.file(path, data, { ...DEFLATE_OPTS });
  }

  const data = await out.generateAsync({ type: "uint8array" });
  stats.optimizedBytes = data.byteLength;
  stats.elapsedMs = Date.now() - startTime;
  return { data, stats };
}
