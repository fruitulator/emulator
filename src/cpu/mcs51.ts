
export interface Mcs51Bus {
  readCode(addr: number): number;
  readXdata(addr: number): number;
  writeXdata(addr: number, v: number): void;
  readPort(port: 0 | 1 | 2 | 3): number;
  writePort(port: 0 | 1 | 2 | 3, v: number): void;
  serialTx?(v: number, bit8?: number): void;
}

export interface Mcs51Options {
  ramSize?: 128 | 256;
  cmos?: boolean;
}

const CYCLES = new Uint8Array([
  1, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 2, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 1, 2, 4, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 1, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2,
  2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
]);

const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let v = i, p = 0;
  while (v) { p ^= v & 1; v >>= 1; }
  PARITY[i] = p;
}

const CY = 0x80, AC = 0x40, OV = 0x04;
const TF1 = 0x80, TR1 = 0x40, TF0 = 0x20, TR0 = 0x10, IE1 = 0x08, IT1 = 0x04, IE0 = 0x02, IT0 = 0x01;
const GATE1 = 0x80, CT1 = 0x40, GATE0 = 0x08, CT0 = 0x04;
const SM2 = 0x20, REN = 0x10, TB8 = 0x08, RB8 = 0x04, TI = 0x02, RI = 0x01;
const SMOD = 0x80, PD = 0x02, IDL = 0x01;
const EA = 0x80;

const LINE_INT0 = 0, LINE_INT1 = 1, LINE_T0 = 2, LINE_T1 = 3;

const V_IE0 = 0x03, V_TF0 = 0x0b, V_IE1 = 0x13, V_TF1 = 0x1b;

const FRAME_BITS = [10, 10, 11, 11];

export interface Mcs51State {
  pc: number; ppc: number; acc: number; psw: number; b: number; sp: number; dptr: number;
  pcon: number; tcon: number; tmod: number; scon: number; sbuf: number; ie: number; ip: number; iph: number;
  p: number[]; tl0: number; th0: number; tl1: number; th1: number;
  iram: number[];
  lineState: number; t0Cnt: number; t1Cnt: number;
  curIrqPrio: number; irqActive: number; irqBlock: boolean; lastOp: number; lastBit: number;
  txData: number; txBit8: number; txBits: number; smodDiv: number; txClk: number; rxClk: number;
  rxBits: number; rxQueue: number[]; rxBit8Queue: number[];
  cycles: number;
}

export class Mcs51 {
  private pcReg = 0;
  private ppc = 0;
  acc = 0;
  psw = 0;
  b = 0;
  sp = 7;
  dptr = 0;
  pcon = 0;
  tcon = 0;
  tmod = 0;
  scon = 0;
  sbuf = 0;
  ie = 0;
  ip = 0;
  private iph = 0;
  readonly p = new Uint8Array(4);
  tl0 = 0;
  th0 = 0;
  tl1 = 0;
  th1 = 0;
  readonly iram = new Uint8Array(256);

  cycles = 0;
  illegalCount = 0;
  lastIllegalPc = -1;
  rxOverruns = 0;

  private readonly ramMask: number;
  private readonly hasPd: boolean;

  private rwm = false;
  private lineState = 0;
  private t0Cnt = 0;
  private t1Cnt = 0;
  private curIrqPrio = -1;
  private irqActive = 0;
  private readonly irqPrio = new Uint8Array(8);
  private irqBlock = false;
  private lastOp = 0;
  private lastBit = 0;
  private instCycles = 0;

  private txData = 0;
  private txBit8 = 0;
  private txBits = 0;
  private smodDiv = 0;
  private txClk = 0;
  private rxClk = 0;
  private rxBits = 0;
  private rxQueue: number[] = [];
  private rxBit8Queue: number[] = [];

  constructor(private readonly bus: Mcs51Bus, opts: Mcs51Options = {}) {
    this.ramMask = (opts.ramSize ?? 128) === 256 ? 0xff : 0x7f;
    this.hasPd = opts.cmos ?? false;
  }

  get pc(): number {
    return this.pcReg;
  }

  reset(): void {
    this.lineState = 0;
    this.t0Cnt = 0;
    this.t1Cnt = 0;
    this.irqActive = 0;
    this.curIrqPrio = -1;
    this.irqBlock = false;
    this.lastOp = 0;
    this.lastBit = 0;
    this.rwm = false;
    this.ppc = this.pcReg;
    this.pcReg = 0;
    this.sp = 7;
    this.psw = 0;
    this.acc = 0;
    this.dptr = 0;
    this.b = 0;
    this.ip = 0;
    this.iph = 0;
    this.ie = 0;
    this.scon = 0;
    this.tcon = 0;
    this.tmod = 0;
    this.pcon = 0;
    this.th1 = 0;
    this.th0 = 0;
    this.tl1 = 0;
    this.tl0 = 0;
    this.portWrite(3, 0xff);
    this.portWrite(2, 0xff);
    this.portWrite(1, 0xff);
    this.portWrite(0, 0xff);
    this.txData = 0;
    this.txBit8 = 0;
    this.txBits = 0;
    this.smodDiv = 0;
    this.txClk = 0;
    this.rxClk = 0;
    this.rxBits = 0;
    this.rxQueue = [];
    this.rxBit8Queue = [];
    this.updateIrqPrio();
  }

