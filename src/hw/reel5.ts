
const STEPS_PER_REV = 96;

const N_REELS = 5;

const CYCLES_PER_MS = 16_515.072;

export const FREE_RUN_CYCLES_PER_HALF_STEP = Math.round(767 * CYCLES_PER_MS / STEPS_PER_REV);

const OPCODE_FORWARD: Record<number, number> = {
  0x98: 0x9c,
  0x99: 0x9b,
  0x91: 0x93,
  0x90: 0x92,
};
const canon = (b: number): number => OPCODE_FORWARD[b] ?? b;
const isReverseHead = (b: number): boolean => b in OPCODE_FORWARD;
const FORWARD_HEADS = new Set([0x9c, 0x9b, 0x93, 0x92]);

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

interface Program {
  steps: number;
  dir: 1 | -1;
  cycles: number;
  loop: ProgramLoop | null;
  preCycles?: number;
  loopCycles?: number;
  raw?: number[];
  head?: number;
  bufStart?: number;
  spent?: number;
}

interface ReelState {
  configured: boolean;
  position: number;
  queue: Program[];
  acc: number;
  travel: number;
  lastDir: 1 | -1;
  shortfall: number;
  appendFree?: number;
}

function busy(r: ReelState): boolean {
  return r.queue.length > 0;
}

const FLAG_HALF_STEPS = 2;

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

function liveRepeat(p: Program, elapsed: number): number {
  const loop = p.loop;
  if (!loop) return 0;
  if (loop.stride <= 0) {
    if (!p.loopCycles || p.preCycles === undefined) return 0;
    if (elapsed < p.preCycles) return loop.repeat;
    const done = 1 + Math.floor((elapsed - p.preCycles) / p.loopCycles);
    return Math.max(0, loop.repeat - done);
  }
  if (p.steps <= loop.tail) return 0;
  return Math.max(0, Math.min(loop.repeat, Math.ceil((p.steps - loop.tail) / loop.stride)));
}

function onFlag(r: ReelState, steps: number): boolean {
  const d = Math.min(r.position, steps - r.position);
  return d <= FLAG_HALF_STEPS;
}

const PROGRAM_BUFFER = 0x12;

function programCounterAt(b: number[], ms: number): number {
  const bytes = b.slice();
  let t = 0;
  for (let i = 0, guard = 0; i < bytes.length && guard < 1_000_000; guard++) {
    const ch = bytes[i];
    if (ch & 0x80) {
      const kind = ch & 7;
      if (kind === 7) return -1;
      if (kind === 6) {
        const n = ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
        if (n === 0) { i += 3; continue; }
        bytes[i + 1] = ((n - 1) >> 8) & 0xff;
        bytes[i + 2] = (n - 1) & 0xff;
        i -= ((ch >> 3) & 0xf);
        continue;
      }
      i += kind === 5 ? 2 : 1;
      continue;
    }
    const d = ch & 0x40 ? 256 * (ch & 0x3f) + (bytes[i + 1] ?? 0) : ch;
    i += ch & 0x40 ? 2 : 1;
    t += d;
    if (ms < t) return i;
  }
  return bytes.length;
}

