import {
  DEV_PLAYER_PARAM, LIVE_OP, LIVE_PING, LIVE_PONG,
  type KeyPart, type LiveToPage, type LiveToServer, type Presence, type RelayBatch,
} from './serverwire';

export const PING_MS = 2000;
export const DEAD_MS = 6000;
export const RETRY_MS = 2000;

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface LinkEvents {
  dropped(): void;
  back(): void;
  lapsed(): void;
  lost(): void;
  presence?(p: Presence): void;
  keyAsk?(): void;
  watching?(why: null | 'free' | 'yours'): void;
  relay?(b: RelayBatch): void;
  key?(k: KeyPart): void;
}

export interface LinkOptions {
  open(url: string): SocketLike;
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export function liveUrl(machineBase: string, player: string): string {
  const u = new URL(`${machineBase}/${LIVE_OP}`);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  if (player) u.searchParams.set(DEV_PLAYER_PARAM, player);
  return u.href;
}

export class LiveLink {
  private sock: SocketLike | null = null;
  private tick: unknown = null;
  private retry: unknown = null;
  private pingAt: number | null = null;
  private lastBeat = 0;
  private up = false;
  private down = false;
  private ended = false;
  presence: Presence | null = null;

  constructor(
    private readonly url: string,
    private readonly beatMs: number,
    private readonly on: LinkEvents,
    private readonly o: LinkOptions,
    private readonly mode: 'hold' | 'watch' | 'visit' = 'hold',
  ) {}

  sendMsg(msg: LiveToServer): boolean {
    if (!this.sock || this.ended) return false;
    try {
      this.sock.send(JSON.stringify(msg));
      return true;
    } catch {
      this.lose();
      return false;
    }
  }

  start(): void {
    this.tick = this.o.setInterval(() => this.onTick(), PING_MS);
    this.connect();
  }

  stop(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.tick !== null) this.o.clearInterval(this.tick);
    if (this.retry !== null) this.o.clearTimeout(this.retry);
    this.tick = this.retry = null;
    this.drop();
  }

  get isDown(): boolean { return this.down; }

  private connect(): void {
    this.retry = null;
    if (this.ended) return;
    let s: SocketLike;
    try {
      s = this.o.open(this.url);
    } catch {
      this.lose();
      return;
    }
    this.sock = s;
    this.pingAt = null;
    this.up = false;
    s.onmessage = (e) => { if (this.sock === s) this.onMessage(e.data); };
    s.onclose = () => { if (this.sock === s) this.lose(); };
    s.onerror = () => { if (this.sock === s) this.lose(); };
    this.pingAt = this.o.now();
  }

  private onMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    if (data === LIVE_PONG) { this.pingAt = null; return; }
    let m: LiveToPage;
    try { m = JSON.parse(data) as LiveToPage; } catch { return; }
    if (m.type === 'presence') {
      this.presence = m.presence;
      this.on.presence?.(m.presence);
      return;
    }
    if (m.type === 'key-ask') { this.on.keyAsk?.(); return; }
    if (m.type === 'relay') { this.on.relay?.(m); return; }
    if (m.type === 'key') { this.on.key?.(m); return; }
    if (m.type === 'watching') { this.on.watching?.(m.ok ? null : m.why); return; }
    if (m.type !== 'standing') return;
    this.pingAt = null;
    if (this.mode !== 'hold') {
      if (!this.up) {
        this.up = true;
        if (this.mode === 'watch') this.sendMsg({ type: 'watch' });
      }
      if (this.down) {
        this.down = false;
        this.on.back();
      }
      return;
    }
    if (m.you === 'holder') {
      if (!this.up) this.lastBeat = this.o.now();
      this.up = true;
      if (this.down) {
        this.down = false;
        this.on.back();
      }
      return;
    }
    this.stop();
    if (m.you === 'lapsed') this.on.lapsed();
    else this.on.lost();
  }

  private onTick(): void {
    if (this.ended || !this.sock) return;
    const now = this.o.now();
    if (this.pingAt !== null) {
      if (now - this.pingAt > DEAD_MS) this.lose();
      return;
    }
    this.pingAt = now;
    this.send(LIVE_PING);
    if (this.mode === 'hold' && this.up && now - this.lastBeat >= this.beatMs) {
      this.lastBeat = now;
      this.send(JSON.stringify({ type: 'beat' } satisfies LiveToServer));
    }
  }

  private send(text: string): void {
    try { this.sock?.send(text); } catch { this.lose(); }
  }

  private lose(): void {
    if (this.ended) return;
    this.drop();
    if (!this.down) {
      this.down = true;
      this.on.dropped();
    }
    if (this.retry === null) this.retry = this.o.setTimeout(() => this.connect(), RETRY_MS);
  }

  private drop(): void {
    const s = this.sock;
    this.sock = null;
    this.up = false;
    this.pingAt = null;
    if (!s) return;
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    try { s.close(); } catch {  }
  }
}
