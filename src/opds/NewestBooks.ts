import { sql } from "bun";
import { Book } from "./Book.ts";
import { PAGE_SIZE } from "./constants.ts";
import { type BookSource } from "./types.ts";

export class NewestBooks implements BookSource {
  async getBooks(page: number): Promise<Book[]> {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM books
      ORDER BY timestamp desc
      LIMIT ${PAGE_SIZE + 1} OFFSET ${PAGE_SIZE * (page - 1)}`;
    return Promise.all(rows.map((row) => Book.fromId(row.id)));
  }
}