  step(): number {
    if (this.irqBlock) this.irqBlock = false;
    else this.checkIrqs();

    if (this.hasPd && (this.pcon & PD)) {
      this.cycles += 1;
      return 1;
    }

    if (!(this.hasPd && (this.pcon & IDL))) {
      this.ppc = this.pcReg;
      const op = this.bus.readCode(this.pcReg) & 0xff;
      this.pcReg = (this.pcReg + 1) & 0xffff;
      this.instCycles += CYCLES[op];
      this.execute(op);
    } else {
      this.instCycles++;
    }

    const n = this.instCycles;
    this.instCycles = 0;
    this.burnCycles(n);
    return n;
  }

  serialRx(v: number, bit8 = 1): void {
    this.rxQueue.push(v & 0xff);
    this.rxBit8Queue.push(bit8 & 1);
  }

  setInput(line: 'int0' | 'int1' | 't0' | 't1', level: 0 | 1): void {
    const n = line === 'int0' ? LINE_INT0 : line === 'int1' ? LINE_INT1 : line === 't0' ? LINE_T0 : LINE_T1;
    const asserted = level === 0;
    const newState = (this.lineState & ~(1 << n)) | ((asserted ? 1 : 0) << n);
    const rising = (~this.lineState & newState) >> n & 1;
    switch (n) {
      case LINE_INT0:
        if (asserted) {
          if (this.tcon & IT0) { if (rising) this.tcon |= IE0; } else this.tcon |= IE0;
        } else if (!(this.tcon & IT0)) this.tcon &= ~IE0;
        break;
      case LINE_INT1:
        if (asserted) {
          if (this.tcon & IT1) { if (rising) this.tcon |= IE1; } else this.tcon |= IE1;
        } else if (!(this.tcon & IT1)) this.tcon &= ~IE1;
        break;
      case LINE_T0:
        if (rising && (this.tcon & TR0)) this.t0Cnt++;
        break;
      case LINE_T1:
        if (rising && (this.tcon & TR1)) this.t1Cnt++;
        break;
    }
    this.lineState = newState;
  }

  snapshot(): Mcs51State {
    return {
      pc: this.pcReg, ppc: this.ppc, acc: this.acc, psw: this.psw, b: this.b, sp: this.sp, dptr: this.dptr,
      pcon: this.pcon, tcon: this.tcon, tmod: this.tmod, scon: this.scon, sbuf: this.sbuf, ie: this.ie, ip: this.ip, iph: this.iph,
      p: Array.from(this.p), tl0: this.tl0, th0: this.th0, tl1: this.tl1, th1: this.th1,
      iram: Array.from(this.iram),
      lineState: this.lineState, t0Cnt: this.t0Cnt, t1Cnt: this.t1Cnt,
      curIrqPrio: this.curIrqPrio, irqActive: this.irqActive, irqBlock: this.irqBlock, lastOp: this.lastOp, lastBit: this.lastBit,
      txData: this.txData, txBit8: this.txBit8, txBits: this.txBits, smodDiv: this.smodDiv, txClk: this.txClk, rxClk: this.rxClk,
      rxBits: this.rxBits, rxQueue: [...this.rxQueue], rxBit8Queue: [...this.rxBit8Queue],
      cycles: this.cycles,
    };
  }

  restore(s: Mcs51State): void {
    this.pcReg = s.pc; this.ppc = s.ppc; this.acc = s.acc; this.psw = s.psw; this.b = s.b; this.sp = s.sp; this.dptr = s.dptr;
    this.pcon = s.pcon; this.tcon = s.tcon; this.tmod = s.tmod; this.scon = s.scon; this.sbuf = s.sbuf;
    this.ie = s.ie; this.ip = s.ip; this.iph = s.iph;
    this.p.set(s.p); this.tl0 = s.tl0; this.th0 = s.th0; this.tl1 = s.tl1; this.th1 = s.th1;
    this.iram.set(s.iram);
    this.lineState = s.lineState; this.t0Cnt = s.t0Cnt; this.t1Cnt = s.t1Cnt;
    this.curIrqPrio = s.curIrqPrio; this.irqActive = s.irqActive; this.irqBlock = s.irqBlock;
    this.lastOp = s.lastOp; this.lastBit = s.lastBit;
    this.txData = s.txData; this.txBit8 = s.txBit8; this.txBits = s.txBits; this.smodDiv = s.smodDiv;
    this.txClk = s.txClk; this.rxClk = s.rxClk;
    this.rxBits = s.rxBits; this.rxQueue = [...s.rxQueue]; this.rxBit8Queue = [...s.rxBit8Queue];
    this.cycles = s.cycles;
    this.updateIrqPrio();
  }

