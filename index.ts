import { XML } from "bun";
import { CalibreLibrary } from "./src/opds/CalibreLibrary.ts";
import { Elysia, file, t } from "elysia";
import { deviceFromHeaders, requireAuth } from "./src/auth.ts";
import * as FS from "node:fs";
import * as Path from "node:path";
import { Book } from "./src/opds/Book.ts";
import { initDb, reloadDb, watchLibrary } from "./src/db.ts";
import { getOptimizedEpub } from "./src/opds/optimizeService.ts";
/**
 * Validate preboot environment
 */
const prebootValidation = () => {
  const calibreLibraryDir = process.env.CALIBRE_LIBRARY_DIR;
  if (!calibreLibraryDir) {
    throw new Error("CALIBRE_LIBRARY_DIR environment variable is not set");
  }

  if (!FS.existsSync(Path.resolve(calibreLibraryDir))) {
    throw new Error(
      `Calibre library directory ${calibreLibraryDir} does not exist`,
    );
  }

  if (!FS.existsSync(Path.resolve(calibreLibraryDir, "metadata.db"))) {
    throw new Error(`Calibre database in ${calibreLibraryDir} does not exist`);
  }
};

const contentDisposition = (name: string): string => {
  // Header values must be ASCII; non-ASCII falls back to '?' in the
  // quoted filename while filename* carries the real name.
  const safe = name
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, "_")
    .trim()
    .replace(/"/g, "'")
    .replace(/[^\x20-\x7e]/g, "?");
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};
export type App = ReturnType<typeof createApp>;

