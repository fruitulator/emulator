import { Mc68681 } from './mc68681';

export const MBAR_ADDR = 0x0003ff00;
export const SIM40_SIZE = 0x1000;

export const RSR_POWER = 0x80;
export const RSR_WATCHDOG = 0x20;

const OFF_MCR = 0x00;
const OFF_SYNCR = 0x04;
const OFF_RSR = 0x07;
const OFF_SYPCR = 0x20;
const OFF_PICR = 0x22;
const OFF_PITR = 0x24;
const OFF_SWSR = 0x27;
const CS_BASE = 0x40;

const IARB_MASK = 0x0f;

export const SPURIOUS_VECTOR = 0x18;

const MCR_RESET_SIM = 0x608f;
const MCR_RESET_TIMER = 0x0080;

const SYPCR_SWE = 0x80;
const SYPCR_SWRI = 0x40;

const TIMER_BASE = [0x600, 0x640];

const DMA_BASE = [0x780, 0x7a0];
const DMA_INTR = 0x04;
const DMA_CCR = 0x08;
const DMA_CSR = 0x0a;
const DMA_SAR = 0x0c;
const DMA_DAR = 0x10;
const DMA_BTC = 0x14;
const DMA_CCR_STR = 0x01;
const DMA_SIZE = [4, 1, 2, 0];
const SERIAL_UNMAPPED = new Set([0x712, 0x716, 0x717, 0x71a, 0x71c, 0x71e, 0x71f]);
const DMA_CSR_IRQ = 0x80;
const DMA_CSR_DONE = 0x40;
const DMA_CSR_EVENTS = 0x7c;
const T_IR = 0x04;
const T_CR = 0x06;
const T_SR = 0x08;
const T_CNTR = 0x0a;
const T_PREL1 = 0x0c;
const T_COM = 0x10;

const CR_SWR = 0x8000;
const CR_INTMSK = 0x7000;
const CR_PCLK = 0x0400;
const CR_CPE = 0x0200;
const CR_CLK = 0x0100;
const CR_POT_MASK = 0x00e0;

const SR_IRQ = 0x8000;
const SR_TO = 0x4000;
const SR_TC = 0x1000;
const SR_EVENTS = 0x7000;
const SR_ON = 0x0400;
const SR_COM = 0x0100;
const SR_PSC_OUT = 0x00ff;

export interface Sim40Hooks {
  watchdogReset?(): void;
  busRead8?(addr: number): number;
  busWrite8?(addr: number, val: number): void;
  busRead16?(addr: number): number;
  busWrite16?(addr: number, val: number): void;
  dmaStart?(ch: number): void;
  dmaStop?(ch: number): void;
  serialTx?(channel: 0 | 1, v: number): void;
  portAIn?(): number;
  portBIn?(): number;
  portWrite?(): void;
}

export const OFF_PORTA = 0x11;
export const OFF_DDRA = 0x13;
export const OFF_PPARA1 = 0x15;
export const OFF_PPARA2 = 0x17;
export const OFF_PORTB = 0x19;
export const OFF_PORTB1 = 0x1b;
export const OFF_DDRB = 0x1d;
export const OFF_PPARB = 0x1f;

export interface ChipSelect {
  cs: number;
  writeProtect: boolean;
}

export const CS_WP = 8;

interface Timer {
  count: number;
  sr: number;
  acc: number;
}

export class M68340Sim {
  readonly regs = new Uint8Array(SIM40_SIZE);

  readonly serial = new Mc68681({
    txByte: (channel, v) => this.hooks.serialTx?.(channel, v),
    txDreq: (_channel, requesting) => { this.dreqLevel = requesting; if (requesting) this.dreq(); },
    irqChanged: () => { this.irqDirty = true; },
  });
  private serialAcc = 0;

  serialReceive(channel: 0 | 1, v: number): void {
    this.serial.receive(channel, v);
  }

