
const BAUD1 = [50, 110, 134, 200, 300, 600, 1200, 1050, 2400, 4800, 7200, 9600, 38400, 0, 16, 1];
const BAUD2 = [75, 110, 134, 150, 300, 600, 1200, 2000, 2400, 4800, 1800, 9600, 19200, 0, 16, 1];

const XTAL = 0x384000;

interface Chan {
  mr: [number, number, number];
  mrPtr: number;
  sr: number;
  csr: number;
  cr: number;
  fifo: number[];
  rxOn: boolean;
  txOn: boolean;
  thr: number;
  shift: number;
  txTimer: number;
  baud: number;
}

export interface QuartHooks {
  tx?(ch: number, v: number, nine: number): void;
  op?(blk: 0 | 1, pins: number, changed: number): void;
}

export class Quart {
  private readonly ch: Chan[] = [0, 1, 2, 3].map(() => ({
    mr: [0, 0, 0] as [number, number, number], mrPtr: 1, sr: 0, csr: 0, cr: 0, fifo: [], rxOn: false, txOn: false,
    thr: -1, shift: 0, txTimer: 0, baud: 9600,
  }));
  readonly isr = [0, 0];
  readonly imr = [0, 0];
  readonly acr = [0, 0];
  readonly ip = [0x20, 0];
  private ipcr = 0;
  readonly opr = [0, 0];
  private readonly ctReload = [2, 0];
  private readonly counter = [0, 0];
  private readonly prescale = [0, 0];
  private readonly toggle = [false, false];
  private readonly running = [false, false];
  private readonly misc = new Uint8Array(16);
  icr = 0;
  cir = 0;
  nine = 0;
  private scale = 1;

  constructor(private readonly hooks: QuartHooks = {}) {}

  setClock(cpuHz: number): void {
    this.scale = Math.max(1, Math.floor((cpuHz * 64) / XTAL));
  }

  reset(): void {
    for (const c of this.ch) {
      c.mr = [0, 0, 0]; c.mrPtr = 1; c.sr = 0; c.csr = 0; c.cr = 0; c.fifo = [];
      c.rxOn = false; c.txOn = false; c.thr = -1; c.shift = 0; c.txTimer = 0; c.baud = 9600;
    }
    this.isr[0] = this.isr[1] = 0;
    this.imr[0] = this.imr[1] = 0;
    this.acr[0] = this.acr[1] = 0;
    this.ip[0] = 0x20; this.ip[1] = 0;
    this.ipcr = 0;
    this.opr[0] = this.opr[1] = 0;
    this.ctReload[0] = 2; this.ctReload[1] = 0;
    this.counter[0] = this.counter[1] = 0;
    this.prescale[0] = this.prescale[1] = 0;
    this.toggle[0] = this.toggle[1] = false;
    this.running[0] = this.running[1] = false;
    this.misc.fill(0);
    this.misc[0] = 0xf;
    this.icr = 0;
    this.cir = 0;
    this.nine = 0;
  }

  pins(blk: 0 | 1): number { return ~this.opr[blk] & 0xff; }

  private baudFor(blk: number, csr: number): number {
    return ((this.acr[blk] & 0x80) ? BAUD2 : BAUD1)[csr & 0xf];
  }

  read(reg: number): number {
    reg &= 0x7f;
    if (reg < 0x20) {
      const blk = reg >> 4;
      const r = reg & 0xf;
      const a = this.ch[blk * 2];
      const b = this.ch[blk * 2 + 1];
      switch (r) {
        case 0x0: return this.readMr(a);
        case 0x1: return a.sr;
        case 0x2: return 0;
        case 0x3: return this.rhr(a, blk, 0x02);
        case 0x4: {
          if (blk) return 0;
          const v = (this.ipcr & 0xf0) | (this.ip[0] & 0xf);
          this.ipcr &= 0xf;
          this.isr[0] &= 0x7f;
          return v;
        }
        case 0x5: return this.isr[blk];
        case 0x6: return (Math.floor(this.counter[blk] / this.scale) >> 8) & 0xff;
        case 0x7: return Math.floor(this.counter[blk] / this.scale) & 0xff;
        case 0x8: return this.readMr(b, blk === 1 ? this.ch[1] : b);
        case 0x9: return b.sr;
        case 0xa: return 0;
        case 0xb: return this.rhr(b, blk, 0x20);
        case 0xc: return this.opr[blk];
        case 0xd: return this.ip[blk];
        case 0xe:
          this.running[blk] = true;
          this.counter[blk] = this.ctReload[blk] * this.scale;
          return 0;
        default:
          this.running[blk] = false;
          this.isr[blk] &= ~8;
          return 0;
      }
    }
    switch (reg) {
      case 0x20: case 0x21: case 0x22: case 0x23: return this.misc[reg - 0x20 + 1];
      case 0x28: return this.cir;
      case 0x29: return this.cir & 7;
      case 0x2a: return this.cir >> 5;
      case 0x2b: return this.misc[6];
      case 0x2c: return this.icr;
      default: return 0;
    }
  }

