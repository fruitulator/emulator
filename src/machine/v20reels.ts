import { Reel } from '../hw/reel';
import type { ReelGeometry } from './layoutreels';

export const V20_STEP_TABLE: readonly (readonly number[])[] = [
  [0, 0, 2, 1, 0, 0, 3, 0, -2, -1, 0, 0, -3, 0, 0, 0],
  [0, -1, 1, 0, 3, 0, 2, 0, -3, -2, 0, 0, 0, 0, 0, 0],
  [0, -2, 0, -1, 2, 0, 1, 0, 0, -3, 0, 0, 3, 0, 0, 0],
  [0, -3, -1, -2, 1, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0],
  [0, 0, -2, -3, 0, 0, -1, 0, 2, 3, 0, 0, 1, 0, 0, 0],
  [0, 3, -3, 0, -1, 0, -2, 0, 1, 2, 0, 0, 0, 0, 0, 0],
  [0, 2, 0, 3, -2, 0, -3, 0, 0, 1, 0, 0, -1, 0, 0, 0],
  [0, 1, 3, 2, -3, 0, 0, 0, -1, 0, 0, 0, -2, 0, 0, 0],
];

export function v20OpticWindow(optoTab: number): [number, number] {
  switch (optoTab) {
    case 1: return [4, 6];
    case 2: return [1, 4];
    case 3: return [0, 4];
    case 4: return [6, 10];
    case 5: return [0, 2];
    case 6: return [0x76, 2];
    case 7: return [2, 4];
    case 8: return [2, 14];
    case 9: return [4, 8];
    case 10: return [0, 7];
    case 11: return [0, 2];
    default: return [6, 8];
  }
}

export function v20OpticWindowPhoenix(optoTab: number): [number, number] {
  switch (optoTab) {
    case 1: return [0x5f, 1];
    case 2: return [3, 5];
    case 3: return [1, 3];
    case 4: return [5, 7];
    default: return [0x5e, 2];
  }
}

const STAND_IN_HALF_STEPS = 0x60;
const STAND_IN_STOPS = 16;

interface V20Reel {
  pos: number;
  steps: number;
  last: number;
  winStart: number;
  winEnd: number;
  inverted: boolean;
  present: boolean;
}

export class V20Reels {
  private readonly r: V20Reel[] = [];
  readonly reels: Reel[] = [];
  optos = 0;
  readonly standIns: number[] = [];
  private presentMask = 0;

  constructor(
    readonly count: number,
    private readonly window: (optoTab: number) => [number, number] = v20OpticWindow,
  ) {
    for (let i = 0; i < count; i++) {
      this.r.push({
        pos: 0, steps: STAND_IN_HALF_STEPS, last: 0, winStart: 6, winEnd: 8, inverted: false, present: false,
      });
      this.reels.push(new Reel({ stepsPerRevolution: STAND_IN_HALF_STEPS, symbols: STAND_IN_STOPS }));
    }
  }

  setGeometry(geometry: readonly ReelGeometry[]): void {
    for (const g of geometry) {
      if (g.number < 0 || g.number >= this.count) continue;
      const r = this.r[g.number];
      r.present = true;
      if (g.halfSteps > 0) r.steps = g.halfSteps;
      else this.noteStandIn(g.number);
      r.inverted = g.invertedOpto;
      [r.winStart, r.winEnd] = this.window(g.optoTab);
      if (!(g.stops > 0)) this.noteStandIn(g.number);
      this.reels[g.number] = new Reel({
        stepsPerRevolution: r.steps,
        symbols: g.stops > 0 ? g.stops : STAND_IN_STOPS,
      });
    }
    this.presentMask = 0;
    this.r.forEach((r, i) => { if (r.present) this.presentMask |= 1 << i; });
    this.optos = this.opticByte();
  }

  private noteStandIn(n: number): void {
    if (this.standIns.includes(n)) return;
    this.standIns.push(n);
    this.standIns.sort((a, b) => a - b);
  }

  setPosition(i: number, pos: number): void {
    const r = this.r[i];
    if (!r) return;
    r.pos = ((pos % r.steps) + r.steps) % r.steps;
    this.reels[i].position = r.pos;
    this.optos = this.opticByte();
  }

  step(i: number, c: number): void {
    const r = this.r[i];
    if (!r || !c) return;
    if ((((r.last ^ c) + 1) & 0xf) <= 1) return;
    r.last = c;
    if (!r.present) return;
    const d = V20_STEP_TABLE[r.pos & 7][c];
    if (!d) return;
    r.pos = (r.pos + d + r.steps) % r.steps;
    this.reels[i].position = r.pos;
    this.reels[i].travel += d;
    this.optos = this.opticByte();
  }

  reset(): void {
    for (const r of this.r) r.last = 0;
    this.optos = this.opticByte();
  }

  get state(): readonly Readonly<V20Reel>[] { return this.r; }

  private opticByte(): number {
    let o = 0;
    for (let i = 0; i < this.count; i++) {
      const r = this.r[i];
      if (r.winStart === r.winEnd) continue;
      const inWin = r.winStart < r.winEnd
        ? r.winStart < r.pos && r.pos < r.winEnd
        : r.pos < r.winEnd || r.winStart < r.pos;
      if (inWin !== r.inverted) o |= 1 << i;
    }
    return o & this.presentMask;
  }
}
