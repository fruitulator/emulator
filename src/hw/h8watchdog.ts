import type { H8Intc } from './h8intc';

const DIV_BH = [1, 5, 6, 7, 8, 9, 11, 12];
const TCSR_CKS = 0x07;
const TCSR_TME = 0x20;
const TCSR_WT = 0x40;
const TCSR_OVF = 0x80;

export class H8Watchdog {
  private tcnt = 0;
  private tcsr = 0;
  private rst = 0;
  private base = 0;

  onReset?: () => void;

  constructor(private readonly intc: H8Intc, private readonly vector = 20) {}

  reset(now: number): void {
    this.base = now;
    this.tcnt = 0;
    this.tcsr = 0;
    this.rst = 0;
  }

  update(now: number): void {
    if (!(this.tcsr & TCSR_TME)) { this.tcnt = 0; return; }
    const shift = DIV_BH[this.tcsr & TCSR_CKS];
    const spos = Math.floor(this.base / 2 ** shift);
    const epos = Math.floor(now / 2 ** shift);
    const next = this.tcnt + (epos - spos);
    this.tcnt = next & 0xff;
    this.base = now;
    if (next >= 0x100) {
      if (this.tcsr & TCSR_WT) this.onReset?.();
      else if (!(this.tcsr & TCSR_OVF)) {
        this.tcsr |= TCSR_OVF;
        this.intc.internalInterrupt(this.vector);
      }
    }
  }

  read(now: number, offset: 0 | 1): number {
    this.update(now);
    return offset === 0 ? (this.tcsr | 0x18) & 0xff : this.tcnt;
  }

  write16(now: number, data: number): void {
    if ((data & 0xff00) === 0xa500) {
      this.update(now);
      if (!(this.tcsr & TCSR_TME) && (data & TCSR_TME)) this.base = now;
      this.tcsr = (this.tcsr & data & TCSR_OVF) | (data & 0x7f);
    }
    if ((data & 0xff00) === 0x5a00) {
      if (this.tcsr & TCSR_TME) { this.tcnt = data & 0xff; this.base = now; }
    }
  }

  readRst(): number { return this.rst | 0x3f; }
}
