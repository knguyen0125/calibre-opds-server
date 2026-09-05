import { Entry } from "./Entry.ts";
import { sql } from "bun";
import { NavigationFeedLink } from "./NavigationFeedLink.ts";

export class AuthorEntry extends Entry {
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

    const entry = new AuthorEntry(
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
}
