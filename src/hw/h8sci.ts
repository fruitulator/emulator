import type { H8Intc } from './h8intc';

const SSR_TDRE = 0x80;
const SSR_RDRF = 0x40;
const SSR_ORER = 0x20;
const SSR_TEND = 0x04;

const SCR_TIE = 0x80;
const SCR_RIE = 0x40;
const SCR_TE = 0x20;
const SCR_RE = 0x10;
const SCR_TEIE = 0x04;

export class H8Sci {
  private smr = 0;
  private brr = 0;
  private scr = 0;
  private tdr = 0;
  private rdr = 0;
  private ssr = SSR_TDRE | SSR_TEND;

  readonly sent: number[] = [];

  onTransmit: ((b: number) => void) | null = null;

  readonly #intc: H8Intc;

  constructor(
    intc: H8Intc,
    private readonly irqBase: number,
  ) {
    this.#intc = intc;
  }

  reset(): void {
    this.smr = this.brr = this.scr = this.tdr = this.rdr = 0;
    this.ssr = SSR_TDRE | SSR_TEND;
    this.sent.length = 0;
  }

  receive(b: number): void {
    if (!(this.scr & SCR_RE)) return;
    if (this.ssr & SSR_RDRF) this.ssr |= SSR_ORER;
    else {
      this.rdr = b & 0xff;
      this.ssr |= SSR_RDRF;
    }
    if (this.scr & SCR_RIE) this.#intc.internalInterrupt(this.irqBase + 1);
  }

  read(reg: number): number {
    switch (reg) {
      case 0: return this.smr;
      case 1: return this.brr;
      case 2: return this.scr;
      case 3: return this.tdr;
      case 4: return this.ssr;
      case 5: return this.rdr;
      default: return 0;
    }
  }

  write(reg: number, val: number): void {
    const v = val & 0xff;
    switch (reg) {
      case 0: this.smr = v; break;
      case 1: this.brr = v; break;
      case 2:
        this.scr = v;
        if (v & SCR_TE) this.raise();
        break;
      case 3:
        this.tdr = v;
        if (this.scr & SCR_TE) {
          this.sent.push(v);
          if (this.sent.length > 4096) this.sent.shift();
          this.onTransmit?.(v);
        }
        this.ssr |= SSR_TDRE | SSR_TEND;
        this.raise();
        break;
      case 4:
        this.ssr &= v | ~(SSR_TDRE | SSR_RDRF | SSR_ORER);
        this.ssr |= SSR_TDRE | SSR_TEND;
        break;
      default: break;
    }
  }

  private raise(): void {
    if (this.scr & SCR_TIE) this.#intc.internalInterrupt(this.irqBase + 2);
    if (this.scr & SCR_TEIE) this.#intc.internalInterrupt(this.irqBase + 3);
  }
}
