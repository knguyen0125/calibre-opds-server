import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import * as FS from "node:fs";
import * as Path from "node:path";
import * as OS from "node:os";
import type { App } from "../index.ts";
import JSZip from "jszip";
import sharp from "sharp";

/**
 * End-to-end tests over a fixture calibre library: device-tagged feeds
 * craft X4 filenames, device downloads return optimized EPUBs with
 * CrossInk sidecars, plain requests get the original behavior.
 */

const libraryDir = Path.join(OS.tmpdir(), `calibre-opds-test-${Date.now()}`);
const bookDir = Path.join(libraryDir, "Mistborn/02 - The Well of Ascension (2)");
// Dynamic imports: env vars must be set before these modules load.
let app: App;

const basicAuth = (username: string) =>
  `Basic ${Buffer.from(`${username}:secret`).toString("base64")}`;

async function buildFixtureEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", {
    compression: "STORE",
  });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );

  // Landscape image larger than the X4 viewport in both dimensions.
  const bigPng = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: "#668" },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  const bigPngBytes = await sharp(bigPng).png().toBuffer();
  zip.file("OEBPS/images/spread.png", bigPngBytes);

  const paragraphs = Array.from(
    { length: 1100 },
    (_, i) => `<p>Paragraph ${i} with several words of filler text here.</p>`,
  ).join("\n");
  zip.file(
    "OEBPS/ch1.xhtml",
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><h1 id="start">Chapter 1</h1><img src="images/spread.png" width="1200" height="900"/>${paragraphs}</body>
</html>`,
  );
  zip.file(
    "OEBPS/style.css",
    "img { max-width: 100%; }\nbody { margin: 0; }\n",
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Well of Ascension</dc:title>
    <dc:creator>Brandon Sanderson</dc:creator>
    <dc:identifier id="uid">test-book-urn</dc:identifier>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="spread" href="images/spread.png" media-type="image/png"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
  );

  return zip.generateAsync({ type: "uint8array" });
}

function buildFixtureDb() {
  const db = new Database(Path.join(libraryDir, "metadata.db"));
  db.exec(`
    CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, sort TEXT, timestamp INTEGER,
      pubdate TEXT, series_index REAL, path TEXT, last_modified TEXT, has_cover BOOLEAN);
    CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT, sort TEXT, link TEXT);
    CREATE TABLE books_authors_link (id INTEGER PRIMARY KEY, book INTEGER, author INTEGER);
    CREATE TABLE series (id INTEGER PRIMARY KEY, name TEXT, sort TEXT);
    CREATE TABLE books_series_link (id INTEGER PRIMARY KEY, book INTEGER, series INTEGER);
    CREATE TABLE data (id INTEGER PRIMARY KEY, book INTEGER, format TEXT, name TEXT, uncompressed_size INTEGER, size INTEGER);
    CREATE TABLE comments (id INTEGER PRIMARY KEY, book INTEGER, text TEXT);
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT, sort TEXT);
    CREATE TABLE books_tags_link (id INTEGER PRIMARY KEY, book INTEGER, tag INTEGER);
    CREATE TABLE languages (id INTEGER PRIMARY KEY, lang_code TEXT UNIQUE);
    CREATE TABLE books_languages_link (id INTEGER PRIMARY KEY, book INTEGER, lang_code INTEGER);
  `);
  db.run(
    `INSERT INTO books (id, title, sort, timestamp, pubdate, series_index, path, last_modified, has_cover)
     VALUES (1, 'The Well of Ascension', 'Well', 1700000000, '2007-08-21', 2.0, ?, '2024-01-01T00:00:00Z', 0)`,
    [Path.relative(libraryDir, bookDir)],
  );
  db.run(`INSERT INTO books (id, title, sort, timestamp, pubdate, series_index, path, last_modified, has_cover)
     VALUES (2, 'Project Hail Mary', 'Hail', 1700000001, '2021-05-04', 1.0, ' standalone', '2024-01-02T00:00:00Z', 0)`);
  db.run(`INSERT INTO books (id, title, sort, timestamp, pubdate, series_index, path, last_modified, has_cover)
     VALUES (3, 'The $100 Startup', '$100 Startup', 1700000002, '2012-05-24', 1.0, ' hundred', '2024-01-03T00:00:00Z', 0)`);
  db.run(`INSERT INTO authors (id, name, sort) VALUES (1, 'Brandon Sanderson', 'Sanderson, Brandon')`);
  db.run(`INSERT INTO authors (id, name, sort) VALUES (2, 'Lã Quán Trung', 'Lã Quán Trung')`);
  db.run(`INSERT INTO books_authors_link (book, author) VALUES (1, 1), (3, 2)`);
  db.run(`INSERT INTO series (id, name, sort) VALUES (1, 'Mistborn', 'Mistborn')`);
  db.run(`INSERT INTO books_series_link (book, series) VALUES (1, 1)`);
  db.run(`INSERT INTO data (book, format, name) VALUES (1, 'EPUB', 'The Well of Ascension')`);
  db.run(`INSERT INTO languages (id, lang_code) VALUES (1, 'eng'), (2, 'vie')`);
  db.run(`INSERT INTO tags (id, name, sort) VALUES (1, 'Fiction', 'Fiction'), (2, 'Sách Việt', 'Sách Việt')`);
  db.run(`INSERT INTO books_tags_link (book, tag) VALUES (1, 1), (2, 2)`);
  db.run(`INSERT INTO books_languages_link (book, lang_code) VALUES (1, 1), (2, 2)`);
  db.close();
}

beforeAll(async () => {
  FS.mkdirSync(bookDir, { recursive: true });
  FS.writeFileSync(
    Path.join(bookDir, "The Well of Ascension.epub"),
    await buildFixtureEpub(),
  );
  buildFixtureDb();

  process.env.CALIBRE_LIBRARY_DIR = libraryDir;
  process.env.CALIBRE_USERNAME = "kien";
  process.env.CALIBRE_PASSWORD = "secret";
  process.env.PORT = "0";

  const { initDb } = await import("../src/db.ts");
  initDb(Path.join(libraryDir, "metadata.db"));
  const { createApp } = await import("../index.ts");
  app = createApp();
});

afterAll(() => {
  FS.rmSync(libraryDir, { recursive: true, force: true });
});

const get = (path: string, auth: string, extraHeaders: Record<string, string> = {}) =>
  app.fetch(new Request(`http://localhost${path}`, { headers: { authorization: auth, ...extraHeaders } }));

