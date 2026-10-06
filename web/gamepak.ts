import { deflateSync, inflateSync } from 'fflate';
import type { GameFile, LayoutProps } from '../src/machine/registry';

export const CONTAINER_VERSION = 1;

export const DECODE_VERSION = 157;

export type ChunkType = 'META' | 'SRCS' | 'CABJ' | 'IMGS' | 'THMB' | 'STAT' | 'SPAR';

export class PakError extends Error {}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const align4 = (n: number): number => (n + 3) & ~3;

export interface PakChunkIn {
  type: ChunkType;
  bytes: Uint8Array;
  deflate?: boolean;
}

interface Stored {
  type: string;
  flags: number;
  data: Uint8Array;
  rawLen: number;
  crc: number;
}

function storeChunk(c: PakChunkIn): Stored {
  return {
    type: c.type,
    flags: c.deflate ? 1 : 0,
    data: c.deflate ? deflateSync(c.bytes) : c.bytes,
    rawLen: c.bytes.length,
    crc: crc32(c.bytes),
  };
}

function assemble(stored: Stored[], decodeVersion: number): Uint8Array {
  const table = new Uint8Array(24 * stored.length);
  const tv = new DataView(table.buffer);
  let off = align4(16 + table.length);
  const offsets: number[] = [];
  stored.forEach((s, i) => {
    offsets.push(off);
    const o = i * 24;
    for (let j = 0; j < 4; j++) table[o + j] = s.type.charCodeAt(j);
    tv.setUint32(o + 4, s.flags, true);
    tv.setUint32(o + 8, off, true);
    tv.setUint32(o + 12, s.data.length, true);
    tv.setUint32(o + 16, s.rawLen, true);
    tv.setUint32(o + 20, s.crc, true);
    off = align4(off + s.data.length);
  });

  const out = new Uint8Array(off);
  out.set([0x4d, 0x41, 0x48, 0x47]);
  const hv = new DataView(out.buffer);
  hv.setUint16(4, CONTAINER_VERSION, true);
  hv.setUint16(6, decodeVersion, true);
  hv.setUint32(8, stored.length, true);
  hv.setUint32(12, crc32(table), true);
  out.set(table, 16);
  stored.forEach((s, i) => out.set(s.data, offsets[i]));
  return out;
}

export function encodePak(chunks: PakChunkIn[], decodeVersion = DECODE_VERSION): Uint8Array {
  return assemble(chunks.map(storeChunk), decodeVersion);
}

export function isPakBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 16
    && bytes[0] === 0x4d && bytes[1] === 0x41 && bytes[2] === 0x48 && bytes[3] === 0x47;
}

interface Entry {
  flags: number;
  offset: number;
  storedLen: number;
  rawLen: number;
  crc: number;
}

export interface Pak {
  containerVersion: number;
  decodeVersion: number;
  has(t: ChunkType): boolean;
  chunk(t: ChunkType): Uint8Array;
}

