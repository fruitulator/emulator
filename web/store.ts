import type { GameFile, GameVariant, LayoutProps } from '../src/machine/registry';
import { contentFiles, setFiles } from '../src/machine/setfiles';
import { isEffectSample } from '../src/machine/effects';
import { encodeSrcs } from './gamepak';

export type { GameVariant };

export const SCHEMA_VERSION = 7;

export interface GameMeta {
  hash: string;
  schema: number;
  name: string;
  system: string;
  addedAt: number;
  lastPlayedAt: number;
  playedAt?: number;
  playCount?: number;
  missingRoms?: string[];
  missingSound?: string[];
  linkedInstances?: string[];
  decodeVersion: number;
  decodeStatus: 'ok' | 'partial' | 'fallback' | 'pending';
  decode?: { clean: number; total: number };
  autoSave: boolean;
  sizeBytes: number;
  hasThumb: boolean;
  thumbFromPlay?: boolean;
  thumbRule?: number;
  variants: GameVariant[];
  variant: string;
  sourceName?: string;
  title?: string;
  coinAnswers?: Record<string, number | 'token'>;
  layoutProps?: LayoutProps;
  contentHash?: string;
  contentRule?: number;
  batteries?: string[];
  maker?: string;
  makerRule?: number;
  missingRule?: number;
}

export const MISSING_ROM_RULE = 1;

export const inSpareDir = (path: string): boolean => path.includes('/');

export function batteryLabel(path: string): string {
  const slash = path.lastIndexOf('/');
  if (slash >= 0) return path.slice(0, slash);
  const dot = path.lastIndexOf('.');
  return dot > 0 ? path.slice(0, dot) : path;
}

export interface StateRec {
  hash: string;
  schema: number;
  savedAt: number;
  cycles: number;
  build?: string;
  stamp?: string;
  nvram?: Uint8Array;
  data: Uint8Array;
}

export interface MoneyStoreRec { hash: string; record: unknown }

