
export const LAMP_ON = 0xff;

export class LampSetClear {
  readonly level: Uint8Array;
  private readonly lit: Uint8Array;
  readonly dimMask: Uint8Array;
  readonly dimLevel: Uint8Array;

  constructor(lamps: number) {
    this.level = new Uint8Array(lamps);
    this.lit = new Uint8Array(lamps);
    this.dimMask = new Uint8Array((lamps + 7) >> 3);
    this.dimLevel = new Uint8Array((lamps + 15) >> 4).fill(LAMP_ON);
  }

  reset(): void {
    this.level.fill(0);
    this.lit.fill(0);
    this.dimMask.fill(0);
    this.dimLevel.fill(LAMP_ON);
  }

  write(n: number, bit: number): boolean {
    if (!(bit & 1)) {
      if (!this.lit[n] && !this.level[n]) return false;
      this.lit[n] = 0;
      this.level[n] = 0;
      return true;
    }
    const want = (this.dimMask[n >> 3] >> (n & 7)) & 1 ? this.dimLevel[n >> 4] : LAMP_ON;
    if (this.lit[n] && this.level[n] === want) return false;
    this.lit[n] = 1;
    this.level[n] = want;
    return true;
  }

  writeByte(base: number, data: number): boolean {
    let changed = false;
    for (let i = 0; i < 8; i++) if (this.write(base + i, (data >> i) & 1)) changed = true;
    return changed;
  }

  setDimMask(byte: number, mask: number): void {
    if (byte >= 0 && byte < this.dimMask.length) this.dimMask[byte] = mask & 0xff;
  }

  setDimLevel(block: number, value: number): boolean {
    const v = value & 0xff;
    if (block < 0 || block >= this.dimLevel.length || this.dimLevel[block] === v) return false;
    this.dimLevel[block] = v;
    let changed = false;
    const end = Math.min(this.level.length, block * 16 + 16);
    for (let n = block * 16; n < end; n++) {
      if (this.lit[n] && (this.dimMask[n >> 3] >> (n & 7)) & 1) {
        this.level[n] = v;
        changed = true;
      }
    }
    return changed;
  }
}
