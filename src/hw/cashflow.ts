
export const LINE = {
  A: 1 << 0,
  B: 1 << 1,
  C: 1 << 2,
  D: 1 << 3,
  E: 1 << 4,
  F: 1 << 5,
} as const;

export type BcoUkCoin = '5p' | '10p' | '20p' | '50p' | '50p (old)' | '£1' | '£2' | 'token';

const { A, B, C, D, E, F } = LINE;

export const BCO_UK: Readonly<Record<BcoUkCoin, number>> = {
  '5p': A | C,
  '10p': A | B | C | D,
  '20p': A | C | E | F,
  '50p (old)': A | B | C | F,
  '50p': A | C | D | F,
  '£1': A | B | C | E,
  '£2': A | B | C | D | E | F,
  token: A | C | D | E,
};

export const BCO_UK_ALARM = A | B | D | E | F;

export const BCO_PULSE_MS = 100;
