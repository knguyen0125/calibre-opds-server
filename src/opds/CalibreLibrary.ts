import { Link } from "./Link.ts";
import { NavigationFeedLink } from "./NavigationFeedLink.ts";
import { Feed } from "./Feed.ts";
import { Entry } from "./Entry.ts";
import type { Pagination } from "./types.ts";
import { BookEntry } from "./BookEntry.ts";
import * as Path from "node:path";
import { sql } from "bun";
import { AuthorEntry } from "./AuthorEntry.ts";
import { SeriesEntry } from "./SeriesEntry.ts";
import { TagEntry } from "./TagEntry.ts";

/**
 * Calibre Library Model
 */
export class CalibreLibrary {
  private readonly pageSize: number = 20;
  constructor(private readonly calibreLibraryDir: string) {}

  public getRootFeed(): Feed {
    // TODO: Replace with latest changes in database?
    const updatedAt = new Date().toISOString();

    const rootFeed = new Feed("urn:calibre:root", "Calibre Library", updatedAt);

    // Link to OpenSearch document
    rootFeed.addLink(
      new Link("/opds/search.xml")
        .setRel("search")
        .setType("application/opensearchdescription+xml"),
    );

    // Link to self
    rootFeed.addLink(
      new Link("/opds")
        .setType(
          "application/atom+xml;type=feed;profile=opds-catalog;kind=navigation",
        )
        .setRel("start")
        .setTitle("Start"),
    );

    rootFeed.addEntry(
      new Entry(
        "urn:calibre:catalogs:authors",
        "By Authors",
        updatedAt,
      ).addLink(new NavigationFeedLink("/opds/authors")),
    );

    rootFeed.addEntry(
      new Entry("urn:calibre:catalogs:series", "By Series", updatedAt).addLink(
        new NavigationFeedLink("/opds/series"),
      ),
    );

    rootFeed.addEntry(
      new Entry("urn:calibre:catalogs:tags", "By Tags", updatedAt).addLink(
        new NavigationFeedLink("/opds/tags"),
      ),
    );

    rootFeed.addEntry(
      new Entry(
        "urn:calibre:catalogs:books",
        "By Books (Alphabetical)",
        updatedAt,
      ).addLink(new NavigationFeedLink("/opds/books")),
    );

    return rootFeed;
  }

  private async getCatalogFeed(
    options: {
      id: string;
      title: string;
      baseUrl: string;
      table: string;
      orderBy: string;
      entryFromId: (id: number) => Promise<Entry>;
    },
    param: Pagination,
  ): Promise<Feed> {
    const updatedAt = await this.getUpdatedAt();
    const feed = new Feed(options.id, options.title, updatedAt);

    // Identifiers come from literals in this class; values stay bound
    const rows: { id: number }[] = await sql`
      SELECT id 
      FROM ${sql(options.table)} 
      ORDER BY ${sql(options.orderBy)} asc 
      LIMIT ${this.pageSize + 1} 
      OFFSET ${this.pageSize * (param.page - 1)}`;

    const entries = await Promise.all(
      rows.map((row) => options.entryFromId(row.id)),
    );

    const baseUrl = options.baseUrl.includes("?")
      ? `${options.baseUrl}&`
      : `${options.baseUrl}?`;

    feed.addLink(
      new NavigationFeedLink(`${baseUrl}page=${param.page}`).setRel("self"),
    );

    if (param.page > 1) {
      feed.addLink(
        new NavigationFeedLink(`${baseUrl}page=${param.page - 1}`).setRel(
          "previous",
        ),
      );
    }

    if (entries.length > this.pageSize) {
      feed.addLink(
        new NavigationFeedLink(`${baseUrl}page=${param.page + 1}`).setRel(
          "next",
        ),
      );
    }

    for (const entry of entries.slice(0, this.pageSize)) {
      feed.addEntry(entry);
    }

    return feed;
  }

  private async getUpdatedAt() {
    const rows = await sql<
      {
        updatedAt: string;
      }[]
    >`SELECT max(last_modified) as updatedAt from books`;

    if (!rows) {
      return new Date().toISOString();
    }

    return new Date(rows[0]!.updatedAt).toISOString();
  }

  async getAuthorListFeed(param: Pagination): Promise<Feed> {
    return this.getCatalogFeed(
      {
        id: "urn:calibre:navigation-catalog:authors",
        title: "Calibre Library - Authors",
        baseUrl: "/opds/authors",
        table: "authors",
        orderBy: "sort",
        entryFromId: AuthorEntry.fromId,
      },
      param,
    );
  }

  private async getBooksAcquisitionFeed(
    options: {
      id: string;
      title: string;
      baseUrl: string;
      bookIds?: number[];
    },
    param: Pagination,
  ): Promise<Feed> {
    const updatedAt = await this.getUpdatedAt();
    const feed = new Feed(options.id, options.title, updatedAt);

    // If includes ?, then we can assume that it already has a query string => append &
    const baseUrlWithQuery = options.baseUrl.includes("?")
      ? `${options.baseUrl}&`
      : `${options.baseUrl}?`;

    feed.addLink(
      new NavigationFeedLink(`${baseUrlWithQuery}page=${param.page}`).setRel(
        "self",
      ),
    );

    if (param.page > 1) {
      feed.addLink(
        new NavigationFeedLink(
          `${baseUrlWithQuery}page=${param.page - 1}`,
        ).setRel("previous"),
      );
    }

    const bookIds =
      options.bookIds ||
      (
        await sql<
          { id: number }[]
        >`SELECT id from books ORDER BY sort limit ${this.pageSize + 1} offset ${this.pageSize * (param.page - 1)}`
      ).map((b) => b.id);

    if (bookIds.length > this.pageSize) {
      feed.addLink(
        new NavigationFeedLink(
          `${baseUrlWithQuery}page=${param.page + 1}`,
        ).setRel("next"),
      );
    }

    for (let i = 0; i < bookIds.length && i < this.pageSize; i++) {
      feed.addEntry(await BookEntry.fromId(bookIds[i]!));
    }

    return feed;
  }