const DB_NAME = 'fruitulator';
const DB_VERSION = 5;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('games')) {
        db.createObjectStore('games', { keyPath: 'hash' });
        db.createObjectStore('paks', { keyPath: 'hash' });
        db.createObjectStore('states', { keyPath: 'hash' });
      }
      if (!db.objectStoreNames.contains('seen')) {
        db.createObjectStore('seen', { keyPath: 'fp' });
      }
      if (!db.objectStoreNames.contains('arcade')) {
        db.createObjectStore('arcade', { keyPath: 'hash' });
      }
      if (!db.objectStoreNames.contains('money')) {
        db.createObjectStore('money', { keyPath: 'hash' });
      }
      if (!db.objectStoreNames.contains('thumbs')) {
        db.createObjectStore('thumbs', { keyPath: 'hash' });
        if ((ev.oldVersion ?? 0) >= 1) {
          const tx = req.transaction!;
          const games = tx.objectStore('games');
          const thumbs = tx.objectStore('thumbs');
          games.openCursor().onsuccess = (e) => {
            const cur = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (!cur) return;
            const rec = cur.value as GameMeta & { thumb?: Uint8Array | null };
            const bytes = rec.thumb;
            delete rec.thumb;
            rec.hasThumb = !!bytes;
            if (bytes) thumbs.put({ hash: rec.hash, bytes });
            cur.update(rec);
            cur.continue();
          };
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const mine = dbPromise;
      db.onversionchange = () => {
        db.close();
        if (dbPromise === mine) dbPromise = null;
      };
      db.onclose = () => {
        if (dbPromise === mine) dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

export class EraseBlockedError extends Error {
  constructor() {
    super('another tab is holding the library open');
    this.name = 'EraseBlockedError';
  }
}

export function eraseLibrary(timeoutMs = 10_000): Promise<void> {
  const mine = dbPromise;
  dbPromise = null;
  return new Promise((resolve, reject) => {
    const go = () => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      const timer = setTimeout(() => reject(new EraseBlockedError()), timeoutMs);
      req.onsuccess = () => { clearTimeout(timer); resolve(); };
      req.onerror = () => {
        clearTimeout(timer);
        reject(req.error ?? new Error('IndexedDB delete failed'));
      };
    };
    if (mine) mine.then((db) => { db.close(); go(); }, go);
    else go();
  });
}

async function op<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function upgrade(rec: GameMeta): GameMeta {
  if (rec.schema >= 2) return rec;
  const legacy = rec as Partial<GameMeta>;
  return { ...rec, variants: legacy.variants ?? [], variant: legacy.variant ?? '' };
}

export function playCountOf(g: GameMeta): number {
  return g.playCount ?? (g.playedAt !== undefined || g.schema < 5 ? 1 : 0);
}

export function everPlayed(g: GameMeta): boolean {
  return g.playedAt !== undefined || g.schema < 5;
}

export function lastPlayed(g: GameMeta): number | undefined {
  return everPlayed(g) ? g.playedAt ?? g.lastPlayedAt : undefined;
}

export async function listGames(): Promise<GameMeta[]> {
  return (await op<GameMeta[]>('games', 'readonly', (s) => s.getAll())).map(upgrade);
}

export async function getMeta(hash: string): Promise<GameMeta | null> {
  const rec = await op<GameMeta | undefined>('games', 'readonly', (s) => s.get(hash));
  return rec ? upgrade(rec) : null;
}

export async function putMeta(meta: GameMeta): Promise<void> {
  await op('games', 'readwrite', (s) => s.put(meta));
}

export async function getThumb(hash: string): Promise<Uint8Array | null> {
  const rec = await op<{ hash: string; bytes: Uint8Array } | undefined>(
    'thumbs', 'readonly', (s) => s.get(hash),
  );
  return rec?.bytes ?? null;
}

export async function putThumb(hash: string, bytes: Uint8Array): Promise<void> {
  await op('thumbs', 'readwrite', (s) => s.put({ hash, bytes }));
}

export async function getPak(hash: string): Promise<Uint8Array | null> {
  const rec = await op<{ hash: string; schema?: number; bytes: Uint8Array } | undefined>(
    'paks', 'readonly', (s) => s.get(hash),
  );
  return rec?.bytes ?? null;
}

export async function putPak(hash: string, bytes: Uint8Array): Promise<void> {
  await op('paks', 'readwrite', (s) => s.put({ hash, schema: SCHEMA_VERSION, bytes }));
}

export async function getState(hash: string): Promise<StateRec | null> {
  return (await op<StateRec | undefined>('states', 'readonly', (s) => s.get(hash))) ?? null;
}

export async function putState(rec: StateRec): Promise<void> {
  await op('states', 'readwrite', (s) => s.put(rec));
}

export async function deleteState(hash: string): Promise<void> {
  await op('states', 'readwrite', (s) => s.delete(hash));
}

export async function getMoney(hash: string): Promise<unknown> {
  return (await op<MoneyStoreRec | undefined>('money', 'readonly', (s) => s.get(hash)))?.record ?? null;
}

export async function putMoney(hash: string, record: unknown): Promise<void> {
  await op('money', 'readwrite', (s) => s.put({ hash, record } satisfies MoneyStoreRec));
}

export async function stateHashes(): Promise<Set<string>> {
  return new Set(await op<string[]>('states', 'readonly', (s) => s.getAllKeys() as IDBRequest<string[]>));
}

export async function deleteGame(hash: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['games', 'paks', 'states', 'thumbs', 'arcade', 'money'], 'readwrite');
    t.objectStore('games').delete(hash);
    t.objectStore('paks').delete(hash);
    t.objectStore('thumbs').delete(hash);
    t.objectStore('states').delete(hash);
    t.objectStore('arcade').delete(hash);
    t.objectStore('money').delete(hash);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('delete failed'));
    t.onabort = () => reject(t.error ?? new Error('delete aborted'));
  });
}

export interface ArcadeStoreRec { hash: string; [field: string]: unknown }

export async function getArcadeRec(hash: string): Promise<ArcadeStoreRec | null> {
  return (await op<ArcadeStoreRec | undefined>('arcade', 'readonly', (s) => s.get(hash))) ?? null;
}

export async function putArcadeRec(rec: ArcadeStoreRec): Promise<void> {
  await op('arcade', 'readwrite', (s) => s.put(rec));
}

export async function getSeenHashes(fp: string): Promise<string[] | null> {
  const rec = await op<{ fp: string; hash?: string; hashes?: string[] } | undefined>(
    'seen', 'readonly', (s) => s.get(fp),
  );
  return rec?.hashes ?? (rec?.hash ? [rec.hash] : null);
}

export async function putSeen(fp: string, hashes: string[]): Promise<void> {
  await op('seen', 'readwrite', (s) => s.put({ fp, hashes }));
}

function canonicalOrder<T extends { name: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashGameFiles(files: GameFile[]): Promise<string> {
  return sha256Hex(encodeSrcs(canonicalOrder(files.filter((f) => !isEffectSample(f.name)))));
}

export const CONTENT_RULE = 2;

export async function contentHashOf(files: GameFile[]): Promise<string> {
  const content = contentFiles(setFiles(files))
    .map((f) => ({ name: f.name.toLowerCase(), bytes: f.bytes }));
  return sha256Hex(encodeSrcs(canonicalOrder(content)));
}

export async function findByContentHash(contentHash: string): Promise<GameMeta[]> {
  return (await listGames()).filter((g) => g.contentHash === contentHash);
}
