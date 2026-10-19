
import { V20_STEP_TABLE } from './v20steptable';

const STEPS_PER_REV = 96;

const N_REELS = 5;

export const TICK_CYCLES = 20_000;

export const FREE_RUN_CYCLES_PER_HALF_STEP = Math.round((13 * TICK_CYCLES) / 2);

export const RAMP_LAWS: { profile: number[]; base: number; per: number; baseMs: number; perMs: number }[] = [
  { profile: [0x23], base: 16, per: 2, baseMs: 150, perMs: 13 },
  { profile: [0x1b], base: 16, per: 2, baseMs: 131, perMs: 11 },
  { profile: [0x20, 0x18], base: 10, per: 2, baseMs: 111, perMs: 16 },
  { profile: [0x20, 0x30], base: 6, per: 0, baseMs: 81, perMs: 0 },
  { profile: [0x3a], base: 4, per: 0, baseMs: 59, perMs: 0 },
  { profile: [0x0e], base: 2, per: 0, baseMs: 60, perMs: 0 },
  { profile: [0x30, 0x18], base: 9, per: 1, baseMs: 201, perMs: 16 },
  { profile: [0x30, 0x93], base: 4, per: 1, baseMs: 144, perMs: 26 },
  { profile: [0x40], base: 2, per: 0, baseMs: 94, perMs: 0 },
];

const moveStep = (op: number): number => (op & 7) - 2;

function spanSteps(b: number[], from: number, to: number, last: number): number {
  let steps = 0;
  let cur = last;
  let setDelay = false;
  for (let i = Math.max(0, from); i < Math.min(to, b.length);) {
    const ch = b[i];
    if (ch & 0x80) {
      const kind = ch & 7;
      if (kind === 7) break;
      if (kind === 6) { i += 3; continue; }
      if (kind === 5) { i += 2; continue; }
      cur = ch;
      setDelay = true;
      steps += moveStep(ch);
      i++;
      continue;
    }
    if (!setDelay) steps += moveStep(cur);
    setDelay = false;
    i += (ch & 0x40) ? 2 : 1;
  }
  return steps;
}

interface ProgramLoop {
  preLoop: number;
  stride: number;
  repeat: number;
  tail: number;
}

function walkLoop(b: number[], dir: 1 | -1): ProgramLoop | null {
  let last = b[0];
  let setDelay = false;
  let steps = 0;
  for (let i = 0; i < b.length;) {
    const ch = b[i];
    if (ch & 0x80) {
      const kind = ch & 7;
      if (kind === 7) return null;
      if (kind === 6) {
        const dist = (ch >> 3) & 0xf;
        return {
          preLoop: dir * steps,
          stride: dir * spanSteps(b, i - dist, i, last),
          repeat: (b[i + 1] << 8) | b[i + 2],
          tail: dir * spanSteps(b, i + 3, b.length, last),
        };
      }
      if (kind === 5) { i += 2; continue; }
      last = ch;
      setDelay = true;
      steps += moveStep(ch);
      i++;
      continue;
    }
    if (!setDelay) steps += moveStep(last);
    setDelay = false;
    i += (ch & 0x40) ? 2 : 1;
  }
  return null;
}

function spanMs(b: number[], from: number, to: number): number {
  let ms = 0;
  for (let i = Math.max(0, from); i < Math.min(to, b.length);) {
    const ch = b[i];
    if (ch & 0x80) {
      const kind = ch & 7;
      if (kind === 7) break;
      i += kind === 6 ? 3 : kind === 5 ? 2 : 1;
      continue;
    }
    if (ch & 0x40) { ms += 256 * (ch & 0x3f) + (b[i + 1] ?? 0); i += 2; } else { ms += ch; i++; }
  }
  return ms;
}

function loopIndex(b: number[]): number {
  for (let i = 0; i < b.length;) {
    const ch = b[i];
    if (ch & 0x80) {
      const kind = ch & 7;
      if (kind === 7) return -1;
      if (kind === 6) return i;
      i += kind === 5 ? 2 : 1;
      continue;
    }
    i += (ch & 0x40) ? 2 : 1;
  }
  return -1;
}

export function programLaw(b: number[], dir: 1 | -1): { base: number; per: number; baseMs: number; perMs: number } {
  const at = loopIndex(b);
  const loop = at < 0 ? null : walkLoop(b, dir);
  return {
    base: loop ? loop.preLoop + loop.tail : dir * spanSteps(b, 0, b.length, b[0]),
    per: loop ? loop.stride : 0,
    baseMs: spanMs(b, 0, b.length),
    perMs: at < 0 ? 0 : spanMs(b, at - ((b[at] >> 3) & 0xf), at),
  };
}

