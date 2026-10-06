export class V20SoftSerial {
  period: number;
  private readonly parity = true;

  private rxState = 0;
  private rxByte = 0;
  private line = true;
  private rxBits = 0;
  private rxStops = 0;
  rxParity = false;
  private rxWait = 0;

  private txByte = 0;
  private txIndex = 10;
  out = true;
  private txWait = 0;

  constructor(period = 0x58c) {
    this.period = period;
    this.reset();
  }

  reset(): void {
    this.line = true;
    this.rxState = 0;
    this.rxBits = 0;
    this.out = true;
    this.txIndex = 10;
    this.rxWait = 0;
    this.txWait = 0;
  }

  get active(): boolean {
    return this.rxWait > 0 || this.txWait > 0;
  }

  get idle(): boolean {
    return this.txIndex === 10;
  }

  sample(level: boolean): boolean {
    let armed = false;
    if (this.rxState === 0 && !level && this.line) {
      this.rxWait = this.period >> 1;
      this.rxBits = 0;
      armed = true;
    }
    this.line = level;
    return armed;
  }

  send(b: number): void {
    this.txByte = b & 0xff;
    this.txIndex = 11;
    this.txWait = this.period * 2;
  }

  tick(cycles: number): number {
    if (this.txWait !== 0 && (this.txWait -= cycles) < 1) {
      switch (this.txIndex) {
        case 8: {
          let ones = 0;
          for (let v = this.txByte; v; v >>= 1) ones += v & 1;
          this.out = (ones & 1) === 0;
          this.txIndex++;
          this.txWait += this.period;
          break;
        }
        case 9:
          this.out = true;
          this.txIndex++;
          this.txWait += this.period;
          break;
        case 10:
          this.out = true;
          this.txWait = 0;
          break;
        case 11:
          this.out = false;
          this.txIndex = 0;
          this.txWait += this.period;
          break;
        default:
          this.out = ((this.txByte >> this.txIndex) & 1) !== 0;
          this.txIndex++;
          this.txWait += this.period;
      }
    }
    if (this.rxWait !== 0 && (this.rxWait -= cycles) < 1) {
      switch (this.rxState) {
        case 0:
          if (!this.line) {
            this.rxBits = 0;
            this.rxByte = 0;
            this.rxStops = 0;
            this.rxState = 1;
            this.rxWait = this.period;
          } else {
            this.rxWait = 0;
          }
          break;
        case 1:
          this.rxByte = (this.rxByte >> 1) | (this.line ? 0x80 : 0);
          if (++this.rxBits === 8) this.rxState = this.parity ? 2 : 3;
          this.rxWait += this.period;
          break;
        case 2:
          this.rxParity = this.line;
          this.rxState = 3;
          this.rxWait += this.period;
          break;
        case 3:
          if (++this.rxStops === 1) {
            this.rxState = 0;
            this.rxWait = 0;
            return this.rxByte;
          }
          this.rxWait += this.period;
          break;
      }
    }
    return -1;
  }
}
