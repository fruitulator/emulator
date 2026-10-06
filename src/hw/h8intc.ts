import type { H8 } from '../cpu/h8';

const MAX_VECTORS = 256;

const LEVEL_LOW = 0;
const EDGE_FALL = 1;
const EDGE_RISE = 2;

const VECTOR_TO_SLOT: readonly number[] = [
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, 0, 1, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4,
  5, 5, 5, 5, 6, 6, 6, 6,
  7, 7, 7, 7, 8, 8, 8, 8,
  9, 9, 9, 9, 10, 10, 10, 10,
  11, 11, 11, 11, 12, 12, 12, 12,
  13, 13, 13, 13, 14, 14, 14, 14,
];

export class H8Intc {
  private readonly pending = new Uint32Array(MAX_VECTORS / 32);

  private readonly irqType = new Uint8Array(8);
  private irqInput = 0;
  private nmiInput = false;
  private nmiType = EDGE_FALL;

  private ier = 0;
  private isr = 0;
  private iscr = 0;
  private icr = 0;

  private icrFilter = 0;
  private iprFilter = 0;

  private readonly irqVectorBase = 12;
  private readonly irqVectorCount = 8;
  private readonly irqVectorNmi = 7;

  readonly #cpu: H8;

  constructor(cpu: H8) {
    this.#cpu = cpu;
    cpu.intc = this;
  }

  reset(): void {
    this.irqType.fill(LEVEL_LOW);
    this.nmiType = EDGE_FALL;
    this.pending.fill(0);
    this.iscr = 0;
    this.ier = 0;
    this.isr = 0;
    this.icr = 0;
    this.checkLevelIrqs(false);
  }

  internalInterrupt(vector: number): void {
    this.pending[vector >> 5] |= 1 << (vector & 31);
    this.update();
  }

  interruptTaken(vector: number): void {
    this.pending[vector >> 5] &= ~(1 << (vector & 31));
    if (vector >= this.irqVectorBase && vector < this.irqVectorBase + this.irqVectorCount) {
      const irq = vector - this.irqVectorBase;
      const mask = 1 << irq;
      if (this.irqType[irq] !== LEVEL_LOW || !(this.irqInput & mask)) this.isr &= ~mask;
    }
    this.update();
  }

  setInput(inputnum: number, state: boolean): void {
    const mask = 1 << inputnum;
    const cur = this.irqInput & mask;
    let set = false;
    switch (this.irqType[inputnum]) {
      case LEVEL_LOW: set = state; break;
      case EDGE_FALL: set = state && !cur; break;
      case EDGE_RISE: set = !state && !!cur; break;
      default: break;
    }
    if (state) this.irqInput |= mask;
    else this.irqInput &= ~mask;
    if (set) {
      this.isr |= mask;
      this.update();
    }
  }

  setNmi(state: boolean): void {
    const set = this.nmiType === EDGE_FALL ? state && !this.nmiInput : !state && this.nmiInput;
    this.nmiInput = state;
    if (set) {
      this.pending[0] |= 1 << this.irqVectorNmi;
      this.update();
    }
  }

  setFilter(icrFilter: number, iprFilter: number): void {
    this.icrFilter = icrFilter;
    this.iprFilter = iprFilter;
    this.update();
  }

  ierR(): number { return this.ier; }

  ierW(data: number): void {
    this.ier = data & 0xff;
    this.update();
  }

  iscrR(): number { return this.iscr & 0xff; }

  iscrW(data: number): void {
    this.iscr = data & 0xff;
    this.updateIrqTypes();
  }

  isrR(): number { return this.isr; }

  isrW(data: number): void {
    this.isr &= data & 0xff;
    this.checkLevelIrqs(false);
    this.update();
  }

  icrR(offset: number): number { return (this.icr >>> (8 * offset)) & 0xff; }

  icrW(offset: number, data: number): void {
    const shift = 8 * offset;
    this.icr = ((this.icr & ~(0xff << shift)) | ((data & 0xff) << shift)) >>> 0;
    this.update();
  }

  private updateIrqTypes(): void {
    for (let i = 0; i < this.irqVectorCount; i++) {
      this.irqType[i] = (this.iscr >> i) & 1 ? EDGE_FALL : LEVEL_LOW;
    }
    this.checkLevelIrqs(true);
  }

  private checkLevelIrqs(update: boolean): void {
    let set = false;
    for (let i = 0; i < this.irqVectorCount; i++) {
      const mask = 1 << i;
      if (this.irqType[i] === LEVEL_LOW && (this.irqInput & mask) && !(this.isr & mask)) {
        this.isr |= mask;
        set = true;
      }
    }
    if (set && update) this.update();
  }

  private priorityOf(vector: number): number {
    if (vector === this.irqVectorNmi) return 2;
    const slot = VECTOR_TO_SLOT[vector] ?? -1;
    if (slot === -1) return 0;
    return (this.icr >>> (slot ^ 7)) & 1;
  }

  private update(): void {
    const mask = (1 << this.irqVectorCount) - 1;
    this.pending[0] &= ~(mask << this.irqVectorBase);
    this.pending[0] |= (this.isr & this.ier & mask) << this.irqVectorBase;

    let curVector = 0;
    let curLevel = -1;
    for (let i = 0; i < this.pending.length; i++) {
      const word = this.pending[i];
      if (!word) continue;
      for (let j = 0; j < 32; j++) {
        if (!(word & (1 << j))) continue;
        const vector = i * 32 + j;
        const icrPri = this.priorityOf(vector);
        if (icrPri >= this.icrFilter && 0 > this.iprFilter) {
          const level = this.iprFilter === -1 ? icrPri : 0;
          if (level > curLevel) {
            curVector = vector;
            curLevel = level;
          }
        }
      }
    }
    this.#cpu.setIrq(curVector, curLevel, curVector === this.irqVectorNmi);
  }
}
