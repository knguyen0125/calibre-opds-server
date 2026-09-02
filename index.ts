import Bun, { XML } from "bun";
import { Library } from "./src/opds.ts";
import { Elysia, file, t } from "elysia";
import { requireAuth } from "./src/auth.ts";

const main = async () => {
  const library = new Library(process.env.CALIBRE_LIBRARY_DIR!);

  const app = new Elysia()
    .onBeforeHandle(requireAuth)
    .get("/opds", () => {
      return new Response(library.getRootFeed().toXML(), {
        headers: {
          "Content-Type": "application/atom+xml",
        },
      });
    })
    .get(
      "/opds/authors",
      ({ query }) => {
        return library.getAuthorListFeed({ page: query.page }).toXML();
      },
      {
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/opds/authors/:id",
      ({ params, query }) => {
        return library
          .getAuthorBooksFeed(params.id, { page: query.page })
          .toXML();
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
      ({ query }) => {
        return library.getSeriesListFeed({ page: query.page }).toXML();
      },
      {
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/opds/series/:id",
      ({ params, query }) => {
        return library
          .getSeriesBooksFeed(params.id, { page: query.page })
          .toXML();
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
      ({ query }) => {
        return library.getTagListFeed({ page: query.page }).toXML();
      },
      {
        query: t.Object({
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/opds/tags/:id",
      ({ params, query }) => {
        return library.getTagBooksFeed(params.id, { page: query.page }).toXML();
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
      ({ query }) => {
        return library.getBooksFeed({ page: query.page }).toXML();
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
      ({ query }) => {
        return library
          .getSearchBooksFeed(query.q, { page: query.page })
          .toXML();
      },
      {
        query: t.Object({
          q: t.String({ default: "" }),
          page: t.Numeric({ minimum: 1, default: 1 }),
        }),
      },
    )
    .get(
      "/get/:id/formats/:format",
      ({ params }) => {
        return file(library.getBookPath(params.id, params.format));
      },
      {
        params: t.Object({
          id: t.Numeric(),
          format: t.String(),
        }),
      },
    )
    .listen(process.env.PORT || "8006");

  console.log(`Server started on ${app.server?.hostname}:${app.server?.port}`);
};

main();
