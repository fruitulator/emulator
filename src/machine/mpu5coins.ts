import { findDeviceTable } from './bcosdev';
import type { CoinLineTable, Refusal } from './coinwiring';

export interface Mpu5Channel {
  bit: number;
  pence: number | null;
  label: string;
  cents?: number;
  pattern: number;
}

export interface CoinValue {
  pence: number | null;
  cents: number | null;
  label: string;
}

export interface Mpu5Mechs {
  parallel: Mpu5Channel[] | null;
  binary: Mpu5Channel[] | null;
  at: { parallel: number[]; binary: number[] };
  refused: { parallel: string | null; binary: string | null };
  notSterling: string[];
}

const u16At = (rom: Uint8Array, a: number): number => (rom[a]! << 8) | rom[a + 1]!;
const u32At = (rom: Uint8Array, a: number): number =>
  ((rom[a]! << 24) | (rom[a + 1]! << 16) | (rom[a + 2]! << 8) | rom[a + 3]!) >>> 0;

export function coinRecordName(rom: Uint8Array, coin: number): string | null {
  let end = -1;
  for (let j = coin + 0x10; j + 4 <= rom.length && j < coin + 0x200; j += 2) {
    if (u32At(rom, j) === coin) { end = j - 4; break; }
  }
  if (end < 0) return null;
  for (let k = coin + 4; k + 4 <= end; k += 2) {
    const p = u32At(rom, k);
    if (p <= k + 3 || p >= end) continue;
    let s = '';
    let q = p;
    for (; q < end && rom[q] !== 0; q++) {
      const ch = rom[q]!;
      if (ch < 0x20 || ch > 0x7e) { s = ''; break; }
      s += String.fromCharCode(ch);
    }
    if (s && q < end) return s;
  }
  return null;
}

export function penceLabel(p: number): string {
  if (p < 100) return `${p}p`;
  return p % 100 === 0 ? `£${p / 100}` : `£${(p / 100).toFixed(2)}`;
}

function centsLabel(c: number): string {
  return c % 100 === 0 ? `€${c / 100}` : `€${(c / 100).toFixed(2)}`;
}

export function readCoinValue(rom: Uint8Array, coin: number): CoinValue {
  const credits = u16At(rom, coin + 8);
  const name = coinRecordName(rom, coin);
  if (credits === 0) return { pence: 0, cents: null, label: 'token' };
  if (name === null) return { pence: credits, cents: null, label: penceLabel(credits) };
  const gbp = /^\s*(\d+)\s*P\s*$/i.exec(name);
  if (gbp) {
    const p = Number(gbp[1]);
    return p === credits ? { pence: p, cents: null, label: penceLabel(p) } : { pence: null, cents: null, label: name.trim() };
  }
  const eur = /^\s*(\d+)(?:[.,](\d{1,2}))?\s*EU(?:R|RO)?\s*$/i.exec(name);
  if (eur) {
    const cents = Number(eur[1]) * 100 + (eur[2] ? Number(eur[2].padEnd(2, '0')) : 0);
    return { pence: null, cents, label: centsLabel(cents) };
  }
  return { pence: null, cents: null, label: name.trim() };
}

const BIT_OF_PENCE = new Map<number, number>([[5, 0], [10, 1], [20, 2], [50, 3], [100, 4], [200, 5]]);
const TOKEN_BIT = 6;
const COIN_PORT = 0xffffff;
const NO_DEVICE = 0x270f;

const tagIs = (rom: Uint8Array, a: number, t: string): boolean =>
  a >= 0 && a + 4 <= rom.length && [0, 1, 2, 3].every((i) => (rom[a + i]! & 0xdf) === t.charCodeAt(i));

