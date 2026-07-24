export enum MessageType {
  Hello = "hello",
  Ack = "ack",
  Tap = "tap",
  Play = "play",
  Stop = "stop",
  Error = "error",
  Heartbeat = "heartbeat",
}

export interface HelloMessage {
  type: MessageType.Hello;
  deviceId: string;
  firmware: string;
  protocolVersion: number;
}

export interface AckMessage {
  type: MessageType.Ack;
  refId?: string;
  ok: boolean;
}

export interface TapMessage {
  type: MessageType.Tap;
  id: string;
  ts: number;
  deviceId: string;
  bookId?: string;
  pageId?: string;
  oid?: string;
  x?: number;
  y?: number;
}

export interface PlayMessage {
  type: MessageType.Play;
  id: string;
  clipId: string;
  uri: string;
  hotspotId?: string;
}

export interface ErrorMessage {
  type: MessageType.Error;
  code: string;
  message: string;
  refId?: string;
}

export interface HeartbeatMessage {
  type: MessageType.Heartbeat;
  ts: number;
  deviceId: string;
}

export interface StopMessage {
  type: MessageType.Stop;
  id?: string;
}

export type PenMessage =
  | HelloMessage
  | AckMessage
  | TapMessage
  | PlayMessage
  | StopMessage
  | ErrorMessage
  | HeartbeatMessage;

export function encodeMessage(msg: PenMessage): string {
  return JSON.stringify(msg);
}

export function decodeMessage(raw: string): PenMessage {
  const data = JSON.parse(raw) as PenMessage;
  if (!data || typeof data !== "object" || !("type" in data)) {
    throw new Error("Invalid pen message: missing type");
  }
  return data;
}
