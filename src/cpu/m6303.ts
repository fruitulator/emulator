import type { Bus } from './bus';

const C = 0x01;
const V = 0x02;
const Z = 0x04;
const N = 0x08;
const I = 0x10;
const H = 0x20;

const VEC_IRQ2 = 0xffea;
const VEC_CMI = 0xffec;
const VEC_TRAP = 0xffee;
const VEC_SCI = 0xfff0;
const VEC_TOI = 0xfff2;
const VEC_OCI = 0xfff4;
const VEC_ICI = 0xfff6;
const VEC_IRQ1 = 0xfff8;
const VEC_SWI = 0xfffa;
const VEC_NMI = 0xfffc;
const VEC_RESET = 0xfffe;

const enum Mode {
  Immediate,
  Direct,
  Indexed,
  Extended,
}

const CYCLES: readonly number[] = [
     4, 1, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
     1, 1, 4, 4, 4, 4, 1, 1, 2, 2, 4, 1, 4, 4, 4, 4,
     3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
     1, 1, 3, 3, 1, 1, 4, 4, 4, 5, 1,10, 5, 7, 9,12,
     1, 4, 4, 1, 1, 4, 1, 1, 1, 1, 1, 4, 1, 1, 4, 1,
     1, 4, 4, 1, 1, 4, 1, 1, 1, 1, 1, 4, 1, 1, 4, 1,
     6, 7, 7, 6, 6, 7, 6, 6, 6, 6, 6, 5, 6, 4, 3, 5,
     6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 4, 6, 4, 3, 5,
     2, 2, 2, 3, 2, 2, 2, 4, 2, 2, 2, 2, 3, 5, 3, 4,
     3, 3, 3, 4, 3, 3, 3, 3, 3, 3, 3, 3, 4, 5, 4, 4,
     4, 4, 4, 5, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5,
     4, 4, 4, 5, 4, 4, 4, 4, 4, 4, 4, 4, 5, 6, 5, 5,
     2, 2, 2, 3, 2, 2, 2, 4, 2, 2, 2, 2, 3, 4, 3, 4,
     3, 3, 3, 4, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4,
     4, 4, 4, 5, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5,
     4, 4, 4, 5, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5,
];

const CYCLES_6800: readonly number[] = [
  4, 2, 4, 4, 4, 4, 2, 2, 4, 4, 2, 2, 2, 2, 2, 2,
  2, 2, 4, 4, 4, 4, 2, 2, 4, 2, 4, 2, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 4, 10, 4, 4, 9, 12,
  2, 4, 4, 2, 2, 4, 2, 2, 2, 2, 2, 4, 2, 2, 4, 2,
  2, 4, 4, 2, 2, 4, 2, 2, 2, 2, 2, 4, 2, 2, 4, 2,
  7, 4, 4, 7, 7, 4, 7, 7, 7, 7, 7, 4, 7, 7, 4, 7,
  6, 4, 4, 6, 6, 4, 6, 6, 6, 6, 6, 4, 6, 6, 3, 6,
  2, 2, 2, 4, 2, 2, 2, 3, 2, 2, 2, 2, 3, 8, 3, 4,
  3, 3, 3, 4, 3, 3, 3, 4, 3, 3, 3, 3, 4, 6, 4, 5,
  5, 5, 5, 4, 5, 5, 5, 6, 5, 5, 5, 5, 6, 8, 6, 7,
  4, 4, 4, 4, 4, 4, 4, 5, 4, 4, 4, 4, 5, 9, 5, 6,
  2, 2, 2, 4, 2, 2, 2, 3, 2, 2, 2, 2, 4, 4, 3, 4,
  3, 3, 3, 4, 3, 3, 3, 4, 3, 3, 3, 3, 4, 4, 4, 5,
  5, 5, 5, 4, 5, 5, 5, 6, 5, 5, 5, 5, 4, 4, 6, 7,
  4, 4, 4, 4, 4, 4, 4, 5, 4, 4, 4, 4, 4, 4, 5, 6,
];

