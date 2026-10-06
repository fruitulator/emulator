import type { Bus } from './bus';

const C = 0x01;
const Z = 0x02;
const N = 0x04;
const I = 0x08;
const H = 0x10;

const CYCLES: readonly number[] = [
   10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
   7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
   4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
   6, 0, 0, 6, 6, 0, 6, 6, 6, 6, 6, 0, 6, 6, 0, 6,
   4, 0, 0, 4, 4, 0, 4, 4, 4, 4, 4, 0, 4, 4, 0, 4,
   4, 0, 0, 4, 4, 0, 4, 4, 4, 4, 4, 0, 4, 4, 0, 4,
   7, 0, 0, 7, 7, 0, 7, 7, 7, 7, 7, 0, 7, 7, 0, 7,
   6, 0, 0, 6, 6, 0, 6, 6, 6, 6, 6, 0, 6, 6, 0, 6,
   9, 6, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
   0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 0, 2,
   2, 2, 2, 2, 2, 2, 2, 0, 2, 2, 2, 2, 0, 8, 2, 0,
   4, 4, 4, 4, 4, 4, 4, 5, 4, 4, 4, 4, 3, 7, 4, 5,
   5, 5, 5, 5, 5, 5, 5, 6, 5, 5, 5, 5, 4, 8, 5, 6,
   6, 6, 6, 6, 6, 6, 6, 7, 6, 6, 6, 6, 5, 9, 6, 7,
   5, 5, 5, 5, 5, 5, 5, 6, 5, 5, 5, 5, 4, 8, 5, 6,
   4, 4, 4, 4, 4, 4, 4, 5, 4, 4, 4, 4, 3, 7, 4, 5,
];

const INTERRUPT_CYCLES = 11;

export interface M6805Config {
  addrMask: number;
  spMask: number;
  spLow: number;
}

export const enum M6805Irq {
  Int = 1,
  Timer = 2,
}

export class M6805 {
  a = 0;
  x = 0;
  pc = 0;
  s = 0;
  cc = 0xe0 | I;

  pending = 0;
  intLine = false;

  cycles = 0;

  private readonly mask: number;
  private readonly spMask: number;
  private readonly spLow: number;

  private readonly vecTimer: number;
  private readonly vecInt: number;
  private readonly vecSwi: number;
  private readonly vecReset: number;

  constructor(private readonly bus: Bus, cfg: M6805Config) {
    this.mask = cfg.addrMask;
    this.spMask = cfg.spMask;
    this.spLow = cfg.spLow;
    this.vecTimer = (this.mask - 7) & this.mask;
    this.vecInt = (this.mask - 5) & this.mask;
    this.vecSwi = (this.mask - 3) & this.mask;
    this.vecReset = (this.mask - 1) & this.mask;
  }

  reset(): void {
    this.cc = 0xe0 | I;
    this.s = this.spMask;
    this.pending = 0;
    this.pc = this.read16(this.vecReset);
  }

  setInt(asserted: boolean): void {
    if (asserted === this.intLine) return;
    this.intLine = asserted;
    if (asserted) this.pending |= M6805Irq.Int;
  }

  setTimerIrq(asserted: boolean): void {
    if (asserted) this.pending |= M6805Irq.Timer;
    else this.pending &= ~M6805Irq.Timer;
  }

  step(): number {
    if (this.pending !== 0 && !(this.cc & I)) {
      this.push16(this.pc);
      this.push8(this.x);
      this.push8(this.a);
      this.push8(this.cc);
      this.cc |= I;
      if (this.pending & M6805Irq.Int) {
        this.pending &= ~M6805Irq.Int;
        this.pc = this.read16(this.vecInt);
      } else {
        this.pc = this.read16(this.vecTimer);
      }
      this.cycles += INTERRUPT_CYCLES;
      return INTERRUPT_CYCLES;
    }
    const op = this.fetch();
    this.exec(op);
    const n = CYCLES[op];
    this.cycles += n;
    return n;
  }

  private read(addr: number): number {
    return this.bus.read8(addr & this.mask) & 0xff;
  }

  private write(addr: number, v: number): void {
    this.bus.write8(addr & this.mask, v & 0xff);
  }

  private read16(addr: number): number {
    return ((this.read(addr) << 8) | this.read(addr + 1)) & this.mask;
  }

  private fetch(): number {
    const v = this.read(this.pc);
    this.pc = (this.pc + 1) & this.mask;
    return v;
  }

  private push8(v: number): void {
    this.write(this.s, v);
    if (--this.s < this.spLow) this.s = this.spMask;
  }

  private push16(v: number): void {
    this.push8(v & 0xff);
    this.push8((v >> 8) & 0xff);
  }

