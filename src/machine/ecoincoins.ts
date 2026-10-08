import type { CoinLine, CoinLineTable, Refusal, SlotCoin } from './coinwiring';
import { detectCoins } from './coinwiring';
import { Z80 } from '../cpu/z80';

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

export type EcoinTake =
  | { kind: 'record'; pcs: number[]; recordLine: Map<number, number> }
  | { kind: 'index'; pcs: number[]; ixOff: number; indexLines: Map<number, number[]> };

export interface EcoinCoinCode {
  shape: 'A' | 'B' | 'C' | 'D';
  table: CoinLineTable;
  aliases: Map<number, number>;
  reads: Set<number>;
  take: EcoinTake;
  keys: number[];
}

function find(rom: Uint8Array, pat: readonly number[], from = 0, to = rom.length): number[] {
  const out: number[] = [];
  for (let i = from; i + pat.length <= to; i++) {
    let ok = true;
    for (let j = 0; j < pat.length; j++) if (pat[j]! >= 0 && rom[i + j] !== pat[j]) { ok = false; break; }
    if (ok) out.push(i);
  }
  return out;
}
const word = (b: Uint8Array, a: number): number => b[a]! | (b[a + 1]! << 8);
const X = -1;
const bitOf = (mask: number): number => (mask && !(mask & (mask - 1)) ? 31 - Math.clz32(mask) : -1);

const TAKE_TAIL = [0x13, 0x1a, 0xbe, 0x38, 0x04, 0x36, 0x00, 0xaf, 0xc9, 0x3e, 0x01, 0xcd];

interface Records { walker: number; take: number; records: number[]; callEnds: number[] }

function readRecords(rom: Uint8Array, test: readonly number[]): Records | null {
  for (const w of find(rom, [0x1a, 0x13, ...test])) {
    const tail = find(rom, TAKE_TAIL, w, Math.min(rom.length, w + 0x40))[0];
    if (tail === undefined) continue;
    const records: number[] = []; const callEnds: number[] = [];
    for (const c of find(rom, [0x21, X, X, 0x11, X, X, 0xcd, w & 0xff, w >> 8])) {
      records.push(word(rom, c + 4));
      callEnds.push(c + 9);
    }
    if (records.length < 2) continue;
    return { walker: w, take: tail + 9, records, callEnds };
  }
  return null;
}

function recordLine(rom: Uint8Array, table: number, size: number, maskAt: number, portAt: number, id: number): number {
  const e = table + id * size;
  if (e + size > rom.length) return -1;
  const b = bitOf(rom[e + maskAt]!);
  const port = rom[e + portAt]!;
  return b < 0 || port > 7 ? -1 : port * 8 + b;
}

function readShapeA(rom: Uint8Array): EcoinCoinCode | Refusal | null {
  const r = readRecords(rom, [0xcd, X, X, 0x30]);
  if (!r) return null;
  const test = word(rom, r.walker + 3);
  const ld = find(rom, [0x2a, X, X, 0x09, 0x09, 0x09, 0x56, 0x23, 0x5e, 0x23, 0x4e], test, Math.min(rom.length, test + 0x20))[0];
  if (ld === undefined) return { refused: `coin records at ${hex(r.records[0]!)}: switch test ${hex(test)} not read` };
  const table = word(rom, word(rom, ld + 1));
  const lines: CoinLine[] = []; const recordLines = new Map<number, number>();
  for (let i = 0; i < r.records.length; i++) {
    const rec = r.records[i]!;
    const line = recordLine(rom, table, 3, 1, 2, rom[rec]!);
    if (line < 0) return { refused: `coin record ${hex(rec)}: its switch is not one input line` };
    recordLines.set(rec, line);
    const value = rom[rec + 3]!;
    if (value > 0) { lines.push({ line, credits: value, change: [] }); continue; }
    const end = r.callEnds[i]!;
    const add = find(rom, [0x3e, X, 0x85], end, Math.min(rom.length, end + 0x30))[0];
    if (rom[end] !== 0x30 || add === undefined) return { refused: `coin record ${hex(rec)} credits nothing and its token branch is not read` };
    const pence = rom[add + 1]!;
    lines.push({ line, credits: pence, change: [], token: true, tokenPence: pence });
  }
  return finish('A', lines, 1, `Electrocoin coin records in pence at ${hex(r.records[0]!)}`, {
    kind: 'record', pcs: [r.take], recordLine: recordLines,
  }, [], new Set(recordLines.values()));
}

