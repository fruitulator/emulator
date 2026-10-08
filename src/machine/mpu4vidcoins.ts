import type { CoinLine, CoinLineTable, Refusal } from './coinwiring';

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

const RECORD = 15;
const VALUE = 9;

const s8 = (b: number): number => (b << 24) >> 24;
const s16 = (w: number): number => (w << 16) >> 16;

function pollAt(rom: Uint8Array, i0: number): { y: number; x: number; next: number } | null {
  if (rom[i0] !== 0xf6 || rom[i0 + 1] !== 0x0c || rom[i0 + 2] !== 0x02 || rom[i0 + 3] !== 0x54) return null;
  let i = i0 - 6;
  if (rom[i0 + 4] === 0xd8) {
    if (rom[i0 + 6] !== 0xc4 || rom[i0 + 7] !== 0x7f || rom[i0 + 8] !== 0xd8 || rom[i0 + 9] !== rom[i0 + 5]) return null;
    i = i0;
  }
  if (rom[i + 10] !== 0x31 || rom[i + 11] !== 0x8d) return null;
  const y = i + 14 + s16((rom[i + 12]! << 8) | rom[i + 13]!);
  let x: number;
  let next: number;
  if (rom[i + 14] === 0x30 && rom[i + 15] === 0x8c) { next = i + 17; x = next + s8(rom[i + 16]!); }
  else if (rom[i + 14] === 0x30 && rom[i + 15] === 0x8d) { next = i + 18; x = next + s16((rom[i + 16]! << 8) | rom[i + 17]!); }
  else return null;
  if (rom[next] !== 0x58 || rom[next + 1] !== 0x25) return null;
  return { y, x, next };
}

function handlerValue(rom: Uint8Array, r: number): number | null {
  if (rom[r] !== 0x16) return null;
  let t = r + 3 + s16((rom[r + 1]! << 8) | rom[r + 2]!);
  if (t < 0 || t + 7 > rom.length) return null;
  if (rom[t] === 0xb6 && rom[t + 3] === 0x85 && rom[t + 5] === 0x27) t = t + 7 + s8(rom[t + 6]!);
  if (rom[t] !== 0xe6 || rom[t + 1] !== 0x29) return null;
  const v = rom[r + VALUE]!;
  return v === 0 ? null : v;
}

export function readMpu4VideoCoinTable(rom: Uint8Array, lineOfMask: (mask: number) => number | null): CoinLineTable | Refusal {
  const found = new Map<number, number>();
  const sources: string[] = [];
  for (let i = 0; i + 20 < rom.length; i++) {
    if (rom[i] !== 0xf6) continue;
    const p = pollAt(rom, i);
    if (!p) continue;
    const span = p.x - p.y;
    if (span <= 0 || span % RECORD !== 0 || span / RECORD < 2 || span / RECORD > 8) continue;
    const n = span / RECORD;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const r = p.y + k * RECORD;
      if (rom[r] !== 0x16 || rom[r + 3] !== 0x0c || rom[r + 4] !== 0x02 || rom[r + 6] !== 0) { ok = false; break; }
    }
    if (!ok) continue;
    const mine = new Map<number, number>();
    for (let k = 1; k < n; k++) {
      const line = lineOfMask(1 << (8 - k));
      if (line === null) continue;
      const v = handlerValue(rom, p.y + k * RECORD);
      if (v !== null) mine.set(line, v);
    }
    if (mine.size < 3) continue;
    for (const [line, v] of mine) {
      const had = found.get(line);
      if (had !== undefined && had !== v) return { refused: 'two copies of the coin table state different values' };
      found.set(line, v);
    }
    sources.push(`${hex(p.y)} (polled at ${hex(i)})`);
  }
  if (!sources.length) return { refused: 'no Barcrest video coin records in this program' };
  const lines: CoinLine[] = [...found].map(([line, credits]): CoinLine => ({ line, credits, change: [] }));
  lines.sort((a, b) => a.line - b.line);
  return {
    lines,
    pricePerCredit: null,
    source: `MPU4 Video coin records at 68000 image ${sources.join(', ')}: each coin record's value`,
  };
}

export function readMpu4VideoCoinTakes(rom: Uint8Array, lineOfMask: (mask: number) => number | null): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!('lines' in readMpu4VideoCoinTable(rom, lineOfMask))) return out;
  for (let i = 0; i + 20 < rom.length; i++) {
    if (rom[i] !== 0xf6) continue;
    const p = pollAt(rom, i);
    if (!p) continue;
    const span = p.x - p.y;
    if (span <= 0 || span % RECORD !== 0 || span / RECORD < 2 || span / RECORD > 8) continue;
    const n = span / RECORD;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const r = p.y + k * RECORD;
      if (rom[r] !== 0x16 || rom[r + 3] !== 0x0c || rom[r + 4] !== 0x02 || rom[r + 6] !== 0) { ok = false; break; }
    }
    if (!ok) continue;
    for (let k = 1; k < n; k++) {
      const line = lineOfMask(1 << (8 - k));
      if (line === null || handlerValue(rom, p.y + k * RECORD) === null) continue;
      const list = out.get(line) ?? [];
      const at = p.y + k * RECORD;
      if (!list.includes(at)) list.push(at);
      out.set(line, list);
    }
  }
  return out;
}
