import type { Bus } from './bus';

const C = 0x01;
const V = 0x02;
const Z = 0x04;
const N = 0x08;
const I = 0x10;
const H = 0x20;
const F = 0x40;
const E = 0x80;

const VEC_SWI3 = 0xfff2;
const VEC_SWI2 = 0xfff4;
const VEC_FIRQ = 0xfff6;
const VEC_IRQ = 0xfff8;
const VEC_SWI = 0xfffa;
const VEC_NMI = 0xfffc;
const VEC_RESET = 0xfffe;

const enum Mode {
  Immediate,
  Direct,
  Indexed,
  Extended,
  Inherent,
}

export class M6809 {
  a = 0;
  b = 0;
  x = 0;
  y = 0;
  u = 0;
  s = 0;
  pc = 0;
  dp = 0;
  cc = I | F;

  cycles = 0;

  private waiting = false;
  private syncing = false;

  private irqLine = false;
  private firqLine = false;
  private nmiLine = false;
  private nmiEdge = false;
  private nmiArmed = false;

  constructor(private readonly bus: Bus) {}

  get d(): number {
    return ((this.a << 8) | this.b) & 0xffff;
  }

  set d(v: number) {
    this.a = (v >> 8) & 0xff;
    this.b = v & 0xff;
  }

  reset(): void {
    this.cc = I | F;
    this.dp = 0;
    this.nmiArmed = false;
    this.waiting = false;
    this.syncing = false;
    this.irqLine = false;
    this.firqLine = false;
    this.nmiLine = false;
    this.nmiEdge = false;
    this.pc = this.read16(VEC_RESET);
  }

  setIRQ(active: boolean): void {
    this.irqLine = active;
  }

  setFIRQ(active: boolean): void {
    this.firqLine = active;
  }

