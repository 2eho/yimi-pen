import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  PointReadEngine,
  type DiyBindStore,
  type VoiceProfileStore,
  DEFAULT_ENROLL_PROMPTS_ZH,
} from "@yimi-pen/core";
import {
  loadBookFromManifest,
  listBookIds,
  loadDiyStore,
  saveDiyStore,
  loadVoiceStore,
  saveVoiceStore,
} from "@yimi-pen/content";
import { AudioPlayer, ConsoleAudioBackend, AudioQueue } from "@yimi-pen/audio";
import {
  MessageType,
  PenSession,
  type PenMessage,
  type TapMessage,
} from "@yimi-pen/protocol";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const BOOKS_ROOT = path.join(ROOT, "content/books");
const AUDIO_ROOT = path.join(ROOT, "content/audio");
const DIY_ROOT = path.join(ROOT, "content/diy");

const PORT = Number(process.env.PEN_SIM_PORT ?? 7788);
const DEVICE_ID = process.env.PEN_SIM_DEVICE_ID ?? "yimi-pen-001";

async function bootstrap() {
  const diy = await loadDiyStore(DIY_ROOT);
  const voices = await loadVoiceStore(DIY_ROOT);
  const engine = new PointReadEngine({
    preferOid: true,
    hitPadding: 2,
    diy,
    preferDiy: false,
  });

  const ids = await listBookIds(BOOKS_ROOT);
  for (const id of ids) {
    const book = await loadBookFromManifest(path.join(BOOKS_ROOT, id));
    engine.loadBook(book);
    console.log(`[sim] loaded book: ${book.title} (${book.id})`);
  }
  console.log(`[sim] DIY bindings: ${diy.list().length}`);
  console.log(
    `[sim] voice profiles: ${voices.list().length} (default=${voices.getDefault()?.displayName ?? "none"})`,
  );

  const player = new AudioPlayer(new ConsoleAudioBackend());
  const queue = new AudioQueue(player, (clip) => {
    if (clip.uri.startsWith("diy:tts:")) return clip.uri;
    return path.join(AUDIO_ROOT, clip.uri);
  });

  const wss = new WebSocketServer({ port: PORT });
  console.log(`[sim] Yimi Pen simulator listening on ws://127.0.0.1:${PORT}`);
  console.log(`[sim] deviceId=${DEVICE_ID}`);

  wss.on("connection", (ws: WebSocket) => {
    const transport = {
      send: (data: string) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      },
      onMessage: (handler: (data: string) => void) => {
        const listener = (raw: WebSocket.RawData) => handler(String(raw));
        ws.on("message", listener);
        return () => ws.off("message", listener);
      },
      close: () => ws.close(),
    };

    const session = new PenSession(transport);
    session.hello(DEVICE_ID, "sim-0.3.0-voice", 1);

    session.onMessage((msg: PenMessage) => {
      void handleMessage(msg, session, engine, queue);
    });

    ws.on("close", () => session.close());
  });

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    void handleCli(chunk.trim(), engine, diy, voices, queue);
  });

  printHelp();
}

async function persistDiy(diy: DiyBindStore) {
  await saveDiyStore(DIY_ROOT, diy);
  console.log(`[sim] DIY saved → content/diy/bindings.json`);
}

async function persistVoices(voices: VoiceProfileStore) {
  await saveVoiceStore(DIY_ROOT, voices);
  console.log(`[sim] voices saved → content/diy/voices.json`);
}

function voiceLabel(voices: VoiceProfileStore, id?: string): string {
  if (!id) return "系统音";
  return voices.get(id)?.displayName ?? id;
}

