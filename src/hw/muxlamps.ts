export class MuxLamps {
  private readonly vals = new Uint8Array(8);
  private readonly times = new Float64Array(8);
  private count = 0;
  private col = -1;
  private period = 0;
  private lastStrobe = 0;
  private readonly hist: Uint8Array;
  private readonly lit: Uint8Array;
  private readonly level: Uint8Array;

  constructor(private readonly out: Uint8Array, private readonly base = 0) {
    this.hist = new Uint8Array(out.length);
    this.lit = new Uint8Array(out.length);
    this.level = new Uint8Array(out.length);
  }

  reset(): void {
    this.count = 0;
    this.col = -1;
    this.period = 0;
    this.lastStrobe = 0;
    this.hist.fill(0);
    this.lit.fill(0);
    this.level.fill(0);
  }

  strobe(t: number): void {
    const gap = t - this.lastStrobe;
    if (gap > 100) this.period = gap;
    this.lastStrobe = t;
  }

  write(col: number, v: number, t: number): void {
    if (col !== this.col) {
      if (this.count) {
        if (this.count === 1) this.push(0, t);
        this.flush();
        this.count = 0;
      }
      this.col = col;
    }
    if (this.count < 8) this.push(v, t);
  }

  private push(v: number, t: number): void {
    this.vals[this.count] = v;
    this.times[this.count] = t;
    this.count++;
  }

  private flush(): void {
    let span = this.times[this.count - 1] - this.times[0];
    if (this.period) span = this.period - 0xfa;
    if (span === 0) span = 1;
    for (let b = 0; b < 8; b++) {
      const m = 1 << b;
      let start = -1;
      let end = -1;
      for (let i = 0; i < this.count; i++) {
        if (!(this.vals[i] & m)) {
          if (start >= 0) {
            if (this.times[i] - start > 0x18) { end = this.times[i]; break; }
            start = -1;
          }
        } else if (start < 0) start = this.times[i];
      }
      const n = this.base + this.col * 8 + b;
      if (n < 0 || n >= this.out.length) continue;
      const on = start >= 0;
      const h = ((this.hist[n] << 1) | (on ? 1 : 0)) & 0xff;
      this.hist[n] = h;
      let lvl = 0;
      if (on) lvl = end < 0 ? 0xff : span > 0 ? Math.min(0xff, Math.floor(((end - start) * 0xff) / span)) : 0;
      const dim = (h & 0xf) === 5 || (h & 0xf) === 10;
      if (dim) lvl = 0x80;
      if (!on) {
        if (this.lit[n] && !dim) {
          this.lit[n] = 0;
          this.out[n] = 0;
        }
        continue;
      }
      if (this.lit[n] && Math.abs(this.level[n] - lvl) < 7) continue;
      this.level[n] = lvl;
      this.lit[n] = 1;
      this.out[n] = lvl;
    }
  }
}

export const MUX_LAMP_ALT = 0x80;
