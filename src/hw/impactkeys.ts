
export function impactPercentValue(index: number): number {
  return 68 + 2 * (index + 1);
}

export function impactPercentKey(index: number | undefined): number | undefined {
  if (index === undefined || !Number.isInteger(index)) return undefined;
  if (index < 0 || index > 14) return undefined;
  return 14 - index;
}

export function impactStakeKey(index: number | undefined): number | undefined {
  if (index === undefined || !Number.isInteger(index)) return undefined;
  if (index < 0 || index >= STAKE_KEY.length) return undefined;
  return (7 - STAKE_KEY[index]) << 4;
}

export function impactPrizeKey(index: number | undefined): number | undefined {
  if (index === undefined || !Number.isInteger(index)) return undefined;
  if (index < 0 || index >= PRIZE_KEY.length) return undefined;
  return 15 - PRIZE_KEY[index];
}

export const IMPACT_PERCENT_NOT_FITTED = 0x0f;
export const IMPACT_PRIZE_NOT_FITTED = 0x0f;
export const IMPACT_STAKE_NOT_FITTED = 0x70;

const STAKE_KEY: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
const PRIZE_KEY: readonly number[] =
  [8, 6, 5, 7, 9, 10, 12, 13, 1, 2, 3, 4, 11, 14];

export const IMPACT_STAKE_LABELS: readonly string[] =
  ['5p', '10p', '20p', '25p', '30p', '50p', '£1'];
export const IMPACT_PRIZE_LABELS: readonly string[] =
  ['£5', '£8T', '£8', '£10', '£15', '£25', '£35', '£70',
   '£3', '£4', '£6', '£6T', '£25LBO', '£100'];

export function impactKeyByte(
  base: number, stake: number | undefined, prize: number | undefined,
): number {
  let v = base & 0xff;
  if (stake !== undefined) v = (v & ~0x70) | (stake & 0x70);
  if (prize !== undefined) v = (v & ~0x0f) | (prize & 0x0f);
  return v & 0xff;
}
