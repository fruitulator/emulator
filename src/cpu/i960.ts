
export interface I960Bus {
  read8(a: number): number;
  read16(a: number): number;
  read32(a: number): number;
  write8(a: number, v: number): void;
  write16(a: number, v: number): void;
  write32(a: number, v: number): void;
}

const RCACHE = 4;
const PFP = 0, SP = 1, RIP = 2, FP = 31;

export class I960 {
  readonly r = new Uint32Array(32);
  private readonly rcache: Uint32Array[] = Array.from({ length: RCACHE }, () => new Uint32Array(16));
  private readonly rcacheFrame = new Uint32Array(RCACHE);
  private rcachePos = 0;
  SAT = 0;
  PRCB = 0;
  PC = 0;
  AC = 0;
  IP = 0;
  PIP = 0;
  ICR = 0;
  private immIrq = false;
  private immVector = 0;
  private immPri = 0;
  private readonly lineState = [0, 0, 0, 0];
  private icount = 0;
  unhandled = 0;
  lastUnhandled = -1;

  constructor(private readonly bus: I960Bus) {}

  private intTab = 0;
  private intStack = 0;

  reset(): void {
    const b = this.bus;
    this.SAT = b.read32(0) >>> 0;
    this.PRCB = b.read32(4) >>> 0;
    this.IP = b.read32(12) >>> 0;
    this.cacheTables();
    this.PC = 0x001f2002;
    this.AC = 0;
    this.ICR = 0xff000000 >>> 0;
    this.immIrq = false;
    this.r.fill(0);
    for (const c of this.rcache) c.fill(0);
    this.r[FP] = this.intStack;
    this.r[SP] = (this.r[FP] + 64) >>> 0;
    this.rcachePos = 0;
    this.lineState.fill(0);
  }

  private cacheTables(): void {
    this.intTab = this.bus.read32((this.PRCB + 0x14) >>> 0) >>> 0;
    this.intStack = this.bus.read32((this.PRCB + 0x18) >>> 0) >>> 0;
  }

  step(): number {
    this.icount = 0;
    this.PIP = this.IP;
    const op = this.bus.read32(this.IP) >>> 0;
    this.IP = (this.IP + 4) >>> 0;
    this.exec(op);
    return Math.max(1, -this.icount);
  }

  setIRQ(line: number, state: number): void {
    this.lineState[line] = state;
    if (!state) return;
    const vector = (this.ICR >>> (line * 8)) & 0xff;
    if (!vector) return;
    this.raise(vector);
  }

  private raise(vector: number): void {
    const cpuPri = (this.PC >>> 16) & 0x1f;
    const pri = vector >> 3;
    if ((cpuPri < pri || pri === 31) && !this.immIrq) {
      this.immIrq = true;
      this.immVector = vector;
      this.immPri = pri;
      this.checkPending();
      return;
    }
    const b = this.bus;
    b.write32(this.intTab, (b.read32(this.intTab) | (1 << pri)) >>> 0);
    const a = (this.intTab + ((vector >> 5) << 2) + 4) >>> 0;
    b.write32(a, (b.read32(a) | (1 << (vector & 31))) >>> 0);
  }

  private checkPending(): void {
    const b = this.bus;
    const cpuPri = (this.PC >>> 16) & 0x1f;
    if (this.immIrq && !(this.immPri <= cpuPri && this.immPri !== 31)) {
      this.takeInterrupt(this.immVector, this.immPri);
      this.immIrq = false;
      return;
    }
    const intTab = this.intTab;
    let pending = b.read32(intTab) >>> 0;
    const lvlmask = [0xff, 0xff00, 0xff0000, 0xff000000];
    for (let lvl = 31; lvl >= 0; lvl--) {
      if (!((pending >>> lvl) & 1) || !(cpuPri < lvl || lvl === 31)) continue;
      const word = ((lvl >> 2) << 2) + 4;
      const lo = (lvl & 3) * 8;
      let vword = b.read32((intTab + word) >>> 0) >>> 0;
      let take = -1;
      for (let irq = lo + 7; irq >= lo; irq--) {
        if ((vword >>> irq) & 1) {
          vword = (vword & ~(1 << irq)) >>> 0;
          b.write32((intTab + word) >>> 0, vword);
          take = irq;
          break;
        }
      }
      if (take < 0) {
        pending = (pending & ~(1 << lvl)) >>> 0;
        b.write32(intTab, pending);
        return;
      }
      if (!(vword & lvlmask[lvl & 3])) {
        pending = (pending & ~(1 << lvl)) >>> 0;
        b.write32(intTab, pending);
      }
      this.takeInterrupt(take + (lvl >> 2) * 32, lvl);
      return;
    }
  }

