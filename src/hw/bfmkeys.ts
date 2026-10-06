
export type KeyCode = number;

export function percentageCode(index: number): KeyCode | null {
  if (!Number.isInteger(index) || index < 0 || index > 14) return null;
  return index + 1;
}

const PRIZE_CODES: (KeyCode | null)[] = [
  8,
  6,
  5,
  7,
  9,
  10,
  12,
  13,
  1,
  2,
  3,
  4,
  11,
  14,
];

export function prizeCode(index: number): KeyCode | null {
  return PRIZE_CODES[index] ?? null;
}

const STAKE_CODES: (KeyCode | null)[] = [
  0,
  1,
  2,
  3,
  4,
  6,
  7,
];

export function stakeCode(index: number): KeyCode | null {
  return STAKE_CODES[index] ?? null;
}

const SC4_STAKE_BITS = [0, 8, 16, 24, 4];

export function sc4StakeBits(index: number): number | null {
  return SC4_STAKE_BITS[index] ?? null;
}
