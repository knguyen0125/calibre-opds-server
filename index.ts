import Bun, { sql, XML } from "bun";
import { CalibreLibrary } from "./src/opds/CalibreLibrary.ts";
import { Elysia, file, t } from "elysia";
import { requireAuth } from "./src/auth.ts";
import * as FS from "node:fs";
import * as Path from "node:path";
import { Book } from "./src/opds/Book.ts";
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

  // Set DATABASE_URL for Bun.SQL
  Bun.env.DATABASE_URL = `file://${Path.resolve(calibreLibraryDir, "metadata.db")}`;
};

const main = async () => {
  prebootValidation();

  const library = new CalibreLibrary();

  const app = new Elysia()
    .onBeforeHandle(requireAuth)
    .onBeforeHandle(({ path, query }) => {
      console.log(path, query);
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
      async ({ params, query, set }) => {
        set.headers["content-type"] = "application/atom+xml";
        return (
          await library.getAuthorBooksFeed(params.id, { page: query.page })
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
      async ({ set, params, query }) => {
        set.headers["content-type"] = "application/xml";
        return (
          await library.getSeriesBooksFeed(params.id, { page: query.page })
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
      async ({ set, params, query }) => {
        set.headers["content-type"] = "application/xml";
        return (
          await library.getTagBooksFeed(params.id, { page: query.page })
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
      async ({ set, query }) => {
        set.headers["content-type"] = "application/xml";
        return (await library.getBooksFeed({ page: query.page })).toXML();
      },
      {
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/opds/newest",
      async ({ set, query }) => {
        set.headers["content-type"] = "application/xml";
        return (await library.getNewestBooksFeed({ page: query.page })).toXML();
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
      async ({ set, query }) => {
        set.headers["content-type"] = "application/xml";
        return (
          await library.getSearchBooksFeed(query.q, { page: query.page })
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
      async ({ set, params }) => {
        const book = await Book.fromId(params.id);
        const { path, mimeType } = book.getBookPath(params.format);

        set.headers["content-type"] = mimeType;

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
    .listen(process.env.PORT || "8006");

  console.log(`Server started on ${app.server?.hostname}:${app.server?.port}`);
};

main();
