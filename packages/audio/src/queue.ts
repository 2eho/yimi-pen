import type { Clip } from "@yimi-pen/core";
import type { AudioPlayer, PlayRequest } from "./player.js";

/**
 * Sequential clip queue. Kids-IP free-play interrupts; story mode can enqueue.
 */
export class AudioQueue {
  private queue: PlayRequest[] = [];
  private playing = false;

  constructor(
    private player: AudioPlayer,
    private resolveUri: (clip: Clip) => string,
  ) {
    this.player.on("end", () => void this.pump());
    this.player.on("error", () => void this.pump());
  }

  /** Replace current playback with this clip (toy free-play: new tap interrupts). */
  playNow(clip: Clip): void {
    this.playNowMany([clip]);
  }

  playNowMany(clips: Clip[]): void {
    this.queue = [];
    void this.player.stop().then(() => {
      this.playing = false;
      for (const clip of clips) {
        this.queue.push({ clip, resolvedUri: this.resolveUri(clip) });
      }
      void this.pump();
    });
  }

  enqueue(clip: Clip): void {
    this.enqueueMany([clip]);
  }

  enqueueMany(clips: Clip[]): void {
    for (const clip of clips) {
      this.queue.push({ clip, resolvedUri: this.resolveUri(clip) });
    }
    void this.pump();
  }

  /** Kids-IP: apply engine playPolicy. */
  applyPolicy(policy: "replace" | "queue" | "random_one", clips: Clip[]): void {
    if (!clips.length) return;
    if (policy === "queue") this.enqueueMany(clips);
    else this.playNowMany(clips);
  }

  clear(): void {
    this.queue = [];
    void this.player.stop();
    this.playing = false;
  }

  private async pump(): Promise<void> {
    if (this.playing) return;
    const next = this.queue.shift();
    if (!next) return;
    this.playing = true;
    try {
      await this.player.play(next);
    } finally {
      this.playing = false;
    }
  }
}