  setNMI(active: boolean): void {
    if (active && !this.nmiLine) this.nmiEdge = true;
    this.nmiLine = active;
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

  private idxCycles = 0;

  private indexedEA(): number {
    const pb = this.fetch8();
    const rn = (pb >> 5) & 3;
    let reg = this.getIdxReg(rn);
    let ea = 0;
    this.idxCycles = 0;

    if ((pb & 0x80) === 0) {
      const off = (pb & 0x1f) << 27 >> 27;
      this.idxCycles = 1;
      return (reg + off) & 0xffff;
    }

    switch (pb & 0x0f) {
      case 0x0:
        ea = reg;
        this.setIdxReg(rn, reg + 1);
        this.idxCycles = 2;
        break;
      case 0x1:
        ea = reg;
        this.setIdxReg(rn, reg + 2);
        this.idxCycles = 3;
        break;
      case 0x2:
        reg = (reg - 1) & 0xffff;
        this.setIdxReg(rn, reg);
        ea = reg;
        this.idxCycles = 2;
        break;
      case 0x3:
        reg = (reg - 2) & 0xffff;
        this.setIdxReg(rn, reg);
        ea = reg;
        this.idxCycles = 3;
        break;
      case 0x4:
        ea = reg;
        break;
      case 0x5:
        ea = reg + ((this.b << 24) >> 24);
        this.idxCycles = 1;
        break;
      case 0x6:
        ea = reg + ((this.a << 24) >> 24);
        this.idxCycles = 1;
        break;
      case 0x8:
        ea = reg + ((this.fetch8() << 24) >> 24);
        this.idxCycles = 1;
        break;
      case 0x9:
        ea = reg + ((this.fetch16() << 16) >> 16);
        this.idxCycles = 4;
        break;
      case 0xb:
        ea = reg + ((this.d << 16) >> 16);
        this.idxCycles = 4;
        break;
      case 0xc:
        {
          const off = (this.fetch8() << 24) >> 24;
          ea = this.pc + off;
          this.idxCycles = 1;
        }
        break;
      case 0xd:
        {
          const off = (this.fetch16() << 16) >> 16;
          ea = this.pc + off;
          this.idxCycles = 5;
        }
        break;
      case 0xf:
        ea = this.fetch16();
        this.idxCycles = 2;
        break;
      default:
        ea = reg;
        break;
    }

    ea &= 0xffff;

    if (pb & 0x10) {
      ea = this.read16(ea);
      this.idxCycles += 3;
    }
    return ea;
  }

  private getIdxReg(n: number): number {
    return n === 0 ? this.x : n === 1 ? this.y : n === 2 ? this.u : this.s;
  }

  private setIdxReg(n: number, v: number): void {
    v &= 0xffff;
    if (n === 0) this.x = v;
    else if (n === 1) this.y = v;
    else if (n === 2) this.u = v;
    else {
      this.s = v;
      this.nmiArmed = true;
    }
  }

  private ea(mode: Mode): number {
    switch (mode) {
      case Mode.Direct:
        return ((this.dp << 8) | this.fetch8()) & 0xffff;
      case Mode.Indexed:
        return this.indexedEA();
      case Mode.Extended:
        return this.fetch16();
      default:
        throw new Error('ea() called for immediate/inherent');
    }
  }

  private operand8(mode: Mode): number {
    return mode === Mode.Immediate ? this.fetch8() : this.read8(this.ea(mode));
  }

  private operand16(mode: Mode): number {
    return mode === Mode.Immediate ? this.fetch16() : this.read16(this.ea(mode));
  }

  private add8(r: number, v: number, carryIn: number): number {
    const res = r + v + carryIn;
    const half = (r & 0x0f) + (v & 0x0f) + carryIn;
    this.setFlag(H, half > 0x0f);
    this.setFlag(C, res > 0xff);
    this.setFlag(V, ((r ^ ~v) & (r ^ res) & 0x80) !== 0);
    const out = res & 0xff;
    this.setFlag(N, (out & 0x80) !== 0);
    this.setFlag(Z, out === 0);
    return out;
  }

  private sub8(r: number, v: number, borrowIn: number): number {
    const res = r - v - borrowIn;
    this.setFlag(C, (res & 0x100) !== 0);
    this.setFlag(V, ((r ^ v) & (r ^ res) & 0x80) !== 0);
    const out = res & 0xff;
    this.setFlag(N, (out & 0x80) !== 0);
    this.setFlag(Z, out === 0);
    return out;
  }

  private add16(r: number, v: number): number {
    const res = r + v;
    this.setFlag(C, res > 0xffff);
    this.setFlag(V, ((r ^ ~v) & (r ^ res) & 0x8000) !== 0);
    const out = res & 0xffff;
    this.setFlag(N, (out & 0x8000) !== 0);
    this.setFlag(Z, out === 0);
    return out;
  }

  private sub16(r: number, v: number): number {
    const res = r - v;
    this.setFlag(C, (res & 0x10000) !== 0);
    this.setFlag(V, ((r ^ v) & (r ^ res) & 0x8000) !== 0);
    const out = res & 0xffff;
    this.setFlag(N, (out & 0x8000) !== 0);
    this.setFlag(Z, out === 0);
    return out;
  }

  private rmw(mode: Mode, fn: (v: number) => number): void {
    if (mode === Mode.Inherent) throw new Error('rmw needs a memory mode');
    const addr = this.ea(mode);
    this.write8(addr, fn(this.read8(addr)));
  }

  private opNEG(v: number): number {
    const res = (0 - v) & 0xff;
    this.setFlag(C, v !== 0);
    this.setFlag(V, v === 0x80);
    this.setFlag(N, (res & 0x80) !== 0);
    this.setFlag(Z, res === 0);
    return res;
  }

  private opCOM(v: number): number {
    const res = ~v & 0xff;
    this.setFlag(C, true);
    this.cc &= ~V & 0xff;
    this.setFlag(N, (res & 0x80) !== 0);
    this.setFlag(Z, res === 0);
    return res;
  }

  private opLSR(v: number): number {
    this.setFlag(C, (v & 1) !== 0);
    const res = (v >> 1) & 0xff;
    this.cc &= ~N & 0xff;
    this.setFlag(Z, res === 0);
    return res;
  }

  private opROR(v: number): number {
    const carry = this.cc & C ? 0x80 : 0;
    this.setFlag(C, (v & 1) !== 0);
    const res = ((v >> 1) | carry) & 0xff;
    this.setFlag(N, (res & 0x80) !== 0);
    this.setFlag(Z, res === 0);
    return res;
  }

  private opASR(v: number): number {
    this.setFlag(C, (v & 1) !== 0);
    const res = ((v >> 1) | (v & 0x80)) & 0xff;
    this.setFlag(N, (res & 0x80) !== 0);
    this.setFlag(Z, res === 0);
    return res;
  }

  private opASL(v: number): number {
    this.setFlag(C, (v & 0x80) !== 0);
    this.setFlag(V, ((v ^ (v << 1)) & 0x80) !== 0);
    const res = (v << 1) & 0xff;
    this.setFlag(N, (res & 0x80) !== 0);
    this.setFlag(Z, res === 0);
    return res;
  }

  private opROL(v: number): number {
    const carry = this.cc & C ? 1 : 0;
    this.setFlag(C, (v & 0x80) !== 0);
    this.setFlag(V, ((v ^ (v << 1)) & 0x80) !== 0);
    const res = ((v << 1) | carry) & 0xff;
    this.setFlag(N, (res & 0x80) !== 0);
    this.setFlag(Z, res === 0);
    return res;
  }

  private opDEC(v: number): number {
    const res = (v - 1) & 0xff;
    this.setFlag(V, v === 0x80);
    this.setFlag(N, (res & 0x80) !== 0);
    this.setFlag(Z, res === 0);
    return res;
  }

  private opINC(v: number): number {
    const res = (v + 1) & 0xff;
    this.setFlag(V, v === 0x7f);
    this.setFlag(N, (res & 0x80) !== 0);
    this.setFlag(Z, res === 0);
    return res;
  }

  private pushS8(v: number): void {
    this.s = (this.s - 1) & 0xffff;
    this.write8(this.s, v);
  }

  private pullS8(): number {
    const v = this.read8(this.s);
    this.s = (this.s + 1) & 0xffff;
    return v;
  }

  private pushS16(v: number): void {
    this.pushS8(v & 0xff);
    this.pushS8(v >> 8);
  }

  private pullS16(): number {
    const hi = this.pullS8();
    return ((hi << 8) | this.pullS8()) & 0xffff;
  }

  private push(mask: number, toS: boolean): number {
    const other = toS ? this.u : this.s;
    let sp = toS ? this.s : this.u;
    let n = 0;
    const w8 = (v: number) => {
      sp = (sp - 1) & 0xffff;
      this.write8(sp, v);
      n++;
    };
    const w16 = (v: number) => {
      w8(v & 0xff);
      w8(v >> 8);
    };
    if (mask & 0x80) w16(this.pc);
    if (mask & 0x40) w16(other);
    if (mask & 0x20) w16(this.y);
    if (mask & 0x10) w16(this.x);
    if (mask & 0x08) w8(this.dp);
    if (mask & 0x04) w8(this.b);
    if (mask & 0x02) w8(this.a);
    if (mask & 0x01) w8(this.cc);
    if (toS) {
      this.s = sp;
      this.nmiArmed = true;
    } else this.u = sp;
    return n;
  }

  private pull(mask: number, fromS: boolean): number {
    let sp = fromS ? this.s : this.u;
    let n = 0;
    const r8 = () => {
      const v = this.read8(sp);
      sp = (sp + 1) & 0xffff;
      n++;
      return v;
    };
    const r16 = () => ((r8() << 8) | r8()) & 0xffff;
    if (mask & 0x01) this.cc = r8();
    if (mask & 0x02) this.a = r8();
    if (mask & 0x04) this.b = r8();
    if (mask & 0x08) this.dp = r8();
    if (mask & 0x10) this.x = r16();
    if (mask & 0x20) this.y = r16();
    if (mask & 0x40) {
      const v = r16();
      if (fromS) this.u = v;
      else this.s = v;
    }
    if (mask & 0x80) this.pc = r16();
    if (fromS) {
      this.s = sp;
      this.nmiArmed = true;
    } else this.u = sp;
    return n;
  }

  private pushState(entire: boolean): void {
    this.setFlag(E, entire);
    this.push(entire ? 0xff : 0x81, true);
  }

  private tfrRead816(n: number): number {
    switch (n & 0x0f) {
      case 0: return this.d;
      case 1: return this.x;
      case 2: return this.y;
      case 3: return this.u;
      case 4: return this.s;
      case 5: return this.pc;
      case 8: return 0xff00 | this.a;
      case 9: return 0xff00 | this.b;
      case 10: return (this.cc << 8) | this.cc;
      case 11: return (this.dp << 8) | this.dp;
      default: return 0xffff;
    }
  }

  private exgRead168(n: number): number {
    switch (n & 0x0f) {
      case 10: return 0xff00 | this.cc;
      case 11: return 0xff00 | this.dp;
      default: return this.tfrRead816(n);
    }
  }

  private regWrite(n: number, v: number): void {
    switch (n) {
      case 0: this.d = v; break;
      case 1: this.x = v & 0xffff; break;
      case 2: this.y = v & 0xffff; break;
      case 3: this.u = v & 0xffff; break;
      case 4: this.s = v & 0xffff; this.nmiArmed = true; break;
      case 5: this.pc = v & 0xffff; break;
      case 8: this.a = v & 0xff; break;
      case 9: this.b = v & 0xff; break;
      case 10: this.cc = v & 0xff; break;
      case 11: this.dp = v & 0xff; break;
    }
  }

  private serviceInterrupts(): boolean {
    if (this.nmiEdge && this.nmiArmed) {
      this.nmiEdge = false;
      this.syncing = false;
      if (!this.waiting) this.pushState(true);
      this.waiting = false;
      this.cc |= I | F;
      this.pc = this.read16(VEC_NMI);
      this.cycles += 19;
      return true;
    }
    if (this.firqLine && !(this.cc & F)) {
      this.syncing = false;
      if (!this.waiting) this.pushState(false);
      this.waiting = false;
      this.cc |= I | F;
      this.pc = this.read16(VEC_FIRQ);
      this.cycles += 10;
      return true;
    }
    if (this.irqLine && !(this.cc & I)) {
      this.syncing = false;
      if (!this.waiting) this.pushState(true);
      this.waiting = false;
      this.cc |= I;
      this.pc = this.read16(VEC_IRQ);
      this.cycles += 19;
      return true;
    }
    if (this.syncing && (this.irqLine || this.firqLine || this.nmiLine)) {
      this.syncing = false;
    }
    return false;
  }

  step(): number {
    const start = this.cycles;

    if (this.serviceInterrupts()) return this.cycles - start;

    if (this.waiting || this.syncing) {
      this.cycles += 1;
      return 1;
    }

    const op = this.fetch8();
    if (op === 0x10) this.execPage2(this.fetch8());
    else if (op === 0x11) this.execPage3(this.fetch8());
    else this.execPage1(op);

    return this.cycles - start;
  }

  run(n: number): number {
    let done = 0;
    while (done < n) done += this.step();
    return done;
  }

  private execPage1(op: number): void {
    const hi = op >> 4;

    if (hi === 0x0 || hi === 0x6 || hi === 0x7) {
      const mode = hi === 0x0 ? Mode.Direct : hi === 0x6 ? Mode.Indexed : Mode.Extended;
      const base = hi === 0x0 ? 4 : hi === 0x6 ? 4 : 5;
      switch (op & 0x0f) {
        case 0x0: this.rmw(mode, (v) => this.opNEG(v)); this.cycles += base + 2; break;
        case 0x3: this.rmw(mode, (v) => this.opCOM(v)); this.cycles += base + 2; break;
        case 0x4: this.rmw(mode, (v) => this.opLSR(v)); this.cycles += base + 2; break;
        case 0x6: this.rmw(mode, (v) => this.opROR(v)); this.cycles += base + 2; break;
        case 0x7: this.rmw(mode, (v) => this.opASR(v)); this.cycles += base + 2; break;
        case 0x8: this.rmw(mode, (v) => this.opASL(v)); this.cycles += base + 2; break;
        case 0x9: this.rmw(mode, (v) => this.opROL(v)); this.cycles += base + 2; break;
        case 0xa: this.rmw(mode, (v) => this.opDEC(v)); this.cycles += base + 2; break;
        case 0xc: this.rmw(mode, (v) => this.opINC(v)); this.cycles += base + 2; break;
        case 0xd: this.nz8(this.read8(this.ea(mode))); this.cycles += base + 2; break;
        case 0xe: this.pc = this.ea(mode); this.cycles += base - 1; break;
        case 0xf:
          this.write8(this.ea(mode), 0);
          this.cc = (this.cc & ~(N | V | C) & 0xff) | Z;
          this.cycles += base + 2;
          break;
        default: this.illegal(op); return;
      }
      this.cycles += this.idxAdj(mode);
      return;
    }

    if (hi === 0x4 || hi === 0x5) {
      const isA = hi === 0x4;
      const get = () => (isA ? this.a : this.b);
      const set = (v: number) => { if (isA) this.a = v; else this.b = v; };
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
        case 0xd: this.nz8(get()); break;
        case 0xf:
          set(0);
          this.cc = (this.cc & ~(N | V | C) & 0xff) | Z;
          break;
        default: this.illegal(op); return;
      }
      this.cycles += 2;
      return;
    }

    if (hi === 0x2) {
      const off = (this.fetch8() << 24) >> 24;
      if (this.testCC(op & 0x0f)) this.pc = (this.pc + off) & 0xffff;
      this.cycles += 3;
      return;
    }

    if (hi >= 0x8) {
      this.execAccumulator(op);
      return;
    }

    switch (op) {
      case 0x12: this.cycles += 2; break;
      case 0x13: this.syncing = true; this.cycles += 2; break;
      case 0x16: {
        const off = (this.fetch16() << 16) >> 16;
        this.pc = (this.pc + off) & 0xffff;
        this.cycles += 5;
        break;
      }
      case 0x17: {
        const off = (this.fetch16() << 16) >> 16;
        this.pushS16(this.pc);
        this.pc = (this.pc + off) & 0xffff;
        this.cycles += 9;
        break;
      }
      case 0x19: this.daa(); this.cycles += 2; break;
      case 0x1a: this.cc |= this.fetch8(); this.cycles += 3; break;
      case 0x1c: this.cc &= this.fetch8(); this.cycles += 3; break;
      case 0x1d:
        this.a = this.b & 0x80 ? 0xff : 0x00;
        this.setFlag(N, (this.d & 0x8000) !== 0);
        this.setFlag(Z, this.d === 0);
        this.cycles += 2;
        break;
      case 0x1e: {
        const pb = this.fetch8();
        const r1 = pb >> 4;
        const r2 = pb & 0x0f;
        const rd = (n: number): number => (pb & 0x80 ? this.tfrRead816(n) : this.exgRead168(n));
        const v1 = rd(r1);
        const v2 = rd(r2);
        this.regWrite(r2, v1);
        this.regWrite(r1, v2);
        this.cycles += 8;
        break;
      }
      case 0x1f: {
        const pb = this.fetch8();
        this.regWrite(pb & 0x0f, this.tfrRead816(pb >> 4));
        this.cycles += 6;
        break;
      }
      case 0x30: this.x = this.leaEA(); this.setFlag(Z, this.x === 0); break;
      case 0x31: this.y = this.leaEA(); this.setFlag(Z, this.y === 0); break;
      case 0x32: this.s = this.leaEA(); this.nmiArmed = true; break;
      case 0x33: this.u = this.leaEA(); break;
      case 0x34: this.cycles += 5 + this.push(this.fetch8(), true); break;
      case 0x35: this.cycles += 5 + this.pull(this.fetch8(), true); break;
      case 0x36: this.cycles += 5 + this.push(this.fetch8(), false); break;
      case 0x37: this.cycles += 5 + this.pull(this.fetch8(), false); break;
      case 0x39: this.pc = this.pullS16(); this.cycles += 5; break;
      case 0x3a:
        this.x = (this.x + this.b) & 0xffff;
        this.cycles += 3;
        break;
      case 0x3b: {
        this.cc = this.pullS8();
        if (this.cc & E) {
          this.pull(0xfe, true);
          this.cycles += 15;
        } else {
          this.pc = this.pullS16();
          this.cycles += 6;
        }
        break;
      }
      case 0x3c: {
        this.cc &= this.fetch8();
        this.pushState(true);
        this.waiting = true;
        this.cycles += 20;
        break;
      }
      case 0x3d: {
        const res = this.a * this.b;
        this.d = res;
        this.setFlag(Z, (res & 0xffff) === 0);
        this.setFlag(C, (res & 0x80) !== 0);
        this.cycles += 11;
        break;
      }
      case 0x3f:
        this.pushState(true);
        this.cc |= I | F;
        this.pc = this.read16(VEC_SWI);
        this.cycles += 19;
        break;
      default:
        this.illegal(op);
    }
  }