  serialRxSpace(channel: 0 | 1): number {
    return this.serial.rxSpace(channel);
  }

  private readonly timers: Timer[] = [
    { count: 0, sr: 0, acc: 0 },
    { count: 0, sr: 0, acc: 0 },
  ];

  readonly reads = new Map<number, number>();
  readonly writes = new Map<number, number>();

  private mbar = 0;

  private cs0Global = true;

  private pitCounter = 0;
  private pitAcc = 0;
  private pitIrq = false;

  private dmaIrq = [false, false];

  private watchdogElapsed = 0;
  private swsrArmed = false;
  watchdogFires = 0;

  constructor(
    private readonly hooks: Sim40Hooks = {},
    private readonly watchdogCycles = 130_000_000,
    private readonly busHz = 16_515_072,
    private readonly pitTickCycles = Math.round(busHz / 8192),
  ) {
    this.serial.txPaced = true;
  }

  get base(): number {
    return (this.mbar & 0xfffff000) >>> 0;
  }

  get valid(): boolean {
    return (this.mbar & 1) !== 0;
  }

  private w16(off: number, v: number): void {
    this.regs[off] = (v >> 8) & 0xff;
    this.regs[off + 1] = v & 0xff;
  }

  reset(cause = RSR_POWER): void {
    this.irqDirty = true;
    this.pendingCycles = 0;
    this.tickDeadline = 0;
    this.regs.fill(0);
    this.regs[OFF_RSR] = cause;
    this.regs[OFF_PICR] = 0x00;
    this.regs[OFF_PICR + 1] = 0x0f;
    this.w16(OFF_MCR, MCR_RESET_SIM);
    for (const base of TIMER_BASE) this.w16(base, MCR_RESET_TIMER);
    this.mbar = 0;
    this.cs0Global = true;
    this.csEpoch++;
    this.csDirty = true;
    this.watchdogElapsed = 0;
    this.swsrArmed = false;
    this.pitCounter = 0;
    this.pitAcc = 0;
    this.pitIrq = false;
    this.dmaIrq[0] = false;
    this.dmaIrq[1] = false;
    this.serial.reset();
    this.reads.clear();
    this.writes.clear();
    for (let i = 0; i < this.timers.length; i++) this.resetTimer(i);
  }

  private resetTimer(i: number): void {
    this.irqDirty = true;
    const t = this.timers[i];
    const base = TIMER_BASE[i];
    t.count = 0;
    t.sr = (t.sr & 0x2000) | SR_PSC_OUT;
    t.acc = 0;
    this.w16(base + T_CR, 0);
    this.w16(base + T_PREL1, 0xffff);
    this.w16(base + T_PREL1 + 2, 0xffff);
    this.w16(base + T_COM, 0);
  }

  moduleReset(): void {
    this.irqDirty = true;
    const mcr = [this.r16(TIMER_BASE[0]), this.r16(TIMER_BASE[1]),
      this.r16(DMA_BASE[0]), this.r16(DMA_BASE[1])];
    this.regs.fill(0, 0x600, 0x660);
    this.regs.fill(0, 0x780, 0x7c0);
    this.w16(TIMER_BASE[0], mcr[0]);
    this.w16(TIMER_BASE[1], mcr[1]);
    this.w16(DMA_BASE[0], mcr[2]);
    this.w16(DMA_BASE[1], mcr[3]);
    for (let i = 0; i < this.timers.length; i++) this.resetTimer(i);
    this.dmaIrq[0] = false;
    this.dmaIrq[1] = false;
    this.regs[OFF_PICR] = 0x00;
    this.regs[OFF_PICR + 1] = 0x0f;
    this.regs[OFF_PITR] = 0x00;
    this.regs[OFF_PITR + 1] = 0x00;
    this.pitCounter = 0;
    this.pitAcc = 0;
    this.pitIrq = false;
    this.serial.reset();
  }

