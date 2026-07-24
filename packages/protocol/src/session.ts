import {
  MessageType,
  decodeMessage,
  encodeMessage,
  type PenMessage,
  type TapMessage,
  type HelloMessage,
} from "./messages.js";

export type Transport = {
  send(data: string): void;
  onMessage(handler: (data: string) => void): () => void;
  close(): void;
};

/**
 * Bidirectional pen protocol session over an abstract transport (WS / BLE / serial).
 */
export class PenSession {
  private unsub: (() => void) | null = null;
  private handlers = new Set<(msg: PenMessage) => void>();

  constructor(private transport: Transport) {
    this.unsub = transport.onMessage((raw) => {
      try {
        const msg = decodeMessage(raw);
        for (const h of this.handlers) h(msg);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.send({ type: MessageType.Error, code: "DECODE", message });
      }
    });
  }

  onMessage(handler: (msg: PenMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(msg: PenMessage): void {
    this.transport.send(encodeMessage(msg));
  }

  hello(deviceId: string, firmware: string, protocolVersion = 1): void {
    const msg: HelloMessage = {
      type: MessageType.Hello,
      deviceId,
      firmware,
      protocolVersion,
    };
    this.send(msg);
  }

  emitTap(tap: Omit<TapMessage, "type">): void {
    this.send({ type: MessageType.Tap, ...tap });
  }

  close(): void {
    this.unsub?.();
    this.unsub = null;
    this.handlers.clear();
    this.transport.close();
  }
}
