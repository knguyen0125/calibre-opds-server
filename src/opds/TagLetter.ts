import { db as sql } from "../db.ts";
import { Tag } from "./Tag.ts";
import { firstLetter, letterTitle } from "./letters.ts";
import { PAGE_SIZE } from "./constants.ts";
import type { Entry } from "./Entry.ts";
import type { CatalogSource } from "./types.ts";

/**
 * Tags whose name starts with a given letter (diacritics folded;
 * digits/symbols share the single "other" bucket), ordered by name.
 */
export class TagLetter implements CatalogSource {
  constructor(readonly letter: string) {}

  get feedId(): string {
    return `urn:calibre:tags:letter:${this.letter}`;
  }

  get feedTitle(): string {
    return letterTitle("Calibre Library - Tags", this.letter);
  }

  get feedBaseUrl(): string {
    return `/opds/tags/letters/${this.letter}`;
  }

  async getCatalogEntries(page: number): Promise<Entry[]> {
    const rows = await sql<{ id: number; name: string }[]>`
      SELECT id, name FROM tags ORDER BY name asc`;
    const matching = rows.filter((row) => firstLetter(row.name) === this.letter);
    const slice = matching.slice(
      PAGE_SIZE * (page - 1),
      PAGE_SIZE * (page - 1) + PAGE_SIZE + 1,
    );
    return Promise.all(slice.map((row) => Tag.fromId(row.id)));
  }
}
