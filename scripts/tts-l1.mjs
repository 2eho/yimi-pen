#!/usr/bin/env node
/**
 * Yimi L1 family-voice clone CLI (optional heavy backends).
 *
 *   npm run tts:l1 -- --probe
 *   npm run tts:l1 -- --text "..." --ref path/to/sample.wav --out out.wav
 */
import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKENDS = {
  openvoice: path.join(ROOT, "scripts/l1/backends/openvoice_infer.py"),
  cosyvoice: path.join(ROOT, "scripts/l1/backends/cosyvoice_infer.py"),
  "gpt-sovits": path.join(ROOT, "scripts/l1/backends/gptsovits_infer.py"),
};

function parseArgs(argv) {
  const o = {
    probe: false,
    text: "",
    ref: "",
    out: "",
    backend: process.env.YIMI_L1_BACKEND || "auto",
    profile: "",
    requireConsent: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--probe") o.probe = true;
    else if (a === "--text") o.text = argv[++i] ?? "";
    else if (a === "--ref") o.ref = argv[++i] ?? "";
    else if (a === "--out") o.out = argv[++i] ?? "";
    else if (a === "--backend") o.backend = argv[++i] ?? "auto";
    else if (a === "--profile") o.profile = argv[++i] ?? "";
    else if (a === "--require-consent") o.requireConsent = true;
    else if (a === "--help" || a === "-h") o.help = true;
  }
  return o;
}

function runPython(script, args) {
  const py = process.env.YIMI_L1_PYTHON || "python";
  return new Promise((resolve) => {
    const p = spawn(py, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (err) => resolve({ code: 127, stdout, stderr: String(err) }));
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function probeAll() {
  const results = {};
  for (const [name, script] of Object.entries(BACKENDS)) {
    const r = await runPython(script, ["--probe"]);
    let body = r.stdout.trim();
    try {
      body = JSON.parse(r.stdout);
    } catch {
      /* keep string */
    }
    results[name] = { exit: r.code, body, stderr: r.stderr.trim() || undefined };
  }
  return results;
}

async function resolveRefFromProfile(profileId) {
  const voicesPath = path.join(ROOT, "content/diy/voices.json");
  const raw = await readFile(voicesPath, "utf8");
  const data = JSON.parse(raw);
  const prof = (data.profiles || []).find((p) => p.id === profileId);
  if (!prof) throw new Error(`voice profile not found: ${profileId}`);
  if (!prof.samples?.length) throw new Error(`profile ${profileId} has no samples`);
  const uri = prof.samples[0].uri;
  const abs = path.isAbsolute(uri) ? uri : path.join(ROOT, "content/audio", uri);
  return { abs, profile: prof };
}

async function checkConsent(profileId) {
  const voicesPath = path.join(ROOT, "content/diy/voices.json");
  const data = JSON.parse(await readFile(voicesPath, "utf8"));
  const prof = (data.profiles || []).find((p) => p.id === profileId);
  if (!prof?.consentAt) {
    throw new Error(`profile ${profileId} missing consentAt — run voice consent first`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Yimi L1 voice-clone CLI

  npm run tts:l1 -- --probe
  npm run tts:l1 -- --text "你好" --ref sample.wav --out out.wav
  npm run tts:l1 -- --text "你好" --profile voice-mom --out out.wav
  npm run tts:l1 -- --backend openvoice|cosyvoice|gpt-sovits|auto

Env: YIMI_L1_BACKEND, YIMI_L1_PYTHON, YIMI_GPTSOVITS_API, YIMI_OPENVOICE_CKPT, YIMI_COSYVOICE_MODEL

L0 fallback when L1 unavailable:
  npm run diy:speak -- --oid <oid>
`);
    process.exit(0);
  }

  if (args.probe) {
    const results = await probeAll();
    console.log(JSON.stringify({ l1: "probe", results }, null, 2));
    const any = Object.values(results).some((r) => r.exit === 0);
    console.log(
      any
        ? "\n[l1] at least one backend responded ready"
        : "\n[l1] no backend ready — install OpenVoice/CosyVoice or run GPT-SoVITS API; use L0 diy:speak for now",
    );
    process.exit(any ? 0 : 2);
  }

  let ref = args.ref;
  if (args.profile) {
    if (args.requireConsent) await checkConsent(args.profile);
    const { abs, profile } = await resolveRefFromProfile(args.profile);
    ref = abs;
    console.log(`[l1] profile=${profile.id} sample=${ref}`);
  }

  if (!args.text || !ref || !args.out) {
    console.error("need --text and (--ref or --profile) and --out  (or --probe / --help)");
    process.exit(1);
  }

  if (!(await fileExists(ref))) {
    console.error(`[l1] ref audio not found: ${ref}`);
    console.error("[l1] add samples under content/audio/voices/<id>/  or pass --ref");
    process.exit(1);
  }

  const outPath = path.resolve(args.out);
  await mkdir(path.dirname(outPath), { recursive: true });

  const order =
    args.backend === "auto"
      ? ["openvoice", "cosyvoice", "gpt-sovits"]
      : [args.backend];

  for (const name of order) {
    const script = BACKENDS[name];
    if (!script) {
      console.error(`unknown backend: ${name}`);
      process.exit(1);
    }
    console.log(`[l1] try backend=${name}`);
    const r = await runPython(script, [
      "--text",
      args.text,
      "--ref",
      ref,
      "--out",
      outPath,
    ]);
    if (r.stdout.trim()) process.stdout.write(r.stdout);
    if (r.stderr.trim()) process.stderr.write(r.stderr);
    if (r.code === 0 && (await fileExists(outPath))) {
      console.log(`[l1] ok backend=${name} out=${outPath}`);
      process.exit(0);
    }
    console.warn(`[l1] backend=${name} failed code=${r.code}`);
  }

  console.error(`[l1] all backends failed. Fallback: npm run diy:speak -- --oid <oid>`);
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
