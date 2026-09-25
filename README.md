# calibre-opds-server

OPDS catalog over a calibre library, with on-the-fly EPUB optimization
for CrossInk readers (XTEINK X4 / X3).

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Configuration

Environment (or `.env`):

- `CALIBRE_LIBRARY_DIR` — library folder containing `metadata.db`
- `CALIBRE_USERNAME` / `CALIBRE_PASSWORD` — Basic auth credentials
- `PORT` — listen port (default 8006)

## Device usernames

The Basic Auth username selects the optimization target:

- `user#X4` — optimize downloads for the XTEINK X4 (480x800)
- `user#X3` — optimize downloads for the X3 (528x792)
- `user` — plain username, no device: original files are served as-is

The tag is case-insensitive; an unknown tag (`user#X5`) is rejected with
401 so a typo cannot silently pick the wrong resolution. The base
username must match `CALIBRE_USERNAME` and must not itself contain `#`.

Configure the reader with the server URL plus `/opds` (CrossInk: add
`/opds` to the catalog URL).

## Catalog

Root navigation: By Newest, By Authors, By Series, By Tags, By
Languages, By Books, Reload Catalog, plus OpenSearch search at
`/opds/search`.

By Authors, By Tags, and By Books open an alphabet index first (one
screen on the reader) instead of paging through thousands of entries.
Author buckets use the first letter of the display name, not calibre's
inverted sort (George R. R. Martin sits under G); diacritics fold to
the base letter (Lã under L, Đ under D), and digits/symbols share a
single "#" bucket. Book buckets use calibre's title sort.

## What the device feed does

When a request carries a device tag, book entries are shaped for the
CrossInk OPDS client: the entry title carries the filename base
(`<Series> - <NN> - <Title>.epub`, zero-padded index, plain
`<Title>.epub` without a series) and the author rides along, so the
device shows it while browsing and appends it to the saved filename per
its per-server format setting ("Title - Author" or
"Author - Title"). Only the EPUB acquisition link is emitted. Feeds are
paginated at 20 entries, well under the reader's 50-entry parse cap.

## EPUB optimization

`/get/books/:id/formats/epub` rebuilds the EPUB in memory on request
when the username carries a device tag. The port follows CrossInk's web
uploader (web/pages/files.js):

- images: flattened, capped to the device viewport, grayscaled,
  re-encoded as baseline JPEG q85 (Jimp, pure JS — PNG/JPEG/BMP/TIFF/
  GIF decode; WebP and SVG stay as-is and the reader shows a
  placeholder for them; EXIF orientation is not applied)
- repairs: invisible blank codepoints scrubbed, SVG-wrapped
  covers/images unwrapped, OPF cover meta and NCX identifier fixed,
  defensive CSS injected into every chapter
- long sections split at natural boundaries (headings, page breaks) so
  omnibus files stay inside the reader's section budget
- X-locations manifest for position mapping
- PXC2 sidecars (`META-INF/crossink/pxc/*.pxc2` + COIX index): 2-bit
  Bayer-dithered pixels at CSS display size, which the firmware renders
  directly, skipping on-device JPEG decode

Optimization failure (including DRM-protected files) falls back to the
original file, mirroring the CrossInk uploader.

Results are cached on disk (atomic writes, keyed by book + device +
source size/mtime + optimizer version, so calibre edits invalidate).
Image-heavy books can take tens of seconds to build on the first
download — if the reader gives up mid-download, the finished file is
already cached and the retry is instant. The cache is swept oldest-first
whenever it exceeds `OPTIMIZER_CACHE_MAX_BYTES` (default 2 GiB).

- `OPTIMIZER_CACHE_DIR` — cache location (default `optimizer-cache/`
  under the working directory)
- `OPTIMIZER_CACHE_MAX_BYTES` — eviction threshold in bytes

Note: image-heavy books grow (a 26 MB manga became 37 MB) because PXC2
sidecars duplicate every image at 2bpp alongside the JPEG fallback;
that size is the price of skipping on-device decode.

Plain-username requests get the untouched calibre file with a
`Content-Disposition` filename (`Title - Author.epub`). Feed XML is
gzipped for clients that send `Accept-Encoding` (the X4 does not).

## Tests

```bash
bun test
```

The PXC2/COIX encoders are checked byte-for-byte against CrossInk's
golden vectors (`test/golden/pxc_v2`, from CrossInk `test/pxc_v2`).
