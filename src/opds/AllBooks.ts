import { db as sql } from "../db.ts";
import type { DeviceTag } from "../auth.ts";
import { Book } from "./Book.ts";
import { PAGE_SIZE } from "./constants.ts";
import { type BookSource } from "./types.ts";

export class AllBooks implements BookSource {
  async getBooks(page: number, device?: DeviceTag | null): Promise<Book[]> {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM books
      ORDER BY sort asc
      LIMIT ${PAGE_SIZE + 1} OFFSET ${PAGE_SIZE * (page - 1)}`;
    return Promise.all(rows.map((row) => Book.fromId(row.id, device)));
  }
}