  reg(r: number): number {
    return this.iram[r | (this.psw & 0x18)];
  }

  private setReg(r: number, v: number): void {
    this.iram[r | (this.psw & 0x18)] = v & 0xff;
  }

  private iramR(a: number): number {
    return a <= this.ramMask ? this.iram[a] : 0;
  }

  private iramW(a: number, v: number): void {
    if (a <= this.ramMask) this.iram[a] = v & 0xff;
  }

  private readDirect(a: number): number {
    return a < 0x80 ? this.iram[a] : this.sfrR(a);
  }

  private writeDirect(a: number, v: number): void {
    if (a < 0x80) this.iram[a] = v & 0xff;
    else this.sfrW(a, v & 0xff);
  }

  private fetch(): number {
    const v = this.bus.readCode(this.pcReg) & 0xff;
    this.pcReg = (this.pcReg + 1) & 0xffff;
    return v;
  }

  private fetchRel(): number {
    const v = this.fetch();
    return v < 0x80 ? v : v - 0x100;
  }

  private accW(v: number): void {
    this.acc = v & 0xff;
    this.psw = (this.psw & 0xfe) | PARITY[this.acc];
  }

  private portRead(n: 0 | 1 | 2 | 3): number {
    if (this.rwm) return this.p[n];
    let v = this.p[n] & this.bus.readPort(n);
    if (n === 3) {
      if (this.lineState & (1 << LINE_INT0)) v &= ~0x04;
      if (this.lineState & (1 << LINE_INT1)) v &= ~0x08;
    }
    return v & 0xff;
  }

  private portWrite(n: 0 | 1 | 2 | 3, v: number): void {
    this.p[n] = v & 0xff;
    this.bus.writePort(n, this.p[n]);
  }

  private sfrR(a: number): number {
    switch (a) {
      case 0x80: return this.portRead(0);
      case 0x81: return this.sp;
      case 0x82: return this.dptr & 0xff;
      case 0x83: return this.dptr >> 8;
      case 0x87: return this.pcon;
      case 0x88: return this.tcon;
      case 0x89: return this.tmod;
      case 0x8a: return this.tl0;
      case 0x8b: return this.tl1;
      case 0x8c: return this.th0;
      case 0x8d: return this.th1;
      case 0x90: return this.portRead(1);
      case 0x98: return this.scon;
      case 0x99: return this.sbuf;
      case 0xa0: return this.portRead(2);
      case 0xa8: return this.ie;
      case 0xb0: return this.portRead(3);
      case 0xb8: return this.ip;
      case 0xd0: return this.psw;
      case 0xe0: return this.acc;
      case 0xf0: return this.b;
      default: return 0;
    }
  }

  private sfrW(a: number, v: number): void {
    switch (a) {
      case 0x80: this.portWrite(0, v); break;
      case 0x81: this.sp = v; break;
      case 0x82: this.dptr = (this.dptr & 0xff00) | v; break;
      case 0x83: this.dptr = (this.dptr & 0x00ff) | (v << 8); break;
      case 0x87: this.pcon = v; break;
      case 0x88: this.tcon = v; break;
      case 0x89: this.tmod = v; break;
      case 0x8a: this.tl0 = v; break;
      case 0x8b: this.tl1 = v; break;
      case 0x8c: this.th0 = v; break;
      case 0x8d: this.th1 = v; break;
      case 0x90: this.portWrite(1, v); break;
      case 0x98: this.scon = v; break;
      case 0x99: this.sbufW(v); break;
      case 0xa0: this.portWrite(2, v); break;
      case 0xa8: this.ie = v; this.irqBlock = true; break;
      case 0xb0: this.portWrite(3, v); break;
      case 0xb8: this.ip = v; this.updateIrqPrio(); this.irqBlock = true; break;
      case 0xd0: this.psw = (this.psw & 0x01) | (v & 0xfe); break;
      case 0xe0: this.accW(v); break;
      case 0xf0: this.b = v; break;
      default: break;
    }
  }

  private sbufW(v: number): void {
    this.txData = v;
    this.txBit8 = (this.scon & TB8) ? 1 : 0;
    this.txBits = FRAME_BITS[this.scon >> 6];
  }

  private bitR(addr: number): number {
    this.lastBit = addr;
    const pos = addr & 7;
    if (addr < 0x80) return (this.iram[0x20 + (addr >> 3)] >> pos) & 1;
    return (this.sfrR(addr & 0xf8) >> pos) & 1;
  }

