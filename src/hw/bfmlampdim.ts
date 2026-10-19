import type { BfmLed } from './bfmled';

export class BfmLampDim {
  readonly colLevel = new Uint8Array(16).fill(0xff);
  readonly dimMask = new Uint8Array(32);
  readonly levels = new Uint8Array(256);

  static maskIndex(column: number, k: number): number {
    const c = column & 15;
    if ((c & 1) === 0) return c * 2 + k;
    return k >= 2 ? c * 2 + k - 2 : -1;
  }

  writeColumnRow(row: number, ledBank: boolean, column: number, v: number,
    lampRows: ArrayLike<number>, led: BfmLed): void {
    const c = column & 15;
    if (row === 0x36) {
      if (ledBank) led.writeDimLevel(c, v);
      else this.writeLevel(c, v, lampRows);
      return;
    }
    const i = BfmLampDim.maskIndex(c, row - 0x20);
    if (i < 0) return;
    if (ledBank) led.writeDimMask(i, v);
    else this.dimMask[i] = v;
  }

  levelRow(row: number, v: number): void {
    if (!v) return;
    const mask = this.dimMask[row];
    const level = this.colLevel[row >> 1];
    for (let b = 0; b < 8; b++) {
      if (v & (1 << b)) this.levels[row * 8 + b] = (mask & (1 << b)) ? level : 0xff;
    }
  }

  writeLevel(col: number, v: number, lampRows: ArrayLike<number>): void {
    if (this.colLevel[col] === v) return;
    this.colLevel[col] = v;
    for (let r = col * 2; r < col * 2 + 2; r++) {
      const hit = lampRows[r] & this.dimMask[r];
      if (!hit) continue;
      for (let b = 0; b < 8; b++) if (hit & (1 << b)) this.levels[r * 8 + b] = v;
    }
  }

  reset(): void {
    this.colLevel.fill(0xff);
    this.dimMask.fill(0);
    this.levels.fill(0);
  }

  level(n: number): number {
    return n >= 0 && n < 256 ? this.levels[n] : 0xff;
  }

  private readonly block = new Uint8Array(512);
  levelBlock(led: BfmLed): Uint8Array {
    this.block.set(this.levels, 0);
    this.block.set(led.levels, 256);
    return this.block;
  }
}
