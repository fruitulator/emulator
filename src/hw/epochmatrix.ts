
export const MATRIX_COLS = 42;
export const MATRIX_ROWS = 35;
export const MATRIX_CELLS = MATRIX_COLS * MATRIX_ROWS;
export const MATRIX_PLANE = 0x200;
export const MATRIX_FRAME = 0x400;

function walk(): Int32Array {
  const map = new Int32Array(MATRIX_CELLS);
  let mask = 1;
  let base = 0;
  let sevens = 0;
  let cell = 0;
  let p = 0;
  for (let col = 0; col < MATRIX_COLS; col++) {
    let b = mask;
    for (let k = 0; k < MATRIX_ROWS; k++) {
      map[cell++] = (p << 3) | (31 - Math.clz32(b));
      b = (b * 2) & 0xff;
      if (b === 0) { p += 4; b = 1; }
    }
    p += 0x28;
    if (++sevens === 7) {
      sevens = 0;
      if (col === 0x1b) { base = 0xf; mask = 8; }
      base++;
      p = base;
    }
  }
  return map;
}

export const MATRIX_MAP = walk();

export class EpochMatrix {
  readonly frame = new Uint8Array(MATRIX_FRAME);

  bank = 0;

  commits = 0;

  reset(): void {
    this.frame.fill(0);
    this.bank = 0;
    this.commits = 0;
  }

  commit(ram: Uint8Array, offset: number, bank: number): void {
    this.frame.set(ram.subarray(offset, offset + MATRIX_FRAME));
    this.bank = bank;
    this.commits++;
  }

  cells(out = new Uint8Array(MATRIX_CELLS)): Uint8Array {
    const f = this.frame;
    for (let i = 0; i < MATRIX_CELLS; i++) {
      const m = MATRIX_MAP[i];
      const byte = m >> 3;
      const bit = m & 7;
      out[i] = ((f[byte] >> bit) & 1) | (((f[MATRIX_PLANE + byte] >> bit) & 1) << 1);
    }
    return out;
  }

  grid(): Uint8Array[] {
    const cells = this.cells();
    const rows = Array.from({ length: MATRIX_ROWS }, () => new Uint8Array(MATRIX_COLS));
    for (let i = 0; i < MATRIX_CELLS; i++) {
      rows[MATRIX_ROWS - 1 - (i % MATRIX_ROWS)][(i / MATRIX_ROWS) | 0] = cells[i];
    }
    return rows;
  }

  litCount(): number {
    const cells = this.cells();
    let n = 0;
    for (let i = 0; i < cells.length; i++) if (cells[i]) n++;
    return n;
  }
}