const ILLEGAL_6800 = (() => {
  const t = new Uint8Array(256);
  for (const op of [0x00, 0x02, 0x03, 0x04, 0x05, 0x12, 0x13, 0x14, 0x15, 0x18, 0x1a, 0x1c, 0x1d, 0x1e, 0x1f,
    0x38, 0x3a, 0x3c, 0x3d, 0x41, 0x42, 0x45, 0x4b, 0x4e, 0x51, 0x52, 0x55, 0x5b, 0x5e]) t[op] = 1;
  for (const op of [0x61, 0x62, 0x65, 0x6b, 0x83, 0x93, 0xa3, 0xc3, 0xd3, 0xdc, 0xdd, 0xe3, 0xec, 0xed]) t[op] = 2;
  for (const op of [0x71, 0x72, 0x75, 0x7b, 0xb3, 0xcc, 0xcd, 0xf3, 0xfc, 0xfd]) t[op] = 3;
  return t;
})();

export type CoreVariant = 'hd6303y' | 'm6800';

export type InternalIRQ = 'isi' | 'ici' | 'oci' | 'toi' | 'cmi' | 'sci';

const SRC_BIT: Readonly<Record<InternalIRQ, number>> = {
  isi: 0x01,
  ici: 0x02,
  oci: 0x04,
  toi: 0x08,
  cmi: 0x10,
  sci: 0x20,
};

export class HD6303Y {
  a = 0;
  b = 0;
  x = 0;
  s = 0;
  pc = 0;
  cc = 0xd0;

  cycles = 0;

  irq1Enabled = false;
  irq2Enabled = false;

  traps = 0;

  private waiting = false;
  private sleeping = false;

  private irq1Line = false;
  private irq2Line = false;
  private nmiLine = false;
  private nmiPending = false;
  private internal = 0;

  private inhibitIrq = false;

  private readonly m6800: boolean;
  private readonly cycleTable: readonly number[];

  constructor(private readonly bus: Bus, variant: CoreVariant = 'hd6303y') {
    this.m6800 = variant === 'm6800';
    this.cycleTable = this.m6800 ? CYCLES_6800 : CYCLES;
  }

  get d(): number {
    return ((this.a << 8) | this.b) & 0xffff;
  }

  set d(v: number) {
    this.a = (v >> 8) & 0xff;
    this.b = v & 0xff;
  }

  reset(): void {
    this.cc = 0xd0;
    this.waiting = false;
    this.sleeping = false;
    this.inhibitIrq = false;
    this.irq1Line = false;
    this.irq2Line = false;
    this.nmiLine = false;
    this.nmiPending = false;
    this.internal = 0;
    this.irq1Enabled = false;
    this.irq2Enabled = false;
    this.traps = 0;
    this.pc = this.read16(VEC_RESET);
  }

  setIRQ1(active: boolean): void {
    this.irq1Line = active;
  }

  setIRQ2(active: boolean): void {
    this.irq2Line = active;
  }

  setNMI(active: boolean): void {
    if (active && !this.nmiLine) this.nmiPending = true;
    this.nmiLine = active;
  }

  setInternalIRQ(src: InternalIRQ, active: boolean): void {
    if (active) this.internal |= SRC_BIT[src];
    else this.internal &= ~SRC_BIT[src] & 0xff;
  }

  private read8(addr: number): number {
    return this.bus.read8(addr & 0xffff) & 0xff;
  }

  private write8(addr: number, v: number): void {
    this.bus.write8(addr & 0xffff, v & 0xff);
  }

  private read16(addr: number): number {
    return ((this.read8(addr) << 8) | this.read8(addr + 1)) & 0xffff;
  }

  private write16(addr: number, v: number): void {
    this.write8(addr, v >> 8);
    this.write8(addr + 1, v);
  }