  private bitW(addr: number, bit: number): void {
    const pos = addr & 7;
    const mask = ~(1 << pos) & 0xff;
    const b = (bit & 1) << pos;
    if (addr < 0x80) {
      const w = 0x20 + (addr >> 3);
      this.iram[w] = (this.iram[w] & mask) | b;
    } else {
      const w = addr & 0xf8;
      this.sfrW(w, (this.sfrR(w) & mask) | b);
    }
  }

  private addFlags(a: number, data: number, c: number): void {
    const result = a + data + c;
    const s = (a << 24 >> 24) + (data << 24 >> 24) + c;
    let psw = (this.psw & 0x7f) | ((result & 0x100) >> 1);
    psw = (((a & 0x0f) + (data & 0x0f) + c) & 0x10) ? psw | AC : psw & ~AC;
    psw = (s < -128 || s > 127) ? psw | OV : psw & ~OV;
    this.psw = psw;
  }

  private subFlags(a: number, data: number, c: number): void {
    const result = a - (data + c);
    const s = (a << 24 >> 24) - (((data + c) & 0xff) << 24 >> 24);
    let psw = (this.psw & 0x7f) | ((result & 0x100) >> 1);
    psw = (((a & 0x0f) - ((data & 0x0f) + c)) & 0x10) ? psw | AC : psw & ~AC;
    psw = (s < -128 || s > 127) ? psw | OV : psw & ~OV;
    this.psw = psw;
  }

  private add(data: number, c: number): void {
    const r = this.acc + data + c;
    this.addFlags(this.acc, data, c);
    this.accW(r);
  }

  private subb(data: number): void {
    const c = (this.psw & CY) ? 1 : 0;
    const r = this.acc - data - c;
    this.subFlags(this.acc, data, c);
    this.accW(r);
  }

  private setCy(v: number): void {
    this.psw = v ? this.psw | CY : this.psw & ~CY;
  }

  private pushPc(): void {
    this.sp = (this.sp + 1) & 0xff;
    this.iramW(this.sp, this.pcReg & 0xff);
    this.sp = (this.sp + 1) & 0xff;
    this.iramW(this.sp, this.pcReg >> 8);
  }

  private popPc(): void {
    let pc = this.iramR(this.sp) << 8;
    this.sp = (this.sp - 1) & 0xff;
    pc |= this.iramR(this.sp);
    this.sp = (this.sp - 1) & 0xff;
    this.pcReg = pc;
  }

  private branch(rel: number): void {
    this.pcReg = (this.pcReg + rel) & 0xffff;
  }

  private xaddrRi(r: number): number {
    return (this.reg(r) & 0xff) | (this.p[2] << 8);
  }

