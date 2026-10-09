
const CLOCK_SHIFT = [1, 5, 6, 7] as const;

class SccChannel {
  readonly wr = new Uint8Array(16);
  readonly rr = new Uint8Array(16);
  readonly fifo: number[] = [];
  brgCount = 0;
  prescale = 0;
  shift = 0;
  txBits = 0;
  txByte = 0;
  ptr = 0;
  dtr = false;
  prevWr5 = 0;

  reset(): void {
    this.wr.fill(0);
    this.rr.fill(0);
    this.rr[0] = 4;
    this.fifo.length = 0;
    this.ptr = 0;
    this.txBits = 0;
    this.dtr = false;
    this.prevWr5 = 0;
  }

  loadTx(v: number): void {
    this.txByte = v & 0xff;
    this.txBits = ((this.wr[5] >> 5) & 3) + (this.wr[4] & 1) + ((this.wr[4] >> 2) & 1) + 6;
    this.rr[0] &= ~4;
  }
}

export interface Z8530Hooks {
  dtrChanged?(channel: number, dtr: boolean): void;
  byteSent?(channel: number, byte: number): void;
}

export class Z8530 {
  readonly ch = [new SccChannel(), new SccChannel()] as const;
  private mult = 1;

  constructor(private readonly hooks: Z8530Hooks = {}) {
    this.hardwareReset(1);
  }

  hardwareReset(mult: number): void {
    this.mult = mult;
    for (const c of this.ch) {
      c.reset();
      c.brgCount = 0;
      c.prescale = 0;
      c.shift = mult * 2;
    }
  }

  read(reg: number): number {
    const c = this.ch[(1 - (reg >> 1)) & 1];
    const chan = (1 - (reg >> 1)) & 1;
    if ((reg & 1) === 0) {
      let v = 0;
      switch (c.ptr) {
        case 0: v = c.rr[0]; break;
        case 1: v = c.rr[1]; break;
        case 2: v = chan === 0 ? this.ch[0].wr[2] : 0; break;
        case 3: v = c.rr[3]; break;
        case 8: v = this.popRx(c); break;
        case 10: v = c.rr[10]; break;
        case 12: v = c.wr[12]; break;
        case 13: v = c.wr[13]; break;
        case 15: v = c.wr[15]; break;
        default: v = 0;
      }
      c.ptr = 0;
      return v;
    }
    return this.popRx(c);
  }

  private popRx(c: SccChannel): number {
    const v = c.fifo.length ? c.fifo[0] : 0;
    if (c.fifo.length) {
      c.fifo.shift();
      if (!c.fifo.length) c.rr[0] &= ~1;
    }
    return v;
  }

  write(reg: number, val: number): void {
    const chan = (1 - (reg >> 1)) & 1;
    const c = this.ch[chan];
    const v = val & 0xff;
    if (reg & 1) {
      c.loadTx(v);
      return;
    }
    const p = c.ptr;
    c.wr[p] = v;
    let resetPtr = true;
    switch (p) {
      case 0:
        resetPtr = false;
        c.ptr = v & 7;
        if (((v >> 3) & 7) === 1) c.ptr |= 8;
        else if (((v >> 3) & 7) === 5) c.rr[0] &= ~4;
        break;
      case 4:
        c.shift = CLOCK_SHIFT[v >> 6] * this.mult;
        break;
      case 5: {
        c.dtr = (v & 0x80) !== 0;
        if ((c.prevWr5 ^ v) & 0x80) this.hooks.dtrChanged?.(chan, c.dtr);
        c.prevWr5 = v;
        break;
      }
      case 8:
        c.loadTx(v);
        break;
      case 9: {
        const cmd = v >> 6;
        if (cmd === 1) this.ch[1].reset();
        else if (cmd === 2) this.ch[0].reset();
        else if (cmd === 3) this.hardwareReset(this.mult);
        break;
      }
    }
    if (resetPtr) c.ptr = 0;
  }

  tick(cycles: number): void {
    for (let i = 0; i < 2; i++) {
      const c = this.ch[i];
      if ((c.wr[14] & 3) !== 3) continue;
      c.prescale = (c.prescale + cycles) & 0xff;
      const n = c.shift >= 8 ? 0 : c.prescale >> c.shift;
      if (!n) continue;
      c.prescale &= (1 << c.shift) - 1;
      c.brgCount = ((c.brgCount - n) << 16) >> 16;
      if (c.brgCount >= 1) continue;
      c.brgCount = (c.brgCount + c.wr[12] + c.wr[13] * 256) & 0xffff;
      c.brgCount = (c.brgCount << 16) >> 16;
      c.rr[0] |= 2;
      if ((c.wr[11] & 0x18) === 0x10 && (c.wr[5] & 8) && c.txBits > 0) {
        c.txBits--;
        if (c.txBits === 0) {
          c.rr[0] |= 4;
          this.hooks.byteSent?.(i, c.txByte);
        }
      }
    }
  }

  irq(): boolean {
    if (!(this.ch[0].wr[9] & 8)) return false;
    for (const c of this.ch) {
      if ((c.wr[1] & 2) && (c.rr[0] & 4)) return true;
      if ((c.wr[1] & 0x18) === 0x18 && (c.rr[0] & 1)) return true;
    }
    return false;
  }

  receive(chan: number, byte: number): void {
    const c = this.ch[chan];
    if (c.fifo.length < 3) {
      c.fifo.push(byte & 0xff);
      c.rr[0] |= 1;
    }
  }

  txBit(chan: number): boolean {
    const c = this.ch[chan];
    if ((c.wr[11] & 0x18) !== 8 || !(c.wr[5] & 8) || c.txBits === 0) return true;
    const n = c.txBits;
    const bit = n === 1 ? true : n === 10 ? false : ((c.txByte >> (9 - n)) & 1) !== 0;
    c.txBits--;
    if (c.txBits === 0) c.rr[0] |= 4;
    return bit;
  }
}
