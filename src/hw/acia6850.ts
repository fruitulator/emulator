
const DIVIDE = [1, 16, 64, 1];
const FRAME = [10, 10, 9, 9, 10, 9, 10, 10];

const SR_RDRF = 0x01;
const SR_TDRE = 0x02;
const SR_OVRN = 0x20;
const SR_IRQ = 0x80;

export class Acia6850 {
  private tdr = 0;
  private rdr = 0;
  control = 0;
  private sr = 0;
  private dcdLatch = 0;
  private frame = 0;
  private divide = 0;
  private tdrEmpty = true;
  rts = false;
  private statusRead = false;
  private dcd = 4;
  private cts = 8;
  private resetOnce = false;
  private shift = 0;
  private bitsLeft = 0;
  private bitClock = 0;

  constructor(
    private readonly onTransmit: (byte: number) => void = () => undefined,
  ) {
    this.reset();
  }

  reset(): void {
    if (this.resetOnce) this.rts = true;
    this.rdr = 0;
    this.tdr = 0;
    this.sr = (this.sr & 0x73) | SR_TDRE;
    this.dcdLatch = 0;
    this.statusRead = false;
    this.tdrEmpty = true;
    this.resetOnce = true;
    this.bitsLeft = 0;
    this.bitClock = 0;
  }

  private updateIrq(): void {
    const rie = (this.control & 0x80) !== 0 && ((this.sr & (SR_RDRF | SR_OVRN)) !== 0 || this.dcdLatch !== 0);
    const tie = (this.control & 0x60) === 0x20 && (this.sr & SR_TDRE) !== 0;
    if (rie || tie) this.sr |= SR_IRQ;
    else this.sr &= ~SR_IRQ;
  }

  irq(): boolean {
    return (this.sr & SR_IRQ) !== 0;
  }

  read(reg: number): number {
    if (reg === 0) {
      this.statusRead = true;
      return (this.sr | this.dcd | this.cts | this.dcdLatch) & 0xff;
    }
    this.sr &= ~(SR_RDRF | SR_OVRN);
    if (this.statusRead) this.dcdLatch = 0;
    this.updateIrq();
    return this.rdr;
  }

  peekStatus(): number {
    return (this.sr | this.dcd | this.cts | this.dcdLatch) & 0xff;
  }

  write(reg: number, val: number): boolean {
    let accepted = true;
    if (reg === 0) {
      this.control = val & 0xff;
      this.divide = DIVIDE[val & 3];
      this.frame = FRAME[(val >> 2) & 7];
      this.rts = ((val >> 5) & 3) === 2;
    } else {
      if (this.tdrEmpty) {
        this.tdr = val & 0xff;
        this.tdrEmpty = false;
      } else {
        accepted = false;
      }
      this.sr &= ~SR_TDRE;
    }
    this.updateIrq();
    if ((this.control & 3) === 3) {
      this.reset();
      this.resetOnce = false;
    }
    return accepted;
  }

  tick(clocks: number): void {
    if (!this.tdrEmpty && this.bitsLeft === 0) {
      this.bitsLeft = this.frame;
      this.shift = this.tdr;
      this.tdrEmpty = true;
      this.bitClock = 0;
      if (this.cts === 0) this.sr |= SR_TDRE;
      this.updateIrq();
    }
    if (this.bitsLeft === 0) return;
    this.bitClock += clocks;
    if (this.divide > this.bitClock) return;
    this.bitClock -= this.divide;
    this.bitsLeft--;
    if (this.bitsLeft === 0) this.onTransmit(this.shift);
  }

  receive(byte: number): void {
    if (this.sr & SR_RDRF) {
      this.sr |= SR_OVRN;
      return;
    }
    this.sr |= SR_RDRF;
    this.updateIrq();
    this.rdr = byte & 0xff;
  }

  setCts(high: boolean): void {
    this.cts = high ? 8 : 0;
    if (high) this.sr &= ~SR_TDRE;
    else if (this.tdrEmpty) this.sr |= SR_TDRE;
    this.updateIrq();
  }

  setDcd(high: boolean): void {
    const was = this.dcd;
    this.dcd = high ? 4 : 0;
    if (was === 0 && this.dcd !== 0) {
      this.dcdLatch = 4;
      this.statusRead = false;
    }
    this.updateIrq();
  }
}
