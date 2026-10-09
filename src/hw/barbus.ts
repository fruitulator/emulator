
import { Reel5 } from './reel5';

const MASTER_SEED = [0x57, 0x15];
const SLAVE_SEED = [0x9b, 0xd9];

function crc16Step(crc: number, byte: number): number {
  for (let i = 0; i < 8; i++) {
    crc = (crc ^ byte) & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    byte >>= 1;
  }
  return crc & 0xffff;
}

function barbusCrc16(seed: readonly number[], body: readonly number[]): number {
  let crc = 0;
  for (const b of seed) crc = crc16Step(crc, b);
  for (const b of body) crc = crc16Step(crc, b);
  return crc & 0xffff;
}

const TYPE_MUX5 = 0x0;
export const MUX_UNITS = 8;
export const MUX_UNIT_BYTES = 48;
const MUX_LAMPS_PER_UNIT = 192;
const TYPE_REEL5 = 0x1;

const MAX_FRAME = 48;

const LOG_FRAMES = 256;

const REEL_LOG_FRAMES = 256;

const REEL5_LAMP_WRITE = 0xb6;

const FRAME_GAP_CYCLES = 22_000;

export interface BarbusFrame {
  addr: number;
  cmd: number;
  body: number[];
  reply?: number[];
}

function alphaToAscii(code: number): number {
  const six = code & 0x3f;
  return six < 0x20 ? 0x40 + six : six;
}

class MuxDuty {
  private readonly stage = new Uint8Array(16);
  private readonly liveA = new Uint8Array(8);
  private readonly liveB = new Uint8Array(8);
  private readonly levels = new Uint8Array(32);
  private cursor = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    for (let col = 0; col < 8; col++) {
      this.stage[col] = 0x1f;
      this.stage[col + 8] = 0xfa;
      this.liveA[col] = 0xfa;
      this.liveB[col] = 0x1f;
      this.levels[col * 4] = 0;
      this.levels[col * 4 + 1] = 0x55;
      this.levels[col * 4 + 2] = 0xaa;
      this.levels[col * 4 + 3] = 0xff;
    }
    this.cursor = 0;
  }

  level(col: number, state: number): number {
    return this.levels[(col & 7) * 4 + (state & 3)];
  }

  command(payload: number[]): boolean {
    const n = payload.length;
    if (n === 1) {
      this.stage.fill(payload[0] & 0xff, 0, 8);
      return true;
    }
    if (n === 8 || n === 16 || n === 17) {
      for (let i = 0; i < Math.min(n, 16); i++) this.stage[i] = payload[i] & 0xff;
      return true;
    }
    return false;
  }

  tick(): boolean {
    const col = this.cursor;
    this.cursor = (col + 1) & 7;
    const a = this.stage[col];
    const b = this.stage[col + 8];
    if (a === this.liveA[col] && b === this.liveB[col]) return false;
    this.liveA[col] = a;
    this.liveB[col] = b;
    if (b === 0) return true;
    const first = Math.min(0xff, Math.floor((a * 0xff) / b));
    this.levels[col * 4] = 0;
    this.levels[col * 4 + 1] = first;
    this.levels[col * 4 + 2] = 0xff - first;
    this.levels[col * 4 + 3] = 0xff;
    return true;
  }
}

export class Barbus {
  framesSeen = 0;
  repliesSent = 0;
  repeatsSeen = 0;
  onAlpha?: (cells: Uint8Array, punct: Uint8Array) => void;
  readonly reel5 = new Reel5();
  readonly reel5b = new Reel5();

  reelJumpers: { mode: number; units: number[][] } | null = null;

  mux5Extended = false;

  muxUnitAbsent = 0;

  private muxFitted(unit: number): boolean {
    return this.muxUnitAbsent === 0 || unit !== this.muxUnitAbsent;
  }

  private readonly lastTaken = new Map<number, { toggle: number; reply: number[] | null }>();

  reel5At(addr: number): Reel5 | null {
    const unit = (addr >> 1) & 3;
    return unit === 0 ? this.reel5 : unit === 1 ? this.reel5b : null;
  }

  inputs = 0;

  lampsLive = false;

  readonly muxLamps = new Uint8Array(MUX_UNITS * MUX_UNIT_BYTES);
  readonly muxBase = new Int16Array(MUX_UNITS).fill(-1);
  private nextMuxBase = 0x40;
  get muxBanks(): number { return this.mux5Extended ? 3 : 2; }
  private readonly muxDuty = Array.from({ length: MUX_UNITS }, () => new MuxDuty());
  readonly muxLedState = new Uint8Array(MUX_UNITS * 64);
  readonly muxLedLevel = new Uint8Array(MUX_UNITS * 64);
  readonly muxLedWord = new Uint8Array(MUX_UNITS * 8);
  readonly reelLamps = new Uint8Array(6);

