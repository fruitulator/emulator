import type { Bus } from './bus';
import { Z80, SZ53P, sext8, type Z80Io, type Z80Hooks } from './z80';

const CF = 0x01;
const NF = 0x02;
const HF = 0x10;
const ZF = 0x40;

export const CC_OP = Uint8Array.from([
  3, 9, 7, 4, 4, 4, 6, 3, 4, 7, 6, 4, 4, 4, 6, 3,
  7, 9, 7, 4, 4, 4, 6, 3, 8, 7, 6, 4, 4, 4, 6, 3,
  6, 9,16, 4, 4, 4, 6, 4, 6, 7,15, 4, 4, 4, 6, 3,
  6, 9,13, 4,10,10, 9, 3, 6, 7,12, 4, 4, 4, 6, 3,
  4, 4, 4, 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 6, 4,
  4, 4, 4, 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 6, 4,
  4, 4, 4, 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 6, 4,
  7, 7, 7, 7, 7, 7, 3, 7, 4, 4, 4, 4, 4, 4, 6, 4,
  4, 4, 4, 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 6, 4,
  4, 4, 4, 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 6, 4,
  4, 4, 4, 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 6, 4,
  4, 4, 4, 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 6, 4,
  5, 9, 6, 9, 6,11, 6,11, 5, 9, 6, 0, 6,16, 6,11,
  5, 9, 6,10, 6,11, 6,11, 5, 3, 6, 9, 6, 0, 6,11,
  5, 9, 6,16, 6,11, 6,11, 5, 3, 6, 3, 6, 0, 6,11,
  5, 9, 6, 3, 6,11, 6,11, 5, 4, 6, 3, 6, 0, 6,11,
]);

export const CC_CB = Uint8Array.from([
  7, 7, 7, 7, 7, 7,13, 7, 7, 7, 7, 7, 7, 7,13, 7,
  7, 7, 7, 7, 7, 7,13, 7, 7, 7, 7, 7, 7, 7,13, 7,
  7, 7, 7, 7, 7, 7,13, 7, 7, 7, 7, 7, 7, 7,13, 7,
  7, 7, 7, 7, 7, 7,13, 7, 7, 7, 7, 7, 7, 7,13, 7,
  6, 6, 6, 6, 6, 6, 9, 6, 6, 6, 6, 6, 6, 6, 9, 6,
  6, 6, 6, 6, 6, 6, 9, 6, 6, 6, 6, 6, 6, 6, 9, 6,
  6, 6, 6, 6, 6, 6, 9, 6, 6, 6, 6, 6, 6, 6, 9, 6,
  6, 6, 6, 6, 6, 6, 9, 6, 6, 6, 6, 6, 6, 6, 9, 6,
  7, 7, 7, 7, 7, 7,13, 7, 7, 7, 7, 7, 7, 7,13, 7,
  7, 7, 7, 7, 7, 7,13, 7, 7, 7, 7, 7, 7, 7,13, 7,
  7, 7, 7, 7, 7, 7,13, 7, 7, 7, 7, 7, 7, 7,13, 7,
  7, 7, 7, 7, 7, 7,13, 7, 7, 7, 7, 7, 7, 7,13, 7,
  7, 7, 7, 7, 7, 7,13, 7, 7, 7, 7, 7, 7, 7,13, 7,
  7, 7, 7, 7, 7, 7,13, 7, 7, 7, 7, 7, 7, 7,13, 7,
  7, 7, 7, 7, 7, 7,13, 7, 7, 7, 7, 7, 7, 7,13, 7,
  7, 7, 7, 7, 7, 7,13, 7, 7, 7, 7, 7, 7, 7,13, 7,
]);

export const CC_ED = Uint8Array.from([
 12,13, 6, 6, 9, 6, 6, 6,12,13, 6, 6, 9, 6, 6, 6,
 12,13, 6, 6, 9, 6, 6, 6,12,13, 6, 6, 9, 6, 6, 6,
 12,13, 6, 6, 9, 6, 6, 6,12,13, 6, 6,10, 6, 6, 6,
 12,13, 6, 6, 9, 6, 6, 6,12,13, 6, 6, 9, 6, 6, 6,
  9,10,10,19, 6,12, 6, 6, 9,10,10,18,17,12, 6, 6,
  9,10,10,19, 6,12, 6, 6, 9,10,10,18,17,12, 6, 6,
  9,10,10,19, 6,12, 6,16, 9,10,10,18,17,12, 6,16,
  9,10,10,19,12,12, 8, 6, 9,10,10,18,17,12, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
 12,12,12,12, 6, 6, 6, 6,12,12,12,12, 6, 6, 6, 6,
 12,12,12,12, 6, 6, 6, 6,12,12,12,12, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
]);

