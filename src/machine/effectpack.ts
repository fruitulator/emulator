
const MAGIC = [0x46, 0x58, 0x50, 0x4b];

export interface PackedFile {
  path: string;
  bytes: Uint8Array;
}

export function buildEffectPack(files: readonly PackedFile[]): Uint8Array {
  const entries: [string, number, number][] = [];
  let offset = 0;
  for (const f of files) {
    entries.push([f.path, offset, f.bytes.length]);
    offset += f.bytes.length;
  }
  const header = new TextEncoder().encode(JSON.stringify(entries));
  const out = new Uint8Array(8 + header.length + offset);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  let at = 8 + header.length;
  for (const f of files) {
    out.set(f.bytes, at);
    at += f.bytes.length;
  }
  return out;
}

export function parseEffectPack(pack: Uint8Array): Map<string, PackedFile> | null {
  if (pack.length < 8 || MAGIC.some((b, i) => pack[i] !== b)) return null;
  const headerLength = new DataView(pack.buffer, pack.byteOffset, pack.byteLength).getUint32(4, true);
  if (8 + headerLength > pack.length) return null;
  let entries: unknown;
  try {
    entries = JSON.parse(new TextDecoder().decode(pack.subarray(8, 8 + headerLength)));
  } catch {
    return null;
  }
  if (!Array.isArray(entries)) return null;
  const data = 8 + headerLength;
  const out = new Map<string, PackedFile>();
  for (const e of entries) {
    if (!Array.isArray(e) || typeof e[0] !== 'string' || typeof e[1] !== 'number' || typeof e[2] !== 'number') {
      return null;
    }
    const [path, offset, length] = e as [string, number, number];
    if (data + offset + length > pack.length) return null;
    out.set(path.toLowerCase(), { path, bytes: pack.subarray(data + offset, data + offset + length) });
  }
  return out;
}
