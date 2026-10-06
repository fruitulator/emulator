import type { Machine, NoteResult } from '../src/machine/machine';
import type { InputEvent } from '../src/machine/replay';
import { captureState } from './snapshot';

export type RelayInput = InputEvent & { seq: number };

export interface SessionPoint { cycle: number; seq: number }

export interface Check extends SessionPoint { hash: string; signals: string }

export interface CheckResult extends Check {
  mine: { hash: string; signals: string; cycle: number; seq: number };
  ok: boolean;
  why?: string;
}

export function hashText(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export function stateHash(m: Machine): string {
  settleSound(m);
  return snapshotHash(captureState(m, ''));
}

const OUTPUT_STAGE = new Set(['ringRead', 'ringWrite', 'acc', 'accCycles', 'hpIn', 'hpOut']);

const NOT_STATE = new Set([
  'lampOut', 'lampSnapshot', 'digitSnapshot', 'pcRing', 'srRing', 'pcSampleCount', 'sliceEnd', 'displayRefreshAcc',
  'irqDirty', 'wasmCsEpoch',
]);

function hashable(this: unknown, key: string, value: unknown): unknown {
  if (NOT_STATE.has(key)) return undefined;
  const holder = this as Record<string, unknown> | null;
  if (holder && typeof holder === 'object' && 'ringRead' in holder && OUTPUT_STAGE.has(key)) return undefined;
  return value;
}

export function diffPaths(a: unknown, b: unknown, max = 12): string[] {
  const out: string[] = [];
  const ja = JSON.parse(JSON.stringify(a, hashable)) as unknown;
  const jb = JSON.parse(JSON.stringify(b, hashable)) as unknown;
  const walk = (x: unknown, y: unknown, p: string): void => {
    if (out.length >= max || JSON.stringify(x) === JSON.stringify(y)) return;
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], p ? `${p}.${k}` : k);
      }
    } else {
      out.push(p);
    }
  };
  walk(ja, jb, '');
  return out;
}

export function settleSound(m: Machine): void {
  try { m.audioSource?.buffered(); } catch {  }
}

export function snapshotHash(s: { cycles: number; state: unknown }): string {
  return hashText(JSON.stringify([s.cycles, s.state], hashable));
}

export function signalsOf(m: Machine): string {
  const reels = (m.reels ?? []).map((r) => (r ? r.position : -1)).join(',');
  let lamps = '';
  for (let n = 0; n < 256; n += 4) {
    let nib = 0;
    for (let k = 0; k < 4; k++) if (m.layoutLamp(n + k)) nib |= 1 << k;
    lamps += nib.toString(16);
  }
  return `${reels}|${lamps}`;
}

export function applyInput(m: Machine, e: InputEvent): void {
  switch (e.kind) {
    case 'press': m.layoutInput(e.id, true); break;
    case 'release': m.layoutInput(e.id, false); break;
    case 'coin': m.insertCoin(e.bit); break;
    case 'note': {
      const r: NoteResult | undefined = e.parallel ? m.insertParallelNote?.(e.billType) : m.insertNote?.(e.billType);
      void r;
      break;
    }
    case 'sw': (m as Machine & { setSwitch?(id: number, on: boolean): void }).setSwitch?.(e.id, e.on); break;
  }
}

export class Follower {
  cycle: number;
  next: number;
  horizon: number;
  private readonly queue: RelayInput[] = [];
  private readonly checks: Check[] = [];
  drift: string | null = null;

  constructor(at: SessionPoint) {
    this.cycle = at.cycle;
    this.next = at.seq;
    this.horizon = at.cycle;
  }

  get lag(): number { return Math.max(0, this.horizon - this.cycle); }

  feed(inputs: readonly RelayInput[], upTo: number): void {
    for (const e of inputs) {
      const last = this.queue.length ? this.queue[this.queue.length - 1].seq : this.next - 1;
      if (e.seq <= last) continue;
      if (e.seq !== last + 1) {
        this.drift ??= `inputs ${last + 1}..${e.seq - 1} never arrived`;
        return;
      }
      this.queue.push(e);
      this.horizon = Math.max(this.horizon, e.cycle);
    }
    this.horizon = Math.max(this.horizon, upTo);
  }

  expect(k: Check): void {
    if (k.cycle < this.cycle || k.seq < this.next) return;
    this.checks.push(k);
    this.checks.sort((x, y) => x.seq - y.seq || x.cycle - y.cycle);
  }

  advance(m: Machine, want: number, onCheck: (k: Check, at: SessionPoint) => void): number {
    if (this.drift) return 0;
    const limit = Math.min(this.cycle + Math.max(0, want), this.horizon);
    let ran = 0;
    for (;;) {
      this.due(m, onCheck);
      if (this.drift || this.cycle >= limit) break;
      let stop = limit;
      if (this.queue.length) stop = Math.min(stop, this.queue[0].cycle);
      if (this.checks.length) stop = Math.min(stop, this.checks[0].cycle);
      if (stop <= this.cycle) break;
      const r = m.run(stop - this.cycle);
      if (r <= 0) break;
      this.cycle += r;
      ran += r;
    }
    return ran;
  }

  private due(m: Machine, onCheck: (k: Check, at: SessionPoint) => void): void {
    for (;;) {
      const e = this.queue[0];
      const k = this.checks[0];
      const eDue = !!e && e.cycle <= this.cycle;
      const kDue = !!k && k.cycle <= this.cycle;
      if (kDue && (!eDue || k.seq <= e.seq)) {
        this.checks.shift();
        if (k.cycle !== this.cycle) this.drift ??= `ran past a keyframe at ${k.cycle} to ${this.cycle}`;
        onCheck(k, { cycle: this.cycle, seq: this.next });
        continue;
      }
      if (!eDue) return;
      this.queue.shift();
      if (e.cycle !== this.cycle) {
        this.drift ??= `an input for ${e.cycle} landed at ${this.cycle}`;
        return;
      }
      applyInput(m, e);
      this.next = e.seq + 1;
    }
  }
}

export function followBudget(elapsedCycles: number, lag: number, buffer: number): number {
  const rate = lag > buffer * 4 ? 2 : lag > buffer * 1.5 ? 1.25 : lag < buffer * 0.5 ? 0.8 : 1;
  return Math.floor(elapsedCycles * rate);
}