  lampTestPass = true;
  private readonly muxLampState = new Uint8Array(MUX_UNITS * MUX_LAMPS_PER_UNIT);
  private readonly muxJustLit = new Uint8Array(MUX_UNITS * MUX_LAMPS_PER_UNIT);
  private readonly muxSenseHold = new Uint16Array(MUX_UNITS);
  private readonly reelLampState = new Uint8Array(2 * 15);
  private readonly reelJustLit = new Uint8Array(2 * 15);
  private readonly reelSenseHold = new Uint16Array(2);

  private readonly alphaCells = new Uint8Array(16).fill(0x20);
  private readonly alphaPunct = new Uint8Array(16);
  alphaDuty = 0;
  private alphaCursor = 0;
  alphaWindow = 16;

  private alphaWrite(payload: number[]): void {
    for (const b of payload) {
      if ((b & 0xe0) === 0xe0) { this.alphaDuty = b & 0x1f; continue; }
      if ((b & 0xf0) === 0xc0) { const n = b & 0x0f; this.alphaWindow = n === 0 ? 16 : n; continue; }
      if (b >= 0xa0 && b <= 0xaf) { this.alphaCursor = (b - 0xa0 + 1) & 0x0f; continue; }
      if (b === 0x2e || b === 0x2c) {
        const at = (16 - this.alphaCursor) & 0x0f;
        this.alphaCells[at] |= 0x80;
        this.alphaPunct[at] |= b;
        continue;
      }
      if (b >= 0x80) continue;
      if (this.alphaCursor < 16) {
        this.alphaCells[15 - this.alphaCursor] = alphaToAscii(b);
        this.alphaPunct[15 - this.alphaCursor] = 0;
      }
      this.alphaCursor++;
    }
    this.onAlpha?.(this.alphaCells, this.alphaPunct);
  }
  readonly log: BarbusFrame[] = [];
  readonly reelLog: BarbusFrame[] = [];

  private frame: number[] = [];
  private pending7f = false;
  private idleCycles = 0;
  private replyQueue: number[] = [];
  private channel: 0 | 1 = 0;

  reset(): void {
    this.frame = [];
    this.pending7f = false;
    this.idleCycles = 0;
    this.replyQueue.length = 0;
    this.framesSeen = 0;
    this.repliesSent = 0;
    this.repeatsSeen = 0;
    this.log.length = 0;
    this.reelLog.length = 0;
    this.alphaCells.fill(0x20);
    this.alphaPunct.fill(0);
    this.alphaDuty = 0;
    this.alphaCursor = 0;
    this.lampsLive = false;
    this.muxLamps.fill(0);
    this.muxBase.fill(-1);
    this.nextMuxBase = 0x40;
    for (const d of this.muxDuty) d.reset();
    this.muxLedState.fill(0);
    this.muxLedLevel.fill(0);
    this.muxLedWord.fill(0);
    this.reelLamps.fill(0);
    this.muxLampState.fill(0);
    this.muxJustLit.fill(0);
    this.muxSenseHold.fill(0);
    this.reelLampState.fill(0);
    this.reelJustLit.fill(0);
    this.reelSenseHold.fill(0);
    this.reel5.reset();
    this.reel5b.reset();
    this.lastTaken.clear();
  }

  resyncLink(): void {
    this.frame = [];
    this.pending7f = false;
    this.idleCycles = 0;
    this.replyQueue.length = 0;
    this.lastTaken.clear();
  }

  feedTx(channel: 0 | 1, byte: number): void {
    this.channel = channel;
    this.idleCycles = 0;
    byte &= 0xff;
    if (this.pending7f) {
      this.pending7f = false;
      if (byte === 0x7f) {
        this.pushLogical(0x7f);
      } else {
        this.frame = [0x7f];
        this.pushLogical(byte);
      }
      return;
    }
    if (byte === 0x7f) {
      if (this.frame.length === 0) this.frame = [0x7f];
      else this.pending7f = true;
      return;
    }
    this.pushLogical(byte);
  }

  private pushLogical(byte: number): void {
    this.frame.push(byte);
    if (this.frame.length > MAX_FRAME) this.frame = [];
  }

