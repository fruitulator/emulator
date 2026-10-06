
export interface Tms9995Bus {
  read8(addr: number): number;
  write8(addr: number, v: number): void;
  cruRead(bit: number): number;
  cruWrite(bit: number, v: number): void;
}

export type Tms99xxVariant = '9995' | '9980a';

export interface Tms9995Options {
  variant?: Tms99xxVariant;
}

const ST_LH = 0x8000;
const ST_AGT = 0x4000;
const ST_EQ = 0x2000;
const ST_C = 0x1000;
const ST_OV = 0x0800;
const ST_OP = 0x0400;
const ST_X = 0x0200;
const ST_IM = 0x000f;

export class Tms9995 {
  pc = 0;
  wp = 0;
  st = 0;
  cycles = 0;

  readonly onchip = new Uint8Array(256);

  private decValue = 0;
  private decStart = 0;
  private decClkdiv = 0;

  readonly flag = new Uint8Array(16);
  private midFlag = 0;

  private int1Line = false;
  private int4Line = false;
  private nmiPending = false;
  private idle = false;

  readonly variant: Tms99xxVariant;
  private readonly levelLine = [false, false, false, false, false];

  constructor(private readonly bus: Tms9995Bus, opts: Tms9995Options = {}) {
    this.variant = opts.variant ?? '9995';
  }

  setLevel(level: number, active: boolean): void {
    if (level >= 1 && level <= 4) this.levelLine[level] = active;
  }

  reset(): void {
    this.st = 0;
    this.flag.fill(0);
    this.midFlag = 0;
    this.decClkdiv = 0;
    this.idle = false;
    this.wp = this.readWord(0x0000);
    this.pc = this.readWord(0x0002);
  }

  setInt1(active: boolean): void {
    this.int1Line = active;
  }

  setInt4(active: boolean): void {
    this.int4Line = active;
    if (active) this.flag[4] = 1;
  }

  nmi(): void {
    this.nmiPending = true;
  }

  private isOnchip(addr: number): boolean {
    if (this.variant !== '9995') return false;
    return ((addr & 0xff00) === 0xf000 && (addr & 0xffff) < 0xf0fc) || (addr & 0xfffc) === 0xfffc;
  }

  private get has9995(): boolean {
    return this.variant === '9995';
  }

  readWord(addr: number): number {
    addr &= 0xfffe;
    if (addr === 0xfffa && this.has9995) return this.decValue & 0xffff;
    if (this.isOnchip(addr)) {
      const i = addr & 0xfe;
      return (this.onchip[i] << 8) | this.onchip[i + 1];
    }
    return ((this.bus.read8(addr) & 0xff) << 8) | (this.bus.read8(addr + 1) & 0xff);
  }

  writeWord(addr: number, v: number): void {
    addr &= 0xfffe;
    v &= 0xffff;
    if (addr === 0xfffa && this.has9995) {
      this.decStart = this.decValue = v;
      return;
    }
    if (this.isOnchip(addr)) {
      const i = addr & 0xfe;
      this.onchip[i] = v >> 8;
      this.onchip[i + 1] = v & 0xff;
      return;
    }
    this.bus.write8(addr, v >> 8);
    this.bus.write8(addr + 1, v & 0xff);
  }

  readByte(addr: number): number {
    addr &= 0xffff;
    if ((addr & 0xfffe) === 0xfffa && this.has9995) return (addr & 1 ? this.decValue : this.decValue >> 8) & 0xff;
    if (this.isOnchip(addr)) return this.onchip[addr & 0xff];
    return this.bus.read8(addr) & 0xff;
  }

  writeByte(addr: number, v: number): void {
    addr &= 0xffff;
    v &= 0xff;
    if ((addr & 0xfffe) === 0xfffa && this.has9995) {
      const w = addr & 1 ? v : v << 8;
      this.decStart = this.decValue = w;
      return;
    }
    if (this.isOnchip(addr)) {
      this.onchip[addr & 0xff] = v;
      return;
    }
    this.bus.write8(addr, v);
  }

