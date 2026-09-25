import { Link } from "./Link.ts";
import { NavigationFeedLink } from "./NavigationFeedLink.ts";
import { Feed } from "./Feed.ts";
import { Entry } from "./Entry.ts";
import type { DeviceTag } from "../auth.ts";
import {
  type Pagination,
  type BookSource,
  type CatalogSource,
} from "./types.ts";
import { PAGE_SIZE } from "./constants.ts";
import { db as sql } from "../db.ts";
import { Author } from "./Author.ts";
import { Language } from "./Language.ts";
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

    rootFeed.addEntry(
      new Entry(
        "urn:calibre:catalogs:languages",
        "By Languages",
        updatedAt,
      ).addLink(new NavigationFeedLink("/opds/languages")),
    );

    rootFeed.addEntry(
      new Entry(
        "urn:calibre:catalogs:reload",
        "Reload Catalog",
        updatedAt,
      ).addLink(new NavigationFeedLink("/opds/reload")),
    );

    return rootFeed;
  }

  private async getCatalogFeed(
    catalogSource: CatalogSource,
    param: Pagination,
  ): Promise<Feed> {
    const updatedAt = await this.getUpdatedAt();
    const feed = new Feed(
      catalogSource.feedId,
      catalogSource.feedTitle,
      updatedAt,
    );

    const entries = await catalogSource.getCatalogEntries(param.page);

    const baseUrl = catalogSource.feedBaseUrl.includes("?")
      ? `${catalogSource.feedBaseUrl}&`
      : `${catalogSource.feedBaseUrl}?`;

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
      bookSource: BookSource;
      device?: DeviceTag | null;
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

    const books = await options.bookSource.getBooks(param.page, options.device);

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

  async getAuthorBooksFeed(
    id: number,
    param: Pagination,
    device?: DeviceTag | null,
  ): Promise<Feed> {
    const author = await Author.fromId(id);

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:authors:${id}`,
        title: `Calibre Library - Authors - ${author.title}`,
        baseUrl: `/opds/authors/${id}`,
        bookSource: author,
        device,
      },
      param,
    );
  }

  async getSeriesListFeed(param: Pagination): Promise<Feed> {
    return this.getCatalogFeed(Series, param);
  }

  async getSeriesBooksFeed(
    id: number,
    param: Pagination,
    device?: DeviceTag | null,
  ): Promise<Feed> {
    const series = await Series.fromId(id);

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:series:${id}`,
        title: series.name,
        baseUrl: `/opds/series/${id}`,
        bookSource: series,
        device,
      },
      param,
    );
  }

  async getTagListFeed(param: Pagination): Promise<Feed> {
    return this.getCatalogFeed(Tag, param);
  }

  async getTagBooksFeed(
    id: number,
    param: Pagination,
    device?: DeviceTag | null,
  ): Promise<Feed> {
    const tag = await Tag.fromId(id);

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:tags:${id}`,
        title: `Calibre Library - Tags - ${tag.title}`,
        baseUrl: `/opds/tags/${id}`,
        bookSource: tag,
        device,
      },
      param,
    );
  }

  async getLanguageListFeed(param: Pagination): Promise<Feed> {
    return this.getCatalogFeed(Language, param);
  }

  async getLanguageBooksFeed(
    id: number,
    param: Pagination,
    device?: DeviceTag | null,
  ): Promise<Feed> {
    const language = await Language.fromId(id);

    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:languages:${id}`,
        title: `Calibre Library - Languages - ${language.title}`,
        baseUrl: `/opds/languages/${id}`,
        bookSource: language,
        device,
      },
      param,
    );
  }
  async getBooksFeed(param: Pagination, device?: DeviceTag | null): Promise<Feed> {
    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:books`,
        title: "Calibre Library - Books",
        baseUrl: `/opds/books`,
        bookSource: new AllBooks(),
        device,
      },
      param,
    );
  }

  async getSearchBooksFeed(
    query: string,
    param: Pagination,
    device?: DeviceTag | null,
  ): Promise<Feed> {
    return this.getBooksAcquisitionFeed(
      {
        id: `urn:calibre:catalogs:books`,
        title: `Calibre Library - Search - ${query}`,
        baseUrl: `/opds/search?q=${query}`,
        bookSource: new SearchBooks(query),
        device,
      },
      param,
    );
  }

  async getNewestBooksFeed(
    param: Pagination,
    device?: DeviceTag | null,
  ): Promise<Feed> {
    return this.getBooksAcquisitionFeed(
      {
        id: "urn:calibre:catalogs:newest",
        title: "Calibre Library - Newest",
        baseUrl: "/opds/newest",
        bookSource: new NewestBooks(),
        device,
      },
      param,
    );
  }
}