class ReelLampDuty {
  private readonly a = new Int32Array(3);
  private readonly b = new Int32Array(8);
  private readonly levels = new Uint8Array(3 * 4);

  constructor() {
    this.reset();
  }

  reset(): void {
    this.a.fill(0x1f);
    this.b.fill(0xfa);
    for (let row = 0; row < 3; row++) {
      this.levels[row * 4] = 0;
      this.levels[row * 4 + 1] = 0;
      this.levels[row * 4 + 2] = 0;
      this.levels[row * 4 + 3] = 0xff;
    }
  }

  level(row: number, state: number): number {
    return row >= 0 && row < 3 ? this.levels[row * 4 + (state & 3)] : 0;
  }

  command(payload: number[]): void {
    const n = payload.length;
    if (n === 1 || n === 2) {
      for (let row = 0; row < 3; row++) this.setA(row, payload[0]);
      if (n === 2) for (let i = 0; i < 8; i++) this.setB(i, payload[1]);
      return;
    }
    if (n === 3 || n === 11) {
      for (let row = 0; row < 3; row++) this.setA(row, payload[row]);
      if (n === 11) for (let i = 0; i < 8; i++) this.setB(i, payload[3 + i]);
    }
  }

  private setA(row: number, v: number): void {
    const byte = v & 0xff;
    if (this.a[row] === byte) return;
    this.a[row] = byte;
    this.rebuild(row);
  }

  private setB(i: number, v: number): void {
    const byte = v & 0xff;
    if (this.b[i] === byte) return;
    this.b[i] = byte;
    this.rebuild(i);
  }

  private rebuild(row: number): void {
    if (row >= 3 || this.b[row] === 0) return;
    const first = Math.min(0xff, Math.floor((this.a[row] * 0xff) / this.b[row]));
    this.levels[row * 4 + 1] = first;
    this.levels[row * 4 + 2] = 0xff - first;
  }
}

const wrap = (x: number, steps: number): number => ((x % steps) + steps) % steps;

const PROGRAM_BUFFER = 0x12;
const IDLE = 0xff;

const PHASE_PATTERN = [9, 1, 3, 2, 6, 4, 12, 8];

const PAST_BUFFER = 0x97;

const BUSY_REPLY = [0xf1, 0xf4];

interface ReelState {
  configured: boolean;
  delay: number;
  pc: number;
  buf: number[];
  lo: number;
  hi: number;
  last: number;
  phase: number;
  shown: number;
  repeat: boolean;
  optic: boolean;
  opt0: boolean;
  snap: boolean;
  position: number;
  drumPattern: number;
  travel: number;
  lastDir: 1 | -1;
  shortfall: number;
  appendFree?: number;
}

export class Reel5 {
  static readonly snapshotConfig: readonly string[] = ['revolution'];

  readonly lampDuty = new ReelLampDuty();

  private readonly revolution: number[] = Array.from({ length: N_REELS }, () => STEPS_PER_REV);

  private readonly reels: ReelState[] = Array.from({ length: N_REELS }, () => ({
    configured: false,
    delay: 0,
    pc: IDLE,
    buf: new Array<number>(PROGRAM_BUFFER).fill(0),
    lo: 0,
    hi: 0,
    last: 0,
    phase: 0,
    shown: 0,
    repeat: false,
    optic: false,
    opt0: false,
    snap: false,
    position: 0,
    drumPattern: 0,
    travel: 0,
    lastDir: 1,
    shortfall: 0,
  }));

  private seen = 0;
  private flagOff = 0;

  private pending = 0;
  private deadline = 0;
  private phaseCycles = 0;

  setRevolution(reelNum: number, steps: number): void {
    const r = this.reel(reelNum);
    if (!r || !Number.isInteger(steps) || steps <= 0) return;
    this.sync();
    this.revolution[reelNum] = steps;
    r.position = wrap(r.position, steps);
  }

  revolutionOf(reelNum: number): number {
    return this.revolution[reelNum] ?? STEPS_PER_REV;
  }

  reset(): void {
    this.sync();
    for (const r of this.reels) {
      r.configured = false;
      r.pc = IDLE;
      r.lo = 0;
      r.hi = 0;
      r.delay = 0;
      r.phase = 0;
      r.shown = 0;
      r.snap = false;
      r.opt0 = false;
      r.travel = 0;
    }
    this.seen = 0;
    this.flagOff = 0;
    this.deadline = this.nextEvent();
    this.lampDuty.reset();
  }