  mbarByteWrite(off: number, val: number): void {
    this.irqDirty = true;
    const shift = (3 - (off & 3)) * 8;
    this.mbar = ((this.mbar & ~(0xff << shift)) | ((val & 0xff) << shift)) >>> 0;
  }

  mbarByteRead(off: number): number {
    return (this.mbar >>> ((3 - (off & 3)) * 8)) & 0xff;
  }

  private r32(off: number): number {
    return (
      ((this.regs[off] << 24)
        | (this.regs[off + 1] << 16)
        | (this.regs[off + 2] << 8)
        | this.regs[off + 3]) >>> 0
    );
  }

  calcCs(addr: number): ChipSelect | null {
    const cs = this.csLookup(addr);
    if (cs < 0) return null;
    return { cs: cs & 3, writeProtect: (cs & CS_WP) !== 0 };
  }

  csLookup(addr: number): number {
    if (this.cs0Global) return 0;
    if (this.csDirty) this.compileCs();
    for (let i = 0; i < 4; i++) {
      if (!this.csOn[i]) continue;
      if (((addr & this.csMask[i]) >>> 0) === this.csBase[i]) return i | this.csWp[i];
    }
    return -1;
  }

  busPenalty(addr: number, word: boolean): number {
    if (this.valid && ((addr - this.base) >>> 0) < 0x1000) return 0;
    if (this.cs0Global) return 1;
    if (this.csDirty) this.compileCs();
    for (let i = 0; i < 4; i++) {
      if (!this.csOn[i]) continue;
      if (((addr & this.csMask[i]) >>> 0) === this.csBase[i]) {
        return word ? this.csWordPenalty[i] : this.csBytePenalty[i];
      }
    }
    return 1;
  }

  private readonly csMask = new Int32Array(4);
  private readonly csBase = new Uint32Array(4);
  private readonly csOn = new Uint8Array(4);
  private readonly csBytePenalty = new Int8Array(4);
  private readonly csWordPenalty = new Int8Array(4);
  private readonly csWp = new Uint8Array(4);
  private csDirty = true;

  csEpoch = 0;
  get csEpochNow(): number {
    if (this.csDirty) this.compileCs();
    return this.csEpoch;
  }

  csWindow(i: number): { on: boolean; lo: number; hi: number; bytePen: number; wordPen: number; writeProtect: boolean } {
    if (this.csDirty) this.compileCs();
    return {
      on: !this.cs0Global && this.csOn[i] !== 0,
      lo: this.csBase[i] >>> 0,
      hi: (this.csBase[i] | ~this.csMask[i]) >>> 0,
      bytePen: this.csBytePenalty[i],
      wordPen: this.csWordPenalty[i],
      writeProtect: this.csWp[i] !== 0,
    };
  }

  get cs0IsGlobal(): boolean { return this.cs0Global; }

  hasSourceAt(level: number): boolean {
    for (let s = 0; s < M68340Sim.SOURCES; s++) if (this.sourceLevel(s) === level) return true;
    return false;
  }

  private compileCs(): void {
    this.csDirty = false;
    this.csEpoch++;
    for (let i = 0; i < 4; i++) {
      const am = this.r32(CS_BASE + i * 8);
      const ba = this.r32(CS_BASE + i * 8 + 4);
      this.csOn[i] = ba & 1;
      this.csWp[i] = (ba & 8) ? CS_WP : 0;
      this.csMask[i] = ~((am & 0xffffff00) | 0xff);
      this.csBase[i] = (ba & 0xffffff00) >>> 0;
      const clocks = (ba & 4) ? 2
        : (am & 3) === 3 ? 3
          : 3 + ((am >> 2) & 3);
      this.csBytePenalty[i] = clocks - 2;
      this.csWordPenalty[i] = (am & 3) === 2 ? 2 * clocks - 2 : clocks - 2;
    }
  }

  private r16(off: number): number {
    return ((this.regs[off] << 8) | this.regs[off + 1]) & 0xffff;
  }