export const CC_XY = Uint8Array.from([
  4, 4, 4, 4, 4, 4, 4, 4, 4,10, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4,10, 4, 4, 4, 4, 4, 4,
  4,12,19, 7, 9, 9,15, 4, 4,10,18, 7, 9, 9, 9, 4,
  4, 4, 4, 4,18,18,15, 4, 4,10, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 9, 9,14, 4, 4, 4, 4, 4, 9, 9,14, 4,
  4, 4, 4, 4, 9, 9,14, 4, 4, 4, 4, 4, 9, 9,14, 4,
  9, 9, 9, 9, 9, 9,14, 9, 9, 9, 9, 9, 9, 9,14, 9,
 15,15,15,15,15,15, 4,15, 4, 4, 4, 4, 9, 9,14, 4,
  4, 4, 4, 4, 9, 9,14, 4, 4, 4, 4, 4, 9, 9,14, 4,
  4, 4, 4, 4, 9, 9,14, 4, 4, 4, 4, 4, 9, 9,14, 4,
  4, 4, 4, 4, 9, 9,14, 4, 4, 4, 4, 4, 9, 9,14, 4,
  4, 4, 4, 4, 9, 9,14, 4, 4, 4, 4, 4, 9, 9,14, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  4,12, 4,19, 4,14, 4, 4, 4, 6, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4,
]);

export const CC_XYCB = Uint8Array.from({ length: 256 }, (_, i) => (i >> 6 === 1 ? 15 : 19));

export const CC_EX = Uint8Array.from([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0,
  2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,10, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,10, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,10, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,10, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  4, 4, 4, 4, 0, 0, 0, 0, 4, 4, 4, 4, 0, 0, 0, 0,
  5, 0, 3, 0,10, 0, 0, 2, 5, 0, 3, 0,10, 0, 0, 2,
  5, 0, 3, 0,10, 0, 0, 2, 5, 0, 3, 0,10, 0, 0, 2,
  5, 0, 3, 0,10, 0, 0, 2, 5, 0, 3, 0,10, 0, 0, 2,
  5, 0, 3, 0,10, 0, 0, 2, 5, 0, 3, 0,10, 0, 0, 2,
]);

export const enum Z180Int {
  TRAP = 0, NMI = 1, INT0 = 2, INT1 = 3, INT2 = 4, PRT0 = 5, PRT1 = 6,
  DMA0 = 7, DMA1 = 8, CSIO = 9, ASCI0 = 10, ASCI1 = 11,
}

export interface Z180Hooks extends Z80Hooks {
  asciTx?(ch: number, byte: number): void;
}

class MmuBus implements Bus {
  readonly map = new Int32Array(16);
  accesses = 0;
  constructor(readonly phys: Bus) {
    for (let p = 0; p < 16; p++) this.map[p] = p << 12;
  }
  read8(a: number): number {
    this.accesses++;
    return this.phys.read8(this.map[(a >> 12) & 15] | (a & 0xfff));
  }
  write8(a: number, v: number): void {
    this.accesses++;
    this.phys.write8(this.map[(a >> 12) & 15] | (a & 0xfff), v);
  }
}

class IoGate implements Z80Io {
  cpu!: Z180;
  in(p: number): number { return this.cpu.ioRead(p); }
  out(p: number, v: number): void { this.cpu.ioWrite(p, v); }
}

const CNTLA_RE = 0x40;
const CNTLA_TE = 0x20;
const CNTLA_RTS0 = 0x10;
const CNTLA_EFR = 0x08;
const CNTLB_PS = 0x20;
const CNTLB_DR = 0x08;
const STAT_RDRF = 0x80;
const STAT_OVRN = 0x40;
const STAT_PE = 0x20;
const STAT_FE = 0x10;
const STAT_RIE = 0x08;
const STAT_DCD0 = 0x04;
const STAT_TDRE = 0x02;
const STAT_TIE = 0x01;
const STAT1_CTS1E = 0x04;
const ASCI_BITS = [8, 9, 9, 10, 9, 10, 10, 11];

export class Z180Asci {
  cntla = 0;
  cntlb = 7;
  stat = STAT_TDRE;
  tdr = 0;
  rdr = 0;
  charCycles = 0;
  private txPending = false;
  private txActive = false;
  private txShift = 0;
  private txTimer = 0;
  private readonly rxQueue: number[] = [];
  private rxTimer = 0;
  onTx: ((byte: number) => void) | null = null;

  constructor(readonly id: number) {
    this.recompute();
  }

  reset(): void {
    this.cntla = 0;
    this.cntlb = (this.cntlb & (this.id === 0 ? 0xa0 : 0x80)) | 0x07;
    this.stat = (this.id === 0 ? this.stat & STAT_DCD0 : 0) | STAT_TDRE;
    this.txPending = this.txActive = false;
    this.txTimer = 0;
    this.rxQueue.length = 0;
    this.rxTimer = 0;
    this.recompute();
  }