  private takeInterrupt(vector: number, lvl: number): void {
    const b = this.bus;
    const irqv = b.read32((this.intTab + vector * 4 + 4) >>> 0) >>> 0;
    let sp = this.PC & 0x2000 ? this.r[SP] : this.intStack;
    sp = ((sp + 63) & ~63) >>> 0;
    sp = (sp + 64) >>> 0;
    this.doCall(irqv, 7, sp);
    b.write32((this.r[FP] - 16) >>> 0, this.PC);
    b.write32((this.r[FP] - 12) >>> 0, this.AC);
    b.write32((this.r[FP] - 8) >>> 0, (vector - 8) >>> 0);
    this.PC = ((this.PC & ~0x1f00) | (lvl << 16) | 0x2002) >>> 0;
  }

  private ea(op: number): number {
    const abase = (op >>> 14) & 0x1f;
    if (!(op & 0x1000)) {
      const off = op & 0xfff;
      return op & 0x2000 ? (this.r[abase] + off) >>> 0 : off;
    }
    const index = op & 0x1f;
    const scale = (op >>> 7) & 7;
    const mode = (op >>> 10) & 0xf;
    switch (mode) {
      case 0x4: return this.r[abase];
      case 0x5: { const d = this.bus.read32(this.IP); this.IP = (this.IP + 4) >>> 0; return (d + this.IP) >>> 0; }
      case 0x7: return (this.r[abase] + (this.r[index] << scale)) >>> 0;
      case 0xc: { const d = this.bus.read32(this.IP); this.IP = (this.IP + 4) >>> 0; return d >>> 0; }
      case 0xd: { const d = this.bus.read32(this.IP); this.IP = (this.IP + 4) >>> 0; return (d + this.r[abase]) >>> 0; }
      case 0xe: { const d = this.bus.read32(this.IP); this.IP = (this.IP + 4) >>> 0; return (d + (this.r[index] << scale)) >>> 0; }
      case 0xf: { const d = this.bus.read32(this.IP); this.IP = (this.IP + 4) >>> 0; return (d + this.r[abase] + (this.r[index] << scale)) >>> 0; }
      default: this.bad(op); return 0;
    }
  }

  private src1(op: number): number { return op & 0x800 ? op & 0x1f : this.r[op & 0x1f]; }
  private src2(op: number): number { return op & 0x1000 ? (op >>> 14) & 0x1f : this.r[(op >>> 14) & 0x1f]; }
  private setDst(op: number, v: number): void { if (!(op & 0x2000)) this.r[(op >>> 19) & 0x1f] = v >>> 0; }
  private ci1(op: number): number { return op & 0x2000 ? (op >>> 19) & 0x1f : this.r[(op >>> 19) & 0x1f]; }
  private ci2(op: number): number { return this.r[(op >>> 14) & 0x1f]; }
  private disp(op: number): number { return (((op << 8) >> 8) - 4) | 0; }
  private dispS(op: number): number { return (((op << 19) >> 19) - 4) | 0; }