  read8(off: number): number {
    if (this.pendingCycles > 0) this.flush();
    this.reads.set(off, (this.reads.get(off) ?? 0) + 1);
    if (off === OFF_SYNCR + 1) return this.regs[off] | 0x08;
    if (off === 0x710) return this.serial.getMr(0, 0);
    if (off === 0x718) return this.serial.getMr(1, 0);
    if (off === 0x720) return this.serial.getMr(0, 1);
    if (off === 0x721) return this.serial.getMr(1, 1);
    if (SERIAL_UNMAPPED.has(off)) return 0;
    if (off >= 0x711 && off <= 0x71f) return this.serial.read(off & 0xf);

    for (let i = 0; i < 2; i++) {
      const rel = off - TIMER_BASE[i];
      if (rel < 0 || rel > 0x11) continue;
      const t = this.timers[i];
      if (rel === T_SR) return (t.sr >> 8) & 0xff;
      if (rel === T_SR + 1) return t.sr & 0xff;
      if (rel === T_CNTR) return (t.count >> 8) & 0xff;
      if (rel === T_CNTR + 1) return t.count & 0xff;
    }
    if (off === OFF_PORTA && this.hooks.portAIn) {
      const ddr = this.regs[OFF_DDRA];
      return ((this.regs[OFF_PORTA] & ddr) | (this.hooks.portAIn() & ~ddr)) & 0xff;
    }
    if ((off === OFF_PORTB || off === OFF_PORTB1) && this.hooks.portBIn) {
      const ddr = this.regs[OFF_DDRB];
      return ((this.regs[OFF_PORTB] & ddr) | (this.hooks.portBIn() & ~ddr)) & 0xff;
    }
    return this.regs[off];
  }

  write8(off: number, val: number): void {
    this.flush();
    this.tickDeadline = 0;
    this.irqDirty = true;
    this.writes.set(off, (this.writes.get(off) ?? 0) + 1);

    if (off === OFF_SWSR) {
      if ((val & 0xff) === 0x55) {
        this.swsrArmed = true;
      } else if (this.swsrArmed && (val & 0xff) === 0xaa) {
        this.watchdogElapsed = 0;
        this.swsrArmed = false;
      } else {
        this.swsrArmed = false;
      }
      return;
    }
    if (off === OFF_RSR) return;

    if (off === 0x710) { this.serial.setMr(0, 0, val); return; }
    if (off === 0x718) { this.serial.setMr(1, 0, val); return; }
    if (off === 0x720) { this.serial.setMr(0, 1, val); return; }
    if (off === 0x721) { this.serial.setMr(1, 1, val); return; }
    if (off >= 0x711 && off <= 0x71f) {
      this.serial.write(off & 0xf, val);
      return;
    }

    if (off === OFF_PITR || off === OFF_PITR + 1) {
      this.regs[off] = val & 0xff;
      this.pitCounter = this.regs[OFF_PITR + 1];
      this.pitAcc = 0;
      return;
    }

    for (let ch = 0; ch < 2; ch++) {
      const base = DMA_BASE[ch];
      const rel = off - base;
      if (rel < 0 || rel > 0x17) continue;
      if (rel === DMA_CSR) {
        this.regs[off] &= ~(val & DMA_CSR_EVENTS) & 0xff;
        if (this.regs[off] & DMA_CSR_EVENTS) this.regs[off] |= DMA_CSR_IRQ;
        else {
          this.regs[off] &= ~DMA_CSR_IRQ & 0xff;
          this.dmaIrq[ch] = false;
        }
        return;
      }
      const wasStarted = (this.regs[base + DMA_CCR + 1] & DMA_CCR_STR) !== 0;
      this.regs[off] = val & 0xff;
      if (rel === DMA_CCR + 1) {
        if (val & DMA_CCR_STR) {
          if (!wasStarted) this.hooks.dmaStart?.(ch);
          this.dmaRun(ch);
        } else if (wasStarted) this.hooks.dmaStop?.(ch);
      }
      return;
    }

    if (off >= CS_BASE + 4 && off < CS_BASE + 8 && this.cs0Global) { this.cs0Global = false; this.csEpoch++; }
    if (off >= CS_BASE && off < CS_BASE + 0x20) this.csDirty = true;

    for (let i = 0; i < 2; i++) {
      const rel = off - TIMER_BASE[i];
      if (rel < 0 || rel > 0x11) continue;
      const t = this.timers[i];
      if (rel === T_SR) {
        const cleared = (val << 8) & SR_EVENTS;
        t.sr &= ~cleared & 0xffff;
        if (cleared === SR_EVENTS && !(this.r16(TIMER_BASE[i] + T_CR) & CR_SWR)) {
          t.count = 0;
          t.acc = 0;
          t.sr = (t.sr & ~SR_COM & 0xffff) | SR_PSC_OUT;
        }
        this.refreshTimerIrq(i);
        return;
      }
      if (rel === T_SR + 1) return;
      this.regs[off] = val & 0xff;
      if (rel === T_CR || rel === T_CR + 1) this.timerCrWritten(i);
      return;
    }

    if (off === OFF_PORTB1) off = OFF_PORTB;
    this.regs[off] = val & 0xff;
    if (off >= OFF_PORTA && off <= OFF_PPARB && (off & 1)) this.hooks.portWrite?.();
  }