  private execute(op: number): void {
    this.lastOp = op;

    const lo = op & 0x0f;
    if (lo >= 0x08) { this.execReg(op >> 4, op & 7); return; }
    if (lo === 0x06 || lo === 0x07) { this.execInd(op >> 4, op & 1); return; }

    if ((op & 0x1f) === 0x01) {
      const addr = this.fetch();
      this.pcReg = (this.pcReg & 0xf800) | ((op & 0xe0) << 3) | addr;
      return;
    }
    if ((op & 0x1f) === 0x11) {
      const addr = this.fetch();
      this.pushPc();
      this.pcReg = (this.pcReg & 0xf800) | ((op & 0xe0) << 3) | addr;
      return;
    }

    switch (op) {
      case 0x00: break;
      case 0x02: { const hi = this.fetch(); const lo = this.fetch(); this.pcReg = (hi << 8) | lo; break; }
      case 0x03: this.accW((this.acc >> 1) | ((this.acc & 1) << 7)); break;
      case 0x04: this.accW(this.acc + 1); break;
      case 0x05: { this.rwm = true; const a = this.fetch(); this.writeDirect(a, this.readDirect(a) + 1); this.rwm = false; break; }

      case 0x10: {
        this.rwm = true;
        const a = this.fetch(); const rel = this.fetchRel();
        if (this.bitR(a)) { this.branch(rel); this.bitW(a, 0); }
        this.rwm = false;
        break;
      }
      case 0x12: { const hi = this.fetch(); const lo = this.fetch(); this.pushPc(); this.pcReg = (hi << 8) | lo; break; }
      case 0x13: { const c = this.acc & 1; this.accW((this.acc >> 1) | ((this.psw & CY) ? 0x80 : 0)); this.setCy(c); break; }
      case 0x14: this.accW(this.acc - 1); break;
      case 0x15: { this.rwm = true; const a = this.fetch(); this.writeDirect(a, this.readDirect(a) - 1); this.rwm = false; break; }

      case 0x20: { const a = this.fetch(); const rel = this.fetchRel(); if (this.bitR(a)) this.branch(rel); break; }
      case 0x22: this.popPc(); break;
      case 0x23: this.accW(((this.acc << 1) & 0xfe) | (this.acc >> 7)); break;
      case 0x24: this.add(this.fetch(), 0); break;
      case 0x25: this.add(this.readDirect(this.fetch()), 0); break;

      case 0x30: { const a = this.fetch(); const rel = this.fetchRel(); if (!this.bitR(a)) this.branch(rel); break; }
      case 0x32: this.popPc(); this.clearCurrentIrq(); this.irqBlock = true; break;
      case 0x33: { const c = this.acc >> 7; this.accW(((this.acc << 1) & 0xfe) | ((this.psw & CY) ? 1 : 0)); this.setCy(c); break; }
      case 0x34: this.add(this.fetch(), (this.psw & CY) ? 1 : 0); break;
      case 0x35: this.add(this.readDirect(this.fetch()), (this.psw & CY) ? 1 : 0); break;

      case 0x40: { const rel = this.fetchRel(); if (this.psw & CY) this.branch(rel); break; }
      case 0x42: { this.rwm = true; const a = this.fetch(); this.writeDirect(a, this.readDirect(a) | this.acc); this.rwm = false; break; }
      case 0x43: { this.rwm = true; const a = this.fetch(); const d = this.fetch(); this.writeDirect(a, this.readDirect(a) | d); this.rwm = false; break; }
      case 0x44: this.accW(this.acc | this.fetch()); break;
      case 0x45: this.accW(this.acc | this.readDirect(this.fetch())); break;

      case 0x50: { const rel = this.fetchRel(); if (!(this.psw & CY)) this.branch(rel); break; }
      case 0x52: { this.rwm = true; const a = this.fetch(); this.writeDirect(a, this.readDirect(a) & this.acc); this.rwm = false; break; }
      case 0x53: { this.rwm = true; const a = this.fetch(); const d = this.fetch(); this.writeDirect(a, this.readDirect(a) & d); this.rwm = false; break; }
      case 0x54: this.accW(this.acc & this.fetch()); break;
      case 0x55: this.accW(this.acc & this.readDirect(this.fetch())); break;

      case 0x60: { const rel = this.fetchRel(); if (this.acc === 0) this.branch(rel); break; }
      case 0x62: { this.rwm = true; const a = this.fetch(); this.writeDirect(a, this.readDirect(a) ^ this.acc); this.rwm = false; break; }
      case 0x63: { this.rwm = true; const a = this.fetch(); const d = this.fetch(); this.writeDirect(a, this.readDirect(a) ^ d); this.rwm = false; break; }
      case 0x64: this.accW(this.acc ^ this.fetch()); break;
      case 0x65: this.accW(this.acc ^ this.readDirect(this.fetch())); break;

      case 0x70: { const rel = this.fetchRel(); if (this.acc !== 0) this.branch(rel); break; }
      case 0x72: { const bit = this.bitR(this.fetch()); this.psw |= bit << 7; break; }
      case 0x73: this.pcReg = (this.acc + this.dptr) & 0xffff; break;
      case 0x74: this.accW(this.fetch()); break;
      case 0x75: { const a = this.fetch(); const d = this.fetch(); this.writeDirect(a, d); break; }

      case 0x80: this.branch(this.fetchRel()); break;
      case 0x82: { const bit = this.bitR(this.fetch()); this.psw &= (bit << 7) | 0x7f; break; }
      case 0x83: this.accW(this.bus.readCode((this.acc + this.pcReg) & 0xffff)); break;
      case 0x84: {
        if (this.b === 0) {
          this.psw |= OV;
        } else {
          const q = Math.floor(this.acc / this.b);
          const r = this.acc % this.b;
          this.accW(q);
          this.b = r;
          this.psw &= ~OV;
        }
        this.psw &= 0x7f;
        break;
      }
      case 0x85: { const src = this.fetch(); const dst = this.fetch(); this.writeDirect(dst, this.readDirect(src)); break; }

      case 0x90: { const hi = this.fetch(); const lo = this.fetch(); this.dptr = (hi << 8) | lo; break; }
      case 0x92: { this.rwm = true; const a = this.fetch(); this.bitW(a, (this.psw & CY) ? 1 : 0); this.rwm = false; break; }
      case 0x93: this.accW(this.bus.readCode((this.acc + this.dptr) & 0xffff)); break;
      case 0x94: this.subb(this.fetch()); break;
      case 0x95: this.subb(this.readDirect(this.fetch())); break;

      case 0xa0: { const bit = this.bitR(this.fetch()); this.psw |= ((~bit) & 1) << 7; break; }
      case 0xa2: this.setCy(this.bitR(this.fetch())); break;
      case 0xa3: this.dptr = (this.dptr + 1) & 0xffff; break;
      case 0xa4: {
        const r = this.acc * this.b;
        this.b = (r >> 8) & 0xff;
        this.accW(r & 0xff);
        this.psw = r > 0xff ? this.psw | OV : this.psw & ~OV;
        this.psw &= 0x7f;
        break;
      }
      case 0xa5: this.illegal(); break;

      case 0xb0: { const bit = this.bitR(this.fetch()); this.psw &= (((~bit) & 1) << 7) | 0x7f; break; }
      case 0xb2: { this.rwm = true; const a = this.fetch(); this.bitW(a, (~this.bitR(a)) & 1); this.rwm = false; break; }
      case 0xb3: this.psw ^= CY; break;
      case 0xb4: {
        const d = this.fetch(); const rel = this.fetchRel();
        if (this.acc !== d) this.branch(rel);
        this.setCy(this.acc < d ? 1 : 0);
        break;
      }
      case 0xb5: {
        const a = this.fetch(); const rel = this.fetchRel(); const d = this.readDirect(a);
        if (this.acc !== d) this.branch(rel);
        this.setCy(this.acc < d ? 1 : 0);
        break;
      }

      case 0xc0: { const a = this.fetch(); this.sp = (this.sp + 1) & 0xff; this.iramW(this.sp, this.readDirect(a)); break; }
      case 0xc2: { this.rwm = true; this.bitW(this.fetch(), 0); this.rwm = false; break; }
      case 0xc3: this.psw &= 0x7f; break;
      case 0xc4: this.accW(((this.acc & 0x0f) << 4) | (this.acc >> 4)); break;
      case 0xc5: { const a = this.fetch(); const d = this.readDirect(a); const old = this.acc; this.accW(d); this.writeDirect(a, old); break; }

      case 0xd0: { const a = this.fetch(); this.writeDirect(a, this.iramR(this.sp)); this.sp = (this.sp - 1) & 0xff; break; }
      case 0xd2: { this.rwm = true; this.bitW(this.fetch(), 1); this.rwm = false; break; }
      case 0xd3: this.psw |= CY; break;
      case 0xd4: {
        let n = this.acc;
        if ((this.psw & AC) || (n & 0x0f) > 0x09) n += 0x06;
        if ((this.psw & CY) || (n & 0xf0) > 0x90 || (n & ~0xff)) n += 0x60;
        this.accW(n & 0xff);
        if (n & ~0xff) this.psw |= CY;
        break;
      }
      case 0xd5: {
        this.rwm = true;
        const a = this.fetch(); const rel = this.fetchRel();
        const d = (this.readDirect(a) - 1) & 0xff;
        this.writeDirect(a, d);
        if (d !== 0) this.branch(rel);
        this.rwm = false;
        break;
      }

      case 0xe0: this.accW(this.bus.readXdata(this.dptr)); break;
      case 0xe2: case 0xe3: this.accW(this.bus.readXdata(this.xaddrRi(op & 1))); break;
      case 0xe4: this.accW(0); break;
      case 0xe5: this.accW(this.readDirect(this.fetch())); break;

      case 0xf0: this.bus.writeXdata(this.dptr, this.acc); break;
      case 0xf2: case 0xf3: this.bus.writeXdata(this.xaddrRi(op & 1), this.acc); break;
      case 0xf4: this.accW(~this.acc); break;
      case 0xf5: this.writeDirect(this.fetch(), this.acc); break;

      default: this.illegal(); break;
    }
  }

