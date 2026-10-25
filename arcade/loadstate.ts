import { SNAPSHOT_VERSION, type Snapshot } from '../web/snapshot';
import { str } from '../web/i18n';

export type StateFile =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; why: string };

export function readStateFile(text: string, machine: string): StateFile {
  let snap: Partial<Snapshot>;
  try {
    snap = JSON.parse(text) as Partial<Snapshot>;
  } catch {
    return { ok: false, why: str('arcade.loadstate.that_file_is_not_a') };
  }
  if (!snap || typeof snap !== 'object' || snap.format !== 'fruitulator-snapshot') {
    return { ok: false, why: str('arcade.loadstate.that_file_is_not_a') };
  }
  if (snap.version !== SNAPSHOT_VERSION) {
    return { ok: false, why: str('arcade.loadstate.that_state_is_from_another') };
  }
  if (snap.game !== machine) {
    return { ok: false, why: str('arcade.loadstate.that_state_is_from_a') };
  }
  return { ok: true, snapshot: snap as Snapshot };
}
