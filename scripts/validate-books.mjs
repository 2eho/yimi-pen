#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listBookIds, loadBookFromManifest } from "@yimi-pen/content";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const booksRoot = path.resolve(__dirname, "../content/books");

const ids = await listBookIds(booksRoot);
if (!ids.length) {
  console.log("No books under content/books");
  process.exit(0);
}

let failed = 0;
for (const id of ids) {
  try {
    const book = await loadBookFromManifest(path.join(booksRoot, id));
    const hs = book.pages.reduce((n, p) => n + p.hotspots.length, 0);
    console.log(`OK  ${id} — "${book.title}" pages=${book.pages.length} hotspots=${hs}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${id}:`, err instanceof Error ? err.message : err);
  }
}

process.exit(failed ? 1 : 0);
