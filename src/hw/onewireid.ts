export const ONEWIRE_ID = Uint8Array.from([0x01, 0x56, 0x34, 0x12, 0x00, 0x00, 0x00, 0x05]);

const ONE_BELOW = 300;
const RESET_ABOVE = 1000;

export class OneWireId {
  private state = 0;
  private out = 0;
  private cmd = 0;
  private rx = 0;
  private bits = 0;
  private tx = 0;
  private lowAt = 0;

  reset(): void {
    this.state = 0;
    this.out = 0;
    this.lowAt = 0;
    this.bits = 0;
    this.cmd = 0;
    this.rx = 0;
  }

  line(now: number, high: boolean): void {
    if (!high) { this.lowAt = now; return; }
    const w = now - this.lowAt;
    if (this.state === 0) {
      if (w <= RESET_ABOVE) return;
      this.state = 1;
      this.bits = 0;
      return;
    }
    if (this.state === 1) {
      this.bits++;
      this.cmd = (this.cmd >> 1) | (w < ONE_BELOW ? 0x80 : 0);
      if (this.bits !== 8) return;
      this.state = 2;
      this.bits = 0;
      this.rx = 0;
      return;
    }
    this.rx = (this.rx >> 1) | (w < ONE_BELOW ? 0x80 : 0);
    this.tx >>= 1;
    const b = this.bits;
    if (this.cmd === 0x0f || this.cmd === 0x33) {
      if ((b & 7) === 0 && b <= 0x38) this.tx = ONEWIRE_ID[b >> 3];
    } else if (this.cmd === 0x66) {
      if ((b & 7) === 0 && b <= 0x20) this.tx = 0;
    } else if (this.cmd === 0x99) {
      if ((b & 7) === 0 && b >= 8 && b <= 0x28) this.rx = 0;
    }
    this.bits = (this.bits + 1) & 0xff;
  }

  read(bit: number): number {
    if (this.state === 0) this.out = 1;
    else if (this.state === 1) this.out = 0;
    else {
      this.out = this.tx & 1;
      if (this.bits === 0x40) this.state = 0;
    }
    return this.out << bit;
  }
}