  private regAddr(n: number): number {
    return (this.wp + 2 * (n & 15)) & 0xffff;
  }

  reg(n: number): number {
    return this.readWord(this.regAddr(n));
  }

  setReg(n: number, v: number): void {
    this.writeWord(this.regAddr(n), v);
  }

  private cruBitRead(bit: number): number {
    bit &= 0x7fff;
    if (!this.has9995) return this.bus.cruRead(bit) & 1;
    if ((bit & 0x7ff0) === 0x0f70) return this.flag[bit & 0x0f];
    if (bit === 0x0fed) return this.midFlag;
    return this.bus.cruRead(bit) & 1;
  }

  private cruBitWrite(bit: number, v: number): void {
    bit &= 0x7fff;
    v &= 1;
    if (!this.has9995) { this.bus.cruWrite(bit, v); return; }
    if (bit === 0x0fed) {
      this.midFlag = v;
      return;
    }
    if ((bit & 0x7ff0) === 0x0f70) {
      const i = bit & 0x0f;
      if (i !== 2 && i !== 3 && i !== 4) this.flag[i] = v;
      return;
    }
    this.bus.cruWrite(bit, v);
  }

  private setBit(mask: number, on: boolean | number): void {
    if (on) this.st |= mask;
    else this.st &= ~mask;
  }

  private lae(v1: number, v2: number): void {
    v1 &= 0xffff;
    v2 &= 0xffff;
    this.setBit(ST_EQ, v1 === v2);
    this.setBit(ST_LH, v1 > v2);
    this.setBit(ST_AGT, ((v1 << 16) >> 16) > ((v2 << 16) >> 16));
  }

  private parity(byte: number): void {
    let c = byte & 0xff;
    c ^= c >> 4;
    c ^= c >> 2;
    c ^= c >> 1;
    this.setBit(ST_OP, (c & 1) !== 0);
  }

  private eaCycles = 0;

  private effectiveAddress(t: number, n: number, byteOp: boolean): number {
    switch (t & 3) {
      case 0:
        return this.regAddr(n);
      case 1:
        this.eaCycles += 1;
        return this.reg(n);
      case 2: {
        const disp = this.fetchWord();
        this.eaCycles += 2;
        return n === 0 ? disp : (disp + this.reg(n)) & 0xffff;
      }
      default: {
        const a = this.reg(n);
        this.setReg(n, (a + (byteOp ? 1 : 2)) & 0xffff);
        this.eaCycles += 2;
        return a;
      }
    }
  }

  private fetchWord(): number {
    const v = this.readWord(this.pc);
    this.pc = (this.pc + 2) & 0xfffe;
    return v;
  }

  private contextSwitch(vector: number, newMask: number | null): void {
    const newWp = this.readWord(vector);
    const newPc = this.readWord((vector + 2) & 0xffff);
    const oldWp = this.wp;
    const oldPc = this.pc;
    const oldSt = this.st;
    this.wp = newWp & 0xfffe;
    this.setReg(13, oldWp);
    this.setReg(14, oldPc);
    this.setReg(15, oldSt);
    this.pc = newPc & 0xfffe;
    if (newMask !== null) this.st = (this.st & ~ST_IM) | newMask;
    this.idle = false;
  }

  private checkInterrupts(): boolean {
    if (this.nmiPending) {
      this.nmiPending = false;
      this.contextSwitch(0xfffc, 0);
      return true;
    }
    const im = this.st & ST_IM;
    if (!this.has9995) {
      for (let level = 1; level <= 4; level++) {
        if (this.levelLine[level] && im >= level) {
          this.contextSwitch(level << 2, level - 1);
          return true;
        }
      }
      return false;
    }
    if (this.int1Line && im >= 1) {
      this.contextSwitch(0x0004, 0);
      return true;
    }
    if (this.flag[3] && im >= 3) {
      this.flag[3] = 0;
      this.contextSwitch(0x000c, 2);
      return true;
    }
    if (this.int4Line && im >= 4) {
      this.flag[4] = 0;
      this.contextSwitch(0x0010, 3);
      return true;
    }
    return false;
  }