  private timerDivider(cr: number): number {
    if (!(cr & CR_PCLK)) return 2;
    const pot = (cr & CR_POT_MASK) >> 5;
    return 2 * (pot === 0 ? 256 : 1 << pot);
  }

  private timerCrWritten(i: number): void {
    const t = this.timers[i];
    const cr = this.r16(TIMER_BASE[i] + T_CR);
    if ((cr & (CR_SWR | CR_CPE)) === (CR_SWR | CR_CPE)) {
      t.sr |= SR_ON;
    } else {
      t.sr &= ~SR_ON & 0xffff;
      if (!(cr & CR_SWR)) t.sr = (t.sr & ~SR_COM & 0xffff) | SR_PSC_OUT;
    }
    this.refreshTimerIrq(i);
  }

  private refreshTimerIrq(i: number): void {
    const cr = this.r16(TIMER_BASE[i] + T_CR);
    const t = this.timers[i];
    const before = t.sr & SR_IRQ;
    if (t.sr & cr & CR_INTMSK) t.sr |= SR_IRQ;
    else t.sr &= ~SR_IRQ & 0xffff;
    if ((t.sr & SR_IRQ) !== before) this.irqDirty = true;
  }

  private tickTimers(cycles: number): void {
    for (let i = 0; i < 2; i++) {
      const t = this.timers[i];
      if (!(t.sr & SR_ON)) continue;
      const cr = this.r16(TIMER_BASE[i] + T_CR);
      if (cr & CR_CLK) continue;
      const div = this.timerDivider(cr);
      t.acc += cycles;
      let ticks = Math.floor(t.acc / div);
      if (ticks === 0) continue;
      t.acc -= ticks * div;

      const reload = this.r16(TIMER_BASE[i] + T_PREL1);
      const com = this.r16(TIMER_BASE[i] + T_COM);
      while (ticks > 0) {
        if (t.count === 0) {
          t.count = reload;
          ticks--;
        } else {
          const step = Math.min(ticks, t.count);
          if (com < t.count && com >= t.count - step) t.sr |= SR_TC;
          t.count -= step;
          ticks -= step;
        }
        if (t.count === 0) t.sr |= SR_TO;
        if (t.count === com) t.sr |= SR_TC;
      }
      this.refreshTimerIrq(i);
    }
  }

