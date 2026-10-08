import type { StateRec } from './store';
import { NO_STAMP } from './boardstamp';

export type SavedStart =
  | { kind: 'resume'; rec: StateRec }
  | { kind: 'battery'; rec: StateRec; nvram: Uint8Array }
  | { kind: 'fresh'; hadSave: boolean };

export function savedByOtherEmulation(rec: Pick<StateRec, 'stamp'>, current: string): boolean {
  return !rec.stamp || current === NO_STAMP || rec.stamp !== current;
}

export async function settleSavedState(
  rec: StateRec | null,
  current: string,
  deps: { dropState: (hash: string) => Promise<void> },
): Promise<SavedStart> {
  if (!rec) return { kind: 'fresh', hadSave: false };
  if (!savedByOtherEmulation(rec, current)) return { kind: 'resume', rec };
  const was = rec.stamp ?? (rec.build ? `build ${rec.build}` : 'unknown');
  if (rec.nvram && rec.nvram.length > 0) {
    console.info(`[library] saved machine from emulation ${was} restarts from its battery on ${current}`);
    return { kind: 'battery', rec, nvram: rec.nvram };
  }
  console.info(`[library] saved machine from emulation ${was} set aside (no battery kept); starting fresh on ${current}`);
  await deps.dropState(rec.hash).catch((e: unknown) => console.warn('[library] state drop failed', e));
  return { kind: 'fresh', hadSave: true };
}
