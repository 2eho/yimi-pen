import type { Book, Clip, Hotspot, PlayMode, Point, Rect } from "./types.js";
import type { DiyBindStore } from "./diy.js";

export interface TapEvent {
  /** Device timestamp (ms) */
  ts: number;
  bookId?: string;
  pageId?: string;
  /** Page-space coordinates when OID is not used */
  point?: Point;
  /** Infrared / OID code from pen tip */
  oid?: string;
  deviceId?: string;
}

export interface TapResult {
  hit: boolean;
  hotspot?: Hotspot;
  /** Clips selected for this tap (after random / policy) */
  clips: Clip[];
  /** How the audio layer should schedule them */
  playPolicy: "replace" | "queue" | "random_one";
  reason?: string;
  cooledDown?: boolean;
  /** True when hit came from DIY sticker store */
  diy?: boolean;
}

export interface EngineOptions {
  /** Prefer OID match over coordinate hit-test */
  preferOid?: boolean;
  /** Max distance for point-in-bounds fallback (page units) */
  hitPadding?: number;
  /** Active play mode — affects default policy */
  mode?: PlayMode;
  /**
   * DIY OID resolution: book hotspots first, then DIY bindings.
   * Prefer book when same OID exists in both (unless preferDiy).
   */
  diy?: DiyBindStore | null;
  /** If true, DIY bindings override book OID */
  preferDiy?: boolean;
}

function pointInRect(p: Point, r: Rect, pad = 0): boolean {
  return (
    p.x >= r.x - pad &&
    p.x <= r.x + r.width + pad &&
    p.y >= r.y - pad &&
    p.y <= r.y + r.height + pad
  );
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pickWeighted(clips: Clip[]): Clip {
  if (clips.length === 1) return clips[0]!;
  const total = clips.reduce((s, c) => s + (c.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const c of clips) {
    r -= c.weight ?? 1;
    if (r <= 0) return c;
  }
  return clips[clips.length - 1]!;
}

/**
 * Kids-IP + DIY sticker point-read engine.
 */
export class PointReadEngine {
  private books = new Map<string, Book>();
  private options: {
    preferOid: boolean;
    hitPadding: number;
    mode: PlayMode;
    diy: DiyBindStore | null;
    preferDiy: boolean;
  };
  private lastTapAt = new Map<string, number>();

  constructor(options: EngineOptions = {}) {
    this.options = {
      preferOid: options.preferOid ?? true,
      hitPadding: options.hitPadding ?? 0,
      mode: options.mode ?? "free",
      diy: options.diy ?? null,
      preferDiy: options.preferDiy ?? false,
    };
  }

  setDiyStore(store: DiyBindStore | null): void {
    this.options.diy = store;
  }

  getDiyStore(): DiyBindStore | null {
    return this.options.diy;
  }

  setMode(mode: PlayMode): void {
    this.options.mode = mode;
  }

  getMode(): PlayMode {
    return this.options.mode;
  }

  loadBook(book: Book): void {
    this.books.set(book.id, book);
  }

  unloadBook(bookId: string): void {
    this.books.delete(bookId);
  }

  getBook(bookId: string): Book | undefined {
    return this.books.get(bookId);
  }

  listBooks(): Book[] {
    return [...this.books.values()];
  }

  resolve(event: TapEvent): TapResult {
    const located = this.locate(event);
    if (!located) {
      if (event.oid) return miss("oid_not_found");
      if (event.point) return miss("no_hotspot_at_point");
      return miss("insufficient_tap_data");
    }

    const { hotspot, diy } = located;
    const cooldown = hotspot.cooldownMs ?? 0;
    if (cooldown > 0) {
      const prev = this.lastTapAt.get(hotspot.id) ?? 0;
      if (event.ts - prev < cooldown) {
        return {
          hit: true,
          hotspot,
          clips: [],
          playPolicy: "replace",
          cooledDown: true,
          reason: "cooldown",
          diy,
        };
      }
    }
    this.lastTapAt.set(hotspot.id, event.ts);

    const policy = resolvePolicy(hotspot, this.options.mode);
    const clips = selectClips(hotspot, policy);

    return { hit: true, hotspot, clips, playPolicy: policy, diy };
  }

  private locate(event: TapEvent): { hotspot: Hotspot; diy: boolean } | undefined {
    if (event.oid && this.options.preferOid) {
      const found = this.findByOid(event.oid, event.bookId);
      if (found) return found;
    }
    if (event.bookId && event.pageId && event.point) {
      const hs = this.findByPoint(event.bookId, event.pageId, event.point);
      if (hs) return { hotspot: hs, diy: false };
    }
    if (event.oid) {
      return this.findByOid(event.oid, event.bookId);
    }
    return undefined;
  }

  private findByOid(
    oid: string,
    bookId?: string,
  ): { hotspot: Hotspot; diy: boolean } | undefined {
    const diyStore = this.options.diy;
    const diyBinding = diyStore?.get(oid);
    const bookHs = this.findBookOid(oid, bookId);

    if (this.options.preferDiy && diyBinding) {
      return { hotspot: diyStore!.toHotspot(diyBinding), diy: true };
    }
    if (bookHs) return { hotspot: bookHs, diy: false };
    if (diyBinding) return { hotspot: diyStore!.toHotspot(diyBinding), diy: true };
    return undefined;
  }

  private findBookOid(oid: string, bookId?: string): Hotspot | undefined {
    const books = bookId
      ? ([this.books.get(bookId)].filter(Boolean) as Book[])
      : this.listBooks();

    for (const book of books) {
      for (const page of book.pages) {
        for (const hs of page.hotspots) {
          if (hs.oid === oid) return hs;
        }
      }
    }
    return undefined;
  }

  private findByPoint(bookId: string, pageId: string, point: Point): Hotspot | undefined {
    const book = this.books.get(bookId);
    if (!book) return undefined;
    const page = book.pages.find((p) => p.id === pageId);
    if (!page) return undefined;

    const pad = this.options.hitPadding;
    for (let i = page.hotspots.length - 1; i >= 0; i--) {
      const hs = page.hotspots[i]!;
      if (hs.polygon && hs.polygon.length >= 3) {
        if (pointInPolygon(point, hs.polygon)) return hs;
      } else if (pointInRect(point, hs.bounds, pad)) {
        return hs;
      }
    }
    return undefined;
  }
}

function miss(reason: string): TapResult {
  return { hit: false, clips: [], playPolicy: "replace", reason };
}

function resolvePolicy(hs: Hotspot, mode: PlayMode): "replace" | "queue" | "random_one" {
  if (hs.playPolicy) return hs.playPolicy;
  if (hs.kind === "story" || mode === "story") return "queue";
  if (hs.kind === "character" && (hs.clips?.length ?? 0) > 1) return "random_one";
  return "replace";
}

function selectClips(hs: Hotspot, policy: "replace" | "queue" | "random_one"): Clip[] {
  const all = hs.clips ?? [];
  if (all.length === 0) return [];
  if (policy === "random_one") return [pickWeighted(all)];
  if (policy === "queue") return [...all];
  if (all.length > 1 && hs.kind === "character") return [pickWeighted(all)];
  return [all[0]!];
}
