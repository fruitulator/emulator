import { mountGameList, displayTitle, type Unplayable } from './gamelist';
import { openDialog } from './ui/dialog';
import { actionButton, pillButton } from './ui/list';
import { exportPunnet, punnetFileName } from './portable';
import { PunnetPackWriter, COLLECTION_VERSION, type PackSink } from './punnetpack';
import { saveBlob } from './downloads';
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
  preselected?: boolean;
  flat?: boolean;
  title?: string;
  intro?: string;
}): void {
  const chosen = new Set<string>(o.preselected ? o.games.map((g) => g.hash) : []);
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
    flat: o.flat,
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
  intro.textContent = o.intro ?? str('punnetexport.save_your_games_including_artwork');
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
    title: o.title ?? str('punnetexport.export_games'),
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

export interface PackProgress {
  say(msg: string): void;
  fill(share: number): void;
  readonly stopped: boolean;
  close(): void;
}

export function openPackProgress(title: string): PackProgress {
  const line = document.createElement('p');
  line.className = 'pack-progress-line';
  line.setAttribute('aria-live', 'polite');
  const track = document.createElement('div');
  track.className = 'pack-progress';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', '0');
  const fill = document.createElement('div');
  fill.className = 'pack-progress-fill';
  track.append(fill);
  let stopped = false;
  const stop = pillButton(str('punnetexport.stop'), () => { stopped = true; stop.disabled = true; });
  const acts = document.createElement('div');
  acts.className = 'pack-progress-actions';
  acts.append(stop);
  let closing = false;
  const dialog = openDialog({ title, body: [line, track, acts], onClose: () => { if (!closing) stopped = true; } });
  dialog.panel.classList.add('pack-progress-dialog');
  return {
    say: (msg) => { line.textContent = msg; },
    fill: (share) => {
      const pc = Math.round(Math.max(0, Math.min(1, share)) * 100);
      fill.style.width = `${pc}%`;
      track.setAttribute('aria-valuenow', String(pc));
    },
    get stopped() { return stopped; },
    close: () => { if (closing) return; closing = true; dialog.close(); },
  };
}

export async function packWithProgress(
  chosen: GameMeta[], pending: Promise<PackTarget | null>, name: string,
): Promise<PackResult | null> {
  const target = await pending;
  if (!target) return null;
  const progress = openPackProgress(str('main.packing_n_games', { 0: chosen.length }));
  try {
    const result = await packGames(chosen, target, {
      stop: () => progress.stopped,
      onGame: (i, n, title) => {
        progress.say(str('main.packing_n_n_of_n', { 0: title, 1: i + 1, 2: n }));
        progress.fill(i / n);
      },
    });
    if (!result.stopped && result.written.length) {
      progress.fill(1);
      progress.say(str('main.saving_the_file'));
      const blob = await target.close();
      if (blob) saveBlob(blob, name);
    }
    return result;
  } catch (e) {
    await target.abort().catch(() => undefined);
    throw e;
  } finally {
    progress.close();
  }
}

export function packReport(result: PackResult): { message: string; lines: string[]; clean: boolean } {
  const n = result.written.length;
  const message = result.stopped ? str('main.export_stopped_no_file_was')
    : n === 0 ? str('main.nothing_was_exported')
    : str('main.n_games_saved_in_one', { n, size: fmtSize(result.bytes) });
  const lines = result.failed.map((f) => `${f.title} - ${f.reason}`);
  if (lines.length) lines.unshift(str('main.n_could_not_be_packed', { 0: lines.length }));
  return { message, lines, clean: !lines.length && n > 0 && !result.stopped };
}
