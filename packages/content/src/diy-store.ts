import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DiyBindStore, type DiyStoreData } from "@yimi-pen/core";

export const DIY_BINDINGS_FILENAME = "bindings.json";

export async function loadDiyStore(diyDir: string): Promise<DiyBindStore> {
  const file = path.join(diyDir, DIY_BINDINGS_FILENAME);
  try {
    const raw = await readFile(file, "utf8");
    const data = JSON.parse(raw) as DiyStoreData;
    return DiyBindStore.fromJSON(data);
  } catch {
    return new DiyBindStore();
  }
}

export async function saveDiyStore(diyDir: string, store: DiyBindStore): Promise<void> {
  await mkdir(diyDir, { recursive: true });
  const file = path.join(diyDir, DIY_BINDINGS_FILENAME);
  await writeFile(file, JSON.stringify(store.toJSON(), null, 2) + "\n", "utf8");
}
