import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Book } from "@yimi-pen/core";
import { MANIFEST_FILENAME, type BookManifest } from "./manifest.js";
import { validateBook } from "./validate.js";

export async function loadBookFromManifest(bookDir: string): Promise<Book> {
  const file = path.join(bookDir, MANIFEST_FILENAME);
  const raw = await readFile(file, "utf8");
  const data = JSON.parse(raw) as BookManifest;
  const errors = validateBook(data);
  if (errors.length > 0) {
    throw new Error(`Invalid book manifest at ${file}:\n- ${errors.join("\n- ")}`);
  }
  return data;
}

export async function saveBookManifest(bookDir: string, book: Book): Promise<void> {
  const errors = validateBook(book);
  if (errors.length > 0) {
    throw new Error(`Cannot save invalid book:\n- ${errors.join("\n- ")}`);
  }
  await mkdir(bookDir, { recursive: true });
  const file = path.join(bookDir, MANIFEST_FILENAME);
  await writeFile(file, JSON.stringify(book, null, 2) + "\n", "utf8");
}

export async function listBookIds(booksRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(booksRoot, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
