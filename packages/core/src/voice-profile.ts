/**
 * Family voice profiles for DIY TTS.
 *
 * Product intent (益米):
 * - Record short samples from 爸爸/妈妈 (with consent)
 * - Later: typed transcript is spoken in that voice (voice clone / speaker-adapted TTS)
 *
 * This is NOT authentication voiceprint login.
 * It is a "亲情音色" content feature for kids hearing parents' voices.
 */

export type VoiceProfileRole = "mom" | "dad" | "grandparent" | "child" | "other";

export type VoiceProfileStatus =
  | "collecting" // still need more samples
  | "ready" // enough samples to build / use voice
  | "building" // model job in progress
  | "failed";

/** One enrollment utterance (raw recording). */
export interface VoiceSample {
  id: string;
  /** Relative path under content/audio/voices/<profileId>/ */
  uri: string;
  durationMs?: number;
  /** What was read on screen during enrollment */
  promptText?: string;
  createdAt: number;
}

/**
 * A reusable "voice identity" for TTS / clone.
 * Example: mom's voice used when banana sticker says a new AI story.
 */
export interface VoiceProfile {
  id: string;
  displayName: string;
  role: VoiceProfileRole;
  status: VoiceProfileStatus;
  samples: VoiceSample[];
  /** Min samples recommended before build (product default 3–10) */
  minSamples: number;
  /** Optional remote/local model handle after build */
  modelRef?: string;
  language?: string;
  createdAt: number;
  updatedAt: number;
  /** Explicit consent recorded at enrollment */
  consentAt?: number;
  notes?: string;
}

export interface VoiceProfileStoreData {
  version: 1;
  profiles: VoiceProfile[];
  /** Default voice for new DIY TTS lines */
  defaultProfileId?: string;
}

export interface CreateVoiceProfileInput {
  id?: string;
  displayName: string;
  role?: VoiceProfileRole;
  language?: string;
  minSamples?: number;
  notes?: string;
}

function slug(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\u4e00-\u9fff_-]/gi, "")
      .slice(0, 24) || "voice"
  );
}

/**
 * In-memory family voice registry.
 * Persist via toJSON / fromJSON → content/diy/voices.json
 */
export class VoiceProfileStore {
  private map = new Map<string, VoiceProfile>();
  private defaultProfileId?: string;

  static fromJSON(data: VoiceProfileStoreData | null | undefined): VoiceProfileStore {
    const store = new VoiceProfileStore();
    if (data?.profiles) {
      for (const p of data.profiles) {
        store.map.set(p.id, {
          ...p,
          samples: p.samples.map((s) => ({ ...s })),
        });
      }
    }
    store.defaultProfileId = data?.defaultProfileId;
    return store;
  }

  toJSON(): VoiceProfileStoreData {
    return {
      version: 1,
      defaultProfileId: this.defaultProfileId,
      profiles: this.list().map((p) => ({
        ...p,
        samples: p.samples.map((s) => ({ ...s })),
      })),
    };
  }

  list(): VoiceProfile[] {
    return [...this.map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "zh"));
  }

  get(id: string): VoiceProfile | undefined {
    return this.map.get(id);
  }

  getDefault(): VoiceProfile | undefined {
    if (this.defaultProfileId) return this.map.get(this.defaultProfileId);
    return this.list().find((p) => p.status === "ready") ?? this.list()[0];
  }

  setDefault(id: string): void {
    if (!this.map.has(id)) throw new Error(`voice profile not found: ${id}`);
    this.defaultProfileId = id;
  }

  create(input: CreateVoiceProfileInput): VoiceProfile {
    const now = Date.now();
    const id = input.id?.trim() || `voice-${slug(input.displayName)}-${String(now).slice(-4)}`;
    if (this.map.has(id)) throw new Error(`voice profile already exists: ${id}`);
    const profile: VoiceProfile = {
      id,
      displayName: input.displayName.trim(),
      role: input.role ?? "other",
      status: "collecting",
      samples: [],
      minSamples: input.minSamples ?? 5,
      language: input.language ?? "zh-CN",
      createdAt: now,
      updatedAt: now,
      notes: input.notes,
    };
    this.map.set(id, profile);
    if (!this.defaultProfileId) this.defaultProfileId = id;
    return profile;
  }

  /** Record consent before using samples for clone/TTS. */
  recordConsent(id: string, at = Date.now()): VoiceProfile {
    const p = this.require(id);
    p.consentAt = at;
    p.updatedAt = at;
    return p;
  }

  addSample(
    profileId: string,
    sample: Omit<VoiceSample, "id" | "createdAt"> & { id?: string },
  ): VoiceProfile {
    const p = this.require(profileId);
    const now = Date.now();
    p.samples.push({
      id: sample.id ?? `smp-${p.samples.length + 1}`,
      uri: sample.uri,
      durationMs: sample.durationMs,
      promptText: sample.promptText,
      createdAt: now,
    });
    p.updatedAt = now;
    if (p.samples.length >= p.minSamples && p.status === "collecting") {
      p.status = "ready";
    }
    return p;
  }

  /** Mark as ready / building / failed after offline or cloud voice-build job. */
  setStatus(id: string, status: VoiceProfileStatus, modelRef?: string): VoiceProfile {
    const p = this.require(id);
    p.status = status;
    if (modelRef !== undefined) p.modelRef = modelRef;
    p.updatedAt = Date.now();
    return p;
  }

  remove(id: string): boolean {
    const ok = this.map.delete(id);
    if (this.defaultProfileId === id) this.defaultProfileId = undefined;
    return ok;
  }

  /**
   * Resolve which voice to use for a DIY TTS line.
   * Returns profile id or undefined → system default TTS.
   */
  resolveForSpeak(preferredId?: string): VoiceProfile | undefined {
    if (preferredId) {
      const p = this.map.get(preferredId);
      if (p && (p.status === "ready" || p.status === "building")) return p;
    }
    return this.getDefault();
  }

  private require(id: string): VoiceProfile {
    const p = this.map.get(id);
    if (!p) throw new Error(`voice profile not found: ${id}`);
    return p;
  }
}

/** Enrollment phrases (read aloud while recording samples). */
export const DEFAULT_ENROLL_PROMPTS_ZH = [
  "今天天气真好，我们一起出去玩吧。",
  "小香蕉香香的，宝宝要乖乖吃饭。",
  "晚安故事开始啦，闭上眼睛做个好梦。",
  "一二三四五，上山打老虎。",
  "我爱你，这是爸爸妈妈的声音。",
];
