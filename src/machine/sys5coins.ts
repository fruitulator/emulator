import { M68000 } from '../cpu/m68000';
import type { Bus16 } from '../cpu/bus68k';
import type { CoinLine, CoinLineTable, Refusal } from './coinwiring';

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

const CODE_END = 0x40000;
export const SYS5_RAM_BASE = 0x40000;
export const SYS5_RAM_SIZE = 0x4000;
const isRam = (a: number): boolean => a >= SYS5_RAM_BASE && a < SYS5_RAM_BASE + SYS5_RAM_SIZE;
const COIN_BITS = 0x7c00;
const PENCE = new Set([2, 5, 10, 20, 50, 100, 200]);

export interface Sys5CoinLine {
  line: number;
  pence: number;
  token: boolean;
}

export interface Sys5CoinCode {
  scan: number;
  gates: number[];
  enable: number;
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

export function locateSys5Coins(rom: Uint8Array): Sys5CoinCode | Refusal {
  const end = Math.min(rom.length, CODE_END);
  const adds = find(rom, 0, end, [0x20, 0x7c, _, _, _, _, 0x30, 0x30, 0x08, 0x00, 0x48, 0xc0, 0xd1, 0xb9])
    .filter((a) => isRam(l32(rom, a + 14)));
  const found: Sys5CoinCode[] = [];
  for (const a of adds) {
    const c = scanAround(rom, a);
    if (c) found.push(c);
  }
  if (found.length === 0) return { refused: 'System 5 coin scan not found (no priced credit add with its refill test and line scan)' };
  if (found.length > 1) return { refused: `System 5 coin scan found ${found.length} times (${found.map((c) => hex(c.scan)).join(', ')})` };
  return found[0]!;
}

function scanAround(rom: Uint8Array, add: number): Sys5CoinCode | null {
  const prices = l32(rom, add + 2);
  const accept = add + 10;
  const credit = l32(rom, add + 14);
  const tests = find(rom, add - 0x40, add, [0x36, 0x39, _, _, _, _, 0x4e, 0xb9, _, _, _, _, 0x4a, 0x80, 0x66, _]);
  if (tests.length !== 1) return null;
  const t = tests[0]!;
  const refillId = l32(rom, t + 2);
  const cond = l32(rom, t + 8);
  const disp = rom[t + 15]!;
  if (disp === 0 || disp === 0xff) return null;
  const refill = t + 16 + (disp < 0x80 ? disp : disp - 0x100);
  if (cond >= CODE_END || (refillId >= CODE_END && !isRam(refillId))) return null;
  const ens = find(rom, t - 0x200, t, [0x20, 0x7c, _, _, _, _, 0x3a, 0x30, 0x08, 0x00, 0x67, 0x00]);
  if (ens.length < 1) return null;
  const en = ens[0]!;
  const enable = l32(rom, en + 2);
  if (!isRam(enable)) return null;
  const startAt = find(rom, en - 0x40, en, [0x78, 0x00, 0x60, 0x00]);
  if (startAt.length < 1) return null;
  const st = startAt[startAt.length - 1]!;
  const gates: number[] = [];
  let g = st - 10;
  while (at(rom, g, [0x10, 0x39, _, _, _, _, 0x66, 0x00]) && isRam(l32(rom, g + 2))) { gates.unshift(l32(rom, g + 2)); g -= 10; }
  if (gates.length === 0) return null;
  const mv = find(rom, g - 0x20, g + 10, [0x48, 0xe7]);
  const scan = mv.length ? mv[mv.length - 1]! : g + 10;
  let masks = -1;
  let inA5 = false;
  const inLoop = find(rom, en, add, [0x20, 0x7c, _, _, _, _, 0x36, 0x30, 0x38, 0x00]);
  if (inLoop.length === 1) masks = l32(rom, inLoop[0]! + 2);
  else {
    const a5 = find(rom, scan, en, [0x2a, 0x7c, _, _, _, _]);
    if (a5.length !== 1 || find(rom, en, add, [0x36, 0x35, 0x38, 0x00]).length !== 1) return null;
    masks = l32(rom, a5[0]! + 2);
    inA5 = true;
  }
  if (masks >= CODE_END || masks + 16 > rom.length || prices >= CODE_END) return null;
  const lines: Sys5CoinLine[] = [];
  for (let k = 0; k < 8; k++) {
    const m = w16(rom, masks + 2 * k);
    if (m === 0xffff) break;
    if ((m & COIN_BITS) !== m || (m & (m - 1)) !== 0 || m === 0) return null;
    const pence = w16(rom, prices + 2 * k);
    if (!PENCE.has(pence)) return null;
    lines.push({ line: 31 - Math.clz32(m), pence, token: false });
  }
  if (lines.length < 2 || w16(rom, masks + 2 * lines.length) !== 0xffff) return null;
  if (new Set(lines.map((l) => l.line)).size !== lines.length) return null;
  const after = add + 18;
  const byIndex = find(rom, after, after + 0x10, [0x30, 0x04, _, 0x40, 0x66, _, 0x18, 0xbc, 0x00, 0x01]);
  const byMask = find(rom, after, after + 0x20, [0x0c, 0x75, _, _, 0x08, 0x00, 0x66, _, 0x18, 0xbc, 0x00, 0x01]);
  let token = -1;
  if (byIndex.length === 1 && (rom[byIndex[0]! + 2]! & 0xf1) === 0x51) {
    const n = (rom[byIndex[0]! + 2]! >> 1) & 7;
    token = n === 0 ? 8 : n;
  } else if (byMask.length === 1 && inA5) {
    const m = w16(rom, byMask[0]! + 2);
    token = lines.findIndex((l) => 1 << l.line === m);
  } else return null;
  if (token < 0 || token >= lines.length) return null;
  lines[token]!.token = true;
  return { scan, gates, enable, accept, refill, cond, refillId, credit, lines };
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
  const end = Math.min(rom.length, CODE_END);
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
    cpu.a[7] = (cpu.a[7] - 4) >>> 0;
    bus.write16(cpu.a[7], 0);
    bus.write16(cpu.a[7] + 2, 0);
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