  private recompute(): void {
    const ss = this.cntlb & 7;
    if (ss === 7) { this.charCycles = 0; return; }
    const div = ((this.cntlb & CNTLB_PS) ? 30 : 10) * ((this.cntlb & CNTLB_DR) ? 64 : 16);
    this.charCycles = (div << ss) * ASCI_BITS[this.cntla & 7];
  }

  writeCntla(v: number): void {
    this.cntla = v & ~(CNTLA_EFR | CNTLA_RTS0) & 0xff;
    if (v & CNTLA_EFR) this.stat &= ~(STAT_OVRN | STAT_PE | STAT_FE);
    this.recompute();
  }
  writeCntlb(v: number): void { this.cntlb = v & 0xff; this.recompute(); }
  writeStat(v: number): void {
    const mask = STAT_RIE | STAT_TIE | (this.id ? STAT1_CTS1E : 0);
    this.stat = (this.stat & ~mask) | (v & mask);
  }
  writeTdr(v: number): void {
    this.tdr = v & 0xff;
    this.stat &= ~STAT_TDRE;
    this.txPending = true;
  }
  readRdr(): number {
    this.stat &= ~STAT_RDRF;
    return this.rdr;
  }

  receive(b: number): void {
    this.rxQueue.push(b & 0xff);
    if (this.rxTimer <= 0) this.rxTimer = this.charCycles || 1;
  }

  get irq(): boolean {
    const s = this.stat;
    return ((s & STAT_RIE) !== 0 && (s & (STAT_RDRF | STAT_OVRN | STAT_PE | STAT_FE)) !== 0) ||
      ((s & STAT_TIE) !== 0 && (s & STAT_TDRE) !== 0);
  }

  tick(c: number): void {
    if (this.txActive) {
      this.txTimer -= c;
      if (this.txTimer <= 0) {
        this.txActive = false;
        this.onTx?.(this.txShift);
      }
    }
    if (!this.txActive && this.txPending && (this.cntla & CNTLA_TE)) {
      this.txPending = false;
      this.txShift = this.tdr;
      this.txActive = true;
      this.txTimer = this.charCycles || 1;
      this.stat |= STAT_TDRE;
    }
    if (this.rxQueue.length) {
      this.rxTimer -= c;
      if (this.rxTimer <= 0) {
        const b = this.rxQueue.shift()!;
        if (this.cntla & CNTLA_RE) {
          if (this.stat & STAT_RDRF) this.stat |= STAT_OVRN;
          else { this.rdr = b; this.stat |= STAT_RDRF; }
        }
        this.rxTimer = this.rxQueue.length ? this.charCycles || 1 : 0;
      }
    }
  }
}

const CNTR_EF = 0x80;
const CNTR_EIE = 0x40;
const CNTR_RE = 0x20;
const CNTR_TE = 0x10;

export class Z180Csio {
  cntr = 0x07;
  trdr = 0;
  private timer = 0;
  reset(): void { this.cntr = 0x07; this.timer = 0; }
  readCntr(): number { return this.cntr & 0xf7; }
  writeCntr(v: number): void {
    if (v & (CNTR_RE | CNTR_TE)) {
      if (!(this.cntr & (CNTR_RE | CNTR_TE)) && (v & 7) !== 7) this.timer = 8 * (20 << (v & 7));
    } else this.timer = 0;
    this.cntr = (this.cntr & CNTR_EF) | (v & ~CNTR_EF & 0xf7);
  }
  readTrdr(): number { this.cntr &= ~CNTR_EF; return this.trdr; }
  writeTrdr(v: number): void { this.cntr &= ~CNTR_EF; this.trdr = v & 0xff; }
  get irq(): boolean { return (this.cntr & (CNTR_EF | CNTR_EIE)) === (CNTR_EF | CNTR_EIE); }
  tick(c: number): void {
    if (this.timer <= 0) return;
    this.timer -= c;
    if (this.timer > 0) return;
    this.timer = 0;
    if (this.cntr & CNTR_RE) this.trdr = 0xff;
    this.cntr = CNTR_EF | (this.cntr & ~(CNTR_RE | CNTR_TE));
  }
}

const TCR_TIF1 = 0x80;
const TCR_TIF0 = 0x40;
const TCR_TIE1 = 0x20;
const TCR_TIE0 = 0x10;
const TCR_TDE1 = 0x02;
const TCR_TDE0 = 0x01;
const DSTAT_DE1 = 0x80;
const DSTAT_DE0 = 0x40;
const DSTAT_DWE1 = 0x20;
const DSTAT_DWE0 = 0x10;
const DSTAT_DIE0 = 0x04;
const DSTAT_DME = 0x01;
const DSTAT_MASK = 0xfd;
const DMODE_MMOD = 0x02;
const DMODE_MASK = 0x3e;
const ITC_ITE0 = 0x01;
const ITC_ITE1 = 0x02;
const ITC_ITE2 = 0x04;
const ITC_MASK = 0xc7;
const ITC_UFO = 0x40;

