#!/usr/bin/env node
/**
 * Synthesize audio for DIY bindings (L1 optional → L0 fallback).
 *
 *   node scripts/diy-speak.mjs --oid YIMI-DIY-BANANA
 *   node scripts/diy-speak.mjs --oid YIMI-DIY-BANANA --engine l1 --allow-mock
 *   node scripts/diy-speak.mjs --all --engine auto
 *   node scripts/diy-speak.mjs --force   # re-synthesize even if uri is file
 */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { synthesizeL0, cacheKey } from "./tts-l0.mjs";
import { synthesizeL1 } from "./tts-l1.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIY_JSON = path.join(ROOT, "content/diy/bindings.json");
const CACHE_DIR = path.join(ROOT, "content/audio/diy/cache");

function parseArgs(argv) {
  const o = {
    oid: "",
    all: false,
    play: false,
    engine: "auto", // auto | l0 | l1
    allowMock: process.env.YIMI_L1_ALLOW_MOCK === "1",
    force: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--oid") o.oid = argv[++i] ?? "";
    else if (a === "--all") o.all = true;
    else if (a === "--play") o.play = true;
    else if (a === "--engine") o.engine = argv[++i] ?? "auto";
    else if (a === "--allow-mock") o.allowMock = true;
    else if (a === "--force") o.force = true;
    else if (a === "--help") o.help = true;
  }
  return o;
}

function playFile(file) {
  return new Promise((resolve) => {
    const ps = `
$p = ${JSON.stringify(file)}
Add-Type -AssemblyName presentationCore
$mp = New-Object System.Windows.Media.MediaPlayer
$mp.Open([uri]$p)
$mp.Volume = 1
$mp.Play()
Start-Sleep -Milliseconds 400
while ($mp.Position -lt $mp.NaturalDuration.TimeSpan) { Start-Sleep -Milliseconds 200 }
$mp.Close()
`;
    const p = spawn("powershell", ["-NoProfile", "-Command", ps], { stdio: "ignore" });
    p.on("close", () => resolve());
    p.on("error", () => resolve());
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

function isRealMediaUri(uri) {
  if (!uri) return false;
  if (uri.startsWith("diy:tts:")) return false;
  return uri.endsWith(".mp3") || uri.endsWith(".wav") || uri.includes("/");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || (!args.oid && !args.all)) {
    console.log(`diy-speak — DIY clip synthesis (L1 → L0)

  node scripts/diy-speak.mjs --oid YIMI-DIY-BANANA
  node scripts/diy-speak.mjs --oid YIMI-DIY-BANANA --engine l1 --allow-mock
  node scripts/diy-speak.mjs --all --engine l0
  node scripts/diy-speak.mjs --oid X --force --play

  --engine auto|l0|l1   auto: try L1 if voiceProfileId+samples, else L0
  --allow-mock          L1 may use mock backend (not real clone)
  --force               re-generate even when uri already points to a file
`);
    process.exit(args.help ? 0 : 1);
  }

  const raw = await readFile(DIY_JSON, "utf8");
  const data = JSON.parse(raw);
  const list = data.bindings ?? [];
  const targets = args.all ? list : list.filter((b) => b.oid === args.oid);
  if (!targets.length) {
    console.error(
      "No matching binding. Known:",
      list.map((b) => b.oid).join(", ") || "(none)",
    );
    process.exit(1);
  }

  await mkdir(CACHE_DIR, { recursive: true });
  let changed = false;

  for (const b of targets) {
    console.log(
      `[diy-speak] ${b.oid} 「${b.label}」 voice=${b.voiceProfileId ?? "-"} clips=${b.clips?.length ?? 0}`,
    );
    for (const clip of b.clips ?? []) {
      const text = (clip.transcript ?? "").trim();
      if (!text) {
        console.log(`  skip ${clip.id}: no transcript`);
        continue;
      }

      if (!args.force && isRealMediaUri(clip.uri)) {
        console.log(`  keep ${clip.id}: ${clip.uri}`);
        if (args.play) {
          await playFile(path.join(ROOT, "content/audio", clip.uri));
        }
        continue;
      }

      let outPath = null;
      let engineUsed = "l0";

      const wantL1 =
        args.engine === "l1" ||
        (args.engine === "auto" && !!b.voiceProfileId);

      if (wantL1 && args.engine !== "l0") {
        try {
          const key = cacheKey(`l1:${b.voiceProfileId}:${text}`, "l1");
          const abs = path.join(CACHE_DIR, `l1-${key}.wav`);
          const result = await synthesizeL1({
            text,
            profileId: b.voiceProfileId,
            outPath: abs,
            allowMock: args.allowMock,
            backend: args.allowMock ? "auto" : process.env.YIMI_L1_BACKEND || "auto",
          });
          outPath = result.outPath;
          engineUsed = `l1:${result.backend}`;
        } catch (err) {
          console.warn(
            `  l1 fail ${clip.id}: ${err instanceof Error ? err.message : err}`,
          );
          if (args.engine === "l1" && !args.allowMock) {
            console.warn("  (hint: --allow-mock for pipeline test, or install real backend)");
          }
        }
      }

      if (!outPath) {
        const voiceHint = b.voiceProfileId ?? "system";
        const key = cacheKey(`${voiceHint}:${text}`, "l0");
        const abs = path.join(CACHE_DIR, `${key}.mp3`);
        const result = await synthesizeL0({
          text,
          outPath: abs,
          engine: "auto",
        });
        outPath = result.outPath;
        engineUsed = `l0:${result.engine}`;
      }

      const finalRel = path
        .relative(path.join(ROOT, "content/audio"), outPath)
        .replace(/\\/g, "/");
      clip.uri = finalRel;
      if (clip.voiceProfileId === undefined && b.voiceProfileId) {
        clip.voiceProfileId = b.voiceProfileId;
      }
      changed = true;
      console.log(`  ok ${clip.id}: ${engineUsed} → ${finalRel}`);
      if (args.play) await playFile(outPath);
    }
  }

  if (changed) {
    data.bindings = list;
    await writeFile(DIY_JSON, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`[diy-speak] updated ${path.relative(ROOT, DIY_JSON)}`);
  } else {
    console.log("[diy-speak] no changes");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
