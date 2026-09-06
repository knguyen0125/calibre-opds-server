import { Link } from "./Link.ts";
import { NavigationFeedLink } from "./NavigationFeedLink.ts";
import { Feed } from "./Feed.ts";
import { Entry } from "./Entry.ts";
import {
  type Pagination,
  type BookSource,
  type CatalogSource,
} from "./types.ts";
import { PAGE_SIZE } from "./constants.ts";
import { sql } from "bun";
import { Author } from "./Author.ts";
import { Series } from "./Series.ts";
import { Tag } from "./Tag.ts";
import { AllBooks } from "./AllBooks.ts";
import { NewestBooks } from "./NewestBooks.ts";
import { SearchBooks } from "./SearchBooks.ts";

/**
 * Calibre Library Model
 */
export class CalibreLibrary {
  public async getRootFeed(): Promise<Feed> {
    const updatedAt = await this.getUpdatedAt();

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
      new Entry("urn:calibre:catalogs:newest", "By Newest", updatedAt).addLink(
        new NavigationFeedLink("/opds/newest"),
      ),
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
    source: CatalogSource,
    param: Pagination,
  ): Promise<Feed> {
    const updatedAt = await this.getUpdatedAt();
    const feed = new Feed(source.feedId, source.feedTitle, updatedAt);

    const entries = await source.getCatalogEntries(param.page);

    const baseUrl = source.feedBaseUrl.includes("?")
      ? `${source.feedBaseUrl}&`
      : `${source.feedBaseUrl}?`;

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

    if (entries.length > PAGE_SIZE) {
      feed.addLink(
        new NavigationFeedLink(`${baseUrl}page=${param.page + 1}`).setRel(
          "next",
        ),
      );
    }

    for (const entry of entries.slice(0, PAGE_SIZE)) {
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
    return this.getCatalogFeed(Author, param);
  }

  private async getBooksAcquisitionFeed(
    options: {
      id: string;
      title: string;
      baseUrl: string;
      source: BookSource;
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

    const books = await options.source.getBooks(param.page);

    if (books.length > PAGE_SIZE) {
      feed.addLink(
        new NavigationFeedLink(
          `${baseUrlWithQuery}page=${param.page + 1}`,
        ).setRel("next"),
      );
    }

    for (const book of books.slice(0, PAGE_SIZE)) {
      feed.addEntry(book);
    }

    return feed;
  }

  async getAuthorBooksFeed(id: number, param: Pagination): Promise<Feed> {
    const author = await Author.fromId(id);

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:authors:${id}`,
        title: `Calibre Library - Authors - ${author.title}`,
        baseUrl: `/opds/authors/${id}`,
        source: author,
      },
      param,
    );
  }

  async getSeriesListFeed(param: Pagination): Promise<Feed> {
    return this.getCatalogFeed(Series, param);
  }

  async getSeriesBooksFeed(id: number, param: Pagination): Promise<Feed> {
    const series = await Series.fromId(id);

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:series:${id}`,
        title: series.name,
        baseUrl: `/opds/series/${id}`,
        source: series,
      },
      param,
    );
  }

  async getTagListFeed(param: Pagination): Promise<Feed> {
    return this.getCatalogFeed(Tag, param);
  }

  async getTagBooksFeed(id: number, param: Pagination): Promise<Feed> {
    const tag = await Tag.fromId(id);

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:tags:${id}`,
        title: `Calibre Library - Tags - ${tag.title}`,
        baseUrl: `/opds/tags/${id}`,
        source: tag,
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
        source: new AllBooks(),
      },
      param,
    );
  }

  async getSearchBooksFeed(query: string, param: Pagination): Promise<Feed> {
    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:books`,
        title: `Calibre Library - Search - ${query}`,
        baseUrl: `/opds/search?q=${query}`,
        source: new SearchBooks(query),
      },
      param,
    );
  }

  async getNewestBooksFeed(param: Pagination): Promise<Feed> {
    return this.getBooksAcquisitionFeed(
      {
        id: "urn:calibre:catalogs:newest",
        title: "Calibre Library - Newest",
        baseUrl: "/opds/newest",
        source: new NewestBooks(),
      },
      param,
    );
  }
}
