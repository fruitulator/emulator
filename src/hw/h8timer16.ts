import type { H8Intc } from './h8intc';

const IRQ_A = 0x01;
const IRQ_B = 0x02;
const IRQ_V = 0x10;

const TGR_CLEAR_NONE = -1;
const NO_EVENT = 2 ** 52;
const TGR_CLEAR_EXT = -2;

class Channel {
  tcr = 0;
  tior = 0;
  tier = 0x40;
  private ier = 0;
  private isr = 0;
  tcnt = 0;
  readonly tgr = [0xffff, 0xffff];
  readonly tbr = [0xffff, 0xffff];

  private tgrClearing = TGR_CLEAR_NONE;
  private counterCycle = 0x10000;
  private internalClock = true;
  private clockDivider = 0;
  private phase = 0;
  private active = false;
  private lastUpdate = 0;

  readonly #intc: H8Intc;

  constructor(
    intc: H8Intc,
    private readonly irqBase: number,
  ) {
    this.#intc = intc;
  }

  reset(): void {
    this.tcr = 0;
    this.tcnt = 0;
    this.tgr[0] = this.tgr[1] = 0xffff;
    this.tgrClearing = TGR_CLEAR_NONE;
    this.internalClock = true;
    this.clockDivider = 0;
    this.counterCycle = 0x10000;
    this.phase = 0;
    this.tier = 0x40;
    this.ier = 0;
    this.isr = 0;
    this.lastUpdate = 0;
  }

  setEnable(now: number, enable: boolean): void {
    this.update(now);
    this.active = enable;
  }

  private tcrUpdate(): void {
    switch (this.tcr & 0x60) {
      case 0x00: this.tgrClearing = TGR_CLEAR_NONE; break;
      case 0x20: this.tgrClearing = 0; break;
      case 0x40: this.tgrClearing = 1; break;
      default: this.tgrClearing = TGR_CLEAR_EXT; break;
    }

    const countType = this.tcr & 7;
    if (countType < 4) {
      this.internalClock = true;
      this.clockDivider = countType;
      if (countType <= 1) {
        this.phase = 0;
      } else {
        switch (this.tcr & 0x18) {
          case 0x00: this.phase = 0; break;
          case 0x08: this.phase = 1 << (this.clockDivider - 1); break;
          default: this.phase = 0; this.clockDivider--; break;
        }
      }
    } else {
      this.internalClock = false;
      this.clockDivider = 0;
      this.phase = 0;
    }
    this.recalcCycle();
  }

  private recalcCycle(): void {
    this.counterCycle = this.tgrClearing >= 0 ? this.tgr[this.tgrClearing] + 1 : 0x10000;
  }

  update(now: number): void {
    if (!this.internalClock || !this.active) {
      this.lastUpdate = now;
      return;
    }
    const div = 2 ** this.clockDivider;
    const base = Math.floor((this.lastUpdate + this.phase) / div);
    const next = Math.floor((now + this.phase) / div);
    this.lastUpdate = now;
    if (next === base) return;

    const delta = next - base;
    const prev = this.tcnt;
    const tt = prev + delta;

    if (prev >= this.counterCycle) {
      this.tcnt = tt >= 0x10000 ? (tt - 0x10000) % this.counterCycle : tt;
    } else {
      this.tcnt = tt % this.counterCycle;
    }

    for (let i = 0; i < 2; i++) {
      const cmp = this.tgr[i] + 1;
      let match = this.tcnt === cmp || (tt === cmp && tt === this.counterCycle);
      if (!match) {
        if (prev >= this.counterCycle) {
          match = (cmp > prev && tt >= cmp)
            || (cmp <= this.counterCycle && this.tcnt < this.counterCycle
              && (delta - (0x10000 - prev)) >= cmp);
        } else if (cmp <= this.counterCycle) {
          match = delta >= this.counterCycle
            || (prev < cmp && tt >= cmp)
            || (this.tcnt <= prev && this.tcnt >= cmp);
        }
      }
      if (match) {
        this.isr |= 1 << i;
        if (this.ier & (1 << i)) this.#intc.internalInterrupt(this.irqBase + i);
      }
    }

    if (tt >= 0x10000 && (this.counterCycle === 0x10000 || prev >= this.counterCycle)) {
      this.isr |= IRQ_V;
      if (this.ier & IRQ_V) this.#intc.internalInterrupt(this.irqBase + 2);
    }
  }

  nextEventCycle(): number {
    if (!this.internalClock || !this.active) return NO_EVENT;
    const t = this.tcnt;
    let edges = 0x10000 - t;
    let c = this.tgr[0] + 1;
    if (c > t && c - t < edges) edges = c - t;
    c = this.tgr[1] + 1;
    if (c > t && c - t < edges) edges = c - t;
    c = this.counterCycle;
    if (c > t && c - t < edges) edges = c - t;
    if (edges < 1) edges = 1;
    const div = 2 ** this.clockDivider;
    const base = Math.floor((this.lastUpdate + this.phase) / div);
    return (base + edges) * div - this.phase;
  }

  read(now: number, reg: number): number {
    switch (reg) {
      case 0: return this.tcr;
      case 1: return this.tior;
      case 2: return this.tier | 0xf8;
      case 3: return this.tsrRead();
      case 4: this.update(now); return (this.tcnt >> 8) & 0xff;
      case 5: this.update(now); return this.tcnt & 0xff;
      case 6: return (this.tgr[0] >> 8) & 0xff;
      case 7: return this.tgr[0] & 0xff;
      case 8: return (this.tgr[1] >> 8) & 0xff;
      case 9: return this.tgr[1] & 0xff;
      case 10: return (this.tbr[0] >> 8) & 0xff;
      case 11: return this.tbr[0] & 0xff;
      case 12: return (this.tbr[1] >> 8) & 0xff;
      default: return this.tbr[1] & 0xff;
    }
  }