export function decodePak(bytes: Uint8Array): Pak {
  if (
    bytes.length < 16 ||
    bytes[0] !== 0x4d || bytes[1] !== 0x41 || bytes[2] !== 0x48 || bytes[3] !== 0x47
  ) {
    throw new PakError('not a GamePak');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const containerVersion = dv.getUint16(4, true);
  if (containerVersion > CONTAINER_VERSION) {
    throw new PakError(`GamePak v${containerVersion} is newer than this build`);
  }
  const decodeVersion = dv.getUint16(6, true);
  const count = dv.getUint32(8, true);
  if (16 + count * 24 > bytes.length) throw new PakError('truncated GamePak');
  const table = bytes.subarray(16, 16 + count * 24);
  if (crc32(table) !== dv.getUint32(12, true)) throw new PakError('GamePak chunk table corrupt');

  const entries = new Map<string, Entry>();
  const et = new DataView(table.buffer, table.byteOffset, table.byteLength);
  for (let i = 0; i < count; i++) {
    const o = i * 24;
    const type = String.fromCharCode(table[o], table[o + 1], table[o + 2], table[o + 3]);
    entries.set(type, {
      flags: et.getUint32(o + 4, true),
      offset: et.getUint32(o + 8, true),
      storedLen: et.getUint32(o + 12, true),
      rawLen: et.getUint32(o + 16, true),
      crc: et.getUint32(o + 20, true),
    });
  }

  return {
    containerVersion,
    decodeVersion,
    has: (t) => entries.has(t),
    chunk(t) {
      const e = entries.get(t);
      if (!e) throw new PakError(`GamePak has no ${t} chunk`);
      if (e.offset + e.storedLen > bytes.length) throw new PakError(`${t} chunk out of bounds`);
      const data = bytes.subarray(e.offset, e.offset + e.storedLen);
      let raw: Uint8Array;
      if (e.flags & 1) {
        try {
          raw = inflateSync(data);
        } catch {
          throw new PakError(`${t} chunk failed to inflate`);
        }
      } else {
        raw = data;
      }
      if (raw.length !== e.rawLen) throw new PakError(`${t} chunk length mismatch`);
      if (crc32(raw) !== e.crc) throw new PakError(`${t} chunk CRC mismatch`);
      return raw;
    },
  };
}

export function repackPak(
  bytes: Uint8Array,
  edits: Partial<Record<ChunkType, PakChunkIn | null>>,
): Uint8Array {
  if (!isPakBytes(bytes)) throw new PakError('not a GamePak');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const containerVersion = dv.getUint16(4, true);
  if (containerVersion > CONTAINER_VERSION) {
    throw new PakError(`GamePak v${containerVersion} is newer than this build`);
  }
  const decodeVersion = dv.getUint16(6, true);
  const count = dv.getUint32(8, true);
  if (16 + count * 24 > bytes.length) throw new PakError('truncated GamePak');
  const table = bytes.subarray(16, 16 + count * 24);
  if (crc32(table) !== dv.getUint32(12, true)) throw new PakError('GamePak chunk table corrupt');
  const et = new DataView(table.buffer, table.byteOffset, table.byteLength);

  const out: Stored[] = [];
  const seen = new Set<string>();
  const pending = new Map<string, PakChunkIn | null>(Object.entries(edits));
  for (let i = 0; i < count; i++) {
    const o = i * 24;
    const type = String.fromCharCode(table[o], table[o + 1], table[o + 2], table[o + 3]);
    if (seen.has(type)) throw new PakError(`GamePak repeats its ${type} chunk`);
    seen.add(type);
    if (pending.has(type)) {
      const c = pending.get(type);
      pending.delete(type);
      if (c) out.push(storeChunk(c));
      continue;
    }
    const offset = et.getUint32(o + 8, true);
    const storedLen = et.getUint32(o + 12, true);
    if (offset + storedLen > bytes.length) throw new PakError(`${type} chunk out of bounds`);
    out.push({
      type,
      flags: et.getUint32(o + 4, true),
      data: bytes.subarray(offset, offset + storedLen),
      rawLen: et.getUint32(o + 16, true),
      crc: et.getUint32(o + 20, true),
    });
  }
  for (const c of pending.values()) if (c) out.push(storeChunk(c));
  return assemble(out, decodeVersion);
}

export interface PakRecord {
  hash: string;
  schema: number;
  exportedAt: number;
  addedAt: number;
  variant: string;
  autoSave: boolean;
  title?: string;
  coinAnswers?: Record<string, number | 'token'>;
  sourceName?: string;
  playCount?: number;
  playedAt?: number;
  thumbFromPlay?: boolean;
  layoutProps?: LayoutProps;
  contentHash?: string;
  contentRule?: number;
}

export interface PakMeta {
  name: string;
  system: string;
  created: number;
  decodeStatus: 'ok' | 'partial' | 'fallback';
  decode?: { clean: number; total: number };
  files: { name: string; size: number }[];
  variant?: string;
  layout?: string;
  contentHash?: string;
  record?: PakRecord;
}

export function encodeMeta(meta: PakMeta): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(meta));
}

export function readMeta(pak: Pak): PakMeta | null {
  if (!pak.has('META')) return null;
  try {
    return JSON.parse(new TextDecoder().decode(pak.chunk('META'))) as PakMeta;
  } catch {
    return null;
  }
}

export interface StatRec {
  schema: number;
  savedAt: number;
  cycles: number;
  data: Uint8Array;
}

