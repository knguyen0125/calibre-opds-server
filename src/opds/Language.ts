import { Entry } from "./Entry.ts";
import { db as sql } from "../db.ts";
import type { DeviceTag } from "../auth.ts";
import { NavigationFeedLink } from "./NavigationFeedLink.ts";
import { Book } from "./Book.ts";
import { type BookSource } from "./types.ts";
import { PAGE_SIZE } from "./constants.ts";

/**
 * Calibre stores ISO 639-2 codes ('eng', 'vie'); display them as
 * human names when the runtime can resolve them.
 */
function languageDisplayName(code: string): string {
  try {
    // Bun's typings mark of() as possibly undefined; a valid lookup
    // always yields a string.
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export class Language extends Entry implements BookSource {
  constructor(
    private readonly languageId: number,
    id: string,
    title: string,
    updated: string,
  ) {
    super(id, title, updated);
  }

  static readonly feedId = "urn:calibre:languages";
  static readonly feedTitle = "Calibre Library - Languages";
  static readonly feedBaseUrl = "/opds/languages";

  static async fromId(id: number) {
    const language = (
      await sql<{ id: number; lang_code: string }[]>`
        SELECT id, lang_code from languages where id = ${id}`
    )[0];

    if (!language) {
      throw new Error(`Language with id ${id} not found`);
    }

    const updatedAt = await sql<
      { updated_at: string }[]
    >`SELECT strftime('%FT%TZ', max(last_modified)) as updated_at from books`;

    const entry = new Language(
      language.id,
      `${this.feedId}:${language.id}`,
      languageDisplayName(language.lang_code),
      updatedAt[0]?.updated_at || new Date().toISOString(),
    );

    const bookCount = await sql<
      { book_count: number }[]
    >`SELECT count(*) as book_count from books_languages_link where lang_code = ${id}`;

    entry.setContent("text", `${bookCount[0]?.book_count || 0} books`);
    entry.addLink(new NavigationFeedLink(`${Language.feedBaseUrl}/${id}`));

    return entry;
  }

  static async getCatalogEntries(page: number): Promise<Language[]> {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM languages
      ORDER BY lang_code asc
      LIMIT ${PAGE_SIZE + 1} OFFSET ${PAGE_SIZE * (page - 1)}`;
    return Promise.all(rows.map((row) => Language.fromId(row.id)));
  }

  async getBooks(page: number, device?: DeviceTag | null): Promise<Book[]> {
    const rows = await sql<{ id: number }[]>`
      SELECT books.id FROM books
      JOIN books_languages_link l ON l.book = books.id
      WHERE l.lang_code = ${this.languageId}
      ORDER BY books.sort asc
      LIMIT ${PAGE_SIZE + 1} OFFSET ${PAGE_SIZE * (page - 1)}`;
    return Promise.all(rows.map((row) => Book.fromId(row.id, device)));
  }
}
