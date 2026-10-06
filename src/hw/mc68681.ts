
const R_MR = 0x0;
const R_SR = 0x1;
const R_CR = 0x2;
const R_HR = 0x3;
const R_IPCR = 0x4;
const R_ISR = 0x5;
const R_CTU = 0x6;
const R_CTL = 0x7;
const R_MR_B = 0x8;
const R_SR_B = 0x9;
const R_CR_B = 0xa;
const R_HR_B = 0xb;
const R_IVR = 0xc;
const R_IP = 0xd;
const R_SOPBC = 0xe;
const R_ROPBC = 0xf;

const SR_RXRDY = 0x01;
const SR_FFULL = 0x02;
const SR_TXRDY = 0x04;
const SR_TXEMT = 0x08;
const SR_OVERRUN = 0x10;

const RX_FIFO_SIZE = 4;

const ISR_TXRDY_A = 0x01;
const ISR_RXRDY_A = 0x02;
const ISR_COUNTER = 0x08;
const ISR_TXRDY_B = 0x10;
const ISR_RXRDY_B = 0x20;

export interface DuartHooks {
  txByte?(channel: 0 | 1, v: number): void;
  outputPort?(v: number, was: number): void;
  irqChanged?(): void;
  txDreq?(channel: 0 | 1, requesting: boolean): void;
}

interface Channel {
  mr: [number, number];
  mrPointer: number;
  txEnabled: boolean;
  rxEnabled: boolean;
  rx: number[];
  overrun: boolean;
  txPipe: number[];
  txRemain: number;
}

function newChannel(): Channel {
  return {
    mr: [0, 0], mrPointer: 0, txEnabled: false, rxEnabled: false, rx: [],
    overrun: false, txPipe: [], txRemain: 0,
  };
}

const BAUD_ACR_0_340 = [50, 110, 134, 200, 300, 600, 1200, 1050,
                        2400, 4800, 7200, 9600, 38400, 76800, 0, 0];
const BAUD_ACR_1_340 = [75, 110, 134, 150, 300, 600, 1200, 2000,
                        2400, 4800, 1800, 9600, 19200, 38400, 0, 0];

const X1_HZ = 3_686_400;

const CHAR_TICKS_DEFAULT = 3840;

const CSR_SCLK_16 = 0x0e;
const CSR_SCLK_1 = 0x0f;

export class Mc68681 {
  private readonly ch: [Channel, Channel] = [newChannel(), newChannel()];

  private isr = 0;
  private imr = 0;
  private ivr = 0x0f;
  private acr = 0;
  private opcr = 0;
  private opr = 0;
  inputPort = 0xff;

  private readonly csr: [number, number] = [0, 0];

  sclkHz = 0;

  txPaced = false;

  private readonly txDreqLevel: [boolean, boolean] = [false, false];

  private updateTxDreq(channel: 0 | 1): void {
    const c = this.ch[channel];
    const routed = (this.opcr & (channel === 0 ? 0x40 : 0x80)) !== 0;
    this.setTxDreq(channel, routed && c.txEnabled && c.txPipe.length < 2);
  }

  private setTxDreq(channel: 0 | 1, requesting: boolean): void {
    if (requesting === this.txDreqLevel[channel]) return;
    this.txDreqLevel[channel] = requesting;
    this.hooks.txDreq?.(channel, requesting);
  }

  txBaud(channel: 0 | 1): number {
    if (!this.csr[channel]) return 0;
    const select = this.csr[channel] & 0x0f;
    const table = this.acr & 0x80 ? BAUD_ACR_1_340 : BAUD_ACR_0_340;
    return select === CSR_SCLK_16 ? this.sclkHz / 16
      : select === CSR_SCLK_1 ? this.sclkHz
        : table[select] ?? 0;
  }

  characterTicks(channel: 0 | 1): number {
    if (!this.csr[channel]) return CHAR_TICKS_DEFAULT;
    const select = this.csr[channel] & 0x0f;
    const table = this.acr & 0x80 ? BAUD_ACR_1_340 : BAUD_ACR_0_340;
    const baud = select === CSR_SCLK_16 ? this.sclkHz / 16
      : select === CSR_SCLK_1 ? this.sclkHz
        : table[select];
    if (!baud) return CHAR_TICKS_DEFAULT;
    const c = this.ch[channel];
    const data = 5 + (c.mr[0] & 3);
    const parityMode = (c.mr[0] >> 3) & 3;
    const parity = parityMode === 2 || parityMode === 3 ? 0 : 1;
    const stop = (c.mr[1] & 0x0f) < 8 ? 1 : 2;
    return Math.round((X1_HZ / baud) * (1 + data + parity + stop));
  }

  private ctReload = 0;
  private counter = 0;
  private counterRunning = false;
  private halfPeriod = 0;
  private prescale = 0;

  readonly txLog: number[] = [];

  constructor(private readonly hooks: DuartHooks = {}) {}

