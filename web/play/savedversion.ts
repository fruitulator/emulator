
export interface CarriesVersion { version_id?: string }

export function stampVersion(snap: object, variant: string): void {
  if (variant) (snap as CarriesVersion).version_id = variant;
}

export function versionOf(snap: unknown): string | null {
  const v = (snap as CarriesVersion | null | undefined)?.version_id;
  return typeof v === 'string' && v ? v : null;
}

export function resumesOn(made: string | null, runs: string, versions: number): boolean {
  return versions <= 1 || made === runs;
}