  private reel(reelNum: number): ReelState | null {
    return reelNum >= 0 && reelNum < N_REELS ? this.reels[reelNum] : null;
  }

  configuredSlots(): number[] {
    const out: number[] = [];
    for (let i = 0; i < N_REELS; i++) if (this.reels[i].configured) out.push(i);
    return out;
  }

  observe(cmd: number, body: number[]): number[] | null {
    this.sync();
    const reply = this.observeCommand(cmd, body);
    this.deadline = this.nextEvent();
    return reply;
  }

  private static data(cmd: number, body: number[]): number[] {
    const long = (cmd & 0xf) === 0xf;
    const at = long ? 3 : 2;
    const len = long ? (body[2] ?? 0) : cmd & 0xf;
    return body.slice(at, at + len);
  }

  private observeCommand(cmd: number, body: number[]): number[] | null {
    const kind = cmd >> 4;
    if (kind === 0xe) {
      if ((cmd & 0xf) !== 0) this.lampDuty.command(Reel5.data(cmd, body));
      return null;
    }
    if (kind === 0xf) {
      const data = body.slice(2);
      if (data[0] === 0xfc) {
        const r = this.reel(data[1]);
        if (r) {
          r.configured = true;
          r.opt0 = ((data[4] ?? 0) & 1) !== 0;
          r.snap = ((data[4] ?? 0) & 2) !== 0;
        }
        return null;
      }
      if (data[0] === 0xfb) {
        const r = this.reel(data[1]);
        if (!r) return null;
        if (r.pc !== IDLE) return BUSY_REPLY.slice();
        r.hi = (data[2] ?? 0) & 0xff;
        r.lo = (data[3] ?? 0) & 0xff;
        return null;
      }
      return null;
    }
    if (kind === 0x5) {
      const data = Reel5.data(cmd, body);
      const r = this.reel(data[0]);
      if (r) this.append(r, data);
      return null;
    }
    if (kind === 0x8) {
      const data = Reel5.data(cmd, body);
      const r = this.reel(data[0]);
      if (r) r.shortfall = this.adjustRepeat(r, data);
      return null;
    }
    if (kind === 0x9) {
      const data = Reel5.data(cmd, body);
      const r = this.reel(data[0]);
      if (!r) return null;
      return this.load(r, data[0], data);
    }
    return null;
  }

  private load(r: ReelState, wire: number, data: number[]): number[] | null {
    if (r.pc !== IDLE) return BUSY_REPLY.slice();
    const prog = data.slice(1, 1 + PROGRAM_BUFFER);
    const pc = PROGRAM_BUFFER - prog.length;
    for (let i = 0; i < prog.length; i++) r.buf[pc + i] = prog[i] & 0xff;
    r.pc = pc;
    r.repeat = false;
    this.seen &= ~(1 << wire);
    return null;
  }

  private static at(r: ReelState, i: number): number {
    return i >= 0 && i < PROGRAM_BUFFER ? r.buf[i] : PAST_BUFFER;
  }

  private adjustRepeat(r: ReelState, data: number[]): number {
    if (r.pc === IDLE) return 0;
    let i = r.pc;
    let b = Reel5.at(r, i);
    for (; i < PROGRAM_BUFFER; i++) {
      if (!(b & 0x80)) { if (b & 0x40) i++; }
      else {
        if ((b & 7) > 5) break;
        if ((b & 7) === 5) i++;
      }
      b = Reel5.at(r, i + 1);
    }
    if (i >= PROGRAM_BUFFER || (b & 7) === 7) return 0;
    const n = i + 1;
    const word = (k: number) => (((data[k] ?? 0) << 8) | (data[k + 1] ?? 0)) >>> 0;
    let R = (Reel5.at(r, n) << 8) | Reel5.at(r, n + 1);
    let removed = 0;
    const w0 = word(1);
    if (w0 > 0) while (2 * w0 < R) { R -= w0; removed += w0; }
    for (let k = 3; k + 1 < data.length; k += 2) {
      const w = word(k);
      if (w < R) { R -= w; removed += w; break; }
    }
    if (n < PROGRAM_BUFFER) r.buf[n] = (R >> 8) & 0xff;
    if (n + 1 < PROGRAM_BUFFER) r.buf[n + 1] = R & 0xff;
    return removed & 0xffff;
  }

