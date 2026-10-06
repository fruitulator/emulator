export interface BusyStage {
  left: boolean;
  startedBoot: number;
  boot: number;
  veilUp: boolean;
}

export function stageBelongsOnVeil(s: BusyStage): boolean {
  if (s.left) return false;
  if (s.veilUp) return true;
  return !(s.startedBoot > 0 && s.startedBoot === s.boot);
}
