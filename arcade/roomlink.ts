import { withBuild } from '../web/updategate';
import type { LinkOptions, SocketLike } from './livelink';
import { ARCADES_PATH, LIVE_PING, LIVE_PONG, ROOM_CHANNEL_PATH, ROOM_PING_MS, type RoomMessage } from './serverwire';

const TICK_MS = 5000;
export const ROOM_DEAD_MS = 10_000;
export const ROOM_RETRY_MS = 2000;
export const ROOM_RETRY_MAX_MS = 60_000;

export interface RoomLinkEvents {
  message(m: RoomMessage): void;
  up(): void;
  down(): void;
}

export function roomChannelUrl(base: string, arcadeId: string): string {
  const u = new URL(`${base}${ARCADES_PATH}/${encodeURIComponent(arcadeId)}/${ROOM_CHANNEL_PATH}`);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return withBuild(u).href;
}

export function readRoomMessage(data: unknown): RoomMessage | null {
  if (typeof data !== 'string') return null;
  let m: { type?: unknown; data?: { playing?: unknown; at?: unknown; gone?: unknown } } | null;
  try { m = JSON.parse(data) as typeof m; } catch { return null; }
  if (m?.type === 'playing' && Array.isArray(m.data?.playing)) return m as RoomMessage;
  if (m?.type === 'arcade' && typeof m.data?.at === 'number' && typeof m.data.gone === 'boolean') return m as RoomMessage;
  return null;
}

export class RoomLink {
  private sock: SocketLike | null = null;
  private tick: unknown = null;
  private retry: unknown = null;
  private waitingSince: number | null = null;
  private lastPing = 0;
  private up = false;
  private down = false;
  private wait = ROOM_RETRY_MS;
  private ended = false;

  constructor(private readonly url: string, private readonly on: RoomLinkEvents, private readonly o: LinkOptions) {}

  get isDown(): boolean { return this.down; }

  start(): void {
    this.tick = this.o.setInterval(() => this.onTick(), TICK_MS);
    this.connect();
  }

  stop(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.tick !== null) this.o.clearInterval(this.tick);
    if (this.retry !== null) this.o.clearTimeout(this.retry);
    this.tick = this.retry = null;
    this.release();
  }

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
    this.up = false;
    this.waitingSince = this.o.now();
    s.onmessage = (e) => { if (this.sock === s) this.onMessage(e.data); };
    s.onclose = () => { if (this.sock === s) this.lose(); };
    s.onerror = () => { if (this.sock === s) this.lose(); };
  }

  private onMessage(data: unknown): void {
    if (data === LIVE_PONG) { this.waitingSince = null; return; }
    const m = readRoomMessage(data);
    if (!m) return;
    if (!this.up) {
      this.up = true;
      this.down = false;
      this.wait = ROOM_RETRY_MS;
      this.waitingSince = null;
      this.lastPing = this.o.now();
      this.on.up();
    }
    this.on.message(m);
  }

  private onTick(): void {
    if (this.ended || !this.sock) return;
    const now = this.o.now();
    if (this.waitingSince !== null) {
      if (now - this.waitingSince >= ROOM_DEAD_MS) this.lose();
      return;
    }
    if (now - this.lastPing < ROOM_PING_MS) return;
    this.lastPing = now;
    this.waitingSince = now;
    try { this.sock.send(LIVE_PING); } catch { this.lose(); }
  }

  private lose(): void {
    if (this.ended) return;
    this.release();
    if (this.retry === null) {
      this.retry = this.o.setTimeout(() => this.connect(), this.wait);
      this.wait = Math.min(this.wait * 2, ROOM_RETRY_MAX_MS);
    }
    if (!this.down) {
      this.down = true;
      this.on.down();
    }
  }

  private release(): void {
    const s = this.sock;
    this.sock = null;
    this.up = false;
    this.waitingSince = null;
    if (!s) return;
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    try { s.close(); } catch {  }
  }
}
