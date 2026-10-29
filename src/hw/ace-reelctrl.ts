
const HALF_STEPS = 96;

const DRIVE_CHANNELS = 4;

export interface AceReelConfig {
  reels?: number;
  ticksPerStep?: number;
}

function toNibbles(bytes: readonly number[]): number[] {
  const out: number[] = [];
  for (const b of bytes) {
    out.push(b & 0x0f, (b >> 4) & 0x0f);
  }
  return out;
}

export class AceSpReelController {
  readonly positions: Int32Array;

  private count: number;
  private readonly ticksPerHalfStep: number;

  private readonly remaining: Int32Array;
  private readonly countdown: Int32Array;
  private readonly dirs: Int32Array;
  private readonly symbols: Int32Array;
  private readonly stopPhase: Int32Array;

  private framing = false;
  private pendingLow = -1;
  private request: number[] = [];
  private wanted = 0;
  private reply: number[] = [];
  private replyAt = 0;

  messages = 0;
  lastCommand = 0;
  foreignFrames = 0;

  constructor(cfg: AceReelConfig = {}) {
    this.count = cfg.reels ?? DRIVE_CHANNELS;
    this.ticksPerHalfStep = Math.max(1, Math.round((cfg.ticksPerStep ?? 10) / 2));
    this.positions = new Int32Array(this.count);
    this.remaining = new Int32Array(this.count);
    this.countdown = new Int32Array(this.count);
    this.dirs = new Int32Array(this.count).fill(1);
    this.symbols = new Int32Array(this.count).fill(16);
    this.stopPhase = new Int32Array(this.count);
  }

  fit(reels: number): void {
    this.count = Math.max(0, Math.min(reels, this.positions.length));
  }

  reset(): void {
    this.positions.fill(0);
    this.remaining.fill(0);
    this.countdown.fill(0);
    this.dirs.fill(1);
    this.symbols.fill(16);
    this.stopPhase.fill(0);
    this.framing = false;
    this.pendingLow = -1;
    this.request = [];
    this.wanted = 0;
    this.reply = [];
    this.replyAt = 0;
    this.messages = 0;
    this.lastCommand = 0;
    this.foreignFrames = 0;
  }

  setPosition(reel: number, halfSteps: number): void {
    if (reel < 0 || reel >= this.count) return;
    this.positions[reel] = ((halfSteps % HALF_STEPS) + HALF_STEPS) % HALF_STEPS;
    this.remaining[reel] = 0;
  }

  startFrame(): void {
    this.framing = true;
    this.pendingLow = -1;
    this.request = [];
    this.wanted = 0;
  }

  write(value: number): void {
    if (!this.framing) return;
    const nibble = (value >> 4) & 0x0f;
    if (this.pendingLow < 0) {
      this.pendingLow = nibble;
      return;
    }
    const byte = ((nibble << 4) | this.pendingLow) & 0xff;
    this.pendingLow = -1;
    this.request.push(byte);
    if (this.request.length === 1) this.wanted = (byte & 0x0f) + 2;
    if (this.request.length >= this.wanted) {
      this.framing = false;
      this.serve();
    }
  }

  read(): number {
    if (this.replyAt >= this.reply.length) return 0;
    return (this.reply[this.replyAt++] << 4) & 0xf0;
  }

  tick(n = 1): void {
    for (let t = 0; t < n; t++) {
      for (let i = 0; i < this.count; i++) {
        if (this.remaining[i] === 0) continue;
        if (--this.countdown[i] > 0) continue;
        this.countdown[i] = this.ticksPerHalfStep;
        const dir = this.remaining[i] > 0 ? 1 : -1;
        this.positions[i] = (this.positions[i] + dir + HALF_STEPS) % HALF_STEPS;
        this.remaining[i] -= dir;
      }
    }
  }

  busyMask(): number {
    let mask = 0;
    for (let i = 0; i < this.count; i++) if (this.remaining[i] !== 0) mask |= 1 << i;
    return mask;
  }

  private serve(): void {
    const header = this.request[0];
    const payload = this.request.slice(1, this.request.length - 1);
    const ack = this.request[this.request.length - 1];
    let want = 0;
    for (let i = 0; i < this.request.length - 1; i++) want = (want + this.request[i]) & 0xff;
    if ((want || 0xff) !== ack) this.foreignFrames++;
    const body = this.command(header, payload);

    const replyHeader = (header & 0xf0) | (body.length & 0x0f);
    let sum = replyHeader;
    for (const b of body) sum = (sum + b) & 0xff;

    this.reply = toNibbles([ack, replyHeader, ...body, sum]);
    this.replyAt = 0;
    this.messages++;
    this.lastCommand = header;
  }

  private stepPositions(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) out.push((this.positions[i] >> 1) || 48);
    return out;
  }

  private command(header: number, payload: number[]): number[] {
    switch (header) {
      case 0x18:
        this.move(payload, false);
        return [];
      case 0x88:
        this.move(payload, true);
        return [];
      case 0x21:
        this.setSymbols(payload);
        return [];
      case 0x40:
        return this.stepPositions();
      case 0xc4:
        this.stopAtSymbol(payload);
        return [];
      case 0x70:
        return [0x00];
      case 0x90:
        return [this.busyMask()];
      case 0xf1:
        return payload[0] === 0x00 ? [0x08] : [];
      default:
        return [];
    }
  }

  private move(payload: number[], absolute: boolean): void {
    for (let i = 0; i < this.count && i * 2 + 1 < payload.length; i++) {
      const word = ((payload[i * 2] << 8) | payload[i * 2 + 1]) & 0xffff;
      if (absolute) {
        const target = ((word % (HALF_STEPS / 2)) * 2) % HALF_STEPS;
        this.remaining[i] = (target - this.positions[i] + HALF_STEPS) % HALF_STEPS;
        this.dirs[i] = 1;
        this.stopPhase[i] = target % (HALF_STEPS / this.symbols[i]);
      } else {
        const steps = (word & 0x7fff) * 2;
        this.remaining[i] = word & 0x8000 ? -steps : steps;
        if (steps) this.dirs[i] = word & 0x8000 ? -1 : 1;
      }
      this.countdown[i] = this.ticksPerHalfStep;
    }
  }

  private setSymbols(payload: number[]): void {
    for (let i = 0; i < this.count; i++) this.symbols[i] = 16;
    if (this.count > 3) this.symbols[3] = payload[0] === 0x62 ? 12 : 16;
  }

  private stopAtSymbol(payload: number[]): void {
    const mask = payload[0] ?? 0;
    const n = ((payload[1] ?? 0) * 2) & 0xff;
    if (n === 0) return;
    for (let i = 0; i < this.count; i++) {
      if (!(mask & (1 << i))) continue;
      const from = (this.positions[i] - this.stopPhase[i] + HALF_STEPS) % HALF_STEPS;
      const dist = (n - (from % n)) % n;
      this.remaining[i] = dist * this.dirs[i];
    }
  }
}