  reset(): void {
    this.ch[0] = newChannel();
    this.ch[1] = newChannel();
    this.isr = 0;
    this.imr = 0;
    this.ivr = 0x0f;
    this.acr = 0;
    this.opcr = 0;
    this.opr = 0;
    this.ctReload = 0;
    this.counter = 0;
    this.counterRunning = false;
    this.halfPeriod = 0;
    this.prescale = 0;
    this.txLog.length = 0;
    this.csr[0] = 0;
    this.csr[1] = 0;
    this.txDreqLevel[0] = false;
    this.txDreqLevel[1] = false;
  }

  setIP(bit: number, state: boolean | number): void {
    const mask = 1 << (bit & 7);
    if (state) this.inputPort |= mask;
    else this.inputPort &= ~mask & 0xff;
  }

  irq(): boolean {
    return (this.isr & this.imr) !== 0;
  }

  vector(): number {
    return this.ivr;
  }

  setMr(channel: 0 | 1, index: 0 | 1, v: number): void {
    this.ch[channel].mr[index] = v & 0xff;
  }

  getMr(channel: 0 | 1, index: 0 | 1): number {
    return this.ch[channel].mr[index];
  }

  rxEnabled(channel: 0 | 1): boolean {
    return this.ch[channel].rxEnabled;
  }

  rxSpace(channel: 0 | 1): number {
    return Math.max(0, RX_FIFO_SIZE - this.ch[channel].rx.length);
  }

  outputs(): number {
    return this.opr;
  }

  receive(channel: 0 | 1, v: number): void {
    const c = this.ch[channel];
    if (c.rx.length >= RX_FIFO_SIZE) c.overrun = true;
    else c.rx.push(v & 0xff);
    this.refresh();
  }

  private status(c: Channel): number {
    let sr = 0;
    if (c.txEnabled) {
      if (c.txPipe.length < 2) sr |= SR_TXRDY;
      if (c.txPipe.length === 0) sr |= SR_TXEMT;
    }
    if (c.rx.length) sr |= SR_RXRDY;
    if (c.rx.length >= RX_FIFO_SIZE) sr |= SR_FFULL;
    if (c.overrun) sr |= SR_OVERRUN;
    return sr;
  }

  private transmit(channel: 0 | 1, v: number): void {
    const c = this.ch[channel];
    const loopback = (c.mr[1] & 0xc0) === 0x80;
    if (!loopback && !this.txPaced) {
      if (this.txLog.length < 4096) this.txLog.push(v);
      this.hooks.txByte?.(channel, v);
      return;
    }
    if (c.txPipe.length >= 2) return;
    this.setTxDreq(channel, false);
    if (c.txPipe.length === 0) c.txRemain = this.charTicks(channel);
    c.txPipe.push(v & 0xff);
    this.updateTxDreq(channel);
    this.refresh();
  }

  private charTicks(channel: 0 | 1): number {
    return this.txPaced ? this.characterTicks(channel) : CHAR_TICKS_DEFAULT;
  }

  private tickTx(ticks: number): void {
    let changed = false;
    for (let i = 0; i < 2; i++) {
      const channel = i as 0 | 1;
      const c = this.ch[channel];
      let t = ticks;
      while (c.txPipe.length && t >= c.txRemain) {
        t -= c.txRemain;
        const v = c.txPipe.shift()!;
        if ((c.mr[1] & 0xc0) === 0x80) {
          if (c.rx.length >= RX_FIFO_SIZE) c.overrun = true;
          else c.rx.push(v);
        } else {
          if (this.txLog.length < 4096) this.txLog.push(v);
          this.hooks.txByte?.(channel, v);
        }
        c.txRemain = this.charTicks(channel);
        changed = true;
      }
      if (c.txPipe.length) c.txRemain -= t;
    }
    if (changed) {
      this.updateTxDreq(0);
      this.updateTxDreq(1);
      this.refresh();
    }
  }

  resync(): void {
    this.refresh();
    this.txDreqLevel[0] = false;
    this.txDreqLevel[1] = false;
    this.updateTxDreq(0);
    this.updateTxDreq(1);
  }

  private refresh(): void {
    const set = (bit: number, on: boolean) => {
      if (on) this.isr |= bit;
      else this.isr &= ~bit & 0xff;
    };
    const txReady = (c: Channel) => c.txEnabled && c.txPipe.length < 2;
    set(ISR_TXRDY_A, txReady(this.ch[0]));
    set(ISR_TXRDY_B, txReady(this.ch[1]));
    set(ISR_RXRDY_A, this.ch[0].rx.length > 0);
    set(ISR_RXRDY_B, this.ch[1].rx.length > 0);
    this.hooks.irqChanged?.();
  }

  private command(c: Channel, val: number): void {
    if (val & 0x01) c.rxEnabled = true;
    if (val & 0x02) c.rxEnabled = false;
    if (val & 0x04) c.txEnabled = true;
    if (val & 0x08) c.txEnabled = false;
    switch ((val >> 4) & 0x07) {
      case 1:
        c.mrPointer = 0;
        break;
      case 2:
        c.rxEnabled = false;
        c.rx.length = 0;
        c.overrun = false;
        break;
      case 3:
        c.txEnabled = false;
        break;
    }
    this.updateTxDreq(c === this.ch[0] ? 0 : 1);
  }

