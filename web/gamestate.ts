import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { Game } from '../src/machine/registry';
import type { MachineInfo } from './emu-protocol';
import type { AutosaveBlob } from './emu-client';
import { SCHEMA_VERSION, type StateRec } from './store';
import { serializeState, type Snapshot } from './snapshot';
import { viewFor } from './platform';
import { hasOperatedSwitches, layoutNamedInputs, namedInputId } from './switchids';

import { boardStamp } from './boardstamp';

declare const __BUILD_ID__: string;

export function stateRecord(blob: AutosaveBlob, hash: string, savedAt = Date.now(), system?: string): StateRec {
  const data = deflateSync(strToU8(JSON.stringify(serializeState(blob.snap))));
  return {
    hash, schema: SCHEMA_VERSION, savedAt, cycles: blob.cycles, build: __BUILD_ID__,
    stamp: boardStamp(system), nvram: blob.nvram, data,
  };
}

export function deflatedRecord(data: Uint8Array, cycles: number, hash: string, savedAt = Date.now(), system?: string): StateRec {
  return { hash, schema: SCHEMA_VERSION, savedAt, cycles, build: __BUILD_ID__, stamp: boardStamp(system), data };
}

export function decodeState(rec: StateRec): Snapshot {
  const snapshot = JSON.parse(strFromU8(inflateSync(rec.data))) as Snapshot;
  if (rec.build !== __BUILD_ID__) {
    console.warn(
      `[library] resuming a state saved by build ${rec.build ?? '(unknown)'}`
        + ` under build ${__BUILD_ID__}; a fault it carries may be one this build no longer produces`,
    );
  }
  return snapshot;
}

export function idleNamedInputs(
  emu: { input(id: number, on: boolean): void }, game: Game, info: MachineInfo,
): void {
  if (hasOperatedSwitches(info)) return;
  for (const n of layoutNamedInputs(viewFor(game.system).namedInputs, info.switchIds ?? {})) {
    emu.input(namedInputId(n), n.invert ? true : false);
  }
}

function optionKeySlot(game: Game): string {
  const build = game.variants.length > 1 ? `:${game.variant}` : '';
  return `fruitulator:keys:${game.system}:${game.name}${build}`;
}

export function saveOptionKeys(game: Game, info: MachineInfo, positions: number[]): void {
  if (!info.optionKeys.length) return;
  const state: Record<string, number> = {};
  info.optionKeys.forEach((k, i) => { state[k.label] = positions[i] ?? k.position; });
  try {
    localStorage.setItem(optionKeySlot(game), JSON.stringify(state));
  } catch {
  }
}

export function readSavedOptionKeys(game: Game): Record<string, number> | undefined {
  try {
    return JSON.parse(localStorage.getItem(optionKeySlot(game)) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

function panelSwitchSlot(game: Game): string {
  return optionKeySlot(game).replace(':keys:', ':switches:');
}

export function savePanelSwitch(game: Game, id: number, on: boolean): void {
  try {
    const state = readSavedPanelSwitches(game) ?? {};
    state[String(id)] = on;
    localStorage.setItem(panelSwitchSlot(game), JSON.stringify(state));
  } catch {
  }
}

export function readSavedPanelSwitches(game: Game): Record<string, boolean> | undefined {
  try {
    return JSON.parse(localStorage.getItem(panelSwitchSlot(game)) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}