  private tickPit(cycles: number): void {
    const count = this.regs[OFF_PITR + 1];
    if (count === 0) return;
    const period = this.pitTickCycles * (this.regs[OFF_PITR] & 1 ? 512 : 1);
    this.pitAcc += cycles;
    while (this.pitAcc >= period) {
      this.pitAcc -= period;
      if (--this.pitCounter <= 0) {
        this.pitCounter = count;
        if (!this.pitIrq) this.irqDirty = true;
        this.pitIrq = true;
      }
    }
  }

  private get pitLevel(): number {
    return this.regs[OFF_PICR] & 7;
  }

  autovectored(level: number): boolean {
    return ((this.regs[0x06] >> level) & 1) !== 0;
  }

  private w32(off: number, v: number): void {
    this.regs[off] = (v >>> 24) & 0xff;
    this.regs[off + 1] = (v >>> 16) & 0xff;
    this.regs[off + 2] = (v >>> 8) & 0xff;
    this.regs[off + 3] = v & 0xff;
  }

  private dmaOperand(ch: number): void {
    const base = DMA_BASE[ch];
    const ccr = this.r16(base + DMA_CCR);
    let sar = this.r32(base + DMA_SAR);
    let dar = this.r32(base + DMA_DAR);
    let btc = this.r32(base + DMA_BTC);
    const ssize = DMA_SIZE[(ccr >> 8) & 3];
    const dsize = DMA_SIZE[(ccr >> 6) & 3];
    if (btc > 0 && ssize && dsize && this.hooks.busRead8 && this.hooks.busWrite8) {
      this.dmaWrite(dar >>> 0, dsize, this.dmaRead(sar >>> 0, ssize));
      if (ccr & 0x0800) sar = (sar + ssize) >>> 0;
      if (ccr & 0x0400) dar = (dar + dsize) >>> 0;
      btc = Math.max(0, btc - ssize);
    }
    this.w32(base + DMA_SAR, sar);
    this.w32(base + DMA_DAR, dar);
    this.w32(base + DMA_BTC, btc);
    if (btc === 0) this.dmaComplete(ch);
  }

  private dmaRead(addr: number, size: number): number {
    const { busRead8, busRead16 } = this.hooks;
    const r16 = (a: number) => busRead16 ? busRead16(a) & 0xffff
      : ((busRead8!(a) & 0xff) << 8) | (busRead8!((a + 1) >>> 0) & 0xff);
    if (size === 1) return busRead8!(addr) & 0xff;
    if (size === 2) return r16(addr);
    return ((r16(addr) << 16) | r16((addr + 2) >>> 0)) >>> 0;
  }

  private dmaWrite(addr: number, size: number, v: number): void {
    const { busWrite8, busWrite16 } = this.hooks;
    const w16 = (a: number, x: number) => {
      if (busWrite16) { busWrite16(a, x & 0xffff); return; }
      busWrite8!(a, (x >> 8) & 0xff);
      busWrite8!((a + 1) >>> 0, x & 0xff);
    };
    if (size === 1) busWrite8!(addr, v & 0xff);
    else if (size === 2) w16(addr, v);
    else { w16(addr, v >>> 16); w16((addr + 2) >>> 0, v); }
  }

  private dmaComplete(ch: number): void {
    const base = DMA_BASE[ch];
    this.regs[base + DMA_CSR] |= DMA_CSR_DONE | DMA_CSR_IRQ;
    const wasStarted = (this.regs[base + DMA_CCR + 1] & DMA_CCR_STR) !== 0;
    this.regs[base + DMA_CCR + 1] &= ~DMA_CCR_STR & 0xff;
    if (wasStarted) this.hooks.dmaStop?.(ch);
    const intn = (this.regs[base + DMA_CCR] & 0x40) !== 0;
    if (intn && ((this.r16(base + DMA_INTR) >> 8) & 7) !== 0) {
      this.dmaIrq[ch] = true;
      this.irqDirty = true;
    }
  }

