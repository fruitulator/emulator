import type { Bus16 } from './bus68k';
import {
  ENCODINGS, stateIrq, stateReset, F_I, F_UI, type Encoding,
} from './h8ops';

const STATE_RESET = 0x10000;
const STATE_IRQ = 0x10001;

const BY_WORD: (Encoding[] | undefined)[] = new Array(0x10000);

const firstWord = (e: Encoding): [number, number] => {
  switch (e.slot) {
    case 0: return [e.val & 0xffff, e.mask & 0xffff];
    case 1: return [e.val >>> 16, e.mask >>> 16];
    case 4: return [e.val0, e.mask0];
    default: throw new Error(`h8: encoding "${e.name}" matches on window ${e.slot}, `
      + 'which only the H8S bit-on-absolute forms use');
  }
};

for (const e of ENCODINGS) {
  const [val, mask] = firstWord(e);
  const free: number[] = [];
  for (let b = 0; b < 16; b++) if (!(mask & (1 << b))) free.push(b);
  for (let i = 0; i < (1 << free.length); i++) {
    let w = val;
    for (let b = 0; b < free.length; b++) if (i & (1 << b)) w |= 1 << free[b];
    (BY_WORD[w] ??= []).push(e);
  }
}

export class IllegalInstruction extends Error {
  constructor(readonly addr: number, readonly word: number) {
    super(`h8: illegal instruction ${word.toString(16).padStart(4, '0')} at ${addr.toString(16)}`);
  }
}

export class H8 {
  readonly r = new Uint16Array(16);

  readonly ir = new Uint16Array(5);

  pc = 0;
  npc = 0;
  ppc = 0;
  pir = 0;
  ccr = 0;
  exr = 0;
  tmp1 = 0;
  tmp2 = 0;

  icount = 0;

  totalCycles = 0;

  instState = STATE_RESET;
  private requestedState = -1;

  modeAdvanced = true;

  syscr = 0x09;

  irqVector = 0;
  irqLevel = 0;
  irqNmi = false;
  takenIrqVector = 0;
  takenIrqLevel = 0;

  intc: { setFilter(icr: number, ipr: number): void; interruptTaken(vector: number): void } | null = null;

  irqFilterLevel = 0;

  sleeping = false;

  constructor(private readonly bus: Bus16) {}

  read16i(addr: number): number {
    this.icount -= 2;
    return this.bus.read16(addr & 0xfffffe);
  }

  read8(addr: number): number {
    this.icount -= 2;
    return this.bus.read8(addr & 0xffffff);
  }

  write8(addr: number, val: number): void {
    this.icount -= 2;
    this.bus.write8(addr & 0xffffff, val & 0xff);
  }

  read16(addr: number): number {
    this.icount -= 2;
    return this.bus.read16(addr & 0xfffffe);
  }

  write16(addr: number, val: number): void {
    this.icount -= 2;
    this.bus.write16(addr & 0xfffffe, val & 0xffff);
  }

  internal(cycles: number): void {
    this.icount -= cycles + 1;
  }

  r8r(reg: number): number {
    return reg & 8 ? this.r[reg & 7] & 0xff : this.r[reg & 7] >> 8;
  }

  r8w(reg: number, val: number): void {
    if (reg & 8) this.r[reg & 7] = (this.r[reg & 7] & 0xff00) | (val & 0xff);
    else this.r[reg & 7] = (this.r[reg & 7] & 0xff) | ((val & 0xff) << 8);
  }

  r16r(reg: number): number {
    return this.r[reg & 0xf];
  }

  r16w(reg: number, val: number): void {
    this.r[reg & 0xf] = val & 0xffff;
  }

  r32r(reg: number): number {
    return ((this.r[reg & 7] | (this.r[(reg & 7) | 8] << 16)) >>> 0);
  }

  r32w(reg: number, val: number): void {
    this.r[reg & 7] = val & 0xffff;
    this.r[(reg & 7) | 8] = (val >>> 16) & 0xffff;
  }