async function handleCli(
  line: string,
  engine: PointReadEngine,
  diy: DiyBindStore,
  voices: VoiceProfileStore,
  queue: AudioQueue,
) {
  if (!line) return;

  if (line === "help") {
    printHelp();
    return;
  }

  if (line.startsWith("mode ")) {
    const m = line.slice(5).trim() as "free" | "story" | "song" | "explore";
    if (!["free", "story", "song", "explore"].includes(m)) {
      console.log("usage: mode free|story|song|explore");
      return;
    }
    engine.setMode(m);
    console.log(`[sim] mode=${m}`);
    return;
  }

  if (line === "books") {
    for (const b of engine.listBooks()) {
      const tag = b.theme ? ` [${b.theme}]` : "";
      console.log(`- ${b.id}: ${b.title}${tag} (${b.pages.length} pages)`);
    }
    return;
  }

  // —— voices ——
  if (line === "voices" || line === "voice list") {
    const list = voices.list();
    if (!list.length) {
      console.log("(no voices — try: voice add 妈妈 mom)");
      return;
    }
    const def = voices.getDefault()?.id;
    for (const p of list) {
      const mark = p.id === def ? " *" : "";
      console.log(
        `- ${p.id}${mark}  「${p.displayName}」 role=${p.role} status=${p.status} samples=${p.samples.length}/${p.minSamples}` +
          (p.consentAt ? " consent=yes" : " consent=no"),
      );
    }
    console.log("  (* = default for DIY TTS)");
    return;
  }

  // voice add <displayName> [role]
  if (line.startsWith("voice add ")) {
    const rest = line.slice("voice add ".length).trim();
    const [name, roleRaw] = rest.split(/\s+/);
    if (!name) {
      console.log("usage: voice add <显示名> [mom|dad|grandparent|child|other]");
      return;
    }
    const role = (roleRaw as "mom" | "dad" | "grandparent" | "child" | "other") || "other";
    try {
      const p = voices.create({ displayName: name, role });
      await persistVoices(voices);
      console.log(`[sim] voice created ${p.id} 「${p.displayName}」`);
      console.log(`[sim] next: voice consent ${p.id}  then  voice sample ${p.id}`);
    } catch (err) {
      console.log(`[sim] ${err instanceof Error ? err.message : err}`);
    }
    return;
  }

  // voice consent <id>
  if (line.startsWith("voice consent ")) {
    const id = line.slice("voice consent ".length).trim();
    try {
      voices.recordConsent(id);
      await persistVoices(voices);
      console.log(`[sim] consent OK for ${id} （仅用于家庭点读朗读，非门禁）`);
    } catch (err) {
      console.log(`[sim] ${err instanceof Error ? err.message : err}`);
    }
    return;
  }

  // voice sample <id>  — stub: add fake sample path (real mic later)
  if (line.startsWith("voice sample ")) {
    const id = line.slice("voice sample ".length).trim();
    try {
      const p = voices.get(id);
      if (!p) throw new Error(`voice profile not found: ${id}`);
      if (!p.consentAt) {
        console.log(`[sim] 请先: voice consent ${id}`);
        return;
      }
      const n = p.samples.length;
      const prompt = DEFAULT_ENROLL_PROMPTS_ZH[n % DEFAULT_ENROLL_PROMPTS_ZH.length]!;
      voices.addSample(id, {
        uri: `voices/${id}/sample-${n + 1}.wav`,
        durationMs: 3000,
        promptText: prompt,
      });
      await persistVoices(voices);
      const updated = voices.get(id)!;
      console.log(`[sim] +sample #${updated.samples.length} prompt「${prompt}」`);
      console.log(`[sim] status=${updated.status} (需 ≥${updated.minSamples} 段才 ready)`);
    } catch (err) {
      console.log(`[sim] ${err instanceof Error ? err.message : err}`);
    }
    return;
  }

  // voice default <id>
  if (line.startsWith("voice default ")) {
    const id = line.slice("voice default ".length).trim();
    try {
      voices.setDefault(id);
      await persistVoices(voices);
      console.log(`[sim] default voice = ${voiceLabel(voices, id)}`);
    } catch (err) {
      console.log(`[sim] ${err instanceof Error ? err.message : err}`);
    }
    return;
  }

  // —— diy ——
  if (line === "diy" || line === "diy list") {
    const list = diy.list();
    if (!list.length) {
      console.log("(no DIY bindings — try: bind YIMI-DIY-001 香蕉 我是香蕉)");
      return;
    }
    for (const b of list) {
      const v = b.voiceProfileId ? voiceLabel(voices, b.voiceProfileId) : "系统音";
      console.log(
        `- ${b.oid}  「${b.label}」  voice=${v}  policy=${b.playPolicy}  clips=${b.clips.length}`,
      );
      for (const c of b.clips) {
        console.log(`    · ${c.transcript ?? c.uri}`);
      }
    }
    return;
  }

  // bind <oid> <label> [transcript...]   optional: end with @voice-mom
  if (line.startsWith("bind ")) {
    const rest = line.slice(5).trim();
    let voiceProfileId: string | undefined;
    let body = rest;
    const at = rest.match(/\s+@(\S+)\s*$/);
    if (at) {
      voiceProfileId = at[1];
      body = rest.slice(0, at.index).trim();
    }
    const m = body.match(/^(\S+)\s+(\S+)(?:\s+(.+))?$/);
    if (!m) {
      console.log("usage: bind <oid> <label> [transcript] [@voiceId]");
      console.log("  e.g. bind YIMI-DIY-001 香蕉 我是香香的香蕉 @voice-mom");
      return;
    }
    const [, oid, label, transcript] = m;
    if (voiceProfileId && !voices.get(voiceProfileId)) {
      console.log(`[sim] unknown voice ${voiceProfileId} — run: voices`);
      return;
    }
    if (!voiceProfileId) voiceProfileId = voices.getDefault()?.id;
    try {
      const b = diy.bind({
        oid: oid!,
        label: label!,
        transcript,
        objectTag: guessTag(label!),
        kind: "object",
        voiceProfileId,
      });
      engine.setDiyStore(diy);
      await persistDiy(diy);
      console.log(
        `[sim] bound ${b.oid} →「${b.label}」 voice=${voiceLabel(voices, b.voiceProfileId)} clips=${b.clips.length}`,
      );
      console.log(`[sim] try: tap oid:${b.oid}`);
    } catch (err) {
      console.log(`[sim] bind failed: ${err instanceof Error ? err.message : err}`);
    }
    return;
  }

  // voice set <oid> <voiceId>  — assign voice to existing binding
  if (line.startsWith("voice set ")) {
    const rest = line.slice("voice set ".length).trim();
    const [oid, vid] = rest.split(/\s+/);
    if (!oid || !vid) {
      console.log("usage: voice set <oid> <voiceId>");
      return;
    }
    if (!voices.get(vid)) {
      console.log(`[sim] unknown voice ${vid}`);
      return;
    }
    try {
      diy.setVoice(oid, vid);
      engine.setDiyStore(diy);
      await persistDiy(diy);
      console.log(`[sim] ${oid} → voice ${voiceLabel(voices, vid)}`);
    } catch (err) {
      console.log(`[sim] ${err instanceof Error ? err.message : err}`);
    }
    return;
  }

  if (line.startsWith("say ")) {
    const rest = line.slice(4).trim();
    const sp = rest.indexOf(" ");
    if (sp < 0) {
      console.log("usage: say <oid> <transcript>");
      return;
    }
    const oid = rest.slice(0, sp);
    const transcript = rest.slice(sp + 1);
    try {
      const b = diy.addTranscript(oid, transcript);
      engine.setDiyStore(diy);
      await persistDiy(diy);
      console.log(
        `[sim] +line on ${b.oid} voice=${voiceLabel(voices, b.voiceProfileId)} clips=${b.clips.length}`,
      );
    } catch (err) {
      console.log(`[sim] say failed: ${err instanceof Error ? err.message : err}`);
    }
    return;
  }

  if (line.startsWith("unbind ")) {
    const oid = line.slice(7).trim();
    if (!diy.unbind(oid)) {
      console.log(`[sim] not found: ${oid}`);
      return;
    }
    engine.setDiyStore(diy);
    await persistDiy(diy);
    console.log(`[sim] unbound ${oid}`);
    return;
  }

  if (line.startsWith("tap ")) {
    const rest = line.slice(4).trim();
    if (rest.startsWith("oid:")) {
      handleLocalTap(engine, queue, voices, { oid: rest.slice(4) });
    } else {
      const [bookId, pageId, xs, ys] = rest.split(/\s+/);
      if (!bookId || !pageId || xs === undefined || ys === undefined) {
        console.log("usage: tap oid:<code> | tap <bookId> <pageId> <x> <y>");
        return;
      }
      handleLocalTap(engine, queue, voices, {
        bookId,
        pageId,
        point: { x: Number(xs), y: Number(ys) },
      });
    }
    return;
  }

  console.log("unknown command; type help");
}

