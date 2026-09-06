import { Entry } from "./Entry.ts";
import { sql } from "bun";
import { NavigationFeedLink } from "./NavigationFeedLink.ts";
import { Book } from "./Book.ts";
import { type BookSource } from "./types.ts";
import { PAGE_SIZE } from "./constants.ts";

export class Tag extends Entry implements BookSource {
  constructor(
    private readonly tagId: number,
    id: string,
    title: string,
    updated: string,
  ) {
    super(id, title, updated);
  }

  static readonly feedId = "urn:calibre:tags";
  static readonly feedTitle = "Calibre Library - Tags";
  static readonly feedBaseUrl = "/opds/tags";

  static async fromId(id: number) {
    const tag = (
      await sql<
        { id: number; name: string }[]
      >`SELECT id, name from tags where id = ${id}`
    )[0];

    if (!tag) {
      throw new Error(`Tag with id ${id} not found`);
    }

    const updatedAt = await sql<
      { updated_at: string }[]
    >`SELECT strftime('%FT%TZ', max(last_modified)) as updated_at from books`;

    const entry = new Tag(
      tag.id,
      `${this.feedId}:${tag.id}`,
      tag.name,
      updatedAt[0]?.updated_at || new Date().toISOString(),
    );

    const bookCount = await sql<
      { book_count: number }[]
    >`SELECT count(*) as book_count from books_tags_link where tag = ${id}`;

    entry.setContent("text", `${bookCount[0]?.book_count || 0} books`);
    entry.addLink(new NavigationFeedLink(`${this.feedBaseUrl}/${id}`));

    return entry;
  }

  static async getCatalogEntries(page: number): Promise<Tag[]> {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM tags
      ORDER BY name asc
      LIMIT ${PAGE_SIZE + 1} OFFSET ${PAGE_SIZE * (page - 1)}`;
    return Promise.all(rows.map((row) => Tag.fromId(row.id)));
  }

  async getBooks(page: number): Promise<Book[]> {
    const rows = await sql<{ id: number }[]>`
      SELECT books.id FROM books
      JOIN books_tags_link l ON l.book = books.id
      WHERE l.tag = ${this.tagId}
      ORDER BY books.sort asc
      LIMIT ${PAGE_SIZE + 1} OFFSET ${PAGE_SIZE * (page - 1)}`;
    return Promise.all(rows.map((row) => Book.fromId(row.id)));
  }
}
