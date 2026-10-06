import type { H8Intc } from './h8intc';

const SCAN_PERIOD = 2500;
const TICK_PERIOD = 160000;

export class EpochAsic {
  private reg10 = 0;
  private reg11 = 0;
  private reg12 = 0;
  private control = 0;
  private enable = 0;
  private status = 0;
  private shadow = 0;

  liveBank = 0;

  private readonly matrixDirty = [false, false];

  onMatrixCommit?: (bank: number) => void;

  inputBytes = 0x40;
  outputBytes = 0x40;

  private scanCounter = 0;
  private tick80 = 0;
  private tick08 = 0;
  private armed = 0;

  readonly #intc: H8Intc;

  onDisplayReset?: () => void;

  onScan?: () => void;

  constructor(intc: H8Intc) {
    this.#intc = intc;
  }

  reset(): void {
    this.reg10 = 0x48;
    this.reg11 = this.reg12 = 0;
    this.control = this.enable = this.status = this.shadow = 0;
    this.liveBank = 0;
    this.matrixDirty[0] = this.matrixDirty[1] = false;
    this.inputBytes = this.outputBytes = 0x40;
    this.scanCounter = this.tick80 = this.tick08 = this.armed = 0;
    this.pending = this.deadline = 0;
    this.soundFlag = false;
    this.#intc.setInput(4, false);
    this.#intc.setInput(5, false);
  }

  soundFlag = false;

  private pending = 0;
  private deadline = 0;

  tick(cycles: number): void {
    this.pending += cycles;
    if ((this.soundFlag && (this.enable & 0x02)) || this.pending >= this.deadline) this.flush();
  }

  private sync(): void {
    if (this.pending > 0) this.flush();
  }

  private nextEvent(): number {
    let next = TICK_PERIOD - this.tick80;
    const t08 = TICK_PERIOD - this.tick08;
    if (t08 < next) next = t08;
    if (this.control & 0x04) {
      const scan = SCAN_PERIOD - this.scanCounter;
      if (scan < next) next = scan;
    }
    if (this.armed > 0 && this.armed < next) next = this.armed;
    return next < 1 ? 1 : next;
  }

  private flush(): void {
    const cycles = this.pending;
    this.pending = 0;
    this.deadline = this.advance(cycles) ? 0 : this.nextEvent();
  }

  private advance(cycles: number): boolean {
    if (this.soundFlag) this.raise(0x02);

    if (this.control & 0x04) {
      this.scanCounter += cycles;
      while (this.scanCounter >= SCAN_PERIOD) {
        this.scanCounter -= SCAN_PERIOD;
        this.raise(0x20);
        this.onScan?.();
      }
    }

    this.tick80 += cycles;
    while (this.tick80 >= TICK_PERIOD) {
      this.tick80 -= TICK_PERIOD;
      this.raise(0x80);
      this.commitMatrix();
    }

    this.tick08 += cycles;
    while (this.tick08 >= TICK_PERIOD) {
      this.tick08 -= TICK_PERIOD;
      this.raise(0x08);
    }

    if (this.armed > 0) this.armed = Math.max(0, this.armed - cycles);

    const active = this.shadow & this.enable;
    if (active) {
      this.#intc.setInput(active & 1 ? 4 : 5, true);
    } else {
      this.#intc.setInput(4, false);
      this.#intc.setInput(5, false);
    }
    this.shadow = 0;
    return active !== 0;
  }

  private raise(bit: number): void {
    this.status |= bit;
    this.shadow |= bit;
  }

  markMatrixDirty(bank: number): void {
    this.matrixDirty[bank] = true;
  }

  private commitMatrix(): void {
    const bank = this.liveBank;
    if (!this.matrixDirty[bank]) return;
    this.matrixDirty[bank] = false;
    this.onMatrixCommit?.(bank);
  }

  read8(addr: number): number {
    this.sync();
    switch (addr & 0xffffff) {
      case 0xffff10: return this.reg10;
      case 0xffff11: return this.reg11;
      case 0xffff12: return this.reg12;
      case 0xffff13: return this.control;
      case 0xffff14: return this.enable;
      case 0xffff15: return this.status;
      case 0xffff1b: return 3;
      default: return 0;
    }
  }

  write8(addr: number, val: number): void {
    this.sync();
    this.deadline = 0;
    const v = val & 0xff;
    switch (addr & 0xffffff) {
      case 0xffff10: this.reg10 = v; break;
      case 0xffff11: this.reg11 = v; break;
      case 0xffff12:
        this.reg12 = v;
        this.inputBytes = 0x40 << ((v >> 4) & 7);
        this.outputBytes = 0x40 << (v & 7);
        break;
      case 0xffff13: {
        const diff = (this.control ^ v) & 0xff;
        if (diff === 0x40) {
          this.liveBank = v & 0x40 ? 1 : 0;
          this.commitMatrix();
        }
        if (diff === 0x80) this.markMatrixDirty(this.liveBank);
        if (diff & 0x04 && !(v & 0x04)) this.onDisplayReset?.();
        if (v & 0x01) this.armed = 640000;
        this.control = v;
        break;
      }
      case 0xffff14: this.enable = v; break;
      case 0xffff15: this.status &= ~(v & 0xef); break;
      default: break;
    }
  }
}
