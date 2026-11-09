import { V20_STEP_TABLE } from './v20steptable';

const HALF_STEPS = 96;

const CHANNELS = 4;

const COIL_SEQ = [0x01, 0x03, 0x02, 0x06, 0x04, 0x0c, 0x08, 0x09];

const POWER_ON_SEQ = [0x01, 0x02, 0x04, 0x08, 0x03, 0x06, 0x0c];

const POWER_ON_FIRST = 27000;
const POWER_ON_EACH = 0x4e5e8;

const RELATIVE_FIRST = 0x2368;
const ABSOLUTE_FIRST = 36000;

const ACCEL_DECEL = [57000, 48000, 36000, 45000, 24000, 48000, 48000, 48000, 48000, 57000];
const DECEL_AT = 5;

const SHORT_DELAY = [36000, 51000, 39000, 51000];
const SHORT_FWD = [2, -1, 1, 1];
const SHORT_REV = [-2, 1, -1, -1];
const SHORT_LAST = 120000;

const enum Mode { PowerOn = 0, Ramped = 1, Short = 2 }

function toNibbles(bytes: readonly number[]): number[] {
  const out: number[] = [];
  for (const b of bytes) {
    out.push(b & 0x0f, (b >> 4) & 0x0f);
  }
  return out;
}

export class AceSpReelController {
  readonly positions = new Int32Array(CHANNELS);

  private readonly remaining = new Int32Array(CHANNELS);
  private readonly dirs = new Int32Array(CHANNELS);
  private readonly delay = new Int32Array(CHANNELS);
  private readonly mode = new Int32Array(CHANNELS);
  private readonly ramp = new Int32Array(CHANNELS);
  private readonly stepSize = new Int32Array(CHANNELS);
  private readonly stopPhase = new Int32Array(CHANNELS);
  private readonly symbols = new Int32Array(CHANNELS).fill(16);
  private readonly lastPattern = new Int32Array(CHANNELS);
  private busy = 0;

  private framing = false;
  private pendingLow = -1;
  private request: number[] = [];
  private wanted = 0;
  private reply: number[] = [];
  private replyAt = 0;

  messages = 0;
  lastCommand = 0;
  foreignFrames = 0;