  eventIn(): number {
    let d = Math.min(this.reel5.eventIn(), this.reel5b.eventIn());
    if (this.frame.length !== 0) {
      const gap = FRAME_GAP_CYCLES - this.idleCycles;
      if (gap < d) d = gap;
    }
    return d < 1 ? 1 : d;
  }

  tick(cycles: number): void {
    this.reel5.tick(cycles);
    this.reel5b.tick(cycles);
    if (this.frame.length === 0) return;
    this.idleCycles += cycles;
    if (this.idleCycles < FRAME_GAP_CYCLES) return;
    const frame = this.frame;
    this.frame = [];
    this.pending7f = false;
    this.idleCycles = 0;
    if (frame.length < 5 || frame[0] !== 0x7f) return;
    const body = frame.slice(1, -2);
    const crc = frame[frame.length - 2] | (frame[frame.length - 1] << 8);
    if (barbusCrc16(MASTER_SEED, body) !== crc) return;
    this.respond(frame[1], frame[2], body);
  }

  private muxLedLampWrite(addr: number, cmd: number, body: number[]): void {
    const unit = (addr >> 1) & 7;
    const ub = unit * MUX_UNIT_BYTES;
    const banks = this.muxBanks;
    const long = (cmd & 0xf) === 0xf;
    let p = long ? 3 : 2;
    const end = Math.min(body.length, p + (long ? body[2] : cmd & 0xf));
    if ((cmd & 0xf0) === 0x80 && end - p > 3) p += 4;
    if (p < end) {
      const segs = body[p];
      const segs2 = body[p + 1] ?? 0;
      let q = p + 2;
      for (let seg = 0; seg < 8; seg++) {
        const m = 0x80 >> seg;
        if (!(segs & m)) continue;
        const first = body[q] ?? 0;
        const two = (segs2 & m) !== 0;
        const second = two ? body[q + 1] ?? 0 : 0;
        for (let bit = 0; bit < 8; bit++) {
          const k = 1 << bit;
          const state = two ? ((first & k) ? 1 : 0) | ((second & k) ? 2 : 0) : (first & k) ? 3 : 0;
          const i = unit * 64 + bit * 8 + seg;
          if (state === this.muxLedState[i]) continue;
          this.muxLedState[i] = state;
          const w = unit * 8 + bit;
          if (state === 0) {
            this.muxLedWord[w] &= ~(1 << seg);
          } else {
            this.muxLedWord[w] |= 1 << seg;
            this.muxLedLevel[i] = this.muxLevel(unit, seg, state);
          }
        }
        q += two ? 2 : 1;
      }
      p = q;
    }
    for (let bank = 0; bank < banks && p < end; bank++) {
      const segs1 = body[p];
      const segs2 = body[p + 1] ?? 0;
      p += 2;
      if (!segs1) continue;
      const a = ub + bank * 16;
      for (let col = 0; col < 8; col++) {
        const m = 0x80 >> col;
        if (!(segs1 & m)) continue;
        const first = body[p++] ?? 0;
        const second = segs2 & m ? body[p++] ?? 0 : first;
        this.muxLamps[a + col] = first;
        this.muxLamps[a + 8 + col] = second;
        this.muxLampEdges(unit, bank, col, first, second);
      }
    }
  }

  private muxLampEdges(unit: number, bank: number, col: number, first: number, second: number): void {
    const base = unit * MUX_LAMPS_PER_UNIT + bank * 64 + col;
    for (let row = 0; row < 8; row++) {
      const n = base + 8 * row;
      const state = ((first >> row) & 1) | (((second >> row) & 1) << 1);
      if (state !== this.muxLampState[n]) {
        this.muxLampState[n] = state;
        this.muxJustLit[n] = state !== 0 ? 1 : 0;
      }
    }
  }

  private muxSense(unit: number): number {
    const base = unit * MUX_LAMPS_PER_UNIT;
    let seen = false;
    for (let i = 0; i < MUX_LAMPS_PER_UNIT; i++) {
      if (this.muxJustLit[base + i]) { this.muxJustLit[base + i] = 0; seen = true; }
    }
    const v = this.lampTestPass && this.muxSenseHold[unit] === 0 && seen ? 0x20 : 0;
    this.muxSenseHold[unit] = 0;
    return v;
  }

  private reelLampEdges(unit: number, body: number[]): void {
    for (let row = 0; row < 3; row++) {
      const first = body[2 + 2 * row] ?? 0;
      const second = body[3 + 2 * row] ?? 0;
      for (let reel = 0; reel < 5; reel++) {
        const m = 0x08 << reel;
        const n = unit * 15 + row * 5 + reel;
        const state = (first & m ? 1 : 0) | (second & m ? 2 : 0);
        if (state !== this.reelLampState[n]) {
          this.reelLampState[n] = state;
          this.reelJustLit[n] = state !== 0 ? 1 : 0;
        }
      }
    }
  }

