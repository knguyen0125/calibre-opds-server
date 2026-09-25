import type { DeviceTag } from "../auth.ts";
import type { Entry } from "./Entry.ts";
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
  getBooks(page: number, device?: DeviceTag | null): Promise<Book[]>;
}

/**
 * A source of entries for navigation feeds.
 *
 * Implementations return up to PAGE_SIZE + 1 entries so the caller can
 * detect a following page and slice the extra entry off.
 */
export interface CatalogSource {
  feedId: string;
  feedTitle: string;
  feedBaseUrl: string;

  getCatalogEntries(page: number): Promise<Entry[]>;
}
