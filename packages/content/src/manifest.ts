import type { Book } from "@yimi-pen/core";

/** On-disk JSON shape for a book package (content/books/<id>/book.json). */
export type BookManifest = Book;

export const MANIFEST_FILENAME = "book.json";
