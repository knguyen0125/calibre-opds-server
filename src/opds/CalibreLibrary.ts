import { Link } from "./Link.ts";
import { NavigationFeedLink } from "./NavigationFeedLink.ts";
import { Feed } from "./Feed.ts";
import { Entry } from "./Entry.ts";
import { AcquisitionFeedLink } from "./AcquisitionFeedLink.ts";
import type { Author, Book, Pagination, Series, Tag } from "./types.ts";
import { BookEntry } from "./BookEntry.ts";
import * as Path from "node:path";

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

  getAuthorListFeed(param: Pagination): Feed {
    // TODO: Replace with Author from database
    // This should overfetch (pageSize + 1) as a way to check for next page
    const authors: Author[] = [];
    // TODO: Replace with updated at from database
    const updatedAt = new Date().toISOString();

    return this.getCatalogFeed(
      {
        id: "urn:calibre:navigation-catalog:authors",
        title: "Calibre Library - Authors",
        updatedAt,
        baseUrl: "/opds/authors",
        entries: authors.map((author) =>
          new Entry(
            `urn:calibre:authors:${author.id}`,
            author.name,
            updatedAt,
          ).setContent("text", `${author.booksCount} books`),
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
      feed.addEntry(new BookEntry(book));
    }

    return feed;
  }

  getAuthorBooksFeed(id: number, param: Pagination): Feed {
    // TODO: Fetch author
    const author: Author = {} as any as Author;
    // TODO: Replace with actual book query
    const books: Book[] = [];
    const updatedAt = new Date().toISOString();

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:authors:${id}`,
        title: author.name,
        updatedAt,
        baseUrl: `/opds/authors/${id}`,
        books,
      },
      param,
    );
  }

  getSeriesListFeed(param: Pagination): Feed {
    // TODO: Replace with Author from database
    // This should overfetch (pageSize + 1) as a way to check for next page
    const seriesList: Series[] = [];
    // TODO: Replace with updated at from database
    const updatedAt = new Date().toISOString();

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

  getSeriesBooksFeed(id: number, param: Pagination): Feed {
    const series: Series = {} as any as Series;
    const books: Book[] = [];
    const updatedAt = new Date().toISOString();

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:series:${id}`,
        title: series.name,
        updatedAt,
        baseUrl: `/opds/series/${id}`,
        books,
      },
      param,
    );
  }

  getTagListFeed(param: Pagination): Feed {
    // TODO: Replace with Author from database
    // This should overfetch (pageSize + 1) as a way to check for next page
    const tags: Tag[] = [];
    // TODO: Replace with updated at from database
    const updatedAt = new Date().toISOString();

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

  getTagBooksFeed(id: number, param: Pagination): Feed {
    const tag: Tag = {} as any as Tag;
    const books: Book[] = [];
    const updatedAt = new Date().toISOString();

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:tags:${id}`,
        title: tag.name,
        updatedAt,
        baseUrl: `/opds/tags/${id}`,
        books,
      },
      param,
    );
  }

  getBooksFeed(param: Pagination): Feed {
    const books: Book[] = [];
    const updatedAt = new Date().toISOString();

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:books`,
        title: "Calibre Library - Books",
        updatedAt,
        baseUrl: `/opds/books`,
        books,
      },
      param,
    );
  }

  getSearchBooksFeed(query: string, param: Pagination): Feed {
    const books: Book[] = [];
    const updatedAt = new Date().toISOString();

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:books`,
        title: `Calibre Library - Search - ${query}`,
        updatedAt,
        baseUrl: `/opds/search?q=${query}`,
        books,
      },
      param,
    );
  }

  getBookPath(id: number, format: string): string {
    const book: Book = {} as any as Book;
    const resolvedFormat = book.formats.find((f) => f.format === format);

    if (!resolvedFormat) {
      throw new Error(`Format ${format} not found for book ${id}`);
    }

    return Path.resolve(
      this.calibreLibraryDir,
      book.folder,
      `${resolvedFormat.fileName}.${resolvedFormat.format}`,
    );
  }
}
