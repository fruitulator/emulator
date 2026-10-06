
const STAKE_BY_INDEX: readonly number[] = [
  0,
  1,
  2,
  3,
  4,
  6,
  7,
];

const JACKPOT_BY_INDEX: readonly (number | undefined)[] = [
  0x08,
  0x06,
  0x05,
  0x07,
  0x09,
  0x0a,
  0x0c,
  0x0d,
  0x01,
  0x02,
  0x03,
  0x04,
  0x0b,
  0x0e,
];

export const KEY_NOT_FITTED = 0;

export function stakeKeyCode(index: number | undefined): number {
  if (index === undefined || !Number.isInteger(index)) return KEY_NOT_FITTED;
  return STAKE_BY_INDEX[index] ?? KEY_NOT_FITTED;
}

export function jackpotKeyCode(index: number | undefined): number {
  if (index === undefined || !Number.isInteger(index)) return KEY_NOT_FITTED;
  return JACKPOT_BY_INDEX[index] ?? KEY_NOT_FITTED;
}

export function percentKeyCode(index: number | undefined): number {
  if (index === undefined || !Number.isInteger(index)) return KEY_NOT_FITTED;
  if (index < 0 || index > 14) return KEY_NOT_FITTED;
  return index + 1;
}

export function dipByte(bits: string | undefined): number {
  if (!bits) return 0;
  let v = 0;
  for (let i = 0; i < 8; i++) if (bits[i] === '1') v |= 1 << i;
  return v;
}