  async getAuthorBooksFeed(id: number, param: Pagination): Promise<Feed> {
    const author = (
      await sql<
        { sort: string }[]
      >`SELECT id, name, sort from authors where id = ${id}`
    )[0];

    if (!author) {
      throw new Error(`Author with id ${id} not found`);
    }

    const bookIds = (
      await sql<
        { book: number }[]
      >`select book from books_authors_link where author = ${id}`
    ).map((book) => book.book);

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:authors:${id}`,
        title: `Calibre Library - Authors - ${author.sort}`,
        baseUrl: `/opds/authors/${id}`,
        bookIds,
      },
      param,
    );
  }

  async getSeriesListFeed(param: Pagination): Promise<Feed> {
    return this.getCatalogFeed(
      {
        id: "urn:calibre:navigation-catalog:series",
        title: "Calibre Library - Series",
        baseUrl: "/opds/series",
        table: "series",
        orderBy: "sort",
        entryFromId: SeriesEntry.fromId,
      },
      param,
    );
  }

  async getSeriesBooksFeed(id: number, param: Pagination): Promise<Feed> {
    const series = (
      await sql<
        { id: number; name: string; sort: string }[]
      >`SELECT id, name, sort from series where id = ${id}`
    )[0];

    if (!series) {
      throw new Error("Series not found");
    }

    const bookIds = (
      await sql<
        { book: number }[]
      >`select book from books_series_link where series = ${id}`
    ).map((book) => book.book);

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:series:${id}`,
        title: series.name,
        baseUrl: `/opds/series/${id}`,
        bookIds,
      },
      param,
    );
  }

  async getTagListFeed(param: Pagination): Promise<Feed> {
    return this.getCatalogFeed(
      {
        id: "urn:calibre:navigation-catalog:tags",
        title: "Calibre Library - Tags",
        baseUrl: "/opds/tags",
        table: "tags",
        orderBy: "name",
        entryFromId: TagEntry.fromId,
      },
      param,
    );
  }

  async getTagBooksFeed(id: number, param: Pagination): Promise<Feed> {
    const tag = (
      await sql<
        { id: number; name: string }[]
      >`SELECT id, name FROM tags WHERE id = ${id}`
    )[0];

    if (!tag) {
      throw new Error(`Tag with id ${id} not found`);
    }

    const bookIds = (
      await sql<
        { book: number }[]
      >`select book from books_tags_link where tag = ${id}`
    ).map((book) => book.book);

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:tags:${id}`,
        title: `Calibre Library - Tags - ${tag.name}`,
        baseUrl: `/opds/tags/${id}`,
        bookIds,
      },
      param,
    );
  }

  async getBooksFeed(param: Pagination): Promise<Feed> {
    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:books`,
        title: "Calibre Library - Books",
        baseUrl: `/opds/books`,
      },
      param,
    );
  }

  async getSearchBooksFeed(query: string, param: Pagination): Promise<Feed> {
    const bookIds = (
      await sql<
        { id: number }[]
      >`select id from books where lower(title) like ${"%" + query.toLowerCase() + "%"}`
    ).map((book) => book.id);

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:books`,
        title: `Calibre Library - Search - ${query}`,
        baseUrl: `/opds/search?q=${query}`,
        bookIds,
      },
      param,
    );
  }

  async getBookPath(
    id: number,
    format: string,
  ): Promise<{ path: string; mimeType: string }> {
    const book = (
      await sql<
        { id: number; path: string }[]
      >`select id, path from books where id = ${id}`
    )[0];
    if (!book) {
      throw new Error(`Book ${id} not found`);
    }

    const bookFormat = (
      await sql<
        { id: number; format: string; fileName: string }[]
      >`SELECT book as id, LOWER(format) as format, name as fileName 
            FROM data where book = ${id} and lower(format) = ${format.toLowerCase()}`
    )[0];

    if (!bookFormat) {
      throw new Error(`Format ${format} not found for book ${id}`);
    }

    return {
      path: Path.resolve(
        this.calibreLibraryDir,
        book.path,
        `${bookFormat.fileName}.${bookFormat.format}`,
      ),
      mimeType: BookEntry.getMimeType(bookFormat.format),
    };
  }

  async getCoverPath(id: number): Promise<{ path: string }> {
    const book = (
      await sql<
        { id: number; path: string }[]
      >`select id, path from books where id = ${id}`
    )[0];
    if (!book) {
      throw new Error(`Book ${id} not found`);
    }

    return {
      path: Path.resolve(this.calibreLibraryDir, book.path, `cover.jpg`),
    };
  }
}
