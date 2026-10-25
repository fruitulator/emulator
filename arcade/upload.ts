import { setsFromFolderInput, type FolderSet } from '../web/ingest';
import { importConcurrency, type ImportError } from '../web/importer';
import {
  CLOUD_HINT, importFolderSet, landedFlaws, listArchives, stageText, unplayableReason,
} from '../web/libimport';
import { requestStoragePersist } from '../web/persist';
import { parseTitle } from '../web/title';
import { getMeta, type GameMeta } from '../web/store';
import { str } from '../web/i18n';

export interface UploadProblem { name: string; reason: string }

export interface UploadResult {
  games: GameMeta[];
  problems: UploadProblem[];
  empty: boolean;
}

export type UploadProgress = (text: string, done?: number) => void;

const titleOf = (set: FolderSet): string => parseTitle(set.name).title || set.name;

export async function uploadToLibrary(files: File[], progress: UploadProgress): Promise<UploadResult> {
  const picked = setsFromFolderInput(files);
  if (!picked.length) return { games: [], problems: [], empty: true };
  progress(picked.length === 1 ? str('arcade.upload.reading_n', { 0: files[0]?.name ?? titleOf(picked[0]) }) : str('arcade.upload.reading_n_files', { 0: files.length }));
  const sets = await listArchives(picked, {
    onEach: (i, n, set) => progress(n > 1
      ? str('arcade.upload.looking_inside_n_n_of', { 0: set.name, 1: i + 1, 2: n }) : str('arcade.upload.looking_inside_n', { 0: set.name })),
  });

  const landed: { name: string; meta: GameMeta }[] = [];
  const held: string[] = [];
  const problems: UploadProblem[] = [];
  const inFlight = new Map<string, Promise<GameMeta>>();
  let quota = false;
  let completed = 0;
  let cursor = 0;
  progress(sets.length === 1 ? str('arcade.upload.importing_n', { 0: titleOf(sets[0]) }) : str('arcade.upload.importing_n_sets', { 0: sets.length }), 0);
  const runner = async (): Promise<void> => {
    for (;;) {
      if (quota) return;
      const i = cursor++;
      if (i >= sets.length) return;
      const set = sets[i];
      try {
        await importFolderSet(set, {
          inFlight,
          setAdded: [],
          landed: (name, meta) => { landed.push({ name, meta }); },
          known: (hashes) => { held.push(...hashes); },
          ...(sets.length === 1 ? {
            onProgress: (stage) => { const t = stageText(stage, titleOf(set)); if (t) progress(t); },
          } : {}),
        });
      } catch (e) {
        const err = e as ImportError;
        console.warn(`[arcade] import failed: ${set.name}`, e);
        if (err.code === 'quota') {
          quota = true;
          problems.push({ name: set.name, reason: str('arcade.upload.the_library_is_full_delete') });
        } else {
          problems.push({
            name: set.name,
            reason: `${err.message || str('arcade.upload.it_could_not_be_read')}${e instanceof DOMException ? `.${CLOUD_HINT}` : ''}`,
          });
        }
      }
      completed++;
      progress(str('arcade.upload.imported_n_n_of_n', { 0: titleOf(set), 1: completed, 2: sets.length }), completed / sets.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(importConcurrency(), sets.length) }, runner));
  if (landed.length) requestStoragePersist();

  const games = new Map<string, GameMeta>();
  const sort = (name: string, meta: GameMeta): void => {
    const why = unplayableReason(meta);
    const flaws = landedFlaws(meta);
    if (why || flaws.length) {
      problems.push({ name, reason: str('arcade.upload.added_to_your_library_but', { 0: why ? why.detail : flaws.join('; ') }) });
      return;
    }
    games.set(meta.hash, meta);
  };
  for (const l of landed) sort(l.name, l.meta);
  for (const hash of held) {
    const meta = await getMeta(hash).catch(() => null);
    if (meta && !games.has(hash)) sort(meta.name, meta);
  }
  return { games: [...games.values()], problems, empty: false };
}