  private tickDecrementer(n: number): void {
    if (this.decStart === 0) {
      this.decClkdiv = (this.decClkdiv + n) & 3;
      return;
    }
    let ticks = 0;
    this.decClkdiv += n;
    ticks = this.decClkdiv >> 2;
    this.decClkdiv &= 3;
    while (ticks-- > 0) {
      this.decValue = (this.decValue - 1) & 0xffff;
      if (this.decValue === 0) {
        this.decValue = this.decStart;
        if (this.flag[1]) this.flag[3] = 1;
      }
    }
  }

  step(): number {
    if (this.checkInterrupts()) {
      this.tickDecrementer(14);
      this.cycles += 14;
      return 14;
    }
    if (this.idle) {
      this.tickDecrementer(4);
      this.cycles += 4;
      return 4;
    }
    this.eaCycles = 0;
    const ir = this.fetchWord();
    const n = this.execute(ir);
    const total = n + this.eaCycles;
    this.tickDecrementer(total);
    this.cycles += total;
    return total;
  }

  private execute(ir: number): number {
    const top = ir & 0xf000;

    if (top >= 0x4000) {
      const byteOp = (ir & 0x1000) !== 0;
      const ts = (ir >> 4) & 3;
      const s = ir & 15;
      const td = (ir >> 10) & 3;
      const d = (ir >> 6) & 15;
      const sa = this.effectiveAddress(ts, s, byteOp);
      const src = byteOp ? this.readByte(sa) : this.readWord(sa);
      const da = this.effectiveAddress(td, d, byteOp);
      const op = top >> 12;
      if (op === 0x8 || op === 0x9) {
        const dst = byteOp ? this.readByte(da) : this.readWord(da);
        if (byteOp) {
          this.parity(src);
          this.lae(src << 8, dst << 8);
        } else this.lae(src, dst);
        return 4;
      }
      let result: number;
      const dst = op === 0xc || op === 0xd ? 0 : byteOp ? this.readByte(da) : this.readWord(da);
      switch (op) {
        case 0x4:
        case 0x5:
          result = dst & ~src;
          break;
        case 0x6:
        case 0x7: {
          const w = byteOp ? 8 : 0;
          const a = (dst << w) & 0xffff;
          const b = (src << w) & 0xffff;
          const r = a + ((~b) & 0xffff) + 1;
          this.setBit(ST_C, (r & 0x10000) !== 0);
          this.setBit(ST_OV, ((a ^ b) & (a ^ r) & 0x8000) !== 0);
          result = (r & 0xffff) >> w;
          break;
        }
        case 0xa:
        case 0xb: {
          const w = byteOp ? 8 : 0;
          const a = (dst << w) & 0xffff;
          const b = (src << w) & 0xffff;
          const r = a + b;
          this.setBit(ST_C, (r & 0x10000) !== 0);
          this.setBit(ST_OV, ((r ^ a) & (r ^ b) & 0x8000) !== 0);
          result = (r & 0xffff) >> w;
          break;
        }
        case 0xc:
        case 0xd:
          result = src;
          break;
        default:
          result = dst | src;
          break;
      }
      result &= byteOp ? 0xff : 0xffff;
      if (byteOp) {
        this.parity(result);
        this.lae(result << 8, 0);
        this.writeByte(da, result);
      } else {
        this.lae(result, 0);
        this.writeWord(da, result);
      }
      return 4;
    }

    if (top >= 0x2000) {
      const opc = ir & 0xfc00;
      const ts = (ir >> 4) & 3;
      const s = ir & 15;
      const d = (ir >> 6) & 15;
      switch (opc & 0x3c00) {
        case 0x2000: {
          const src = this.readWord(this.effectiveAddress(ts, s, false));
          this.setBit(ST_EQ, (src & ~this.reg(d)) === 0);
          return 4;
        }
        case 0x2400: {
          const src = this.readWord(this.effectiveAddress(ts, s, false));
          this.setBit(ST_EQ, (src & this.reg(d)) === 0);
          return 4;
        }
        case 0x2800: {
          const src = this.readWord(this.effectiveAddress(ts, s, false));
          const r = (src ^ this.reg(d)) & 0xffff;
          this.setReg(d, r);
          this.lae(r, 0);
          return 4;
        }
        case 0x2c00: {
          const sa = this.effectiveAddress(ts, s, false);
          this.contextSwitch(0x0040 + 4 * d, null);
          this.setReg(11, sa);
          this.st |= ST_X;
          return 16;
        }
        case 0x3000: {
          const c = d === 0 ? 16 : d;
          const byteOp = c <= 8;
          const sa = this.effectiveAddress(ts, s, byteOp);
          let v = byteOp ? this.readByte(sa) : this.readWord(sa);
          if (byteOp) {
            this.parity(v);
            this.lae(v << 8, 0);
          } else this.lae(v, 0);
          let bit = (this.reg(12) & 0xfffe) >> 1;
          for (let i = 0; i < c; i++) {
            this.cruBitWrite(bit + i, v & 1);
            v >>= 1;
          }
          return 6 + c;
        }
        case 0x3400: {
          const c = d === 0 ? 16 : d;
          const byteOp = c <= 8;
          const sa = this.effectiveAddress(ts, s, byteOp);
          let v = 0;
          const bit = (this.reg(12) & 0xfffe) >> 1;
          for (let i = 0; i < c; i++) v |= (this.cruBitRead(bit + i) & 1) << i;
          if (byteOp) {
            this.parity(v);
            this.lae(v << 8, 0);
            this.writeByte(sa, v);
          } else {
            this.lae(v, 0);
            this.writeWord(sa, v);
          }
          return 6 + c;
        }
        case 0x3800: {
          const src = this.readWord(this.effectiveAddress(ts, s, false));
          const prod = (this.reg(d) * src) >>> 0;
          this.setReg(d, (prod >> 16) & 0xffff);
          this.setReg((d + 1) & 15, prod & 0xffff);
          return 20;
        }
        default: {
          const src = this.readWord(this.effectiveAddress(ts, s, false));
          const hi = this.reg(d);
          const overflow = hi >= src;
          this.setBit(ST_OV, overflow);
          if (!overflow) {
            const dividend = ((hi << 16) | this.reg((d + 1) & 15)) >>> 0;
            this.setReg(d, Math.floor(dividend / src) & 0xffff);
            this.setReg((d + 1) & 15, dividend % src & 0xffff);
          }
          return 28;
        }
      }
    }

    if (top === 0x1000) {
      const cond = (ir >> 8) & 0x0f;
      const disp = (ir << 24) >> 24;
      if (cond <= 0x0c) {
        let take = false;
        switch (cond) {
          case 0x0: take = true; break;
          case 0x1: take = (this.st & (ST_AGT | ST_EQ)) === 0; break;
          case 0x2: take = (this.st & ST_LH) === 0; break;
          case 0x3: take = (this.st & ST_EQ) !== 0; break;
          case 0x4: take = (this.st & (ST_LH | ST_EQ)) !== 0; break;
          case 0x5: take = (this.st & ST_AGT) !== 0; break;
          case 0x6: take = (this.st & ST_EQ) === 0; break;
          case 0x7: take = (this.st & ST_C) === 0; break;
          case 0x8: take = (this.st & ST_C) !== 0; break;
          case 0x9: take = (this.st & ST_OV) === 0; break;
          case 0xa: take = (this.st & (ST_LH | ST_EQ)) === 0; break;
          case 0xb: take = (this.st & ST_LH) !== 0; break;
          default: take = (this.st & ST_OP) !== 0; break;
        }
        if (take) this.pc = (this.pc + disp * 2) & 0xfffe;
        return 3;
      }
      const bit = (((this.reg(12) & 0xfffe) >> 1) + disp) & 0x7fff;
      if (cond === 0x0d) this.cruBitWrite(bit, 1);
      else if (cond === 0x0e) this.cruBitWrite(bit, 0);
      else this.setBit(ST_EQ, this.cruBitRead(bit) !== 0);
      return 4;
    }

    if ((ir & 0xfc00) === 0x0800) {
      const r = ir & 15;
      let count = (ir >> 4) & 15;
      if (count === 0) {
        count = this.reg(0) & 15;
        if (count === 0) count = 16;
      }
      let v = this.reg(r);
      let carry = false;
      let ov = false;
      const kind = (ir >> 8) & 3;
      const sign = kind === 0 ? v & 0x8000 : 0;
      for (let i = 0; i < count; i++) {
        if (kind === 2) {
          carry = (v & 0x8000) !== 0;
          v = (v << 1) & 0xffff;
          if (carry !== ((v & 0x8000) !== 0)) ov = true;
        } else {
          carry = (v & 1) !== 0;
          v = (v >> 1) | (kind === 3 ? (carry ? 0x8000 : 0) : sign);
        }
      }
      this.setReg(r, v);
      this.setBit(ST_C, carry);
      if (kind === 2) this.setBit(ST_OV, ov);
      this.lae(v, 0);
      return 5 + count;
    }

    if ((ir & 0xfc00) === 0x0400) {
      const op = ir & 0x03c0;
      const ts = (ir >> 4) & 3;
      const s = ir & 15;
      const byteOp = false;
      const sa = this.effectiveAddress(ts, s, byteOp);
      switch (op) {
        case 0x0000: {
          const newWp = this.readWord(sa);
          const newPc = this.readWord((sa + 2) & 0xffff);
          const oldWp = this.wp;
          const oldPc = this.pc;
          this.wp = newWp & 0xfffe;
          this.setReg(13, oldWp);
          this.setReg(14, oldPc);
          this.setReg(15, this.st);
          this.pc = newPc & 0xfffe;
          return 11;
        }
        case 0x0040:
          this.pc = sa & 0xfffe;
          return 3;
        case 0x0080:
          return 2 + this.execute(this.readWord(sa));
        case 0x00c0:
          this.writeWord(sa, 0);
          return 3;
        case 0x0100: {
          const v = this.readWord(sa);
          const r = ((~v & 0xffff) + 1);
          this.setBit(ST_OV, v === 0x8000);
          this.setBit(ST_C, (r & 0x10000) !== 0);
          this.writeWord(sa, r & 0xffff);
          this.lae(r & 0xffff, 0);
          return 4;
        }
        case 0x0140: {
          const r = ~this.readWord(sa) & 0xffff;
          this.writeWord(sa, r);
          this.lae(r, 0);
          return 4;
        }
        case 0x0180:
        case 0x01c0:
        case 0x0200:
        case 0x0240: {
          const v = this.readWord(sa);
          const add = op === 0x0180 ? 1 : op === 0x01c0 ? 2 : op === 0x0200 ? 0xffff : 0xfffe;
          const sign = op >= 0x0200 ? 0x8000 : 0;
          const r = v + add;
          this.setBit(ST_OV, (v & 0x8000) === sign && (r & 0x8000) !== sign);
          this.setBit(ST_C, (r & 0x10000) !== 0);
          this.writeWord(sa, r & 0xffff);
          this.lae(r & 0xffff, 0);
          return 4;
        }
        case 0x0280:
          this.setReg(11, this.pc);
          this.pc = sa & 0xfffe;
          return 5;
        case 0x02c0: {
          const v = this.readWord(sa);
          this.writeWord(sa, ((v << 8) | (v >> 8)) & 0xffff);
          return 13;
        }
        case 0x0300:
          this.writeWord(sa, 0xffff);
          return 3;
        default: {
          const v = this.readWord(sa);
          this.setBit(ST_OV, v === 0x8000);
          this.setBit(ST_C, false);
          this.lae(v, 0);
          this.writeWord(sa, (v & 0x8000) !== 0 ? ((~v & 0xffff) + 1) & 0xffff : v);
          return 5;
        }
      }
    }

    if ((ir & 0xfe00) === 0x0200) {
      const op = ir & 0x01e0;
      const r = ir & 15;
      switch (op) {
        case 0x0000: {
          const v = this.fetchWord();
          this.setReg(r, v);
          this.lae(v, 0);
          return 4;
        }
        case 0x0020: {
          const a = this.reg(r);
          const b = this.fetchWord();
          const sum = a + b;
          this.setBit(ST_C, (sum & 0x10000) !== 0);
          this.setBit(ST_OV, ((sum ^ a) & (sum ^ b) & 0x8000) !== 0);
          this.setReg(r, sum & 0xffff);
          this.lae(sum & 0xffff, 0);
          return 5;
        }
        case 0x0040: {
          const v = this.reg(r) & this.fetchWord();
          this.setReg(r, v);
          this.lae(v, 0);
          return 5;
        }
        case 0x0060: {
          const v = this.reg(r) | this.fetchWord();
          this.setReg(r, v);
          this.lae(v, 0);
          return 5;
        }
        case 0x0080:
          this.lae(this.reg(r), this.fetchWord());
          return 5;
        case 0x00a0:
          this.setReg(r, this.wp);
          return 3;
        case 0x00c0:
          this.setReg(r, this.st);
          return 3;
        case 0x00e0:
          this.wp = this.fetchWord() & 0xfffe;
          return 4;
        case 0x0100:
          this.st = (this.st & ~ST_IM) | (this.fetchWord() & ST_IM);
          return 5;
        case 0x0140:
          this.idle = true;
          return 7;
        case 0x0160:
          this.st &= ~ST_IM;
          return 7;
        case 0x0180:
          this.st = this.reg(15);
          this.pc = this.reg(14) & 0xfffe;
          this.wp = this.reg(13) & 0xfffe;
          return 7;
        default:
          return 7;
      }
    }

    if ((ir & 0xfff0) === 0x0080) {
      this.st = this.reg(ir & 15);
      return 4;
    }
    if ((ir & 0xfff0) === 0x0090) {
      this.wp = this.reg(ir & 15) & 0xfffe;
      return 4;
    }
    if ((ir & 0xffc0) === 0x0180) {
      const sa = this.effectiveAddress((ir >> 4) & 3, ir & 15, false);
      const divisor = (this.readWord(sa) << 16) >> 16;
      const dividend = ((this.reg(0) << 16) | this.reg(1)) | 0;
      if (divisor === 0) {
        this.setBit(ST_OV, true);
        return 10;
      }
      const q = ~~(dividend / divisor);
      const rem = dividend % divisor;
      const overflow = q > 0x7fff || q < -0x8000;
      this.setBit(ST_OV, overflow);
      if (!overflow) {
        this.setReg(0, q & 0xffff);
        this.setReg(1, rem & 0xffff);
        this.lae(q & 0xffff, 0);
      }
      return 28;
    }
    if ((ir & 0xffc0) === 0x01c0) {
      const sa = this.effectiveAddress((ir >> 4) & 3, ir & 15, false);
      const src = (this.readWord(sa) << 16) >> 16;
      const a = (this.reg(0) << 16) >> 16;
      const prod = (a * src) | 0;
      this.setReg(0, (prod >> 16) & 0xffff);
      this.setReg(1, prod & 0xffff);
      this.setBit(ST_EQ, prod === 0);
      this.setBit(ST_LH, prod !== 0);
      this.setBit(ST_AGT, prod > 0);
      return 25;
    }

    this.midFlag = 1;
    this.contextSwitch(0x0008, 1);
    return 14;
  }
}