  private execReg(hi: number, r: number): void {
    switch (hi) {
      case 0x0: this.setReg(r, this.reg(r) + 1); break;
      case 0x1: this.setReg(r, this.reg(r) - 1); break;
      case 0x2: this.add(this.reg(r), 0); break;
      case 0x3: this.add(this.reg(r), (this.psw & CY) ? 1 : 0); break;
      case 0x4: this.accW(this.acc | this.reg(r)); break;
      case 0x5: this.accW(this.acc & this.reg(r)); break;
      case 0x6: this.accW(this.acc ^ this.reg(r)); break;
      case 0x7: this.setReg(r, this.fetch()); break;
      case 0x8: this.writeDirect(this.fetch(), this.reg(r)); break;
      case 0x9: this.subb(this.reg(r)); break;
      case 0xa: this.setReg(r, this.readDirect(this.fetch())); break;
      case 0xb: {
        const d = this.fetch(); const rel = this.fetchRel(); const s = this.reg(r);
        if (s !== d) this.branch(rel);
        this.setCy(s < d ? 1 : 0);
        break;
      }
      case 0xc: { const d = this.reg(r); const old = this.acc; this.accW(d); this.setReg(r, old); break; }
      case 0xd: {
        const rel = this.fetchRel();
        this.setReg(r, this.reg(r) - 1);
        if (this.reg(r) !== 0) this.branch(rel);
        break;
      }
      case 0xe: this.accW(this.reg(r)); break;
      case 0xf: this.setReg(r, this.acc); break;
    }
  }

