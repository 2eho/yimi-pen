import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 16_000;
const SAMPLE_COUNT = 1_920;
const FADE_SAMPLES = 160;
const PEAK = 5_000;

export const GOLDEN_ASSETS = Object.freeze([
  ["clip-013-1.wav", 359],
  ["clip-014-1.wav", 388],
  ["clip-015-1.wav", 417],
  ["clip-015-2.wav", 446],
  ["clip-016-1.wav", 475],
  ["clip-017-1.wav", 504],
  ["clip-017-2.wav", 533],
  ["clip-018-1.wav", 562],
  ["clip-018-2.wav", 591],
  ["clip-018-3.wav", 620],
]);

export function renderCanonicalToneWav(frequency) {
  const dataBytes = SAMPLE_COUNT * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);

  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const envelope = Math.min(1, index / FADE_SAMPLES, (SAMPLE_COUNT - 1 - index) / FADE_SAMPLES);
    const sample = Math.trunc(PEAK * envelope * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE));
    wav.writeInt16LE(sample, 44 + index * 2);
  }
  return wav;
}

export async function verifyGoldenAssets(assetRoot) {
  const results = [];
  for (const [name, frequency] of GOLDEN_ASSETS) {
    const expected = renderCanonicalToneWav(frequency);
    const actual = await readFile(path.join(assetRoot, name));
    results.push({ name, frequency, exact: actual.equals(expected), bytes: actual.length });
  }
  return results;
}

async function main() {
  const toolRoot = path.dirname(fileURLToPath(import.meta.url));
  const assetRoot = path.resolve(toolRoot, "../../hardware/evt0/family-alpha-v1/golden/assets");
  const write = process.argv.includes("--write");
  if (write) {
    for (const [name, frequency] of GOLDEN_ASSETS) {
      await writeFile(path.join(assetRoot, name), renderCanonicalToneWav(frequency));
    }
  }
  const results = await verifyGoldenAssets(assetRoot);
  const passed = results.every((result) => result.exact);
  console.log(`Family Alpha golden assets: ${results.filter((result) => result.exact).length}/${results.length} exact`);
  if (!passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
