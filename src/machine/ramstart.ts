
export type InstallStart = 'ram' | 'no-ram';

export interface StoodStill {
  newInstall: boolean;
  fromFiles: boolean;
  attempted: boolean;
  found: boolean;
  alarm: boolean;
  selfBusy: boolean;
  skipped: boolean;
}

export function tryWithoutRam(s: StoodStill): boolean {
  return s.newInstall && s.fromFiles && !s.attempted && !s.found && !s.alarm && !s.selfBusy && !s.skipped;
}

export function noRamVerdict(s: { found: boolean; alarm: boolean }): InstallStart {
  return s.found && !s.alarm ? 'no-ram' : 'ram';
}
