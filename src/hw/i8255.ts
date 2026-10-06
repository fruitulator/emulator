
const CTRL_C_LOWER_IN = 0x01;
const CTRL_B_IN = 0x02;
const CTRL_C_UPPER_IN = 0x08;
const CTRL_A_IN = 0x10;
const CTRL_MODE_SET = 0x80;

export interface I8255Hooks {
  outA?(v: number): void;
  outB?(v: number): void;
  outC?(v: number): void;
  inA?(): number;
  inB?(): number;
  inC?(): number;
}

export interface I8255Options {
  modeSetKeepsLatches?: boolean;
}

export class I8255 {
  private control = 0x9b;
  private readonly output = [0, 0, 0];
  private readonly keepLatches: boolean;

  constructor(private readonly hooks: I8255Hooks = {}, options: I8255Options = {}) {
    this.keepLatches = options.modeSetKeepsLatches ?? false;
    this.setMode(0x9b, true);
  }

  reset(): void {
    this.setMode(0x9b, true);
  }

  private aInput(): boolean {
    return (this.control & CTRL_A_IN) !== 0;
  }

  private bInput(): boolean {
    return (this.control & CTRL_B_IN) !== 0;
  }

  private cUpperInput(): boolean {
    return (this.control & CTRL_C_UPPER_IN) !== 0;
  }

  private cLowerInput(): boolean {
    return (this.control & CTRL_C_LOWER_IN) !== 0;
  }

  private pcPins(): number {
    const upper = this.cUpperInput() ? 0xf0 : this.output[2] & 0xf0;
    const lower = this.cLowerInput() ? 0x0f : this.output[2] & 0x0f;
    return upper | lower;
  }

  drivenC(): number {
    const mask = (this.cUpperInput() ? 0 : 0xf0) | (this.cLowerInput() ? 0 : 0x0f);
    return this.output[2] & mask;
  }

  private outputPc(): void {
    this.hooks.outC?.(this.pcPins());
  }

  private setMode(v: number, reset = false): void {
    this.control = v & 0xff;
    if (reset || !this.keepLatches) {
      this.output[0] = 0;
      this.output[1] = 0;
      this.output[2] = 0;
    }
    this.hooks.outA?.(this.aInput() ? 0xff : this.output[0]);
    this.hooks.outB?.(this.bInput() ? 0xff : this.output[1]);
    this.outputPc();
  }

  private setPcBit(bit: number, on: boolean): void {
    if (on) this.output[2] |= 1 << bit;
    else this.output[2] &= ~(1 << bit) & 0xff;
    this.outputPc();
  }

  read(reg: number): number {
    switch (reg & 3) {
      case 0:
        return this.aInput() ? (this.hooks.inA?.() ?? 0xff) & 0xff : this.output[0];
      case 1:
        return this.bInput() ? (this.hooks.inB?.() ?? 0xff) & 0xff : this.output[1];
      case 2: {
        const pins = (this.hooks.inC?.() ?? 0xff) & 0xff;
        const upper = this.cUpperInput() ? pins & 0xf0 : this.output[2] & 0xf0;
        const lower = this.cLowerInput() ? pins & 0x0f : this.output[2] & 0x0f;
        return upper | lower;
      }
      default:
        return this.control;
    }
  }

  write(reg: number, val: number): void {
    const v = val & 0xff;
    switch (reg & 3) {
      case 0:
        if (!this.aInput()) {
          this.output[0] = v;
          this.hooks.outA?.(v);
        }
        return;
      case 1:
        if (!this.bInput()) {
          this.output[1] = v;
          this.hooks.outB?.(v);
        }
        return;
      case 2:
        this.output[2] = v;
        this.outputPc();
        return;
      default:
        if (v & CTRL_MODE_SET) this.setMode(v);
        else this.setPcBit((v >> 1) & 7, (v & 1) !== 0);
        return;
    }
  }
}
