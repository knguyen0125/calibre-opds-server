import { Link } from "./Link.ts";
import { XML } from "bun";

/**
 * OPDS Entry Model
 */
export class Entry {
  private links: Link[] = [];
  private content: { type: "text"; value: string } = {
    type: "text",
    value: "",
  };

  constructor(
    private id: string,
    private title: string,
    private updated: string,
  ) {}

  addLink(link: Link) {
    this.links.push(link);
    return this;
  }

  setContent(type: "text", value: string) {
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
