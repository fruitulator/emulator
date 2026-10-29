
const DB = 'fruitulator-source-answers';
const STORE = 'answers';

interface Kept { url: string; origin: string; at: number; json: unknown }

let opened: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (opened) return opened;
  opened = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: 'url' });
        s.createIndex('origin', 'origin');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opened;
}

function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then((d) => new Promise<T | undefined>((resolve) => {
    if (!d) { resolve(undefined); return; }
    try {
      const tx = d.transaction(STORE, mode);
      const req = f(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  }));
}

export async function keptAnswer(url: string, ttl: number): Promise<{ at: number; json: unknown } | undefined> {
  const k = await run<Kept | undefined>('readonly', (s) => s.get(url) as IDBRequest<Kept | undefined>);
  return k && Date.now() - k.at < ttl ? { at: k.at, json: k.json } : undefined;
}

export function keepAnswer(url: string, at: number, json: unknown): void {
  let origin = '';
  try { origin = new URL(url).origin; } catch { return; }
  void run('readwrite', (s) => { s.put({ url, origin, at, json } satisfies Kept); });
}

export function dropAnswers(origins?: string[], olderThan?: number): Promise<unknown> {
  return run('readwrite', (s) => {
    const req = s.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      const k = c.value as Kept;
      if (!origins || origins.includes(k.origin) || (olderThan !== undefined && Date.now() - k.at >= olderThan)) c.delete();
      c.continue();
    };
  });
}
