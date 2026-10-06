
export interface PtmHooks {
  output?(n: number, state: boolean): void;
  pin?(n: number, level: boolean): void;
  irqChanged?(): void;
}

const CR_CLOCK_INTERNAL = 0x02;
const CR_DUAL_8BIT = 0x04;
const CR_MODE = 0x38;
const CR_IRQ_ENABLE = 0x40;
const CR_OUTPUT_ENABLE = 0x80;

const CR1_RESET_ALL = 0x01;
const CR2_SELECT_CR1 = 0x01;
const CR3_PRESCALE = 0x01;

export class Ptm6840 {
  private readonly cr = [0, 0, 0];
  private readonly counter = [0, 0, 0];
  private readonly latch = [0xffff, 0xffff, 0xffff];
  private readonly out = [false, false, false];
  private readonly extClock = [false, false, false];
  private readonly running = [false, false, false];

  private msbBuffer = 0;
  private readonly lsbBuffer = [0, 0, 0];

  private status = 0;
  private statusRead = 0;
  private prescale = 0;

  private lastIrq = false;

  constructor(private readonly hooks: PtmHooks = {}) {
    this.reset();
  }

  reset(): void {
    this.cr[0] = CR1_RESET_ALL;
    this.cr[1] = 0;
    this.cr[2] = 0;
    for (let i = 0; i < 3; i++) {
      this.latch[i] = 0xffff;
      this.counter[i] = 0xffff;
      this.out[i] = false;
      this.extClock[i] = false;
      this.running[i] = false;
      this.lsbBuffer[i] = 0;
    }
    this.status = 0;
    this.statusRead = 0;
    this.prescale = 0;
    this.msbBuffer = 0;
    this.lastIrq = false;
  }

  irq(): boolean {
    return (this.status & 0x80) !== 0;
  }

  outputState(n: number): boolean {
    return this.out[n];
  }

  pinLevel(n: number): boolean {
    return (this.cr[n] & CR_OUTPUT_ENABLE) !== 0 && this.out[n];
  }

  private reloadValue(n: number): number {
    const l = this.latch[n];
    if (this.cr[n] & CR_DUAL_8BIT) {
      const lsb = (l & 0xff) + 1;
      const msb = (l >> 8) & 0xff;
      return this.out[n] ? lsb : lsb * msb;
    }
    return l + 1;
  }

  private inReset(): boolean {
    return (this.cr[0] & CR1_RESET_ALL) !== 0;
  }

  tick(cycles: number): void {
    if (this.inReset()) return;
    for (let n = 0; n < 3; n++) {
      if (!(this.cr[n] & CR_CLOCK_INTERNAL)) continue;
      let ticks = cycles;
      if (n === 2 && this.cr[2] & CR3_PRESCALE) {
        this.prescale += cycles;
        ticks = this.prescale >> 3;
        this.prescale &= 7;
      }
      if (ticks > 0) this.advance(n, ticks);
    }
  }

  setExternalClock(n: number, state: boolean): void {
    const falling = this.extClock[n] && !state;
    this.extClock[n] = state;
    if (!falling || this.inReset()) return;
    if (this.cr[n] & CR_CLOCK_INTERNAL) return;

    if (n === 2 && this.cr[2] & CR3_PRESCALE) {
      this.prescale = (this.prescale + 1) & 7;
      if (this.prescale !== 0) return;
    }
    this.advance(n, 1);
  }

  private advance(n: number, ticks: number): void {
    if (!this.running[n]) return;

    let remaining = ticks;
    while (remaining > 0) {
      if (this.counter[n] > remaining) {
        this.counter[n] -= remaining;
        return;
      }
      remaining -= this.counter[n];
      this.timeout(n);
      this.counter[n] = this.reloadValue(n);
      if (!this.running[n]) return;
    }
  }

  private timeout(n: number): void {
    if (!(this.cr[n] & CR_DUAL_8BIT) || this.out[n]) this.setFlag(n);

    this.out[n] = !this.out[n];
    if (this.cr[n] & CR_OUTPUT_ENABLE) this.hooks.output?.(n, this.out[n]);
    this.hooks.pin?.(n, (this.cr[n] & CR_OUTPUT_ENABLE) !== 0 && this.out[n]);

    const mode = (this.cr[n] & CR_MODE) >> 3;
    if (mode === 4 || mode === 6) this.running[n] = false;
  }

  private setFlag(n: number): void {
    this.status |= 1 << n;
    this.updateIrq();
  }

  private clearFlag(n: number): void {
    this.status &= ~(1 << n) & 0xff;
    this.updateIrq();
  }

  private updateIrq(): void {
    let any = false;
    for (let n = 0; n < 3; n++) {
      if (this.status & (1 << n) && this.cr[n] & CR_IRQ_ENABLE) any = true;
    }
    if (any) this.status |= 0x80;
    else this.status &= 0x7f;

    if (any !== this.lastIrq) {
      this.lastIrq = any;
      this.hooks.irqChanged?.();
    }
  }

  read(offset: number): number {
    switch (offset & 7) {
      case 0:
        return 0;
      case 1:
        this.statusRead |= this.status & 0x07;
        return this.status;
      default: {
        const n = ((offset & 7) - 2) >> 1;
        if (offset & 1) {
          return this.lsbBuffer[n];
        }
        const v = this.counter[n] & 0xffff;
        this.lsbBuffer[n] = v & 0xff;
        if (this.statusRead & (1 << n)) {
          this.clearFlag(n);
        }
        return (v >> 8) & 0xff;
      }
    }
  }

  write(offset: number, val: number): void {
    val &= 0xff;
    switch (offset & 7) {
      case 0:
        if (this.cr[1] & CR2_SELECT_CR1) this.writeControl(0, val);
        else this.writeControl(2, val);
        break;
      case 1:
        this.writeControl(1, val);
        break;
      default: {
        const n = ((offset & 7) - 2) >> 1;
        if (offset & 1) {
          this.latch[n] = ((this.msbBuffer << 8) | val) & 0xffff;
          this.counter[n] = this.reloadValue(n);
          this.running[n] = !this.inReset();
          this.clearFlag(n);
        } else {
          this.msbBuffer = val;
        }
        break;
      }
    }
  }

  private writeControl(n: number, val: number): void {
    const wasReset = this.inReset();
    this.cr[n] = val;
    const nowReset = this.inReset();

    if (n === 0 && wasReset !== nowReset) {
      if (nowReset) {
        for (let i = 0; i < 3; i++) {
          this.counter[i] = this.reloadValue(i);
          this.running[i] = false;
        }
        this.status = 0;
        this.prescale = 0;
      } else {
        for (let i = 0; i < 3; i++) {
          this.counter[i] = this.reloadValue(i);
          this.running[i] = true;
        }
        this.prescale = 0;
      }
    }

    this.updateIrq();
  }

  debugState(): {
    cr: number[];
    counter: number[];
    latch: number[];
    status: number;
    out: boolean[];
  } {
    return {
      cr: [...this.cr],
      counter: [...this.counter],
      latch: [...this.latch],
      status: this.status,
      out: [...this.out],
    };
  }
}