  prefetchDone(): void {
    if (this.requestedState !== -1) {
      this.instState = this.requestedState;
      this.requestedState = -1;
    } else if (this.irqVector) {
      this.instState = STATE_IRQ;
      this.takenIrqVector = this.irqVector;
      this.takenIrqLevel = this.irqLevel;
    } else {
      this.instState = this.ir[0] = this.pir;
    }
  }

  prefetchDoneNoirq(): void {
    this.instState = this.ir[0] = this.pir;
  }

  prefetchDoneNotrace(): void {
    this.prefetchDone();
  }

  prefetchSwitch(pc: number, pir: number): void {
    this.npc = pc >>> 0;
    this.pc = (pc + 2) >>> 0;
    this.pir = pir & 0xffff;
  }

  irqSetup(): void {
    if (this.syscr & 0x08) this.ccr |= F_I;
    else this.ccr |= F_I | F_UI;
  }

  updateIrqFilter(): void {
    if (this.syscr & 0x08) this.irqFilterLevel = this.ccr & F_I ? 2 : 0;
    else if ((this.ccr & (F_I | F_UI)) === (F_I | F_UI)) this.irqFilterLevel = 2;
    else if (this.ccr & F_I) this.irqFilterLevel = 1;
    else this.irqFilterLevel = 0;
    this.intc?.setFilter(this.irqFilterLevel, -1);
  }

  interruptTaken(): void {
    if (this.intc) this.intc.interruptTaken(this.takenIrqVector);
    else this.irqVector = 0;
  }

  exceptionHook(_vector: number): void {}

  illegal(): never {
    throw new IllegalInstruction(this.ppc, this.ir[0]);
  }

  sleep(): void {
    if (!this.irqVector) {
      this.sleeping = true;
      if (this.icount > 0) this.icount = 0;
      return;
    }
    this.sleeping = false;
    this.npc = this.pc & 0xffffff;
    this.pir = this.read16i(this.pc);
    this.pc = (this.pc + 2) >>> 0;
    this.prefetchDone();
  }

  setIrq(vector: number, level: number, nmi = false): void {
    this.irqVector = vector;
    this.irqLevel = level;
    this.irqNmi = nmi;
  }

  reset(): void {
    this.r.fill(0);
    this.ir.fill(0);
    this.pc = this.npc = this.ppc = this.pir = 0;
    this.ccr = this.exr = 0;
    this.tmp1 = this.tmp2 = 0;
    this.irqVector = this.irqLevel = 0;
    this.irqNmi = false;
    this.syscr = 0x09;
    this.sleeping = false;
    this.requestedState = -1;
    this.instState = STATE_RESET;
    this.totalCycles = 0;
  }

  private peek16(addr: number): number {
    return this.bus.read16(addr & 0xfffffe);
  }

  private decode(): Encoding {
    const w0 = this.ir[0];
    const bucket = BY_WORD[w0];
    if (bucket) {
      for (const e of bucket) {
        if (e.slot === 0) return e;
        if (e.slot === 1) {
          const w = ((w0 << 16) | this.peek16(this.pc)) >>> 0;
          if ((w & e.mask) >>> 0 === e.val) return e;
        } else {
          const w = ((this.peek16(this.pc) << 16) | this.peek16(this.pc + 2)) >>> 0;
          if ((w & e.mask) >>> 0 === e.val) return e;
        }
      }
    }
    return this.illegal();
  }

  step(): number {
    const before = this.icount;
    if (this.instState === STATE_RESET) {
      stateReset(this);
    } else if (this.instState === STATE_IRQ) {
      stateIrq(this);
    } else {
      this.ppc = this.npc;
      this.decode().run(this);
    }
    const spent = before - this.icount;
    this.totalCycles += spent;
    return spent;
  }

  run(cycles: number): number {
    this.icount += cycles;
    const start = this.icount;
    while (this.icount > 0) this.step();
    return start - this.icount;
  }
}
