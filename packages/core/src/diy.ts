import type { Clip, Hotspot, HotspotKind, PlayPolicy } from "./types.js";

/** User DIY sticker binding: blank OID → real-world object + clips. */
export interface DiyBinding {
  oid: string;
  /** Display name, e.g. 香蕉 */
  label: string;
  /** Optional category tag: fruit / toy / ... */
  objectTag?: string;
  kind: HotspotKind;
  playPolicy: PlayPolicy;
  clips: Clip[];
  /** Prefer this family voice when synthesizing TTS for this sticker */
  voiceProfileId?: string;
  createdAt: number;
  updatedAt: number;
  notes?: string;
}

export interface BindInput {
  oid: string;
  label: string;
  /** First line of speech / transcript (optional if clip provided) */
  transcript?: string;
  objectTag?: string;
  kind?: HotspotKind;
  playPolicy?: PlayPolicy;
  notes?: string;
  /** Family voice profile for later TTS (mom/dad/...) */
  voiceProfileId?: string;
  /** Extra clip to attach on bind */
  clip?: Clip;
}

export interface DiyStoreData {
  version: 1;
  bindings: DiyBinding[];
}

function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff_-]/gi, "")
    .slice(0, 32) || "clip";
}

/**
 * In-memory DIY registry. Persist via toJSON / loadJSON (content/diy/bindings.json).
 */
export class DiyBindStore {
  private map = new Map<string, DiyBinding>();

  static fromJSON(data: DiyStoreData | null | undefined): DiyBindStore {
    const store = new DiyBindStore();
    if (data?.bindings) {
      for (const b of data.bindings) store.map.set(b.oid, { ...b, clips: [...b.clips] });
    }
    return store;
  }

  toJSON(): DiyStoreData {
    return {
      version: 1,
      bindings: this.list().map((b) => ({
        ...b,
        clips: b.clips.map((c) => ({ ...c })),
      })),
    };
  }

  list(): DiyBinding[] {
    return [...this.map.values()].sort((a, b) => a.oid.localeCompare(b.oid));
  }

  get(oid: string): DiyBinding | undefined {
    return this.map.get(oid);
  }

  has(oid: string): boolean {
    return this.map.has(oid);
  }

  /**
   * Create or replace binding metadata; if transcript given, ensure at least one clip.
   */
  bind(input: BindInput): DiyBinding {
    const oid = input.oid.trim();
    if (!oid) throw new Error("oid is required");
    const label = input.label.trim();
    if (!label) throw new Error("label is required");

    const now = Date.now();
    const existing = this.map.get(oid);
    const clips: Clip[] = existing ? [...existing.clips] : [];

    if (input.clip) {
      clips.push(input.clip);
    } else if (input.transcript?.trim()) {
      clips.push(
        makeTranscriptClip(
          oid,
          input.transcript.trim(),
          clips.length,
          1,
          input.voiceProfileId ?? existing?.voiceProfileId,
        ),
      );
    }

    if (clips.length === 0) {
      // placeholder silent clip so tap still "hits"
      clips.push({
        id: `diy-${slug(oid)}-placeholder`,
        uri: `diy/${oid}/placeholder.txt`,
        mediaType: "voice",
        transcript: `（${label}还没有录音，用 bind 或 clip 命令添加）`,
        weight: 1,
      });
    }

    const binding: DiyBinding = {
      oid,
      label,
      objectTag: input.objectTag ?? existing?.objectTag,
      kind: input.kind ?? existing?.kind ?? "object",
      playPolicy:
        input.playPolicy ??
        existing?.playPolicy ??
        (clips.length > 1 ? "random_one" : "replace"),
      clips,
      voiceProfileId: input.voiceProfileId ?? existing?.voiceProfileId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      notes: input.notes ?? existing?.notes,
    };

    // auto bump policy when multiple lines
    if (binding.clips.length > 1 && binding.playPolicy === "replace") {
      binding.playPolicy = "random_one";
    }

    this.map.set(oid, binding);
    return binding;
  }

  /** Append a spoken line (transcript-only DIY clip). */
  addTranscript(oid: string, transcript: string, weight = 1): DiyBinding {
    const b = this.map.get(oid);
    if (!b) throw new Error(`OID not bound: ${oid}`);
    const text = transcript.trim();
    if (!text) throw new Error("transcript is required");
    b.clips.push(
      makeTranscriptClip(oid, text, b.clips.length, weight, b.voiceProfileId),
    );
    if (b.clips.length > 1) b.playPolicy = "random_one";
    b.updatedAt = Date.now();
    return b;
  }

  /** Assign / change family voice for this sticker (used by TTS later). */
  setVoice(oid: string, voiceProfileId: string | undefined): DiyBinding {
    const b = this.map.get(oid);
    if (!b) throw new Error(`OID not bound: ${oid}`);
    b.voiceProfileId = voiceProfileId;
    b.updatedAt = Date.now();
    return b;
  }

  /** Append a fully specified clip (e.g. recorded file under content/audio). */
  addClip(oid: string, clip: Clip): DiyBinding {
    const b = this.map.get(oid);
    if (!b) throw new Error(`OID not bound: ${oid}`);
    b.clips.push(clip);
    if (b.clips.length > 1 && b.playPolicy === "replace") b.playPolicy = "random_one";
    b.updatedAt = Date.now();
    return b;
  }

  unbind(oid: string): boolean {
    return this.map.delete(oid);
  }

  clear(): void {
    this.map.clear();
  }

  /** Virtual hotspot so the engine can reuse the same resolve path. */
  toHotspot(binding: DiyBinding): Hotspot {
    return {
      id: `diy-hs-${binding.oid}`,
      pageId: "diy-world",
      oid: binding.oid,
      label: binding.label,
      kind: binding.kind,
      playPolicy: binding.playPolicy,
      tags: ["diy", binding.objectTag].filter(Boolean) as string[],
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      clips: binding.clips,
    };
  }
}

function makeTranscriptClip(
  oid: string,
  transcript: string,
  index: number,
  weight = 1,
  voiceProfileId?: string,
): Clip {
  const id = `diy-${slug(oid)}-${index + 1}`;
  // URI encodes optional voice: diy:tts:<id> or diy:tts:<id>?voice=<profileId>
  const uri = voiceProfileId
    ? `diy:tts:${id}?voice=${encodeURIComponent(voiceProfileId)}`
    : `diy:tts:${id}`;
  return {
    id,
    uri,
    mediaType: "voice",
    transcript,
    weight,
    language: "zh-CN",
    voiceProfileId,
  };
}
