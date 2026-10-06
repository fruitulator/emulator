import type { Bus } from './bus';

export interface Z80Io {
  in(port: number): number;
  out(port: number, val: number): void;
}

export interface Z80Hooks {
  irqAck?(): number;
  reti?(): void;
}

const CF = 0x01;
const NF = 0x02;
const PF = 0x04;
const XF = 0x08;
const HF = 0x10;
const YF = 0x20;
const ZF = 0x40;
const SF = 0x80;

export const SZ53 = new Uint8Array(256);
export const SZ53P = new Uint8Array(256);
for (let v = 0; v < 256; v++) {
  let p = v;
  p ^= p >> 4;
  p ^= p >> 2;
  p ^= p >> 1;
  SZ53[v] = (v & (SF | YF | XF)) | (v === 0 ? ZF : 0);
  SZ53P[v] = SZ53[v] | (p & 1 ? 0 : PF);
}

export const sext8 = (v: number) => (v << 24) >> 24;

export class Z80 {
  a = 0xff;
  f = 0xff;
  b = 0;
  c = 0;
  d = 0;
  e = 0;
  h = 0;
  l = 0;
  ix = 0xffff;
  iy = 0xffff;
  sp = 0xffff;
  pc = 0;
  wz = 0;
  af2 = 0;
  bc2 = 0;
  de2 = 0;
  hl2 = 0;
  i = 0;
  r = 0;
  iff1 = false;
  iff2 = false;
  im = 0;
  halted = false;
  afterEI = false;
  afterLdAir = false;
  q = 0;

  cycles = 0;

  protected flagsWritten = false;
  protected irqLine = false;
  protected nmiLine = false;
  protected nmiPending = false;

  constructor(
    protected readonly bus: Bus,
    protected readonly io: Z80Io,
    protected readonly hooks: Z80Hooks = {},
  ) {}

  get af(): number {
    return (this.a << 8) | this.f;
  }
  set af(v: number) {
    this.a = (v >> 8) & 0xff;
    this.f = v & 0xff;
  }
  get bc(): number {
    return (this.b << 8) | this.c;
  }
  set bc(v: number) {
    this.b = (v >> 8) & 0xff;
    this.c = v & 0xff;
  }
  get de(): number {
    return (this.d << 8) | this.e;
  }
  set de(v: number) {
    this.d = (v >> 8) & 0xff;
    this.e = v & 0xff;
  }
  get hl(): number {
    return (this.h << 8) | this.l;
  }
  set hl(v: number) {
    this.h = (v >> 8) & 0xff;
    this.l = v & 0xff;
  }

  reset(): void {
    this.pc = 0;
    this.wz = 0;
    this.i = 0;
    this.r = 0;
    this.iff1 = false;
    this.iff2 = false;
    this.im = 0;
    this.halted = false;
    this.afterEI = false;
    this.afterLdAir = false;
    this.nmiPending = false;
  }

  setIRQ(active: boolean): void {
    this.irqLine = active;
  }

  setNMI(active: boolean): void {
    if (active && !this.nmiLine) this.nmiPending = true;
    this.nmiLine = active;
  }

  protected rd(addr: number): number {
    this.cycles += 3;
    return this.bus.read8(addr & 0xffff) & 0xff;
  }

  protected wr(addr: number, v: number): void {
    this.cycles += 3;
    this.bus.write8(addr & 0xffff, v & 0xff);
  }

  protected inp(port: number): number {
    this.cycles += 4;
    return this.io.in(port & 0xffff) & 0xff;
  }

  protected outp(port: number, v: number): void {
    this.cycles += 4;
    this.io.out(port & 0xffff, v & 0xff);
  }