  write(now: number, reg: number, data: number): void {
    const v = data & 0xff;
    switch (reg) {
      case 0: this.update(now); this.tcr = v; this.tcrUpdate(); break;
      case 1: this.tior = v; break;
      case 2:
        this.update(now);
        this.tier = v | 0xf8;
        this.ier = ((this.tier & 0x01) ? IRQ_A : 0)
          | ((this.tier & 0x02) ? IRQ_B : 0)
          | ((this.tier & 0x04) ? IRQ_V : 0);
        if (this.isr & this.ier & IRQ_A) this.#intc.internalInterrupt(this.irqBase);
        if (this.isr & this.ier & IRQ_B) this.#intc.internalInterrupt(this.irqBase + 1);
        if (this.isr & this.ier & IRQ_V) this.#intc.internalInterrupt(this.irqBase + 2);
        break;
      case 3: this.update(now); this.tsrWrite(v); break;
      case 4: this.update(now); this.tcnt = (this.tcnt & 0x00ff) | (v << 8); break;
      case 5: this.update(now); this.tcnt = (this.tcnt & 0xff00) | v; break;
      case 6: this.update(now); this.tgr[0] = (this.tgr[0] & 0x00ff) | (v << 8); this.recalcCycle(); break;
      case 7: this.update(now); this.tgr[0] = (this.tgr[0] & 0xff00) | v; this.recalcCycle(); break;
      case 8: this.update(now); this.tgr[1] = (this.tgr[1] & 0x00ff) | (v << 8); this.recalcCycle(); break;
      case 9: this.update(now); this.tgr[1] = (this.tgr[1] & 0xff00) | v; this.recalcCycle(); break;
      case 10: this.tbr[0] = (this.tbr[0] & 0x00ff) | (v << 8); break;
      case 11: this.tbr[0] = (this.tbr[0] & 0xff00) | v; break;
      case 12: this.tbr[1] = (this.tbr[1] & 0x00ff) | (v << 8); break;
      default: this.tbr[1] = (this.tbr[1] & 0xff00) | v; break;
    }
  }

  private tsrRead(): number {
    return 0xf8 | ((this.isr & IRQ_V) ? 4 : 0) | ((this.isr & IRQ_B) ? 2 : 0)
      | ((this.isr & IRQ_A) ? 1 : 0);
  }

  private tsrWrite(val: number): void {
    if (!(val & 1)) this.isr &= ~IRQ_A;
    if (!(val & 2)) this.isr &= ~IRQ_B;
    if (!(val & 4)) this.isr &= ~IRQ_V;
  }
}

export class H8Timer16 {
  private readonly channels: Channel[];

  private tstr = 0xe0;
  private tsyr = 0;
  private tmdr = 0;
  private tfcr = 0;
  private toer = 0;
  private tocr = 0;

  constructor(intc: H8Intc) {
    this.channels = [24, 28, 32, 36, 40].map((base) => new Channel(intc, base));
  }

  reset(): void {
    for (const c of this.channels) c.reset();
    this.tstr = 0xe0;
    this.tsyr = this.tmdr = this.tfcr = this.toer = this.tocr = 0;
    this.applyStart(0);
  }

  private deadline = 0;

  update(now: number): void {
    if (now < this.deadline) return;
    let d = NO_EVENT;
    for (const c of this.channels) {
      c.update(now);
      const e = c.nextEventCycle();
      if (e < d) d = e;
    }
    this.deadline = d;
  }

  private applyStart(now: number): void {
    this.channels.forEach((c, i) => c.setEnable(now, !!((this.tstr >> i) & 1)));
    this.deadline = 0;
  }

  read(now: number, off: number): number {
    switch (off) {
      case 0x00: return this.tstr;
      case 0x01: return this.tsyr;
      case 0x02: return this.tmdr;
      case 0x03: return this.tfcr;
      case 0x30: return this.toer;
      case 0x31: return this.tocr;
      default: break;
    }
    const ch = this.channelFor(off);
    return ch ? ch.chan.read(now, ch.reg) : 0xff;
  }

  write(now: number, off: number, data: number): void {
    switch (off) {
      case 0x00: this.tstr = data & 0xff; this.applyStart(now); return;
      case 0x01: this.tsyr = data & 0xff; return;
      case 0x02: this.tmdr = data & 0xff; return;
      case 0x03: this.tfcr = data & 0xff; return;
      case 0x30: this.toer = data & 0xff; return;
      case 0x31: this.tocr = data & 0xff; return;
      default: break;
    }
    const ch = this.channelFor(off);
    if (ch) {
      ch.chan.write(now, ch.reg, data);
      this.deadline = 0;
    }
  }

  private channelFor(off: number): { chan: Channel; reg: number } | null {
    if (off >= 0x04 && off < 0x22) {
      const i = Math.floor((off - 0x04) / 10);
      return { chan: this.channels[i], reg: (off - 0x04) % 10 };
    }
    if (off >= 0x22 && off < 0x30) return { chan: this.channels[3], reg: off - 0x22 };
    if (off >= 0x32 && off < 0x40) return { chan: this.channels[4], reg: off - 0x32 };
    return null;
  }
}