  private leaEA(): number {
    const ea = this.indexedEA();
    this.cycles += 4 + this.idxCycles;
    return ea;
  }

  private idxAdj(mode: Mode): number {
    return mode === Mode.Indexed ? this.idxCycles : 0;
  }

  private execAccumulator(op: number): void {
    const modeBits = (op >> 4) & 0x03;
    const mode =
      modeBits === 0 ? Mode.Immediate
      : modeBits === 1 ? Mode.Direct
      : modeBits === 2 ? Mode.Indexed
      : Mode.Extended;
    const base = mode === Mode.Immediate ? 2 : mode === Mode.Extended ? 5 : 4;
    const isB = op >= 0xc0;
    const lo = op & 0x0f;

    const getAcc = () => (isB ? this.b : this.a);
    const setAcc = (v: number) => { if (isB) this.b = v; else this.a = v; };

    switch (lo) {
      case 0x0: setAcc(this.sub8(getAcc(), this.operand8(mode), 0)); this.cycles += base; break;
      case 0x1: this.sub8(getAcc(), this.operand8(mode), 0); this.cycles += base; break;
      case 0x2: setAcc(this.sub8(getAcc(), this.operand8(mode), this.cc & C ? 1 : 0)); this.cycles += base; break;
      case 0x3: {
        const v = this.operand16(mode);
        this.d = isB ? this.add16(this.d, v) : this.sub16(this.d, v);
        this.cycles += base + 2;
        break;
      }
      case 0x4: setAcc(this.nz8(getAcc() & this.operand8(mode))); this.cycles += base; break;
      case 0x5: this.nz8(getAcc() & this.operand8(mode)); this.cycles += base; break;
      case 0x6: setAcc(this.nz8(this.operand8(mode))); this.cycles += base; break;
      case 0x7: {
        if (mode === Mode.Immediate) { this.illegal(op); return; }
        const addr = this.ea(mode);
        this.write8(addr, this.nz8(getAcc()));
        this.cycles += base;
        break;
      }
      case 0x8: setAcc(this.nz8(getAcc() ^ this.operand8(mode))); this.cycles += base; break;
      case 0x9: setAcc(this.add8(getAcc(), this.operand8(mode), this.cc & C ? 1 : 0)); this.cycles += base; break;
      case 0xa: setAcc(this.nz8(getAcc() | this.operand8(mode))); this.cycles += base; break;
      case 0xb: setAcc(this.add8(getAcc(), this.operand8(mode), 0)); this.cycles += base; break;
      case 0xc: {
        if (isB) {
          this.d = this.nz16(this.operand16(mode));
          this.cycles += base + 1;
        } else {
          this.sub16(this.x, this.operand16(mode));
          this.cycles += base + 2;
        }
        break;
      }
      case 0xd: {
        if (isB) {
          if (mode === Mode.Immediate) { this.illegal(op); return; }
          this.write16(this.ea(mode), this.nz16(this.d));
          this.cycles += base + 1;
        } else if (mode === Mode.Immediate) {
          const off = (this.fetch8() << 24) >> 24;
          this.pushS16(this.pc);
          this.pc = (this.pc + off) & 0xffff;
          this.cycles += 7;
        } else {
          const addr = this.ea(mode);
          this.pushS16(this.pc);
          this.pc = addr;
          this.cycles += base + 3;
        }
        break;
      }
      case 0xe: {
        const v = this.nz16(this.operand16(mode));
        if (isB) this.u = v; else this.x = v;
        this.cycles += base + 1;
        break;
      }
      case 0xf: {
        if (mode === Mode.Immediate) { this.illegal(op); return; }
        this.write16(this.ea(mode), this.nz16(isB ? this.u : this.x));
        this.cycles += base + 1;
        break;
      }
    }
    this.cycles += this.idxAdj(mode);
  }