  private fetch8(): number {
    const v = this.read8(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  private fetch16(): number {
    const v = this.read16(this.pc);
    this.pc = (this.pc + 2) & 0xffff;
    return v;
  }

  private setFlag(mask: number, on: boolean): void {
    if (on) this.cc |= mask;
    else this.cc &= ~mask & 0xff;
  }

  private nz8(v: number): number {
    v &= 0xff;
    this.setFlag(N, (v & 0x80) !== 0);
    this.setFlag(Z, v === 0);
    this.cc &= ~V & 0xff;
    return v;
  }

  private nz16(v: number): number {
    v &= 0xffff;
    this.setFlag(N, (v & 0x8000) !== 0);
    this.setFlag(Z, v === 0);
    this.cc &= ~V & 0xff;
    return v;
  }

  private flags8(a: number, b: number, res: number): number {
    this.setFlag(N, (res & 0x80) !== 0);
    this.setFlag(Z, (res & 0xff) === 0);
    this.setFlag(V, ((a ^ b ^ res ^ (res >>> 1)) & 0x80) !== 0);
    this.setFlag(C, (res & 0x100) !== 0);
    return res & 0xff;
  }

  private flags16(a: number, b: number, res: number): number {
    this.setFlag(N, (res & 0x8000) !== 0);
    this.setFlag(Z, (res & 0xffff) === 0);
    this.setFlag(V, ((a ^ b ^ res ^ (res >>> 1)) & 0x8000) !== 0);
    this.setFlag(C, (res & 0x10000) !== 0);
    return res & 0xffff;
  }

  private add8(r: number, v: number, carryIn: number): number {
    const res = r + v + carryIn;
    this.setFlag(H, ((r ^ v ^ res) & 0x10) !== 0);
    return this.flags8(r, v, res);
  }

  private sub8(r: number, v: number, borrowIn: number): number {
    return this.flags8(r, v, (r - v - borrowIn) & 0x1ff);
  }

  private add16(r: number, v: number): number {
    return this.flags16(r, v, r + v);
  }

  private sub16(r: number, v: number): number {
    return this.flags16(r, v, (r - v) & 0x1ffff);
  }

  private ea(mode: Mode): number {
    switch (mode) {
      case Mode.Direct:
        return this.fetch8();
      case Mode.Indexed:
        return (this.x + this.fetch8()) & 0xffff;
      case Mode.Extended:
        return this.fetch16();
      default:
        throw new Error('ea() called for immediate');
    }
  }

  private operand8(mode: Mode): number {
    return mode === Mode.Immediate ? this.fetch8() : this.read8(this.ea(mode));
  }

  private operand16(mode: Mode): number {
    return mode === Mode.Immediate ? this.fetch16() : this.read16(this.ea(mode));
  }

  private opNEG(v: number): number {
    return this.flags8(0, v, (0 - v) & 0x1ff);
  }

  private opCOM(v: number): number {
    const res = this.nz8(~v);
    this.cc |= C;
    return res;
  }

  private shiftFlags(res: number, carry: boolean): number {
    res &= 0xff;
    const n = (res & 0x80) !== 0;
    this.setFlag(N, n);
    this.setFlag(Z, res === 0);
    this.setFlag(C, carry);
    this.setFlag(V, n !== carry);
    return res;
  }

  private opLSR(v: number): number {
    return this.shiftFlags(v >> 1, (v & 1) !== 0);
  }

  private opROR(v: number): number {
    return this.shiftFlags(((this.cc & C) << 7) | (v >> 1), (v & 1) !== 0);
  }

  private opASR(v: number): number {
    return this.shiftFlags((v >> 1) | (v & 0x80), (v & 1) !== 0);
  }

  private opASL(v: number): number {
    return this.shiftFlags(v << 1, (v & 0x80) !== 0);
  }

  private opROL(v: number): number {
    return this.shiftFlags((v << 1) | (this.cc & C), (v & 0x80) !== 0);
  }

  private opDEC(v: number): number {
    const res = (v - 1) & 0xff;
    this.setFlag(N, (res & 0x80) !== 0);
    this.setFlag(Z, res === 0);
    this.setFlag(V, res === 0x7f);
    return res;
  }

  private opINC(v: number): number {
    const res = (v + 1) & 0xff;
    this.setFlag(N, (res & 0x80) !== 0);
    this.setFlag(Z, res === 0);
    this.setFlag(V, res === 0x80);
    return res;
  }

  private opTST(v: number): void {
    this.nz8(v);
    this.cc &= ~C & 0xff;
  }

  private pushByte(v: number): void {
    this.write8(this.s, v);
    this.s = (this.s - 1) & 0xffff;
  }

  private pullByte(): number {
    this.s = (this.s + 1) & 0xffff;
    return this.read8(this.s);
  }

  private pushWord(v: number): void {
    this.pushByte(v & 0xff);
    this.pushByte(v >> 8);
  }

  private pullWord(): number {
    const hi = this.pullByte();
    return ((hi << 8) | this.pullByte()) & 0xffff;
  }

  private pendingVector(): number {
    if (this.irq1Line && this.irq1Enabled) return VEC_IRQ1;
    if (this.internal & SRC_BIT.isi) return VEC_IRQ1;
    if (this.internal & SRC_BIT.ici) return VEC_ICI;
    if (this.internal & SRC_BIT.oci) return VEC_OCI;
    if (this.internal & SRC_BIT.toi) return VEC_TOI;
    if (this.internal & SRC_BIT.cmi) return VEC_CMI;
    if (this.irq2Line && this.irq2Enabled) return VEC_IRQ2;
    if (this.internal & SRC_BIT.sci) return VEC_SCI;
    return -1;
  }

  private enterInterrupt(vector: number): void {
    if (this.waiting) {
      this.waiting = false;
      this.cycles += 4;
    } else {
      this.pushWord(this.pc);
      this.pushWord(this.x);
      this.pushByte(this.a);
      this.pushByte(this.b);
      this.pushByte(this.cc);
      this.cycles += 12;
    }
    this.cc |= I;
    this.pc = this.read16(vector);
  }

  private serviceInterrupts(): boolean {
    if (this.nmiPending) {
      this.nmiPending = false;
      this.sleeping = false;
      this.enterInterrupt(VEC_NMI);
      return true;
    }
    const vector = this.pendingVector();
    if (vector < 0) return false;
    this.sleeping = false;
    if (this.cc & I) return false;
    this.enterInterrupt(vector);
    return true;
  }

  step(): number {
    const start = this.cycles;

    if (this.inhibitIrq) this.inhibitIrq = false;
    else if (this.serviceInterrupts()) return this.cycles - start;

    if (this.waiting || this.sleeping) {
      this.cycles += 1;
      return 1;
    }

    const op = this.fetch8();
    this.execute(op);
    this.cycles += this.cycleTable[op];
    return this.cycles - start;
  }

  run(n: number): number {
    let done = 0;
    while (done < n) done += this.step();
    return done;
  }

  private execute(op: number): void {
    if (this.m6800 && this.execute6800(op)) return;
    if (op >= 0x80) this.execRegisterOp(op);
    else if (op >= 0x60) this.execMemoryRMW(op);
    else if (op >= 0x40) this.execAccumulatorRMW(op);
    else if (op >= 0x20 && op < 0x30) this.execBranch(op);
    else this.execInherent(op);
  }

  private execute6800(op: number): boolean {
    const skip = ILLEGAL_6800[op];
    if (skip) {
      this.traps++;
      this.pc = (this.pc + skip - 1) & 0xffff;
      return true;
    }
    if ((op & 0xcf) === 0x8c) {
      const bits = (op >> 4) & 3;
      const mode = bits === 0 ? Mode.Immediate : bits === 1 ? Mode.Direct : bits === 2 ? Mode.Indexed : Mode.Extended;
      const m = this.operand16(mode);
      const dh = this.x >> 8;
      const bh = m >> 8;
      const r = (dh - bh) & 0xffff;
      this.cc &= ~(N | Z | V) & 0xff;
      if (r & 0x80) this.cc |= N;
      if ((dh ^ bh ^ r ^ (r >> 1)) & 0x80) this.cc |= V;
      if (((this.x - m) & 0xffff) === 0) this.cc |= Z;
      return true;
    }
    if (op === 0x87 || op === 0xc7) {
      const ea = this.pc;
      this.pc = (this.pc + 1) & 0xffff;
      this.write8(ea, this.nz8(op === 0x87 ? this.a : this.b));
      return true;
    }
    if (op === 0x8f || op === 0xcf) {
      const ea = this.pc;
      this.pc = (this.pc + 2) & 0xffff;
      this.write16(ea, this.nz16(op === 0x8f ? this.s : this.x));
      return true;
    }
    return false;
  }

  private execInherent(op: number): void {
    switch (op) {
      case 0x01:
        break;
      case 0x04: {
        const t = this.d;
        this.d = this.shiftFlags16(t >> 1, (t & 1) !== 0);
        break;
      }
      case 0x05: {
        const t = this.d;
        this.d = this.flags16(t, t, t << 1);
        break;
      }
      case 0x06:
        this.cc = this.a;
        this.inhibitIrq = true;
        break;
      case 0x07:
        this.a = this.cc;
        break;
      case 0x08:
        this.x = (this.x + 1) & 0xffff;
        this.setFlag(Z, this.x === 0);
        break;
      case 0x09:
        this.x = (this.x - 1) & 0xffff;
        this.setFlag(Z, this.x === 0);
        break;
      case 0x0a: this.cc &= ~V & 0xff; break;
      case 0x0b: this.cc |= V; break;
      case 0x0c: this.cc &= ~C & 0xff; break;
      case 0x0d: this.cc |= C; break;
      case 0x0e:
        if (this.cc & I) this.inhibitIrq = true;
        this.cc &= ~I & 0xff;
        break;
      case 0x0f: this.cc |= I; break;
      case 0x10: this.a = this.sub8(this.a, this.b, 0); break;
      case 0x11: this.sub8(this.a, this.b, 0); break;
      case 0x12:
      case 0x13:
        this.x = (this.x + this.read8((this.s + 1) & 0xffff)) & 0xffff;
        break;
      case 0x16: this.b = this.nz8(this.a); break;
      case 0x17: this.a = this.nz8(this.b); break;
      case 0x18: {
        const t = this.x;
        this.x = this.d;
        this.d = t;
        break;
      }
      case 0x19: this.daa(); break;
      case 0x1a: this.sleeping = true; break;
      case 0x1b: this.a = this.add8(this.a, this.b, 0); break;
      case 0x30: this.x = (this.s + 1) & 0xffff; break;
      case 0x31: this.s = (this.s + 1) & 0xffff; break;
      case 0x32: this.a = this.pullByte(); break;
      case 0x33: this.b = this.pullByte(); break;
      case 0x34: this.s = (this.s - 1) & 0xffff; break;
      case 0x35: this.s = (this.x - 1) & 0xffff; break;
      case 0x36: this.pushByte(this.a); break;
      case 0x37: this.pushByte(this.b); break;
      case 0x38: this.x = this.pullWord(); break;
      case 0x39: this.pc = this.pullWord(); break;
      case 0x3a: this.x = (this.x + this.b) & 0xffff; break;
      case 0x3b:
        this.cc = this.pullByte();
        this.b = this.pullByte();
        this.a = this.pullByte();
        this.x = this.pullWord();
        this.pc = this.pullWord();
        break;
      case 0x3c: this.pushWord(this.x); break;
      case 0x3d: {
        const t = this.a * this.b;
        this.setFlag(C, (t & 0x80) !== 0);
        this.d = t;
        break;
      }
      case 0x3e:
        this.pushWord(this.pc);
        this.pushWord(this.x);
        this.pushByte(this.a);
        this.pushByte(this.b);
        this.pushByte(this.cc);
        this.waiting = true;
        break;
      case 0x3f:
        this.pushWord(this.pc);
        this.pushWord(this.x);
        this.pushByte(this.a);
        this.pushByte(this.b);
        this.pushByte(this.cc);
        this.cc |= I;
        this.pc = this.read16(VEC_SWI);
        break;
      default:
        this.trap();
    }
  }

  private shiftFlags16(res: number, carry: boolean): number {
    res &= 0xffff;
    const n = (res & 0x8000) !== 0;
    this.setFlag(N, n);
    this.setFlag(Z, res === 0);
    this.setFlag(C, carry);
    this.setFlag(V, n !== carry);
    return res;
  }

  private execBranch(op: number): void {
    const off = (this.fetch8() << 24) >> 24;
    if (this.testCC(op & 0x0f)) this.pc = (this.pc + off) & 0xffff;
  }

  private testCC(cond: number): boolean {
    const n = (this.cc & N) !== 0;
    const z = (this.cc & Z) !== 0;
    const v = (this.cc & V) !== 0;
    const c = (this.cc & C) !== 0;
    switch (cond) {
      case 0x0: return true;
      case 0x1: return false;
      case 0x2: return !c && !z;
      case 0x3: return c || z;
      case 0x4: return !c;
      case 0x5: return c;
      case 0x6: return !z;
      case 0x7: return z;
      case 0x8: return !v;
      case 0x9: return v;
      case 0xa: return !n;
      case 0xb: return n;
      case 0xc: return n === v;
      case 0xd: return n !== v;
      case 0xe: return !z && n === v;
      default:  return z || n !== v;
    }
  }

  private execAccumulatorRMW(op: number): void {
    const isB = (op & 0x10) !== 0;
    const get = () => (isB ? this.b : this.a);
    const set = (v: number) => {
      if (isB) this.b = v;
      else this.a = v;
    };

    switch (op & 0x0f) {
      case 0x0: set(this.opNEG(get())); break;
      case 0x3: set(this.opCOM(get())); break;
      case 0x4: set(this.opLSR(get())); break;
      case 0x6: set(this.opROR(get())); break;
      case 0x7: set(this.opASR(get())); break;
      case 0x8: set(this.opASL(get())); break;
      case 0x9: set(this.opROL(get())); break;
      case 0xa: set(this.opDEC(get())); break;
      case 0xc: set(this.opINC(get())); break;
      case 0xd: this.opTST(get()); break;
      case 0xf:
        set(0);
        this.cc = (this.cc & ~(N | V | C) & 0xff) | Z;
        break;
      default:
        this.trap();
    }
  }

  private execMemoryRMW(op: number): void {
    const lo = op & 0x0f;
    const indexed = op < 0x70;

    if (lo === 0x1 || lo === 0x2 || lo === 0x5 || lo === 0xb) {
      this.execMaskOp(lo, indexed ? Mode.Indexed : Mode.Direct);
      return;
    }

    const mode = indexed ? Mode.Indexed : Mode.Extended;

    if (lo === 0xe) {
      this.pc = this.ea(mode);
      return;
    }
    if (lo === 0xd) {
      this.opTST(this.read8(this.ea(mode)));
      return;
    }
    if (lo === 0xf) {
      const addr = this.ea(mode);
      this.read8(addr);
      this.write8(addr, 0);
      this.cc = (this.cc & ~(N | V | C) & 0xff) | Z;
      return;
    }

    const addr = this.ea(mode);
    const t = this.read8(addr);
    switch (lo) {
      case 0x0: this.write8(addr, this.opNEG(t)); break;
      case 0x3: this.write8(addr, this.opCOM(t)); break;
      case 0x4: this.write8(addr, this.opLSR(t)); break;
      case 0x6: this.write8(addr, this.opROR(t)); break;
      case 0x7: this.write8(addr, this.opASR(t)); break;
      case 0x8: this.write8(addr, this.opASL(t)); break;
      case 0x9: this.write8(addr, this.opROL(t)); break;
      case 0xa: this.write8(addr, this.opDEC(t)); break;
      default: this.write8(addr, this.opINC(t)); break;
    }
  }

  private execMaskOp(lo: number, mode: Mode): void {
    const mask = this.fetch8();
    const addr = this.ea(mode);
    const t = this.read8(addr);
    switch (lo) {
      case 0x1: this.write8(addr, this.nz8(t & mask)); break;
      case 0x2: this.write8(addr, this.nz8(t | mask)); break;
      case 0x5: this.write8(addr, this.nz8(t ^ mask)); break;
      default: this.nz8(t & mask); break;
    }
  }

  private execRegisterOp(op: number): void {
    const modeBits = (op >> 4) & 0x03;
    const mode =
      modeBits === 0 ? Mode.Immediate
      : modeBits === 1 ? Mode.Direct
      : modeBits === 2 ? Mode.Indexed
      : Mode.Extended;
    const isB = (op & 0x40) !== 0;
    const lo = op & 0x0f;

    const get = () => (isB ? this.b : this.a);
    const set = (v: number) => {
      if (isB) this.b = v;
      else this.a = v;
    };

    switch (lo) {
      case 0x0: set(this.sub8(get(), this.operand8(mode), 0)); break;
      case 0x1: this.sub8(get(), this.operand8(mode), 0); break;
      case 0x2: set(this.sub8(get(), this.operand8(mode), this.cc & C ? 1 : 0)); break;
      case 0x3: {
        const m = this.operand16(mode);
        this.d = isB ? this.add16(this.d, m) : this.sub16(this.d, m);
        break;
      }
      case 0x4: set(this.nz8(get() & this.operand8(mode))); break;
      case 0x5: this.nz8(get() & this.operand8(mode)); break;
      case 0x6: set(this.nz8(this.operand8(mode))); break;
      case 0x7:
        if (mode === Mode.Immediate) return this.trap();
        this.write8(this.ea(mode), this.nz8(get()));
        break;
      case 0x8: set(this.nz8(get() ^ this.operand8(mode))); break;
      case 0x9: set(this.add8(get(), this.operand8(mode), this.cc & C ? 1 : 0)); break;
      case 0xa: set(this.nz8(get() | this.operand8(mode))); break;
      case 0xb: set(this.add8(get(), this.operand8(mode), 0)); break;
      case 0xc:
        if (isB) this.d = this.nz16(this.operand16(mode));
        else this.sub16(this.x, this.operand16(mode));
        break;
      case 0xd:
        if (isB) {
          if (mode === Mode.Immediate) return this.trap();
          this.write16(this.ea(mode), this.nz16(this.d));
        } else if (mode === Mode.Immediate) {
          const off = (this.fetch8() << 24) >> 24;
          this.pushWord(this.pc);
          this.pc = (this.pc + off) & 0xffff;
        } else {
          const addr = this.ea(mode);
          this.pushWord(this.pc);
          this.pc = addr;
        }
        break;
      case 0xe: {
        const v = this.nz16(this.operand16(mode));
        if (isB) this.x = v;
        else this.s = v;
        break;
      }
      default:
        if (mode === Mode.Immediate) return this.trap();
        this.write16(this.ea(mode), this.nz16(isB ? this.x : this.s));
        break;
    }
  }

  private daa(): void {
    const msn = this.a & 0xf0;
    const lsn = this.a & 0x0f;
    let cf = 0;
    if (lsn > 0x09 || this.cc & H) cf |= 0x06;
    if (msn > 0x80 && lsn > 0x09) cf |= 0x60;
    if (msn > 0x90 || this.cc & C) cf |= 0x60;
    const t = this.a + cf;
    this.a = this.nz8(t);
    if (t & 0x100) this.cc |= C;
  }

  private trap(): void {
    this.traps++;
    this.pc = (this.pc - 1) & 0xffff;
    this.enterInterrupt(VEC_TRAP);
  }

  trace(): string {
    const h = (v: number, n: number) => v.toString(16).toUpperCase().padStart(n, '0');
    return (
      `${h(this.pc, 4)} A=${h(this.a, 2)} B=${h(this.b, 2)} ` +
      `X=${h(this.x, 4)} S=${h(this.s, 4)} CC=${h(this.cc, 2)}`
    );
  }
}
