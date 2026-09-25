import { Entry } from "./Entry.ts";
import { Link } from "./Link.ts";
import { db as sql } from "../db.ts";
import type { DeviceTag } from "../auth.ts";
import { deviceTitleFor } from "./deviceTitle.ts";
import * as Path from "node:path";

export class Book extends Entry {
  private readonly authorNames: string[];

  constructor(
    private readonly bookId: number,
    private readonly bookPath: string,
    private readonly formats: { format: string; name: string }[],
    id: string,
    title: string,
    updated: string,
    authorNames: string[] = [],
  ) {
    super(id, title, updated);
    this.authorNames = authorNames;
  }

  get authorsDisplay(): string[] {
    return this.authorNames;
  }

  static getMimeType(format: string) {
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

  getBookPath(format: string): { path: string; mimeType: string } {
    const bookFormat = this.formats.find(
      (candidate) => candidate.format === format.toLowerCase(),
    );

    if (!bookFormat) {
      throw new Error(`Format ${format} not found for book ${this.bookId}`);
    }

    return {
      path: Path.resolve(
        process.env.CALIBRE_LIBRARY_DIR!,
        this.bookPath,
        `${bookFormat.name}.${bookFormat.format}`,
      ),
      mimeType: Book.getMimeType(bookFormat.format),
    };
  }

  getCoverPath(): { path: string } {
    return {
      path: Path.resolve(
        process.env.CALIBRE_LIBRARY_DIR!,
        this.bookPath,
        "cover.jpg",
      ),
    };
  }

  static async fromId(id: number, device?: DeviceTag | null) {
    const book = (
      await sql<
        {
          id: number;
          title: string;
          sort: string;
          path: string;
          last_modified: string;
          has_cover: boolean;
        }[]
      >`
        SELECT id, title, sort, path, strftime('%FT%TZ', last_modified) as last_modified, has_cover
        FROM books
        WHERE id = ${id};`
    )[0];

    if (!book) {
      throw new Error(`Book with id ${id} not found`);
    }

    const bookFormats = await sql<
      { book: number; format: string; name: string }[]
    >`SELECT book, lower(format) as format, name
      FROM data
      WHERE book = ${id};`;

    const authors = await sql<
      { id: number; name: string }[]
    >`SELECT authors.id, authors.name
      FROM authors
        LEFT JOIN books_authors_link on authors.id = books_authors_link.author
      WHERE books_authors_link.book = ${id}
      ORDER BY books_authors_link.id asc
      `;

    const seriesRow = device
      ? ((
          await sql<{ name: string; series_index: number }[]>`
            SELECT series.name, books.series_index
            FROM books_series_link
            JOIN series ON series.id = books_series_link.series
            JOIN books ON books.id = books_series_link.book
            WHERE books_series_link.book = ${id}
            ORDER BY books_series_link.id asc
            LIMIT 1`
        )[0] ?? null)
      : null;
    const series = seriesRow
      ? { name: seriesRow.name, index: seriesRow.series_index }
      : null;

    const comments = device
      ? []
      : await sql<{ book: number; text: string }[]>`
          SELECT book, text from comments where book = ${id}`;

    const authorNames = authors.map((author) => author.name);
    const title = device ? deviceTitleFor(series, book.title) : book.title;

    const entry = new Book(
      book.id,
      book.path,
      bookFormats,
      `urn:calibre:books:${book.id}`,
      title,
      new Date(book.last_modified).toISOString(),
      authorNames,
    );

    if (device) {
      // The X4 builds its download filename from the entry title alone,
      // so author is omitted and only the EPUB acquisition link is
      // emitted; covers and summaries are ignored by its parser.
      const epub = bookFormats.find((f) => f.format === "epub");
      if (epub) {
        entry.addLink(
          new Link(`/get/books/${book.id}/formats/epub`)
            .setType("application/epub+zip")
            .setRel("http://opds-spec.org/acquisition"),
        );
      }
      return entry;
    }
    for (const bookFormat of bookFormats) {
      entry.addLink(
        new Link(`/get/books/${book.id}/formats/${bookFormat.format}`)
          .setType(Book.getMimeType(bookFormat.format))
          .setRel("http://opds-spec.org/acquisition"),
      );
    }

    if (authors.length > 0) {
      entry.addAuthor(authors.map((author) => author.name).join(" & "));
    }

    if (comments[0]) {
      entry.setContent("html", comments[0].text);
    }

    if (book.has_cover) {
      entry.addLink(
        new Link(`/get/books/${book.id}/cover`)
          .setType("image/jpeg")
          .setRel("http://opds-spec.org/cover"),
      );
      entry.addLink(
        new Link(`/get/books/${book.id}/cover`)
          .setType("image/jpeg")
          .setRel("http://opds-spec.org/image"),
      );
      entry.addLink(
        new Link(`/get/books/${book.id}/cover`)
          .setType("image/jpeg")
          .setRel("http://opds-spec.org/image/thumbnail"),
      );
      entry.addLink(
        new Link(`/get/books/${book.id}/cover`)
          .setType("image/jpeg")
          .setRel("http://opds-spec.org/thumbnail"),
      );
    }

    return entry;
  }
}