function decodeProgram(bytes: number[]): Program | null {
  const dir = isReverseHead(bytes[0]) ? -1 : FORWARD_HEADS.has(bytes[0]) ? 1 : 0;
  if (dir === 0) return null;
  const raw = bytes.slice(1);
  const profile = raw.map(canon);
  const loop = walkLoop(bytes, dir as 1 | -1);
  const n = loop?.repeat ?? 0;
  void profile;
  const law = programLaw(bytes, dir as 1 | -1);
  const steps = law.base + law.per * n;
  const ms = law.baseMs + law.perMs * n;
  const at = loopIndex(bytes);
  const timing = at < 0 ? {} : {
    preCycles: spanMs(bytes, 0, at) * CYCLES_PER_MS,
    loopCycles: law.perMs * CYCLES_PER_MS,
  };
  return { steps, dir: dir as 1 | -1, loop, cycles: (ms * CYCLES_PER_MS) / Math.max(1, steps), ...timing };
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

export class Reel5 {
  static readonly snapshotConfig: readonly string[] = ['revolution'];

  readonly lampDuty = new ReelLampDuty();

  private readonly revolution: number[] = Array.from({ length: N_REELS }, () => STEPS_PER_REV);

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

  private readonly reels: ReelState[] = Array.from({ length: N_REELS }, () => ({
    configured: false,
    position: 0,
    travel: 0,
    shortfall: 0,
    lastDir: 1,
    queue: [],
    acc: 0,
  }));

  private pending = 0;
  private deadline = 0;

  reset(): void {
    for (const r of this.reels) {
      r.configured = false;
      r.travel = 0;
      r.queue = [];
      r.acc = 0;
    }
    this.pending = 0;
    this.deadline = 0;
    this.lampDuty.reset();
  }

  private static bit(reelNum: number): number {
    return 1 << reelNum;
  }

  private reel(reelNum: number): ReelState | null {
    return reelNum >= 0 && reelNum < N_REELS ? this.reels[reelNum] : null;
  }

  configuredSlots(): number[] {
    const out: number[] = [];
    for (let i = 0; i < N_REELS; i++) if (this.reels[i].configured) out.push(i);
    return out;
  }

  observe(cmd: number, body: number[]): void {
    this.sync();
    this.observeCommand(cmd, body);
    this.deadline = this.nextEvent();
  }

  private observeCommand(cmd: number, body: number[]): void {
    if ((cmd & 0xf0) === 0xe0 && (cmd & 0xf) !== 0) {
      const long = (cmd & 0xf) === 0xf;
      const at = long ? 3 : 2;
      const len = long ? (body[2] ?? 0) : cmd & 0xf;
      this.lampDuty.command(body.slice(at, at + len));
      return;
    }
    if ((cmd & 0xf0) === 0x50) {
      const long = (cmd & 0xf) === 0xf;
      const r = this.reel(body[long ? 3 : 2]);
      if (r) this.appendBytes(r, body.slice(long ? 4 : 3));
      return;
    }
    if (cmd === 0xf5) {
      const r = this.reel(body[3]);
      if (r) {
        r.configured = true;
        r.queue = [];
      }
      return;
    }
    const isProgram = (cmd & 0xf0) === 0x90;
    const hasLengthByte = cmd === 0x8f || cmd === 0x9f;
    const r = this.reel(hasLengthByte ? body[3] : body[2]);
    if (!r || !r.configured) return;
    if (cmd === 0x8f) {
      const words: number[] = [];
      for (let i = 4; i + 1 < body.length; i += 2) words.push((body[i] << 8) | body[i + 1]);
      const p = r.queue[0];
      let removed = 0;
      if (p?.loop) {
        let R = liveRepeat(p, p.steps === 0 ? r.acc : 0);
        const span = 2 * words[0];
        if (span > 0) while (span < R) { R -= span; removed += span; }
        for (let i = 1; i < words.length; i++) {
          if (words[i] < R) { R -= words[i]; removed += words[i]; break; }
        }
        p.loop.repeat -= removed;
        p.steps -= removed * p.loop.stride;
        if (p.steps === 0 && p.loopCycles) p.cycles = Math.max(0, p.cycles - removed * p.loopCycles);
      }
      r.shortfall = removed;
    } else if (isProgram) {
      const from = cmd === 0x9f ? 4 : 3;
      let at = from;
      while (at < body.length && !isReverseHead(body[at]) && !FORWARD_HEADS.has(body[at])) at++;
      const prog = decodeProgram(body.slice(at));
      if (prog) {
        const raw = body.slice(from);
        prog.raw = raw;
        prog.head = at - from;
        prog.bufStart = PROGRAM_BUFFER - raw.length;
        prog.spent = 0;
        r.lastDir = prog.dir;
        r.queue.push(prog);
      }
    }
  }

  private appendBytes(r: ReelState, bytes: number[]): void {
    const p = r.queue[r.queue.length - 1];
    if (!p || !p.raw || p.head === undefined || p.bufStart === undefined) {
      r.appendFree = 0xff;
      return;
    }
    const isHead = p === r.queue[0];
    const ms = isHead ? ((p.spent ?? 0) + r.acc) / CYCLES_PER_MS : 0;
    const pc = programCounterAt(p.raw, ms);
    if (pc < 0) { r.appendFree = 0xff; return; }
    let room = p.bufStart + pc;
    for (let i = pc; i < p.raw.length && p.bufStart + i < PROGRAM_BUFFER;) {
      const ch = p.raw[i];
      if (ch & 0x80) {
        const kind = ch & 7;
        if (kind === 7) break;
        if (kind === 6) { room = Math.min(room, p.bufStart + i - ((ch >> 3) & 0xf)); break; }
        i += kind === 5 ? 2 : 1;
        continue;
      }
      i += ch & 0x40 ? 2 : 1;
    }
    room = Math.max(0, room);
    r.appendFree = room;
    const k = Math.min(room, bytes.length);
    if (k === 0) return;
    const before = decodeProgram(p.raw.slice(p.head));
    const raw = [...p.raw, ...bytes.slice(0, k)];
    const after = decodeProgram(raw.slice(p.head));
    p.raw = raw;
    p.bufStart -= k;
    if (!before || !after) return;
    const ds = after.steps - before.steps;
    const dCycles = after.steps * after.cycles - before.steps * before.cycles;
    const left = p.steps * p.cycles + dCycles;
    p.steps = Math.max(0, p.steps + ds);
    if (p.steps > 0) p.cycles = Math.max(1, left / p.steps);
    else if (before.steps === 0) p.cycles = Math.max(1, p.cycles + dCycles);
    if (p.loop && after.loop) p.loop.tail = after.loop.tail;
    else if (!p.loop) p.loop = after.loop;
  }

  appendFree(reelNum: number): number {
    return this.reel(reelNum)?.appendFree ?? 0xff;
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
    const cycles = this.pending;
    this.pending = 0;
    if (cycles > 0) this.advance(cycles);
    this.deadline = this.nextEvent();
  }

  private nextEvent(): number {
    let next = 1 << 30;
    for (const r of this.reels) {
      if (!busy(r)) continue;
      const need = r.queue[0].cycles - r.acc;
      if (need < next) next = need;
    }
    return next < 1 ? 1 : next;
  }

  private advance(cycles: number): void {
    for (let i = 0; i < N_REELS; i++) {
      const r = this.reels[i];
      if (!busy(r)) continue;
      r.acc += cycles;
      while (r.queue.length > 0) {
        const p = r.queue[0];
        if (p.steps === 0) {
          if (r.acc < p.cycles) break;
          r.acc -= p.cycles;
          p.spent = (p.spent ?? 0) + p.cycles;
          r.queue.shift();
          continue;
        }
        const steps = Math.floor(r.acc / p.cycles);
        if (steps <= 0) break;
        const take = Math.min(steps, p.steps);
        r.acc -= take * p.cycles;
        p.spent = (p.spent ?? 0) + take * p.cycles;
        r.position = wrap(r.position + p.dir * take, this.revolution[i]);
        r.travel += p.dir * take;
        p.steps -= take;
        if (p.steps <= 0) r.queue.shift();
      }
      if (!busy(r)) r.acc = 0;
    }
  }

  poll(): [number, number] {
    this.sync();
    let flagOff = 0;
    let atRest = 0;
    for (let i = 0; i < N_REELS; i++) {
      const r = this.reels[i];
      if (!r.configured) continue;
      const bit = Reel5.bit(i);
      if (!onFlag(r, this.revolution[i])) flagOff |= bit;
      if (!busy(r)) atRest |= bit;
    }
    return [flagOff, atRest];
  }

  position(reelNum: number): number {
    this.sync();
    const r = this.reel(reelNum);
    if (!r) return 0;
    let p = r.position;
    for (const prog of r.queue) p += prog.dir * prog.steps;
    return wrap(p, this.revolution[reelNum]);
  }

  moving(reelNum: number): boolean {
    this.sync();
    const r = this.reel(reelNum);
    return r ? busy(r) : false;
  }

  setPosition(reelNum: number, pos: number): void {
    const r = this.reel(reelNum);
    if (!r) return;
    this.sync();
    r.position = wrap(Math.round(pos), this.revolution[reelNum]);
    r.queue = [];
    this.deadline = this.nextEvent();
  }

  livePosition(reelNum: number): number {
    this.sync();
    return this.reel(reelNum)?.position ?? 0;
  }

  queuedTravel(reelNum: number): number {
    this.sync();
    const r = this.reel(reelNum);
    if (!r) return 0;
    let n = 0;
    for (const p of r.queue) n += p.steps;
    return n;
  }

  shortfall(reelNum: number): number {
    return this.reel(reelNum)?.shortfall ?? 0;
  }

  liveTravel(reelNum: number): number {
    this.sync();
    return this.reel(reelNum)?.travel ?? 0;
  }
}
