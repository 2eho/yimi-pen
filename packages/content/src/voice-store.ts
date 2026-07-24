import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { VoiceProfileStore, type VoiceProfileStoreData } from "@yimi-pen/core";

export const VOICES_FILENAME = "voices.json";

export async function loadVoiceStore(diyDir: string): Promise<VoiceProfileStore> {
  const file = path.join(diyDir, VOICES_FILENAME);
  try {
    const raw = await readFile(file, "utf8");
    const data = JSON.parse(raw) as VoiceProfileStoreData;
    return VoiceProfileStore.fromJSON(data);
  } catch {
    return new VoiceProfileStore();
  }
}

export async function saveVoiceStore(
  diyDir: string,
  store: VoiceProfileStore,
): Promise<void> {
  await mkdir(diyDir, { recursive: true });
  const file = path.join(diyDir, VOICES_FILENAME);
  await writeFile(file, JSON.stringify(store.toJSON(), null, 2) + "\n", "utf8");
}
