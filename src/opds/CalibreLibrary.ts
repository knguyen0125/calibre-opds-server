import { Link } from "./Link.ts";
import { NavigationFeedLink } from "./NavigationFeedLink.ts";
import { Feed } from "./Feed.ts";
import { Entry } from "./Entry.ts";
import { AcquisitionFeedLink } from "./AcquisitionFeedLink.ts";
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
import { Database } from "bun:sqlite";
import type { SQLQueryBindings } from "bun:sqlite";
import * as FS from "node:fs";
import { SQL } from "bun";

/**
 * Calibre Library Model
 */
export class CalibreLibrary {
  private readonly pageSize: number = 20;
  private readonly databaseUrl: string;
  constructor(private readonly calibreLibraryDir: string) {
    if (!this.calibreLibraryDir) {
      throw new Error("Calibre library directory is required");
    }

    if (!FS.existsSync(Path.resolve(this.calibreLibraryDir))) {
      throw new Error(
        `Calibre library directory ${this.calibreLibraryDir} does not exist`,
      );
    }

    this.databaseUrl = Path.resolve(this.calibreLibraryDir, "metadata.db");
  }
  private getSql() {
    return new SQL({
      adapter: "sqlite",
      filename: this.databaseUrl,
      readonly: true,
      onconnect: (err) => {
        if (err) {
          console.error(`Error connecting to database: ${err}`);
        } else {
          console.log(`Connected to database at ${this.databaseUrl}`);
        }
      },
      onclose: (err) => {
        if (err) {
          console.error(`Error disconnecting from database: ${err}`);
        } else {
          console.log(`Disconnected from database at ${this.databaseUrl}`);
        }
      },
    });
  }

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

  private getCatalogFeed(
    options: {
      id: string;
      title: string;
      updatedAt: string;
      baseUrl: string;
      entries: Entry[];
    },
    param: Pagination,
  ): Feed {
    const feed = new Feed(options.id, options.title, options.updatedAt);

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
    const sql = this.getSql();

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
    const sql = this.getSql();
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
        updatedAt,
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

  private getBooksAcquisitionFeed(
    options: {
      id: string;
      title: string;
      updatedAt: string;
      baseUrl: string;
      books: Book[];
      bookFormats: BookFormat[];
    },
    param: Pagination,
  ): Feed {
    const feed = new Feed(options.id, options.title, options.updatedAt);

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

    if (options.books.length > this.pageSize) {
      feed.addLink(
        new NavigationFeedLink(
          `${baseUrlWithQuery}page=${param.page + 1}`,
        ).setRel("next"),
      );
    }

    for (const book of options.books) {
      feed.addEntry(new BookEntry(book, options.bookFormats));
    }

    return feed;
  }

  async getAuthorBooksFeed(id: number, param: Pagination): Promise<Feed> {
    const sql = this.getSql();
    const author = (
      await sql<Author[]>`SELECT id, name, sort from authors where id = ${id}`
    )[0];

    if (!author) {
      throw new Error(`Author with id ${id} not found`);
    }

    const books = await sql<
      Book[]
    >`SELECT id, title, sort, last_modified as updatedAt, path 
            FROM books
            WHERE id in (SELECT book FROM books_authors_link where author = ${id})
            ORDER BY sort
            LIMIT ${this.pageSize + 1}
            OFFSET ${this.pageSize * (param.page - 1)};`;

    const bookFormats = await sql<
      BookFormat[]
    >`SELECT book as id, LOWER(format) as format, name as fileName 
            FROM data 
            WHERE book in ${sql(books.map((book) => book.id))}`;

    const updatedAt = await this.getUpdatedAt();

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:authors:${id}`,
        title: `Calibre Library - Authors - ${author.name}`,
        updatedAt,
        baseUrl: `/opds/authors/${id}`,
        books,
        bookFormats,
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
        updatedAt,
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
    throw new Error("Method not implemented.");
  }

  async getSeriesBooksFeed(id: number, param: Pagination): Promise<Feed> {
    const series: Series = {} as any as Series;
    const books: Book[] = [];
    const bookFormats: BookFormat[] = [];
    const updatedAt = await this.getUpdatedAt();

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:series:${id}`,
        title: series.name,
        updatedAt,
        baseUrl: `/opds/series/${id}`,
        books,
        bookFormats,
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
        updatedAt,
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
    const tag: Tag = {} as any as Tag;
    const books: Book[] = [];
    const bookFormats: BookFormat[] = [];
    const updatedAt = await this.getUpdatedAt();

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:tags:${id}`,
        title: tag.name,
        updatedAt,
        baseUrl: `/opds/tags/${id}`,
        books,
        bookFormats,
      },
      param,
    );
  }

  async getBooksFeed(param: Pagination): Promise<Feed> {
    const books: Book[] = [];
    const bookFormats: BookFormat[] = [];
    const updatedAt = await this.getUpdatedAt();

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:books`,
        title: "Calibre Library - Books",
        updatedAt,
        baseUrl: `/opds/books`,
        books,
        bookFormats,
      },
      param,
    );
  }

  async getSearchBooksFeed(query: string, param: Pagination): Promise<Feed> {
    const books: Book[] = [];
    const bookFormats: BookFormat[] = [];
    const updatedAt = await this.getUpdatedAt();

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:books`,
        title: `Calibre Library - Search - ${query}`,
        updatedAt,
        baseUrl: `/opds/search?q=${query}`,
        books,
        bookFormats,
      },
      param,
    );
  }

  async getBookPath(id: number, format: string): Promise<string> {
    const book: Book = {} as any as Book;
    const bookFormat: BookFormat = {} as any as BookFormat;

    if (!bookFormat) {
      throw new Error(`Format ${format} not found for book ${id}`);
    }

    return Path.resolve(
      this.calibreLibraryDir,
      book.path,
      `${bookFormat.fileName}.${bookFormat.format}`,
    );
  }
}