  private dmaRun(ch: number): void {
    const base = DMA_BASE[ch];
    const started = () => (this.regs[base + DMA_CCR + 1] & DMA_CCR_STR) !== 0;
    if (!started() || (this.r16(base) & 0x8000)) return;
    const requestMode = this.r16(base + DMA_CCR) & 0x0030;
    if (requestMode === 0) {
      while (this.r32(base + DMA_BTC) > 0 && started()) {
        const before = this.r32(base + DMA_BTC);
        this.dmaOperand(ch);
        if (this.r32(base + DMA_BTC) === before) break;
      }
      if (this.r32(base + DMA_BTC) === 0) return;
      this.dmaComplete(ch);
      return;
    }
    if (!this.dreqLevel) return;
    do {
      this.dmaOperand(ch);
    } while (requestMode === 0x0020 && this.dreqLevel && started());
  }

  private dreqLevel = false;

  private inDreq = false;

  private dreqPending = false;

  dreq(): void {
    if (this.inDreq) { this.dreqPending = true; return; }
    this.inDreq = true;
    try {
      do {
        this.dreqPending = false;
        this.dreqRun();
      } while (this.dreqPending);
    } finally {
      this.inDreq = false;
      this.dreqPending = false;
    }
  }

  dmaRequest(ch: number): boolean {
    const base = DMA_BASE[ch];
    if (!(this.regs[base + DMA_CCR + 1] & DMA_CCR_STR)) return false;
    if (this.r16(base) & 0x8000) return false;
    if ((this.r16(base + DMA_CCR) & 0x0030) !== 0x0030) return false;
    if (this.r32(base + DMA_BTC) === 0 || (this.regs[base + DMA_CSR] & DMA_CSR_EVENTS)) return false;
    this.dmaOperand(ch);
    return true;
  }

  private dreqRun(): void {
    for (let ch = 0; ch < 2; ch++) {
      if ((this.r16(DMA_BASE[ch] + DMA_CCR) & 0x0030) === 0) continue;
      if (!(this.regs[DMA_BASE[ch] + DMA_CCR + 1] & DMA_CCR_STR)) continue;
      this.dmaRun(ch);
      return;
    }
  }

  private sourceLevel(src: number): number {
    switch (src) {
      case 0: return this.pitIrq ? this.pitLevel : 0;
      case 1: case 2: {
        const i = src - 1;
        if (!(this.timers[i].sr & SR_IRQ)) return 0;
        return (this.r16(TIMER_BASE[i] + T_IR) >> 8) & 7;
      }
      case 3: return this.serial.irq() ? this.regs[0x704] & 7 : 0;
      default: {
        const ch = src - 4;
        if (!this.dmaIrq[ch]) return 0;
        return (this.r16(DMA_BASE[ch] + DMA_INTR) >> 8) & 7;
      }
    }
  }

  private sourceVector(src: number): number {
    switch (src) {
      case 0: return this.regs[OFF_PICR + 1];
      case 1: case 2: return this.r16(TIMER_BASE[src - 1] + T_IR) & 0xff;
      case 3: return this.regs[0x705];
      default: return this.r16(DMA_BASE[src - 4] + DMA_INTR) & 0xff;
    }
  }

  private sourceIarb(src: number): number {
    switch (src) {
      case 0: return this.regs[OFF_MCR + 1] & IARB_MASK;
      case 1: case 2: return this.regs[TIMER_BASE[src - 1] + 1] & IARB_MASK;
      case 3: return this.regs[0x701] & IARB_MASK;
      default: return this.regs[DMA_BASE[src - 4] + 1] & IARB_MASK;
    }
  }

  private static readonly SOURCES = 6;

  private irqDirty = true;
  private cachedReq = 0;

  request(): number {
    if (this.irqDirty) {
      this.irqDirty = false;
      let best = 0;
      for (let s = 0; s < M68340Sim.SOURCES; s++) {
        const level = this.sourceLevel(s);
        if (level > best) best = level;
      }
      this.cachedReq = best;
    }
    return this.cachedReq;
  }

