import { Entry } from "./Entry.ts";
import { sql } from "bun";
import { NavigationFeedLink } from "./NavigationFeedLink.ts";

export class SeriesEntry extends Entry {
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

    const entry = new SeriesEntry(
      `urn:calibre:series:${series.id}`,
      series.sort,
      updatedAt[0]?.updated_at || new Date().toISOString(),
    );

    const bookCount = await sql<
      { book_count: number }[]
    >`SELECT count(*) as book_count from books_series_link where series = ${id}`;

    entry.setContent("text", `${bookCount[0]?.book_count || 0} books`);
    entry.addLink(new NavigationFeedLink(`/opds/series/${id}`));

    return entry;
  }
}
