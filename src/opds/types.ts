export type Pagination = {
  page: number;
};
export type Author = {
  id: number;
  name: string;
  sort: string;
  booksCount: number;
};

export type Format = "epub" | "pdf" | "awz3" | "mobi";

export type Book = {
  id: number;
  title: string;
  sort: string;
  updatedAt: string;
  path: string;
};

export type BookFormat = {
  id: number;
  format: Format;
  fileName: string;
};

export type Series = {
  id: number;
  name: string;
  sort: string;
  booksCount: number;
};

export type Tag = {
  id: number;
  name: string;
  booksCount: number;
};
