import { platformFor } from '../src/machine/registry';
import { DECODE_VERSION } from './gamepak';
import { importPunnet, importUpload, type ImportEvents } from './importer';
import type { ImportStage } from './import-protocol';
import {
  listZipSet, punnetBytes, readFolderSetGames, setFingerprint, sniffPunnetSet, splitZipSet,
  type FolderSet,
} from './ingest';
import { closeCabinet } from './cabjson';
import {
  SCHEMA_VERSION, getMeta, getSeenHashes, hashGameFiles, inSpareDir, putSeen, type GameMeta,
} from './store';
import { str } from './i18n';

export function unplayableReason(g: GameMeta): { label: string; detail: string } | null {
  if (!platformFor(g.system)) {
    return {
      label: str('libimport.cannot_run'),
      detail: str('libimport.this_build_has_no_n', { 0: g.system }),
    };
  }
  if (g.missingRoms?.length) {
    return {
      label: str('libimport.roms_missing'),
      detail: str('libimport.the_gam_names_program_roms')
        + g.missingRoms.join(', '),
    };
  }
  if (g.linkedInstances?.length) {
    const n = g.linkedInstances.length;
    return {
      label: str('libimport.linked_cabinet'),
      detail: str('libimport.this_is_the_top_box', { n, 2: g.linkedInstances.map((p) => p.split(/[\\/]/).pop()).join(', ') }),
    };
  }
  return null;
}

export function landedFlaws(meta: GameMeta): string[] {
  const flaws: string[] = [];
  if (meta.missingRoms?.length) {
    flaws.push(str('libimport.missing_roms_n', { 0: meta.missingRoms.join(', ') }));
  }
  if (meta.decodeStatus === 'fallback') flaws.push(str('libimport.no_artwork_layout_not_decoded'));
  if (meta.linkedInstances?.length) {
    flaws.push(str('libimport.linked_bank_drives_n_other', { 0: meta.linkedInstances.length }));
  }
  return flaws;
}

export async function listArchives(
  sets: FolderSet[],
  o: { onEach?(i: number, n: number, set: FolderSet): void; trace?(line: string): void } = {},
): Promise<FolderSet[]> {
  for (const s of sets) if (s.punnet) await sniffPunnetSet(s);
  const archives = sets.filter((s) => s.zip);
  for (let i = 0; i < archives.length; i++) {
    o.onEach?.(i, archives.length, archives[i]);
    const t0 = Date.now();
    try {
      await listZipSet(archives[i]);
      o.trace?.(`listed ${archives[i].name}: ${archives[i].listing?.length ?? 0} entries in ${Date.now() - t0}ms`);
    } catch (e) {
      o.trace?.(`could not list ${archives[i].name} after ${Date.now() - t0}ms: ${(e as Error).message}`);
      console.warn(`[library] could not list ${archives[i].name}`, e);
    }
  }
  return sets.flatMap((set) => {
    const parts = splitZipSet(set);
    if (parts.length > 1) o.trace?.(`${set.name} holds ${parts.length} games`);
    return parts;
  });
}

export interface SetImportContext {
  inFlight: Map<string, Promise<GameMeta>>;
  landed(name: string, meta: GameMeta, hash: string): void;
  known(hashes: string[]): void;
  setAdded: string[];
  onProgress?: ImportEvents['onProgress'];
  trace?(line: string): void;
}

export async function importFolderSet(set: FolderSet, ctx: SetImportContext): Promise<void> {
  const current = (m: GameMeta | null): boolean =>
    !!m && m.schema === SCHEMA_VERSION && m.decodeVersion === DECODE_VERSION;
  const kept = (m: GameMeta | null, spares: unknown[] | undefined): boolean =>
    !spares?.length || !!m?.batteries?.some(inSpareDir);
  const fp = await setFingerprint(set);
  const seen = fp ? await getSeenHashes(fp) : null;
  if (seen?.length && (await Promise.all(seen.map(getMeta)))
    .every((m) => current(m) && kept(m, set.spares))) {
    ctx.known(seen);
    return;
  }
  const events: ImportEvents = ctx.onProgress ? { onProgress: ctx.onProgress } : {};
  if (set.punnet) {
    const bytes = await punnetBytes(set);
    const meta = await importPunnet(bytes, set.name, events);
    ctx.setAdded.push(meta.hash);
    ctx.landed(set.name, meta, meta.hash);
    if (fp) await putSeen(fp, [meta.hash]);
    return;
  }
  const units = await readFolderSetGames(set);
  ctx.trace?.(`read ${set.name}: ${units.length} game(s), ${units.reduce((n, u) => n + u.files.length, 0)} file(s)`);
  const hashes: string[] = [];
  for (const unit of units) {
    const hash = await hashGameFiles(unit.files);
    const held = await getMeta(hash);
    if (current(held) && kept(held, unit.spares)) {
      ctx.known([hash]);
      hashes.push(hash);
      continue;
    }
    const busy = ctx.inFlight.get(hash);
    if (busy) {
      await busy.catch(() => undefined);
      const now = await getMeta(hash);
      if (current(now) && kept(now, unit.spares)) {
        ctx.known([hash]);
        hashes.push(hash);
        continue;
      }
    }
    const src = { files: unit.files, hash, ...(unit.spares ? { spares: unit.spares } : {}) };
    const job = importUpload(src, unit.name, {
      ...events,
      onCabinet: (cab) => { if (cab) closeCabinet(cab); },
    }, true);
    ctx.inFlight.set(hash, job);
    let meta: GameMeta;
    try {
      meta = await job;
    } finally {
      if (ctx.inFlight.get(hash) === job) ctx.inFlight.delete(hash);
    }
    hashes.push(hash);
    ctx.setAdded.push(hash);
    ctx.landed(unit.name, meta, hash);
  }
  if (fp && units.length) await putSeen(fp, hashes);
}

export function stageText(stage: ImportStage, name?: string): string | null {
  switch (stage) {
    case 'unpacking': return str('libimport.unpacking_zip');
    case 'hashing': return str('libimport.checking_game_files');
    case 'decoding': return name ? str('libimport.decoding_n_artwork', { 0: name }) : str('libimport.decoding_artwork');
    default: return name ? str('libimport.saving_n_to_the_library', { 0: name }) : str('libimport.saving_to_the_library');
  }
}

export const CLOUD_HINT = str('libimport.a_file_picked_from_a');
