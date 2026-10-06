import { crc32 } from './gamepak';
import type { ZipEntry } from './zipdir';

export const COLLECTION_MANIFEST = 'punnet.json';
export const COLLECTION_VERSION = 1;

export interface CollectionManifest {
  kind: 'punnet-collection';
  version: number;
  exportedAt: number;
  games: { file: string; title: string; hash: string; system: string }[];
}

export function collectionEntries(listing: ZipEntry[]): ZipEntry[] | null {
  const games = listing.filter((e) => /\.punnet$/i.test(e.name));
  if (!games.length) return null;
  const rest = listing.filter((e) => !games.includes(e) && e.name !== COLLECTION_MANIFEST);
  return rest.length ? null : games;
}

export interface PackSink {
  write(chunk: Uint8Array): Promise<void>;
}

const LOC_SIG = 0x04034b50;
const CEN_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const LOC64_SIG = 0x07064b50;
const U32 = 0xffffffff;
const UTF8 = 0x800;

interface Written { name: Uint8Array; crc: number; size: number; offset: number }

function dosTime(ms: number): { time: number; date: number } {
  const d = new Date(ms);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function setU64(dv: DataView, at: number, v: number): void {
  dv.setUint32(at, v >>> 0, true);
  dv.setUint32(at + 4, Math.floor(v / 0x1_0000_0000), true);
}

export class PunnetPackWriter {
  private offset = 0;
  private readonly done: Written[] = [];
  private readonly names = new Set<string>();
  private readonly stamp: { time: number; date: number };

  constructor(
    private readonly sink: PackSink,
    private readonly forceZip64 = false,
    now = Date.now(),
  ) {
    this.stamp = dosTime(now);
  }

  get size(): number { return this.offset; }

  uniqueName(base: string, ext = '.punnet'): string {
    let name = `${base}${ext}`;
    for (let n = 2; this.names.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`;
    this.names.add(name.toLowerCase());
    return name;
  }

  async add(name: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length >= U32) throw new Error(`${name} is too large for one entry`);
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(bytes) >>> 0;
    const head = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(head.buffer);
    dv.setUint32(0, LOC_SIG, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, UTF8, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, this.stamp.time, true);
    dv.setUint16(12, this.stamp.date, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, bytes.length, true);
    dv.setUint32(22, bytes.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    head.set(nameBytes, 30);
    const offset = this.offset;
    await this.sink.write(head);
    await this.sink.write(bytes);
    this.offset += head.length + bytes.length;
    this.done.push({ name: nameBytes, crc, size: bytes.length, offset });
  }

  async finish(manifest: CollectionManifest): Promise<void> {
    this.names.add(COLLECTION_MANIFEST);
    await this.add(COLLECTION_MANIFEST, new TextEncoder().encode(JSON.stringify(manifest, null, 1)));

    const cdStart = this.offset;
    const parts: Uint8Array[] = [];
    for (const e of this.done) {
      const big = this.forceZip64 || e.offset >= U32;
      const extra = big ? 12 : 0;
      const rec = new Uint8Array(46 + e.name.length + extra);
      const dv = new DataView(rec.buffer);
      dv.setUint32(0, CEN_SIG, true);
      dv.setUint16(4, big ? 45 : 20, true);
      dv.setUint16(6, big ? 45 : 20, true);
      dv.setUint16(8, UTF8, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, this.stamp.time, true);
      dv.setUint16(14, this.stamp.date, true);
      dv.setUint32(16, e.crc, true);
      dv.setUint32(20, e.size, true);
      dv.setUint32(24, e.size, true);
      dv.setUint16(28, e.name.length, true);
      dv.setUint16(30, extra, true);
      dv.setUint32(42, big ? U32 : e.offset, true);
      rec.set(e.name, 46);
      if (big) {
        const x = 46 + e.name.length;
        dv.setUint16(x, 0x0001, true);
        dv.setUint16(x + 2, 8, true);
        setU64(dv, x + 4, e.offset);
      }
      parts.push(rec);
    }
    const cdSize = parts.reduce((n, p) => n + p.length, 0);
    const count = this.done.length;
    const zip64 = this.forceZip64 || cdStart >= U32 || cdSize >= U32 || count >= 0xffff;
    if (zip64) {
      const recAt = cdStart + cdSize;
      const rec = new Uint8Array(56 + 20);
      const dv = new DataView(rec.buffer);
      dv.setUint32(0, EOCD64_SIG, true);
      setU64(dv, 4, 56 - 12);
      dv.setUint16(12, 45, true);
      dv.setUint16(14, 45, true);
      setU64(dv, 24, count);
      setU64(dv, 32, count);
      setU64(dv, 40, cdSize);
      setU64(dv, 48, cdStart);
      dv.setUint32(56, LOC64_SIG, true);
      setU64(dv, 56 + 8, recAt);
      dv.setUint32(56 + 16, 1, true);
      parts.push(rec);
    }
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, EOCD_SIG, true);
    ev.setUint16(8, zip64 ? 0xffff : count, true);
    ev.setUint16(10, zip64 ? 0xffff : count, true);
    ev.setUint32(12, zip64 ? U32 : cdSize, true);
    ev.setUint32(16, zip64 ? U32 : cdStart, true);
    parts.push(end);
    for (const p of parts) await this.sink.write(p);
    this.offset += parts.reduce((n, p) => n + p.length, 0);
  }
}
