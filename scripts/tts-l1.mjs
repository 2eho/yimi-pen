#!/usr/bin/env node
/**
 * Yimi L1 family-voice clone CLI (optional heavy backends + mock pipeline).
 *
 *   npm run tts:l1 -- --probe
 *   npm run tts:l1 -- --backend mock --text "..." --ref sample.wav --out out.wav
 *   npm run tts:l1 -- --text "..." --profile voice-mom --out out.wav
 */
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKENDS = {
  openvoice: path.join(ROOT, "scripts/l1/backends/openvoice_infer.py"),
  cosyvoice: path.join(ROOT, "scripts/l1/backends/cosyvoice_infer.py"),
  "gpt-sovits": path.join(ROOT, "scripts/l1/backends/gptsovits_infer.py"),
  mock: path.join(ROOT, "scripts/l1/backends/mock_infer.py"),
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
    allowMock: process.env.YIMI_L1_ALLOW_MOCK === "1",
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
    else if (a === "--allow-mock") o.allowMock = true;
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
  if (!prof?.consentAt && prof?.consentAt !== 0) {
    throw new Error(`profile ${profileId} missing consentAt — run voice consent first`);
  }
}

function backendOrder(backend, allowMock) {
  if (backend === "auto") {
    const heavy = ["openvoice", "cosyvoice", "gpt-sovits"];
    return allowMock ? [...heavy, "mock"] : heavy;
  }
  return [backend];
}

/** Programmatic API for diy-speak */
export async function synthesizeL1(options) {
  const text = (options.text ?? "").trim();
  if (!text) throw new Error("text required");
  let ref = options.ref;
  const profileId = options.profileId;
  if (!ref && profileId) {
    const { abs } = await resolveRefFromProfile(profileId);
    ref = abs;
  }
  if (!ref) throw new Error("ref or profileId required");
  if (!(await fileExists(ref))) throw new Error(`ref not found: ${ref}`);

  let outPath = options.outPath;
  if (!outPath) {
    const key = crypto
      .createHash("sha256")
      .update(`l1:${profileId || ""}:${text}`)
      .digest("hex")
      .slice(0, 16);
    outPath = path.join(ROOT, "content/audio/diy/cache", `l1-${key}.wav`);
  }
  outPath = path.resolve(outPath);
  await mkdir(path.dirname(outPath), { recursive: true });

  const allowMock = options.allowMock ?? process.env.YIMI_L1_ALLOW_MOCK === "1";
  const order = backendOrder(options.backend ?? process.env.YIMI_L1_BACKEND ?? "auto", allowMock);

  for (const name of order) {
    const script = BACKENDS[name];
    if (!script) continue;
    const r = await runPython(script, [
      "--text",
      text,
      "--ref",
      ref,
      "--out",
      outPath,
    ]);
    // mock may write .wav when .mp3 requested
    const candidates = [outPath, outPath.replace(/\.mp3$/i, ".wav")];
    for (const c of candidates) {
      if (r.code === 0 && (await fileExists(c))) {
        return { outPath: c, backend: name, stdout: r.stdout.trim() };
      }
    }
  }
  throw new Error("all L1 backends failed");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Yimi L1 voice-clone CLI

  npm run tts:l1 -- --probe
  npm run tts:l1 -- --backend mock --allow-mock --text "你好" --ref sample.wav --out out.wav
  npm run tts:l1 -- --text "你好" --profile voice-mom --out out.wav --allow-mock
  npm run tts:l1 -- --backend openvoice|cosyvoice|gpt-sovits|mock|auto

  --allow-mock   include mock backend in auto (or set YIMI_L1_ALLOW_MOCK=1)
  --require-consent  check voices.json consentAt when using --profile

Env: YIMI_L1_BACKEND, YIMI_L1_PYTHON, YIMI_L1_ALLOW_MOCK, YIMI_GPTSOVITS_API

L0 fallback:
  npm run diy:speak -- --oid <oid>
`);
    process.exit(0);
  }

  if (args.probe) {
    const results = await probeAll();
    console.log(JSON.stringify({ l1: "probe", results }, null, 2));
    const real = ["openvoice", "cosyvoice", "gpt-sovits"].some(
      (k) => results[k]?.exit === 0,
    );
    const mockOk = results.mock?.exit === 0;
    if (real) console.log("\n[l1] real clone backend ready");
    else if (mockOk)
      console.log(
        "\n[l1] only mock ready — pipeline OK; install OpenVoice/CosyVoice for real clone",
      );
    else console.log("\n[l1] no backend ready");
    process.exit(real || mockOk ? 0 : 2);
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

  try {
    const result = await synthesizeL1({
      text: args.text,
      ref,
      outPath: path.resolve(args.out),
      backend: args.backend,
      allowMock: args.allowMock || args.backend === "mock",
      profileId: args.profile || undefined,
    });
    console.log(
      JSON.stringify(
        { ok: true, backend: result.backend, outPath: result.outPath },
        null,
        2,
      ),
    );
    process.exit(0);
  } catch (e) {
    console.error(`[l1] ${e instanceof Error ? e.message : e}`);
    console.error(`[l1] Fallback: npm run diy:speak -- --oid <oid>`);
    process.exit(2);
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