  private reelSense(unit: number): number {
    let seen = false;
    for (let i = unit * 15; i < unit * 15 + 15; i++) {
      if (this.reelJustLit[i]) { this.reelJustLit[i] = 0; seen = true; }
    }
    const v = this.lampTestPass && this.reelSenseHold[unit] === 0 && seen ? 0x20 : 0;
    this.reelSenseHold[unit] = 0;
    return v;
  }

  muxLevel(unit: number, col: number, state: number): number {
    return this.muxDuty[unit]?.level(col, state) ?? 0;
  }

  reelLampLevel(row: number, state: number): number {
    return this.reel5.lampDuty.level(row, state);
  }

  private respond(addr: number, cmd: number, body: number[]): void {
    this.framesSeen++;
    if ((addr & 0xf0) === 0x00 && !this.muxFitted((addr >> 1) & 7)) {
      this.log.push({ addr, cmd, body: body.slice() });
      if (this.log.length > LOG_FRAMES) this.log.shift();
      return;
    }
    const slave = addr < 0xf0 && ((addr >> 4) === TYPE_MUX5 || (addr >> 4) === TYPE_REEL5) ? addr & 0xfe : -1;
    if (slave >= 0) {
      const last = this.lastTaken.get(slave);
      if (last && last.toggle === (addr & 1)) {
        this.repeatsSeen++;
        this.log.push({ addr, cmd, body: body.slice() });
        if (this.log.length > LOG_FRAMES) this.log.shift();
        if (last.reply) this.queueReply(last.reply);
        return;
      }
    }
    if (!this.lampsLive && (addr & 0xfe) === 0x00
      && ((cmd & 0xf0) === 0xb0 || (cmd & 0xf0) === 0x80 || cmd === 0xeb || cmd === 0xef)) {
      this.lampsLive = true;
    }
    if ((addr >> 4) === TYPE_REEL5 && (cmd & 0xf0) === 0xb0 && this.reel5At(addr) === this.reel5) {
      for (let k = 0; k < 3; k++) {
        this.reelLamps[k] = body[2 + 2 * k] ?? 0;
        this.reelLamps[k + 3] = body[3 + 2 * k] ?? 0;
      }
    }
    if ((addr >> 4) === TYPE_REEL5 && (cmd & 0xf0) === 0xb0 && this.reel5At(addr)) {
      this.reelLampEdges((addr >> 1) & 3, body);
    }
    this.log.push({ addr, cmd, body: body.slice() });
    if (this.log.length > LOG_FRAMES) this.log.shift();
    if ((addr & 0xf0) === 0x00) {
      const unit = (addr >> 1) & 7;
      if (this.muxBase[unit] < 0) {
        this.muxBase[unit] = this.nextMuxBase;
        this.nextMuxBase += this.mux5Extended ? 0xc0 : 0x80;
      }
    }

    if ((addr & 0xfe) === 0x00 && cmd >= 0xa1 && cmd <= 0xaf) {
      const payload = cmd === 0xaf ? body.slice(3, 3 + body[2]) : body.slice(2, 2 + (cmd - 0xa0));
      this.alphaWrite(payload);
    }
    if ((addr & 0xf0) === 0x00 && ((cmd & 0xf0) === 0xb0 || (cmd & 0xf0) === 0x80)) {
      this.muxLedLampWrite(addr, cmd, body);
    }
    if ((addr & 0xf0) === 0x00) {
      const unit = (addr >> 1) & 7;
      const d = this.muxDuty[unit];
      if (d) {
        if ((cmd & 0xf0) === 0xe0 && (cmd & 0xf) !== 0) {
          const long = (cmd & 0xf) === 0xf;
          const at = long ? 3 : 2;
          const len = long ? (body[2] ?? 0) : cmd & 0xf;
          d.command(body.slice(at, at + len));
        }
        d.tick();
      }
    }

    if (addr >= 0xf0) return;

    const reply = this.buildReply(addr, cmd, body);
    if ((addr >> 4) === TYPE_REEL5 && cmd !== REEL5_LAMP_WRITE) {
      this.reelLog.push({ addr, cmd, body: body.slice(), ...(reply ? { reply: reply.slice() } : {}) });
      if (this.reelLog.length > REEL_LOG_FRAMES) this.reelLog.shift();
    }
    if (slave >= 0) this.lastTaken.set(slave, { toggle: addr & 1, reply: reply ? reply.slice() : null });
    if (!reply) return;
    this.queueReply(reply);
  }

