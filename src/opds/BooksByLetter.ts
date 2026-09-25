import { db as sql } from "../db.ts";
import type { DeviceTag } from "../auth.ts";
import { Book } from "./Book.ts";
import { distinctSortedLetters, firstLetter, letterTitle } from "./letters.ts";
import { PAGE_SIZE } from "./constants.ts";
import { type BookSource } from "./types.ts";

/**
 * Books whose calibre title sort starts with a given letter (diacritics
 * folded; digits and symbols share the single "other" bucket), ordered
 * by title sort.
 */
export class BooksByLetter implements BookSource {
  constructor(readonly letter: string) {}

  get feedTitle(): string {
    return letterTitle("Calibre Library - Books", this.letter);
  }

  get feedBaseUrl(): string {
    return `/opds/books/letters/${this.letter}`;
  }

  static async distinctLetters(): Promise<string[]> {
    const rows = await sql<{ sort: string }[]>`SELECT sort FROM books`;
    return distinctSortedLetters(rows.map((row) => row.sort));
  }

  async getBooks(page: number, device?: DeviceTag | null): Promise<Book[]> {
    const rows = await sql<{ id: number; sort: string }[]>`
      SELECT id, sort FROM books ORDER BY sort asc`;
    const matching = rows.filter((row) => firstLetter(row.sort) === this.letter);
    const slice = matching.slice(
      PAGE_SIZE * (page - 1),
      PAGE_SIZE * (page - 1) + PAGE_SIZE + 1,
    );
    return Promise.all(slice.map((row) => Book.fromId(row.id, device)));
  }
}
