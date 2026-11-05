import { M68000 } from '../cpu/m68000';
import type { Bus16 } from '../cpu/bus68k';
import { oneCopyEnd, type CoinLine, type CoinLineTable, type Refusal } from './coinwiring';

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

const CODE_END = 0x40000;
export const SYS5_RAM_BASE = 0x40000;
export const SYS5_RAM_SIZE = 0x4000;
const isRam = (a: number): boolean => a >= SYS5_RAM_BASE && a < SYS5_RAM_BASE + SYS5_RAM_SIZE;
const COIN_BITS = 0xfc00;
const PENCE = new Set([2, 5, 10, 20, 50, 100, 200]);

export interface Sys5CoinLine {
  line: number;
  pence: number;
  token: boolean;
}

export type Sys5CoinIndex = { reg: number } | { local: number };

export interface Sys5CoinCode {
  scan: number;
  gates: number[];
  enable: number;
  enablePointers: boolean;
  index: Sys5CoinIndex;
  accept: number;
  refill: number;
  cond: number;
  refillId: number;
  credit: number;
  lines: Sys5CoinLine[];
}

const w16 = (rom: Uint8Array, a: number): number => ((rom[a]! << 8) | rom[a + 1]!) >>> 0;
const l32 = (rom: Uint8Array, a: number): number => ((rom[a]! << 24) | (rom[a + 1]! << 16) | (rom[a + 2]! << 8) | rom[a + 3]!) >>> 0;
const at = (rom: Uint8Array, a: number, bytes: readonly number[]): boolean => {
  for (let i = 0; i < bytes.length; i++) if (bytes[i]! >= 0 && rom[a + i] !== bytes[i]) return false;
  return true;
};
const find = (rom: Uint8Array, lo: number, hi: number, bytes: readonly number[]): number[] => {
  const out: number[] = [];
  for (let a = Math.max(0, lo) & ~1; a + bytes.length <= Math.min(hi, rom.length); a += 2) if (at(rom, a, bytes)) out.push(a);
  return out;
};
const _ = -1;

const LOOP_MAX = 0x400;
const SETUP_MAX = 0x60;

export function locateSys5Coins(rom: Uint8Array): Sys5CoinCode | Refusal {
  const end = Math.min(rom.length, CODE_END, oneCopyEnd(rom));
  let found: Sys5CoinCode[] = [];
  for (let a = 0; a + 10 <= end; a += 2) {
    if (rom[a] !== 0x0c || (rom[a + 1]! & 0xf8) !== 0x70 || w16(rom, a + 2) !== 0xffff || w16(rom, a + 4) !== 0x0800) continue;
    if (w16(rom, a + 6) !== 0x6600) continue;
    const disp = w16(rom, a + 8);
    if (disp < 0x8000) continue;
    const head = a + 8 + disp - 0x10000;
    if (a - head > LOOP_MAX) continue;
    const c = scanAround(rom, head, a, rom[a + 1]! & 7);
    if (c && !found.some((f) => f.enable === c.enable && f.credit === c.credit)) found.push(c);
  }
  if (found.length > 1) found = found.filter((c) => scanReachable(rom, c.scan, end));
  if (found.length === 0) return { refused: 'System 5 coin scan not found (no priced credit add with its refill test and line scan)' };
  if (found.length > 1) return { refused: `System 5 coin scan found ${found.length} times (${found.map((c) => hex(c.scan)).join(', ')})` };
  return found[0]!;
}

function scanReachable(rom: Uint8Array, scan: number, end: number): boolean {
  const named = (v: number): number[] => {
    const hits: number[] = [];
    for (let a = 0; a + 4 <= end; a += 2) if (l32(rom, a) === v) hits.push(a);
    return hits;
  };
  for (const p of named(scan)) {
    if (p >= 2 && w16(rom, p - 2) === 0x4eb9) return true;
    let first = p;
    while (first >= 4) {
      const v = l32(rom, first - 4);
      if (v === 0 || v >= CODE_END || (v & 1) !== 0) break;
      first -= 4;
    }
    if (named(first).length) return true;
  }
  return false;
}

function loadAt(rom: Uint8Array, a: number, n: number): number | null {
  const op = w16(rom, a);
  return op === (0x207c | (n << 9)) || op === (0x41f9 | (n << 9)) ? l32(rom, a + 2) : null;
}

