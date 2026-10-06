
export interface CardRecord {
  at: number;
  id: number;
  key: number;
  type: number;
  length: number;
  valueAt: number;
}

export const CARD_BASE = 0x20000;
export const CARD_MAGIC_AT = 0x140;
export const IDENTITY_ID = 0x1902;
export const IDENTITY_KEY = 0x437c9120;

type Rom = { length: number; [i: number]: number };

const r16 = (rom: Rom, a: number): number => ((rom[a] << 8) | rom[a + 1]) & 0xffff;
const r32 = (rom: Rom, a: number): number =>
  (((rom[a] << 24) | (rom[a + 1] << 16) | (rom[a + 2] << 8) | rom[a + 3]) >>> 0);

export function cardRecords(rom: Rom, base = CARD_BASE): CardRecord[] | null {
  if (base + 12 > rom.length || CARD_MAGIC_AT + 4 > rom.length) return null;
  const magic = r32(rom, CARD_MAGIC_AT);
  if (magic === 0 || magic === 0xffffffff || r32(rom, base) !== magic) return null;
  const out: CardRecord[] = [];
  let a = base;
  while (out.length < 10_000) {
    if (a < 0 || a + 12 > rom.length) return null;
    const id = r16(rom, a);
    if (id === 0) break;
    const type = rom[a + 7];
    const length = r32(rom, a + 8) | 0;
    if (length >= 0 && length < 12) return null;
    const valueAt = (type & 0x80) ? (a + (r32(rom, a + 0xc) | 0)) : a + 0xc;
    out.push({ at: a, id, key: r32(rom, a + 2), type, length, valueAt });
    a += length;
  }
  return out;
}

export function cardIdentity(rom: Rom, base = CARD_BASE): string | null {
  const records = cardRecords(rom, base);
  if (!records) return null;
  const rec = records.find((r) => r.id === IDENTITY_ID && r.key === IDENTITY_KEY);
  if (!rec || rec.valueAt < 0 || rec.valueAt + 4 > rom.length) return null;
  let s = '';
  for (let i = 0; i < 4; i++) {
    const c = rom[rec.valueAt + i];
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
  }
  return s;
}