function guessTag(label: string): string | undefined {
  if (/蕉|果|苹|橙|梨|桃/.test(label)) return "fruit";
  if (/车|球|娃娃|熊/.test(label)) return "toy";
  if (/杯|碗|勺/.test(label)) return "kitchen";
  return undefined;
}

function printHelp() {
  console.log(`
Yimi Pen · DIY + 亲情音色
Commands:
  books | diy
  voices
  voice add <名> [mom|dad|...]
  voice consent <voiceId>
  voice sample <voiceId>     # 录入样本 stub（真麦克风后接）
  voice default <voiceId>
  voice set <oid> <voiceId>  # 贴纸用谁的声音念
  bind <oid> <label> [台词] [@voiceId]
  say <oid> <台词>
  unbind <oid>
  tap oid:<oid>
  help

亲情音色 demo:
  voices
  voice set YIMI-DIY-BANANA voice-mom
  tap oid:YIMI-DIY-BANANA
  bind YIMI-DIY-002 小熊 晚安，做个好梦 @voice-mom
  tap oid:YIMI-DIY-002
`);
}

function parseVoiceFromUri(uri: string): string | undefined {
  const q = uri.indexOf("?voice=");
  if (q < 0) return undefined;
  return decodeURIComponent(uri.slice(q + 7));
}

