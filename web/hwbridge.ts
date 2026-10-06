import type { Emu } from './emu-client';
import { viewFor } from './platform';

export const HW_API_VERSION = '0.2.0';

const LAMP_SCAN_FLOOR = 512;

const POLL_MS = 25;

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 15000;

export interface BridgeSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export class HwBridge {
  private ws: BridgeSocket | null = null;
  private backoffMs = BACKOFF_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeq = -1;
  private lampLevels = new Uint8Array(LAMP_SCAN_FLOOR);
  private lampsValid = false;
  private lastVfd: string | null = null;
  private lastDuty = -1;
  private game: { name: string; system: string } | null = null;
  private coinBits: number[] = [];
  private coins: readonly { label: string; bit: number }[] = [];

  constructor(
    private readonly emu: Emu,
    private readonly url: string,
    private readonly makeSocket: (url: string) => BridgeSocket =
      (u) => new WebSocket(u) as unknown as BridgeSocket,
  ) {
    emu.onSerial = (events) => {
      for (const e of events) this.send({ type: 'serial', ch: e.ch, bytes: e.bytes });
    };
    this.pollTimer = setInterval(() => this.poll(), POLL_MS);
    this.connect();
  }

  gameLoaded(name: string, system: string, coins?: readonly { label: string; bit: number }[]): void {
    this.game = { name, system };
    this.coins = coins ?? viewFor(system).coins;
    this.coinBits = this.coins.map((c) => c.bit);
    this.resetPerGame();
    this.announce();
  }

  gameUnloaded(): void {
    if (!this.game) return;
    this.game = null;
    this.coinBits = [];
    this.coins = [];
    this.send({ type: 'gameunloaded' });
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    let ws: BridgeSocket;
    try {
      ws = this.makeSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.backoffMs = BACKOFF_MIN_MS;
      this.send({ type: 'hello', apiVersion: HW_API_VERSION });
      this.announce();
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') this.receive(ev.data);
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.pollTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
  }

  private open(): boolean {
    return this.ws !== null && this.ws.readyState === 1;
  }

  private send(msg: Record<string, unknown>): void {
    if (!this.open()) return;
    this.ws!.send(JSON.stringify(msg));
  }

  private announce(): void {
    if (!this.open() || !this.game) return;
    const coins = this.coins;
    this.send({
      type: 'gameloaded',
      game: this.game.name,
      system: this.game.system,
      coins: coins.map((c, channel) => ({ channel, label: c.label })),
    });
    this.sendState();
  }

  private resetPerGame(): void {
    this.lastSeq = -1;
    this.lampsValid = false;
    this.lampLevels.fill(0);
    this.lastVfd = null;
    this.lastDuty = -1;
  }

  private poll(): void {
    const frame = this.emu.latestFrame();
    if (!frame || !this.game || !this.open()) return;
    if (frame.seq === this.lastSeq) return;
    if (!this.lampsValid) {
      this.sendState();
      return;
    }
    this.lastSeq = frame.seq;

    const changes: Record<number, number> = {};
    let changed = false;
    const scan = this.scanFor(frame);
    for (let n = 0; n < scan; n++) {
      const level = frame.layoutLampLevel(n);
      if (level !== this.lampLevels[n]) {
        this.lampLevels[n] = level;
        changes[n] = level;
        changed = true;
      }
    }
    if (changed) this.send({ type: 'lamps', changes });

    const display = frame.display;
    if (display) {
      const text = display.text();
      const duty = display.duty ?? 31;
      if (text !== this.lastVfd || duty !== this.lastDuty) {
        this.lastVfd = text;
        this.lastDuty = duty;
        this.send({ type: 'vfd', text, duty });
      }
    }
  }

  private sendState(): void {
    const frame = this.emu.latestFrame();
    const lamps: Record<number, number> = {};
    if (frame) {
      const scan = this.scanFor(frame);
      for (let n = 0; n < scan; n++) {
        const level = frame.layoutLampLevel(n);
        this.lampLevels[n] = level;
        if (level) lamps[n] = level;
      }
      this.lastSeq = frame.seq;
    }
    this.lampsValid = frame !== null;
    const display = frame?.display ?? null;
    this.lastVfd = display ? display.text() : null;
    this.lastDuty = display ? (display.duty ?? 31) : -1;
    this.send({
      type: 'state',
      lamps,
      vfd: this.lastVfd,
      duty: display ? this.lastDuty : null,
    });
    void this.emu.ledger().then((ledger) => {
      if (ledger) this.send({ type: 'cash', ...ledger });
    });
  }

  private scanFor(frame: { lampCount?: number }): number {
    const scan = Math.max(LAMP_SCAN_FLOOR, frame.lampCount ?? 0);
    if (scan > this.lampLevels.length) {
      const grown = new Uint8Array(scan);
      grown.set(this.lampLevels);
      this.lampLevels = grown;
    }
    return scan;
  }

  private receive(text: string): void {
    let msg: { type?: unknown; id?: unknown; down?: unknown; channel?: unknown };
    try {
      msg = JSON.parse(text) as typeof msg;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'input':
        if (typeof msg.id === 'number' && typeof msg.down === 'boolean') {
          this.emu.input(msg.id, msg.down);
        }
        break;
      case 'coin': {
        const ch = typeof msg.channel === 'number' ? msg.channel : -1;
        const bit = this.coinBits[ch];
        if (bit !== undefined) this.emu.coin(bit);
        break;
      }
      case 'getstate':
        this.sendState();
        break;
    }
  }
}
