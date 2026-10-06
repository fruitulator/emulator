import { Mc68681 } from './mc68681';

const ICR_BASE = 0x14;
const OFF_IMR = 0x36;
const OFF_IPR = 0x3a;
const OFF_RSR = 0x40;
const OFF_SYPCR = 0x41;
const OFF_SWSR = 0x43;

const DEV_TIMER1 = 8;
const DEV_TIMER2 = 9;
const DEV_UART1 = 11;
const DEV_UART2 = 12;

export const RSR_POWER = 0x80;
export const RSR_WATCHDOG = 0x20;

const TIMER_BASE = [0x100, 0x120];
const TMR_RST = 0x0001;
const TMR_ORI = 0x0010;
const TMR_FRR = 0x0008;

const SYPCR_SWE = 0x80;
const SYPCR_SWRI = 0x40;

export interface Mcf5206eHooks {
  watchdogReset?(): void;
  chipSelectWritten?(): void;
  parallelOut?(v: number): void;
  parallelIn?(): number;
  uartTx?(uart: 1 | 2, channel: 0 | 1, v: number): void;
  mbusByte?(v: number): void;
  mbusRead?(): number;
  mbusStart?(): void;
  mbusRepeatedStart?(): void;
  mbusStop?(): void;
}

const OFF_MBCR = 0x1e8;
const OFF_MBSR = 0x1ec;
const OFF_MBDR = 0x1f0;

const MBCR_MEN = 0x80;
const MBCR_MSTA = 0x20;
const MBCR_MTX = 0x10;
const MBCR_RSTA = 0x04;

const MBSR_MCF = 0x80;
const MBSR_MBB = 0x20;
const MBSR_MIF = 0x02;
const MBSR_RXAK = 0x01;

interface Timer {
  count: number;
  event: boolean;
  prescale: number;
  lastNow: number;
  deadline: number;
}

export class Mcf5206e {
  readonly regs = new Uint8Array(0x400);

  readonly reads = new Map<number, number>();
  readonly writes = new Map<number, number>();

  readonly icr = new Uint8Array(15);
  imr = 0xfffe;

  private irqDirty = true;
  private cachedReq: [number, number | null] = [0, null];

  private readonly timers: Timer[] = [
    { count: 0, event: false, prescale: 0, lastNow: 0, deadline: 0 },
    { count: 0, event: false, prescale: 0, lastNow: 0, deadline: 0 },
  ];
  private now = 0;

  readonly uart1: Mc68681;
  readonly uart2: Mc68681;

  private watchdogElapsed = 0;
  private swsrArmed = false;
  watchdogFires = 0;

  private mbcr = 0;
  private mbsr = 0;
  private mbdr = 0xff;
  readonly mbusLog: number[] = [];

  constructor(
    private readonly hooks: Mcf5206eHooks = {},
    private readonly watchdogCycles = 320_000_000,
  ) {
    this.uart1 = new Mc68681({
      txByte: (ch, v) => this.hooks.uartTx?.(1, ch, v),
      irqChanged: () => { this.irqDirty = true; },
    });
    this.uart2 = new Mc68681({
      txByte: (ch, v) => this.hooks.uartTx?.(2, ch, v),
      irqChanged: () => { this.irqDirty = true; },
    });
    this.reset();
  }

  reset(cause = RSR_POWER): void {
    this.regs.fill(0);
    this.regs[OFF_RSR] = cause;
    this.icr.fill(0);
    this.icr[7] = 0x1c;
    this.icr[DEV_TIMER1] = 0x80;
    this.icr[DEV_TIMER2] = 0x80;
    this.icr[10] = 0x80;
    this.imr = 0xfffe;
    this.now = 0;
    for (const t of this.timers) {
      t.count = 0;
      t.event = false;
      t.prescale = 0;
      t.lastNow = 0;
      t.deadline = 0;
    }
    this.uart1.reset();
    this.uart2.reset();
    this.extIrq.fill(false);
    this.mbcr = 0;
    this.mbsr = 0;
    this.mbdr = 0xff;
    this.watchdogElapsed = 0;
    this.swsrArmed = false;
    this.irqDirty = true;
    this.reads.clear();
    this.writes.clear();
  }

  private mbusTransferDone(): void {
    this.mbsr |= MBSR_MCF | MBSR_MIF;
    this.mbsr &= ~MBSR_RXAK & 0xff;
  }

  private r16(off: number): number {
    return ((this.regs[off] << 8) | this.regs[off + 1]) & 0xffff;
  }

  private readonly extIrq = [false, false, false, false, false, false, false];

  setExternalIrq(pin: number, active: boolean): void {
    if (pin >= 1 && pin <= 7) {
      this.extIrq[pin - 1] = active;
      this.irqDirty = true;
    }
  }

  private devicePending(i: number): boolean {
    if (i < 7) return this.extIrq[i];
    switch (i) {
      case DEV_TIMER1:
        return this.timers[0].event && (this.r16(TIMER_BASE[0]) & TMR_ORI) !== 0;
      case DEV_TIMER2:
        return this.timers[1].event && (this.r16(TIMER_BASE[1]) & TMR_ORI) !== 0;
      case DEV_UART1:
        return this.uart1.irq();
      case DEV_UART2:
        return this.uart2.irq();
      default:
        return false;
    }
  }

