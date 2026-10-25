
const ANSWER_AT = 0x73;
const LAST_BYTE = 0x0f;

export class Sc2Dongle {
  readonly table = new Uint8Array(16);
  private sr = 0;
  private bits = 0;
  private last = 1;
  private readonly k = new Uint8Array(4);
  private index = 0;
  private rounds = 0;
  private answer = 0;
  private sent = 0;
  out = 0;

  constructor(table: ArrayLike<number>) {
    for (let i = 0; i < 16; i++) this.table[i] = (table[i] ?? 0) & 0xff;
  }

  reset(): void {
    this.sr = 0;
    this.bits = 0;
    this.last = 1;
    this.index = 0;
    this.rounds = 0;
    this.k.fill(0);
  }

  write(v: number): void {
    v &= 0xff;
    if (!((this.last ^ v) & 1)) return;
    this.last = v;
    if (this.rounds < ANSWER_AT) {
      this.sr = ((this.sr >> 1) | ((v & 2) << 6)) & 0xff;
      if (++this.bits !== 8) return;
      this.bits = 0;
      const n = this.rounds === LAST_BYTE ? 100 : 1;
      if (n === 100) this.sent = 0;
      const swapped = ((this.sr >> 4) | (this.sr << 4)) & 0xff;
      for (let r = 0; r < n; r++) {
        const b = (this.k[this.index] ^= this.sr);
        const rot = ((b >> 1) | (b << 7)) & 0xff;
        const t = (this.table[rot & 0xf] + this.table[rot >> 4] + swapped) & 0xff;
        this.index = (this.index + 1) & 3;
        this.k[this.index] ^= t;
        this.rounds++;
      }
      if (n === 100) {
        this.answer = ((this.k[3] << 24) | (this.k[2] << 16) | (this.k[1] << 8) | this.k[0]) >>> 0;
        this.sent = 0;
      }
      return;
    }
    if (this.bits === 0) {
      this.bits = 1;
    } else if (this.bits <= 8) {
      this.out = (this.answer & 1) * 2;
      this.answer >>>= 1;
      this.sent++;
      this.bits++;
    } else if (this.bits === 9) {
      this.bits = 0;
      if (this.sent === 32) {
        this.rounds = 0;
        this.sent = 0;
        this.index = 0;
        this.k.fill(0);
      }
    }
  }
}

export function dongleTableFromRom(rom: Uint8Array): Uint8Array | null {
  for (let i = 0; i < rom.length - 0x18; i++) {
    if (rom[i] === 0x84 && rom[i + 1] === 0x0f && rom[i + 2] === 0x10 && rom[i + 3] === 0x8e
      && rom[i + 6] === 0xa6 && rom[i + 7] === 0xa6) {
      const at = (rom[i + 4] << 8) | rom[i + 5];
      return rom.slice(at, at + 16);
    }
  }
  return null;
}
