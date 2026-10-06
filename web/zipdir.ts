import { inflateSync, strFromU8 } from 'fflate';
import { crc32 } from './gamepak';

export interface ZipEntry {
  name: string;
  size: number;
  crc32: number;
  compressedSize: number;
  method: number;
  flags: number;
  offset: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const EOCD64_SIG = 0x06064b50;
const LOC64_SIG = 0x07064b50;
const LOC64_LEN = 20;
const ZIP64_EXTRA = 0x0001;

function u64(dv: DataView, at: number): number {
  const v = dv.getUint32(at, true) + dv.getUint32(at + 4, true) * 0x1_0000_0000;
  if (!Number.isSafeInteger(v)) throw new Error('zip offset out of range');
  return v;
}
const EOCD_MIN = 22;
const EOCD_MAX = EOCD_MIN + 0xffff;

async function bytesOf(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

export function looksLikeZip(head: Uint8Array): boolean {
  return head.length >= 4 && new DataView(head.buffer, head.byteOffset, 4).getUint32(0, true) === LOC_SIG;
}

export async function readZipDirectory(blob: Blob): Promise<ZipEntry[]> {
  const size = blob.size;
  if (size < EOCD_MIN) throw new Error('not a zip archive (too short)');
  const tailStart = Math.max(0, size - EOCD_MAX);
  const tail = await bytesOf(blob, tailStart, size);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (tv.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');

  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - LOC64_LEN;
    if (loc < 0 || tv.getUint32(loc, true) !== LOC64_SIG) {
      throw new Error('zip says ZIP64 but has no ZIP64 locator');
    }
    const recAt = u64(tv, loc + 8);
    const rec = await bytesOf(blob, recAt, recAt + 56);
    const rv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
    if (rec.length < 56 || rv.getUint32(0, true) !== EOCD64_SIG) {
      throw new Error('zip ZIP64 end-of-central-directory record is corrupt');
    }
    count = u64(rv, 32);
    cdSize = u64(rv, 40);
    cdOffset = u64(rv, 48);
  }
  if (cdOffset + cdSize > size) throw new Error('zip central directory lies outside the file');

  let cd: Uint8Array;
  if (cdOffset >= tailStart) cd = tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize);
  else cd = await bytesOf(blob, cdOffset, cdOffset + cdSize);
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);

  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || dv.getUint32(p, true) !== CEN_SIG) {
      throw new Error('zip central directory is corrupt');
    }
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    let compressedSize = dv.getUint32(p + 20, true);
    let uncompressed = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let offset = dv.getUint32(p + 42, true);
    const name = strFromU8(cd.subarray(p + 46, p + 46 + nameLen), !(flags & 0x800));
    const extraAt = p + 46 + nameLen;
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (compressedSize === 0xffffffff || uncompressed === 0xffffffff || offset === 0xffffffff) {
      let x = extraAt;
      let found = false;
      while (x + 4 <= extraAt + extraLen) {
        const tag = dv.getUint16(x, true);
        const len = dv.getUint16(x + 2, true);
        if (tag === ZIP64_EXTRA) {
          let q = x + 4;
          if (uncompressed === 0xffffffff) { uncompressed = u64(dv, q); q += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = u64(dv, q); q += 8; }
          if (offset === 0xffffffff) { offset = u64(dv, q); q += 8; }
          if (q > x + 4 + len) throw new Error(`${name}: zip ZIP64 extra field is too short`);
          found = true;
          break;
        }
        x += 4 + len;
      }
      if (!found) throw new Error(`${name}: zip entry says ZIP64 but carries no ZIP64 field`);
    }
    entries.push({ name, size: uncompressed, crc32: crc, compressedSize, method, flags, offset });
  }
  return entries;
}

export async function readZipEntry(blob: Blob, e: ZipEntry): Promise<Uint8Array> {
  if (e.flags & 1) throw new Error(`${e.name}: encrypted zip entries are not supported`);
  if (e.method !== 0 && e.method !== 8) {
    throw new Error(`${e.name}: zip compression method ${e.method} is not supported`);
  }
  const head = await bytesOf(blob, e.offset, e.offset + 30);
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (head.length < 30 || hv.getUint32(0, true) !== LOC_SIG) {
    throw new Error(`${e.name}: zip local header is corrupt`);
  }
  const start = e.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const data = await bytesOf(blob, start, start + e.compressedSize);
  if (data.length !== e.compressedSize) throw new Error(`${e.name}: zip entry is truncated`);
  const out = e.method === 0 ? data : inflateSync(data, { out: new Uint8Array(e.size) });
  if (out.length !== e.size) throw new Error(`${e.name}: zip entry inflated to the wrong size`);
  if ((crc32(out) >>> 0) !== e.crc32) throw new Error(`${e.name}: zip entry fails its CRC-32 check`);
  return out;
}
