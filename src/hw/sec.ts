
const SEC_DAT = 0x60;
const SEC_ACK = 0x61;

export const V20_SEC_FINGERPRINT: readonly number[] = [0x00, 0x00, 0x01, 0x11];
export const V20_SEC_STALL_TIMEOUT = 2_000_000;
export const V20_SEC_REQUEST_MAX = 60;

export class Sec {
  private cs = false;
  private clk = true;
  private dataIn = false;

  private curByte = 0;
  private bitCount = 0;
  private request: number[] = [];
  private expected: number | null = null;

  private reply: number[] = [];
  private rxpos = 0;
  private rxLeft = 0;
  private rxclk = 0;
  private rxdat = false;
  private rxFresh = false;

  market = 0x00;
  status = 0x20;
  lastError = 0x00;
  readonly counters = [0, 0, 0, 0, 0, 0, 0, 0];
  private lastCommand = 0xff;
  counterCount = 0;
  readonly counterText: string[] = [];
  onCount?: (meter: number, delta: number) => void;
  fingerprint: number[] = [0x11, 0x01, 0x00, 0x00];
  stallTimeout = 0;
  private lineCallAt = 0;
  private clockAtReset = true;

  fitV20(clockAtReset = false): void {
    this.fingerprint = [...V20_SEC_FINGERPRINT];
    this.stallTimeout = V20_SEC_STALL_TIMEOUT;
    this.clockAtReset = clockAtReset;
    this.v20 = true;
    this.v20StateReset(clockAtReset);
  }

  private v20 = false;

  private v20StateReset(level: boolean): void {
    this.clk = level;
    this.curByte = 0;
    this.bitCount = 0;
    this.request = [];
    this.expected = null;
    this.status = 0x20;
    this.reply = [];
    this.rxpos = 0;
    this.rxLeft = 0;
    this.rxclk = 0;
    this.rxFresh = false;
    this.rxdat = true;
    this.lastCommand = 0xff;
  }

  lineCall(now: number): void {
    if (this.stallTimeout > 0 && this.request.length > 0
      && now - this.lineCallAt > this.stallTimeout) {
      this.abortTransfer();
      this.clk = true;
    }
    this.lineCallAt = now;
  }

  reset(): void {
    if (this.v20) {
      this.v20StateReset(this.clockAtReset);
      return;
    }
    this.clk = this.clockAtReset;
    this.curByte = 0;
    this.bitCount = 0;
    this.request = [];
    this.expected = null;
    this.reply = [];
    this.rxpos = 0;
    this.rxLeft = 0;
    this.rxclk = 0;
    this.rxFresh = false;
    this.lastCommand = 0xff;
    this.status = 0x20;
    this.lastError = 0x00;
  }

  get lastId(): number {
    return this.lastCommand;
  }

  get requestBytes(): number {
    return this.request.length;
  }

  abortTransfer(): void {
    const cs = this.cs;
    this.reset();
    this.cs = cs;
  }

  setCS(state: boolean): void {
    if (state) {
      if (!this.cs) {
        this.cs = true;
        this.rxdat = false;
      }
      return;
    }
    if (this.cs) this.rxdat = true;
    this.cs = false;
    if (this.v20) {
      this.v20StateReset(this.clk);
      return;
    }
    this.request = [];
    this.expected = null;
    this.bitCount = 0;
    this.curByte = 0;
    this.reply = [];
    this.rxpos = 0;
    this.rxLeft = 0;
    this.rxclk = 0;
    this.clk = this.clockAtReset;
  }

  setData(state: boolean): void {
    this.dataIn = state;
  }

