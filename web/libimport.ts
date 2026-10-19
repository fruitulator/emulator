import { platformFor } from '../src/machine/registry';
import { parseGam } from '../src/machine/gam';
import { DECODE_VERSION } from './gamepak';
import { importPunnet, importUpload, type ImportEvents } from './importer';
import type { ImportStage } from './import-protocol';
import {
  listZipSet, punnetBytes, readFolderSetGames, setFingerprint, setImportCost, sniffPunnetSet,
  splitZipSet,
  type FolderSet,
} from './ingest';
import { closeCabinet } from './cabjson';
import { readZipEntry } from './zipdir';
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
  if (meta.damagedRoms?.length) {
    flaws.push(str('libimport.damaged_in_copying_n', { 0: meta.damagedRoms.join(', ') }));
  }
  if (meta.decodeStatus === 'fallback') flaws.push(str('libimport.no_artwork_layout_not_decoded'));
  if (meta.linkedInstances?.length) {
    flaws.push(str('libimport.linked_bank_drives_n_other', { 0: meta.linkedInstances.length }));
  }
  return flaws;
}

export async function listArchives(
  sets: FolderSet[],
  o: { onEach?(i: number, n: number, set: FolderSet): void; stop?(): boolean; trace?(line: string): void } = {},
): Promise<FolderSet[]> {
  for (const s of sets) if (s.punnet) await sniffPunnetSet(s);
  const archives = sets.filter((s) => s.zip);
  for (let i = 0; i < archives.length; i++) {
    if (o.stop?.()) return [];
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
  const split = sets.flatMap((set) => {
    const parts = splitZipSet(set);
    if (parts.length > 1) o.trace?.(`${set.name} holds ${parts.length} games`);
    return parts;
  });
  return borrowSplitSets(split, o.trace);
}

const STATE_ONLY = /\.(gam|ram|eep|e2p|rtc|wsp)$/i;

async function borrowSplitSets(sets: FolderSet[], trace?: (line: string) => void): Promise<FolderSet[]> {
  interface Member { name: string; read(): Promise<Uint8Array>; give(to: FolderSet): void }
  const archiveOf = (s: FolderSet): File | undefined =>
    (s.zip && s.listing && !s.inner ? s.entries[0] : undefined);
  const membersOf = (s: FolderSet): Member[] => {
    const archive = archiveOf(s);
    if (!archive) {
      return s.entries.map((f) => ({
        name: f.name,
        read: async () => new Uint8Array(await f.arrayBuffer()),
        give: (to) => { to.entries = [...to.entries, f]; },
      }));
    }
    return s.listing!.map((e) => ({
      name: e.name.slice(e.name.lastIndexOf('/') + 1),
      read: () => readZipEntry(archive, e),
      give: (to) => { to.listing = [...to.listing!, e]; },
    }));
  };
  const loose = sets.filter((s) => (!s.zip && !s.punnet) || archiveOf(s));
  const lower = (n: string): string => n.slice(Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\')) + 1).toLowerCase();
  const consumed = new Set<FolderSet>();
  for (const set of loose) {
    const mine = membersOf(set);
    if (!mine.length || !mine.every((m) => STATE_ONLY.test(m.name))) continue;
    const gams = mine.filter((m) => /\.gam$/i.test(m.name));
    if (!gams.length) continue;
    const named = new Set<string>();
    for (const g of gams) {
      const gam = parseGam(new TextDecoder('latin1').decode(await g.read()));
      for (const n of [gam.layout ?? '', ...gam.roms, ...gam.vidRoms, ...gam.sound]) if (n) named.add(lower(n));
    }
    const have = new Set(mine.map((m) => m.name.toLowerCase()));
    const missing = [...named].filter((n) => !have.has(n));
    if (!missing.length) continue;
    const donors = loose.filter((d) => d !== set && archiveOf(d) === archiveOf(set)
      && missing.every((n) => membersOf(d).some((m) => m.name.toLowerCase() === n)));
    if (donors.length !== 1) {
      trace?.(`${set.name}: ${donors.length ? `${donors.length} folders hold` : 'no folder holds'} the files its .gam names; left as it is`);
      continue;
    }
    const donor = donors[0];
    const theirs = membersOf(donor);
    const taken = missing.map((n) => theirs.find((m) => m.name.toLowerCase() === n)!);
    for (const m of taken) m.give(set);
    trace?.(`${set.name}: took ${taken.length} file(s) from ${donor.dir}`);
    if (!theirs.some((m) => /\.gam$/i.test(m.name))) consumed.add(donor);
  }
  return sets.filter((s) => !consumed.has(s));
}

export function byteGate(budget: number): {
  admit(bytes: number): Promise<void>;
  release(bytes: number): void;
} {
  let inFlight = 0;
  const queue: { bytes: number; go(): void }[] = [];
  const pump = (): void => {
    while (queue.length && (inFlight === 0 || inFlight + queue[0].bytes <= budget)) {
      const next = queue.shift()!;
      inFlight += next.bytes;
      next.go();
    }
  };
  return {
    admit: (bytes) => new Promise<void>((go) => { queue.push({ bytes, go }); pump(); }),
    release: (bytes) => { inFlight = Math.max(0, inFlight - bytes); pump(); },
  };
}

const IMPORT_BYTE_BUDGET = 384 * 1024 * 1024;
const budget = byteGate(IMPORT_BYTE_BUDGET);

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
  const bytes = await setImportCost(set);
  await budget.admit(bytes);
  try {
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
      }, true, true);
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
  } finally {
    budget.release(bytes);
  }
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