function tableIn(rom: Uint8Array, at: number, n: number, head: number): number | null {
  const near = loadAt(rom, at - 6, n);
  if (near !== null) return near;
  if (n === 0) return null;
  for (let a = head - 4; a >= head - SETUP_MAX && a >= 0; a -= 2) {
    const t = loadAt(rom, a, n);
    if (t !== null) return t;
  }
  return null;
}

function linesAreNumbered(rom: Uint8Array, head: number, term: number): boolean {
  for (const a of find(rom, head, term, [0x2f, 0x01, 0x4e, 0xb9])) {
    const r = l32(rom, a + 4);
    if (r >= CODE_END) continue;
    for (let q = r; q < r + 8; q += 2) {
      if (at(rom, q, [0x30, 0x3c, 0x04, 0x00, 0x32, 0x2e, 0x00, 0x0a, 0xe3, 0x60, 0xc0, 0x79, 0x00, 0x04, 0x80, 0x04])) return true;
    }
  }
  return false;
}

function scanAround(rom: Uint8Array, head: number, term: number, tableReg: number): Sys5CoinCode | null {
  if (head < SETUP_MAX) return null;
  const masks = tableIn(rom, term, tableReg, head);
  if (masks === null || masks >= CODE_END || masks + 4 > rom.length) return null;
  const numbered = linesAreNumbered(rom, head, term);
  const maskWords: number[] = [];
  for (let k = 0; k < 8; k++) {
    const v = w16(rom, masks + 2 * k);
    if (v === 0xffff) break;
    if (numbered && v > 5) return null;
    const m = numbered ? 0x0400 << v : v;
    if ((m & COIN_BITS) !== m || (m & (m - 1)) !== 0 || m === 0) return null;
    maskWords.push(m);
  }
  if (maskWords.length < 2 || w16(rom, masks + 2 * maskWords.length) !== 0xffff) return null;
  if (new Set(maskWords).size !== maskWords.length) return null;

  let index: Sys5CoinIndex;
  if (rom[head] === 0x48 && (rom[head + 1]! & 0xf8) === 0xc0) index = { reg: rom[head + 1]! & 7 };
  else if (w16(rom, head) === 0x302e) index = { local: (w16(rom, head + 2) ^ 0x8000) - 0x8000 };
  else return null;

  let enable = -1;
  let enablePointers = false;
  for (let a = head; a < head + 0x18 && enable < 0; a += 2) {
    const t = loadAt(rom, a, 0);
    if (t === null) continue;
    if ((rom[a + 6]! & 0xf1) === 0x30 && rom[a + 7] === 0x30 && w16(rom, a + 8) === 0x0800 && w16(rom, a + 10) === 0x6700) enable = t;
    else if (at(rom, a + 6, [0x3d, 0x70, 0x08, 0x00, _, _, 0x67, 0x00])) enable = t;
    else if (at(rom, a + 6, [0x22, 0x70, 0x08, 0x00, 0x4a, 0x51, 0x66, 0x00])) { enable = t; enablePointers = true; }
  }
  if (!isRam(enable)) return null;

  let t = -1;
  let idAt = 0;
  let condAt = 0;
  let branchAt = 0;
  for (let a = head; a < term && t < 0; a += 2) {
    if (at(rom, a, [0x36, 0x39, _, _, _, _, 0x4e, 0xb9, _, _, _, _, 0x4a, 0x80])) { t = a; idAt = a + 2; condAt = a + 8; branchAt = a + 14; }
    else if (at(rom, a, [0x3f, 0x39, _, _, _, _, 0x55, 0x4f, 0x4e, 0xb9, _, _, _, _, 0x4a, 0x80, 0x58, 0x4f])) { t = a; idAt = a + 2; condAt = a + 10; branchAt = a + 18; }
    else if (at(rom, a, [0x70, 0x00, 0x30, 0x39, _, _, _, _, 0x2f, 0x00, 0x4e, 0xb9, _, _, _, _, 0x4a, 0x80, 0x58, 0x4f])) { t = a; idAt = a + 4; condAt = a + 12; branchAt = a + 20; }
  }
  if (t < 0 || rom[branchAt] !== 0x66) return null;
  const refillId = l32(rom, idAt);
  const cond = l32(rom, condAt);
  let refill: number;
  const b8 = rom[branchAt + 1]!;
  if (b8 === 0xff) return null;
  if (b8 === 0) { refill = branchAt + 2 + ((w16(rom, branchAt + 2) ^ 0x8000) - 0x8000); }
  else refill = branchAt + 2 + (b8 < 0x80 ? b8 : b8 - 0x100);
  if (cond >= CODE_END || (refillId >= CODE_END && !isRam(refillId))) return null;

  let add = -1;
  let prices: number | null = null;
  for (let a = branchAt + 2; a < term && add < 0; a += 2) {
    if ((rom[a]! & 0xf1) !== 0x30 || (rom[a + 1]! & 0xf8) !== 0x30 || (rom[a + 2]! & 0x0f) !== 0x08 || rom[a + 3] !== 0) continue;
    const y = (rom[a]! >> 1) & 7;
    if (rom[a + 4] !== 0x48 || rom[a + 5] !== (0xc0 | y)) continue;
    if (rom[a + 6] !== (0xd1 | (y << 1)) || rom[a + 7] !== 0xb9 || !isRam(l32(rom, a + 8))) continue;
    prices = tableIn(rom, a, rom[a + 1]! & 7, head);
    if (prices === null || prices >= CODE_END) return null;
    add = a;
  }
  if (add < 0) return null;
  const accept = add + 4;
  const credit = l32(rom, add + 8);

  const lines: Sys5CoinLine[] = [];
  for (let k = 0; k < maskWords.length; k++) {
    const pence = w16(rom, prices! + 2 * k);
    if (!PENCE.has(pence)) return null;
    lines.push({ line: 31 - Math.clz32(maskWords[k]!), pence, token: false });
  }

  if (w16(rom, head - 4) !== 0x6000) return null;
  let clear = head - 4;
  if (w16(rom, clear - 2) === 0x7800 || (rom[clear - 2]! & 0xf1) === 0x70) clear -= 2;
  else if (w16(rom, clear - 4) === 0x426e) clear -= 4;
  else return null;
  if (rom[clear - 2] === 0x61 && rom[clear - 1] !== 0) clear -= 2;
  else if (at(rom, clear - 12, [0x4e, 0xb9, _, _, _, _, 0x4a, 0x80, 0x66, 0x00])) clear -= 12;
  const gates: number[] = [];
  let g = clear - 10;
  while ((at(rom, g, [0x10, 0x39, _, _, _, _, 0x66, 0x00]) || at(rom, g, [0x4a, 0x39, _, _, _, _, 0x66, 0x00])) && isRam(l32(rom, g + 2))) {
    gates.unshift(l32(rom, g + 2));
    g -= 10;
  }
  if (gates.length === 0) return null;
  const mv = [...find(rom, g - 0x20, g + 10, [0x48, 0xe7]), ...find(rom, g - 0x20, g + 10, [0x4e, 0x56])].sort((x, y) => x - y);
  const scan = mv.length ? mv[mv.length - 1]! : g + 10;

  let token = -1;
  for (let a = head; a < term && token < 0; a += 2) {
    if (rom[a] === 0x30 && rom[a + 1] === (0x00 | ('reg' in index ? index.reg : 0)) && (rom[a + 2]! & 0xf1) === 0x51 && rom[a + 3] === 0x40 && rom[a + 4] === 0x66) {
      const set = a + 6;
      if ((rom[set]! & 0xf1) === 0x10 && rom[set + 1] === 0xbc && w16(rom, set + 2) === 1) {
        const i = (rom[a + 2]! >> 1) & 7;
        token = i === 0 ? 8 : i;
      }
    } else if (rom[a] === 0x0c && (rom[a + 1]! & 0xf8) === 0x70 && w16(rom, a + 4) === 0x0800 && rom[a + 6] === 0x66) {
      const set = a + 8;
      const m = w16(rom, a + 2);
      if (m === 0x4000 || ((rom[set]! & 0xf1) === 0x10 && rom[set + 1] === 0xbc && w16(rom, set + 2) === 1)) token = maskWords.indexOf(m);
    }
  }
  if (token < 0 && 'reg' in index) {
    const cmpi = [0x0c, 0x40 | index.reg, 0x00];
    for (let a = add; a < term && token < 0; a += 2) {
      if (!at(rom, a, cmpi)) continue;
      const b = w16(rom, a + 4) === 0x584f ? a + 6 : a + 4;
      if (rom[b] === 0x66 && w16(rom, b + 2) === 0x13fc && w16(rom, b + 4) === 1) token = rom[a + 3]!;
    }
  }
  if (token >= lines.length) return null;
  if (token < 0) token = maskWords.indexOf(0x4000);
  if (token >= 0) lines[token]!.token = true;
  return { scan, gates, enable, enablePointers, index, accept, refill, cond, refillId, credit, lines };
}