  private iprValue(): number {
    let v = 0;
    for (let i = 0; i < 15; i++) if (this.devicePending(i)) v |= 1 << (i + 1);
    return v;
  }

  request(): [number, number | null] {
    if (this.irqDirty) {
      this.cachedReq = this.computeRequest();
      this.irqDirty = false;
    }
    return this.cachedReq;
  }

  private computeRequest(): [number, number | null] {
    let best = -1;
    let bestPri = -1;
    let vector: number | null = null;
    for (let i = 0; i < 15; i++) {
      if (this.imr & (1 << (i + 1))) continue;
      if (!this.devicePending(i)) continue;
      const icr = this.icr[i];
      const level = (icr >> 2) & 7;
      const pri = icr & 3;
      if (level > best || (level === best && pri > bestPri)) {
        best = level;
        bestPri = pri;
        if (icr & 0x80) vector = null;
        else if (i === DEV_UART1) vector = this.uart1.vector();
        else if (i === DEV_UART2) vector = this.uart2.vector();
        else vector = null;
      }
    }
    return best < 0 ? [0, null] : [best, vector];
  }

  read8(off: number): number {
    this.reads.set(off, (this.reads.get(off) ?? 0) + 1);

    if (off >= ICR_BASE && off < ICR_BASE + 15) return this.icr[off - ICR_BASE];
    if (off === OFF_IMR) return (this.imr >> 8) & 0xff;
    if (off === OFF_IMR + 1) return this.imr & 0xff;
    if (off === OFF_IPR) return (this.iprValue() >> 8) & 0xff;
    if (off === OFF_IPR + 1) return this.iprValue() & 0xff;

    for (let i = 0; i < 2; i++) {
      const rel = off - TIMER_BASE[i];
      if (rel < 0 || rel > 0x11) continue;
      const t = this.timers[i];
      if (rel === 0x0c || rel === 0x0d || rel === 0x11) this.advanceTimer(i);
      if (rel === 0x0c) return (t.count >> 8) & 0xff;
      if (rel === 0x0d) return t.count & 0xff;
      if (rel === 0x11) return t.event ? 0x03 : 0x00;
      return this.regs[off];
    }

    if (off >= 0x140 && off < 0x180) {
      return (off & 3) === 0 ? this.uart1.read((off - 0x140) >> 2) : 0;
    }
    if (off >= 0x180 && off < 0x1c0) {
      return (off & 3) === 0 ? this.uart2.read((off - 0x180) >> 2) : 0;
    }

    if (off === 0x1c9) {
      const dir = this.regs[0x1c5];
      const inPins = this.hooks.parallelIn?.() ?? 0xff;
      return ((this.regs[0x1c9] & dir) | (inPins & ~dir)) & 0xff;
    }

    if (off === OFF_MBCR) return this.mbcr;
    if (off === OFF_MBSR) return this.mbsr;
    if (off === OFF_MBDR) {
      const v = this.mbdr;
      if ((this.mbcr & MBCR_MSTA) && !(this.mbcr & MBCR_MTX)) {
        this.mbdr = (this.hooks.mbusRead?.() ?? 0xff) & 0xff;
        this.mbusTransferDone();
      }
      return v;
    }

    return this.regs[off];
  }

