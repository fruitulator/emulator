
export interface CoinLockoutWiring {
  readonly openSense: 0 | 1;
  readonly mask: number;
  readonly bits: readonly (number | null)[];
  readonly masks?: readonly (number | null)[];
}

function lineMask(w: CoinLockoutWiring, line: number): number | null {
  if (w.masks) return w.masks[line] || null;
  const bit = w.bits[line];
  return bit === null || bit === undefined ? null : 1 << bit;
}

export function lockoutOpen(w: CoinLockoutWiring, driven: number): number {
  return (w.openSense ? driven : ~driven) & w.mask;
}

export function lockoutRefuses(w: CoinLockoutWiring, driven: number | null, pattern: number): boolean {
  if (driven === null) return true;
  const open = lockoutOpen(w, driven);
  if (open === 0) return true;
  if (pattern === 0 || (pattern & (pattern - 1)) !== 0) return false;
  const gate = lineMask(w, 31 - Math.clz32(pattern));
  return gate !== null && (open & gate) === 0;
}

export function lockoutRefusing(
  w: CoinLockoutWiring, driven: number | null, lines: number, patternOf: (line: number) => number,
): number {
  let m = 0;
  for (let n = 0; n < lines && n < 16; n++) if (lockoutRefuses(w, driven, patternOf(n))) m |= 1 << n;
  return m;
}
