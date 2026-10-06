import type { StateRec } from './store';

export function savedByOtherBuild(rec: Pick<StateRec, 'build'>, current: string): boolean {
  return rec.build !== current;
}

export async function settleSavedState(
  rec: StateRec | null,
  current: string,
  deps: { dropState: (hash: string) => Promise<void> },
): Promise<StateRec | null> {
  if (!rec || !savedByOtherBuild(rec, current)) return rec;
  console.info(`[library] saved machine from build ${rec.build ?? 'unknown'} set aside; starting fresh on ${current}`);
  await deps.dropState(rec.hash).catch((e: unknown) => console.warn('[library] state drop failed', e));
  return null;
}
