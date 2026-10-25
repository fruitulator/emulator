import { EPOCH_LAMP_LEVELS, LAMP_FULL } from './framestate';

export const SETTLE_LIT = 10;
export const SETTLE_DIM = 1;

const N = 0x200;

export class EpochLampGlass {
  readonly byte = new Uint8Array(N);
  readonly lit = new Uint8Array(N);
  readonly demand = new Uint8Array(N);
  readonly rate = new Uint8Array(N);
  readonly dim = new Uint8Array(N);
  readonly bright = new Uint8Array(N);
  readonly count = new Int32Array(N);
  readonly shown = new Uint8Array(N);
  readonly shownDim = new Uint8Array(N);
  osc = 0;
  level = 0;
  queued = 0;

  reset(): void {
    this.byte.fill(0); this.lit.fill(0); this.demand.fill(0); this.rate.fill(0);
    this.dim.fill(0); this.bright.fill(0); this.count.fill(0);
    this.shown.fill(0); this.shownDim.fill(0);
    this.osc = 0; this.queued = 0;
  }

  private levelOf(): number { return EPOCH_LAMP_LEVELS[this.level & 7]; }

  private arm(n: number, c: number): void {
    if (this.count[n] === 0) this.queued++;
    this.count[n] = c;
  }

  private post(n: number): void {
    this.shown[n] = this.lit[n];
    this.shownDim[n] = this.dim[n];
  }

  private flashLit(n: number, r: number): number {
    return ((this.osc >> (r - 1)) & 1) !== (this.byte[n] >> 7) ? 1 : 0;
  }

  write(n: number, v: number): void {
    const diff = this.byte[n] ^ v;
    if (diff === 0) return;
    this.byte[n] = v;
    if (diff & 0x40) {
      this.dim[n] = (v >> 6) & 1;
      this.bright[n] = this.dim[n] ? this.levelOf() : LAMP_FULL;
      this.arm(n, SETTLE_DIM);
    }
    if (diff & 0x0e) {
      const r = Math.min((v >> 1) & 7, 6);
      if (r === 0) {
        if ((v & 1) && !this.lit[n]) { this.lit[n] = 1; this.arm(n, SETTLE_LIT); }
      } else if (this.rate[n] === 0 && (v & 1)) {
        const l = this.flashLit(n, r);
        if (l !== this.lit[n]) { this.lit[n] = l; this.arm(n, SETTLE_LIT); }
      }
      this.rate[n] = r;
    }
    if (diff & 1) {
      if ((v & 1) === 0) {
        if (this.lit[n]) { this.lit[n] = 0; this.arm(n, SETTLE_LIT); }
      } else {
        this.bright[n] = this.dim[n] ? this.levelOf() : LAMP_FULL;
        if (!this.lit[n] && (this.rate[n] === 0 || this.flashLit(n, this.rate[n]))) {
          this.lit[n] = 1; this.arm(n, SETTLE_LIT);
        }
      }
      this.demand[n] = v & 1;
    }
  }

  setLevel(v: number): void {
    const level = v & 7;
    if (level === this.level) return;
    this.level = level;
    const b = this.levelOf();
    for (let n = 0; n < N; n++) {
      if (!this.dim[n] || this.bright[n] === b) continue;
      this.bright[n] = b;
      if (this.lit[n] && this.rate[n] === 0) this.post(n);
    }
  }

  tick(osc: number): void {
    const toggled = (osc ^ this.osc) & 0x3f;
    if (toggled) {
      this.osc = osc;
      for (let n = 0; n < N; n++) {
        const r = this.rate[n];
        if (r === 0 || ((toggled >> (r - 1)) & 1) === 0) continue;
        if (!this.demand[n] || this.count[n] !== 0) continue;
        const l = this.flashLit(n, r);
        if (l !== this.lit[n]) { this.lit[n] = l; this.post(n); }
      }
    }
    if (this.queued === 0) return;
    for (let n = 0; n < N; n++) {
      if (this.count[n] > 0 && --this.count[n] === 0) {
        this.queued--;
        this.post(n);
      }
    }
  }

  presentAll(bytes: Uint8Array, osc: number, level: number): void {
    this.reset();
    this.level = level & 7;
    this.osc = osc & 0x3f;
    for (let n = 0; n < N; n++) this.write(n, bytes[n]);
    for (let n = 0; n < N; n++) { this.count[n] = 0; this.post(n); }
    this.queued = 0;
  }
}