  private readMr(c: Chan, advance: Chan = c): number {
    const p = c.mrPtr;
    const v = c.mr[Math.min(p, 2)];
    if (p < 2) advance.mrPtr = p + 1;
    return v;
  }

  private rhr(c: Chan, blk: number, isrBit: number): number {
    const v = c.fifo.length ? c.fifo[0] : 0;
    if (c.fifo.length) c.fifo.shift();
    if (c.fifo.length === 0) {
      this.isr[blk] &= ~isrBit;
      c.sr &= 0xfc;
    } else c.sr &= 0xfd;
    return v;
  }

  write(reg: number, val: number): void {
    reg &= 0x7f;
    const v = val & 0xff;
    if (reg < 0x20) {
      const blk = reg >> 4;
      const r = reg & 0xf;
      const a = this.ch[blk * 2];
      const b = this.ch[blk * 2 + 1];
      switch (r) {
        case 0x0: this.writeMr(a, v); return;
        case 0x1:
          a.csr = v;
          a.baud = this.baudFor(blk, v);
          return;
        case 0x2: this.command(a, v, blk, 0x01); return;
        case 0x3: this.thrWrite(a, v, blk, 0x01); return;
        case 0x4:
          this.acr[blk] = v;
          a.baud = this.baudFor(blk, a.csr);
          b.baud = this.baudFor(blk, b.csr);
          return;
        case 0x5: this.imr[blk] = v; return;
        case 0x6: this.ctReload[blk] = (v << 8) | (this.ctReload[blk] & 0xff); return;
        case 0x7: this.ctReload[blk] = (this.ctReload[blk] & 0xff00) | v; return;
        case 0x8: this.writeMr(b, v); return;
        case 0x9:
          b.csr = v;
          b.baud = this.baudFor(blk, v);
          return;
        case 0xa: this.command(b, v, blk, 0x10); return;
        case 0xb: this.thrWrite(b, v, blk, 0x10); return;
        case 0xc: {
          const was = this.opr[blk];
          this.opr[blk] = v;
          this.hooks.op?.(blk as 0 | 1, ~v & 0xff, was ^ v);
          return;
        }
        case 0xd: this.misc[8 + blk * 2] = v; return;
        case 0xe: this.misc[9 + blk * 2] = v; return;
        default: return;
      }
    }
    switch (reg) {
      case 0x20: case 0x21: case 0x22: case 0x23: this.misc[reg - 0x20 + 1] = v; return;
      case 0x29: this.misc[0] = v; return;
      case 0x2a: this.irq(); return;
      case 0x2b: this.misc[6] = v; return;
      case 0x2c: this.icr = v; return;
      default: return;
    }
  }

  private writeMr(c: Chan, v: number): void {
    const p = c.mrPtr;
    c.mr[Math.min(p, 2)] = v;
    if (p < 2) c.mrPtr = p + 1;
  }

  private command(c: Chan, v: number, blk: number, txBit: number): void {
    c.cr = v;
    if (v & 1) c.rxOn = true;
    if (v & 2) c.rxOn = false;
    if (v & 4) { c.txOn = true; this.isr[blk] |= txBit; c.sr |= 0xc; }
    if (v & 8) { c.txOn = false; this.isr[blk] &= ~txBit; c.sr &= 0xf3; }
    switch ((v & 0x70) >> 4) {
      case 1: c.mrPtr = 1; break;
      case 2: c.rxOn = false; break;
      case 3: c.txOn = false; this.isr[blk] &= ~txBit; c.sr &= 0xf3; break;
      case 4: c.sr &= 0xf; break;
      case 5: this.isr[blk] &= txBit === 1 ? 0xfb : 0xbf; break;
      default: break;
    }
  }