export class Z180 extends Z80 {
  readonly asci = [new Z180Asci(0), new Z180Asci(1)];
  readonly csio = new Z180Csio();
  waitStates = false;

  readonly tmdr = [0xffff, 0xffff];
  readonly rldr = [0xffff, 0xffff];
  tcr = 0;
  private readonly readTcrTmdr = [0, 0];
  private tmdrLatch = 0;
  private readonly tmdrh = [0, 0];
  frc = 0xff;
  private frcPrescale = 0;

  sar0 = 0;
  dar0 = 0;
  readonly bcr = [0, 0];
  mar1 = 0;
  iar1 = 0;
  dstat = DSTAT_DWE1 | DSTAT_DWE0;
  dmode = 0;
  dcntl = 0xf0;

  il = 0;
  itc = ITC_ITE0;
  rcr = 0xc0;
  cbr = 0;
  bbr = 0;
  cbar = 0xf0;
  omcr = 0xe0;
  icr = 0;

  private readonly irqLines = [false, false, false];
  readonly pending = new Uint8Array(12);

  private readonly mbus: MmuBus;
  private readonly ext: Z80Io;
  private ioAccesses = 0;
  private ccTable: Uint8Array = CC_OP;
  private ccIndex = 0;
  private ccExtra = 0;

  constructor(phys: Bus, io: Z80Io, hooks: Z180Hooks = {}) {
    super(new MmuBus(phys), new IoGate(), hooks);
    this.mbus = this.bus as MmuBus;
    (this.io as IoGate).cpu = this;
    this.ext = io;
    this.asci[0].onTx = (b) => (this.hooks as Z180Hooks).asciTx?.(0, b);
    this.asci[1].onTx = (b) => (this.hooks as Z180Hooks).asciTx?.(1, b);
    this.resetInternal();
  }

  translate(addr: number): number {
    return this.mbus.map[(addr >> 12) & 15] | (addr & 0xfff);
  }

  override reset(): void {
    super.reset();
    this.a = this.b = this.c = this.d = this.e = this.h = this.l = 0;
    this.f = ZF;
    this.sp = 0;
    this.ix = this.iy = 0xffff;
    this.af2 = this.bc2 = this.de2 = this.hl2 = 0;
    this.resetInternal();
  }

  private resetInternal(): void {
    this.tmdrLatch = 0;
    this.readTcrTmdr[0] = this.readTcrTmdr[1] = 0;
    this.tmdrh[0] = this.tmdrh[1] = 0;
    this.tmdr[0] = this.tmdr[1] = 0xffff;
    this.irqLines.fill(false);
    this.pending.fill(0);
    this.frc = 0xff;
    this.frcPrescale = 0;
    this.tcr = 0;
    this.iar1 &= 0xffff;
    this.dstat = DSTAT_DWE1 | DSTAT_DWE0;
    this.dmode = 0;
    this.dcntl = 0xf0;
    this.il = 0;
    this.itc = ITC_ITE0;
    this.rcr = 0xc0;
    this.cbr = 0;
    this.bbr = 0;
    this.cbar = 0xf0;
    this.omcr = 0xe0;
    this.icr = 0;
    this.asci[0].reset();
    this.asci[1].reset();
    this.csio.reset();
    this.updateMmu();
  }

  private updateMmu(): void {
    const ba = this.cbar & 15;
    const ca = this.cbar >> 4;
    for (let p = 0; p < 16; p++) {
      let a = p << 12;
      if (p >= ba) a += (p >= ca ? this.cbr : this.bbr) << 12;
      this.mbus.map[p] = a & 0xfffff;
    }
  }

  override setIRQ(active: boolean): void { this.irqLines[0] = active; }

  setIrqLine(n: number, active: boolean): void { this.irqLines[n] = active; }

  ioRead(port: number): number {
    if (((port ^ this.icr) & 0xffc0) === 0) return this.internalRead(port & 0x3f);
    this.ioAccesses++;
    return this.ext.in(port) & 0xff;
  }

  ioWrite(port: number, v: number): void {
    if (((port ^ this.icr) & 0xffc0) === 0) { this.internalWrite(port & 0x3f, v & 0xff); return; }
    this.ioAccesses++;
    this.ext.out(port, v & 0xff);
  }