  private execPage2(op: number): void {
    if ((op & 0xf0) === 0x20) {
      const off = (this.fetch16() << 16) >> 16;
      const taken = this.testCC(op & 0x0f);
      if (taken) this.pc = (this.pc + off) & 0xffff;
      this.cycles += taken ? 6 : 5;
      return;
    }

    if (op === 0x3f) {
      this.pushState(true);
      this.pc = this.read16(VEC_SWI2);
      this.cycles += 20;
      return;
    }

    const modeBits = (op >> 4) & 0x03;
    const mode =
      modeBits === 0 ? Mode.Immediate
      : modeBits === 1 ? Mode.Direct
      : modeBits === 2 ? Mode.Indexed
      : Mode.Extended;
    const base = mode === Mode.Immediate ? 4 : mode === Mode.Extended ? 7 : 6;

    switch (op & 0x0f) {
      case 0x3: this.sub16(this.d, this.operand16(mode)); this.cycles += base + 1; break;
      case 0xc: this.sub16(this.y, this.operand16(mode)); this.cycles += base + 1; break;
      case 0xe: {
        const v = this.nz16(this.operand16(mode));
        if (op >= 0xc0) { this.s = v; this.nmiArmed = true; } else this.y = v;
        this.cycles += base;
        break;
      }
      case 0xf: {
        if (mode === Mode.Immediate) { this.illegal(0x1000 | op); return; }
        this.write16(this.ea(mode), this.nz16(op >= 0xc0 ? this.s : this.y));
        this.cycles += base;
        break;
      }
      default:
        this.illegal(0x1000 | op);
        return;
    }
    this.cycles += this.idxAdj(mode);
  }