  reset(): void {
    this.remaining.fill(0);
    this.dirs.fill(0);
    this.delay.fill(0);
    this.mode.fill(0);
    this.ramp.fill(0);
    this.stopPhase.fill(0);
    this.lastPattern.fill(0);
    this.busy = 0;
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
    if (reel < 0 || reel >= CHANNELS) return;
    this.positions[reel] = ((halfSteps % HALF_STEPS) + HALF_STEPS) % HALF_STEPS;
    this.remaining[reel] = 0;
    this.delay[reel] = 0;
    this.busy &= ~(1 << reel);
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

  advance(cycles: number): boolean {
    if (!this.busy) return false;
    let drove = false;
    for (let i = 0; i < CHANNELS; i++) {
      if (this.delay[i] === 0) continue;
      this.delay[i] -= cycles;
      if (this.delay[i] >= 1) continue;
      this.delay[i] = 0;
      drove = true;
      const pos = this.positions[i];
      if (this.mode[i] === Mode.PowerOn) {
        const at = this.ramp[i]++;
        this.drive(i, POWER_ON_SEQ[at]);
        if (this.ramp[i] < 7) this.delay[i] = POWER_ON_EACH;
        else this.remaining[i] = 0;
      } else if (this.mode[i] === Mode.Ramped) {
        const fwd = this.dirs[i] === 1;
        if (this.remaining[i] < 2) {
          if (this.remaining[i] > 0) {
            this.drive(i, COIL_SEQ[(pos + (fwd ? 1 : -1)) & 7]);
            this.remaining[i]--;
          }
        } else {
          const k = this.stepSize[i];
          this.drive(i, COIL_SEQ[(pos + (fwd ? k : -k)) & 7]);
          this.remaining[i] -= k;
        }
        if (this.remaining[i] < 7) {
          if (this.remaining[i] > 0) this.delay[i] = ACCEL_DECEL[Math.max(0, DECEL_AT + this.ramp[i]--)];
        } else {
          this.delay[i] = ACCEL_DECEL[this.ramp[i]];
          if (this.ramp[i] < 4) this.ramp[i]++;
        }
      } else {
        const r = this.ramp[i];
        this.drive(i, COIL_SEQ[(pos + (this.dirs[i] < 1 ? SHORT_REV : SHORT_FWD)[r]) & 7]);
        this.delay[i] = SHORT_DELAY[r];
        if (r > 0) this.remaining[i]--;
        if (r < 3) this.ramp[i]++;
        else this.ramp[i]--;
        if (this.remaining[i] === 1) this.delay[i] = SHORT_LAST;
        else if (this.remaining[i] === 0) this.delay[i] = 0;
      }
      if (this.delay[i] === 0) this.busy &= ~(1 << i);
    }
    return drove;
  }

  private drive(i: number, pattern: number): void {
    if (pattern === 0 || ((this.lastPattern[i] ^ pattern) + 1 & 0xf) <= 1) return;
    const move = V20_STEP_TABLE[this.positions[i] & 7][pattern];
    this.positions[i] = (this.positions[i] + move + HALF_STEPS) % HALF_STEPS;
    this.lastPattern[i] = pattern;
  }

  busyMask(): number {
    let mask = 0;
    for (let i = 0; i < CHANNELS; i++) if (this.remaining[i] !== 0) mask |= 1 << i;
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
    for (let i = 0; i < CHANNELS; i++) out.push(this.positions[i] === 0 ? 0x30 : this.positions[i] >> 1);
    return out;
  }

  private command(header: number, payload: number[]): number[] {
    switch (header >> 4) {
      case 0x1:
        this.moveRelative(payload);
        return [0];
      case 0x2:
        this.setSymbols(payload);
        return [0];
      case 0x4:
        return this.stepPositions();
      case 0x8:
        this.moveAbsolute(payload);
        return [0];
      case 0x9:
        return [this.busyMask()];
      case 0xc:
        this.stopAtSymbol(payload);
        return [0];
      case 0xf:
        return [this.setup(payload)];
      default:
        return [0];
    }
  }

  private setup(payload: number[]): number {
    switch (payload[0]) {
      case 0x00:
        return 0x10;
      case 0x02:
        for (let i = 0; i < CHANNELS; i++) {
          this.delay[i] = POWER_ON_FIRST;
          this.remaining[i] = 7;
          this.ramp[i] = 0;
          this.mode[i] = Mode.PowerOn;
        }
        this.busy = 0x0f;
        return 0;
      case 0x07:
        this.stepSize.fill(payload[1] === 0 ? 2 : 1);
        return 0;
      default:
        return 0;
    }
  }

  private start(i: number, halfSteps: number, first: number, dir: number): void {
    this.remaining[i] = halfSteps;
    this.dirs[i] = dir;
    this.mode[i] = halfSteps === 8 || halfSteps === 6 || this.stepSize[i] === 1 ? Mode.Short : Mode.Ramped;
    this.delay[i] = first;
    this.busy |= 1 << i;
    this.ramp[i] = 0;
  }

  private moveRelative(payload: number[]): void {
    for (let i = 0; i < CHANNELS; i++) {
      const hi = payload[i * 2] ?? 0;
      const steps = ((hi & 0x7f) << 8) | (payload[i * 2 + 1] ?? 0);
      if (steps !== 0) this.start(i, steps * 2, RELATIVE_FIRST, hi & 0x80 ? -1 : 1);
    }
  }

  private moveAbsolute(payload: number[]): void {
    for (let i = 0; i < CHANNELS; i++) {
      const hi = payload[i * 2] ?? 0;
      const target = ((((hi & 0x0f) << 8) | (payload[i * 2 + 1] ?? 0)) * 2) % HALF_STEPS;
      this.stopPhase[i] = target % Math.trunc(HALF_STEPS / this.symbols[i]);
      const pos = this.positions[i];
      if (hi & 0x80) this.start(i, (pos - target + HALF_STEPS) % HALF_STEPS, ABSOLUTE_FIRST, -1);
      else this.start(i, (HALF_STEPS - pos + target) % HALF_STEPS, ABSOLUTE_FIRST, 1);
    }
  }

  private setSymbols(payload: number[]): void {
    this.symbols.fill(16);
    this.symbols[3] = payload[0] === 0x62 ? 12 : 16;
  }

  private stopAtSymbol(payload: number[]): void {
    const mask = payload[0] ?? 0;
    const n = ((payload[1] ?? 0) * 2) & 0xff;
    if (n === 0) return;
    for (let i = 0; i < CHANNELS; i++) {
      if (!(mask & (1 << i))) continue;
      const from = (this.positions[i] - this.stopPhase[i] + HALF_STEPS) % HALF_STEPS;
      this.remaining[i] = (n - (from % n)) % n;
      if (this.remaining[i] === 0) this.delay[i] = 0;
    }
  }
}
