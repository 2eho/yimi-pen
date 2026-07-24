import type { Clip } from "@yimi-pen/core";

export type PlayerState = "idle" | "playing" | "paused" | "error";

export interface PlayRequest {
  clip: Clip;
  /** Absolute or resolvable path/URL for the runtime */
  resolvedUri: string;
}

export type PlayerEventMap = {
  state: PlayerState;
  end: Clip;
  error: { clip?: Clip; message: string };
};

type Listener<K extends keyof PlayerEventMap> = (payload: PlayerEventMap[K]) => void;

/**
 * Abstract audio player. Runtimes inject a backend (Web Audio / native / sim).
 */
export class AudioPlayer {
  private state: PlayerState = "idle";
  private current: Clip | null = null;
  private listeners = new Map<keyof PlayerEventMap, Set<Listener<keyof PlayerEventMap>>>();
  private backend: AudioBackend;

  constructor(backend: AudioBackend) {
    this.backend = backend;
  }

  getState(): PlayerState {
    return this.state;
  }

  getCurrentClip(): Clip | null {
    return this.current;
  }

  on<K extends keyof PlayerEventMap>(event: K, fn: Listener<K>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn as Listener<keyof PlayerEventMap>);
    return () => this.listeners.get(event)?.delete(fn as Listener<keyof PlayerEventMap>);
  }

  async play(req: PlayRequest): Promise<void> {
    await this.stop();
    this.current = req.clip;
    this.setState("playing");
    try {
      await this.backend.play(req.resolvedUri, {
        onEnd: () => {
          const clip = this.current;
          this.current = null;
          this.setState("idle");
          if (clip) this.emit("end", clip);
        },
        onError: (message) => {
          this.setState("error");
          this.emit("error", { clip: this.current ?? undefined, message });
        },
      });
    } catch (err) {
      this.setState("error");
      this.emit("error", {
        clip: req.clip,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async pause(): Promise<void> {
    if (this.state !== "playing") return;
    await this.backend.pause();
    this.setState("paused");
  }

  async resume(): Promise<void> {
    if (this.state !== "paused") return;
    await this.backend.resume();
    this.setState("playing");
  }

  async stop(): Promise<void> {
    await this.backend.stop();
    this.current = null;
    this.setState("idle");
  }

  private setState(s: PlayerState): void {
    this.state = s;
    this.emit("state", s);
  }

  private emit<K extends keyof PlayerEventMap>(event: K, payload: PlayerEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) (fn as Listener<K>)(payload);
  }
}

export interface AudioBackend {
  play(
    uri: string,
    hooks: { onEnd: () => void; onError: (message: string) => void },
  ): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

/** Console backend for device simulator / tests. */
export class ConsoleAudioBackend implements AudioBackend {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private remainingMs = 0;
  private startedAt = 0;
  private hooks: { onEnd: () => void; onError: (message: string) => void } | null = null;

  async play(
    uri: string,
    hooks: { onEnd: () => void; onError: (message: string) => void },
  ): Promise<void> {
    await this.stop();
    this.hooks = hooks;
    this.remainingMs = 1200;
    this.startedAt = Date.now();
    this.paused = false;
    // diy:tts:* is transcript-only (no mp3) for DIY MVP
    if (uri.startsWith("diy:tts:") || uri.includes("diy:tts:")) {
      const voice =
        uri.includes("?voice=") ? uri.split("?voice=")[1] : undefined;
      console.log(
        `[audio] speak (亲情音色 TTS stub${voice ? ` voice=${decodeURIComponent(voice)}` : ""}) ${uri.split("?")[0]}`,
      );
    } else {
      console.log(`[audio] play ${uri}`);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      console.log(`[audio] end ${uri}`);
      hooks.onEnd();
    }, this.remainingMs);
  }

  async pause(): Promise<void> {
    if (!this.timer || this.paused) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.remainingMs = Math.max(0, this.remainingMs - (Date.now() - this.startedAt));
    this.paused = true;
    console.log("[audio] pause");
  }

  async resume(): Promise<void> {
    if (!this.paused || !this.hooks) return;
    this.paused = false;
    this.startedAt = Date.now();
    console.log("[audio] resume");
    this.timer = setTimeout(() => {
      this.timer = null;
      this.hooks?.onEnd();
    }, this.remainingMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.paused = false;
    this.hooks = null;
  }
}