  requestUncached(): number {
    let best = 0;
    for (let s = 0; s < M68340Sim.SOURCES; s++) {
      const level = this.sourceLevel(s);
      if (level > best) best = level;
    }
    return best;
  }

  interruptAck(level: number): number | null {
    if (level <= 0) return null;
    let iarb = 0;
    let winner = -1;
    for (let s = 0; s < M68340Sim.SOURCES; s++) {
      if (this.sourceLevel(s) !== level) continue;
      const n = this.sourceIarb(s);
      if (n > iarb) { iarb = n; winner = s; }
    }
    if (winner < 0) return null;
    if (winner === 0) { this.pitIrq = false; this.irqDirty = true; }
    return this.sourceVector(winner);
  }

  private pendingCycles = 0;
  private tickDeadline = 0;

  tick(cycles: number): void {
    this.pendingCycles += cycles;
    if (this.pendingCycles >= this.tickDeadline) this.flush();
  }

  flush(): void {
    const cycles = this.pendingCycles;
    this.pendingCycles = 0;
    if (cycles > 0) this.advance(cycles);
    this.tickDeadline = this.nextEvent();
  }

  eventIn(): number {
    if (this.tickDeadline === 0) this.flush();
    return this.tickDeadline - this.pendingCycles;
  }

  eventInNoFlush(): number {
    if (this.tickDeadline === 0) return 0;
    return this.tickDeadline - this.pendingCycles;
  }

  private nextEvent(): number {
    let d = 1 << 16;
    for (let i = 0; i < 2; i++) {
      const t = this.timers[i];
      if (!(t.sr & SR_ON)) continue;
      const cr = this.r16(TIMER_BASE[i] + T_CR);
      if (cr & CR_CLK) continue;
      const div = this.timerDivider(cr);
      const com = this.r16(TIMER_BASE[i] + T_COM);
      let edges = t.count === 0 ? 1 : t.count;
      if (com < t.count && t.count - com < edges) edges = t.count - com;
      const c = edges * div - t.acc;
      if (c < d) d = c;
    }
    const pitCount = this.regs[OFF_PITR + 1];
    if (pitCount !== 0) {
      const period = this.pitTickCycles * (this.regs[OFF_PITR] & 1 ? 512 : 1);
      const c = Math.max(this.pitCounter, 1) * period - this.pitAcc;
      if (c < d) d = c;
    }
    if (!this.serial.idle()) {
      const c = Math.ceil((this.busHz - this.serialAcc) / 3_686_400);
      if (c < d) d = c;
    }
    if (this.regs[OFF_SYPCR] & SYPCR_SWE) {
      const c = this.watchdogCycles - this.watchdogElapsed;
      if (c < d) d = c;
    }
    return d < 1 ? 1 : d;
  }

  private advance(cycles: number): void {
    this.tickTimers(cycles);
    this.tickPit(cycles);
    this.serialAcc += cycles * 3_686_400;
    const serialTicks = Math.floor(this.serialAcc / this.busHz);
    if (serialTicks > 0) {
      this.serialAcc -= serialTicks * this.busHz;
      this.serial.tick(serialTicks);
    }
    const sypcr = this.regs[OFF_SYPCR];
    if (!(sypcr & SYPCR_SWE)) return;
    this.watchdogElapsed += cycles;
    if (this.watchdogElapsed < this.watchdogCycles) return;
    this.watchdogElapsed = 0;
    this.watchdogFires++;
    if (sypcr & SYPCR_SWRI) this.hooks.watchdogReset?.();
  }

  activity(): { off: number; reads: number; writes: number }[] {
    const all = new Set([...this.reads.keys(), ...this.writes.keys()]);
    return [...all]
      .map((off) => ({
        off,
        reads: this.reads.get(off) ?? 0,
        writes: this.writes.get(off) ?? 0,
      }))
      .sort((a, b) => b.reads + b.writes - (a.reads + a.writes));
  }
}
