
export const IGT_VFD_COLS = 192;
export const IGT_VFD_ROWS = 16;
const FRAME = 0x180;
const START = 0x17e;

export function igtVfdLit(frame: ArrayLike<number>, col: number, row: number): boolean {
  const i = (START + 2 * col + (row < 8 ? 1 : 0)) % FRAME;
  if (i >= frame.length) return false;
  return ((frame[i] >> (row & 7)) & 1) === 0;
}

export function igtVfdDotAt(spacing: number, col: number, row: number): [number, number] {
  return [spacing * (col + 1), spacing * (row + 1)];
}
