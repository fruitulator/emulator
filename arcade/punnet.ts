import { standing, type ArcadeDoc } from './doc';
import type { GameMeta } from '../web/store';
import { byContentKey } from '../web/contentkeys';
import { localStateStore } from '../web/statestore';
import { unplayableReason } from '../web/libimport';
import { openExportPicker, openPackTarget, packReport, packWithProgress } from '../web/punnetexport';
import { punnetFileName } from '../web/portable';
import { openAlert } from '../web/ui/dialog';
import { pillButton } from '../web/ui/list';
import { showToast } from '../web/ui/toast';
import { str } from '../web/i18n';

export function arcadeGames(doc: ArcadeDoc, library: readonly GameMeta[]): { games: GameMeta[]; missing: number } {
  const byContent = byContentKey(library);
  const byKey = new Map(library.map((g) => [g.hash, g]));
  const games: GameMeta[] = [];
  const seen = new Set<string>();
  let missing = 0;
  for (const m of standing(doc)) {
    const g = byContent.get(m.contentHash) ?? (m.hash ? byKey.get(m.hash) : undefined);
    if (!g) { missing++; continue; }
    if (seen.has(g.hash)) continue;
    seen.add(g.hash);
    games.push(g);
  }
  return { games, missing };
}

export async function exportArcadeGames(doc: ArcadeDoc, library: readonly GameMeta[]): Promise<void> {
  const { games, missing } = arcadeGames(doc, library);
  if (!games.length) {
    showToast(str('arcade.punnet.none_of_this_arcade_s'));
    return;
  }
  const saved = await localStateStore.keys().catch(() => new Set<string>());
  const intro = str('arcade.punnet.your_arcade_s_games_including');
  openExportPicker({
    games, saved, unplayable: unplayableReason, preselected: true, flat: true,
    title: str('arcade.punnet.export_games'),
    intro: missing ? `${intro} ${str('arcade.punnet.n_of_its_machines', { n: missing })}` : intro,
    onSave: (chosen) => {
      const name = punnetFileName(doc.name || `${chosen.length} games`);
      void finish(chosen, openPackTarget(name), name);
    },
  });
}

async function finish(chosen: GameMeta[], pending: ReturnType<typeof openPackTarget>, name: string): Promise<void> {
  const ok = (): { button: HTMLButtonElement; run: () => void } => ({ button: pillButton(str('arcade.punnet.ok'), () => undefined), run: () => undefined });
  let result: Awaited<ReturnType<typeof packWithProgress>>;
  try {
    result = await packWithProgress(chosen, pending, name);
  } catch (e) {
    openAlert({ message: str('arcade.punnet.export_failed_n', { 0: (e as Error).message }), buttons: [ok()] });
    return;
  }
  if (!result) return;
  const r = packReport(result);
  if (r.clean) { showToast(r.message); return; }
  openAlert({ message: r.message, lines: r.lines, buttons: [ok()] });
}
