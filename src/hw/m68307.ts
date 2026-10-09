
export const SIM_BASE = 0xfff000;
export const SIM_SIZE = 0x1000;

const TIMER_BASE = [0x120, 0x130];

const TMR = 0x00;
const TRR = 0x02;
const TCN = 0x06;
const TER = 0x09;

const UART_BASE = 0x100;
const UART_END = 0x120;

const U_MR = 0x0;
const U_SR = 0x1;
const U_CR = 0x2;
const U_HR = 0x3;
const U_ISR = 0x5;
const U_IVR = 0xc;

const SR_RXRDY = 0x01;
const SR_TXRDY = 0x04;
const SR_TXEMT = 0x08;

const ISR_TXRDY = 0x01;
const ISR_RXRDY = 0x02;

const MBUS_BASE = 0x140;
const MBUS_END = 0x14a;

const MB_BCR = 0x2;
const MB_BSR = 0x3;
const MB_BDR = 0x4;

const MBCR_MEN = 0x80;
const MBCR_MIEN = 0x40;
const MBCR_MSTA = 0x20;
const MBCR_MTX = 0x10;
const MBCR_RSTA = 0x04;

const MBSR_MCF = 0x80;
const MBSR_MBB = 0x20;
const MBSR_MIF = 0x02;
const MBSR_RXAK = 0x01;

export interface SimHooks {
  txByte?(v: number): void;
  mbusByte?(v: number): void;
  mbusRead?(): number;
  mbusStart?(): void;
  mbusStop?(): void;

  irqChanged?(): void;
  portA?(v: number): void;
  portB?(v: number): void;
}

interface Timer {
  count: number;
  event: boolean;
  prescale: number;
}

export class M68307Sim {
  readonly regs = new Uint8Array(SIM_SIZE);

  readonly reads = new Map<number, number>();
  readonly writes = new Map<number, number>();

  private readonly timers: Timer[] = [
    { count: 0, event: false, prescale: 0 },
    { count: 0, event: false, prescale: 0 },
  ];

  portAIn = 0xffff;
  portBIn = 0xffff;

  private readonly umr = [0, 0];
  private umrPointer = 0;
  private uartTxEnabled = false;
  private uartRxEnabled = false;
  private uartIsr = 0;
  private uartImr = 0;
  private uartIvr = 0;
  readonly txLog: number[] = [];
  private readonly rxQueue: number[] = [];

  mbar = 0xbfff;
  scr = 0x0007f010;
  base = 0;
  mapped = false;

  constructor(private readonly hooks: SimHooks = {}) {}

  offsetOf(addr: number): number {
    return this.mapped && ((addr & 0xfff000) >>> 0) === this.base ? addr & 0xfff : -1;
  }

  readControl16(addr: number): number {
    if (addr === 0xf2) return this.mbar & 0xffff;
    if (addr === 0xf4) return this.scr >>> 16;
    if (addr === 0xf6) return this.scr & 0xffff;
    return 0;
  }

  writeControl16(addr: number, v: number): void {
    v &= 0xffff;
    if (addr === 0xf2) {
      this.mbar = v;
      this.base = (v & 0xfff) << 12;
      this.mapped = true;
    } else if (addr === 0xf4) {
      this.scr = ((v << 16) | (this.scr & 0xffff)) >>> 0;
    } else if (addr === 0xf6) {
      this.scr = ((this.scr & 0xffff0000) | v) >>> 0;
    }
  }

  chipSelect(n: number): { base: number; mask: number; enabled: boolean } {
    const br = this.r16(0x40 + n * 4);
    const or = this.r16(0x42 + n * 4);
    return {
      base: ((br & 0x1ffc) << 11) >>> 0,
      mask: ((or & 0x1ffc) << 11) >>> 0,
      enabled: (br & 1) !== 0,
    };
  }

  receive(v: number): void {
    this.rxQueue.push(v & 0xff);
    this.refreshUartIsr();
    this.updateIrq();
  }

  reset(): void {
    this.mbar = 0xbfff;
    this.scr = 0x0007f010;
    this.regs.fill(0);
    this.reads.clear();
    this.writes.clear();
    for (const t of this.timers) {
      t.count = 0;
      t.event = false;
      t.prescale = 0;
    }
  }

  private r16(off: number): number {
    return ((this.regs[off] << 8) | this.regs[off + 1]) & 0xffff;
  }

  private uartStatus(): number {
    let sr = this.uartTxEnabled ? SR_TXRDY | SR_TXEMT : 0;
    if (this.uartRxEnabled && this.rxQueue.length) sr |= SR_RXRDY;
    return sr;
  }