  private queueReply(reply: readonly number[]): void {
    this.replyQueue.push(0x7f);
    for (const b of reply) {
      this.replyQueue.push(b);
      if (b === 0x7f) this.replyQueue.push(0x7f);
    }
    this.repliesSent++;
  }

  buildReply(addr: number, cmd: number, body: number[]): number[] | null {
    const type = addr >> 4;
    if (type !== TYPE_MUX5 && type !== TYPE_REEL5) return null;
    if (type === TYPE_REEL5) {
      const reel = this.reel5At(addr);
      if (!reel) return null;
      reel.observe(cmd, body);
    }
    const payload = this.replyPayload(type, cmd, body);
    if (!payload) return null;
    const replyBody = [addr, ...payload];
    const crc = barbusCrc16(SLAVE_SEED, replyBody);
    return [...replyBody, crc & 0xff, crc >> 8];
  }

  private static hasLength(cmd: number): boolean {
    return cmd === 0x8f || cmd === 0x9f;
  }

  private replyPayload(type: number, cmd: number, body: number[]): number[] | null {
    const sub = body[2];
    if (cmd === 0x00) return [0xf1, 0xf0];
    if (cmd === 0xf1) {
      if (sub === 0xfd) {
        return type === TYPE_MUX5 ? [0x01, this.mux5Extended ? 0x08 : 0x00] : [0x02, 0x00, 0x12];
      }
      if (type === TYPE_MUX5) return [0x03, 0x01, 0x00, 0x03];
      const unit = (body[0] >> 1) & 3;
      const j = this.reelJumpers;
      if (sub === 0xfa) {
        const [lo1, hi1, lo2, hi2] = j?.units[unit] ?? [0, 0, 0, 0];
        return [0x04, hi1 & 0xff, hi2 & 0xff, ~lo1 & 0xfa, ~lo2 & 0xf8];
      }
      return [0x03, 0x01, ((j?.mode ?? 0) >> unit) & 1, 0x03];
    }

    if (type === TYPE_MUX5) {
      if ((cmd >= 0xb0 && cmd <= 0xbf) || (cmd >= 0x80 && cmd <= 0x8f)) {
        const word = ((body[0] >> 1) & 3) === 0 ? this.inputs : 0;
        return [0x02, (word >> 8) & 0xff, word & 0xff];
      }
      const unit = (body[0] >> 1) & 7;
      if ((cmd & 0xf0) === 0xc0) { this.muxSenseHold[unit] = (sub ?? 0) + 1; return [0x00]; }
      if ((cmd & 0xf0) === 0xd0) return [0x01, this.muxSense(unit)];
      return [0x00];
    }

    const reel = this.reel5At(body[0]) ?? this.reel5;
    if (cmd === 0x70) {
      const [busyMask, tabMask] = reel.poll();
      return [0x02, busyMask, tabMask];
    }
    if (cmd === 0xa1) {
      const moving = reel.moving(sub);
      const mark = moving ? 0x0b : 0xff;
      const pos = moving ? reel.livePosition(sub) : reel.position(sub);
      const lo = pos & 0xff;
      const hi = (pos >> 8) & 0xff;
      if (lo < 0x7f ? hi !== 0 : hi !== 0xff) return [0x03, mark, hi, lo];
      return [0x02, mark, lo];
    }
    if (cmd === 0x8f) {
      const units = Math.max(0, Math.round(
        reel.shortfall(Barbus.hasLength(cmd) ? body[3] : body[2])));
      return [0x02, (units >> 8) & 0xff, units & 0xff];
    }
    if ((cmd & 0xf0) === 0x50) {
      return [0x01, reel.appendFree((cmd & 0xf) === 0xf ? body[3] : body[2]) & 0xff];
    }
    const unit = (body[0] >> 1) & 3;
    if ((cmd & 0xf0) === 0xc0) { this.reelSenseHold[unit] = (sub ?? 0) + 1; return [0x00]; }
    if ((cmd & 0xf0) === 0xd0) return [0x01, this.reelSense(unit)];
    return [0x00];
  }

  get hasReply(): boolean {
    return this.replyQueue.length > 0;
  }

  pump(rxSpace: (channel: 0 | 1) => number, receive: (channel: 0 | 1, v: number) => void): void {
    while (this.replyQueue.length > 0 && rxSpace(this.channel) > 0) {
      receive(this.channel, this.replyQueue.shift()!);
    }
  }
}
