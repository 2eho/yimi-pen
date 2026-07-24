#!/usr/bin/env node
/**
 * Yimi L0 system-voice TTS (调研建议：Piper/系统音阶梯的可跑实现)
 *
 * Priority:
 *  1) Python edge-tts (zh-CN neural, needs network first time)
 *  2) Windows SAPI (offline, quality varies / may lack Chinese voice)
 *
 * Usage:
 *   node scripts/tts-l0.mjs --text "我是香蕉" --out content/audio/diy/cache/demo.mp3
 *   node scripts/tts-l0.mjs --text "你好" --out out.wav --engine sapi
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = { text: "", outPath: "", engine: "auto", voice: "zh-CN-XiaoxiaoNeural" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--text") out.text = argv[++i] ?? "";
    else if (a === "--out") out.outPath = argv[++i] ?? "";
    else if (a === "--engine") out.engine = argv[++i] ?? "auto";
    else if (a === "--voice") out.voice = argv[++i] ?? out.voice;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      ...opts,
    });
    let stdout = "";
    let stderr = "";
    p.stdout?.on("data", (d) => (stdout += d));
    p.stderr?.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function synthesizeEdge(text, outPath, voice) {
  // edge-tts CLI: python -m edge_tts
  await run("python", [
    "-m",
    "edge_tts",
    "--voice",
    voice,
    "--text",
    text,
    "--write-media",
    outPath,
  ]);
}

async function synthesizeSapi(text, outPath) {
  // Force .wav for SAPI
  const wavPath = outPath.replace(/\.mp3$/i, ".wav");
  const ps = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voices = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo }
  $zh = $voices | Where-Object { $_.Culture.Name -like 'zh*' } | Select-Object -First 1
  if ($zh) { $s.SelectVoice($zh.Name) }
} catch {}
$s.Rate = 0
$s.Volume = 100
$s.SetOutputToWaveFile(${JSON.stringify(wavPath)})
$s.Speak(${JSON.stringify(text)})
$s.Dispose()
`.trim();
  await run("powershell", ["-NoProfile", "-Command", ps]);
  return wavPath;
}

export function cacheKey(text, voice) {
  return crypto.createHash("sha256").update(`${voice}\n${text}`).digest("hex").slice(0, 16);
}

export async function synthesizeL0(options) {
  const text = (options.text ?? "").trim();
  if (!text) throw new Error("text is required");

  let outPath = options.outPath;
  if (!outPath) {
    const key = cacheKey(text, options.voice ?? "zh-CN-XiaoxiaoNeural");
    outPath = path.join(ROOT, "content/audio/diy/cache", `${key}.mp3`);
  }
  outPath = path.resolve(outPath);
  await mkdir(path.dirname(outPath), { recursive: true });

  if ((options.skipIfExists ?? true) && (await exists(outPath))) {
    return { outPath, engine: "cache", cached: true };
  }

  const engine = options.engine ?? "auto";
  const voice = options.voice ?? "zh-CN-XiaoxiaoNeural";

  if (engine === "edge" || engine === "auto") {
    try {
      await synthesizeEdge(text, outPath, voice);
      return { outPath, engine: "edge-tts", cached: false, voice };
    } catch (err) {
      if (engine === "edge") throw err;
      console.warn("[tts-l0] edge-tts failed, fallback SAPI:", err instanceof Error ? err.message : err);
    }
  }

  if (engine === "sapi" || engine === "auto") {
    const wav = await synthesizeSapi(text, outPath);
    return { outPath: wav, engine: "sapi", cached: false };
  }

  throw new Error("no TTS engine available");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.text) {
    console.log(`Yimi L0 TTS

  node scripts/tts-l0.mjs --text "我是香香的香蕉" --out path.mp3
  node scripts/tts-l0.mjs --text "你好" --engine sapi --out path.wav

  --voice   edge-tts voice (default zh-CN-XiaoxiaoNeural)
  --engine  auto | edge | sapi
`);
    process.exit(args.help ? 0 : 1);
  }

  const result = await synthesizeL0({
    text: args.text,
    outPath: args.outPath || undefined,
    engine: args.engine,
    voice: args.voice,
  });
  console.log(JSON.stringify(result, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
