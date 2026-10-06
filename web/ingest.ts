import { repairC1 } from './cp437';
import type { GameFile } from '../src/machine/registry';
import { STATE_ONLY, isSetFile } from '../src/machine/setfiles';
import { isEffectSample } from '../src/machine/effects';

function isImportFile(name: string): boolean {
  return isSetFile(name) || isEffectSample(name);
}
import { looksLikeZip, readZipDirectory, readZipEntry, type ZipEntry } from './zipdir';
import { collectionEntries } from './punnetpack';

function canonical(files: GameFile[]): GameFile[] {
  return files.sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
}

export function folderNameFromInput(list: Iterable<File>): string | undefined {
  const rel = [...list].map((f) => f.webkitRelativePath).find(Boolean);
  return rel?.split('/')[0] || undefined;
}

export function entriesFromDrop(items: DataTransferItemList): (FileSystemEntry | File)[] {
  const out: (FileSystemEntry | File)[] = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) out.push(entry);
    else {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

export async function filesFromDrop(entries: (FileSystemEntry | File)[]): Promise<File[]> {
  const files: File[] = [];
  for (const e of entries) {
    if (e instanceof File) files.push(e);
    else await walkEntry(e, e.name, files);
  }
  return files;
}

async function walkEntry(entry: FileSystemEntry, path: string, out: File[]): Promise<void> {
  if (entry.isFile) {
    const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push(withRelativePath(f, path));
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (batch.length === 0) break;
    for (const child of batch) await walkEntry(child, `${path}/${child.name}`, out);
  }
}

export function withRelativePath(file: File, path: string): File {
  Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
  return file;
}

function under(dir: string, path: string): boolean {
  return dir === '' || path === dir || path.startsWith(`${dir}/`);
}

function gamDirs(paths: string[]): { games: Set<string>; state: Set<string> } {
  const games = new Set<string>();
  const state = new Set<string>();
  for (const p of paths) {
    if (!/\.gam$/i.test(p)) continue;
    const dir = dirOf(p);
    if (games.has(dir) || state.has(dir)) continue;
    const below = paths.filter((q) => under(dir, dirOf(q)));
    const runnable = below.some((q) => !STATE_ONLY.test(q));
    const battery = below.some((q) => /\.ram$/i.test(q));
    (!runnable && battery ? state : games).add(dir);
  }
  return { games, state };
}

function isJunk(path: string): boolean {
  const parts = path.split('/');
  const base = parts[parts.length - 1];
  return (
    parts.includes('__MACOSX') ||
    base === '.DS_Store' ||
    base === 'Thumbs.db' ||
    base.startsWith('._')
  );
}

export interface ZipGameSet {
  name?: string;
  files: GameFile[];
  spares?: GameFile[];
}

function spareName(path: string, stateDir: string, owner: string | undefined): string {
  const base = owner !== undefined && under(owner, stateDir) ? owner : dirOf(stateDir);
  return base === '' ? path : path.slice(base.length + 1);
}

interface ZipGamePlan {
  name?: string;
  entries: ZipEntry[];
  spares: { name: string; entry: ZipEntry }[];
}

function planZipGames(listing: ZipEntry[]): ZipGamePlan[] {
  const entries = listing
    .map((e) => ({ ...e, name: repairC1(e.name) }))
    .filter((e) => !isJunk(e.name) && isImportFile(e.name));

  const { games, state } = gamDirs(entries.map((e) => e.name));
  const stateDirOf = (path: string): string | undefined =>
    [...state].find((d) => under(d, dirOf(path)));
  const live = entries.filter((e) => stateDirOf(e.name) === undefined);
  const spare = entries.filter((e) => stateDirOf(e.name) !== undefined);
  const sparesFor = (owner: string | undefined, every: boolean): ZipGamePlan['spares'] =>
    spare
      .filter((e) => every || nearest(games, dirOf(stateDirOf(e.name)!)) === owner)
      .map((e) => ({ name: spareName(e.name, stateDirOf(e.name)!, owner), entry: e }));

  if (games.size <= 1) return [{ entries: live, spares: sparesFor([...games][0], true) }];

  return [...games].sort().map((dir) => ({
    name: dir.slice(dir.lastIndexOf('/') + 1) || undefined,
    entries: live.filter((e) => nearest(games, dirOf(e.name)) === dir),
    spares: sparesFor(dir, false),
  }));
}

async function readZipPlan(blob: Blob, plan: ZipGamePlan): Promise<ZipGameSet> {
  const files: GameFile[] = [];
  for (const e of plan.entries) {
    files.push({ name: e.name.slice(e.name.lastIndexOf('/') + 1), bytes: await readZipEntry(blob, e) });
  }
  const set: ZipGameSet = { ...(plan.name !== undefined ? { name: plan.name } : {}), files: canonical(files) };
  if (plan.spares.length) {
    const spares: GameFile[] = [];
    for (const s of plan.spares) spares.push({ name: s.name, bytes: await readZipEntry(blob, s.entry) });
    set.spares = canonical(spares);
  }
  return set;
}

export async function gameSetsFromZip(zip: Uint8Array | Blob, listing?: ZipEntry[]): Promise<ZipGameSet[]> {
  const blob = await toBlob(zip);
  const sets: ZipGameSet[] = [];
  for (const plan of planZipGames(listing ?? await readZipDirectory(blob))) {
    sets.push(await readZipPlan(blob, plan));
  }
  return sets;
}

export async function zipGameCount(zip: Uint8Array | Blob, listing?: ZipEntry[]): Promise<number> {
  return planZipGames(listing ?? await readZipDirectory(await toBlob(zip))).length;
}

export function splitZipSet(set: FolderSet): FolderSet[] {
  if (!set.zip || !set.listing) return [set];
  const punnets = collectionEntries(set.listing);
  if (punnets) {
    return punnets.map((e): FolderSet => ({
      dir: `${set.dir}/${e.name}`,
      name: e.name.slice(e.name.lastIndexOf('/') + 1).replace(/\.punnet$/i, ''),
      entries: set.entries,
      punnet: true,
      inner: e,
      listing: [e],
    }));
  }
  const plans = planZipGames(set.listing);
  if (plans.length < 2) return [set];
  const parts = plans.map((plan): FolderSet => {
    const listing = [...plan.entries, ...plan.spares.map((s) => s.entry)];
    const inner = plan.entries[0]?.name ?? '';
    return {
      dir: `${set.dir}/${inner.slice(0, inner.lastIndexOf('/'))}`,
      name: plan.name ?? set.name,
      entries: set.entries,
      zip: true,
      listing,
    };
  });
  const same = parts.every((p, i) => {
    const again = planZipGames(p.listing!);
    return again.length === 1
      && again[0].entries.length === plans[i].entries.length
      && again[0].spares.length === plans[i].spares.length;
  });
  return same ? parts : [set];
}

export async function filesFromZip(zip: Uint8Array | Blob): Promise<GameFile[]> {
  return (await gameFromZip(zip)).files;
}

export async function gameFromZip(zip: Uint8Array | Blob, listing?: ZipEntry[]): Promise<ZipGameSet> {
  const sets = await gameSetsFromZip(zip, listing);
  if (sets.length > 1) {
    throw new Error('zip contains multiple games - upload one game per zip');
  }
  return sets[0] ?? { files: [] };
}

export interface FolderSet {
  dir: string;
  name: string;
  entries: File[];
  zip?: boolean;
  listing?: ZipEntry[];
  punnet?: boolean;
  inner?: ZipEntry;
  spares?: { name: string; file: File }[];
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function isAncestor(dir: string, of: string): boolean {
  return dir === of || of.startsWith(dir + '/');
}

function nearest(dirs: Set<string>, dir: string): string | undefined {
  for (let d: string = dir; ; d = dirOf(d)) {
    if (dirs.has(d)) return d;
    if (!d.includes('/')) return undefined;
  }
}

export function setsFromFolderInput(list: Iterable<File>): FolderSet[] {
  const picked = [...list]
    .map((file) => ({ file, path: file.webkitRelativePath || file.name }))
    .filter((e) => !isJunk(e.path));

  const { games, state } = gamDirs(picked.map((e) => e.path));
  const spare = [...state];
  const stateDirOf = (path: string): string | undefined =>
    spare.find((d) => under(d, dirOf(path)));
  const dirs = new Set(games);
  const layoutDirs = [...new Set(
    picked.filter((e) => /\.(fml|dat)$/i.test(e.path)).map((e) => dirOf(e.path)),
  )].sort((a, b) => a.split('/').length - b.split('/').length);
  for (const d of layoutDirs) {
    if (![...dirs].some((s) => isAncestor(s, d))) dirs.add(d);
  }

  const zipSets: FolderSet[] = [];
  const zipped = new Set<File>();
  for (const e of picked) {
    const archive = /\.(zip|punnet)$/i.exec(e.path);
    if (!archive) continue;
    if ([...dirs].some((s) => isAncestor(s, dirOf(e.path)))) continue;
    const base = e.path.slice(e.path.lastIndexOf('/') + 1);
    zipSets.push({
      dir: e.path,
      name: base.slice(0, -archive[0].length),
      entries: [e.file],
      ...(archive[1].toLowerCase() === 'punnet' ? { punnet: true } : { zip: true }),
    });
    zipped.add(e.file);
  }

  const byDir = (a: FolderSet, b: FolderSet): number =>
    (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0);

  const sparesOf = (owner: string | undefined, every: boolean): Pick<FolderSet, 'spares'> => {
    const mine = picked.filter((e) => {
      const s = stateDirOf(e.path);
      return s !== undefined && !zipped.has(e.file)
        && (every || nearest(dirs, dirOf(s)) === owner);
    });
    return mine.length
      ? { spares: mine.map((e) => ({ name: spareName(e.path, stateDirOf(e.path)!, owner), file: e.file })) }
      : {};
  };

  if (dirs.size === 0) {
    const loose = picked.filter((e) => !zipped.has(e.file) && stateDirOf(e.path) === undefined);
    const name = folderNameFromInput(list) ?? '';
    const rest: FolderSet[] = loose.length && !zipSets.length
      ? [{ dir: name, name, entries: loose.map((e) => e.file), ...sparesOf(undefined, true) }]
      : [];
    return [...zipSets, ...rest].sort(byDir);
  }

  const sets = new Map<string, File[]>();
  for (const d of dirs) sets.set(d, []);
  for (const e of picked) {
    if (zipped.has(e.file) || stateDirOf(e.path) !== undefined) continue;
    const owner = nearest(dirs, dirOf(e.path));
    if (owner) sets.get(owner)!.push(e.file);
  }
  return [...sets]
    .map(([dir, entries]): FolderSet => ({
      dir, name: dir.slice(dir.lastIndexOf('/') + 1), entries, ...sparesOf(dir, false),
    }))
    .concat(zipSets)
    .sort(byDir);
}

export async function setFingerprint(set: FolderSet): Promise<string | undefined> {
  const parts: string[] = [];
  if (set.listing) {
    for (const e of set.listing) parts.push(`${e.name}\n${e.size}\n${e.crc32.toString(16)}`);
    if (parts.length === 0) return undefined;
    return digestOf(parts);
  }
  for (const f of set.entries) {
    const path = f.webkitRelativePath || f.name;
    if (!Number.isFinite(f.size) || !Number.isFinite(f.lastModified)) return undefined;
    parts.push(`${path}\n${f.size}\n${f.lastModified}`);
  }
  if (parts.length === 0) return undefined;
  return digestOf(parts);
}

async function digestOf(parts: string[]): Promise<string> {
  const canonical = new TextEncoder().encode(parts.sort().join('\n'));
  const digest = await crypto.subtle.digest('SHA-256', canonical);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function listZipSet(set: FolderSet): Promise<void> {
  if (!set.zip || set.listing) return;
  set.listing = await readZipDirectory(await toBlob(set.entries[0]));
}

export async function sniffPunnetSet(set: FolderSet): Promise<void> {
  if (!set.punnet || set.inner || !set.entries[0]) return;
  try {
    const head = new Uint8Array(await (await toBlob(set.entries[0])).slice(0, 4).arrayBuffer());
    if (looksLikeZip(head)) {
      delete set.punnet;
      set.zip = true;
    }
  } catch {  }
}

export async function punnetBytes(set: FolderSet): Promise<Uint8Array> {
  const file = set.entries[0];
  if (!file) throw new Error('no file');
  if (set.inner) return readZipEntry(await toBlob(file), set.inner);
  return new Uint8Array(await file.arrayBuffer());
}

async function toBlob(zip: Uint8Array | Blob): Promise<Blob> {
  if (zip instanceof Uint8Array) return new Blob([zip as BlobPart]);
  if (typeof zip.slice === 'function' && typeof zip.size === 'number') return zip;
  return new Blob([await zip.arrayBuffer()]);
}

export async function readFolderSet(set: FolderSet): Promise<GameFile[]> {
  return (await readFolderSetOne(set)).files;
}

export async function readFolderSetOne(
  set: FolderSet,
): Promise<{ files: GameFile[]; spares?: GameFile[] }> {
  if (set.punnet) throw new Error('a .punnet is imported whole, not read as files');
  if (set.zip) {
    const archive = set.entries[0];
    if (!archive) return { files: [] };
    const game = await gameFromZip(archive, set.listing);
    return { files: game.files, ...(game.spares ? { spares: game.spares } : {}) };
  }
  const read = (name: string, f: File): Promise<GameFile> =>
    f.arrayBuffer().then((b) => ({ name, bytes: new Uint8Array(b) }));
  const files = canonical(await Promise.all(
    set.entries.filter((f) => isImportFile(f.name)).map((f) => read(f.name, f))));
  if (!set.spares?.length) return { files };
  return { files, spares: canonical(await Promise.all(set.spares.map((s) => read(s.name, s.file)))) };
}

export async function readFolderSetGames(
  set: FolderSet,
): Promise<{ name: string; files: GameFile[]; spares?: GameFile[] }[]> {
  if (set.punnet) throw new Error('a .punnet is imported whole, not read as files');
  if (set.zip) {
    const archive = set.entries[0];
    if (!archive) return [];
    return (await gameSetsFromZip(archive, set.listing))
      .map((s) => ({ ...s, name: s.name ?? set.name }));
  }
  return [{ name: set.name, ...(await readFolderSetOne(set)) }];
}