  internalRead(port: number): number {
    switch (port) {
      case 0x00: case 0x01: return this.asci[port & 1].cntla;
      case 0x02: case 0x03: return this.asci[port & 1].cntlb & 0xdf;
      case 0x04: case 0x05: return this.asci[port & 1].stat;
      case 0x06: case 0x07: return this.asci[port & 1].tdr;
      case 0x08: case 0x09: return this.asci[port & 1].readRdr();
      case 0x0a: return this.csio.readCntr();
      case 0x0b: return this.csio.readTrdr();
      case 0x0c: case 0x14: {
        const t = port === 0x0c ? 0 : 1;
        const data = this.tmdr[t] & 0xff;
        if ((this.tcr & (t ? TCR_TDE1 : TCR_TDE0)) === 0) {
          this.tmdrLatch |= 1 << t;
          this.tmdrh[t] = this.tmdr[t] >> 8;
        }
        this.tcrTmdrRead(t);
        return data;
      }
      case 0x0d: case 0x15: {
        const t = port === 0x0d ? 0 : 1;
        let data: number;
        if (this.tmdrLatch & (1 << t)) { this.tmdrLatch &= ~(1 << t); data = this.tmdrh[t]; }
        else data = this.tmdr[t] >> 8;
        this.tcrTmdrRead(t);
        return data;
      }
      case 0x0e: return this.rldr[0] & 0xff;
      case 0x0f: return this.rldr[0] >> 8;
      case 0x16: return this.rldr[1] & 0xff;
      case 0x17: return this.rldr[1] >> 8;
      case 0x10: {
        const data = this.tcr;
        this.tcrTmdrRead(0);
        this.tcrTmdrRead(1);
        return data;
      }
      case 0x18: return this.frc;
      case 0x20: return this.sar0 & 0xff;
      case 0x21: return (this.sar0 >> 8) & 0xff;
      case 0x22: return (this.sar0 >> 16) & 0x0f;
      case 0x23: return this.dar0 & 0xff;
      case 0x24: return (this.dar0 >> 8) & 0xff;
      case 0x25: return (this.dar0 >> 16) & 0x0f;
      case 0x26: return this.bcr[0] & 0xff;
      case 0x27: return this.bcr[0] >> 8;
      case 0x28: return this.mar1 & 0xff;
      case 0x29: return (this.mar1 >> 8) & 0xff;
      case 0x2a: return (this.mar1 >> 16) & 0x0f;
      case 0x2b: return this.iar1 & 0xff;
      case 0x2c: return (this.iar1 >> 8) & 0xff;
      case 0x2d: return (this.iar1 >> 16) & 0xcf;
      case 0x2e: return this.bcr[1] & 0xff;
      case 0x2f: return this.bcr[1] >> 8;
      case 0x30: return (this.dstat | ~DSTAT_MASK) & 0xff;
      case 0x31: return (this.dmode | ~DMODE_MASK) & 0xff;
      case 0x32: return this.dcntl;
      case 0x33: return this.il & 0xe0;
      case 0x34: return (this.itc | ~ITC_MASK) & 0xff;
      case 0x36: return (this.rcr | ~0xc3) & 0xff;
      case 0x38: return this.cbr;
      case 0x39: return this.bbr;
      case 0x3a: return this.cbar;
      case 0x3e: return (this.omcr | 0x40 | ~0xe0) & 0xff;
      case 0x3f: return (this.icr | ~0xe0) & 0xff;
      default: return 0xff;
    }
  }

  private tcrTmdrRead(t: number): void {
    if (this.readTcrTmdr[t]) {
      this.tcr &= t ? ~TCR_TIF1 : ~TCR_TIF0;
      this.readTcrTmdr[t] = 0;
    } else this.readTcrTmdr[t] = 1;
  }