export function readMpu5Mechs(rom: Uint8Array): Mpu5Mechs {
  const u16 = (a: number): number => (rom[a]! << 8) | rom[a + 1]!;
  const u32 = (a: number): number => ((rom[a]! << 24) | (rom[a + 1]! << 16) | (rom[a + 2]! << 8) | rom[a + 3]!) >>> 0;
  const none = (why: string): Mpu5Mechs => ({ parallel: null, binary: null, at: { parallel: [], binary: [] }, refused: { parallel: why, binary: why }, notSterling: [] });
  const table = findDeviceTable(rom);
  if (table < 0) return none('no BCOS device table in the program');
  const device = (id: number): { level: number; mask: number } | null => {
    const e = table + id * 20;
    if (e + 20 > rom.length) return null;
    return { level: u32(e) & 0xffffff, mask: rom[e + 14]! };
  };
  const kinds: Record<'parallel' | 'binary', { at: number; channels: Mpu5Channel[] }[]> = { parallel: [], binary: [] };
  for (let a = 0; a + 0xc0 <= rom.length; a += 2) {
    if (!tagIs(rom, a, 'DMOD') || u16(a + 4) !== 1 || !tagIs(rom, a + 6, 'MECH') || u32(a + 0x12) !== a) continue;
    for (const stride of [14, 16]) {
      const read = readRecord(rom, a, stride, device, u16, u32);
      if (!read) continue;
      kinds[read.kind].push({ at: a, channels: read.channels });
      break;
    }
  }
  const settle = (list: { at: number; channels: Mpu5Channel[] }[], kind: string): { channels: Mpu5Channel[] | null; why: string | null } => {
    if (!list.length) return { channels: null, why: `no ${kind} coin mech record in the program` };
    const key = (c: Mpu5Channel[]): string => JSON.stringify(c);
    const first = key(list[0]!.channels);
    if (list.some((r) => key(r.channels) !== first)) return { channels: null, why: `the program's ${kind} coin mech records disagree` };
    return { channels: list[0]!.channels, why: null };
  };
  const p = settle(kinds.parallel, 'parallel');
  const b = settle(kinds.binary, 'binary');
  return {
    parallel: p.channels,
    binary: b.channels,
    at: { parallel: kinds.parallel.map((r) => r.at), binary: kinds.binary.map((r) => r.at) },
    refused: { parallel: p.why, binary: b.why },
    notSterling: [...new Set([...kinds.parallel, ...kinds.binary].flatMap((r) => r.channels.filter((c) => c.pence === null).map((c) => c.label)))],
  };
}

function readRecord(
  rom: Uint8Array, a: number, stride: number,
  device: (id: number) => { level: number; mask: number } | null,
  u16: (a: number) => number, u32: (a: number) => number,
): { kind: 'parallel' | 'binary'; channels: Mpu5Channel[] } | null {
  const linesAt = a + 0x1e + 8 * stride;
  if (linesAt + 12 > rom.length) return null;
  const masks: (number | null)[] = [];
  for (let k = 0; k < 6; k++) {
    const w = u16(linesAt + 2 * k);
    if (w === NO_DEVICE) { masks.push(null); continue; }
    if (w < 0xff00) return null;
    const d = device(0x10000 - w);
    if (!d || d.level !== COIN_PORT) return null;
    masks.push(d.mask);
  }
  const channels: Mpu5Channel[] = [];
  const foreign: (CoinValue & { pattern: number })[] = [];
  let multi = false;
  for (let i = 0; i < 8; i++) {
    const e = a + 0x1e + i * stride;
    const coin = u32(e);
    if (coin === 0) continue;
    if (coin + 10 > rom.length || !tagIs(rom, coin, 'COIN')) return null;
    const code = rom[e + stride - 2]!;
    if (code === 0 || code > 0x3f) return null;
    let pattern = 0;
    for (let k = 0; k < 6; k++) {
      if (!(code & (1 << k))) continue;
      const m = masks[k];
      if (m === null || m === undefined) return null;
      pattern |= m;
    }
    if (code & (code - 1)) multi = true;
    const v = readCoinValue(rom, coin);
    if (v.pence === null) {
      if (!foreign.some((c) => c.label === v.label)) foreign.push({ ...v, pattern });
      continue;
    }
    const bit = v.pence === 0 ? TOKEN_BIT : BIT_OF_PENCE.get(v.pence);
    if (bit === undefined) continue;
    if (channels.some((c) => c.bit === bit)) continue;
    channels.push({ bit, pence: v.pence, label: v.label, pattern });
  }
  foreign.sort((x, y) => (x.cents ?? Infinity) - (y.cents ?? Infinity));
  for (const f of foreign) {
    let bit = 0;
    while (bit < TOKEN_BIT && channels.some((c) => c.bit === bit)) bit++;
    if (bit >= TOKEN_BIT) break;
    channels.push({ bit, pence: null, label: f.label, ...(f.cents !== null ? { cents: f.cents } : {}), pattern: f.pattern });
  }
  if (!channels.length) return null;
  channels.sort((x, y) => x.bit - y.bit);
  return { kind: multi ? 'binary' : 'parallel', channels };
}

export function mpu5CoinTable(channels: readonly Mpu5Channel[], kind: 'parallel' | 'binary'): CoinLineTable {
  return {
    lines: channels.flatMap((c) => (c.pence !== null && c.pence > 0 ? [{ line: c.bit, credits: c.pence, change: [] }] : [])),
    pricePerCredit: 1,
    source: `MPU5 ${kind} coin mech record`,
  };
}

export function fittedMech(m: Mpu5Mechs, binary: boolean): Mpu5Channel[] | Refusal {
  const ch = binary ? m.binary : m.parallel;
  return ch ?? { refused: (binary ? m.refused.binary : m.refused.parallel) ?? 'no coin mech record' };
}
