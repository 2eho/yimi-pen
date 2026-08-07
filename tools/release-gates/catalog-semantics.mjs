import { createHash } from "node:crypto";

export async function verifyCatalogSemanticFiles({ catalog, reader }) {
  const entries = Object.entries(catalog.semanticFiles);
  for (const [relative, expected] of entries) {
    const bytes = Buffer.from(await reader(relative));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) throw new Error(`release catalog semantic file drift: ${relative}`);
  }
  return true;
}