  private execInd(hi: number, r: number): void {
    const at = this.reg(r);
    switch (hi) {
      case 0x0: this.iramW(at, this.iramR(at) + 1); break;
      case 0x1: this.iramW(at, this.iramR(at) - 1); break;
      case 0x2: this.add(this.iramR(at), 0); break;
      case 0x3: this.add(this.iramR(at), (this.psw & CY) ? 1 : 0); break;
      case 0x4: this.accW(this.acc | this.iramR(at)); break;
      case 0x5: this.accW(this.acc & this.iramR(at)); break;
      case 0x6: this.accW(this.acc ^ this.iramR(at)); break;
      case 0x7: this.iramW(at, this.fetch()); break;
      case 0x8: this.writeDirect(this.fetch(), this.iramR(this.reg(r))); break;
      case 0x9: this.subb(this.iramR(at)); break;
      case 0xa: { const a = this.fetch(); this.iramW(this.reg(r), this.readDirect(a)); break; }
      case 0xb: {
        const d = this.fetch(); const rel = this.fetchRel(); const s = this.iramR(at);
        if (s !== d) this.branch(rel);
        this.setCy(s < d ? 1 : 0);
        break;
      }
      case 0xc: { const d = this.iramR(at); const old = this.acc; this.accW(d); this.iramW(at, old); break; }
      case 0xd: {
        const acc = this.acc; const d = this.iramR(at);
        this.accW((acc & 0xf0) | (d & 0x0f));
        this.iramW(at, (d & 0xf0) | (acc & 0x0f));
        break;
      }
      case 0xe: this.accW(this.iramR(at)); break;
      case 0xf: this.iramW(at, this.acc); break;
    }
  }

  private illegal(): void {
    this.illegalCount++;
    this.lastIllegalPc = this.ppc;
  }

  private updateIrqPrio(): void {
    for (let i = 0; i < 8; i++) this.irqPrio[i] = ((this.ip >> i) & 1) | (((this.iph >> i) & 1) << 1);
  }

  private clearCurrentIrq(): void {
    if (this.curIrqPrio >= 0) this.irqActive &= ~(1 << this.curIrqPrio);
    if (this.irqActive & 4) this.curIrqPrio = 2;
    else if (this.irqActive & 2) this.curIrqPrio = 1;
    else if (this.irqActive & 1) this.curIrqPrio = 0;
    else this.curIrqPrio = -1;
  }

  private checkIrqs(): void {
    const tcon = this.tcon;
    let ints = ((tcon & IE0) ? 1 : 0) | ((tcon & TF0) ? 2 : 0) | ((tcon & IE1) ? 4 : 0) | ((tcon & TF1) ? 8 : 0)
      | ((this.scon & (RI | TI)) ? 16 : 0);
    ints &= (this.ie & EA) ? this.ie : 0;
    if (!ints) return;

    if (this.hasPd) {
      this.pcon &= ~IDL;
      if (ints & 0x05) this.pcon &= ~PD;
      if (this.pcon & PD) return;
    }

    let vec = 0;
    let prio = -1;
    for (let i = 0; i < 5; i++) {
      if ((ints & (1 << i)) && this.irqPrio[i] > prio) {
        prio = this.irqPrio[i];
        vec = (i << 3) | 3;
      }
    }

    if (this.irqActive && prio <= this.curIrqPrio) return;

    if (vec === V_IE0 && this.lastOp === 0x20 && this.lastBit === 0xb2) this.pcReg = (this.ppc + 3) & 0xffff;
    else if (vec === V_IE1 && this.lastOp === 0x20 && this.lastBit === 0xb3) this.pcReg = (this.ppc + 3) & 0xffff;

    this.pushPc();
    this.pcReg = vec;
    this.instCycles += 2;

    this.curIrqPrio = prio;
    this.irqActive |= 1 << prio;

    switch (vec) {
      case V_IE0: if (this.tcon & IT0) this.tcon &= ~IE0; break;
      case V_TF0: this.tcon &= ~TF0; break;
      case V_IE1: if (this.tcon & IT1) this.tcon &= ~IE1; break;
      case V_TF1: this.tcon &= ~TF1; break;
      default: break;
    }
  }

  private burnCycles(n: number): void {
    for (let i = 0; i < n; i++) {
      this.cycles++;
      this.updateTimerT0();
      this.updateTimerT1();
      this.updateTimerT2();
      this.serialTick(0);
    }
  }

  private gated(gateBit: number, line: number): boolean {
    return (this.tmod & gateBit) !== 0 && (this.lineState & (1 << line)) !== 0;
  }