  private refreshUartIsr(): void {
    if (this.uartTxEnabled) this.uartIsr |= ISR_TXRDY;
    else this.uartIsr &= ~ISR_TXRDY;
    if (this.uartRxEnabled && this.rxQueue.length) this.uartIsr |= ISR_RXRDY;
    else this.uartIsr &= ~ISR_RXRDY;
  }

  private uartRead(reg: number): number {
    switch (reg) {
      case U_MR: {
        const v = this.umr[this.umrPointer];
        this.umrPointer = 1;
        return v;
      }
      case U_SR:
        return this.uartStatus();
      case U_HR: {
        const v = this.rxQueue.shift() ?? 0;
        this.refreshUartIsr();
        this.updateIrq();
        return v;
      }
      case U_ISR:
        return this.uartIsr;
      case U_IVR:
        return this.uartIvr;
      default:
        return 0;
    }
  }

  private uartWrite(reg: number, val: number): void {
    switch (reg) {
      case U_MR:
        this.umr[this.umrPointer] = val;
        this.umrPointer = 1;
        break;
      case U_CR: {
        if (val & 0x01) this.uartRxEnabled = true;
        if (val & 0x02) this.uartRxEnabled = false;
        if (val & 0x04) this.uartTxEnabled = true;
        if (val & 0x08) this.uartTxEnabled = false;
        const cmd = (val >> 4) & 0x07;
        if (cmd === 1) this.umrPointer = 0;
        if (cmd === 3) this.uartTxEnabled = false;
        break;
      }
      case U_HR:
        if (this.txLog.length < 4096) this.txLog.push(val & 0xff);
        this.hooks.txByte?.(val & 0xff);
        break;
      case U_ISR:
        this.uartImr = val;
        break;
      case U_IVR:
        this.uartIvr = val;
        break;
    }
    this.refreshUartIsr();
  }

  private mbcr = 0;
  private mbsr = 0;
  private mbdr = 0;
  readonly mbusLog: number[] = [];

  private mbusTransferDone(): void {
    this.mbsr |= MBSR_MCF | MBSR_MIF;
    this.mbsr &= ~MBSR_RXAK & 0xff;
    this.updateIrq();
  }

  private mbusRead(reg: number): number {
    switch (reg) {
      case MB_BCR:
        return this.mbcr;
      case MB_BSR:
        return this.mbsr;
      case MB_BDR: {
        const v = this.mbdr;
        if ((this.mbcr & MBCR_MSTA) && !(this.mbcr & MBCR_MTX)) {
          this.mbdr = (this.hooks.mbusRead?.() ?? 0xff) & 0xff;
          this.mbusTransferDone();
        }
        return v;
      }
      default:
        return 0xff;
    }
  }

  private mbusWrite(reg: number, val: number): void {
    switch (reg) {
      case MB_BCR: {
        const wasMaster = (this.mbcr & MBCR_MSTA) !== 0;
        this.mbcr = val & ~MBCR_RSTA & 0xff;
        if (!(val & MBCR_MEN)) {
          this.mbsr = 0;
          break;
        }
        if (val & MBCR_MSTA) {
          this.mbsr |= MBSR_MBB;
          if (!wasMaster || (val & MBCR_RSTA)) this.hooks.mbusStart?.();
        } else if (this.mbsr & MBSR_MBB) {
          this.mbsr &= ~MBSR_MBB & 0xff;
          this.hooks.mbusStop?.();
        }
        break;
      }
      case MB_BSR:
        if (!(val & MBSR_MIF)) this.mbsr &= ~MBSR_MIF & 0xff;
        break;
      case MB_BDR:
        this.mbdr = val & 0xff;
        if (this.mbusLog.length < 4096) this.mbusLog.push(val);
        this.hooks.mbusByte?.(val);
        this.mbusTransferDone();
        break;
    }
    this.updateIrq();
  }

