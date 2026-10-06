export const CURVE_SET0: readonly number[] = [0x00, 0xff, 0x80, 0xff, 0x00, 0x80, 0x00, 0xff];

export class CurveMux {
  private readonly vals = new Uint16Array(8);
  private readonly times = new Float64Array(8);
  private count = 0;
  private col = 0;
  private last = 0;
  private stalled = false;
  private half = 0;
  private readonly level: Int16Array;
  private readonly hist: Uint8Array;

  constructor(
    private readonly out: Uint8Array,
    private readonly cols = 16,
    private readonly base = 0,
  ) {
    this.level = new Int16Array(cols * 16);
    this.hist = new Uint8Array(cols * 16);
  }

  reset(): void {
    this.count = 0;
    this.last = 0;
    this.stalled = false;
    this.half = 0;
    this.level.fill(0);
    this.hist.fill(0);
    this.out.fill(0, this.base, this.base + this.cols * 16);
  }

  strobe(col: number): boolean {
    if (col === this.col && this.count === 8 && !this.stalled) {
      this.stalled = true;
      for (let c = 0; c < this.cols; c++) {
        for (let b = 0; b < 16; b++) {
          const k = c * 16 + b;
          if (c === col && ((this.last >> b) & 1) !== 0) this.set(k, 0x1ff);
          else this.out[this.base + k] = 0;
        }
      }
      return true;
    }
    return false;
  }

  write(col: number, v: number, lvl: number, t: number): void {
    if (col !== this.col) {
      if (this.stalled) {
        this.count = 0;
        this.stalled = false;
      }
      if (this.count === 1) {
        this.vals[1] = 0;
        this.times[1] = t;
        this.count = 2;
        this.flush(lvl);
      } else if (this.count > 2) {
        this.flush(lvl);
      }
      this.count = 0;
      this.col = col;
      this.half = 0;
      this.last = 0;
    }
    if (this.half !== 0 && this.count < 8) {
      this.count++;
      this.half = 0;
    }
    if (this.count < 8) {
      this.vals[this.count] = v & 0xffff;
      this.times[this.count] = t;
      this.count++;
      this.last = v & 0xffff;
    }
  }

  writeHigh(col: number, v: number, t: number): void {
    this.writeHalf(col, (v & 0xff) << 8, 0x00ff, 2, t);
  }

  writeLow(col: number, v: number, t: number): void {
    this.writeHalf(col, v & 0xff, 0xff00, 1, t);
  }

  private writeHalf(col: number, bits: number, keep: number, flag: number, t: number): void {
    if (col !== this.col) {
      this.flush(-1);
      this.col = col;
      this.half = 0;
    }
    if ((this.half & flag) !== 0 && this.count < 8) {
      this.count++;
      this.half = 0;
    }
    if (this.count < 8) {
      this.vals[this.count] = (this.vals[this.count] & keep) | bits;
      this.times[this.count] = t;
      this.half |= flag;
      if ((this.half & (flag ^ 3)) !== 0) {
        this.count++;
        this.half = 0;
      }
    }
  }

  levelOf(n: number): number {
    return this.level[n] ?? 0;
  }

  private flush(lvl: number): void {
    const n = this.count;
    let span = n > 0 ? this.times[n - 1] - this.times[0] : 1;
    if (span === 0) span = 1;
    const col = this.col;
    if (col < 0 || col >= this.cols) return;
    for (let b = 0; b < 16; b++) {
      const m = 1 << b;
      let start = 0;
      let end = 0;
      for (let i = 0; i < n; i++) {
        if (this.vals[i] & m) {
          if (start === 0) start = this.times[i];
        } else if (start !== 0) {
          end = this.times[i];
          break;
        }
      }
      const k = col * 16 + b;
      this.hist[k] = (this.hist[k] << 1) & 0xff;
      let x = 0xff;
      if (end - start !== 0) {
        this.hist[k] |= 1;
        if (lvl >= 0) x = lvl;
        else x = end === 0 ? 0xff : Math.min(0xff, Math.trunc(((end - start) * 0xff) / span));
      }
      const out = Math.trunc((CURVE_SET0[this.hist[k] & 7] * x) / 0xff);
      if (Math.abs(out - this.level[k]) > 2) this.set(k, out);
    }
  }

  private set(k: number, lvl: number): void {
    this.level[k] = lvl;
    this.out[this.base + k] = Math.max(0, Math.min(0xff, lvl));
  }
}
