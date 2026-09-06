import { Entry } from "./Entry.ts";
import { sql } from "bun";
import { NavigationFeedLink } from "./NavigationFeedLink.ts";
import { Book } from "./Book.ts";
import { type BookSource } from "./types.ts";
import { PAGE_SIZE } from "./constants.ts";

export class Series extends Entry implements BookSource {
  constructor(
    private readonly seriesId: number,
    readonly name: string,
    id: string,
    title: string,
    updated: string,
  ) {
    super(id, title, updated);
  }

  static readonly feedId = "urn:calibre:series";
  static readonly feedTitle = "Calibre Library - Series";
  static readonly feedBaseUrl = "/opds/series";

  static async fromId(id: number) {
    const series = (
      await sql<
        { id: number; name: string; sort: string }[]
      >`SELECT id, name, sort from series where id = ${id}`
    )[0];

    if (!series) {
      throw new Error(`Series with id ${id} not found`);
    }

    const updatedAt = await sql<
      { updated_at: string }[]
    >`SELECT strftime('%FT%TZ', max(last_modified)) as updated_at from books`;

    const entry = new Series(
      series.id,
      series.name,
      `${this.feedId}:${series.id}`,
      series.sort,
      updatedAt[0]?.updated_at || new Date().toISOString(),
    );

    const bookCount = await sql<
      { book_count: number }[]
    >`SELECT count(*) as book_count from books_series_link where series = ${id}`;

    entry.setContent("text", `${bookCount[0]?.book_count || 0} books`);
    entry.addLink(new NavigationFeedLink(`${Series.feedBaseUrl}/${id}`));

    return entry;
  }

  static async getCatalogEntries(page: number): Promise<Series[]> {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM series
      ORDER BY sort asc
      LIMIT ${PAGE_SIZE + 1} OFFSET ${PAGE_SIZE * (page - 1)}`;
    return Promise.all(rows.map((row) => Series.fromId(row.id)));
  }

  async getBooks(page: number): Promise<Book[]> {
    const rows = await sql<{ id: number }[]>`
      SELECT books.id FROM books
      JOIN books_series_link l ON l.book = books.id
      WHERE l.series = ${this.seriesId}
      ORDER BY books.series_index asc
      LIMIT ${PAGE_SIZE + 1} OFFSET ${PAGE_SIZE * (page - 1)}`;
    return Promise.all(rows.map((row) => Book.fromId(row.id)));
  }
}