  write8(off: number, val: number): void {
    this.writes.set(off, (this.writes.get(off) ?? 0) + 1);
    const v = val & 0xff;

    if (off >= ICR_BASE && off < ICR_BASE + 15) {
      const i = off - ICR_BASE;
      if (i === 7) this.icr[i] = (v & 0x03) | 0x1c;
      else if (i === DEV_TIMER1 || i === DEV_TIMER2 || i === 10) this.icr[i] = (v & 0x1f) | 0x80;
      else this.icr[i] = v;
      this.irqDirty = true;
      return;
    }
    if (off === OFF_IMR) {
      this.imr = ((v << 8) | (this.imr & 0xff)) & 0xffff;
      this.irqDirty = true;
      return;
    }
    if (off === OFF_IMR + 1) {
      this.imr = ((this.imr & 0xff00) | v) & 0xffff;
      this.irqDirty = true;
      return;
    }
    if (off === OFF_SWSR) {
      if (v === 0x55) {
        this.swsrArmed = true;
      } else if (this.swsrArmed && v === 0xaa) {
        this.watchdogElapsed = 0;
        this.swsrArmed = false;
      } else {
        this.swsrArmed = false;
      }
      return;
    }
    if (off === OFF_RSR) return;

    for (let i = 0; i < 2; i++) {
      const rel = off - TIMER_BASE[i];
      if (rel < 0 || rel > 0x11) continue;
      const t = this.timers[i];
      this.irqDirty = true;
      this.advanceTimer(i);
      if (rel === 0x11) {
        if (v & 0x03) t.event = false;
        this.recomputeDeadline(i);
        return;
      }
      this.regs[off] = v;
      if (rel === 0x00 || rel === 0x01) {
        t.count = 0;
        t.prescale = 0;
      }
      if (rel === 0x0c || rel === 0x0d) t.count = this.r16(TIMER_BASE[i] + 0x0c);
      this.recomputeDeadline(i);
      return;
    }

    if (off >= 0x140 && off < 0x1c0) {
      const uart = off < 0x180 ? this.uart1 : this.uart2;
      const base = off < 0x180 ? 0x140 : 0x180;
      this.irqDirty = true;
      if ((off & 3) === 0) uart.write((off - base) >> 2, v);
      return;
    }

    if (off === OFF_MBCR) {
      const wasEnabled = (this.mbcr & MBCR_MEN) !== 0;
      const wasMaster = (this.mbcr & MBCR_MSTA) !== 0;
      this.mbcr = v & ~MBCR_RSTA & 0xff;
      if (!(v & MBCR_MEN)) {
        this.mbsr = 0;
        return;
      }
      if (v & MBCR_MSTA) {
        if (wasEnabled && !wasMaster) {
          this.mbsr |= MBSR_MBB;
          this.hooks.mbusStart?.();
        } else if (wasMaster && (v & MBCR_RSTA)) {
          this.hooks.mbusRepeatedStart?.();
        }
      } else if (this.mbsr & MBSR_MBB) {
        this.mbsr &= ~MBSR_MBB & 0xff;
        this.hooks.mbusStop?.();
      }
      return;
    }
    if (off === OFF_MBSR) {
      if (!(v & MBSR_MIF)) this.mbsr &= ~MBSR_MIF & 0xff;
      return;
    }
    if (off === OFF_MBDR) {
      if (this.mbusLog.length < 4096) this.mbusLog.push(v);
      this.hooks.mbusByte?.(v);
      this.mbusTransferDone();
      return;
    }

    this.regs[off] = v;
    if (off >= 0x64 && off <= 0xc2) this.hooks.chipSelectWritten?.();
    if (off === 0x1c9) {
      this.hooks.parallelOut?.(this.regs[0x1c9] & this.regs[0x1c5]);
    }
  }

  nextDeadline(): number {
    let h = 1 << 30;
    const t0 = this.timers[0];
    if (t0.deadline !== 0 && t0.deadline - this.now < h) h = t0.deadline - this.now;
    const t1 = this.timers[1];
    if (t1.deadline !== 0 && t1.deadline - this.now < h) h = t1.deadline - this.now;
    if (this.regs[OFF_SYPCR] & SYPCR_SWE) {
      const w = this.watchdogCycles - this.watchdogElapsed;
      if (w < h) h = w;
    }
    return h < 0 ? 0 : h;
  }

  tick(cycles: number): void {
    this.now += cycles;
    const t0 = this.timers[0];
    if (t0.deadline !== 0 && this.now >= t0.deadline) this.advanceTimer(0);
    const t1 = this.timers[1];
    if (t1.deadline !== 0 && this.now >= t1.deadline) this.advanceTimer(1);

    const sypcr = this.regs[OFF_SYPCR];
    if (!(sypcr & SYPCR_SWE)) return;
    this.watchdogElapsed += cycles;
    if (this.watchdogElapsed < this.watchdogCycles) return;
    this.watchdogElapsed = 0;
    this.watchdogFires++;
    if (sypcr & SYPCR_SWRI) this.hooks.watchdogReset?.();
  }

  private advanceTimer(i: number): void {
    const t = this.timers[i];
    const elapsed = this.now - t.lastNow;
    t.lastNow = this.now;

    const tmr = this.r16(TIMER_BASE[i]);
    if (!(tmr & TMR_RST)) { t.deadline = 0; return; }

    const scale = ((tmr >> 8) & 0xff) + 1;
    t.prescale += elapsed;
    const ticks = Math.floor(t.prescale / scale);
    t.prescale -= ticks * scale;

    const ref = this.r16(TIMER_BASE[i] + 0x04) || 0x10000;
    let remaining = ticks;
    while (remaining > 0) {
      const toRef = ref - t.count;
      const step = Math.min(remaining, toRef > 0 ? toRef : ref);
      t.count = (t.count + step) & 0xffff;
      remaining -= step;
      if (t.count === (ref & 0xffff)) {
        if (!t.event) this.irqDirty = true;
        t.event = true;
        if (tmr & TMR_FRR) t.count = 0;
      }
    }

    this.recomputeDeadline(i, tmr, scale, ref);
  }

  private recomputeDeadline(i: number, tmr?: number, scale?: number, ref?: number): void {
    const t = this.timers[i];
    tmr ??= this.r16(TIMER_BASE[i]);
    if (!(tmr & TMR_RST)) { t.deadline = 0; return; }
    scale ??= ((tmr >> 8) & 0xff) + 1;
    ref ??= this.r16(TIMER_BASE[i] + 0x04) || 0x10000;
    let inc = (ref - t.count) & 0xffff;
    if (inc === 0) inc = 0x10000;
    t.deadline = t.lastNow + inc * scale - t.prescale;
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
