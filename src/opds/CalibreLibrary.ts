import { Link } from "./Link.ts";
import { NavigationFeedLink } from "./NavigationFeedLink.ts";
import { Feed } from "./Feed.ts";
import { Entry } from "./Entry.ts";
import type {
  Author,
  Book,
  BookFormat,
  Pagination,
  Series,
  Tag,
} from "./types.ts";
import { BookEntry } from "./BookEntry.ts";
import * as Path from "node:path";
import { sql } from "bun";

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
      entries: Entry[];
    },
    param: Pagination,
  ): Promise<Feed> {
    const updatedAt = await this.getUpdatedAt();
    const feed = new Feed(options.id, options.title, updatedAt);

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

    if (options.entries.length > this.pageSize) {
      feed.addLink(
        new NavigationFeedLink(`${baseUrl}page=${param.page + 1}`).setRel(
          "next",
        ),
      );
    }

    for (const entry of options.entries) {
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
    const authors = await sql<Author[]>`WITH author_book_count AS (
              SELECT author, count(DISTINCT book) AS booksCount
              FROM books_authors_link
              GROUP BY author
          )
          SELECT id, name, sort, booksCount
          FROM authors
          JOIN author_book_count ON authors.id = author_book_count.author
          ORDER BY sort asc
          LIMIT ${this.pageSize + 1}
          OFFSET ${this.pageSize * (param.page - 1)}`;

    const updatedAt = await this.getUpdatedAt();

    return this.getCatalogFeed(
      {
        id: "urn:calibre:navigation-catalog:authors",
        title: "Calibre Library - Authors",
        baseUrl: "/opds/authors",
        entries: authors.map((author) =>
          new Entry(`urn:calibre:authors:${author.id}`, author.name, updatedAt)
            .setContent("text", `${author.booksCount} books`)
            .addLink(new NavigationFeedLink(`/opds/authors/${author.id}`)),
        ),
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

    const books = options.bookIds
      ? await sql<
          Book[]
        >`SELECT id, title, sort, last_modified as updatedAt, path FROM books WHERE id in ${sql(options.bookIds)} ORDER BY sort LIMIT ${this.pageSize + 1} OFFSET ${this.pageSize * (param.page - 1)};`
      : await sql<
          Book[]
        >`SELECT id, title, sort, last_modified as updatedAt, path FROM books ORDER BY sort LIMIT ${this.pageSize + 1} OFFSET ${this.pageSize * (param.page - 1)};`;

    const bookFormats = await sql<
      BookFormat[]
    >`SELECT book as id, LOWER(format) as format, name as fileName 
            FROM data 
            WHERE book in ${sql(books.map((book) => book.id))}`;

    if (books.length > this.pageSize) {
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
      await sql<Author[]>`SELECT id, name, sort from authors where id = ${id}`
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
        title: `Calibre Library - Authors - ${author.name}`,
        baseUrl: `/opds/authors/${id}`,
        bookIds,
      },
      param,
    );
  }

  async getSeriesListFeed(param: Pagination): Promise<Feed> {
    // TODO: Replace with Author from database
    // This should overfetch (pageSize + 1) as a way to check for next page
    const seriesList: Series[] = [];
    // TODO: Replace with updated at from database
    const updatedAt = await this.getUpdatedAt();

    return this.getCatalogFeed(
      {
        id: "urn:calibre:navigation-catalog:authors",
        title: "Calibre Library - Series",
        baseUrl: "/opds/series",
        entries: seriesList.map((series) =>
          new Entry(
            `urn:calibre:series:${series.id}`,
            series.name,
            updatedAt,
          ).setContent("text", `${series.booksCount} books`),
        ),
      },
      param,
    );
  }

  async getSeriesBooksFeed(id: number, param: Pagination): Promise<Feed> {
    const series = (
      await sql<Series[]>`SELECT id, name, sort from series where id = ${id}`
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
    // TODO: Replace with Author from database
    // This should overfetch (pageSize + 1) as a way to check for next page
    const tags: Tag[] = [];
    // TODO: Replace with updated at from database
    const updatedAt = await this.getUpdatedAt();

    return this.getCatalogFeed(
      {
        id: "urn:calibre:navigation-catalog:authors",
        title: "Calibre Library - Tags",
        baseUrl: "/opds/tags",
        entries: tags.map((tag) =>
          new Entry(
            `urn:calibre:series:${tag.id}`,
            tag.name,
            updatedAt,
          ).setContent("text", `${tag.booksCount} books`),
        ),
      },
      param,
    );
  }

  async getTagBooksFeed(id: number, param: Pagination): Promise<Feed> {
    const tag = (
      await sql<Tag[]>`SELECT id, name FROM tags WHERE id = ${id}`
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
        title: tag.name,
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
    const book = (await sql<Book[]>`select * from books where id = ${id}`)[0];
    if (!book) {
      throw new Error(`Book ${id} not found`);
    }

    const bookFormat = (
      await sql<
        BookFormat[]
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
    const book = (await sql<Book[]>`select * from books where id = ${id}`)[0];
    if (!book) {
      throw new Error(`Book ${id} not found`);
    }

    return {
      path: Path.resolve(this.calibreLibraryDir, book.path, `cover.jpg`),
    };
  }
}