  private thrWrite(c: Chan, v: number, blk: number, txBit: number): void {
    if (!c.txOn || !(c.sr & 4)) return;
    c.thr = v;
    c.sr &= 0xf3;
    this.isr[blk] &= ~txBit;
  }

  receive(ch: number, v: number): void {
    const c = this.ch[ch];
    if (!c.rxOn) return;
    const blk = ch >> 1;
    this.isr[blk] |= ch & 1 ? 0x20 : 0x02;
    c.sr |= 1;
    if (c.fifo.length < 3) c.fifo.push(v & 0xff);
    else c.sr |= 2;
  }

  irq(): boolean {
    const m0 = this.isr[0] & this.imr[0];
    const m1 = this.isr[1] & this.imr[1];
    if (!m0 && !m1) { this.cir = 0; return false; }
    let best = 0;
    const offer = (bits: number, blk: number) => {
      for (let i = 0; i < 8; i++) {
        if (!(bits & (1 << i))) continue;
        const ab = blk ? 2 : 0;
        let v = 0;
        switch (i) {
          case 0: v = 0x18 + ab; break;
          case 1: v = ((this.ch[0].fifo.length << 5) | (0xc + ab)) & 0xff; break;
          case 2: v = (this.icr & 0xe0) | (0x10 + ab); break;
          case 3: v = ((this.icr << 6) | (0x15 + ab)) & 0xff; break;
          case 4: v = 0x19 + ab; break;
          case 5: v = ((this.ch[1].fifo.length << 5) | (0xd + ab)) & 0xff; break;
          case 6: v = (this.icr & 0xe0) | (0x11 + ab); break;
          default: v = (((this.icr & 0x1c) << 3) | (4 + ab)) & 0xff; break;
        }
        if (v > best) best = v;
      }
    };
    offer(m0, 0);
    offer(m1, 1);
    this.cir = best;
    return ((best & 0xfc) >> (this.icr & 0x1c)) !== 0;
  }

  tick(cycles: number): void {
    const units = cycles * 64;
    for (let blk = 0; blk < 2; blk++) {
      const acr = this.acr[blk];
      if (!(acr & 0x20) || !((acr & 0x40) || (this.running[blk] && (acr & 0x10)))) continue;
      let dec = units;
      if (acr & 0x10) {
        this.prescale[blk] += cycles;
        if (this.prescale[blk] <= 0xf) continue;
        dec = (this.prescale[blk] >> 4) * 64;
        this.prescale[blk] &= 0xf;
      }
      this.counter[blk] -= dec;
      if (this.counter[blk] < 1) {
        if (!(acr & 0x40)) this.isr[blk] |= 8;
        else {
          this.toggle[blk] = !this.toggle[blk];
          if (this.toggle[blk]) this.isr[blk] |= 8;
        }
        this.counter[blk] += this.ctReload[blk] * this.scale;
      }
    }
    for (let i = 0; i < 4; i++) this.tickTx(i, units);
  }

  private tickTx(i: number, units: number): void {
    const c = this.ch[i];
    const blk = i >> 1;
    const txBit = i & 1 ? 0x10 : 0x01;
    if (c.txTimer === 0) {
      if (!c.txOn || c.thr === -1) return;
      c.shift = c.thr;
      if (i === 0) this.nine = (c.mr[1] & 0x18) === 0x18 ? c.mr[1] & 4 : 0;
      c.thr = -1;
      const bits = (c.mr[1] & 3) + ((~c.mr[1] >> 4) & 1) + 6;
      c.txTimer = c.baud > 0 ? Math.trunc(XTAL / c.baud) * bits * this.scale : 1;
      c.sr |= 4;
      this.isr[blk] |= txBit;
      return;
    }
    c.txTimer = Math.max(0, c.txTimer - units);
    if (c.txTimer !== 0) return;
    if (c.thr === -1) c.sr |= 8;
    if (c.mr[2] & 0x80) this.receive(i, c.shift);
    else this.hooks.tx?.(i, c.shift, i === 0 ? this.nine : 0);
    if (c.mr[2] & 0x20) {
      c.txOn = false;
      this.isr[blk] &= ~txBit;
      c.sr &= 0xfb;
    }
  }
}