function handleLocalTap(
  engine: PointReadEngine,
  queue: AudioQueue,
  voices: VoiceProfileStore,
  partial: {
    oid?: string;
    bookId?: string;
    pageId?: string;
    point?: { x: number; y: number };
  },
) {
  const result = engine.resolve({
    ts: Date.now(),
    deviceId: DEVICE_ID,
    ...partial,
  });
  if (!result.hit) {
    console.log(`[sim] miss: ${result.reason ?? "unknown"}`);
    return;
  }
  if (result.cooledDown) {
    console.log(`[sim] cooldown hotspot=${result.hotspot?.id}`);
    return;
  }
  if (!result.clips[0]) {
    console.log(`[sim] hit but no clips`);
    return;
  }
  const hs = result.hotspot!;
  const src = result.diy ? "DIY" : "book";
  for (const c of result.clips) {
    const vid = c.voiceProfileId ?? parseVoiceFromUri(c.uri);
    const who = result.diy ? voiceLabel(voices, vid ?? undefined) : "书本音";
    if (c.transcript) {
      console.log(`[sim] 📢 [${src}/${who}] ${hs.label ?? hs.id}: 「${c.transcript}」`);
    }
  }
  console.log(
    `[sim] hit src=${src} kind=${hs.kind ?? "-"} label=${hs.label ?? "-"} policy=${result.playPolicy}`,
  );
  queue.applyPolicy(result.playPolicy, result.clips);
}

async function handleMessage(
  msg: PenMessage,
  session: PenSession,
  engine: PointReadEngine,
  queue: AudioQueue,
) {
  if (msg.type === MessageType.Tap) {
    const tap = msg as TapMessage;
    const result = engine.resolve({
      ts: tap.ts,
      deviceId: tap.deviceId,
      bookId: tap.bookId,
      pageId: tap.pageId,
      oid: tap.oid,
      point:
        tap.x !== undefined && tap.y !== undefined ? { x: tap.x, y: tap.y } : undefined,
    });

    session.send({ type: MessageType.Ack, refId: tap.id, ok: result.hit });

    if (result.hit && result.clips[0] && result.hotspot) {
      for (const clip of result.clips) {
        const uri = clip.uri.startsWith("diy:tts:")
          ? clip.uri
          : path.join(AUDIO_ROOT, clip.uri);
        session.send({
          type: MessageType.Play,
          id: `play-${tap.id}-${clip.id}`,
          clipId: clip.id,
          uri,
          hotspotId: result.hotspot.id,
        });
      }
      queue.applyPolicy(result.playPolicy, result.clips);
    } else {
      session.send({
        type: MessageType.Error,
        code: result.reason ?? "MISS",
        message: result.cooledDown ? "Cooldown" : "No hotspot matched",
        refId: tap.id,
      });
    }
  }
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