  private pull8(): number {
    if (++this.s > this.spMask) this.s = this.spLow;
    return this.read(this.s);
  }

  private pull16(): number {
    const hi = this.pull8();
    const lo = this.pull8();
    return ((hi << 8) | lo) & this.mask;
  }

  private setNZ(r: number): void {
    this.cc &= ~(N | Z);
    if (r & 0x80) this.cc |= N;
    if ((r & 0xff) === 0) this.cc |= Z;
  }

  private setNZC(r: number): void {
    this.cc &= ~(N | Z | C);
    if (r & 0x80) this.cc |= N;
    if ((r & 0xff) === 0) this.cc |= Z;
    if (r & 0x100) this.cc |= C;
  }

  private setHNZC(a: number, t: number, r: number): void {
    this.cc &= ~(H | N | Z | C);
    if ((a ^ t ^ r) & 0x10) this.cc |= H;
    if (r & 0x80) this.cc |= N;
    if ((r & 0xff) === 0) this.cc |= Z;
    if (r & 0x100) this.cc |= C;
  }

  private eaDir(): number {
    return this.fetch();
  }

  private eaExt(): number {
    const hi = this.fetch();
    return ((hi << 8) | this.fetch()) & this.mask;
  }

  private eaIx(): number {
    return this.x;
  }

  private eaIx1(): number {
    return (this.fetch() + this.x) & this.mask;
  }

  private eaIx2(): number {
    const hi = this.fetch();
    return (((hi << 8) | this.fetch()) + this.x) & this.mask;
  }

  private ea(op: number): number {
    switch (op >> 4) {
      case 0x3: case 0xb: return this.eaDir();
      case 0x6: case 0xe: return this.eaIx1();
      case 0x7: case 0xf: return this.eaIx();
      case 0xc: return this.eaExt();
      case 0xd: return this.eaIx2();
      default: return 0;
    }
  }

  private arg(op: number): number {
    if ((op >> 4) === 0xa) return this.fetch();
    return this.read(this.ea(op));
  }

  private branch(taken: boolean): void {
    const t = this.fetch();
    if (taken) this.pc = (this.pc + ((t << 24) >> 24)) & this.mask;
  }

  private rmw(op: number, f: (t: number) => number): void {
    const col = op >> 4;
    if (col === 4) { this.a = f(this.a) & 0xff; return; }
    if (col === 5) { this.x = f(this.x) & 0xff; return; }
    const ea = this.ea(op);
    const r = f(this.read(ea)) & 0xff;
    this.write(ea, r);
  }

