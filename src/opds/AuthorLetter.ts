import { Entry } from "./Entry.ts";
import { db as sql } from "../db.ts";
import { Author } from "./Author.ts";
import { firstLetter, letterLabel, letterTitle } from "./letters.ts";
import { PAGE_SIZE } from "./constants.ts";
import type { CatalogSource } from "./types.ts";

/**
 * Authors whose display name starts with a given letter, ordered by
 * display name. The letter comes from the name as shown (not
 * authors.sort), matching how readers look people up.
 */
export class AuthorLetter implements CatalogSource {
  constructor(readonly letter: string) {}

  get feedId(): string {
    return `urn:calibre:authors:letter:${this.letter}`;
  }

  get feedTitle(): string {
    return letterTitle("Calibre Library - Authors", this.letter);
  }

  get feedBaseUrl(): string {
    return `/opds/authors/letters/${this.letter}`;
  }

  async getCatalogEntries(page: number): Promise<Entry[]> {
    const rows = await sql<{ id: number; name: string }[]>`
      SELECT id, name FROM authors ORDER BY name asc`;
    const matching = rows.filter((row) => firstLetter(row.name) === this.letter);
    const slice = matching.slice(
      PAGE_SIZE * (page - 1),
      PAGE_SIZE * (page - 1) + PAGE_SIZE + 1,
    );
    return Promise.all(slice.map((row) => Author.fromId(row.id)));
  }
}