  read8(off: number): number {
    this.reads.set(off, (this.reads.get(off) ?? 0) + 1);

    if (off >= MBUS_BASE && off < MBUS_END) {
      return off & 1 ? this.mbusRead((off - MBUS_BASE) >> 1) : 0;
    }

    if (off >= UART_BASE && off < UART_END) {
      return off & 1 ? this.uartRead((off - UART_BASE) >> 1) : 0;
    }

    for (let i = 0; i < 2; i++) {
      const base = TIMER_BASE[i];
      if (off === base + TCN) return (this.timers[i].count >> 8) & 0xff;
      if (off === base + TCN + 1) return this.timers[i].count & 0xff;
      if (off === base + TER) return this.timers[i].event ? 0x02 : 0x00;
    }

    if (off === 0x14 || off === 0x15) {
      const ddr = this.r16(0x12);
      const v = (this.portAIn & ~ddr) | (this.r16(0x14) & ddr);
      return (off === 0x14 ? v >> 8 : v) & 0xff;
    }
    if (off === 0x1a || off === 0x1b) {
      const ddr = this.r16(0x18);
      const v = (this.portBIn & ~ddr) | (this.r16(0x1a) & ddr);
      return (off === 0x1a ? v >> 8 : v) & 0xff;
    }

    return this.regs[off];
  }

  write8(off: number, val: number): void {
    this.writes.set(off, (this.writes.get(off) ?? 0) + 1);
    this.regs[off] = val & 0xff;

    if (off >= MBUS_BASE && off < MBUS_END) {
      if (off & 1) this.mbusWrite((off - MBUS_BASE) >> 1, val & 0xff);
      return;
    }

    if (off >= UART_BASE && off < UART_END) {
      if (off & 1) this.uartWrite((off - UART_BASE) >> 1, val & 0xff);
      this.updateIrq();
      return;
    }

    if (off === 0x14 || off === 0x15) {
      this.hooks.portA?.(this.r16(0x14) & this.r16(0x12));
    } else if (off === 0x1a || off === 0x1b) {
      this.hooks.portB?.(this.r16(0x1a) & this.r16(0x18));
    }

    for (let i = 0; i < 2; i++) {
      const base = TIMER_BASE[i];
      if (off === base + TMR + 1) {
        this.timers[i].count = this.r16(base + TRR) || 0x10000;
        this.timers[i].prescale = 0;
      }
      if (off === base + TER) {
        if (val & 0x02) this.timers[i].event = false;
      }
    }
    this.updateIrq();
  }

  private timerEnabled(i: number): boolean {
    return (this.r16(TIMER_BASE[i] + TMR) & 0x0001) !== 0;
  }

  private timerIrqEnabled(i: number): boolean {
    return (this.r16(TIMER_BASE[i] + TMR) & 0x0010) !== 0;
  }

  private timerPrescale(i: number): number {
    return ((this.r16(TIMER_BASE[i] + TMR) >> 8) & 0xff) + 1;
  }

  tick(cycles: number): void {
    let changed = false;
    for (let i = 0; i < 2; i++) {
      if (!this.timerEnabled(i)) continue;
      const t = this.timers[i];
      const scale = this.timerPrescale(i);
      t.prescale += cycles;
      const ticks = Math.floor(t.prescale / scale);
      if (ticks === 0) continue;
      t.prescale -= ticks * scale;

      const ref = this.r16(TIMER_BASE[i] + TRR) || 0x10000;
      t.count -= ticks;
      while (t.count <= 0) {
        t.count += ref;
        if (!t.event) {
          t.event = true;
          changed = true;
        }
      }
    }
    if (changed) this.updateIrq();
  }

  private sourceLevel(i: number): number {
    const picr = this.r16(0x24);
    return (picr >> (12 - i * 4)) & 0x0f;
  }

  private static readonly SOURCE = [0x0a, 0x0b, 0x0c, 0x0d];

  private sourcePending(i: number): boolean {
    if (i === 0 || i === 1) return this.timers[i].event && this.timerIrqEnabled(i);
    if (i === 2) return (this.uartIsr & this.uartImr) !== 0;
    return (this.mbcr & MBCR_MIEN) !== 0 && (this.mbsr & MBSR_MIF) !== 0;
  }

  request(): [number, number | null] {
    let best = 0;
    let source = -1;
    for (let i = 0; i < 4; i++) {
      if (!this.sourcePending(i)) continue;
      const level = this.sourceLevel(i) & 7;
      if (level > best) {
        best = level;
        source = i;
      }
    }

    const licr2 = this.r16(0x22);
    if (this.extInt && (licr2 & 0x8) && (licr2 & 7) > best) {
      return [licr2 & 7, (this.r16(0x26) & 0xf0) | 0x09];
    }

    if (source < 0) return [0, null];
    if (source === 2) return [best, this.uartIvr];
    const pivr = this.r16(0x26) & 0xf0;
    return [best, pivr | M68307Sim.SOURCE[source]];
  }

  private updateIrq(): void {
    this.hooks.irqChanged?.();
  }

  private extInt = false;

  setExternalInt(active: boolean): void {
    if (this.extInt === active) return;
    this.extInt = active;
    this.updateIrq();
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
