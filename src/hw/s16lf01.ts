import type { MachineDisplay } from '../machine/machine';

export const ROC10937_CHARSET: readonly number[] = [
  0x507f, 0x44cf, 0x153f, 0x00f3, 0x113f, 0x40f3, 0x40c3, 0x04fb,
  0x44cc, 0x1133, 0x007c, 0x4ac0, 0x00f0, 0x82cc, 0x88cc, 0x00ff,
  0x44c7, 0x08ff, 0x4cc7, 0x44bb, 0x1103, 0x00fc, 0x22c0, 0x28cc,
  0xaa00, 0x9200, 0x2233, 0x00e1, 0x8800, 0x001e, 0x2800, 0x0030,
  0x0000, 0x8121, 0x0180, 0x553c, 0x55bb, 0x7799, 0xc979, 0x0200,
  0x0a00, 0xa000, 0xff00, 0x5500, 0x0000, 0x4400, 0x0000, 0x2200,
  0x22ff, 0x1100, 0x4477, 0x443f, 0x448c, 0x44bb, 0x44fb, 0x000f,
  0x44ff, 0x44bf, 0x0021, 0x2001, 0x2230, 0x4430, 0x8830, 0x1407,
];

const POSLUT = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0];

export class S16lf01 implements MachineDisplay {
  readonly kind = 's16' as const;

  readonly chars = new Uint8Array(16);
  readonly segs = new Uint32Array(16);
  readonly cellWords = new Uint32Array(16);

  private cursor = 0;
  private window = 16;
  private pcursor = 0;
  private shiftCount = 0;
  private shiftData = 0;
  private sclkState = 0;
  private dataState = 0;
  private porState = 0;
  duty = 0;

  reset(): void {
    this.cursor = 0;
    this.window = 16;
    this.pcursor = 0;
    this.shiftCount = 0;
    this.shiftData = 0;
    this.duty = 0;
  }

  por(state: boolean | number): void {
    if (!state) this.reset();
    this.porState = state ? 1 : 0;
  }

  data(state: boolean | number): void {
    this.dataState = state ? 1 : 0;
  }

  sclk(state: boolean | number): void {
    const s = state ? 1 : 0;
    if (this.sclkState === s) return;
    if (!this.sclkState && this.porState) {
      this.shiftData = ((this.shiftData << 1) | this.dataState) & 0xff;
      if (++this.shiftCount >= 8) {
        this.writeChar(this.shiftData);
        this.shiftCount = 0;
        this.shiftData = 0;
      }
    }
    this.sclkState = s;
  }

  writeChar(byte: number): void {
    const d = byte & 0xff;
    if (d & 0x80) {
      if ((d & 0xf0) === 0xa0) {
        this.cursor = POSLUT[d & 0x0f];
        this.pcursor = d & 0x0f;
      } else if ((d & 0xf0) === 0xc0) {
        const n = d & 0x0f;
        this.window = n === 0 ? 16 : n;
      } else if ((d & 0xe0) === 0xe0) {
        this.duty = d & 0x1f;
      } else if ((d & 0xe0) === 0x80) {
      }
      return;
    }
    const idx = d & 0x3f;
    switch (idx) {
      case 0x2c:
        this.segs[15 - this.pcursor] |= (1 << 16) | (1 << 17);
        this.cellWords[15 - this.pcursor] |= idx << 8;
        break;
      case 0x2e:
        this.segs[15 - this.pcursor] |= 1 << 16;
        this.cellWords[15 - this.pcursor] |= idx << 8;
        break;
      default:
        this.pcursor = this.cursor;
        this.segs[15 - this.cursor] = ROC10937_CHARSET[idx];
        this.chars[15 - this.cursor] = idx < 0x20 ? 0x40 + idx : idx;
        this.cellWords[15 - this.cursor] = this.chars[15 - this.cursor];
        this.cursor++;
        if (this.cursor > this.window - 1) this.cursor = 0;
        break;
    }
  }

  text(): string {
    let s = '';
    for (let i = 0; i < 16; i++) {
      const c = this.chars[i];
      s += c === 0 ? ' ' : String.fromCharCode(c);
    }
    return s;
  }
}
