import type { RoomLook } from './roomlook';
import type { Prop } from './proplist';
import { ARCADE_DOC_VERSION, ARCADE_MAX_MACHINES, keyMachines, placeAll, type ArcadeDoc, type DocMachine, type MachineState, type MachineStats } from './doc';
import { salvageMoney, type MoneyRecord } from './moneyrecord';

export const DB_NAME = 'fruitulator-arcade';
export const DB_VERSION = 1;
const ARCADES = 'arcades';
const SETTINGS = 'settings';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(ARCADES)) d.createObjectStore(ARCADES, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(SETTINGS)) d.createObjectStore(SETTINGS);
    };
    req.onsuccess = () => { void dropOld(req.result).then(() => resolve(req.result), reject); };
    req.onerror = () => { dbp = null; reject(req.error ?? new Error('the arcade store could not be opened')); };
  });
  return dbp;
}

function dropOld(d: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(ARCADES, 'readwrite');
    const cur = tx.objectStore(ARCADES).openCursor();
    let dropped = 0;
    let kept = 0;
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return;
      if ((c.value as Partial<ArcadeDoc>)?.version !== ARCADE_DOC_VERSION) {
        const money = salvageMoney(c.value, ARCADE_DOC_VERSION, Date.now());
        if (money) { c.update(money); kept++; } else { c.delete(); dropped++; }
      }
      c.continue();
    };
    tx.oncomplete = () => {
      if (dropped) console.info(`[arcade] dropped ${dropped} arcade(s) kept by an older build`);
      if (kept) console.info(`[arcade] kept the money of ${kept} arcade(s) kept by an older build; their machines need installing again`);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function op<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = f(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

export async function listArcades(): Promise<ArcadeDoc[]> {
  const all = await op<ArcadeDoc[]>(ARCADES, 'readonly', (s) => s.getAll() as IDBRequest<ArcadeDoc[]>);
  for (const d of all) placeAll(d);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getArcade(id: string): Promise<ArcadeDoc | null> {
  const doc = (await op<ArcadeDoc | undefined>(ARCADES, 'readonly', (s) => s.get(id) as IDBRequest<ArcadeDoc | undefined>)) ?? null;
  if (doc) placeAll(doc);
  return doc;
}

export async function putArcade(doc: ArcadeDoc, o: { replace?: boolean } = {}): Promise<void> {
  if (doc.machines.length > ARCADE_MAX_MACHINES) throw new Error(`an arcade holds at most ${ARCADE_MAX_MACHINES} machines`);
  doc.updatedAt = Date.now();
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(ARCADES, 'readwrite');
    const store = tx.objectStore(ARCADES);
    const get = store.get(doc.id);
    get.onsuccess = () => {
      const was = get.result as ArcadeDoc | undefined;
      if (was && !o.replace) {
        const stored = new Map(was.machines.map((m) => [m.id ?? m.contentHash, m]));
        for (const m of doc.machines) {
          const w = stored.get(m.id);
          const s = w?.state ?? null;
          if (s && (!m.state || s.savedAt > m.state.savedAt)) m.state = s;
          const st = w?.stats ?? null;
          if (st && (!m.stats || st.plays > m.stats.plays || (st.ledgerAt ?? 0) > (m.stats.ledgerAt ?? 0))) m.stats = st;
          const mr = w?.moneyRecord ?? null;
          if (mr && (!m.moneyRecord || mr.at > m.moneyRecord.at)) m.moneyRecord = mr;
        }
      }
      store.put(doc);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

export async function getMachineState(arcadeId: string, machine: string): Promise<MachineState | null> {
  const doc = await getArcade(arcadeId);
  return doc?.machines.find((m) => m.id === machine)?.state ?? null;
}

export async function putMachineState(arcadeId: string, machine: string, state: MachineState | null): Promise<boolean> {
  const d = await db();
  return new Promise<boolean>((resolve, reject) => {
    const tx = d.transaction(ARCADES, 'readwrite');
    const store = tx.objectStore(ARCADES);
    const get = store.get(arcadeId);
    let done = false;
    get.onsuccess = () => {
      const doc = get.result as ArcadeDoc | undefined;
      if (doc) keyMachines(doc);
      const m = doc?.machines.find((x) => x.id === machine);
      if (!doc || !m) return;
      m.state = state;
      store.put(doc);
      done = true;
    };
    tx.oncomplete = () => resolve(done);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

export async function updateMachineStats(
  arcadeId: string, machine: string, f: (s: MachineStats) => MachineStats,
): Promise<boolean> {
  const d = await db();
  return new Promise<boolean>((resolve, reject) => {
    const tx = d.transaction(ARCADES, 'readwrite');
    const store = tx.objectStore(ARCADES);
    const get = store.get(arcadeId);
    let done = false;
    get.onsuccess = () => {
      const doc = get.result as ArcadeDoc | undefined;
      if (doc) keyMachines(doc);
      const m = doc?.machines.find((x) => x.id === machine);
      if (!doc || !m) return;
      m.stats = f(m.stats ?? { plays: 0, lastPlayedAt: null, ledger: null });
      store.put(doc);
      done = true;
    };
    tx.oncomplete = () => resolve(done);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

export async function updateMachineMoney(
  arcadeId: string, machine: string, f: (m: DocMachine) => MoneyRecord,
): Promise<boolean> {
  const d = await db();
  return new Promise<boolean>((resolve, reject) => {
    const tx = d.transaction(ARCADES, 'readwrite');
    const store = tx.objectStore(ARCADES);
    const get = store.get(arcadeId);
    let done = false;
    get.onsuccess = () => {
      const doc = get.result as ArcadeDoc | undefined;
      if (doc) keyMachines(doc);
      const m = doc?.machines.find((x) => x.id === machine);
      if (!doc || !m) return;
      m.moneyRecord = f(m);
      store.put(doc);
      done = true;
    };
    tx.oncomplete = () => resolve(done);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

export async function updateArcadeRoom(arcadeId: string, look: RoomLook): Promise<ArcadeDoc | null> {
  const d = await db();
  return new Promise<ArcadeDoc | null>((resolve, reject) => {
    const tx = d.transaction(ARCADES, 'readwrite');
    const store = tx.objectStore(ARCADES);
    const get = store.get(arcadeId);
    let out: ArcadeDoc | null = null;
    get.onsuccess = () => {
      const doc = get.result as ArcadeDoc | undefined;
      if (!doc) return;
      doc.room = { ...look, neon: [...look.neon] as RoomLook['neon'] };
      doc.updatedAt = Date.now();
      store.put(doc);
      out = doc;
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

export async function updateArcadeProps(arcadeId: string, props: Prop[]): Promise<ArcadeDoc | null> {
  const d = await db();
  return new Promise<ArcadeDoc | null>((resolve, reject) => {
    const tx = d.transaction(ARCADES, 'readwrite');
    const store = tx.objectStore(ARCADES);
    const get = store.get(arcadeId);
    let out: ArcadeDoc | null = null;
    get.onsuccess = () => {
      const doc = get.result as ArcadeDoc | undefined;
      if (!doc) return;
      doc.props = props.map((p) => ({ ...p }));
      doc.updatedAt = Date.now();
      store.put(doc);
      out = doc;
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

export async function deleteArcade(id: string): Promise<void> {
  await op(ARCADES, 'readwrite', (s) => s.delete(id));
  if ((await getSetting<string>('current')) === id) await setSetting('current', null);
}

async function getSetting<T>(key: string): Promise<T | null> {
  return ((await op<unknown>(SETTINGS, 'readonly', (s) => s.get(key))) as T | undefined) ?? null;
}

async function setSetting(key: string, v: unknown): Promise<void> {
  await op(SETTINGS, 'readwrite', (s) => s.put(v, key));
}

export async function currentArcade(): Promise<ArcadeDoc | null> {
  const want = new URLSearchParams(location.search).get('arcade');
  if (want) return getArcade(want);
  const id = await getSetting<string>('current');
  const doc = id ? await getArcade(id) : null;
  return doc ?? (await listArcades())[0] ?? null;
}

export async function setCurrentArcade(id: string): Promise<void> {
  await setSetting('current', id);
}