function readShapeB(rom: Uint8Array, ram: Uint8Array): EcoinCoinCode | Refusal | null {
  const r = readRecords(rom, [0xdf, X, 0x20]);
  if (!r) return null;
  const ld = find(rom, [0x2a, X, X, 0x08, 0x57, 0x09, 0x09, 0x5e, 0x23, 0x4e])[0];
  if (ld === undefined) return { refused: `coin records at ${hex(r.records[0]!)}: switch dispatcher not read` };
  const table = word(rom, word(rom, ld + 1));
  const u = find(rom, [0x3a, X, X, 0xe6, 0xc0, 0x06, X, 0xcb, 0x7f, 0x28, 0x08, 0x06, X, 0xcb, 0x77, 0x28, 0x02, 0x06, X])[0];
  let per = 1; const keys: number[] = [];
  if (u !== undefined) {
    keys.push(word(rom, u + 1));
    const at = word(rom, u + 1) - 0x8000;
    const v = at >= 0 && at < ram.length ? ram[at]! : 0;
    per = !(v & 0x80) ? rom[u + 6]! : !(v & 0x40) ? rom[u + 12]! : rom[u + 18]!;
  }
  if (!per) return { refused: 'coin records: no credits per unit' };
  const lines: CoinLine[] = []; const recordLines = new Map<number, number>();
  for (let i = 0; i < r.records.length; i++) {
    const rec = r.records[i]!;
    const line = recordLine(rom, table, 2, 0, 1, rom[rec]!);
    if (line < 0) return { refused: `coin record ${hex(rec)}: its switch is not one input line` };
    recordLines.set(rec, line);
    const units = rom[rec + 3]!;
    if (units > 0) { lines.push({ line, credits: units * per, change: [] }); continue; }
    const end = r.callEnds[i]!;
    const add = find(rom, [0x0e, X, 0xaf, 0x81, 0x10, 0xfd], end, Math.min(rom.length, end + 0x30))[0];
    if (rom[end] !== 0x30 || add === undefined) return { refused: `coin record ${hex(rec)} credits nothing and its token branch is not read` };
    lines.push({ line, credits: rom[add + 1]! * per, change: [], token: true });
  }
  return finish('B', lines, null, `Electrocoin coin records in 10p units at ${hex(r.records[0]!)}`, {
    kind: 'record', pcs: [r.take], recordLine: recordLines,
  }, keys, new Set(recordLines.values()));
}

const DEBOUNCE = [0xdd, 0x21, X, X, 0xfd, 0x21, X, X, 0x0e, 0x08, 0xdd, 0x7e, 0x00, 0xcb, 0x38, 0x17, 0xe6, 0x07];
const PROLOGUE = [0xf5, 0xc5, 0xdd, 0xe5, 0xfd, 0xe5, 0x06, 0x00];

function builderBits(rom: Uint8Array, ram: Uint8Array): { bits: Map<number, number[]> } | null {
  for (const head of find(rom, DEBOUNCE)) {
    const start = find(rom, PROLOGUE, Math.max(0, head - 0x100), head).pop();
    if (start === undefined) continue;
    const bits = new Map<number, number[]>();
    let ok = true;
    for (let line = 0; line < 64 && ok; line++) {
      const b = runBuilder(rom, ram, start, head, line);
      if (b === null) { ok = false; break; }
      for (let k = 0; k < 8; k++) if ((b >> k) & 1) bits.set(k, [...(bits.get(k) ?? []), line]);
    }
    if (ok && bits.size) return { bits };
  }
  return null;
}

function runBuilder(rom: Uint8Array, ram: Uint8Array, start: number, stop: number, line: number): number | null {
  const mem = new Uint8Array(0x10000);
  mem.set(rom.subarray(0, 0x8000));
  mem.set(ram.subarray(0, 0x2000), 0x8000);
  const cpu = new Z80(
    { read8: (a) => mem[a & 0xffff]!, write8: (a, v) => { if ((a & 0xffff) >= 0x8000) mem[a & 0xffff] = v; } },
    { in: (p) => ((p & 0xff) === line >> 3 ? ~(1 << (line & 7)) & 0xff : 0xff), out: () => {} },
  );
  cpu.pc = start;
  cpu.sp = 0xfff0;
  for (let n = 0; n < 2000; n++) {
    if (cpu.pc === stop) return cpu.b;
    cpu.step();
  }
  return null;
}

function readShapeC(rom: Uint8Array, ram: Uint8Array): EcoinCoinCode | Refusal | null {
  const add = find(rom, [0x19, 0x4e, 0x23, 0x46, 0x2a, X, X, 0x09, 0x22, X, X]).filter((a) => word(rom, a + 5) === word(rom, a + 9));
  if (!add.length) return null;
  const pc = add[0]! + 4;
  const idx = find(rom, [0x11, X, X, 0x3a, X, X, 0x6f, 0x17, 0x9f, 0x67, 0x44, 0x4d, 0x29, 0x29, 0x29, 0x09, 0x4d, 0x44, 0xdd, 0x7e, X], Math.max(0, pc - 0x40), pc).pop();
  if (idx === undefined) return { refused: `credit add at ${hex(pc)}: its value table is not read` };
  const table = word(rom, idx + 1);
  const varAt = word(rom, idx + 4) - 0x8000;
  const ixOff = rom[idx + 20]! - 0x100;
  if (varAt < 0 || varAt >= ram.length) return { refused: `value table ${hex(table)}: its row setting is not in battery RAM` };
  const row = ram[varAt]!;
  const built = builderBits(rom, ram);
  if (!built) return { refused: `value table ${hex(table)}: the coin input builder is not read` };
  const lines: CoinLine[] = []; const indexLines = new Map<number, number[]>(); const aliases = new Map<number, number>();
  for (const [bit, ls] of [...built.bits].sort((a, b) => a[0] - b[0])) {
    const col = bit + 1;
    const at = table + 2 * (row * 9 + col);
    if (col > 8 || at + 1 >= rom.length) continue;
    const pence = word(rom, at);
    if (!pence || pence === 0x39) continue;
    indexLines.set(col, ls);
    lines.push({ line: ls[0]!, credits: pence, change: [] });
    for (const l of ls) aliases.set(l, ls[0]!);
  }
  return finish('C', lines, 1, `Electrocoin coin value table in pence at ${hex(table)} (row ${row})`, {
    kind: 'index', pcs: [pc], ixOff, indexLines,
  }, [varAt + 0x8000], new Set([...built.bits.values()].flat()), aliases);
}