  private exec(op: number): void {
    const hi = op >> 4;

    if (hi === 0) {
      const bit = (op >> 1) & 7;
      const r = this.read(this.fetch());
      const set = (r >> bit) & 1;
      if (set) this.cc |= C; else this.cc &= ~C;
      this.branch((op & 1) === 0 ? set === 1 : set === 0);
      return;
    }
    if (hi === 1) {
      const bit = (op >> 1) & 7;
      const ea = this.fetch();
      const t = this.read(ea);
      this.write(ea, (op & 1) === 0 ? t | (1 << bit) : t & ~(1 << bit));
      return;
    }
    if (hi === 2) {
      let cond: boolean;
      switch (op & 0x0e) {
        case 0x0: cond = true; break;
        case 0x2: cond = !(this.cc & (C | Z)); break;
        case 0x4: cond = !(this.cc & C); break;
        case 0x6: cond = !(this.cc & Z); break;
        case 0x8: cond = !(this.cc & H); break;
        case 0xa: cond = !(this.cc & N); break;
        case 0xc: cond = !(this.cc & I); break;
        default: cond = this.intLine; break;
      }
      this.branch((op & 1) === 0 ? cond : !cond);
      return;
    }
    if (hi >= 3 && hi <= 7) {
      switch (op & 0x0f) {
        case 0x0:
          this.rmw(op, (t) => { const r = (-t) & 0x1ff; this.setNZC(r); return r; });
          return;
        case 0x3:
          this.rmw(op, (t) => { const r = (~t) & 0xff; this.setNZ(r); this.cc |= C; return r; });
          return;
        case 0x4:
          this.rmw(op, (t) => {
            this.cc &= ~(N | Z | C);
            this.cc |= t & 1;
            const r = t >> 1;
            if (r === 0) this.cc |= Z;
            return r;
          });
          return;
        case 0x6:
          this.rmw(op, (t) => {
            const r = ((this.cc & C) << 7) | (t >> 1);
            this.cc &= ~(N | Z | C);
            this.cc |= t & 1;
            this.setNZ(r);
            return r;
          });
          return;
        case 0x7:
          this.rmw(op, (t) => {
            this.cc &= ~(N | Z | C);
            this.cc |= t & 1;
            const r = (t >> 1) | (t & 0x80);
            this.setNZ(r);
            return r;
          });
          return;
        case 0x8:
          this.rmw(op, (t) => { const r = t << 1; this.setNZC(r); return r; });
          return;
        case 0x9:
          this.rmw(op, (t) => { const r = (this.cc & C) | (t << 1); this.setNZC(r); return r; });
          return;
        case 0xa:
          this.rmw(op, (t) => { const r = (t - 1) & 0xff; this.setNZ(r); return r; });
          return;
        case 0xc:
          this.rmw(op, (t) => { const r = (t + 1) & 0xff; this.setNZ(r); return r; });
          return;
        case 0xd: {
          if (hi === 4) this.setNZ(this.a);
          else if (hi === 5) this.setNZ(this.x);
          else this.setNZ(this.read(this.ea(op)));
          return;
        }
        case 0xe:
          if (hi === 6 || hi === 7) this.pc = this.ea(op);
          return;
        case 0xf:
          this.rmw(op, () => { this.cc &= ~N; this.cc |= Z; return 0; });
          return;
        default:
          return;
      }
    }
    if (hi === 8) {
      switch (op) {
        case 0x80:
          this.cc = this.pull8() | 0xe0;
          this.a = this.pull8();
          this.x = this.pull8();
          this.pc = this.pull16();
          return;
        case 0x81:
          this.pc = this.pull16();
          return;
        case 0x83:
          this.push16(this.pc);
          this.push8(this.x);
          this.push8(this.a);
          this.push8(this.cc);
          this.cc |= I;
          this.pc = this.read16(this.vecSwi);
          return;
        default:
          return;
      }
    }
    if (hi === 9) {
      switch (op) {
        case 0x97: this.x = this.a; return;
        case 0x98: this.cc &= ~C; return;
        case 0x99: this.cc |= C; return;
        case 0x9a: this.cc &= ~I; return;
        case 0x9b: this.cc |= I; return;
        case 0x9c: this.s = this.spMask; return;
        case 0x9d: return;
        case 0x9f: this.a = this.x; return;
        default: return;
      }
    }
    switch (op & 0x0f) {
      case 0x0: {
        const t = this.arg(op);
        const r = (this.a - t) & 0x1ff;
        this.setNZC(r);
        this.a = r & 0xff;
        return;
      }
      case 0x1: {
        const t = this.arg(op);
        this.setNZC((this.a - t) & 0x1ff);
        return;
      }
      case 0x2: {
        const t = this.arg(op);
        const r = (this.a - t - (this.cc & C)) & 0x1ff;
        this.setNZC(r);
        this.a = r & 0xff;
        return;
      }
      case 0x3: {
        const t = this.arg(op);
        this.setNZC((this.x - t) & 0x1ff);
        return;
      }
      case 0x4:
        this.a &= this.arg(op);
        this.setNZ(this.a);
        return;
      case 0x5:
        this.setNZ(this.a & this.arg(op));
        return;
      case 0x6:
        this.a = this.arg(op);
        this.setNZ(this.a);
        return;
      case 0x7:
        if (hi === 0xa) return;
        this.setNZ(this.a);
        this.write(this.ea(op), this.a);
        return;
      case 0x8:
        this.a ^= this.arg(op);
        this.setNZ(this.a);
        return;
      case 0x9: {
        const t = this.arg(op);
        const r = this.a + t + (this.cc & C);
        this.setHNZC(this.a, t, r);
        this.a = r & 0xff;
        return;
      }
      case 0xa:
        this.a |= this.arg(op);
        this.setNZ(this.a);
        return;
      case 0xb: {
        const t = this.arg(op);
        const r = this.a + t;
        this.setHNZC(this.a, t, r);
        this.a = r & 0xff;
        return;
      }
      case 0xc:
        if (hi === 0xa) return;
        this.pc = this.ea(op);
        return;
      case 0xd: {
        if (hi === 0xa) {
          const t = this.fetch();
          this.push16(this.pc);
          this.pc = (this.pc + ((t << 24) >> 24)) & this.mask;
          return;
        }
        const ea = this.ea(op);
        this.push16(this.pc);
        this.pc = ea;
        return;
      }
      case 0xe:
        this.x = this.arg(op);
        this.setNZ(this.x);
        return;
      case 0xf:
        if (hi === 0xa) return;
        this.setNZ(this.x);
        this.write(this.ea(op), this.x);
        return;
      default:
        return;
    }
  }
}
