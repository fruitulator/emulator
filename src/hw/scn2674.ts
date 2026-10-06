
export const SCN2674_ROW_CYCLES = 0x15ae;
export const SCN2674_ROWS = 0x25;

const DELAYED = new Set([0xa2, 0xa4, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xbb, 0xbd]);

export class Scn2674 {
  flag4 = false;
  displayQualifier = false;
  private pending = false;
  private rowCycles = 0;
  private irPointer = 0;
  cursorOn = false;
  displayOn = false;
  readonly ir = new Uint8Array(15);
  readonly regs = new Uint8Array(8);
  intMask = 0;
  row = SCN2674_ROWS - 1;
  frames = 0;
  frameDone = false;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.irPointer = 0;
    this.ir.fill(0);
    this.regs[0] = 0;
    this.regs[1] = 0x20;
    this.pending = false;
    this.rowCycles = 0;
    this.cursorOn = false;
    this.displayOn = false;
    this.frameDone = false;
    this.intMask = 0;
    this.frames = 0;
  }

  irq(): boolean {
    return this.regs[0] !== 0;
  }

  get screenStart2(): number {
    return this.regs[6] | (this.regs[7] << 8);
  }

  read(reg: number): number {
    return this.regs[reg & 7];
  }

  write(reg: number, val: number): void {
    const v = val & 0xff;
    if (reg === 0) {
      this.ir[this.irPointer] = v;
      this.irPointer = Math.min(this.irPointer + 1, 14);
      return;
    }
    if (reg !== 1) {
      if (reg >= 2 && reg < 8) this.regs[reg] = v;
      return;
    }
    if (DELAYED.has(v)) {
      this.pending = true;
      this.regs[1] &= ~0x20;
      return;
    }
    if (v === 0) {
      this.reset();
      return;
    }
    if ((v & 0xf0) === 0x10) {
      this.irPointer = v & 0x0f;
      return;
    }
    switch (v & 0xe0) {
      case 0x20: {
        const on = (v & 1) !== 0;
        if (v & 0x02) this.cursorOn = on;
        if (v & 0x10) this.flag4 = on;
        if (v & 0x08) {
          this.displayOn = on;
          this.displayQualifier = (v & 0x04) !== 0;
        }
        return;
      }
      case 0x40:
        this.regs[0] &= ~(v & 0x1f);
        this.regs[1] &= ~(v & 0x1f);
        return;
      case 0x60:
        this.intMask |= v & 0x1f;
        return;
      case 0x80:
        this.intMask &= ~(v & 0x1f);
        return;
      default:
    }
  }

  private raise(bits: number): void {
    this.regs[1] |= bits;
    this.regs[0] |= bits & this.intMask;
  }

  tick(cycles: number): void {
    this.rowCycles -= cycles;
    if (this.rowCycles >= 1) return;
    this.rowCycles += SCN2674_ROW_CYCLES;
    this.row++;
    if (this.row >= SCN2674_ROWS) {
      this.frameDone = true;
      this.row = 0;
    }
    this.raise(0x08);
    if (this.row === this.ir[12]) this.raise(0x04);
    else if (this.row === this.ir[13]) this.raise(0x01);
    if (this.row === 0) {
      this.frames++;
      this.raise(0x10);
      if (this.pending) {
        this.pending = false;
        this.regs[1] |= 0x20;
        this.raise(0x02);
      }
    }
  }
}