describe("auth", () => {
  test("unknown device tag is rejected", async () => {
    const res = await get("/opds/newest", basicAuth("kien#X5"));
    expect(res.status).toBe(401);
  });

  test("wrong password is rejected", async () => {
    const auth = `Basic ${Buffer.from("kien#X4:wrongpass").toString("base64")}`;
    const res = await get("/opds/newest", auth);
    expect(res.status).toBe(401);
  });
});

describe("device-aware feed", () => {
  test("X4 entries carry crafted titles, no author, single epub link", async () => {
    const res = await get("/opds/newest", basicAuth("kien#X4"));
    expect(res.status).toBe(200);
    const xml = await res.text();

    expect(xml).toContain("<title>Mistborn - 02 - The Well of Ascension</title>");
    expect(xml).not.toContain("<author>");
    expect(xml).not.toContain("<content");
    expect(xml.match(/rel="http:\/\/opds-spec\.org\/acquisition"/g)?.length).toBe(1);
    expect(xml).toContain('href="/get/books/1/formats/epub"');
    expect(xml).toContain('type="application/epub+zip"');
  });

  test("plain entries keep title, author, and metadata", async () => {
    const res = await get("/opds/newest", basicAuth("kien"));
    expect(res.status).toBe(200);
    const xml = await res.text();

    expect(xml).toContain("<title>The Well of Ascension</title>");
    expect(xml).toContain("<name>Brandon Sanderson</name>");
    expect(xml).toContain('href="/get/books/1/formats/epub"');
  });

  test("feed pages stay within the device's 50-entry parse cap", async () => {
    const res = await get("/opds/books", basicAuth("kien#X4"));
    const xml = await res.text();
    expect((xml.match(/<entry>/g) ?? []).length).toBeLessThanOrEqual(50);
  });

  test("feed xml is gzipped when the client asks for it", async () => {
    const res = await get("/opds/newest", basicAuth("kien"), {
      "accept-encoding": "gzip, deflate",
    });
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toBe("Accept-Encoding");
    const xml = await new Response(
      res.body!.pipeThrough(new DecompressionStream("gzip")),
    ).text();
    expect(xml).toContain("The Well of Ascension");
  });
});

describe("languages feed", () => {
  test("root lists By Languages", async () => {
    const res = await get("/opds", basicAuth("kien"));
    const xml = await res.text();
    expect(xml).toContain("By Languages");
    expect(xml).toContain('href="/opds/languages"');
  });

  test("root keeps the Reload Catalog entry", async () => {
    const res = await get("/opds", basicAuth("kien"));
    const xml = await res.text();
    expect(xml).toContain("Reload Catalog");
    expect(xml).toContain('href="/opds/reload"');
  });


  test("language list shows display names", async () => {
    const res = await get("/opds/languages", basicAuth("kien"));
    const xml = await res.text();
    expect(xml).toContain("<title>English</title>");
    expect(xml).toContain("<title>Vietnamese</title>");
    expect(xml).toContain('href="/opds/languages/1"');
  });

  test("language books feed carries the device tag", async () => {
    const res = await get("/opds/languages/1", basicAuth("kien#X4"));
    const xml = await res.text();
    expect(xml).toContain("Calibre Library - Languages - English");
    expect(xml).toContain("<title>Mistborn - 02 - The Well of Ascension</title>");
    expect(xml).not.toContain("<author>");
  });
});

