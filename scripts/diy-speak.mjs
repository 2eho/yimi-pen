#!/usr/bin/env node
/**
 * Synthesize L0 audio for a DIY binding's transcript clips and rewrite URIs to files.
 *
 *   node scripts/diy-speak.mjs --oid YIMI-DIY-BANANA
 *   node scripts/diy-speak.mjs --all
 *   node scripts/diy-speak.mjs --oid YIMI-DIY-BANANA --play
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { synthesizeL0, cacheKey } from "./tts-l0.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIY_JSON = path.join(ROOT, "content/diy/bindings.json");
const CACHE_DIR = path.join(ROOT, "content/audio/diy/cache");

function parseArgs(argv) {
  const o = { oid: "", all: false, play: false, engine: "auto" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--oid") o.oid = argv[++i] ?? "";
    else if (a === "--all") o.all = true;
    else if (a === "--play") o.play = true;
    else if (a === "--engine") o.engine = argv[++i] ?? "auto";
    else if (a === "--help") o.help = true;
  }
  return o;
}

function playFile(file) {
  return new Promise((resolve) => {
    // Windows: powershell MediaPlayer or start
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

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || (!args.oid && !args.all)) {
    console.log(`diy-speak — L0 TTS for DIY bindings

  node scripts/diy-speak.mjs --oid YIMI-DIY-BANANA
  node scripts/diy-speak.mjs --all
  node scripts/diy-speak.mjs --oid YIMI-DIY-BANANA --play
`);
    process.exit(args.help ? 0 : 1);
  }

  const raw = await readFile(DIY_JSON, "utf8");
  const data = JSON.parse(raw);
  const list = data.bindings ?? [];
  const targets = args.all ? list : list.filter((b) => b.oid === args.oid);
  if (!targets.length) {
    console.error("No matching binding. Known:", list.map((b) => b.oid).join(", ") || "(none)");
    process.exit(1);
  }

  await mkdir(CACHE_DIR, { recursive: true });
  let changed = false;

  for (const b of targets) {
    console.log(`[diy-speak] ${b.oid} 「${b.label}」 clips=${b.clips?.length ?? 0}`);
    for (const clip of b.clips ?? []) {
      const text = (clip.transcript ?? "").trim();
      if (!text) {
        console.log(`  skip ${clip.id}: no transcript`);
        continue;
      }
      // already a real file under diy/
      if (clip.uri && !clip.uri.startsWith("diy:tts:") && !clip.uri.startsWith("diy:")) {
        console.log(`  keep ${clip.id}: ${clip.uri}`);
        if (args.play) {
          const abs = path.join(ROOT, "content/audio", clip.uri);
          await playFile(abs);
        }
        continue;
      }

      const voiceHint = b.voiceProfileId ?? "system";
      const key = cacheKey(`${voiceHint}:${text}`, "l0");
      const rel = path.join("diy/cache", `${key}.mp3`).replace(/\\/g, "/");
      const abs = path.join(ROOT, "content/audio", rel);

      const result = await synthesizeL0({
        text,
        outPath: abs,
        engine: args.engine,
      });
      const finalRel = path
        .relative(path.join(ROOT, "content/audio"), result.outPath)
        .replace(/\\/g, "/");
      clip.uri = finalRel;
      if (clip.voiceProfileId === undefined && b.voiceProfileId) {
        clip.voiceProfileId = b.voiceProfileId;
      }
      changed = true;
      console.log(
        `  ok ${clip.id}: engine=${result.engine} cached=${!!result.cached} → ${finalRel}`,
      );
      if (args.play) await playFile(result.outPath);
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