  private append(r: ReelState, data: number[]): void {
    if (r.pc === IDLE) { r.appendFree = 0xff; return; }
    let room = r.pc;
    for (let i = r.pc; i < PROGRAM_BUFFER; i++) {
      const b = r.buf[i];
      if (!(b & 0x80)) { if (b & 0x40) i++; continue; }
      const kind = b & 7;
      if (kind === 7) break;
      if (kind === 6) { room = Math.min(room, i - ((b >> 3) & 0xf)); break; }
      if (kind === 5) i++;
    }
    room = Math.max(0, room);
    r.appendFree = room & 0xff;
    const bytes = data.slice(1);
    const k = Math.min(room, bytes.length);
    if (k === 0) return;
    r.buf = [...r.buf.slice(k), ...bytes.slice(0, k).map((b) => b & 0xff)];
    r.pc -= k;
  }

  tick(cycles: number): void {
    this.pending += cycles;
    if (this.pending >= this.deadline) this.flush();
  }

  private sync(): void {
    if (this.pending > 0) this.flush();
  }

  eventIn(): number {
    if (this.pending >= this.deadline) this.flush();
    return this.deadline - this.pending;
  }

  private flush(): void {
    const total = this.phaseCycles + this.pending;
    this.pending = 0;
    const ticks = Math.floor(total / TICK_CYCLES);
    this.phaseCycles = total - ticks * TICK_CYCLES;
    this.runTicks(ticks);
    this.deadline = this.nextEvent();
  }

  private live(r: ReelState): boolean {
    return r.pc !== IDLE || (r.optic && this.zeroed(r) !== null);
  }

  private zeroed(r: ReelState): [number, number] | null {
    const l3 = r.lo & 7;
    let lo = r.lo;
    let hi = r.hi;
    if (!r.snap) { if (l3 === 0) { lo = 0; hi = 0; } }
    else if (l3 < 4) { lo = l3; hi = 0; }
    else if (l3 > 4) { lo = r.lo | 0xf8; hi = 0xff; }
    return lo === r.lo && hi === r.hi ? null : [lo, hi];
  }

  private nextEvent(): number {
    let ticks = Infinity;
    for (const r of this.reels) {
      if (r.pc !== IDLE) ticks = Math.min(ticks, Math.max(1, r.delay));
      else if (r.optic && this.zeroed(r) !== null) ticks = 1;
    }
    if (ticks === Infinity) return 1 << 30;
    return ticks * TICK_CYCLES - this.phaseCycles;
  }

  private runTicks(ticks: number): void {
    while (ticks > 0) {
      if (!this.reels.some((r) => this.live(r))) return;
      let quiet = ticks - 1;
      for (const r of this.reels) {
        if (r.pc !== IDLE) quiet = Math.min(quiet, Math.max(0, r.delay - 1));
        else if (r.optic && this.zeroed(r) !== null) quiet = 0;
      }
      if (quiet > 0) {
        for (const r of this.reels) if (r.pc !== IDLE) r.delay -= quiet;
        ticks -= quiet;
        continue;
      }
      this.interpret();
      ticks--;
    }
  }

  private interpret(): void {
    for (let i = 0; i < N_REELS; i++) {
      const r = this.reels[i];
      let changed = false;
      if (r.optic) {
        const z = this.zeroed(r);
        if (z) { r.lo = z[0]; r.hi = z[1]; }
      }
      if (r.pc !== IDLE) {
        r.delay -= 1;
        if (r.delay < 1) changed = this.execute(r);
      }
      if (!changed) continue;
      this.stepDrum(r, i, r.phase);
      const steps = this.revolution[i];
      const d = wrap(r.position - 1, steps);
      const bit = 1 << i;
      if (d < 3 || d > steps - 2) {
        r.optic = true;
        this.flagOff &= ~bit;
        this.seen |= bit;
      } else {
        r.optic = false;
        this.flagOff |= bit;
      }
    }
  }

  private static step(r: ReelState, s: number): boolean {
    const v = ((((r.hi << 8) | r.lo) + s) & 0xffff) >>> 0;
    r.hi = v >> 8;
    r.lo = v & 0xff;
    r.phase = PHASE_PATTERN[r.lo & 7];
    if (r.phase === r.shown) return false;
    r.shown = r.phase;
    return true;
  }