  private cmpU(a: number, b: number): void {
    a >>>= 0; b >>>= 0;
    this.AC = (this.AC & ~7) | (a < b ? 4 : a === b ? 2 : 1);
  }
  private cmpS(a: number, b: number): void {
    a |= 0; b |= 0;
    this.AC = (this.AC & ~7) | (a < b ? 4 : a === b ? 2 : 1);
  }
  private bxx(op: number, mask: number): void {
    if (this.AC & mask) this.IP = ((this.IP + this.disp(op)) & ~3) >>> 0;
  }
  private bxxS(op: number, mask: number): void {
    if (this.AC & mask) this.IP = ((this.IP + this.dispS(op)) & ~3) >>> 0;
  }

  private bad(op: number): void {
    this.unhandled++;
    this.lastUnhandled = this.PIP;
    void op;
  }

  private doCall(adr: number, type: number, stack: number): void {
    this.icount -= 9;
    this.r[RIP] = this.IP;
    if (this.rcachePos >= RCACHE) {
      const fp = (this.r[FP] & ~0x3f) >>> 0;
      for (let i = 0; i < 16; i++) this.bus.write32((fp + i * 4) >>> 0, this.r[i]);
    } else {
      this.rcache[this.rcachePos].set(this.r.subarray(0, 16));
      this.rcacheFrame[this.rcachePos] = (this.r[FP] & ~0x3f) >>> 0;
    }
    this.rcachePos++;
    this.IP = adr >>> 0;
    this.r[PFP] = ((this.r[FP] & ~7) | type) >>> 0;
    if (type === 7) this.r[SP] = stack >>> 0;
    this.r[FP] = ((this.r[SP] + 63) & ~63) >>> 0;
    this.r[SP] = (this.r[FP] + 64) >>> 0;
  }

  private doRet0(): void {
    this.r[FP] = (this.r[PFP] & ~0x3f) >>> 0;
    this.rcachePos--;
    if (this.rcachePos >= RCACHE || this.rcachePos < 0) {
      for (let i = 0; i < 16; i++) this.r[i] = this.bus.read32((this.r[FP] + 4 * i) >>> 0);
      if (this.rcachePos < 0) this.rcachePos = 0;
    } else {
      this.r.set(this.rcache[this.rcachePos], 0);
    }
    this.IP = this.r[RIP];
  }

  private doRet(): void {
    this.icount -= 7;
    switch (this.r[PFP] & 7) {
      case 0: this.doRet0(); break;
      case 7: {
        const x = this.bus.read32((this.r[FP] - 16) >>> 0) >>> 0;
        const y = this.bus.read32((this.r[FP] - 12) >>> 0) >>> 0;
        this.doRet0();
        this.AC = y;
        this.PC = x;
        this.checkPending();
        break;
      }
      default: this.bad(0x0a000000); break;
    }
  }

  private sendIac(adr: number): void {
    const b = this.bus;
    const iac = [b.read32(adr), b.read32(adr + 4), b.read32(adr + 8), b.read32(adr + 12)].map((v) => v >>> 0);
    switch (iac[0] >>> 24) {
      case 0x40: this.raise((iac[0] >>> 16) & 0xff); break;
      case 0x93:
        this.SAT = iac[1]; this.PRCB = iac[2]; this.IP = iac[3];
        this.cacheTables();
        break;
      default: break;
    }
  }

