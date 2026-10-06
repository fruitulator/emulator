
export interface PiaHooks {
  readA?(): number;
  readB?(): number;
  writeA?(v: number): void;
  writeB?(v: number): void;
  writeCA2?(v: boolean): void;
  writeCB2?(v: boolean): void;
  irqChanged?(): void;
}

const CR_IRQ1_FLAG = 0x80;
const CR_IRQ2_FLAG = 0x40;
const CR_C2_OUTPUT = 0x20;
const CR_DDR_SELECT = 0x04;
const CR_C1_RISING = 0x02;
const CR_IRQ1_ENABLE = 0x01;

interface Port {
  out: number;
  ddr: number;
  cr: number;
  c1: boolean;
  c2in: boolean;
  c2out: boolean;
}

function newPort(): Port {
  return { out: 0, ddr: 0, cr: 0, c1: false, c2in: false, c2out: false };
}

export class Pia6821 {
  private readonly a = newPort();
  private readonly b = newPort();

  constructor(private readonly hooks: PiaHooks = {}) {}

  reset(): void {
    Object.assign(this.a, newPort());
    Object.assign(this.b, newPort());
    this.hooks.writeA?.(0);
    this.hooks.writeB?.(0);
  }

  private irqFor(p: Port): boolean {
    return (
      (!!(p.cr & CR_IRQ1_FLAG) && !!(p.cr & CR_IRQ1_ENABLE)) ||
      (!(p.cr & CR_C2_OUTPUT) && !!(p.cr & CR_IRQ2_FLAG) && !!(p.cr & 0x08))
    );
  }

  irqA(): boolean {
    return this.irqFor(this.a);
  }

  irqB(): boolean {
    return this.irqFor(this.b);
  }

  setCA1(state: boolean): void {
    this.setC1(this.a, state);
  }

  setCB1(state: boolean): void {
    this.setC1(this.b, state);
  }

  setCA2(state: boolean): void {
    this.setC2In(this.a, state);
  }

  setCB2(state: boolean): void {
    this.setC2In(this.b, state);
  }

  private setC1(p: Port, state: boolean): void {
    const rising = !!(p.cr & CR_C1_RISING);
    const active = rising ? !p.c1 && state : p.c1 && !state;
    p.c1 = state;
    if (active) {
      p.cr |= CR_IRQ1_FLAG;
      this.hooks.irqChanged?.();
    }
  }

  private setC2In(p: Port, state: boolean): void {
    if (p.cr & CR_C2_OUTPUT) return;
    const rising = !!(p.cr & 0x10);
    const active = rising ? !p.c2in && state : p.c2in && !state;
    p.c2in = state;
    if (active) {
      p.cr |= CR_IRQ2_FLAG;
      this.hooks.irqChanged?.();
    }
  }

  ca2(): boolean {
    return this.a.c2out;
  }

  cb2(): boolean {
    return this.b.c2out;
  }

  read(offset: number): number {
    switch (offset & 3) {
      case 0:
        return this.readData(this.a, true);
      case 1:
        return this.a.cr;
      case 2:
        return this.readData(this.b, false);
      default:
        return this.b.cr;
    }
  }

  write(offset: number, val: number): void {
    val &= 0xff;
    switch (offset & 3) {
      case 0:
        this.writeData(this.a, val, true);
        break;
      case 1:
        this.writeControl(this.a, val, true);
        break;
      case 2:
        this.writeData(this.b, val, false);
        break;
      default:
        this.writeControl(this.b, val, false);
        break;
    }
  }

  outA(): number {
    return this.a.out;
  }

  outB(): number {
    return this.b.out;
  }

  ddrA(): number {
    return this.a.ddr;
  }

  ddrB(): number {
    return this.b.ddr;
  }

  peek(offset: number): number {
    switch (offset & 3) {
      case 0:
        return this.portAValue();
      case 1:
        return this.a.cr;
      case 2:
        return this.portBValue();
      default:
        return this.b.cr;
    }
  }

  private portAValue(): number {
    const input = (this.hooks.readA?.() ?? 0xff) & 0xff;
    return ((input & ~this.a.ddr) | (this.a.out & this.a.ddr)) & 0xff;
  }

  private portBValue(): number {
    const input = (this.hooks.readB?.() ?? 0xff) & 0xff;
    return ((input & ~this.b.ddr) | (this.b.out & this.b.ddr)) & 0xff;
  }

  private readData(p: Port, isA: boolean): number {
    if (!(p.cr & CR_DDR_SELECT)) return p.ddr;

    const hadIrq = this.irqFor(p);
    p.cr &= ~(CR_IRQ1_FLAG | CR_IRQ2_FLAG) & 0xff;
    if (hadIrq) this.hooks.irqChanged?.();

    this.handshakeOnRead(p, isA);
    return isA ? this.portAValue() : this.portBValue();
  }

  private writeData(p: Port, val: number, isA: boolean): void {
    if (!(p.cr & CR_DDR_SELECT)) {
      p.ddr = val;
    } else {
      p.out = val;
    }
    this.emitPort(p, isA);
  }

  private emitPort(p: Port, isA: boolean): void {
    const driven = p.out & p.ddr;
    if (isA) this.hooks.writeA?.(driven);
    else this.hooks.writeB?.(driven);
  }

  private writeControl(p: Port, val: number, isA: boolean): void {
    const next = (p.cr & (CR_IRQ1_FLAG | CR_IRQ2_FLAG)) | (val & 0x3f);
    const wasOutput = !!(p.cr & CR_C2_OUTPUT);
    const hadIrq = this.irqFor(p);
    p.cr = next;

    const isOutput = !!(p.cr & CR_C2_OUTPUT);
    if (isOutput) {
      const level = p.cr & 0x10 ? !!(p.cr & 0x08) : true;
      this.setC2Out(p, level, isA);
    } else if (wasOutput) {
      p.c2out = false;
    }

    if (this.irqFor(p) !== hadIrq) this.hooks.irqChanged?.();
  }

  private setC2Out(p: Port, level: boolean, isA: boolean): void {
    if (p.c2out === level) return;
    p.c2out = level;
    if (isA) this.hooks.writeCA2?.(level);
    else this.hooks.writeCB2?.(level);
  }

  private handshakeOnRead(p: Port, isA: boolean): void {
    if ((p.cr & (CR_C2_OUTPUT | 0x10)) !== CR_C2_OUTPUT) return;
    this.setC2Out(p, false, isA);
    this.setC2Out(p, true, isA);
  }
}
