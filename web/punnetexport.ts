import { mountGameList, displayTitle, type Unplayable } from './gamelist';
import { openDialog } from './ui/dialog';
import { actionButton, pillButton } from './ui/list';
import { exportPunnet, punnetFileName } from './portable';
import { PunnetPackWriter, COLLECTION_VERSION, type PackSink } from './punnetpack';
import type { GameMeta } from './store';
import { str } from './i18n';

function fmtSize(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / 1024 ** 2))} MB`;
}

export function openExportPicker(o: {
  games: GameMeta[];
  saved: ReadonlySet<string>;
  unplayable: Unplayable;
  onSave(chosen: GameMeta[]): void;
}): void {
  const chosen = new Set<string>();
  const grid = document.createElement('div');
  grid.className = 'ui-list export-pick-grid';
  const count = document.createElement('span');
  count.className = 'export-pick-count';
  const save = actionButton(str('punnetexport.save_punnet'), 'primary', () => {
    const picked = o.games.filter((g) => chosen.has(g.hash));
    if (!picked.length) return;
    dialog.close();
    o.onSave(picked);
  });

  const update = (): void => {
    const picked = o.games.filter((g) => chosen.has(g.hash));
    const bytes = picked.reduce((n, g) => n + (g.sizeBytes ?? 0), 0);
    count.textContent = picked.length
      ? str('punnetexport.n_of_n_chosen_about', { 0: picked.length, 1: o.games.length, 2: fmtSize(bytes) })
      : str('punnetexport.tap_the_games_to_put');
    save.disabled = !picked.length;
  };

  const list = mountGameList(grid, {
    mode: 'pick',
    unplayable: o.unplayable,
    thumbSize: 'small',
    chosen: (g) => chosen.has(g.hash),
    onPick: (g) => {
      if (chosen.has(g.hash)) chosen.delete(g.hash); else chosen.add(g.hash);
      update();
    },
  });
  const all = pillButton(str('punnetexport.all'), () => {
    for (const g of list.visible(o.games)) chosen.add(g.hash);
    list.refresh();
    update();
  });
  const none = pillButton(str('punnetexport.none'), () => {
    chosen.clear();
    list.refresh();
    update();
  });

  const intro = document.createElement('p');
  intro.className = 'export-pick-intro';
  intro.textContent = str('punnetexport.save_your_games_including_artwork');
  const bar = document.createElement('div');
  bar.className = 'export-pick-bar';
  const picks = document.createElement('div');
  picks.className = 'export-pick-picks';
  picks.append(all, none, count);
  const ends = document.createElement('div');
  ends.className = 'export-pick-picks';
  ends.append(...(list.controls ? [list.controls] : []), save);
  bar.append(picks, ends);

  const dialog = openDialog({
    title: str('punnetexport.export_games'),
    body: [intro, bar, grid],
    actions: list.searchButton ? [list.searchButton] : [],
  });
  dialog.panel.classList.add('export-pick');
  list.load(o.games, o.saved);
  update();
}

export interface PackTarget {
  sink: PackSink;
  close(): Promise<Blob | null>;
  abort(): Promise<void>;
  streamed: boolean;
}

interface SaveFilePicker {
  (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }):
    Promise<{ createWritable(): Promise<{ write(c: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }>;
}

export async function openPackTarget(name: string): Promise<PackTarget | null> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    let handle;
    try {
      handle = await picker({
        suggestedName: name,
        types: [{ description: str('punnetexport.punnet'), accept: { 'application/octet-stream': ['.punnet'] } }],
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      handle = null;
    }
    if (handle) {
      const w = await handle.createWritable();
      return {
        sink: { write: (c) => w.write(c) },
        close: async () => { await w.close(); return null; },
        abort: () => w.abort(),
        streamed: true,
      };
    }
  }
  const parts: Blob[] = [];
  return {
    sink: { write: async (c) => { parts.push(new Blob([c as BlobPart])); } },
    close: async () => new Blob(parts, { type: 'application/octet-stream' }),
    abort: async () => { parts.length = 0; },
    streamed: false,
  };
}

export interface PackResult {
  written: string[];
  failed: { title: string; reason: string }[];
  bytes: number;
  stopped: boolean;
}

export async function packGames(
  games: GameMeta[],
  target: PackTarget,
  o: { onGame?(i: number, n: number, title: string): void; stop?(): boolean } = {},
): Promise<PackResult> {
  const writer = new PunnetPackWriter(target.sink);
  const out: PackResult = { written: [], failed: [], bytes: 0, stopped: false };
  const manifest: { file: string; title: string; hash: string; system: string }[] = [];
  for (let i = 0; i < games.length; i++) {
    if (o.stop?.()) { out.stopped = true; break; }
    const g = games[i];
    const title = displayTitle(g);
    o.onGame?.(i, games.length, title);
    let one: Awaited<ReturnType<typeof exportPunnet>>;
    try {
      one = await exportPunnet(g.hash);
    } catch (e) {
      out.failed.push({ title, reason: (e as Error).message || str('punnetexport.could_not_be_read') });
      continue;
    }
    if (!one) {
      out.failed.push({ title, reason: str('punnetexport.no_longer_in_the_library') });
      continue;
    }
    const file = writer.uniqueName(punnetFileName(title).replace(/\.punnet$/i, ''));
    await writer.add(file, one.bytes);
    manifest.push({ file, title, hash: g.hash, system: g.system });
    out.written.push(title);
  }
  if (out.stopped || !out.written.length) {
    await target.abort();
    return out;
  }
  await writer.finish({
    kind: 'punnet-collection', version: COLLECTION_VERSION, exportedAt: Date.now(), games: manifest,
  });
  out.bytes = writer.size;
  return out;
}