  read(reg: number): number {
    const a = this.ch[0];
    const b = this.ch[1];
    switch (reg & 0x0f) {
      case R_MR: {
        const v = a.mr[a.mrPointer];
        a.mrPointer = 1;
        return v;
      }
      case R_SR:
        return this.status(a);
      case R_HR: {
        const v = a.rx.shift() ?? 0;
        this.refresh();
        return v;
      }
      case R_IPCR:
        return this.inputPort & 0x0f;
      case R_ISR:
        return this.isr;
      case R_CTU:
        return (this.counter >> 8) & 0xff;
      case R_CTL:
        return this.counter & 0xff;
      case R_MR_B: {
        const v = b.mr[b.mrPointer];
        b.mrPointer = 1;
        return v;
      }
      case R_SR_B:
        return this.status(b);
      case R_HR_B: {
        const v = b.rx.shift() ?? 0;
        this.refresh();
        return v;
      }
      case R_IVR:
        return this.ivr;
      case R_IP:
        return this.inputPort | 0x80;
      case R_SOPBC:
        if (this.acr & 0x40) this.halfPeriod = 0;
        this.counter = Math.max(this.ctReload, 1);
        this.counterRunning = true;
        return 0xff;
      case R_ROPBC:
        if (!(this.acr & 0x40)) this.counterRunning = false;
        this.isr &= ~ISR_COUNTER & 0xff;
        this.hooks.irqChanged?.();
        return 0xff;
      default:
        return 0xff;
    }
  }

  write(reg: number, val: number): void {
    const v = val & 0xff;
    const a = this.ch[0];
    const b = this.ch[1];
    switch (reg & 0x0f) {
      case R_MR:
        a.mr[a.mrPointer] = v;
        a.mrPointer = 1;
        break;
      case R_CR:
        this.command(a, v);
        break;
      case R_HR:
        this.transmit(0, v);
        break;
      case R_IPCR: {
        const old = this.acr;
        this.acr = v;
        if ((old ^ v) & 0x40) {
          if (v & 0x40) {
            this.halfPeriod = 0;
            this.counter = Math.max(this.ctReload, 1);
            this.counterRunning = true;
          } else {
            this.counterRunning = false;
          }
        }
        break;
      }
      case R_SR:
        this.csr[0] = v;
        break;
      case R_SR_B:
        this.csr[1] = v;
        break;
      case R_ISR:
        this.imr = v;
        break;
      case R_CTU:
        this.ctReload = (this.ctReload & 0x00ff) | (v << 8);
        break;
      case R_CTL:
        this.ctReload = (this.ctReload & 0xff00) | v;
        break;
      case R_MR_B:
        b.mr[b.mrPointer] = v;
        b.mrPointer = 1;
        break;
      case R_CR_B:
        this.command(b, v);
        break;
      case R_HR_B:
        this.transmit(1, v);
        break;
      case R_IVR:
        this.ivr = v;
        break;
      case R_IP:
        this.opcr = v;
        this.updateTxDreq(0);
        this.updateTxDreq(1);
        break;
      case R_SOPBC: {
        const was = this.opr;
        this.opr |= v;
        this.hooks.outputPort?.(this.opr, was);
        break;
      }
      case R_ROPBC: {
        const was = this.opr;
        this.opr &= ~v & 0xff;
        this.hooks.outputPort?.(this.opr, was);
        break;
      }
    }
    this.refresh();
  }

  idle(): boolean {
    return !this.counterRunning
      && this.ch[0].txPipe.length === 0 && this.ch[1].txPipe.length === 0;
  }

  nextEventTicks(): number {
    let n = Infinity;
    if (this.ch[0].txPipe.length) n = this.ch[0].txRemain;
    if (this.ch[1].txPipe.length && this.ch[1].txRemain < n) n = this.ch[1].txRemain;
    if (this.counterRunning) {
      let c = this.counter;
      if ((this.acr & 0x40) !== 0 && this.halfPeriod === 0) c += Math.max(this.ctReload, 1);
      const t = ((this.acr >> 4) & 3) === 3 ? c * 16 - this.prescale : c;
      if (t < n) n = t;
    }
    return n;
  }

  tick(ticks: number): void {
    this.tickTx(ticks);
    if (!this.counterRunning) return;
    let n = ticks;
    if (((this.acr >> 4) & 3) === 3) {
      this.prescale += ticks;
      n = Math.floor(this.prescale / 16);
      this.prescale -= n * 16;
    }
    if (n <= 0) return;
    const was = this.irq();
    this.counter -= n;
    while (this.counter <= 0) {
      if (this.acr & 0x40) {
        this.halfPeriod ^= 1;
        if (!this.halfPeriod) this.isr |= ISR_COUNTER;
        this.counter += Math.max(this.ctReload, 1);
      } else {
        this.isr |= ISR_COUNTER;
        this.counter += 0xffff;
      }
    }
    if (this.irq() !== was) this.hooks.irqChanged?.();
  }

  debugState(): { acr: number; opcr: number; opr: number; imr: number } {
    return { acr: this.acr, opcr: this.opcr, opr: this.opr, imr: this.imr };
  }
}
