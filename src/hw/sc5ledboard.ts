export class Sc5LedBoard {
  static readonly ADDRESS = 0x06;
  static readonly FIRST_LED = 400;
  static readonly LED_COUNT = 0x200 - 400;

  readonly message = new Uint8Array(40);
  private count = 0;
  private started = false;
  readonly colours = new Uint32Array(Sc5LedBoard.LED_COUNT);

  select(): void {
    this.started = false;
  }

  write(v: number): void {
    if (!this.started) {
      this.started = true;
      this.count = 0;
    }
    if (this.count < this.message.length) this.message[this.count] = v & 0xff;
    this.count = (this.count + 1) & 0xff;
  }

  stop(): void {
    this.started = false;
    const b = this.message;
    if (b[0] !== 3) return;
    const led = b[4] === 0xff ? b[5] : b[4];
    if (led >= Sc5LedBoard.LED_COUNT) return;
    this.colours[led] = (b[1] << 16) | (b[2] << 8) | b[3];
  }

  colour(n: number): number {
    const i = n - Sc5LedBoard.FIRST_LED;
    return i >= 0 && i < this.colours.length ? this.colours[i] : 0;
  }
}
