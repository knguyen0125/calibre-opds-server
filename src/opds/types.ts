import type { Book } from "./Book.ts";

export type Pagination = {
  page: number;
};

/**
 * A source of books for acquisition feeds.
 *
 * Implementations return up to PAGE_SIZE + 1 books so the caller can
 * detect a following page and slice the extra book off.
 */
export interface BookSource {
  getBooks(page: number): Promise<Book[]>;
}
