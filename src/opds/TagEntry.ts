import { Entry } from "./Entry.ts";
import { sql } from "bun";
import { NavigationFeedLink } from "./NavigationFeedLink.ts";

export class TagEntry extends Entry {
  static async fromId(id: number) {
    const series = (
      await sql<
        { id: number; name: string }[]
      >`SELECT id, name from tags where id = ${id}`
    )[0];

    if (!series) {
      throw new Error(`Tag with id ${id} not found`);
    }

    const updatedAt = await sql<
      { updated_at: string }[]
    >`SELECT strftime('%FT%TZ', max(last_modified)) as updated_at from books`;

    const entry = new TagEntry(
      `urn:calibre:tags:${series.id}`,
      series.name,
      updatedAt[0]?.updated_at || new Date().toISOString(),
    );

    const bookCount = await sql<
      { book_count: number }[]
    >`SELECT count(*) as book_count from books_tags_link where tag = ${id}`;

    entry.setContent("text", `${bookCount[0]?.book_count || 0} books`);
    entry.addLink(new NavigationFeedLink(`/opds/tags/${id}`));

    return entry;
  }
}
