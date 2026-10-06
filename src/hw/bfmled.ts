export type BfmLedMode = 'normal' | 'ledboard' | 'reflex' | 'upsidedown';

export function bfmLedMode(setting: string | null): BfmLedMode {
  switch (setting) {
    case 'LED board': return 'ledboard';
    case 'Reflex': return 'reflex';
    case 'Upside Down': return 'upsidedown';
    default: return 'normal';
  }
}

const LED_BOARD_CODES = Uint8Array.of(
  0x3f, 0xbf, 0x06, 0x86, 0x5b, 0xdb, 0x4f, 0xcf, 0x66, 0xe6, 0x6d, 0xed, 0x7d, 0xfd, 0x07, 0x87,
  0x7f, 0xff, 0x6f, 0xef, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
);

function upsideDown(v: number): number {
  const u = v >> 1;
  return (((u & 7) << 3) | ((u & 0x38) >> 3) | (u & 0xc0) | (v << 7)) & 0xff;
}

export function bfmLedBit(raw: ArrayLike<number>, n: number): boolean {
  if (n < 0 || n >= 256) return false;
  return ((raw[((n >> 3) & 15) + (n >> 7) * 16] >> (n & 7)) & 1) !== 0;
}

export class BfmLed {
  readonly digits = new Uint8Array(64);

  readonly raw = new Uint8Array(32);

  mode: BfmLedMode = 'normal';

  private latch = 0;
  private readonly words = new Uint16Array(16);

  reset(): void {
    this.digits.fill(0);
    this.raw.fill(0);
    this.words.fill(0);
    this.latch = 0;
  }

  writeBfm(d: number, column: number, bank: number): void {
    const v = d & 0xff;
    const col = column & 0x0f;
    const b = bank ? 1 : 0;
    const upper = b === 1 && col >= 8;
    if (this.mode !== 'ledboard' || upper) this.single(v, col, b);
    if (this.mode === 'ledboard') this.ledBoard(v, col, b);
  }

  private single(v: number, col: number, bank: number): void {
    let cell = col + bank * 16;
    this.raw[cell] = v;
    let word: number;
    switch (this.mode) {
      case 'reflex': word = v; break;
      case 'upsidedown': word = upsideDown(v); break;
      case 'ledboard': cell = col + 0x28; word = ((v >> 1) | (v << 7)) & 0xff; break;
      default: word = ((v >> 1) | (v << 7)) & 0xff;
    }
    this.digits[cell] = word;
  }

  private ledBoard(v: number, col: number, bank: number): void {
    if ((col & 1) === 0) {
      this.latch = v;
      return;
    }
    const pair = (col >> 1) + bank * 8;
    let word = (v << 8) | this.latch;
    if (this.words[pair] === word) return;
    this.words[pair] = word;
    for (let i = 0; i < 3; i++) {
      this.digits[pair * 3 + i] = (v & 0x80) ? LED_BOARD_CODES[word & 0x1f] : 0;
      word >>= 5;
    }
  }
}
