import { Reel } from './reel';
import type { ReelGeometry } from '../machine/layoutreels';
import { opticWindowForFlag } from '../layout/datreels';

const SWAP = [0, 1, 4, 5, 2, 3, 6, 7, 8, 9, 12, 13, 10, 11, 14, 15];

const STEP: readonly (readonly number[])[] = [
  [0, 0, 2, 1, 0, 0, 3, 0, -2, -1, 0, 0, -3, 0, 0, 0],
  [0, -1, 1, 0, 3, 0, 2, 0, -3, -2, 0, 0, 0, 0, 0, 0],
  [0, -2, 0, -1, 2, 0, 1, 0, 0, -3, 0, 0, 3, 0, 0, 0],
  [0, -3, -1, -2, 1, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0],
  [0, 0, -2, -3, 0, 0, -1, 0, 2, 3, 0, 0, 1, 0, 0, 0],
  [0, 3, -3, 0, -1, 0, -2, 0, 1, 2, 0, 0, 0, 0, 0, 0],
  [0, 2, 0, 3, -2, 0, -3, 0, 0, 1, 0, 0, -1, 0, 0, 0],
  [0, 1, 3, 2, -3, 0, 0, 0, -1, 0, 0, 0, -2, 0, 0, 0],
];

const SETTLE = 1000;
const SETTLE6 = 0xdac;

const OPTIC_INVERTED = true;

export class EpochReels {
  readonly reels: readonly Reel[];

  private readonly last: Int8Array;

  private readonly drive = [0, 0];
  private timer = 0;

  private readonly opticInverted: boolean;
  private readonly windows: { start: number; width: number }[];

  readonly reelBoard: 3 | 6;
  private latch6 = 0;
  private slot5 = 0;
  private readonly bank6 = new Uint8Array(4);

  constructor(
    geometry: readonly ReelGeometry[],
    options: { opticInverted?: boolean; reelBoard?: 3 | 6 } = {},
  ) {
    this.opticInverted = options.opticInverted ?? OPTIC_INVERTED;
    this.reelBoard = options.reelBoard ?? 3;
    const geo = this.reelBoard === 6 && geometry.length
      ? Array.from({ length: 6 }, (_, n) => geometry.find((g) => g.number === n) ?? { ...geometry[0], number: n })
      : geometry.length ? geometry : [];
    this.reels = geo.map((g) => new Reel({
      stepsPerRevolution: g.halfSteps,
      symbols: g.stops,
      opticStart: g.optoTab,
    }));
    this.windows = geo.map((g) => opticWindowForFlag(g.optoTab));
    this.last = new Int8Array(this.reels.length);
  }

  reset(): void {
    for (const r of this.reels) r.travel = 0;
    this.drive[0] = this.drive[1] = 0;
    this.latch6 = this.slot5 = 0;
    this.bank6.fill(0);
    this.timer = 0;
  }

  setPosition(i: number, pos: number): void {
    this.reels[i]?.park(pos);
  }

  write(byte: 0 | 1, value: number): void {
    const v = value & 0xff;
    if (this.reelBoard === 6) { this.write6(byte, v); return; }
    if (v === this.drive[byte]) return;
    this.drive[byte] = v;
    if (v !== 0) this.timer = SETTLE;
  }

  tick(cycles: number): void {
    if (this.timer <= 0) return;
    this.timer -= cycles;
    if (this.timer > 0) return;
    this.timer = 0;
    if (this.reelBoard === 6) {
      const [a, a3, b, b3] = this.bank6;
      this.step(0, a & 0x0f);
      this.step(1, (a >> 4) & 0x0f);
      this.step(2, a3 & 0x0f);
      this.step(3, b & 0x0f);
      this.step(4, (b >> 4) & 0x0f);
      this.step(5, b3 & 0x0f);
      return;
    }
    for (let b = 0; b < 2; b++) {
      const v = this.drive[b];
      this.step(b * 2, v & 0x0f);
      this.step(b * 2 + 1, (v >> 4) & 0x0f);
    }
  }

  private write6(byte: 0 | 1, v: number): void {
    if (byte === 0) { this.latch6 = v; return; }
    if (((this.slot5 ^ v) & 0x10) && ((v & 0x0f) !== 0 || this.latch6 !== 0)) {
      const i = (v & 0x10) ? 0 : 2;
      if (this.bank6[i] !== this.latch6 || this.bank6[i + 1] !== (v & 0x0f)) this.timer = SETTLE6;
      this.bank6[i] = this.latch6;
      this.bank6[i + 1] = v & 0x0f;
    }
    this.slot5 = v;
  }

  stepPair(pair: number, value: number): void {
    this.step(pair * 2, value & 0x0f);
    this.step(pair * 2 + 1, (value >> 4) & 0x0f);
  }

  private step(index: number, nibble: number): void {
    const reel = this.reels[index];
    if (!reel) return;
    const phase = SWAP[nibble & 0xf];
    if (phase === 0) return;
    if ((((this.last[index] ^ phase) + 1) & 0xf) <= 1) return;

    const delta = STEP[reel.position & 7][phase];
    this.last[index] = phase;
    if (!delta) return;
    const steps = reel.stepsPerRevolution;
    reel.position = (reel.position + delta + steps) % steps;
    reel.travel += delta;
  }

  optics(): number {
    let bits = 0;
    this.reels.forEach((r, i) => {
      const p = r.position;
      const w = this.windows[i];
      const inWindow = p >= w.start && p < w.start + w.width;
      if (inWindow === this.opticInverted) return;
      bits |= 1 << i;
    });
    return bits;
  }
}