  internalWrite(port: number, v: number): void {
    switch (port) {
      case 0x00: case 0x01: this.asci[port & 1].writeCntla(v); return;
      case 0x02: case 0x03: this.asci[port & 1].writeCntlb(v); return;
      case 0x04: case 0x05: this.asci[port & 1].writeStat(v); return;
      case 0x06: case 0x07: this.asci[port & 1].writeTdr(v); return;
      case 0x08: case 0x09: { const a = this.asci[port & 1]; if (!(a.stat & STAT_RDRF)) a.receive(v); return; }
      case 0x0a: this.csio.writeCntr(v); return;
      case 0x0b: this.csio.writeTrdr(v); return;
      case 0x0c: this.tmdr[0] = (this.tmdr[0] & 0xff00) | v; return;
      case 0x0d: this.tmdr[0] = (this.tmdr[0] & 0x00ff) | (v << 8); return;
      case 0x0e: this.rldr[0] = (this.rldr[0] & 0xff00) | v; return;
      case 0x0f: this.rldr[0] = (this.rldr[0] & 0x00ff) | (v << 8); return;
      case 0x14: this.tmdr[1] = (this.tmdr[1] & 0xff00) | v; return;
      case 0x15: this.tmdr[1] = (this.tmdr[1] & 0x00ff) | (v << 8); return;
      case 0x16: this.rldr[1] = (this.rldr[1] & 0xff00) | v; return;
      case 0x17: this.rldr[1] = (this.rldr[1] & 0x00ff) | (v << 8); return;
      case 0x10: {
        const old = this.tcr;
        this.tcr = (this.tcr & (TCR_TIF1 | TCR_TIF0)) | (v & ~(TCR_TIF1 | TCR_TIF0));
        if (!(old & TCR_TDE0) && (this.tcr & TCR_TDE0)) this.tmdr[0] = this.rldr[0];
        if (!(old & TCR_TDE1) && (this.tcr & TCR_TDE1)) this.tmdr[1] = this.rldr[1];
        return;
      }
      case 0x20: this.sar0 = (this.sar0 & 0xfff00) | v; return;
      case 0x21: this.sar0 = (this.sar0 & 0xf00ff) | (v << 8); return;
      case 0x22: this.sar0 = (this.sar0 & 0x0ffff) | ((v & 0x0f) << 16); return;
      case 0x23: this.dar0 = (this.dar0 & 0xfff00) | v; return;
      case 0x24: this.dar0 = (this.dar0 & 0xf00ff) | (v << 8); return;
      case 0x25: this.dar0 = (this.dar0 & 0x0ffff) | ((v & 0x0f) << 16); return;
      case 0x26: this.bcr[0] = (this.bcr[0] & 0xff00) | v; return;
      case 0x27: this.bcr[0] = (this.bcr[0] & 0x00ff) | (v << 8); return;
      case 0x28: this.mar1 = (this.mar1 & 0xfff00) | v; return;
      case 0x29: this.mar1 = (this.mar1 & 0xf00ff) | (v << 8); return;
      case 0x2a: this.mar1 = (this.mar1 & 0x0ffff) | ((v & 0x0f) << 16); return;
      case 0x2b: this.iar1 = (this.iar1 & 0xcfff00) | v; return;
      case 0x2c: this.iar1 = (this.iar1 & 0xcf00ff) | (v << 8); return;
      case 0x2d: this.iar1 = (this.iar1 & 0x00ffff) | ((v & 0xcf) << 16); return;
      case 0x2e: this.bcr[1] = (this.bcr[1] & 0xff00) | v; return;
      case 0x2f: this.bcr[1] = (this.bcr[1] & 0x00ff) | (v << 8); return;
      case 0x30:
        this.dstat = (this.dstat & DSTAT_DME) | (v & DSTAT_MASK & ~DSTAT_DME);
        if ((v & (DSTAT_DE1 | DSTAT_DWE1)) === DSTAT_DE1) this.dstat |= DSTAT_DME;
        if ((v & (DSTAT_DE0 | DSTAT_DWE0)) === DSTAT_DE0) this.dstat |= DSTAT_DME;
        return;
      case 0x31: this.dmode = v & DMODE_MASK; return;
      case 0x32: this.dcntl = v; return;
      case 0x33: this.il = v & 0xe0; return;
      case 0x34: this.itc = (this.itc & ITC_UFO) | (v & ITC_MASK & ~ITC_UFO); return;
      case 0x36: this.rcr = v & 0xc3; return;
      case 0x38: this.cbr = v; this.updateMmu(); return;
      case 0x39: this.bbr = v; this.updateMmu(); return;
      case 0x3a: this.cbar = v; this.updateMmu(); return;
      case 0x3e: this.omcr = v & 0xe0; return;
      case 0x3f: this.icr = v & 0xe0; return;
      default: return;
    }
  }

  private tickIo(c: number): void {
    this.frcPrescale += c;
    while (this.frcPrescale >= 10) {
      this.frcPrescale -= 10;
      this.frc = (this.frc - 1) & 0xff;
      if ((this.frc & 1) === 0) this.clockTimers();
    }
    this.asci[0].tick(c);
    this.asci[1].tick(c);
    this.csio.tick(c);
  }

  private clockTimers(): void {
    if (this.tcr & TCR_TDE0) {
      if (this.tmdr[0] === 0) { this.tmdr[0] = this.rldr[0]; this.tcr |= TCR_TIF0; }
      else this.tmdr[0]--;
    }
    if (this.tcr & TCR_TDE1) {
      if (this.tmdr[1] === 0) { this.tmdr[1] = this.rldr[1]; this.tcr |= TCR_TIF1; }
      else this.tmdr[1]--;
    }
    if (this.iff1 && !this.afterEI) {
      if ((this.tcr & (TCR_TIE0 | TCR_TIF0)) === (TCR_TIE0 | TCR_TIF0)) this.pending[Z180Int.PRT0] = 1;
      if ((this.tcr & (TCR_TIE1 | TCR_TIF1)) === (TCR_TIE1 | TCR_TIF1)) this.pending[Z180Int.PRT1] = 1;
    }
  }