  private execute(r: ReelState): boolean {
    let p = r.pc;
    let changed = false;
    for (let guard = 0; guard < 100_000; guard++) {
      const b = Reel5.at(r, p++);
      if (!(b & 0x80)) {
        if (r.repeat && Reel5.step(r, (r.last & 7) - 2)) changed = true;
        r.repeat = true;
        r.delay = b & 0x40 ? Reel5.at(r, p++) + 256 * (b & 0x3f) : b;
        r.pc = p;
        return changed;
      }
      const kind = b & 7;
      if (kind === 6) {
        const n = (Reel5.at(r, p) << 8) | Reel5.at(r, p + 1);
        if (n === 0) { p += 2; continue; }
        if (p < PROGRAM_BUFFER) r.buf[p] = ((n - 1) >> 8) & 0xff;
        if (p + 1 < PROGRAM_BUFFER) r.buf[p + 1] = (n - 1) & 0xff;
        p -= ((b >> 3) & 0xf) + 1;
        continue;
      }
      if (kind === 5) {
        r.last = b;
        r.phase = PHASE_PATTERN[Reel5.at(r, p++) & 7];
        continue;
      }
      if (kind === 7) {
        r.pc = IDLE;
        r.last = b;
        return changed;
      }
      r.repeat = false;
      r.last = b;
      if (Reel5.step(r, kind - 2)) changed = true;
    }
    r.pc = IDLE;
    return changed;
  }

  private stepDrum(r: ReelState, wire: number, pattern: number): void {
    if (pattern === 0 || (((r.drumPattern ^ pattern) + 1) & 0xf) <= 1) return;
    r.drumPattern = pattern;
    const steps = this.revolution[wire];
    const d = wrap(r.position - 1, steps);
    const move = V20_STEP_TABLE[d & 7][pattern & 0xf];
    if (move === 0) return;
    r.position = wrap(d + move + 1, steps);
    r.travel += move;
    r.lastDir = move > 0 ? 1 : -1;
  }

  poll(): [number, number] {
    this.sync();
    return [this.flagOff, this.seen];
  }

  a1Reply(reelNum: number): number[] {
    this.sync();
    const r = this.reel(reelNum);
    if (!r) return [0x02, IDLE, 0];
    const long = r.lo < 0x7f ? r.hi !== 0 : r.hi !== 0xff;
    return long ? [0x03, r.pc & 0xff, r.hi, r.lo] : [0x02, r.pc & 0xff, r.lo];
  }

  counter(reelNum: number): number {
    this.sync();
    const r = this.reel(reelNum);
    if (!r) return 0;
    const v = (r.hi << 8) | r.lo;
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  pc(reelNum: number): number {
    this.sync();
    return this.reel(reelNum)?.pc ?? IDLE;
  }

  moving(reelNum: number): boolean {
    return this.pc(reelNum) !== IDLE;
  }

  setPosition(reelNum: number, pos: number): void {
    const r = this.reel(reelNum);
    if (!r) return;
    this.sync();
    r.position = wrap(Math.round(pos), this.revolution[reelNum]);
    this.deadline = this.nextEvent();
  }

  livePosition(reelNum: number): number {
    this.sync();
    return this.reel(reelNum)?.position ?? 0;
  }

  queuedTravel(reelNum: number): number {
    this.sync();
    const r = this.reel(reelNum);
    if (!r || r.pc === IDLE) return 0;
    const c: ReelState = { ...r, buf: r.buf.slice() };
    const start = ((c.hi << 8) | c.lo) << 16 >> 16;
    let net = 0;
    let base = start;
    for (let guard = 0; guard < 1_000_000 && c.pc !== IDLE; guard++) {
      this.execute(c);
      const now = ((c.hi << 8) | c.lo) << 16 >> 16;
      net += ((now - base) << 16) >> 16;
      base = now;
    }
    return Math.abs(net);
  }

  loopBodyTravel(reelNum: number): number | null {
    this.sync();
    const r = this.reel(reelNum);
    if (!r || r.pc === IDLE) return null;
    for (let i = r.pc; i < PROGRAM_BUFFER; i++) {
      const b = r.buf[i];
      if (!(b & 0x80)) { if (b & 0x40) i++; continue; }
      const kind = b & 7;
      if (kind === 7) return null;
      if (kind === 6) {
        const body = (b >> 3) & 0xf;
        return spanSteps(r.buf, i - body, i, r.last);
      }
      if (kind === 5) i++;
    }
    return null;
  }

  shortfall(reelNum: number): number {
    return this.reel(reelNum)?.shortfall ?? 0;
  }

  appendFree(reelNum: number): number {
    return this.reel(reelNum)?.appendFree ?? 0xff;
  }

  liveTravel(reelNum: number): number {
    this.sync();
    return this.reel(reelNum)?.travel ?? 0;
  }
}