export interface Sys5Meters {
  table: number;
  cashIn: number;
  cashOut: number;
  tokenIn: number;
  tokenOut: number;
  refill: number;
}

export function locateSys5Meters(rom: Uint8Array): Sys5Meters | Refusal {
  const end = Math.min(rom.length, CODE_END, oneCopyEnd(rom));
  const found: Sys5Meters[] = [];
  for (let a = 0; a + 30 <= end; a += 2) {
    const id0 = w16(rom, a);
    if ((id0 & 0xe000) !== 0x2000 || (id0 & 0x00f8) !== 0) continue;
    const bits: number[] = [];
    const ptrs: number[] = [];
    let ok = true;
    for (let k = 0; k < 5 && ok; k++) {
      const id = w16(rom, a + 6 * k);
      const p = l32(rom, a + 6 * k + 2);
      if ((id & 0xfff8) !== (id0 & 0xfff8) || !isRam(p) || p !== l32(rom, a + 2) + 4 * k) ok = false;
      bits.push(id & 7);
      ptrs.push(p);
    }
    if (!ok || new Set(bits).size !== 5) continue;
    const refs = find(rom, 0, end, [-1, 0x7c, (a >>> 24) & 0xff, (a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff])
      .filter((r) => (rom[r]! & 0xf1) === 0x20);
    if (!refs.length) continue;
    found.push({ table: a, cashIn: bits[0]!, cashOut: bits[1]!, tokenIn: bits[2]!, tokenOut: bits[3]!, refill: bits[4]! });
  }
  if (found.length === 0) return { refused: 'System 5 meter table not found' };
  if (found.length > 1) return { refused: `System 5 meter table found ${found.length} times` };
  return found[0]!;
}

export function sys5CoinTable(code: Sys5CoinCode): CoinLineTable {
  const lines: CoinLine[] = code.lines.map((l) => (l.token
    ? { line: l.line, credits: l.pence, change: [], token: true, tokenPence: l.pence }
    : { line: l.line, credits: l.pence, change: [] }));
  return { lines, pricePerCredit: 1, source: `JPM System 5 coin scan ${hex(code.scan)}` };
}

export interface Sys5DryState {
  rom: Uint8Array;
  ram: Uint8Array;
  input(addr: number): number | null;
  sp: number;
  sr: number;
}

class Inconclusive extends Error {}

export function sys5DryCall(st: Sys5DryState, entry: number, d3: number, maxSteps = 2000): number | null {
  const ram = st.ram.slice();
  const read16 = (a: number): number => {
    a &= 0xffffff;
    if (a < st.rom.length - 1) return (st.rom[a]! << 8) | st.rom[a + 1]!;
    if (isRam(a)) return (ram[a - SYS5_RAM_BASE]! << 8) | ram[a - SYS5_RAM_BASE + 1]!;
    const v = st.input(a & ~1);
    if (v === null) throw new Inconclusive();
    return v & 0xffff;
  };
  const bus: Bus16 = {
    read16: (a) => read16(a & ~1),
    read8: (a) => (a & 1 ? read16(a & ~1) & 0xff : read16(a) >> 8),
    write8: (a, v) => {
      a &= 0xffffff;
      if (!isRam(a)) throw new Inconclusive();
      ram[a - SYS5_RAM_BASE] = v & 0xff;
    },
    write16: (a, v) => {
      a &= 0xffffff;
      if (!isRam(a)) throw new Inconclusive();
      ram[a - SYS5_RAM_BASE] = (v >> 8) & 0xff;
      ram[a - SYS5_RAM_BASE + 1] = v & 0xff;
    },
  };
  const cpu = new M68000(bus);
  cpu.setSR(st.sr | 0x0700);
  cpu.a[7] = st.sp;
  try {
    cpu.a[7] = (cpu.a[7] - 8) >>> 0;
    bus.write16(cpu.a[7], 0);
    bus.write16(cpu.a[7] + 2, 0);
    bus.write16(cpu.a[7] + 4, (d3 >>> 16) & 0xffff);
    bus.write16(cpu.a[7] + 6, d3 & 0xffff);
    cpu.d[3] = d3 >>> 0;
    cpu.pc = entry;
    cpu.fillPrefetch();
    for (let i = 0; i < maxSteps; i++) {
      cpu.step();
      if (cpu.pc === 0) return cpu.d[0]! >>> 0;
    }
    return null;
  } catch (e) {
    if (e instanceof Inconclusive) return null;
    return null;
  }
}
