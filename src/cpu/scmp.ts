
export interface ScmpBus {
  read(addr: number): number;
  write(addr: number, v: number): void;
  senseA(): boolean;
  senseB(): boolean;
  flags(f: number): void;
  sout?(bit: number): void;
  sin?(): boolean;
}

const CY = 0x80, OV = 0x40, SB = 0x20, SA = 0x10, IE = 0x08;

const add12 = (a: number, d: number): number => (((a + d) & 0x0fff) | (a & 0xf000)) & 0xffff;
const s8 = (v: number): number => ((v & 0xff) ^ 0x80) - 0x80;

export class Scmp {
  readonly p = new Uint16Array(4);
  ac = 0;
  er = 0;
  sr = 0;
  private ieDelay = false;
  halts = 0;
  illegal = 0;

  constructor(private readonly bus: ScmpBus) {
    this.reset();
  }

  get pc(): number { return this.p[0]; }

  reset(): void {
    this.p[0] = 1;
    this.p[1] = 0;
    this.p[2] = 0;
    this.p[3] = 0;
    this.ac = 0;
    this.er = 0;
    this.sr = 0;
    this.ieDelay = false;
  }

  private fetch(): number {
    const a = this.p[0];
    this.p[0] = add12(a, 1);
    return this.bus.read(a) & 0xff;
  }

  private ea(op: number): number {
    const n = op & 3;
    const base = this.p[n];
    let d = s8(this.fetch());
    if (d === -128) d = s8(this.er);
    const a = add12(base, d);
    if ((op & 4) === 0) return a;
    if (n === 0) return 0;
    this.p[n] = a;
    return d < 0 ? a : base;
  }

  private binAdd(v: number): void {
    v &= 0xff;
    const t = this.ac + v + (this.sr >> 7);
    const ov = (this.ac & 0x80) === (v & 0x80) && (this.ac & 0x80) !== (t & 0x80) ? OV : 0;
    this.ac = t & 0xff;
    this.sr = (this.sr & 0x3f) | (t & 0x100 ? CY : 0) | ov;
  }

  private decAdd(v: number): void {
    const t = (v & 0xf) + (this.sr >> 7) + ((v & 0xff) >> 4) * 10 + (this.ac >> 4) * 10 + (this.ac & 0xf);
    this.ac = ((Math.trunc(t / 10) % 10) << 4) + (t % 10);
    this.sr = (this.sr & 0x7f) | (t >= 100 ? CY : 0);
  }

  private interrupt(): void {
    const ret = add12(this.p[0], -1);
    this.sr &= ~IE;
    const p3 = this.p[3];
    this.p[3] = ret;
    this.p[0] = add12(p3, 1);
  }

  step(): number {
    let c = 1;
    if (this.ieDelay) this.ieDelay = false;
    else if ((this.sr & IE) && this.bus.senseA()) {
      this.interrupt();
      c += 8;
    }
    return c + this.exec(this.fetch());
  }

  private jump(op: number, take: boolean): number {
    const d = s8(this.fetch());
    if (!take) return 9;
    this.p[0] = add12(this.p[op & 3], d);
    return 11;
  }

  private exec(op: number): number {
    if (op & 0x80) {
      switch (op & 0xf8) {
        case 0x90: return op & 4 ? this.jump(op, (this.ac & 0x80) === 0) : this.jump(op, true);
        case 0x98: return op & 4 ? this.jump(op, this.ac !== 0) : this.jump(op, this.ac === 0);
        case 0xa8: if (op & 4) break; { const a = this.ea(op); this.ac = (this.bus.read(a) + 1) & 0xff; this.bus.write(a, this.ac); return 22; }
        case 0xb8: if (op & 4) break; { const a = this.ea(op); this.ac = (this.bus.read(a) - 1) & 0xff; this.bus.write(a, this.ac); return 22; }
        default: break;
      }
      if (op === 0x8f) {
        const d = this.fetch();
        const c = 13 + this.ac * 2 + d * 2 + (d << 9);
        this.ac = 0xff;
        return c;
      }
      if (op >= 0xc0) {
        const imm = (op & 7) === 4;
        const v = imm ? this.fetch() : -1;
        const read = (): number => (imm ? v : this.bus.read(this.ea(op)) & 0xff);
        switch (op & 0xf8) {
          case 0xc0: this.ac = read(); return imm ? 10 : 18;
          case 0xc8: if (imm) break; this.bus.write(this.ea(op), this.ac); return 18;
          case 0xd0: this.ac &= read(); return imm ? 10 : 18;
          case 0xd8: this.ac |= read(); return imm ? 10 : 18;
          case 0xe0: this.ac ^= read(); return imm ? 10 : 18;
          case 0xe8: this.decAdd(read()); return imm ? 15 : 23;
          case 0xf0: this.binAdd(read()); return imm ? 11 : 19;
          case 0xf8: this.binAdd(~read()); return imm ? 12 : 20;
          default: break;
        }
      }
      this.illegal++;
      return 1;
    }
    switch (op) {
      case 0x00: this.halts++; return 8;
      case 0x01: { const t = this.ac; this.ac = this.er; this.er = t; return 7; }
      case 0x02: this.sr &= ~CY; return 5;
      case 0x03: this.sr |= CY; return 5;
      case 0x04: this.sr &= ~IE; return 6;
      case 0x05:
        if (!(this.sr & IE)) { this.ieDelay = true; this.sr |= IE; }
        return 6;
      case 0x06:
        this.sr = (this.sr & ~(SA | SB)) | (this.bus.senseA() ? SA : 0) | (this.bus.senseB() ? SB : 0);
        this.ac = this.sr;
        return 5;
      case 0x07:
        if (!(this.sr & IE) && (this.ac & IE)) this.ieDelay = true;
        this.sr = this.ac;
        this.bus.flags(this.ac & 7);
        return 6;
      case 0x08: return 5;
      case 0x19:
        this.bus.sout?.(this.er & 1);
        this.er = (this.er >> 1) | (this.bus.sin?.() ? 0x80 : 0);
        return 5;
      case 0x1c: this.ac >>= 1; return 5;
      case 0x1d: this.ac = (this.ac >> 1) | (this.sr & CY); return 5;
      case 0x1e: this.ac = ((this.ac >> 1) | (this.ac << 7)) & 0xff; return 5;
      case 0x1f: { const b = this.ac & 1; this.ac = (this.ac >> 1) | (this.sr & CY); this.sr = (this.sr & ~CY) | (b << 7); return 5; }
      case 0x40: this.ac = this.er; return 6;
      case 0x50: this.ac &= this.er; return 6;
      case 0x58: this.ac |= this.er; return 6;
      case 0x60: this.ac ^= this.er; return 6;
      case 0x68: this.decAdd(this.er); return 11;
      case 0x70: this.binAdd(this.er); return 7;
      case 0x78: this.binAdd(~this.er); return 8;
      default: break;
    }
    const n = op & 3;
    switch (op & 0xfc) {
      case 0x30: { const t = this.ac; this.ac = this.p[n] & 0xff; this.p[n] = (this.p[n] & 0xff00) | t; return 8; }
      case 0x34: { const t = this.ac; this.ac = this.p[n] >> 8; this.p[n] = (this.p[n] & 0xff) | (t << 8); return 8; }
      case 0x3c: {
        const ret = add12(this.p[0], -1);
        const target = this.p[n];
        this.p[n] = ret;
        this.p[0] = add12(n === 0 ? ret : target, 1);
        return 7;
      }
      default: break;
    }
    this.illegal++;
    return 1;
  }
}