  setClock(state: boolean): void {
    if (state === this.clk) return;
    const rising = state && !this.clk;
    this.clk = state;

    if (rising) {
      if (this.rxFresh) {
        this.rxFresh = false;
        return;
      }
      if (this.rxLeft > 0) {
        this.reply[this.rxpos] = (this.reply[this.rxpos] << 1) & 0xff;
        this.rxclk++;
      }
      return;
    }

    if (this.rxclk === 8) {
      this.rxclk = 0;
      this.rxpos++;
      this.rxLeft--;
    }

    if (!this.replying) {
      this.curByte = ((this.curByte << 1) | (this.dataIn ? 1 : 0)) & 0xff;
      if (++this.bitCount >= 8) {
        this.bitCount = 0;
        this.receive(this.curByte);
        this.curByte = 0;
      }
    }

    if (this.rxLeft > 0 && !this.rxFresh) {
      this.rxdat = ((this.reply[this.rxpos] ?? 0) & 0x80) !== 0;
    } else if (!this.v20) {
      this.rxdat = !this.cs;
    }
  }

  private receive(byte: number): void {
    if (this.v20 && this.request.length >= V20_SEC_REQUEST_MAX) {
      this.request = [];
      this.expected = null;
      return;
    }
    this.request.push(byte);
    if (this.request.length === 3) this.expected = 3 + this.request[2] + 1;
    if (this.expected !== null && this.request.length >= this.expected) {
      this.execute();
      this.request = [];
      this.expected = null;
    }
  }

  data(): boolean {
    return this.rxdat;
  }

  get replying(): boolean {
    return this.rxLeft > 0;
  }

  private send(lead: number, echo: number, payload: number[]): void {
    const body = [lead, echo, payload.length, ...payload];
    const checksum = body.reduce((a, b) => (a + b) & 0xff, 0);
    this.reply = [...body, checksum];
    this.rxpos = 0;
    this.rxLeft = this.reply.length;
    this.rxclk = 0;
    this.rxFresh = true;
  }

  private ack(echo: number): void {
    this.send(SEC_ACK, echo, []);
  }

  private count(meter: number, delta: number): void {
    this.counters[meter] = (this.counters[meter] ?? 0) + delta;
    this.onCount?.(meter, delta);
  }

  private static bcd(v: number): number[] {
    const s = (`${Math.max(0, Math.floor(v))}`.padStart(7, '0') + '0').slice(0, 8);
    return [0, 2, 4, 6].map((i) => (((+s[i] & 0xf) << 4) | (+s[i + 1] & 0xf)) & 0xff);
  }

  private execute(): void {
    const cmd = this.request[0];
    const echo = this.request[1] ?? 0;
    const meter = (this.request[3] ?? 0) & 31;
    this.lastCommand = echo;

    switch (cmd) {
      case 0x20:
        this.send(SEC_DAT, echo, [this.status]);
        return;
      case 0x21:
        this.send(SEC_DAT, echo, [this.market]);
        return;
      case 0x22:
        this.send(SEC_DAT, echo, [this.lastError]);
        return;
      case 0x23:
        this.send(SEC_DAT, echo, [0x30, 0x32, 0x45]);
        return;
      case 0x24:
        this.send(SEC_DAT, echo, Sec.bcd(this.counters[meter] ?? 0));
        return;
      case 0x25:
        this.send(SEC_DAT, echo, [this.lastCommand, this.status, this.market, this.lastError]);
        return;
      case 0x26:
        this.send(SEC_DAT, echo, this.fingerprint);
        return;

      case 0x30:
        this.counterCount = this.request[3] ?? 0;
        this.ack(echo);
        return;
      case 0x31:
        this.market = this.request[3] ?? 0;
        this.ack(echo);
        return;
      case 0x32:
        this.counterText[meter] = this.request.slice(4, 11)
          .map((c) => String.fromCharCode(c & 0xff)).join('').split('\0')[0];
        this.ack(echo);
        return;

      case 0x50:
        this.count(meter, (this.request[4] ?? 0) & 0x0f);
        this.ack(echo);
        return;
      case 0x51:
        this.count(meter, this.request[4] ?? 0);
        this.ack(echo);
        return;
      case 0x52:
        this.count(meter, (this.request[4] ?? 0) + 256 * (this.request[5] ?? 0));
        this.ack(echo);
        return;

      case 0x40:
      case 0x41:
      case 0x42:
      case 0x43:
      case 0x54:
      case 0x55:
      case 0x5c:
        this.ack(echo);
        return;

      default:
        return;
    }
  }
}
