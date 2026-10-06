import type { Game } from '../src/machine/registry';
import { controlName } from './controlname';
import { hasInput, type CabLamp } from './dat';
import { formatDiagLog, type DiagEntry } from './diaglog';
import type { MachineInfo } from './emu-protocol';
import type { PlatformView } from './platform';
import type { Snapshot } from './snapshot';

declare const __BUILD_ID__: string;
declare const __BUILD_TIME__: string;

export function saveFile(content: string | Uint8Array, name: string, type: string): void {
  saveBlob(new Blob([content as BlobPart], { type }), name);
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), Math.max(60_000, blob.size / 1000));
}

export function saveSnapshot(emu: { snapshot(): Promise<Snapshot | null> }): Promise<Snapshot | null> {
  return emu.snapshot().then((snap) => {
    if (!snap) return null;
    const stamp = snap.cycles.toString(16);
    saveFile(
      JSON.stringify(snap),
      `${(snap.game || 'machine').replace(/\s+/g, '_')}-${stamp}.snapshot.json`,
      'application/json',
    );
    return snap;
  });
}

export function buildStamp(): string {
  const t = new Date(__BUILD_TIME__);
  const when = Number.isNaN(t.getTime()) ? '' : ` · ${t.getDate()} ${t.toLocaleString('en-GB', { month: 'short' })} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  return `${__BUILD_ID__}${when}${import.meta.env.DEV ? ' · dev' : ''}`;
}

export async function saveDiagLog(
  emu: { diagLog(): Promise<DiagEntry[]> }, game: Game | null,
  sound?: string,
): Promise<number> {
  const entries = await emu.diagLog();
  saveFile(
    formatDiagLog(entries, {
      game: game ? `${game.name}${game.variants.length > 1 ? ` · ${game.variant}` : ''}` : 'unknown',
      system: game?.system ?? 'unknown',
      build: buildStamp(),
      ...(sound ? { sound } : {}),
    }),
    `${(game?.name ?? 'machine').replace(/\s+/g, '_')}.diag.log`,
    'text/plain',
  );
  return entries.length;
}

export function logInputLabels(
  view: PlatformView, info: MachineInfo, lamps: readonly CabLamp[],
): { labels: Record<number, string>; coinNames: Record<number, string> } {
  const labels: Record<number, string> = {};
  for (const ni of view.namedInputs) labels[ni.strobe * 8 + ni.bit] = ni.label;
  for (const sw of info.switchPanel) labels[sw.id] = sw.label;
  for (const lp of lamps) {
    if (lp.acceptor || !hasInput(lp)) continue;
    labels[lp.button] = controlName(lp, view, info.coins ?? view.coins, info.capNames, info.coinPort);
  }
  const coinNames: Record<number, string> = {};
  for (const c of info.coins ?? view.coins) coinNames[c.bit] = c.label;
  return { labels, coinNames };
}