  protected fetchOp(): number {
    const v = this.bus.read8(this.pc) & 0xff;
    this.pc = (this.pc + 1) & 0xffff;
    this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f);
    this.cycles += 4;
    return v;
  }

  protected imm8(): number {
    const v = this.rd(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  protected imm16(): number {
    const lo = this.imm8();
    return lo | (this.imm8() << 8);
  }

  protected push(v: number): void {
    this.sp = (this.sp - 1) & 0xffff;
    this.wr(this.sp, v >> 8);
    this.sp = (this.sp - 1) & 0xffff;
    this.wr(this.sp, v);
  }

  protected pop(): number {
    const lo = this.rd(this.sp);
    this.sp = (this.sp + 1) & 0xffff;
    const hi = this.rd(this.sp);
    this.sp = (this.sp + 1) & 0xffff;
    return lo | (hi << 8);
  }

  protected setF(v: number): void {
    this.f = v & 0xff;
    this.flagsWritten = true;
  }

  step(): number {
    const start = this.cycles;

    if (this.nmiPending) {
      this.takeNmi();
      return this.cycles - start;
    }
    if (this.irqLine && this.iff1 && !this.afterEI) {
      this.takeIrq();
      return this.cycles - start;
    }
    this.afterEI = false;
    this.afterLdAir = false;

    if (this.halted) {
      this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f);
      this.cycles += 4;
      return 4;
    }

    this.flagsWritten = false;
    this.execMain(this.fetchOp(), 0);
    this.q = this.flagsWritten ? this.f : 0;
    return this.cycles - start;
  }

  run(n: number): number {
    let done = 0;
    while (done < n) done += this.step();
    return done;
  }

  protected takeNmi(): void {
    this.halted = false;
    this.iff1 = false;
    this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f);
    this.cycles += 5;
    this.push(this.pc);
    this.pc = 0x0066;
    this.wz = this.pc;
    this.nmiPending = false;
  }

  protected takeIrq(): void {
    this.halted = false;
    this.iff1 = false;
    this.iff2 = false;
    this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f);
    const vec = this.hooks.irqAck ? this.hooks.irqAck() : 0xff;
    this.cycles += 2;
    if (this.im === 2) {
      this.cycles += 5;
      this.push(this.pc);
      const at = (this.i << 8) | (vec & 0xff);
      this.pc = this.rd(at) | (this.rd((at + 1) & 0xffff) << 8);
    } else if (this.im === 1) {
      this.cycles += 5;
      this.push(this.pc);
      this.pc = 0x0038;
    } else if (vec !== 0x00) {
      if ((vec & 0xff0000) === 0xcd0000) {
        this.cycles += 11;
        this.push(this.pc);
        this.pc = vec & 0xffff;
      } else if ((vec & 0xff0000) === 0xc30000) {
        this.cycles += 10;
        this.pc = vec & 0xffff;
      } else if ((vec & 0xc7) === 0xc7) {
        this.cycles += 5;
        this.push(this.pc);
        this.pc = vec & 0x0038;
      } else if (vec === 0xfb) {
        this.cycles += 4;
        this.iff1 = this.iff2 = true;
        this.afterEI = true;
      }
    }
    this.wz = this.pc;
  }

  protected getR8(r: number, idx: number): number {
    switch (r) {
      case 0: return this.b;
      case 1: return this.c;
      case 2: return this.d;
      case 3: return this.e;
      case 4: return idx === 0 ? this.h : idx === 1 ? this.ix >> 8 : this.iy >> 8;
      case 5: return idx === 0 ? this.l : idx === 1 ? this.ix & 0xff : this.iy & 0xff;
      default: return this.a;
    }
  }

  protected setR8(r: number, v: number, idx: number): void {
    v &= 0xff;
    switch (r) {
      case 0: this.b = v; break;
      case 1: this.c = v; break;
      case 2: this.d = v; break;
      case 3: this.e = v; break;
      case 4:
        if (idx === 0) this.h = v;
        else if (idx === 1) this.ix = (this.ix & 0xff) | (v << 8);
        else this.iy = (this.iy & 0xff) | (v << 8);
        break;
      case 5:
        if (idx === 0) this.l = v;
        else if (idx === 1) this.ix = (this.ix & 0xff00) | v;
        else this.iy = (this.iy & 0xff00) | v;
        break;
      default: this.a = v;
    }
  }

  protected getRP(p: number, idx: number): number {
    switch (p) {
      case 0: return this.bc;
      case 1: return this.de;
      case 2: return idx === 0 ? this.hl : idx === 1 ? this.ix : this.iy;
      default: return this.sp;
    }
  }

  protected setRP(p: number, v: number, idx: number): void {
    v &= 0xffff;
    switch (p) {
      case 0: this.bc = v; break;
      case 1: this.de = v; break;
      case 2:
        if (idx === 0) this.hl = v;
        else if (idx === 1) this.ix = v;
        else this.iy = v;
        break;
      default: this.sp = v;
    }
  }

  protected memAddr(idx: number): number {
    if (idx === 0) return this.hl;
    const d = sext8(this.imm8());
    const ea = ((idx === 1 ? this.ix : this.iy) + d) & 0xffff;
    this.wz = ea;
    return ea;
  }

  protected cond(y: number): boolean {
    switch (y) {
      case 0: return (this.f & ZF) === 0;
      case 1: return (this.f & ZF) !== 0;
      case 2: return (this.f & CF) === 0;
      case 3: return (this.f & CF) !== 0;
      case 4: return (this.f & PF) === 0;
      case 5: return (this.f & PF) !== 0;
      case 6: return (this.f & SF) === 0;
      default: return (this.f & SF) !== 0;
    }
  }

  protected add8(v: number, c: number): void {
    const a = this.a;
    const res = a + v + c;
    this.setF(
      SZ53[res & 0xff] | ((res >> 8) & CF) | ((a ^ v ^ res) & HF) |
        ((a ^ res) & (v ^ res) & 0x80 ? PF : 0),
    );
    this.a = res & 0xff;
  }

  protected sub8(v: number, c: number): void {
    const a = this.a;
    const res = a - v - c;
    this.setF(
      SZ53[res & 0xff] | ((res >> 8) & CF) | NF | ((a ^ v ^ res) & HF) |
        ((a ^ v) & (a ^ res) & 0x80 ? PF : 0),
    );
    this.a = res & 0xff;
  }

  protected cp8(v: number): void {
    const a = this.a;
    const res = a - v;
    this.setF(
      (SZ53[res & 0xff] & (SF | ZF)) | (v & (YF | XF)) | ((res >> 8) & CF) | NF |
        ((a ^ v ^ res) & HF) | ((a ^ v) & (a ^ res) & 0x80 ? PF : 0),
    );
  }

  protected alu(y: number, v: number): void {
    switch (y) {
      case 0: this.add8(v, 0); break;
      case 1: this.add8(v, this.f & CF); break;
      case 2: this.sub8(v, 0); break;
      case 3: this.sub8(v, this.f & CF); break;
      case 4: this.a &= v; this.setF(SZ53P[this.a] | HF); break;
      case 5: this.a = (this.a ^ v) & 0xff; this.setF(SZ53P[this.a]); break;
      case 6: this.a = (this.a | v) & 0xff; this.setF(SZ53P[this.a]); break;
      default: this.cp8(v);
    }
  }

  protected inc8(v: number): number {
    const r = (v + 1) & 0xff;
    this.setF((this.f & CF) | SZ53[r] | (r === 0x80 ? PF : 0) | ((r & 0x0f) === 0 ? HF : 0));
    return r;
  }

  protected dec8(v: number): number {
    const r = (v - 1) & 0xff;
    this.setF(
      (this.f & CF) | SZ53[r] | NF | (r === 0x7f ? PF : 0) | ((r & 0x0f) === 0x0f ? HF : 0),
    );
    return r;
  }

  protected daa(): void {
    const a0 = this.a;
    let a = a0;
    const h = this.f & HF;
    const c = this.f & CF;
    if (this.f & NF) {
      if (h || (a0 & 0x0f) > 9) a -= 6;
      if (c || a0 > 0x99) a -= 0x60;
    } else {
      if (h || (a0 & 0x0f) > 9) a += 6;
      if (c || a0 > 0x99) a += 0x60;
    }
    a &= 0xff;
    this.setF(SZ53P[a] | (this.f & NF) | ((a0 ^ a) & HF) | (c || a0 > 0x99 ? CF : 0));
    this.a = a;
  }

  protected add16(idx: number, v: number): void {
    const hl = this.getRP(2, idx);
    const res = hl + v;
    this.wz = (hl + 1) & 0xffff;
    this.setF(
      (this.f & (SF | ZF | PF)) | ((res >> 8) & (YF | XF)) | (((hl ^ res ^ v) >> 8) & HF) |
        ((res >> 16) & CF),
    );
    this.setRP(2, res, idx);
    this.cycles += 7;
  }

  protected adc16(v: number): void {
    const hl = this.hl;
    const res = hl + v + (this.f & CF);
    this.wz = (hl + 1) & 0xffff;
    this.setF(
      ((res >> 8) & (SF | YF | XF)) | ((res & 0xffff) === 0 ? ZF : 0) |
        (((hl ^ res ^ v) >> 8) & HF) | ((v ^ hl ^ 0x8000) & (v ^ res) & 0x8000 ? PF : 0) |
        ((res >> 16) & CF),
    );
    this.hl = res & 0xffff;
    this.cycles += 7;
  }

  protected sbc16(v: number): void {
    const hl = this.hl;
    const res = hl - v - (this.f & CF);
    this.wz = (hl + 1) & 0xffff;
    this.setF(
      ((res >> 8) & (SF | YF | XF)) | ((res & 0xffff) === 0 ? ZF : 0) |
        (((hl ^ res ^ v) >> 8) & HF) | ((v ^ hl) & (hl ^ res) & 0x8000 ? PF : 0) | NF |
        ((res >> 16) & CF),
    );
    this.hl = res & 0xffff;
    this.cycles += 7;
  }

  protected rot(y: number, v: number): number {
    let res: number;
    let c: number;
    switch (y) {
      case 0: c = v >> 7; res = (v << 1) | c; break;
      case 1: c = v & 1; res = (v >> 1) | (c << 7); break;
      case 2: c = v >> 7; res = (v << 1) | (this.f & CF); break;
      case 3: c = v & 1; res = (v >> 1) | ((this.f & CF) << 7); break;
      case 4: c = v >> 7; res = v << 1; break;
      case 5: c = v & 1; res = (v >> 1) | (v & 0x80); break;
      case 6: c = v >> 7; res = (v << 1) | 1; break;
      default: c = v & 1; res = v >> 1;
    }
    res &= 0xff;
    this.setF(SZ53P[res] | c);
    return res;
  }

  protected bit(n: number, v: number, yx: number): void {
    const set = v & (1 << n);
    this.setF(
      (this.f & CF) | HF | (yx & (YF | XF)) | (set ? (n === 7 ? SF : 0) : ZF | PF),
    );
  }

  protected cbOp(x: number, y: number, v: number): number {
    if (x === 0) return this.rot(y, v);
    if (x === 2) return v & ~(1 << y) & 0xff;
    return (v | (1 << y)) & 0xff;
  }

  protected execMain(op: number, idx: number): void {
    switch (op) {
      case 0x00: return;

      case 0x01: case 0x11: case 0x21: case 0x31:
        this.setRP(op >> 4, this.imm16(), idx);
        return;

      case 0x02: case 0x12: {
        const at = op === 0x02 ? this.bc : this.de;
        this.wr(at, this.a);
        this.wz = ((at + 1) & 0xff) | (this.a << 8);
        return;
      }
      case 0x0a: case 0x1a: {
        const at = op === 0x0a ? this.bc : this.de;
        this.a = this.rd(at);
        this.wz = (at + 1) & 0xffff;
        return;
      }
      case 0x22: {
        const nn = this.imm16();
        const v = this.getRP(2, idx);
        this.wr(nn, v);
        this.wr(nn + 1, v >> 8);
        this.wz = (nn + 1) & 0xffff;
        return;
      }
      case 0x2a: {
        const nn = this.imm16();
        const lo = this.rd(nn);
        this.setRP(2, lo | (this.rd(nn + 1) << 8), idx);
        this.wz = (nn + 1) & 0xffff;
        return;
      }
      case 0x32: {
        const nn = this.imm16();
        this.wr(nn, this.a);
        this.wz = ((nn + 1) & 0xff) | (this.a << 8);
        return;
      }
      case 0x3a: {
        const nn = this.imm16();
        this.a = this.rd(nn);
        this.wz = (nn + 1) & 0xffff;
        return;
      }

      case 0x03: case 0x13: case 0x23: case 0x33:
        this.setRP(op >> 4, this.getRP(op >> 4, idx) + 1, idx);
        this.cycles += 2;
        return;
      case 0x0b: case 0x1b: case 0x2b: case 0x3b:
        this.setRP(op >> 4, this.getRP(op >> 4, idx) - 1, idx);
        this.cycles += 2;
        return;

      case 0x09: case 0x19: case 0x29: case 0x39:
        this.add16(idx, this.getRP(op >> 4, idx));
        return;

      case 0x04: case 0x0c: case 0x14: case 0x1c: case 0x24: case 0x2c: case 0x3c: {
        const y = op >> 3;
        this.setR8(y, this.inc8(this.getR8(y, idx)), idx);
        return;
      }
      case 0x05: case 0x0d: case 0x15: case 0x1d: case 0x25: case 0x2d: case 0x3d: {
        const y = op >> 3;
        this.setR8(y, this.dec8(this.getR8(y, idx)), idx);
        return;
      }
      case 0x34: case 0x35: {
        const ea = this.memAddr(idx);
        if (idx) this.cycles += 5;
        const v = this.rd(ea);
        this.cycles += 1;
        this.wr(ea, op === 0x34 ? this.inc8(v) : this.dec8(v));
        return;
      }

      case 0x06: case 0x0e: case 0x16: case 0x1e: case 0x26: case 0x2e: case 0x3e:
        this.setR8(op >> 3, this.imm8(), idx);
        return;
      case 0x36: {
        const ea = this.memAddr(idx);
        const n = this.imm8();
        if (idx) this.cycles += 2;
        this.wr(ea, n);
        return;
      }

      case 0x07: {
        const a = ((this.a << 1) | (this.a >> 7)) & 0xff;
        this.setF((this.f & (SF | ZF | PF)) | (a & (YF | XF)) | (a & CF));
        this.a = a;
        return;
      }
      case 0x0f: {
        const c = this.a & 1;
        const a = (this.a >> 1) | (c << 7);
        this.setF((this.f & (SF | ZF | PF)) | (a & (YF | XF)) | c);
        this.a = a;
        return;
      }
      case 0x17: {
        const a = ((this.a << 1) | (this.f & CF)) & 0xff;
        this.setF((this.f & (SF | ZF | PF)) | (a & (YF | XF)) | (this.a >> 7));
        this.a = a;
        return;
      }
      case 0x1f: {
        const a = (this.a >> 1) | ((this.f & CF) << 7);
        this.setF((this.f & (SF | ZF | PF)) | (a & (YF | XF)) | (this.a & 1));
        this.a = a;
        return;
      }
      case 0x27:
        this.daa();
        return;
      case 0x2f:
        this.a ^= 0xff;
        this.setF((this.f & (SF | ZF | PF | CF)) | HF | NF | (this.a & (YF | XF)));
        return;
      case 0x37:
        this.setF((this.f & (SF | ZF | PF)) | (((this.q ^ this.f) | this.a) & (YF | XF)) | CF);
        return;
      case 0x3f: {
        const c = this.f & CF;
        this.setF(
          (this.f & (SF | ZF | PF)) | (((this.q ^ this.f) | this.a) & (YF | XF)) |
            (c ? HF : 0) | (c ^ CF),
        );
        return;
      }

      case 0x08: {
        const t = this.af;
        this.af = this.af2;
        this.af2 = t;
        return;
      }

      case 0x10: {
        this.cycles += 1;
        const d = sext8(this.imm8());
        this.b = (this.b - 1) & 0xff;
        if (this.b !== 0) {
          this.cycles += 5;
          this.pc = (this.pc + d) & 0xffff;
          this.wz = this.pc;
        }
        return;
      }
      case 0x18: case 0x20: case 0x28: case 0x30: case 0x38: {
        const d = sext8(this.imm8());
        if (op === 0x18 || this.cond((op >> 3) - 4)) {
          this.cycles += 5;
          this.pc = (this.pc + d) & 0xffff;
          this.wz = this.pc;
        }
        return;
      }

      case 0x76:
        this.halted = true;
        return;

      case 0xc0: case 0xc8: case 0xd0: case 0xd8: case 0xe0: case 0xe8: case 0xf0: case 0xf8:
        this.cycles += 1;
        if (this.cond((op >> 3) & 7)) {
          this.pc = this.pop();
          this.wz = this.pc;
        }
        return;
      case 0xc9:
        this.pc = this.pop();
        this.wz = this.pc;
        return;

      case 0xc1: case 0xd1: case 0xe1:
        this.setRP((op >> 4) & 3, this.pop(), idx);
        return;
      case 0xf1:
        this.af = this.pop();
        return;
      case 0xc5: case 0xd5: case 0xe5:
        this.cycles += 1;
        this.push(this.getRP((op >> 4) & 3, idx));
        return;
      case 0xf5:
        this.cycles += 1;
        this.push(this.af);
        return;

      case 0xc2: case 0xca: case 0xd2: case 0xda: case 0xe2: case 0xea: case 0xf2: case 0xfa: {
        const nn = this.imm16();
        if (this.cond((op >> 3) & 7)) this.pc = nn;
        this.wz = nn;
        return;
      }
      case 0xc3: {
        const nn = this.imm16();
        this.pc = nn;
        this.wz = nn;
        return;
      }
      case 0xc4: case 0xcc: case 0xd4: case 0xdc: case 0xe4: case 0xec: case 0xf4: case 0xfc: {
        const nn = this.imm16();
        this.wz = nn;
        if (this.cond((op >> 3) & 7)) {
          this.cycles += 1;
          this.push(this.pc);
          this.pc = nn;
        }
        return;
      }
      case 0xcd: {
        const nn = this.imm16();
        this.wz = nn;
        this.cycles += 1;
        this.push(this.pc);
        this.pc = nn;
        return;
      }
      case 0xc7: case 0xcf: case 0xd7: case 0xdf: case 0xe7: case 0xef: case 0xf7: case 0xff:
        this.cycles += 1;
        this.push(this.pc);
        this.pc = op & 0x38;
        this.wz = this.pc;
        return;

      case 0xc6: case 0xce: case 0xd6: case 0xde: case 0xe6: case 0xee: case 0xf6: case 0xfe:
        this.alu((op >> 3) & 7, this.imm8());
        return;

      case 0xd3: {
        const n = this.imm8();
        this.outp(n | (this.a << 8), this.a);
        this.wz = ((n + 1) & 0xff) | (this.a << 8);
        return;
      }
      case 0xdb: {
        const port = this.imm8() | (this.a << 8);
        this.a = this.inp(port);
        this.wz = (port + 1) & 0xffff;
        return;
      }

      case 0xd9: {
        let t = this.bc; this.bc = this.bc2; this.bc2 = t;
        t = this.de; this.de = this.de2; this.de2 = t;
        t = this.hl; this.hl = this.hl2; this.hl2 = t;
        return;
      }
      case 0xe3: {
        const lo = this.rd(this.sp);
        const hi = this.rd((this.sp + 1) & 0xffff);
        this.cycles += 1;
        const v = this.getRP(2, idx);
        this.wr((this.sp + 1) & 0xffff, v >> 8);
        this.wr(this.sp, v);
        this.cycles += 2;
        const nv = lo | (hi << 8);
        this.setRP(2, nv, idx);
        this.wz = nv;
        return;
      }
      case 0xe9:
        this.pc = this.getRP(2, idx);
        return;
      case 0xeb: {
        const t = this.de;
        this.de = this.hl;
        this.hl = t;
        return;
      }
      case 0xf9:
        this.sp = this.getRP(2, idx);
        this.cycles += 2;
        return;

      case 0xf3:
        this.iff1 = this.iff2 = false;
        return;
      case 0xfb:
        this.iff1 = this.iff2 = true;
        this.afterEI = true;
        return;

      case 0xcb:
        if (idx === 0) this.execCB(this.fetchOp());
        else this.execIndexedCB(idx);
        return;

      case 0xed:
        this.execED(this.fetchOp());
        return;

      case 0xdd: case 0xfd: {
        const next = this.fetchOp();
        if (next === 0xdd || next === 0xfd) {
          this.pc = (this.pc - 1) & 0xffff;
          this.r = (this.r & 0x80) | ((this.r - 1) & 0x7f);
          this.cycles -= 4;
          return;
        }
        this.q = 0;
        this.execMain(next, op === 0xdd ? 1 : 2);
        return;
      }
    }

    const y = (op >> 3) & 7;
    const z = op & 7;
    if (op < 0x80) {
      if (z === 6) {
        const ea = this.memAddr(idx);
        if (idx) this.cycles += 5;
        this.setR8(y, this.rd(ea), 0);
      } else if (y === 6) {
        const ea = this.memAddr(idx);
        if (idx) this.cycles += 5;
        this.wr(ea, this.getR8(z, 0));
      } else {
        this.setR8(y, this.getR8(z, idx), idx);
      }
      return;
    }
    if (z === 6) {
      const ea = this.memAddr(idx);
      if (idx) this.cycles += 5;
      this.alu(y, this.rd(ea));
    } else {
      this.alu(y, this.getR8(z, idx));
    }
  }

  protected execCB(op: number): void {
    const x = op >> 6;
    const y = (op >> 3) & 7;
    const z = op & 7;
    if (z === 6) {
      const ea = this.hl;
      const v = this.rd(ea);
      this.cycles += 1;
      if (x === 1) this.bit(y, v, this.wz >> 8);
      else this.wr(ea, this.cbOp(x, y, v));
      return;
    }
    const v = this.getR8(z, 0);
    if (x === 1) this.bit(y, v, v);
    else this.setR8(z, this.cbOp(x, y, v), 0);
  }

  protected execIndexedCB(idx: number): void {
    const d = sext8(this.imm8());
    const ea = ((idx === 1 ? this.ix : this.iy) + d) & 0xffff;
    this.wz = ea;
    const op = this.imm8();
    this.cycles += 2;
    const v = this.rd(ea);
    this.cycles += 1;
    const x = op >> 6;
    const y = (op >> 3) & 7;
    const z = op & 7;
    if (x === 1) {
      this.bit(y, v, ea >> 8);
      return;
    }
    const res = this.cbOp(x, y, v);
    if (z !== 6) this.setR8(z, res, 0);
    this.wr(ea, res);
  }

  protected execED(op: number): void {
    const x = op >> 6;
    const y = (op >> 3) & 7;
    const z = op & 7;

    if (x === 1) {
      const p = y >> 1;
      switch (z) {
        case 0: {
          const port = this.bc;
          const v = this.inp(port);
          if (y !== 6) this.setR8(y, v, 0);
          this.setF((this.f & CF) | SZ53P[v]);
          this.wz = (port + 1) & 0xffff;
          return;
        }
        case 1:
          this.outp(this.bc, y === 6 ? 0 : this.getR8(y, 0));
          this.wz = (this.bc + 1) & 0xffff;
          return;
        case 2:
          if (y & 1) this.adc16(this.getRP(p, 0));
          else this.sbc16(this.getRP(p, 0));
          return;
        case 3: {
          const nn = this.imm16();
          if (y & 1) {
            const lo = this.rd(nn);
            this.setRP(p, lo | (this.rd(nn + 1) << 8), 0);
          } else {
            const v = this.getRP(p, 0);
            this.wr(nn, v);
            this.wr(nn + 1, v >> 8);
          }
          this.wz = (nn + 1) & 0xffff;
          return;
        }
        case 4: {
          const v = this.a;
          this.a = 0;
          this.sub8(v, 0);
          return;
        }
        case 5:
          this.pc = this.pop();
          this.wz = this.pc;
          this.iff1 = this.iff2;
          if (y === 1) this.hooks.reti?.();
          return;
        case 6:
          this.im = [0, 0, 1, 2, 0, 0, 1, 2][y];
          return;
        default:
          switch (y) {
            case 0: this.cycles += 1; this.i = this.a; return;
            case 1: this.cycles += 1; this.r = this.a; return;
            case 2: case 3:
              this.cycles += 1;
              this.a = y === 2 ? this.i : this.r;
              this.setF((this.f & CF) | SZ53[this.a] | (this.iff2 ? PF : 0));
              this.afterLdAir = true;
              return;
            case 4: case 5: {
              const hl = this.hl;
              const v = this.rd(hl);
              this.wz = (hl + 1) & 0xffff;
              this.cycles += 4;
              if (y === 4) {
                this.wr(hl, (v >> 4) | (this.a << 4));
                this.a = (this.a & 0xf0) | (v & 0x0f);
              } else {
                this.wr(hl, (v << 4) | (this.a & 0x0f));
                this.a = (this.a & 0xf0) | (v >> 4);
              }
              this.setF((this.f & CF) | SZ53P[this.a]);
              return;
            }
            default: return;
          }
      }
    }

    if (x === 2 && y >= 4 && z <= 3) {
      const dir = y & 1 ? -1 : 1;
      const repeat = y >= 6;
      switch (z) {
        case 0: this.blockLd(dir, repeat); return;
        case 1: this.blockCp(dir, repeat); return;
        case 2: this.blockIn(dir, repeat); return;
        default: this.blockOut(dir, repeat); return;
      }
    }
  }

  protected blockLd(dir: number, repeat: boolean): void {
    const v = this.rd(this.hl);
    this.wr(this.de, v);
    this.cycles += 2;
    this.hl = (this.hl + dir) & 0xffff;
    this.de = (this.de + dir) & 0xffff;
    this.bc = (this.bc - 1) & 0xffff;
    const n = (this.a + v) & 0xff;
    let f = (this.f & (SF | ZF | CF)) | (n & XF) | ((n << 4) & YF) | (this.bc ? PF : 0);
    if (repeat && this.bc !== 0) {
      this.cycles += 5;
      this.pc = (this.pc - 2) & 0xffff;
      this.wz = (this.pc + 1) & 0xffff;
      f = (f & ~(YF | XF)) | ((this.pc >> 8) & (YF | XF));
    }
    this.setF(f);
  }

  protected blockCp(dir: number, repeat: boolean): void {
    const v = this.rd(this.hl);
    this.cycles += 5;
    this.wz = (this.wz + dir) & 0xffff;
    this.hl = (this.hl + dir) & 0xffff;
    this.bc = (this.bc - 1) & 0xffff;
    const res = (this.a - v) & 0xff;
    const hf = (this.a ^ v ^ res) & HF;
    const n = (res - (hf ? 1 : 0)) & 0xff;
    let f =
      (this.f & CF) | NF | (res & SF) | (res === 0 ? ZF : 0) | hf | (n & XF) | ((n << 4) & YF) |
      (this.bc ? PF : 0);
    if (repeat && this.bc !== 0 && res !== 0) {
      this.cycles += 5;
      this.pc = (this.pc - 2) & 0xffff;
      this.wz = (this.pc + 1) & 0xffff;
      f = (f & ~(YF | XF)) | ((this.pc >> 8) & (YF | XF));
    }
    this.setF(f);
  }

  protected blockIoFlags(v: number, t: number): number {
    return (
      SZ53[this.b] | (v & 0x80 ? NF : 0) | (t > 0xff ? HF | CF : 0) |
      (SZ53P[(t & 7) ^ this.b] & PF)
    );
  }

  protected blockIoRepeat(f: number, v: number): number {
    f = (f & ~(YF | XF)) | ((this.pc >> 8) & (YF | XF));
    const pvOld = f & PF;
    let hf = f & HF;
    let pv: number;
    if (f & CF) {
      hf = 0;
      if (v & 0x80) {
        pv = (this.b - 1) & 0x07;
        if ((this.b & 0x0f) === 0x00) hf = HF;
      } else {
        pv = (this.b + 1) & 0x07;
        if ((this.b & 0x0f) === 0x0f) hf = HF;
      }
    } else {
      pv = this.b & 0x07;
    }
    const pf = SZ53P[(pvOld ^ (SZ53P[pv] & PF)) & PF] & PF;
    return (f & ~(HF | PF)) | hf | pf;
  }

  protected blockIn(dir: number, repeat: boolean): void {
    this.cycles += 1;
    const v = this.inp(this.bc);
    this.wz = (this.bc + dir) & 0xffff;
    this.b = (this.b - 1) & 0xff;
    this.wr(this.hl, v);
    this.hl = (this.hl + dir) & 0xffff;
    const t = ((this.c + dir) & 0xff) + v;
    let f = this.blockIoFlags(v, t);
    if (repeat && this.b !== 0) {
      this.cycles += 5;
      this.pc = (this.pc - 2) & 0xffff;
      this.wz = (this.pc + 1) & 0xffff;
      f = this.blockIoRepeat(f, v);
    }
    this.setF(f);
  }

  protected blockOut(dir: number, repeat: boolean): void {
    this.cycles += 1;
    const v = this.rd(this.hl);
    this.b = (this.b - 1) & 0xff;
    this.wz = (this.bc + dir) & 0xffff;
    this.outp(this.bc, v);
    this.hl = (this.hl + dir) & 0xffff;
    const t = this.l + v;
    let f = this.blockIoFlags(v, t);
    if (repeat && this.b !== 0) {
      this.cycles += 5;
      this.pc = (this.pc - 2) & 0xffff;
      this.wz = (this.pc + 1) & 0xffff;
      f = this.blockIoRepeat(f, v);
    }
    this.setF(f);
  }

  trace(): string {
    const h = (v: number, n: number) => v.toString(16).toUpperCase().padStart(n, '0');
    return (
      `${h(this.pc, 4)} AF=${h(this.af, 4)} BC=${h(this.bc, 4)} DE=${h(this.de, 4)} ` +
      `HL=${h(this.hl, 4)} IX=${h(this.ix, 4)} IY=${h(this.iy, 4)} SP=${h(this.sp, 4)} ` +
      `WZ=${h(this.wz, 4)} IR=${h((this.i << 8) | this.r, 4)} IM=${this.im} ` +
      `IFF=${+this.iff1}${+this.iff2}${this.halted ? ' HALT' : ''}`
    );
  }
}
