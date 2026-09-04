import { Entry } from "./Entry.ts";
import type { Book, BookFormat, Format } from "./types.ts";
import { Link } from "./Link.ts";

export class BookEntry extends Entry {
  constructor(book: Book, bookFormats: BookFormat[]) {
    super(`urn:calibre:books:${book.id}`, book.title, book.updatedAt);

    bookFormats
      .filter((bookFormat) => bookFormat.id === book.id)
      .forEach((bookFormat) => {
        this.addLink(
          new Link(`/opds/books/${book.id}/formats/${bookFormat.format}`)
            .setType(BookEntry.getMimeType(bookFormat.format))
            .setRel("http://opds-spec.org/acquisition"),
        );
      });
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
