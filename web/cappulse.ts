
export function capsAreSwitches(
  lamps: readonly { cap?: boolean; button?: number }[],
  nonSwitchInputs: readonly number[] | undefined,
): number {
  if (!nonSwitchInputs?.length) return 0;
  let demoted = 0;
  for (const lp of lamps) {
    if (lp.cap && lp.button !== undefined && nonSwitchInputs.includes(lp.button)) {
      lp.cap = undefined;
      demoted++;
    }
  }
  return demoted;
}