  private execPage3(op: number): void {
    if (op === 0x3f) {
      this.pushState(true);
      this.pc = this.read16(VEC_SWI3);
      this.cycles += 20;
      return;
    }

    const modeBits = (op >> 4) & 0x03;
    const mode =
      modeBits === 0 ? Mode.Immediate
      : modeBits === 1 ? Mode.Direct
      : modeBits === 2 ? Mode.Indexed
      : Mode.Extended;
    const base = mode === Mode.Immediate ? 5 : mode === Mode.Extended ? 8 : 7;

    switch (op & 0x0f) {
      case 0x3: this.sub16(this.u, this.operand16(mode)); this.cycles += base; break;
      case 0xc: this.sub16(this.s, this.operand16(mode)); this.cycles += base; break;
      default:
        this.illegal(0x1100 | op);
        return;
    }
    this.cycles += this.idxAdj(mode);
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

  private daa(): void {
    let correction = 0;
    const lo = this.a & 0x0f;
    const hi = this.a >> 4;
    if (this.cc & H || lo > 9) correction |= 0x06;
    if (this.cc & C || hi > 9 || (hi > 8 && lo > 9)) correction |= 0x60;
    const res = this.a + correction;
    this.setFlag(C, (this.cc & C) !== 0 || res > 0xff);
    this.a = res & 0xff;
    this.setFlag(N, (this.a & 0x80) !== 0);
    this.setFlag(Z, this.a === 0);
  }

  private illegal(op: number): void {
    throw new Error(
      `illegal opcode $${op.toString(16)} at $${((this.pc - 1) & 0xffff).toString(16).padStart(4, '0')}`,
    );
  }

  trace(): string {
    const h = (v: number, n: number) => v.toString(16).toUpperCase().padStart(n, '0');
    return (
      `${h(this.pc, 4)} A=${h(this.a, 2)} B=${h(this.b, 2)} X=${h(this.x, 4)} ` +
      `Y=${h(this.y, 4)} U=${h(this.u, 4)} S=${h(this.s, 4)} DP=${h(this.dp, 2)} CC=${h(this.cc, 2)}`
    );
  }
}