  override step(): number {
    const start = this.cycles;
    let used = 0;
    if (this.nmiPending) {
      this.halted = false;
      this.dstat &= ~DSTAT_DME;
      this.iff2 = this.iff1;
      this.iff1 = false;
      this.push(this.pc);
      this.pc = 0x0066;
      this.nmiPending = false;
      used += 11;
      this.tickIo(11);
    }
    const ic = this.checkInterrupts();
    if (ic) { used += ic; this.tickIo(ic); }
    this.afterEI = false;
    this.afterLdAir = false;
    let c: number;
    if (this.halted) {
      c = 3;
    } else {
      this.mbus.accesses = 0;
      this.ioAccesses = 0;
      this.ccExtra = 0;
      this.flagsWritten = false;
      const op = this.fetchOp();
      this.execMain(op, 0);
      this.q = this.flagsWritten ? this.f : 0;
      c = this.ccTable[this.ccIndex] + this.ccExtra;
      if (this.waitStates) {
        const iw = this.dcntl & 0x30;
        c += this.mbus.accesses * ((this.dcntl & 0xc0) >> 6) + this.ioAccesses * (iw ? (iw >> 4) + 1 : 0);
      }
    }
    used += c;
    this.tickIo(c);
    if (this.dstat & DSTAT_DME) {
      const d = this.dma0(6) + this.dma1();
      if (d) { used += d; this.tickIo(d); }
    }
    this.cycles = start + used;
    return used;
  }

  private checkInterrupts(): number {
    if (!this.iff1 || this.afterEI) return 0;
    const p = this.pending;
    if (this.irqLines[0] && (this.itc & ITC_ITE0)) p[Z180Int.INT0] = 1;
    if (this.irqLines[1] && (this.itc & ITC_ITE1)) p[Z180Int.INT1] = 1;
    if (this.irqLines[2] && (this.itc & ITC_ITE2)) p[Z180Int.INT2] = 1;
    p[Z180Int.CSIO] = this.csio.irq ? 1 : 0;
    p[Z180Int.ASCI0] = this.asci[0].irq ? 1 : 0;
    p[Z180Int.ASCI1] = this.asci[1].irq ? 1 : 0;
    for (let i = 0; i < 12; i++) {
      if (p[i]) {
        p[i] = 0;
        return this.takeInterrupt(i);
      }
    }
    return 0;
  }

  private takeInterrupt(irq: number): number {
    this.halted = false;
    this.iff1 = this.iff2 = false;
    if (irq === Z180Int.INT0) {
      const vec = this.hooks.irqAck ? this.hooks.irqAck() : 0xff;
      if (this.im === 2) {
        this.push(this.pc);
        const at = ((this.i << 8) | (vec & 0xff)) & 0xffff;
        this.pc = this.rd(at) | (this.rd((at + 1) & 0xffff) << 8);
        return CC_OP[0xcd];
      }
      if (this.im === 1) {
        this.push(this.pc);
        this.pc = 0x0038;
        return CC_OP[0xff] - CC_EX[0xff];
      }
      switch (vec & 0xff0000) {
        case 0xcd0000:
          this.push(this.pc);
          this.pc = vec & 0xffff;
          return CC_OP[0xcd] - CC_EX[0xff];
        case 0xc30000:
          this.pc = vec & 0xffff;
          return CC_OP[0xc3] - CC_EX[0xff];
        default:
          this.push(this.pc);
          this.pc = vec & 0x0038;
          return CC_OP[this.pc] - CC_EX[this.pc];
      }
    }
    const at = ((this.i << 8) | (((this.il & 0xe0) + (irq - Z180Int.INT1) * 2) & 0xff)) & 0xffff;
    this.push(this.pc);
    this.pc = this.rd(at) | (this.rd((at + 1) & 0xffff) << 8);
    return CC_OP[0xcd];
  }

  private physRead(a: number): number { return this.mbus.phys.read8(a & 0xfffff) & 0xff; }
  private physWrite(a: number, v: number): void { this.mbus.phys.write8(a & 0xfffff, v & 0xff); }

  private dma0(maxCycles: number): number {
    if (!(this.dstat & DSTAT_DE0)) return 0;
    let sar = this.sar0;
    let dar = this.dar0;
    let bcr = this.bcr[0] || 0x10000;
    let count = this.dmode & DMODE_MMOD ? bcr : 1;
    let cycles = 0;
    while (count > 0) {
      switch (this.dmode & 0x3c) {
        case 0x00: this.physWrite(dar++, this.physRead(sar++)); bcr--; break;
        case 0x04: this.physWrite(dar++, this.physRead(sar--)); bcr--; break;
        case 0x08: this.physWrite(dar++, this.physRead(sar)); bcr--; break;
        case 0x10: this.physWrite(dar--, this.physRead(sar++)); bcr--; break;
        case 0x14: this.physWrite(dar--, this.physRead(sar--)); bcr--; break;
        case 0x18: this.physWrite(dar--, this.physRead(sar)); bcr--; break;
        case 0x20: this.physWrite(dar, this.physRead(sar++)); bcr--; break;
        case 0x24: this.physWrite(dar, this.physRead(sar--)); bcr--; break;
        default: break;
      }
      count--;
      cycles += 6;
      if (bcr === 0 || cycles > maxCycles) break;
    }
    this.sar0 = sar & 0xfffff;
    this.dar0 = dar & 0xfffff;
    this.bcr[0] = bcr & 0xffff;
    if ((bcr & 0xffff) === 0 && bcr !== 0x10000) {
      this.dstat &= ~DSTAT_DE0;
      if (this.dstat & DSTAT_DIE0) this.pending[Z180Int.DMA0] = 1;
    }
    return cycles;
  }

