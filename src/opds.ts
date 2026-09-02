import { XML } from "bun";

type Pagination = {
  page: number;
};

/**
 * Calibre Library Model
 */
export class Library {
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
      new Entry("urn:calibre:authors", "By Authors", updatedAt).addLink(
        new NavigationFeedLink("/opds/authors"),
      ),
    );

    rootFeed.addEntry(
      new Entry("urn:calibre:series", "By Series", updatedAt).addLink(
        new NavigationFeedLink("/opds/series"),
      ),
    );

    rootFeed.addEntry(
      new Entry("urn:calibre:tags", "By Tags", updatedAt).addLink(
        new NavigationFeedLink("/opds/tags"),
      ),
    );

    rootFeed.addEntry(
      new Entry(
        "urn:calibre:books",
        "By Books (Alphabetical)",
        updatedAt,
      ).addLink(new NavigationFeedLink("/opds/books")),
    );

    return rootFeed;
  }

  getAuthorListFeed(param: Pagination): Feed {
    throw new Error("Method not implemented.");
  }

  getAuthorBooksFeed(id: number, param: Pagination): Feed {
    throw new Error("Method not implemented.");
  }

  getSeriesListFeed(param: Pagination): Feed {
    throw new Error("Method not implemented.");
  }

  getSeriesBooksFeed(id: number, param: Pagination): Feed {
    throw new Error("Method not implemented.");
  }

  getTagListFeed(param: Pagination): Feed {
    throw new Error("Method not implemented.");
  }

  getTagBooksFeed(id: number, param: Pagination): Feed {
    throw new Error("Method not implemented.");
  }

  getBooksFeed(param: Pagination): Feed {
    throw new Error("Method not implemented.");
  }

  getSearchBooksFeed(query: string, param: Pagination): Feed {
    throw new Error("Method not implemented.");
  }

  getBookPath(id: number, format: string): string {
    throw new Error("Method not implemented.");
  }
}

/**
 * OPDS Entry Model
 */
export class Entry {
  private links: Link[] = [];

  constructor(
    private id: string,
    private title: string,
    private updated: string,
  ) {}

  addLink(link: Link) {
    this.links.push(link);
    return this;
  }

  asXML(): XML.Node {
    return {
      name: "entry",
      attributes: {},
      children: [
        {
          name: "id",
          attributes: {},
          children: [this.id],
        },
        {
          name: "title",
          attributes: {},
          children: [this.title],
        },
        {
          name: "updated",
          attributes: {},
          children: [this.updated],
        },
        ...this.links.map((link) => link.asXML()),
      ],
    };
  }
}

export class Link {
  protected type: string = "";
  protected title: string = "";
  protected rel: string = "";

  constructor(protected href: string) {}

  setTitle(title: string) {
    this.title = title;
    return this;
  }

  setHref(href: string) {
    this.href = href;
    return this;
  }

  setRel(rel: string) {
    this.rel = rel;
    return this;
  }

  setType(type: string) {
    this.type = type;
    return this;
  }

  asXML(): XML.Node {
    return {
      name: "link",
      attributes: {
        type: this.type,
        title: this.title,
        rel: this.rel,
        href: this.href,
      },
      children: [],
    };
  }
}

export class NavigationFeedLink extends Link {
  protected override type: string =
    "application/atom+xml;profile=opds-catalog;kind=navigation";
}

export class AcquisitionFeedLink extends Link {
  protected override type: string =
    "application/atom+xml;profile=opds-catalog;kind=acquisition";
}

/**
 * OPDS Feed Model
 */
export class Feed {
  private links: Link[] = [];

  private entries: Entry[] = [];

  constructor(
    protected id: string,
    protected title: string,
    protected updated: string,
  ) {}

  setId(id: string) {
    this.id = id;
    return this;
  }

  setTitle(title: string) {
    this.title = title;
    return this;
  }

  setUpdated(updated: string) {
    this.updated = updated;
    return this;
  }

  addEntry(entry: Entry) {
    this.entries.push(entry);
    return this;
  }

  addLink(link: Link) {
    this.links.push(link);
    return this;
  }

  asXML(): XML.Node {
    return {
      name: "feed",
      attributes: {
        xmlns: "http://www.w3.org/2005/Atom",
        "xmlns:opds": "http://opds-spec.org/2010/catalog",
        "xmlns:dc": "http://purl.org/dc/terms/",
      },
      children: [
        {
          name: "id",
          attributes: {},
          children: [this.id],
        },
        {
          name: "title",
          attributes: {},
          children: [this.title],
        },
        {
          name: "updated",
          attributes: {},
          children: [this.updated],
        },
        ...this.links.map((link) => link.asXML()),
        ...this.entries.map((entry) => entry.asXML()),
      ],
    };
  }

  toXML(): string {
    return `<?xml version="1.0" encoding="utf-8"?>${XML.stringify(this.asXML())}`;
  }
}
