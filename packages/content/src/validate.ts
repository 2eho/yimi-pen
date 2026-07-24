import type { Book } from "@yimi-pen/core";

export function validateBook(book: Book): string[] {
  const errors: string[] = [];
  if (!book?.id) errors.push("book.id is required");
  if (!book?.title) errors.push("book.title is required");
  if (!book?.version) errors.push("book.version is required");
  if (!Array.isArray(book?.pages)) {
    errors.push("book.pages must be an array");
    return errors;
  }

  const pageIds = new Set<string>();
  for (const page of book.pages) {
    if (!page.id) errors.push("page.id is required");
    if (pageIds.has(page.id)) errors.push(`duplicate page.id: ${page.id}`);
    pageIds.add(page.id);
    if (page.bookId !== book.id) {
      errors.push(`page ${page.id}: bookId mismatch`);
    }
    if (!Array.isArray(page.hotspots)) {
      errors.push(`page ${page.id}: hotspots must be an array`);
      continue;
    }
    for (const hs of page.hotspots) {
      if (!hs.id) errors.push(`page ${page.id}: hotspot.id required`);
      if (hs.pageId !== page.id) {
        errors.push(`hotspot ${hs.id}: pageId mismatch`);
      }
      if (!hs.bounds) {
        errors.push(`hotspot ${hs.id}: bounds required`);
      } else {
        const { width, height } = hs.bounds;
        if (width <= 0 || height <= 0) {
          errors.push(`hotspot ${hs.id}: bounds size must be positive`);
        }
      }
      if (!Array.isArray(hs.clips) || hs.clips.length === 0) {
        errors.push(`hotspot ${hs.id}: at least one clip required`);
      }
    }
  }
  return errors;
}