  private dma1(): number {
    return 0;
  }

  protected override execMain(op: number, idx: number): void {
    this.ccTable = idx === 0 ? CC_OP : CC_XY;
    this.ccIndex = op;
    switch (op) {
      case 0x10: {
        const d = sext8(this.imm8());
        this.b = (this.b - 1) & 0xff;
        if (this.b !== 0) {
          this.pc = (this.pc + d) & 0xffff;
          this.wz = this.pc;
          this.ccExtra += CC_EX[0x10];
        }
        return;
      }
      case 0x20: case 0x28: case 0x30: case 0x38: {
        const d = sext8(this.imm8());
        if (this.cond((op >> 3) - 4)) {
          this.pc = (this.pc + d) & 0xffff;
          this.wz = this.pc;
          this.ccExtra += CC_EX[op];
        }
        return;
      }
      case 0xc0: case 0xc8: case 0xd0: case 0xd8: case 0xe0: case 0xe8: case 0xf0: case 0xf8:
        if (this.cond((op >> 3) & 7)) {
          this.pc = this.pop();
          this.wz = this.pc;
          this.ccExtra += CC_EX[op];
        }
        return;
      case 0xc4: case 0xcc: case 0xd4: case 0xdc: case 0xe4: case 0xec: case 0xf4: case 0xfc: {
        const nn = this.imm16();
        this.wz = nn;
        if (this.cond((op >> 3) & 7)) {
          this.push(this.pc);
          this.pc = nn;
          this.ccExtra += CC_EX[op];
        }
        return;
      }
      case 0xdd: case 0xfd:
        super.execMain(op, idx);
        if (this.ccTable === CC_OP && this.ccIndex === op) this.ccTable = CC_XY;
        return;
    }
    super.execMain(op, idx);
  }

  protected override execCB(op: number): void {
    this.ccTable = CC_CB;
    this.ccIndex = op;
    super.execCB(op);
  }

  protected override execIndexedCB(idx: number): void {
    const d = sext8(this.imm8());
    const ea = ((idx === 1 ? this.ix : this.iy) + d) & 0xffff;
    this.wz = ea;
    const op = this.imm8();
    this.ccTable = CC_XYCB;
    this.ccIndex = op;
    const v = this.rd(ea);
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

  protected override execED(op: number): void {
    this.ccTable = CC_ED;
    this.ccIndex = op;
    const x = op >> 6;
    const y = (op >> 3) & 7;
    const z = op & 7;
    if (x === 0) {
      switch (z) {
        case 0: {
          const n = this.imm8();
          const v = this.inp(n);
          if (y !== 6) this.setR8(y, v, 0);
          return;
        }
        case 1: {
          const n = this.imm8();
          this.outp(n, y === 6 ? 0 : this.getR8(y, 0));
          return;
        }
        case 4: {
          const v = y === 6 ? this.rd(this.hl) : this.getR8(y, 0);
          this.setF(SZ53P[this.a & v] | HF);
          return;
        }
        default: return;
      }
    }
    if (x === 1) {
      if (z === 4 && (y & 1)) {
        const p = y >> 1;
        const rp = this.getRP(p, 0);
        this.setRP(p, (rp >> 8) * (rp & 0xff), 0);
        return;
      }
      if (op === 0x64) {
        const n = this.imm8();
        this.setF(SZ53P[this.a & n] | HF);
        return;
      }
      if (op === 0x74) {
        const n = this.imm8();
        const v = this.inp(this.c);
        this.setF((this.f & CF) | SZ53P[v & n]);
        return;
      }
      if (op === 0x76) {
        this.halted = true;
        return;
      }
    }
    if (op === 0x83 || op === 0x8b || op === 0x93 || op === 0x9b) {
      const dir = op & 8 ? -1 : 1;
      this.b = (this.b - 1) & 0xff;
      this.outp(this.c, this.rd(this.hl));
      this.hl = (this.hl + dir) & 0xffff;
      this.c = (this.c + dir) & 0xff;
      this.setF(this.b ? NF : NF | ZF);
      if (op & 0x10 && this.b !== 0) {
        this.pc = (this.pc - 2) & 0xffff;
        this.ccExtra += CC_EX[0xb3];
      }
      return;
    }
    const pc0 = this.pc;
    super.execED(op);
    if (x === 2 && y >= 6 && z <= 3 && this.pc === ((pc0 - 2) & 0xffff)) this.ccExtra += CC_EX[op];
  }
}
