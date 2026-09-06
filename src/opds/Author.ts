import { Entry } from "./Entry.ts";
import { sql } from "bun";
import { NavigationFeedLink } from "./NavigationFeedLink.ts";
import { Book } from "./Book.ts";
import { type BookSource } from "./types.ts";
import { PAGE_SIZE } from "./constants.ts";

export class Author extends Entry implements BookSource {
  constructor(
    private readonly authorId: number,
    id: string,
    title: string,
    updated: string,
  ) {
    super(id, title, updated);
  }

  static async fromId(id: number) {
    const author = (
      await sql<
        { id: number; name: string; sort: string }[]
      >`SELECT id, name, sort from authors where id = ${id}`
    )[0];

    if (!author) {
      throw new Error(`Author with id ${id} not found`);
    }

    const updatedAt = await sql<
      { updated_at: string }[]
    >`SELECT strftime('%FT%TZ', max(last_modified)) as updated_at from books`;

    const entry = new Author(
      author.id,
      `urn:calibre:authors:${author.id}`,
      author.sort,
      updatedAt[0]?.updated_at || new Date().toISOString(),
    );

    const bookCount = await sql<
      { book_count: number }[]
    >`SELECT count(*) as book_count from books_authors_link where author = ${id}`;

    entry.setContent("text", `${bookCount[0]?.book_count || 0} books`);
    entry.addLink(new NavigationFeedLink(`/opds/authors/${id}`));

    return entry;
  }

  async getBooks(page: number): Promise<Book[]> {
    const rows = await sql<{ id: number }[]>`
      SELECT books.id FROM books
      JOIN books_authors_link l ON l.book = books.id
      WHERE l.author = ${this.authorId}
      ORDER BY books.sort asc
      LIMIT ${PAGE_SIZE + 1} OFFSET ${PAGE_SIZE * (page - 1)}`;
    return Promise.all(rows.map((row) => Book.fromId(row.id)));
  }
}
