import { XML } from "bun";

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