function readShapeD(rom: Uint8Array, ram: Uint8Array): EcoinCoinCode | Refusal | null {
  const at = find(rom, [0x35, 0x11, X, X, 0xdd, 0x7e, X, 0x6f, 0x17, 0x9f, 0x67, 0x29, 0x29, 0x19, 0x5e, 0x23, 0x56, 0x23, 0x7e, 0x23, 0x66, 0x6f, 0xe5, 0xd5, 0x11, X, X, 0x2a, X, X, 0x19, 0xcd])[0];
  if (at === undefined) return null;
  const table = word(rom, at + 2);
  const ixOff = rom[at + 6]! - 0x100;
  const money = word(rom, at + 25);
  const game = word(rom, at + 28);
  const pcs = find(rom, [0xe5, 0xd5, 0x11, money & 0xff, money >> 8, 0x2a, game & 0xff, game >> 8, 0x19, 0xcd], Math.max(0, at - 0x400), Math.min(rom.length, at + 0x100)).map((a) => a + 9);
  const fl = find(rom, [0x11, X, X, 0xdd, 0x7e, rom[at + 6]!, 0x6f, 0x17, 0x9f, 0x67, 0x19, 0x7e, 0xb7, 0x11, table & 0xff, table >> 8], at, Math.min(rom.length, at + 0x80))[0];
  if (fl === undefined) return { refused: `coin values at ${hex(table)}: the token flags are not read` };
  const flags = word(rom, fl + 1);
  const flag = (i: number): number => (flags < 0x8000 ? rom[flags + i] ?? 0 : ram[flags - 0x8000 + i] ?? 0);
  const built = builderBits(rom, ram);
  if (!built) return { refused: `coin values at ${hex(table)}: the coin input builder is not read` };
  const lines: CoinLine[] = []; const indexLines = new Map<number, number[]>(); const aliases = new Map<number, number>();
  for (const [bit, ls] of [...built.bits].sort((a, b) => a[0] - b[0])) {
    const i = bit + 1;
    const v = (rom[table + 4 * i]! | (rom[table + 4 * i + 1]! << 8) | (rom[table + 4 * i + 2]! << 16) | (rom[table + 4 * i + 3]! << 24)) >>> 0;
    if (!v || v % 100) continue;
    if (flag(i)) { lines.push({ line: ls[0]!, credits: 0, change: [], token: true }); continue; }
    indexLines.set(i, ls);
    for (const l of ls) aliases.set(l, ls[0]!);
    lines.push({ line: ls[0]!, credits: v / 100, change: [] });
  }
  return finish('D', lines, 1, `Electrocoin coin values in 1/100p at ${hex(table)}`, {
    kind: 'index', pcs, ixOff, indexLines,
  }, flags >= 0x8000 ? [flags] : [], new Set([...built.bits.values()].flat()), aliases);
}

function finish(
  shape: EcoinCoinCode['shape'], lines: CoinLine[], price: number | null, source: string, take: EcoinTake,
  keys: number[], reads: Set<number>, aliases?: Map<number, number>,
): EcoinCoinCode | Refusal {
  if (lines.filter((l) => l.credits > 0).length < 2) return { refused: `${source}: fewer than two coin lines` };
  const al = aliases ?? new Map(lines.map((l) => [l.line, l.line]));
  return { shape, table: { lines: lines.sort((a, b) => a.line - b.line), pricePerCredit: price, source }, aliases: al, reads, take, keys };
}

export function locateEcoinCoins(rom: Uint8Array, ram: Uint8Array): EcoinCoinCode | Refusal {
  for (const read of [readShapeA, readShapeB, readShapeC, readShapeD] as const) {
    const r = read(rom, ram);
    if (r) return r;
  }
  return { refused: 'no Electrocoin coin code found' };
}

export function ecoinProgramCoins(table: CoinLineTable): Map<number, SlotCoin> | null {
  const c = detectCoins(table);
  return c instanceof Map ? c : null;
}
