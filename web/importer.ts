import type { GameFile } from '../src/machine/registry';
import { assembleCabinet } from './cabjson';
import type { Cabinet } from './dat';
import type {
  ImportErrorCode, ImportRequest, ImportResponse, ImportStage, VariantId,
} from './import-protocol';
import type { GameMeta } from './store';

export class ImportError extends Error {
  constructor(
    message: string,
    readonly phase: string,
    readonly code?: ImportErrorCode,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ImportEvents {
  onProgress?(stage: ImportStage): void;
  onFiles?(files: GameFile[], storedMeta?: GameMeta, variant?: VariantId): void;
  onCabinet?(cab: Cabinet | null): void;
}

interface Pending {
  events: ImportEvents;
  resolve(meta: GameMeta): void;
  reject(err: ImportError): void;
  quiet: boolean;
  lane: Lane;
}

interface Lane {
  worker: Worker | null;
  inflight: number;
}

export function importConcurrency(): number {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = /Android|iPhone|iPad|iPod/i.test(nav.userAgent)
    || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
  if (mobile) return 1;
  let width = Math.max(1, Math.floor((nav.hardwareConcurrency || 2) / 2));
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0) {
    width = Math.min(width, Math.max(1, Math.floor(nav.deviceMemory / 2)));
  }
  return Math.min(4, width);
}

const lanes: Lane[] = [];
let nextId = 1;
const pending = new Map<number, Pending>();

const writeListeners = new Set<() => void>();

export function onLibraryWrite(fn: () => void): () => void {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}

export function libraryWriteInFlight(): boolean {
  for (const p of pending.values()) if (!p.quiet) return true;
  return false;
}

function announceWrite(): void {
  for (const fn of [...writeListeners]) fn();
}

function settle(p: Pending, id: number): void {
  pending.delete(id);
  p.lane.inflight = Math.max(0, p.lane.inflight - 1);
  if (!p.quiet) announceWrite();
}

function dispatch(msg: ImportResponse): void {
  const p = pending.get(msg.id);
  if (!p) return;
  switch (msg.kind) {
    case 'progress':
      p.events.onProgress?.(msg.stage);
      break;
    case 'files':
      p.events.onFiles?.(msg.files, msg.storedMeta, msg.variant);
      break;
    case 'cabinet':
      try {
        p.events.onCabinet?.(
          msg.geo ? assembleCabinet(msg.geo, new Map(msg.bitmaps)) : null,
        );
      } catch (e) {
        console.warn('[importer] cabinet assembly failed', e);
        p.events.onCabinet?.(null);
      }
      break;
    case 'cached':
    case 'done':
    case 'stamped':
      settle(p, msg.id);
      p.resolve(msg.meta);
      break;
    case 'error':
      settle(p, msg.id);
      p.reject(new ImportError(msg.message, msg.phase, msg.code));
      break;
  }
}

function spawn(lane: Lane): Worker {
  const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<ImportResponse>) => dispatch(ev.data);
  worker.onerror = (ev) => {
    const msg = ev.message || 'import worker failed';
    for (const [id, p] of [...pending]) {
      if (p.lane !== lane) continue;
      pending.delete(id);
      p.reject(new ImportError(msg, 'worker'));
    }
    lane.worker?.terminate();
    lane.worker = null;
    lane.inflight = 0;
    announceWrite();
  };
  lane.worker = worker;
  return worker;
}

function laneFor(): Lane {
  let best: Lane | null = null;
  for (const lane of lanes) {
    if (lane.inflight === 0) return lane;
    if (!best || lane.inflight < best.inflight) best = lane;
  }
  if (lanes.length < importConcurrency()) {
    const lane: Lane = { worker: null, inflight: 0 };
    lanes.push(lane);
    return lane;
  }
  return best!;
}

function request(
  req: ImportRequest, events: ImportEvents, transfer: Transferable[], quiet = false,
): Promise<GameMeta> {
  return new Promise<GameMeta>((resolve, reject) => {
    const lane = laneFor();
    lane.inflight++;
    pending.set(req.id, { events, resolve, reject, quiet, lane });
    (lane.worker ?? spawn(lane)).postMessage(req, transfer);
  });
}

export type UploadSource =
  | { zip: Uint8Array }
  | { files: GameFile[]; spares?: GameFile[]; hash?: string };

export function importUpload(
  src: UploadSource, fallbackName: string | undefined, events: ImportEvents,
  background = false,
  deferArtwork = false,
): Promise<GameMeta> {
  const id = nextId++;
  const transfer = new Set<ArrayBuffer>();
  const req: ImportRequest = { id, op: 'importUpload', fallbackName, background, ...(deferArtwork ? { deferArtwork } : {}) };
  if ('zip' in src) {
    req.zip = src.zip;
    if (src.zip.buffer instanceof ArrayBuffer) transfer.add(src.zip.buffer);
  } else {
    req.files = src.files;
    if (src.spares?.length) req.spares = src.spares;
    if (src.hash) req.hash = src.hash;
    for (const f of [...src.files, ...(src.spares ?? [])]) {
      if (f.bytes.buffer instanceof ArrayBuffer) transfer.add(f.bytes.buffer);
    }
  }
  return request(req, events, [...transfer]);
}

export function openPak(
  hash: string, events: ImportEvents, variant?: VariantId, play?: boolean,
): Promise<GameMeta> {
  return request({ id: nextId++, op: 'openPak', hash, variant, play }, events, []);
}

export function importPunnet(
  bytes: Uint8Array, fallbackName: string | undefined, events: ImportEvents,
): Promise<GameMeta> {
  const transfer = bytes.buffer instanceof ArrayBuffer ? [bytes.buffer] : [];
  return request({ id: nextId++, op: 'importPunnet', bytes, fallbackName }, events, transfer);
}

export function backfillContentHash(hash: string): Promise<GameMeta> {
  return request({ id: nextId++, op: 'contentHash', hash }, {}, [], true);
}

export function refreshThumb(hash: string): Promise<GameMeta> {
  return request({ id: nextId++, op: 'refreshThumb', hash }, {}, [], true);
}

export function decodeArtwork(hash: string): Promise<GameMeta> {
  return request({ id: nextId++, op: 'decodeArtwork', hash }, {}, [], true);
}
