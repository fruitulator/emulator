import { findDeviceTable } from './bcosdev';
import type { CoinLineTable, Refusal } from './coinwiring';

export interface Mpu5Channel {
  bit: number;
  pence: number;
  pattern: number;
}

export interface Mpu5Mechs {
  parallel: Mpu5Channel[] | null;
  binary: Mpu5Channel[] | null;
  at: { parallel: number[]; binary: number[] };
  refused: { parallel: string | null; binary: string | null };
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
  const none = (why: string): Mpu5Mechs => ({ parallel: null, binary: null, at: { parallel: [], binary: [] }, refused: { parallel: why, binary: why } });
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
    const pence = u16(coin + 8);
    const bit = pence === 0 ? TOKEN_BIT : BIT_OF_PENCE.get(pence);
    if (bit === undefined) continue;
    if (channels.some((c) => c.bit === bit)) continue;
    channels.push({ bit, pence, pattern });
  }
  if (!channels.length) return null;
  channels.sort((x, y) => x.bit - y.bit);
  return { kind: multi ? 'binary' : 'parallel', channels };
}

export function mpu5CoinTable(channels: readonly Mpu5Channel[], kind: 'parallel' | 'binary'): CoinLineTable {
  return {
    lines: channels.filter((c) => c.pence > 0).map((c) => ({ line: c.bit, credits: c.pence, change: [] })),
    pricePerCredit: 1,
    source: `MPU5 ${kind} coin mech record`,
  };
}

export function fittedMech(m: Mpu5Mechs, binary: boolean): Mpu5Channel[] | Refusal {
  const ch = binary ? m.binary : m.parallel;
  return ch ?? { refused: (binary ? m.refused.binary : m.refused.parallel) ?? 'no coin mech record' };
}