  private exec(op: number): void {
    const b = this.bus;
    const top = op >>> 24;
    const sub = (op >>> 7) & 0xf;
    const dreg = (op >>> 19) & 0x1f;
    switch (top) {
      case 0x08: this.icount--; this.IP = (this.IP + this.disp(op)) >>> 0; return;
      case 0x09: this.doCall((this.IP + this.disp(op)) >>> 0, 0, this.r[SP]); return;
      case 0x0a: this.doRet(); return;
      case 0x0b: this.icount -= 5; this.r[0x1e] = this.IP; this.IP = (this.IP + this.disp(op)) >>> 0; return;
      case 0x10: this.icount--; if (!(this.AC & 7)) this.IP = (this.IP + this.disp(op)) >>> 0; return;
      case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16: case 0x17:
        this.icount--; this.bxx(op, top & 7); return;
      case 0x18: this.icount--; if (!(this.AC & 7)) this.IP = (this.IP + this.disp(op)) >>> 0; return;
      case 0x19: case 0x1a: case 0x1b: case 0x1c: case 0x1d: case 0x1e: case 0x1f:
        this.icount--; if (this.AC & (top & 7)) this.bad(op); return;
      case 0x20: this.icount--; this.r[dreg] = this.AC & 7 ? 0 : 1; return;
      case 0x21: case 0x22: case 0x23: case 0x24: case 0x25: case 0x26: case 0x27:
        this.icount--; this.r[dreg] = this.AC & (top & 7) ? 1 : 0; return;
      case 0x30: case 0x37: {
        this.icount -= 4;
        const t1 = this.ci1(op) & 0x1f;
        const t2 = this.ci2(op);
        const set = ((t2 >>> t1) & 1) === 1;
        if (set === (top === 0x37)) {
          this.AC = (this.AC & ~7) | 2;
          this.IP = (this.IP + this.dispS(op)) >>> 0;
        } else this.AC &= ~7;
        return;
      }
      case 0x31: case 0x32: case 0x33: case 0x34: case 0x35: case 0x36:
        this.icount -= 4; this.cmpU(this.ci1(op), this.ci2(op)); this.bxxS(op, top & 7); return;
      case 0x39: case 0x3a: case 0x3b: case 0x3c: case 0x3d: case 0x3e:
        this.icount -= 4; this.cmpS(this.ci1(op), this.ci2(op)); this.bxxS(op, top & 7); return;
      case 0x58: {
        const t1 = this.src1(op);
        const t2 = this.src2(op);
        const bit = 1 << (t1 & 31);
        this.icount -= sub === 0 || sub === 3 || sub === 0xc || sub === 0xe || sub === 0xf ? 2 : 1;
        switch (sub) {
          case 0x0: this.setDst(op, t2 ^ bit); return;
          case 0x1: this.setDst(op, t2 & t1); return;
          case 0x2: this.setDst(op, t2 & ~t1); return;
          case 0x3: this.setDst(op, t2 | bit); return;
          case 0x4: this.setDst(op, ~t2 & t1); return;
          case 0x6: this.setDst(op, t2 ^ t1); return;
          case 0x7: this.setDst(op, t2 | t1); return;
          case 0x8: this.setDst(op, ~t2 & ~t1); return;
          case 0x9: this.setDst(op, ~(t2 ^ t1)); return;
          case 0xa: this.setDst(op, ~t1); return;
          case 0xb: this.setDst(op, t2 | ~t1); return;
          case 0xc: this.setDst(op, t2 & ~bit); return;
          case 0xd: this.setDst(op, ~t2 | t1); return;
          case 0xe: this.setDst(op, ~t2 | ~t1); return;
          case 0xf: this.setDst(op, this.AC & 2 ? t2 | bit : t2 & ~bit); return;
          default: this.bad(op); return;
        }
      }
      case 0x59: {
        this.icount--;
        const t1 = this.src1(op) >>> 0;
        const t2 = this.src2(op) >>> 0;
        switch (sub) {
          case 0x0: case 0x1: this.setDst(op, t2 + t1); return;
          case 0x2: case 0x3: this.setDst(op, t2 - t1); return;
          case 0x8: this.setDst(op, t1 >= 32 ? 0 : t2 >>> t1); return;
          case 0xa:
            if (t1 >= 32) this.setDst(op, 0);
            else if ((t2 | 0) < 0) this.setDst(op, (t2 & ((1 << t1) - 1)) ? ((t2 | 0) >> t1) + 1 : (t2 | 0) >> t1);
            else this.setDst(op, t2 >>> t1);
            return;
          case 0xb: this.setDst(op, t1 >= 32 ? ((t2 | 0) < 0 ? -1 : 0) : (t2 | 0) >> t1); return;
          case 0xc: case 0xe: this.setDst(op, t1 >= 32 ? 0 : t2 << t1); return;
          case 0xd: { const s = t1 & 31; this.setDst(op, s ? (t2 << s) | (t2 >>> (32 - s)) : t2); return; }
          default: this.bad(op); return;
        }
      }
      case 0x5a: {
        const t1 = this.src1(op);
        const t2 = this.src2(op);
        switch (sub) {
          case 0x0: this.icount--; this.cmpU(t1, t2); return;
          case 0x1: this.icount--; this.cmpS(t1, t2); return;
          case 0x2: this.icount--; if (!(this.AC & 4)) this.AC = (this.AC & ~7) | ((t1 >>> 0) <= (t2 >>> 0) ? 2 : 1); return;
          case 0x3: this.icount--; if (!(this.AC & 4)) this.AC = (this.AC & ~7) | ((t1 | 0) <= (t2 | 0) ? 2 : 1); return;
          case 0x4: this.icount -= 2; this.cmpU(t1, t2); this.setDst(op, t2 + 1); return;
          case 0x5: this.icount -= 2; this.cmpS(t1, t2); this.setDst(op, t2 + 1); return;
          case 0x6: this.icount -= 2; this.cmpU(t1, t2); this.setDst(op, t2 - 1); return;
          case 0x7: this.icount -= 2; this.cmpS(t1, t2); this.setDst(op, t2 - 1); return;
          case 0xc: {
            this.icount -= 2;
            this.AC &= ~7;
            for (let s = 0; s < 32; s += 8) if (((t1 >>> s) & 0xff) === ((t2 >>> s) & 0xff)) { this.AC |= 2; break; }
            return;
          }
          case 0xe: this.icount -= 2; this.AC = (this.AC & ~7) | (((t2 >>> (t1 & 0x1f)) & 1) ? 2 : 0); return;
          default: this.bad(op); return;
        }
      }
      case 0x5b: {
        this.icount -= 2;
        const t1 = this.src1(op) >>> 0;
        const t2 = this.src2(op) >>> 0;
        const c = (this.AC >>> 1) & 1;
        if (sub === 0) {
          const res = t2 + t1 + c;
          const r32 = res >>> 0;
          this.setDst(op, r32);
          this.AC = (this.AC & ~3) | (res > 0xffffffff ? 2 : 0) | (((r32 ^ t1) & (r32 ^ t2) & 0x80000000) ? 1 : 0);
        } else if (sub === 2) {
          const res = t2 + ((~t1) >>> 0) + c;
          const r32 = res >>> 0;
          this.setDst(op, r32);
          this.AC = (this.AC & ~7) | (res > 0xffffffff ? 2 : 0) | (((t2 ^ t1) & (t2 ^ r32) & 0x80000000) ? 1 : 0);
        } else this.bad(op);
        return;
      }
      case 0x5c: if (sub === 0xc) { this.icount -= 2; this.setDst(op, this.src1(op)); } else this.bad(op); return;
      case 0x5d: case 0x5e: case 0x5f: {
        if (sub !== 0xc) { this.bad(op); return; }
        const n = top === 0x5d ? 2 : top === 0x5e ? 3 : 4;
        this.icount -= n;
        const d = (op >>> 19) & (top === 0x5d ? 0x1e : 0x1c);
        if (op & 0x800) { this.r[d] = op & 0x1f; for (let i = 1; i < n; i++) this.r[d + i] = 0; } else {
          const s = op & 0x1f;
          const tmp = this.r.slice(s, s + n);
          this.r.set(tmp, d);
        }
        return;
      }
      case 0x60: {
        const t1 = this.src1(op) >>> 0;
        const t2 = this.src2(op) >>> 0;
        if (sub === 0) {
          this.icount -= 6;
          if (t1 === 0xff000004) this.ICR = b.read32(t2) >>> 0;
          else b.write32(t1, b.read32(t2));
          this.AC = (this.AC & ~7) | 2;
        } else if (sub === 2) {
          this.icount -= 12;
          if (t1 === 0xff000010) this.sendIac(t2);
          else for (let i = 0; i < 16; i += 4) b.write32((t1 + i) >>> 0, b.read32((t2 + i) >>> 0));
          this.AC = (this.AC & ~7) | 2;
        } else this.bad(op);
        return;
      }
      case 0x64: {
        const t1 = this.src1(op) >>> 0;
        switch (sub) {
          case 0x0: case 0x1: {
            this.icount -= 10;
            this.AC &= ~7;
            let res = 0xffffffff;
            for (let i = 31; i >= 0; i--) {
              const bit = (t1 >>> i) & 1;
              if (sub === 0 ? !bit : bit) { this.AC |= 2; res = i; break; }
            }
            this.setDst(op, res);
            return;
          }
          case 0x4:
            this.icount -= 7;
            this.setDst(op, t1);
            this.AC &= 0xfff8;
            if ((t1 & 0xff) < 0x30 || (t1 & 0xff) > 0x39) this.AC |= 2;
            return;
          case 0x5: {
            this.icount -= 10;
            const t2 = this.src2(op) >>> 0;
            this.setDst(op, this.AC);
            this.AC = ((this.AC & ~t1) | (t2 & t1)) >>> 0;
            return;
          }
          default: this.bad(op); return;
        }
      }
      case 0x65: {
        if (sub !== 5) { this.bad(op); return; }
        this.icount -= 10;
        const t1 = this.PC;
        const t2 = this.src2(op) >>> 0;
        this.PC = ((this.PC & ~t2) | (this.r[dreg] & t2)) >>> 0;
        this.setDst(op, t1);
        this.checkPending();
        return;
      }
      case 0x66: {
        if (sub === 0) {
          const t1 = this.src1(op) >>> 0;
          const table = b.read32((this.SAT + 152) >>> 0) >>> 0;
          const t2 = b.read32((table + 48 + t1 * 4) >>> 0) >>> 0;
          if (t2 & 3) { this.bad(op); return; }
          this.doCall(t2, 0, this.r[SP]);
        } else if (sub === 0xd) {
          if (this.rcachePos > 4) this.rcachePos = 4;
          for (let f = 0; f < this.rcachePos; f++) {
            for (let i = 0; i < 16; i++) b.write32((this.rcacheFrame[f] + i * 4) >>> 0, this.rcache[f][i]);
          }
          this.rcachePos = 0;
        } else this.bad(op);
        return;
      }
      case 0x67: {
        const t1 = this.src1(op) >>> 0;
        if (sub === 0) {
          this.icount -= 37;
          const t2 = this.src2(op) >>> 0;
          const p = BigInt(t1) * BigInt(t2);
          if (!(op & 0x2000)) {
            this.r[dreg] = Number(p & 0xffffffffn);
            this.r[dreg + 1] = Number((p >> 32n) & 0xffffffffn);
          }
        } else if (sub === 1) {
          this.icount -= 37;
          const s2 = op & 0x1000 ? BigInt((op >>> 14) & 0x1f)
            : BigInt(this.r[(op >>> 14) & 0x1f]) | (BigInt(this.r[((op >>> 14) & 0x1f) + 1]) << 32n);
          const s1 = BigInt(t1);
          if (s1 !== 0n && !(op & 0x2000)) {
            this.r[dreg] = Number((s2 % s1) & 0xffffffffn);
            this.r[dreg + 1] = Number((s2 / s1) & 0xffffffffn);
          }
        } else this.bad(op);
        return;
      }
      case 0x70: {
        const t1 = this.src1(op) >>> 0;
        const t2 = this.src2(op) >>> 0;
        switch (sub) {
          case 0x1: this.icount -= 18; this.setDst(op, Math.imul(t2, t1)); return;
          case 0x8: this.icount -= 37; this.setDst(op, t1 ? t2 % t1 : 0); return;
          case 0xb: this.icount -= 37; this.setDst(op, t1 ? Math.floor(t2 / t1) : 0); return;
          default: this.bad(op); return;
        }
      }
      case 0x74: {
        const t1 = this.src1(op) | 0;
        const t2 = this.src2(op) | 0;
        switch (sub) {
          case 0x1: this.icount -= 18; this.setDst(op, Math.imul(t2, t1)); return;
          case 0x8: this.icount -= 37; this.setDst(op, t1 ? t2 % t1 : 0); return;
          case 0x9: {
            this.icount -= 37;
            if (!t1) { this.setDst(op, 0); return; }
            let d = t2 - Math.trunc(t2 / t1) * t1;
            if ((t1 ^ t2) < 0 && d !== 0) d += t1;
            this.setDst(op, d);
            return;
          }
          case 0xb: this.icount -= 37; this.setDst(op, t1 ? Math.trunc(t2 / t1) : 0); return;
          default: this.bad(op); return;
        }
      }
      case 0x80: this.icount -= 4; this.r[dreg] = b.read8(this.ea(op)) & 0xff; return;
      case 0x82: this.icount -= 2; b.write8(this.ea(op), this.r[dreg] & 0xff); return;
      case 0x84: this.icount -= 3; this.IP = this.ea(op); return;
      case 0x85: { this.icount -= 5; const t = this.ea(op); this.r[dreg] = this.IP; this.IP = t; return; }
      case 0x86: { const t = this.ea(op); this.doCall(t, 0, this.r[SP]); return; }
      case 0x88: this.icount -= 4; this.r[dreg] = this.rd16(this.ea(op)); return;
      case 0x8a: this.icount -= 2; this.wr16(this.ea(op), this.r[dreg]); return;
      case 0x8c: this.icount--; this.r[dreg] = this.ea(op); return;
      case 0x90: this.icount -= 4; this.r[dreg] = this.rd32(this.ea(op)); return;
      case 0x92: this.icount -= 2; this.wr32(this.ea(op), this.r[dreg]); return;
      case 0x98: case 0xa0: case 0xb0: {
        const n = top === 0x98 ? 2 : top === 0xa0 ? 3 : 4;
        this.icount -= n + 3;
        const a = this.ea(op);
        const d = (op >>> 19) & (n === 2 ? 0x1e : 0x1c);
        for (let i = 0; i < n; i++) this.r[d + i] = this.rd32((a + i * 4) >>> 0);
        return;
      }
      case 0x9a: case 0xa2: case 0xb2: {
        const n = top === 0x9a ? 2 : top === 0xa2 ? 3 : 4;
        this.icount -= n + 1;
        const a = this.ea(op);
        const d = (op >>> 19) & (n === 2 ? 0x1e : 0x1c);
        for (let i = 0; i < n; i++) this.wr32((a + i * 4) >>> 0, this.r[d + i]);
        return;
      }
      case 0xc0: this.icount -= 4; this.r[dreg] = ((b.read8(this.ea(op)) << 24) >> 24) >>> 0; return;
      case 0xc2: this.icount -= 2; b.write8(this.ea(op), this.r[dreg] & 0xff); return;
      case 0xc8: this.icount -= 4; this.r[dreg] = ((this.rd16(this.ea(op)) << 16) >> 16) >>> 0; return;
      case 0xca: this.icount -= 2; this.wr16(this.ea(op), this.r[dreg]); return;
      default: this.bad(op); return;
    }
  }

  private rd16(a: number): number {
    return a & 1 ? (this.bus.read8(a) | (this.bus.read8(a + 1) << 8)) & 0xffff : this.bus.read16(a) & 0xffff;
  }
  private rd32(a: number): number {
    if (a & 3) return (this.bus.read8(a) | (this.bus.read8(a + 1) << 8) | (this.bus.read8(a + 2) << 16) | (this.bus.read8(a + 3) << 24)) >>> 0;
    return this.bus.read32(a) >>> 0;
  }
  private wr16(a: number, v: number): void {
    if (a & 1) { this.bus.write8(a, v & 0xff); this.bus.write8(a + 1, (v >>> 8) & 0xff); } else this.bus.write16(a, v & 0xffff);
  }
  private wr32(a: number, v: number): void {
    if (a & 3) for (let i = 0; i < 4; i++) this.bus.write8(a + i, (v >>> (i * 8)) & 0xff);
    else this.bus.write32(a, v >>> 0);
  }
}