export function encodeStat(rec: StatRec): Uint8Array {
  const head = new TextEncoder().encode(
    JSON.stringify({ schema: rec.schema, savedAt: rec.savedAt, cycles: rec.cycles }),
  );
  const out = new Uint8Array(4 + head.length + rec.data.length);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  out.set(rec.data, 4 + head.length);
  return out;
}

export function decodeStat(bytes: Uint8Array): StatRec {
  if (bytes.length < 4) throw new PakError('STAT chunk truncated');
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (4 + n > bytes.length) throw new PakError('STAT chunk truncated');
  let head: { schema?: unknown; savedAt?: unknown; cycles?: unknown };
  try {
    head = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + n))) as typeof head;
  } catch {
    throw new PakError('STAT header unreadable');
  }
  if (typeof head.schema !== 'number' || typeof head.savedAt !== 'number'
    || typeof head.cycles !== 'number') {
    throw new PakError('STAT header incomplete');
  }
  return { schema: head.schema, savedAt: head.savedAt, cycles: head.cycles, data: bytes.slice(4 + n) };
}

export function encodeSrcs(files: GameFile[]): Uint8Array {
  const enc = new TextEncoder();
  const names = files.map((f) => enc.encode(f.name));
  let len = 4;
  for (let i = 0; i < files.length; i++) len += 8 + names[i].length + files[i].bytes.length;
  const out = new Uint8Array(len);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, files.length, true);
  let o = 4;
  for (let i = 0; i < files.length; i++) {
    dv.setUint32(o, names[i].length, true);
    out.set(names[i], o + 4);
    o += 4 + names[i].length;
    dv.setUint32(o, files[i].bytes.length, true);
    out.set(files[i].bytes, o + 4);
    o += 4 + files[i].bytes.length;
  }
  return out;
}

export function decodeSrcs(bytes: Uint8Array): GameFile[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const count = dv.getUint32(0, true);
  const files: GameFile[] = [];
  let o = 4;
  for (let i = 0; i < count; i++) {
    const nameLen = dv.getUint32(o, true);
    const name = dec.decode(bytes.subarray(o + 4, o + 4 + nameLen));
    o += 4 + nameLen;
    const dataLen = dv.getUint32(o, true);
    files.push({ name, bytes: bytes.slice(o + 4, o + 4 + dataLen) });
    o += 4 + dataLen;
  }
  return files;
}

export function encodeImgs(assets: { id: number; bytes: Uint8Array }[]): Uint8Array {
  let len = 4;
  for (const a of assets) len += 8 + a.bytes.length;
  const out = new Uint8Array(len);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, assets.length, true);
  let o = 4;
  for (const a of assets) {
    dv.setUint32(o, a.id, true);
    dv.setUint32(o + 4, a.bytes.length, true);
    out.set(a.bytes, o + 8);
    o += 8 + a.bytes.length;
  }
  return out;
}

export function decodeImgs(bytes: Uint8Array): Map<number, Uint8Array> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(0, true);
  const out = new Map<number, Uint8Array>();
  let o = 4;
  for (let i = 0; i < count; i++) {
    const id = dv.getUint32(o, true);
    const len = dv.getUint32(o + 4, true);
    out.set(id, bytes.slice(o + 8, o + 8 + len));
    o += 8 + len;
  }
  return out;
}

export function currentLayoutProps(
  meta: { decodeVersion?: number; layoutProps?: LayoutProps } | undefined,
  current: number = DECODE_VERSION,
): LayoutProps | undefined {
  return meta && meta.decodeVersion === current ? meta.layoutProps : undefined;
}

export function loadPlan(opts: {
  decodeVersion: number;
  current: number;
  hasCab: boolean;
  cabReadable: boolean;
  srcsReadable: boolean;
  cabVariant: string | null;
  variant: string;
  variantCount: number;
  cabLayout: string | null;
  layout: string | null;
}): 'fast' | 'redecode' | 'corrupt' {
  if (!opts.srcsReadable) return 'corrupt';
  let cabMatches: boolean;
  if (opts.cabLayout !== null && opts.layout !== null) cabMatches = opts.cabLayout === opts.layout;
  else if (opts.cabVariant !== null) cabMatches = opts.cabVariant === opts.variant;
  else cabMatches = opts.variantCount <= 1;
  if (opts.decodeVersion === opts.current && opts.hasCab && opts.cabReadable && cabMatches) {
    return 'fast';
  }
  return 'redecode';
}
