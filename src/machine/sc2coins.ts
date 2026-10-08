import type { CoinLineTable, Refusal } from './coinwiring';

const REC = 29;
export const SC2_COIN_LINES = 8;

const SELECTOR = [0x34, 0x02, 0xa6, 0x01, 0x85, 0x08, 0x26, 0x05, 0x30, 0x88, 0x1d, 0x20, 0xf5,
  0x10, 0xae, 0x0a, 0x27, 0x09, 0x6d, 0xa4, 0x2a, 0x05, 0x30, 0x88, 0x1d, 0x20, 0xf2, 0x35, 0x02, 0x39];
const CREDIT_ADD = [0xa6, 0x02, 0x31, 0xa6, 0x10, 0xbf];
const PORT_READ = [0xf6, 0x3f, 0xff, 0xc4];

export interface Sc2CoinTables {
  table: number;
  groups: number;
  portMask: number;
  decode: number | null;
}

export type Sc2Mem = (a: number) => number;

function at(rom: Uint8Array, p: number, sig: readonly number[]): boolean {
  if (p < 0 || p + sig.length > rom.length) return false;
  for (let k = 0; k < sig.length; k++) if (rom[p + k] !== sig[k]) return false;
  return true;
}

function findAll(rom: Uint8Array, sig: readonly number[]): number[] {
  const out: number[] = [];
  for (let p = 0; p + sig.length <= rom.length; p++) if (at(rom, p, sig)) out.push(p);
  return out;
}

export function locateSc2CoinTables(rom: Uint8Array): Sc2CoinTables | Refusal {
  const found = new Set<string>();
  for (let p = 0; p + 12 <= rom.length; p++) {
    if (rom[p] !== 0xc6 || rom[p + 2] !== 0x34 || rom[p + 3] !== 0x04 || rom[p + 4] !== 0x8e
      || rom[p + 7] !== 0x17 || rom[p + 10] !== 0xa5 || rom[p + 11] !== 0x0c) continue;
    const rel = ((rom[p + 8]! << 8) | rom[p + 9]!) << 16 >> 16;
    if (!at(rom, p + 10 + rel, SELECTOR)) continue;
    found.add(`${(rom[p + 5]! << 8) | rom[p + 6]!},${rom[p + 1]!}`);
  }
  if (found.size !== 1) return { refused: found.size ? 'the program names two coin tables' : 'no coin records found in the program' };
  const [table, groups] = [...found][0]!.split(',').map(Number) as [number, number];
  if (table < 0x8000 || table + groups * REC * 4 > rom.length) return { refused: 'the coin records are not in fixed ROM' };
  if (groups < 1 || groups > SC2_COIN_LINES) return { refused: 'the coin record count is out of range' };
  if (findAll(rom, CREDIT_ADD).length !== 1) return { refused: 'the program\'s credit routine was not found' };
  const reads = findAll(rom, PORT_READ);
  if (reads.length !== 1) return { refused: 'the program\'s coin-port read was not found' };
  const r = reads[0]!;
  const portMask = rom[r + 4]!;
  let decode: number | null = null;
  if (rom[r + 5] === 0x8e && rom[r + 8] === 0xe6 && rom[r + 9] === 0x85) {
    decode = (rom[r + 6]! << 8) | rom[r + 7]!;
    if (decode < 0x8000 || decode + 32 > rom.length) return { refused: 'the coin-port decode is not in fixed ROM' };
  }
  return { table, groups, portMask, decode };
}

export interface Sc2Coin {
  at: number;
  mask: number;
  credits: number;
  counter: number;
}

export function sc2Coins(t: Sc2CoinTables, rom: Uint8Array, mem: Sc2Mem): Sc2Coin[] | Refusal {
  const out: Sc2Coin[] = [];
  let x = t.table;
  const end = t.table + (t.groups * 4 + 4) * REC;
  for (let g = 0; g < t.groups; g++) {
    while (x < end && !(rom[x + 1]! & 0x08)) x += REC;
    for (;;) {
      if (x >= end) return { refused: 'the coin records run past their table' };
      const ptr = (rom[x + 10]! << 8) | rom[x + 11]!;
      if (ptr === 0 || !(mem(ptr) & 0x80)) break;
      x += REC;
    }
    const mask = rom[x + 12]!;
    const credits = rom[x + 2]!;
    if (!mask || (mask & (mask - 1)) !== 0) return { refused: 'a coin record names no single coin line' };
    if (out.some((c) => c.mask === mask)) return { refused: 'two coin records name one coin line' };
    out.push({ at: x, mask, credits, counter: rom[x + 15]! });
    x += REC;
  }
  return out;
}

const lineOf = (mask: number): number => 31 - Math.clz32(mask);

export function sc2CoinTable(t: Sc2CoinTables, rom: Uint8Array, mem: Sc2Mem): CoinLineTable | Refusal {
  const coins = sc2Coins(t, rom, mem);
  if (!Array.isArray(coins)) return coins;
  const big = coins.reduce((a, b) => (b.credits > a.credits ? b : a));
  return {
    lines: coins.map((c) => ({
      line: lineOf(c.mask),
      credits: c.credits,
      change: [],
      ...(c.counter !== 0 && c.counter !== big.counter ? { token: true } : {}),
    })).sort((a, b) => a.line - b.line),
    pricePerCredit: null,
    source: `Scorpion 2 coin records at $${t.table.toString(16).toUpperCase()}${t.decode !== null ? `, port decode at $${t.decode.toString(16).toUpperCase()}` : ''}`,
  };
}

export function sc2ProgramLine(t: Sc2CoinTables, rom: Uint8Array, mem: Sc2Mem, pattern: number): number | 'refused' | null {
  const code = pattern & t.portMask;
  const mask = t.decode === null ? code : rom[t.decode + (code & 0x1f)]!;
  if (!mask) return 'refused';
  if ((mask & (mask - 1)) !== 0) return null;
  const coins = sc2Coins(t, rom, mem);
  if (!Array.isArray(coins)) return null;
  return coins.some((c) => c.mask === mask) ? lineOf(mask) : 'refused';
}

export function sc2LinePattern(t: Sc2CoinTables, rom: Uint8Array, mem: Sc2Mem, line: number): number {
  const bit = 1 << line;
  if (t.decode === null) return bit;
  if (rom[t.decode + (bit & t.portMask & 0x1f)] === bit) return bit;
  for (let c = 0; c < 32; c++) {
    if ((c & t.portMask) !== c || rom[t.decode + c] !== bit) continue;
    return sc2ProgramLine(t, rom, mem, c) === line ? c : bit;
  }
  return bit;
}
