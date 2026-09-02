import { Entry } from "./Entry.ts";
import type { Book, Format } from "./types.ts";
import { Link } from "./Link.ts";

export class BookEntry extends Entry {
  constructor(book: Book) {
    super(`urn:calibre:books:${book.id}`, book.title, book.updatedAt);

    for (const format of book.formats) {
      this.addLink(
        new Link(`/opds/books/${book.id}/formats/${format}`)
          .setType(BookEntry.getMimeType(format))
          .setRel("http://opds-spec.org/acquisition"),
      );
    }
  }

  static getMimeType(format: Format) {
    switch (format) {
      case "epub":
        return "application/epub+zip";
      case "pdf":
        return "application/pdf";
      case "mobi":
        return "application/x-mobipocket-ebook";
      case "awz3":
        return "application/vnd.amazon.ebook";
      default:
        return "application/octet-stream";
    }
  }
}
