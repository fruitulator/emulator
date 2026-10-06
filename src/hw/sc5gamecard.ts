export class Sc5GameCard {
  static readonly ADDRESS = 0xa4;

  readonly table = new Uint8Array(128);

  key: Uint8Array = new Uint8Array(8);

  private readonly challenge = new Uint8Array(4);
  private readonly answer = new Uint8Array(8);
  private command = 0;
  private count = 0;
  private index = 0;
  private position = 0;

  select(write: boolean): void {
    if (write) this.position = 0;
  }

  write(v: number): void {
    v &= 0xff;
    const p = this.position++;
    if (p === 0) {
      this.command = v;
      this.count = 0;
      this.index = 0;
      if (v === 0x53) this.answer.set(this.challenge);
      return;
    }
    switch (this.command) {
      case 0x52:
        this.challenge[this.count & 3] = v;
        this.count++;
        if (this.count === 4) gameCardTransform(this.challenge, this.key);
        return;
      case 0x55:
        this.index = v;
        return;
      case 0x56:
        if (p === 1) this.index = v;
        else if (p === 2) this.table[this.index & 0x7f] = v;
        return;
    }
  }

  read(): number {
    if (this.command === 0x53) return this.answer[this.count++ & 7];
    if (this.command === 0x55) return this.table[this.index & 0x7f];
    return 0xff;
  }

  load(image: Uint8Array): void {
    this.table.fill(0);
    this.table.set(image.subarray(0, this.table.length));
  }
}

export function gameCardKey(rom: Uint8Array, length = rom.length): Uint8Array | null {
  for (let i = 0; i + 0x1e <= length; i++) {
    if (rom[i] !== 0x42 || rom[i + 1] !== 0x45 || rom[i + 2] !== 0x54) continue;
    if (rom[i + 0x0c] === 1 && rom[i + 0x11] === 2) return rom.slice(i + 0x16, i + 0x1e);
    if (rom[i + 0x0b] === 1) return rom.slice(i + 0x0e, i + 0x16);
  }
  return null;
}

export function gameCardTransform(p: Uint8Array, k: Uint8Array): void {
  rot(p, 5); mixA(p, k); rot(p, 7); mixB(p, k); rot(p, 5); mixC(p, k);
  rot(p, 1); mixA(p, k); rot(p, 6); mixB(p, k); rot(p, 6); mixC(p, k);
}

function rot(p: Uint8Array, n: number): void {
  for (; n > 0; n--) {
    let v = (p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24)) >>> 1;
    if (p[0] & 1) v |= 0x80000000;
    p[0] = v; p[1] = v >>> 8; p[2] = v >>> 16; p[3] = v >>> 24;
    p[1] += 1;
    p[3] += 2;
  }
}

function mixA(p: Uint8Array, k: Uint8Array): void {
  p[2] ^= k[3];
  p[0] ^= k[6];
  p[1] ^= k[0];
  p[3] ^= k[1];
  p[1] = p[2] + p[3];
}

function mixB(p: Uint8Array, k: Uint8Array): void {
  p[1] += k[0];
  p[3] += k[1];
  p[2] -= k[2];
  p[0] += k[3];
  p[1] += k[4];
  p[3] -= k[6];
  p[0] += k[5];
  p[2] += k[7];
}

function mixC(p: Uint8Array, k: Uint8Array): void {
  p[1] = (k[7] ^ p[1]) + 0x17;
  p[3] = (k[5] ^ p[3]) + 7;
  p[2] = (k[2] ^ p[2]) + 0x19;
  p[0] = (k[4] ^ p[0]) + 0x62;
}
