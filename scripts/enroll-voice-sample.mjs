#!/usr/bin/env node
/**
 * Placeholder enrollment sample via L0 TTS (no mic).
 * Real clone still needs real parental recordings later.
 *
 *   node scripts/enroll-voice-sample.mjs --profile voice-mom
 *   node scripts/enroll-voice-sample.mjs --profile voice-mom --text "自定义句"
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { synthesizeL0 } from "./tts-l0.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const VOICES = path.join(ROOT, "content/diy/voices.json");

const PROMPTS = [
  "今天天气真好，我们一起出去玩吧。",
  "小香蕉香香的，宝宝要乖乖吃饭。",
  "晚安故事开始啦，闭上眼睛做个好梦。",
  "一二三四五，上山打老虎。",
  "我爱你，这是爸爸妈妈的声音。",
];

function parseArgs(argv) {
  const o = { profile: "voice-mom", text: "", help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profile") o.profile = argv[++i] ?? o.profile;
    else if (a === "--text") o.text = argv[++i] ?? "";
    else if (a === "--help") o.help = true;
  }
  return o;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`enroll-voice-sample

  node scripts/enroll-voice-sample.mjs --profile voice-mom
`);
    process.exit(0);
  }

  const data = JSON.parse(await readFile(VOICES, "utf8"));
  const prof = (data.profiles || []).find((x) => x.id === args.profile);
  if (!prof) {
    console.error("profile not found:", args.profile);
    process.exit(1);
  }

  const n = (prof.samples || []).length;
  const text = (
    args.text ||
    PROMPTS[n % PROMPTS.length] ||
    "你好，这是益米亲情音色样本。"
  ).trim();
  const fileName = `sample-${n + 1}.mp3`;
  const abs = path.join(ROOT, "content/audio/voices", args.profile, fileName);
  await mkdir(path.dirname(abs), { recursive: true });

  const result = await synthesizeL0({ text, outPath: abs, engine: "auto" });
  const uri = path
    .relative(path.join(ROOT, "content/audio"), result.outPath)
    .replace(/\\/g, "/");

  if (!prof.samples) prof.samples = [];
  prof.samples.push({
    id: `smp-${prof.samples.length + 1}`,
    uri,
    durationMs: 3000,
    promptText: text,
    createdAt: Date.now(),
  });
  if (!prof.consentAt) prof.consentAt = Date.now();
  prof.status =
    prof.samples.length >= (prof.minSamples || 5) ? "ready" : "collecting";
  prof.updatedAt = Date.now();
  prof.notes =
    (prof.notes || "") +
    (prof.notes ? " | " : "") +
    "sample via L0 placeholder; replace with mic for real L1";

  await writeFile(VOICES, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify(
      {
        profile: prof.id,
        sample: uri,
        samples: prof.samples.length,
        status: prof.status,
        note: "Placeholder from L0 — not a real parental recording",
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
