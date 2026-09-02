import { Link } from "./Link.ts";
import { XML } from "bun";

import { Entry } from "./Entry.ts";

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