  private updateTimerT0(): void {
    const mode = this.tmod & 3;
    if (this.tcon & TR0) {
      let delta = (this.tmod & CT0) ? this.t0Cnt : 1;
      this.t0Cnt = 0;
      if (this.gated(GATE0, LINE_INT0)) delta = 0;
      if (delta) {
        switch (mode) {
          case 0: {
            const count = ((this.th0 << 5) | (this.tl0 & 0x1f)) + delta;
            if (count & 0xffffe000) this.tcon |= TF0;
            this.th0 = (count >> 5) & 0xff;
            this.tl0 = count & 0x1f;
            break;
          }
          case 1: {
            const count = ((this.th0 << 8) | this.tl0) + delta;
            if (count & 0xffff0000) this.tcon |= TF0;
            this.th0 = (count >> 8) & 0xff;
            this.tl0 = count & 0xff;
            break;
          }
          case 2: {
            let count = this.tl0 + delta;
            if (count & 0xffffff00) { this.tcon |= TF0; count += this.th0; }
            this.tl0 = count & 0xff;
            break;
          }
          case 3: {
            const count = this.tl0 + delta;
            if (count & 0xffffff00) this.tcon |= TF0;
            this.tl0 = count & 0xff;
            break;
          }
        }
      }
    }
    if ((this.tcon & TR1) && mode === 3) {
      const count = this.th0 + 1;
      if (count & 0xffffff00) this.tcon |= TF1;
      this.th0 = count & 0xff;
    }
  }

  private updateTimerT1(): void {
    const mode = (this.tmod >> 4) & 3;
    const mode0 = this.tmod & 3;
    let delta: number;
    if (mode0 !== 3) {
      if (!(this.tcon & TR1)) return;
      delta = (this.tmod & CT1) ? this.t1Cnt : 1;
      this.t1Cnt = 0;
      if (this.gated(GATE1, LINE_INT1)) delta = 0;
    } else {
      delta = 1;
      this.t1Cnt = 0;
    }
    if (!delta) return;
    let overflow = 0;
    switch (mode) {
      case 0: {
        const count = ((this.th1 << 5) | (this.tl1 & 0x1f)) + delta;
        overflow = count & 0xffffe000;
        this.th1 = (count >> 5) & 0xff;
        this.tl1 = count & 0x1f;
        break;
      }
      case 1: {
        const count = ((this.th1 << 8) | this.tl1) + delta;
        overflow = count & 0xffff0000;
        this.th1 = (count >> 8) & 0xff;
        this.tl1 = count & 0xff;
        break;
      }
      case 2: {
        let count = this.tl1 + delta;
        overflow = count & 0xffffff00;
        if (overflow) count += this.th1;
        this.tl1 = count & 0xff;
        break;
      }
      case 3: break;
    }
    if (overflow) {
      if (mode0 !== 3) this.tcon |= TF1;
      this.serialTick(1);
    }
  }

  private updateTimerT2(): void {}

  private serialTick(source: 0 | 1): void {
    const mode = this.scon >> 6;
    if (source === 1) this.smodDiv = (this.smodDiv + 1) & ((this.pcon & SMOD) ? 0 : 1);

    switch (mode) {
      case 0:
        if (source === 0) { this.txClk += 16; this.rxClk += 16; }
        break;
      case 1: case 3:
        if (source === 1 && this.smodDiv === 0) { this.txClk++; this.rxClk++; }
        break;
      case 2: {
        if (source === 0) { const k = (this.pcon & SMOD) ? 6 : 3; this.txClk += k; this.rxClk += k; }
        break;
      }
    }

    if (this.rxBits === 0 && this.rxQueue.length !== 0 && mode !== 0) {
      this.rxBits = FRAME_BITS[mode];
      this.rxClk = 0;
    }

    if (this.txClk >= 16) {
      this.txClk &= 0x0f;
      if (this.txBits !== 0 && --this.txBits === 0) {
        this.scon |= TI;
        this.bus.serialTx?.(this.txData, this.txBit8);
      }
    }

    if (this.rxClk >= 16) {
      this.rxClk &= 0x0f;
      if (this.rxBits !== 0 && --this.rxBits === 0) this.rxComplete(mode);
    }
  }

  private rxComplete(mode: number): void {
    const data = this.rxQueue.shift()!;
    const bit8 = this.rxBit8Queue.shift()!;
    if (!(this.scon & REN)) return;
    if (this.scon & RI) { this.rxOverruns++; return; }
    this.sbuf = data;
    if (mode === 1) {
      if (!(this.scon & SM2)) this.scon |= RB8;
      this.scon |= RI;
    } else {
      this.scon = bit8 ? this.scon | RB8 : this.scon & ~RB8;
      if (!(this.scon & SM2) || (this.scon & RB8)) this.scon |= RI;
    }
  }
}