export const createApp = () => {
  const library = new CalibreLibrary();

  return (
    new Elysia()
      .onError(({ error, path }) => {
        console.error(`[error] ${path}:`, error);
      })
      .onBeforeHandle(requireAuth)
      .onAfterHandle(({ set, headers, response }) => {
        // gzip feed XML for clients that ask for it; the X4 never sends
        // Accept-Encoding and always gets identity.
        const accept = headers["accept-encoding"];
        const type = set.headers?.["content-type"] ?? "";
        if (
          !accept?.includes("gzip") ||
          !type.includes("xml") ||
          typeof response !== "string"
        ) {
          return;
        }
        set.headers["content-encoding"] = "gzip";
        set.headers["vary"] = "Accept-Encoding";
        return new Response(Bun.gzipSync(response), {
          headers: set.headers as Record<string, string>,
        });
      })
      .onBeforeHandle(({ path, query }) => {
        console.log(path, query);
      })
      .get("/opds/reload", async ({ set }) => {
        await reloadDb();
        console.log("[db] manual reload requested");
        set.status = 302;
        set.headers.location = "/opds";
      })
    .get("/opds", async ({ set }) => {
      set.headers["content-type"] = "application/atom+xml";

      return (await library.getRootFeed()).toXML();
    })
    .get(
      "/opds/authors",
      async ({ query, set }) => {
        set.headers["content-type"] = "application/atom+xml";

        return (await library.getAuthorListFeed({ page: query.page })).toXML();
      },
      {
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/opds/authors/:id",
      async ({ params, query, set, headers }) => {
        set.headers["content-type"] = "application/atom+xml";
        return (
          await library.getAuthorBooksFeed(
            params.id,
            { page: query.page },
            deviceFromHeaders(headers),
          )
        ).toXML();
      },
      {
        params: t.Object({
          id: t.Numeric(),
        }),
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/opds/series/",
      async ({ set, query }) => {
        set.headers["content-type"] = "application/xml";
        return (await library.getSeriesListFeed({ page: query.page })).toXML();
      },
      {
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/opds/series/:id",
      async ({ set, params, query, headers }) => {
        set.headers["content-type"] = "application/xml";
        return (
          await library.getSeriesBooksFeed(
            params.id,
            { page: query.page },
            deviceFromHeaders(headers),
          )
        ).toXML();
      },
      {
        params: t.Object({
          id: t.Numeric(),
        }),
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/opds/tags",
      async ({ set, query }) => {
        set.headers["content-type"] = "application/xml";
        return (await library.getTagListFeed({ page: query.page })).toXML();
      },
      {
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/opds/tags/:id",
      async ({ set, params, query, headers }) => {
        set.headers["content-type"] = "application/xml";
        return (
          await library.getTagBooksFeed(
            params.id,
            { page: query.page },
            deviceFromHeaders(headers),
          )
        ).toXML();
      },
      {
        params: t.Object({
          id: t.Numeric(),
        }),
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/opds/languages",
      async ({ set, query }) => {
        set.headers["content-type"] = "application/xml";
        return (await library.getLanguageListFeed({ page: query.page })).toXML();
      },
      {
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/opds/languages/:id",
      async ({ set, params, query, headers }) => {
        set.headers["content-type"] = "application/xml";
        return (
          await library.getLanguageBooksFeed(
            params.id,
            { page: query.page },
            deviceFromHeaders(headers),
          )
        ).toXML();
      },
      {
        params: t.Object({
          id: t.Numeric(),
        }),
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/opds/books",
      async ({ set, query, headers }) => {
        set.headers["content-type"] = "application/xml";
        return (
          await library.getBooksFeed({ page: query.page }, deviceFromHeaders(headers))
        ).toXML();
      },
      {
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/opds/newest",
      async ({ set, query, headers }) => {
        set.headers["content-type"] = "application/xml";
        return (
          await library.getNewestBooksFeed(
            { page: query.page },
            deviceFromHeaders(headers),
          )
        ).toXML();
      },
      {
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get("/opds/search.xml", ({}) => {
      const document: XML.Node = {
        name: "OpenSearchDescription",
        attributes: {
          xmlns: "http://a9.com/-/spec/opensearch/1.1/",
        },
        children: [
          {
            name: "ShortName",
            attributes: {},
            children: ["Search"],
          },
          {
            name: "Url",
            attributes: {
              type: "application/atom+xml;profile=opds-catalog;kind=acquisition",
              template: "/opds/search?q={searchTerms}",
            },
            children: [],
          },
        ],
      };

      return new Response(
        `<?xml version="1.0" encoding="utf-8"?>${XML.stringify(document)}`,
        {
          headers: {
            "Content-Type":
              "application/opensearchdescription+xml;charset=UTF-8",
          },
        },
      );
    })
    .get(
      "/opds/search",
      async ({ set, query, headers }) => {
        set.headers["content-type"] = "application/xml";
        return (
          await library.getSearchBooksFeed(
            query.q,
            { page: query.page },
            deviceFromHeaders(headers),
          )
        ).toXML();
      },
      {
        query: t.Object({
          q: t.String({ default: "" }),
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/get/books/:id/formats/:format",
      async ({ params, headers, set }) => {
        const device = deviceFromHeaders(headers);
        const book = await Book.fromId(params.id, device ?? undefined);

        if (device && params.format.toLowerCase() === "epub") {
          try {
            const { path } = book.getBookPath("epub");
            const optimized = await getOptimizedEpub(params.id, device, path);
            set.headers["content-type"] = "application/epub+zip";
            set.headers["content-disposition"] = contentDisposition(
              `${book.title}.epub`,
            );
            return new Response(optimized);
          } catch (error) {
            // Mirror the CrossInk uploader: fall back to the original
            // file when optimization fails (including DRM).
            console.error(
              `[optimize] book=${params.id} device=${device} failed, serving original:`,
              error,
            );
          }
        }

        const { path, mimeType } = book.getBookPath(params.format);

        set.headers["content-type"] = mimeType;
        const authors = book.authorsDisplay.join(", ");
        set.headers["content-disposition"] = contentDisposition(
          authors
            ? `${book.title} - ${authors}.${params.format}`
            : `${book.title}.${params.format}`,
        );

        return file(path);
      },
      {
        params: t.Object({
          id: t.Numeric(),
          format: t.String(),
        }),
      },
    )
    .get(
      "/get/books/:id/cover",
      async ({ set, params }) => {
        const book = await Book.fromId(params.id);
        const { path } = book.getCoverPath();

        set.headers["content-type"] = "image/jpeg";

        return file(path);
      },
      {
        params: t.Object({
          id: t.Numeric(),
        }),
      },
    )
  );
};

const main = async () => {
  prebootValidation();

  const libraryDir = Path.resolve(process.env.CALIBRE_LIBRARY_DIR!);
  initDb(Path.join(libraryDir, "metadata.db"));
  watchLibrary();

  const app = createApp();
  app.listen(process.env.PORT || "8006");

  console.log(`Server started on ${app.server?.hostname}:${app.server?.port}`);
};

if (import.meta.main) {
  main();
}
