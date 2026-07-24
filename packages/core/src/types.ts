/** Normalized 2D point in page coordinate space (0–1 or mm). */
export interface Point {
  x: number;
  y: number;
}

/** Axis-aligned bounding box. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Closed polygon defined by ordered vertices. */
export type Polygon = Point[];

/** Kids-IP hotspot category (小鸡球球 / 宝贝JoJo 向，非学段课本). */
export type HotspotKind =
  | "character"
  | "object"
  | "word"
  | "song"
  | "story"
  | "egg"
  | "ui";

/** How to pick/play clips when tapped. */
export type PlayPolicy =
  | "replace" // interrupt & play (default free-play toy feel)
  | "queue" // enqueue (story narration)
  | "random_one"; // pick one weighted clip, then replace

export type MediaType = "voice" | "sfx" | "song" | "bgm" | "narration";

export type BookTheme = "story" | "cognition" | "song" | "scene";

export type PlayMode = "free" | "story" | "song" | "explore";

/** Audio clip bound to a hotspot. */
export interface Clip {
  id: string;
  /** Relative path under content/audio, or diy:tts:... for synthetic lines */
  uri: string;
  durationMs?: number;
  language?: string;
  /** Script / subtitles / authoring aid */
  transcript?: string;
  mediaType?: MediaType;
  /** Weight for random_one policy */
  weight?: number;
  emotion?: string;
  /** Family voice profile for TTS (mom/dad/...) — see VoiceProfile */
  voiceProfileId?: string;
}

/** Clickable region on a page. */
export interface Hotspot {
  id: string;
  pageId: string;
  /** OID / infrared code printed on paper, if any */
  oid?: string;
  /** Bounding box (page coords) */
  bounds: Rect;
  /** Optional precise shape */
  polygon?: Polygon;
  clips: Clip[];
  /** Display label for authoring UI */
  label?: string;
  tags?: string[];
  /** Kids-IP: what was tapped */
  kind?: HotspotKind;
  characterId?: string;
  playPolicy?: PlayPolicy;
  /** Ignore re-taps within this window (ms) */
  cooldownMs?: number;
}

export interface Page {
  id: string;
  bookId: string;
  /** Printed page number */
  pageNumber: number;
  width: number;
  height: number;
  hotspots: Hotspot[];
  /** Preview image path */
  previewUri?: string;
}

export interface Book {
  id: string;
  title: string;
  isbn?: string;
  language: string;
  version: string;
  pages: Page[];
  coverUri?: string;
  metadata?: Record<string, string>;
  /** Kids-IP extensions */
  seriesId?: string;
  ipId?: string;
  theme?: BookTheme;
  playModes?: PlayMode[];
}

export interface IpBrand {
  id: string;
  name: string;
  mascot?: string;
  tagline?: string;
}

export interface Series {
  id: string;
  ipId: string;
  title: string;
  ageMin?: number;
  ageMax?: number;
  bookIds: string[];
}
