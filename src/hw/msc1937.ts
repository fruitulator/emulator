import type { MachineDisplay } from '../machine/machine';

const POS_LUT = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0];

export class Msc1937 implements MachineDisplay {
  readonly kind = 'msc' as const;

  readonly chars = new Uint8Array(16);
  readonly dots = new Uint8Array(16);
  readonly cellWords = new Uint32Array(16);

  writeByte(data: number): void {
    this.writeChar(data);
  }

  duty = 0;

  private cursor = 0;
  private pcursor = 0;
  private windowSize = 16;

  private sclkState = false;
  private dataBit = false;
  private porState = false;
  private shiftData = 0;
  private shiftCount = 0;

  text(): string {
    return [...this.chars]
      .map((c) => (c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : ' '))
      .join('');
  }

  data(state: boolean): void {
    this.dataBit = state;
  }

  por(state: boolean): void {
    if (!state) this.reset();
    this.porState = state;
  }

  sclk(state: boolean): void {
    if (this.sclkState === state) return;
    if (!this.sclkState && this.porState) {
      this.shiftData = ((this.shiftData << 1) | (this.dataBit ? 1 : 0)) & 0xff;
      if (++this.shiftCount >= 8) {
        this.writeChar(this.shiftData);
        this.shiftCount = 0;
        this.shiftData = 0;
      }
    }
    this.sclkState = state;
  }

  reset(): void {
    this.cursor = 0;
    this.pcursor = 0;
    this.windowSize = 16;
    this.shiftCount = 0;
    this.shiftData = 0;
    this.duty = 0;
  }

  private writeChar(data: number): void {
    if (data & 0x80) {
      if ((data & 0xf0) === 0xa0) {
        this.cursor = POS_LUT[data & 0x0f];
        this.pcursor = data & 0x0f;
      } else if ((data & 0xf0) === 0xc0) {
        const n = data & 0x0f;
        this.windowSize = n === 0 ? 16 : n;
      } else if ((data & 0xe0) === 0xe0) {
        this.duty = data & 0x1f;
      }
      return;
    }
    const code = data & 0x3f;
    switch (code) {
      case 0x2c:
        this.dots[15 - this.pcursor] |= 0x03;
        this.cellWords[15 - this.pcursor] |= code << 8;
        break;
      case 0x2e:
        this.dots[15 - this.pcursor] |= 0x01;
        this.cellWords[15 - this.pcursor] |= code << 8;
        break;
      default:
        this.pcursor = this.cursor;
        this.chars[15 - this.cursor] = code < 0x20 ? code + 0x40 : code;
        this.dots[15 - this.cursor] = 0;
        this.cellWords[15 - this.cursor] = this.chars[15 - this.cursor];
        if (++this.cursor > this.windowSize - 1) this.cursor = 0;
        break;
    }
  }
}