describe("alphabet feeds", () => {
  test("authors root is a letter index, diacritics folded", async () => {
    const res = await get("/opds/authors", basicAuth("kien"));
    const xml = await res.text();
    expect(xml).toContain(">B<");
    expect(xml).toContain(">L<");
    expect(xml).toContain('href="/opds/authors/letters/B"');
    expect(xml).toContain('href="/opds/authors/letters/L"');
    expect(xml).not.toContain("Brandon Sanderson");
  });

  test("author letter bucket lists names", async () => {
    const res = await get("/opds/authors/letters/L", basicAuth("kien"));
    const xml = await res.text();
    expect(xml).toContain("Calibre Library - Authors - L");
    expect(xml).toContain("Lã Quán Trung");
  });

  test("books root is a letter index with one symbol bucket", async () => {
    const res = await get("/opds/books", basicAuth("kien"));
    const xml = await res.text();
    expect(xml).toContain(">H<");
    expect(xml).toContain(">W<");
    expect(xml).toContain("<title>#</title>");
    expect(xml).toContain('href="/opds/books/letters/other"');
    expect(xml).not.toContain("Project Hail Mary");
  });

  test("book letter bucket carries the device tag", async () => {
    const res = await get("/opds/books/letters/W", basicAuth("kien#X4"));
    const xml = await res.text();
    expect(xml).toContain("Calibre Library - Books - W");
    expect(xml).toContain("<title>Mistborn - 02 - The Well of Ascension</title>");
    expect(xml).not.toContain("<author>");
  });

  test("symbol bucket groups $ and digits together", async () => {
    const res = await get("/opds/books/letters/other", basicAuth("kien"));
    const xml = await res.text();
    expect(xml).toContain("The $100 Startup");
  });
});

describe("tags alphabet feed", () => {
  test("tags root is a letter index, diacritics folded", async () => {
    const res = await get("/opds/tags", basicAuth("kien"));
    const xml = await res.text();
    expect(xml).toContain(">F<");
    expect(xml).toContain(">S<");
    expect(xml).toContain('href="/opds/tags/letters/F"');
    expect(xml).toContain('href="/opds/tags/letters/S"');
    expect(xml).not.toContain("Fiction");
  });

  test("tag letter bucket lists names and links", async () => {
    const res = await get("/opds/tags/letters/F", basicAuth("kien"));
    const xml = await res.text();
    expect(xml).toContain("Calibre Library - Tags - F");
    expect(xml).toContain("Fiction");
    expect(xml).toContain('href="/opds/tags/1"');
  });
});


describe("optimizing download", () => {
  test("X4 epub download is a rebuilt zip with CrossInk sidecars", async () => {
    const res = await get("/get/books/1/formats/epub", basicAuth("kien#X4"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    expect(res.headers.get("content-disposition")).toContain(
      "Mistborn - 02 - The Well of Ascension.epub",
    );

    const body = new Uint8Array(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(body);

    expect(zip.file("mimetype")).toBeDefined();
    const manifestFile = zip.file("META-INF/crossink/optimizer-v1.json");
    expect(manifestFile).toBeDefined();
    const manifest = JSON.parse(await manifestFile!.async("string"));
    expect(manifest.format).toBe("crossink-optimizer");
    expect(manifest.target.device).toBe("x4");
    expect(manifest.target.width).toBe(800);
    expect(manifest.target.height).toBe(480);
    expect(manifest.images.length).toBe(1);
    expect(manifest.images[0].pxcFormat).toBe("pxc2");

    // COIX index header
    const index = new Uint8Array(
      await zip.file("META-INF/crossink/optimizer-images-v1.idx")!.async("uint8array"),
    );
    expect(Array.from(index.subarray(0, 4))).toEqual([67, 79, 73, 88]);

    // Image was renamed to .jpg and capped to the X4 viewport
    expect(zip.file("OEBPS/images/spread.jpg")).toBeDefined();
    expect(zip.file("OEBPS/images/spread.png")).toBeNull();
    const jpg = await zip.file("OEBPS/images/spread.jpg")!.async("nodebuffer");
    const meta = await sharp(jpg).metadata();
    expect(meta.width).toBeLessThanOrEqual(480);
    expect(meta.height).toBeLessThanOrEqual(800);
    expect(meta.format).toBe("jpeg");

    // Long section was split and registered
    const splitFiles = Object.keys(zip.files).filter((p) =>
      p.includes("__ci_section_"),
    );
    expect(splitFiles.length).toBeGreaterThan(0);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain("-ci-");

    // X-locations present
    expect(zip.file("META-INF/x-locations.json")).toBeDefined();
  });

  test("plain epub download serves the original file", async () => {
    const res = await get("/get/books/1/formats/epub", basicAuth("kien"));
    expect(res.status).toBe(200);
    const body = new Uint8Array(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(body);
    expect(zip.file("OEBPS/images/spread.png")).toBeDefined();
    expect(zip.file("META-INF/crossink/optimizer-v1.json")).toBeNull();
    expect(res.headers.get("content-disposition")).toContain(
      "The Well of Ascension - Brandon Sanderson.epub",
    );
  });
});
