import { Link } from "./Link.ts";
import { XML } from "bun";

/**
 * OPDS Entry Model
 */
export class Entry {
  private links: Link[] = [];
  private content: { type: "text" | "html"; value: string } = {
    type: "text",
    value: "",
  };

  private authors: { name: string }[] = [];

  constructor(
    private id: string,
    private title: string,
    private updated: string,
  ) {}

  addLink(link: Link) {
    this.links.push(link);
    return this;
  }

  addAuthor(name: string) {
    this.authors.push({ name });
    return this;
  }

  setContent(type: "text" | "html", value: string) {
    this.content.type = type;
    this.content.value = value;
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
        ...this.authors.map((author) => ({
          name: "author",
          attributes: {},
          children: [{ name: "name", attributes: {}, children: [author.name] }],
        })),
        this.content.value
          ? {
              name: "content",
              attributes: {
                type: this.content.type,
              },
              children: [this.content.value],
            }
          : undefined,
        ...this.links.map((link) => link.asXML()),
      ].filter((n) => !!n),
    };
  }
}
