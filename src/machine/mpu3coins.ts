import type { ChangeTerm, CoinLine, CoinLineTable, Refusal } from './coinwiring';

export interface Mpu3Coin {
  id: number;
  credits: number;
  change: ChangeTerm[][];
  token: boolean;
  name?: string;
  tubeSwitch?: number;
}

export interface Mpu3CoinCode {
  shape: 'strobed' | 'records';
  take: number;
  credit: number;
  creditX?: number;
  strobeVar?: number;
  ptrVar?: number;
  table?: number;
  lineOfIndex?: (number | null)[];
  changeDipRow?: number;
  changeTable?: number;
  changeRawLine?: number;
  refillLine?: number;
  rows: number;
  strobed?: Mpu3Coin[];
  source: string;
}

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

const rdOf = (rom: Uint8Array) => (a: number): number => rom[0x8000 | (a & 0x7fff)]!;

function find(rom: Uint8Array, pat: readonly number[], from = 0x0800, to = 0x8000): number[] {
  const rd = rdOf(rom);
  const out: number[] = [];
  outer: for (let a = from; a + pat.length <= to; a++) {
    for (let i = 0; i < pat.length; i++) if (pat[i]! >= 0 && rd(a + i) !== pat[i]) continue outer;
    out.push(a);
  }
  return out;
}

const rel = (at: number, off: number): number => (at + 2 + ((off << 24) >> 24)) & 0x7fff;

function isBcdAdd(rom: Uint8Array, a: number): boolean {
  const rd = rdOf(rom);
  const want = [0x36, 0xab, 0x02, 0x19, 0xa7, 0x02, 0xa6, 0x01, 0x89, 0x00, 0x19, 0xa7, 0x01];
  return want.every((b, i) => rd(a + i) === b);
}

interface Walk { credits: number; counters: Map<number, number>; alt?: { line: number; credits: number } }

function walkBranch(rom: Uint8Array, start: number, rows: number, add: { at: number | null; x: number | null }, depth = 0): Walk | null {
  const rd = rdOf(rom);
  let pc = start & 0x7fff;
  let a: number | null = null;
  let x: number | null = null;
  const w: Walk = { credits: 0, counters: new Map() };
  const bump = (addr: number, n: number): void => { w.counters.set(addr, (w.counters.get(addr) ?? 0) + n); };
  for (let steps = 0; steps < 48; steps++) {
    const op = rd(pc);
    if (op === 0x7c && rd(pc + 1) === 0x00) { bump(rd(pc + 2), 1); pc += 3; continue; }
    if (op === 0x86) { a = rd(pc + 1); pc += 2; continue; }
    if (op === 0xce) { x = (rd(pc + 1) << 8) | rd(pc + 2); pc += 3; continue; }
    if (op === 0xb6) {
      const ea = (rd(pc + 1) << 8) | rd(pc + 2);
      if (ea < 0x0800 || (ea >= 0x8000 && ea < 0xb000)) return null;
      a = rd(ea); pc += 3; continue;
    }
    if (op === 0x2b || op === 0x2a) {
      if (a === null) return null;
      const neg = (a & 0x80) !== 0;
      pc = (op === 0x2b) === neg ? rel(pc, rd(pc + 1)) : pc + 2;
      continue;
    }
    if (op === 0x20) { pc = rel(pc, rd(pc + 1)); continue; }
    if (op === 0x96) {
      const dd = rd(pc + 1);
      if (rd(pc + 2) === 0x85 && (rd(pc + 4) === 0x26 || rd(pc + 4) === 0x27)) {
        const m = rd(pc + 3);
        const bit = Math.log2(m);
        if (dd < rows || dd > rows + 3 || !Number.isInteger(bit) || bit < 2 || depth > 0) return null;
        const line = (dd - rows) * 8 + bit - 2;
        const made = rd(pc + 4) === 0x26 ? rel(pc + 4, rd(pc + 5)) : pc + 6;
        const open = rd(pc + 4) === 0x26 ? pc + 6 : rel(pc + 4, rd(pc + 5));
        const alt = walkBranch(rom, made, rows, add, depth + 1);
        if (!alt) return null;
        w.alt = { line, credits: alt.credits };
        pc = open;
        continue;
      }
      if (rd(pc + 2) === 0x8b && rd(pc + 4) === 0x97 && rd(pc + 5) === dd) {
        bump(dd, rd(pc + 3)); a = null; pc += 6; continue;
      }
      return null;
    }
    if (op === 0x9b && rd(pc + 2) === 0x97 && rd(pc + 3) === rd(pc + 1)) {
      if (a === null) return null;
      bump(rd(pc + 1), a); a = null; pc += 4; continue;
    }
    if (op === 0xbd) {
      const t = ((rd(pc + 1) << 8) | rd(pc + 2)) & 0x7fff;
      if (!isBcdAdd(rom, t) || a === null || x === null) return null;
      if (add.at === null) { add.at = t; add.x = x; }
      if (add.at !== t || add.x !== x) return null;
      w.credits += a;
      pc += 3;
      continue;
    }
    if (op === 0x7e || op === 0x39) return w;
    return null;
  }
  return null;
}

function locateStrobed(rom: Uint8Array): Mpu3CoinCode | null {
  const rd = rdOf(rom);
  for (const at of find(rom, [0xb6, 0x90, 0x00])) {
    let p = at + 3;
    while (rd(p) === 0x7f) p += 3;
    if (rd(p) !== 0x84 || rd(p + 1) !== 0xfc || rd(p + 2) !== 0xa7) continue;
    const rows = rd(p + 3);
    p += 4;
    if (rd(p) !== 0xd6 || rd(p + 2) !== 0xc1 || rd(p + 3) !== 0x03 || rd(p + 4) !== 0x22 || rd(p + 6) !== 0xe6 || rd(p + 8) !== 0x48 || rd(p + 9) !== 0x24) continue;
    const strobeVar = rd(p + 1);
    const released = rel(p + 9, rd(p + 10));
    const r = released;
    if (rd(r) !== 0xc1 || rd(r + 1) !== 0x01 || rd(r + 2) !== 0x23 || rd(r + 4) !== 0xcb || rd(r + 5) !== 0x80 || rd(r + 6) !== 0x2b || rd(r + 8) !== 0xc1 || rd(r + 10) !== 0x22 || rd(r + 12) !== 0xbd) continue;
    const take = ((rd(r + 13) << 8) | rd(r + 14)) & 0x7fff;
    if (rd(take) !== 0xd6 || rd(take + 1) !== strobeVar) return null;
    let disp = -1;
    for (let q = take; q < take + 0x40; q++) {
      if (rd(q) === 0x5d && rd(q + 1) === 0x27 && rd(q + 3) === 0x5a && rd(q + 4) === 0x27 && rd(q + 6) === 0x5a && rd(q + 7) === 0x27 && rd(q + 9) === 0x5a && rd(q + 10) === 0x27) { disp = q; break; }
    }
    if (disp < 0) return null;
    const branches = [rel(disp + 1, rd(disp + 2)), rel(disp + 4, rd(disp + 5)), rel(disp + 7, rd(disp + 8)), rel(disp + 10, rd(disp + 11))];
    const add = { at: null as number | null, x: null as number | null };
    const walks = branches.map((b) => walkBranch(rom, b, rows, add));
    if (walks.some((w) => w === null) || add.at === null) return null;
    const credited = walks.filter((w) => w!.credits > 0) as Walk[];
    const common = [...(credited[0]?.counters.keys() ?? [])].filter((c) => credited.every((w) => w.counters.has(c)));
    if (common.length !== 1) return null;
    const coins: Mpu3Coin[] = [];
    walks.forEach((w, strobe) => {
      if (!w || w.credits <= 0) return;
      const value = w.counters.get(common[0]!) ?? 0;
      const bulk = [...w.counters].some(([c, n]) => c !== common[0] && n > 1);
      if (value !== w.credits || bulk) return;
      coins.push({ id: 0x100 | (strobe * 8 + 5), credits: w.credits, change: [], token: false, ...(w.alt && w.alt.credits === 0 ? { tubeSwitch: w.alt.line } : {}) });
    });
    if (!coins.length) return null;
    return {
      shape: 'strobed', take, credit: add.at, creditX: add.x!, strobeVar, rows, strobed: coins,
      source: `MPU3 strobed coin inputs, coin routine ${hex(take)}`,
    };
  }
  return null;
}

function locateRecords(rom: Uint8Array): Mpu3CoinCode | null {
  const rd = rdOf(rom);
  let rows = -1;
  for (const at of find(rom, [0xb6, 0x90, 0x00, 0x84, 0xfd, 0xa7, 0x00])) {
    for (let q = at - 16; q < at; q++) if (rd(q) === 0x86 && rd(q + 2) === 0xd6 && rd(q + 4) === 0x1b) { rows = rd(q + 1); break; }
    if (rows >= 0) break;
  }
  if (rows < 0) return null;
  const hits = find(rom, [0xce, -1, -1, 0xdf, -1, 0x7f, 0x00, -1, 0xbd, -1, -1, 0x84, 0x03, 0x46, 0x46, 0x46, 0xf6, 0xa8, 0x02, 0xc4, 0x0f, 0x1b]);
  if (hits.length !== 1) return null;
  const h = hits[0]!;
  const table = (rd(h + 1) << 8) | rd(h + 2);
  const ptrVar = rd(h + 4);
  const fold = ((rd(h + 9) << 8) | rd(h + 10)) & 0x7fff;
  const f = [0x37, 0x96, -1, 0xd6, -1, 0x54, 0x54, 0xc4, 0x03, 0x1b, 0x33, 0x39];
  if (!f.every((b, i) => b < 0 || rd(fold + i) === b)) return null;
  const r2 = rd(fold + 2) - rows;
  const r3 = rd(fold + 4) - rows;
  if (r2 < 0 || r2 > 3 || r3 < 0 || r3 > 3) return null;
  const lineOfIndex: (number | null)[] = [r3 * 8 + 1, r3 * 8, null, null, 43, 42, 41, 40];
  const rels = find(rom, [0x6f, 0x00, 0xc1, -1, 0x22, -1, 0xdf, -1, 0xde, ptrVar], h, h + 0x100);
  if (rels.length !== 1) return null;
  const take = rels[0]! + 6;
  const adds = find(rom, [0x9b, -1, 0x19, 0x97], take, take + 0x80).filter((q) => rd(q + 4) === rd(q + 1));
  if (adds.length !== 1) return null;
  const credit = adds[0]!;
  const need = [[0xa6, 0x08, 0x81, 0x80, 0x26], [0xe6, 0x10, 0x26], [0xa6, 0x18, 0x27], [0xe6, 0x00, 0x5d, 0x27]];
  for (const n of need) if (find(rom, n, h, h + 0x100).length === 0) return null;
  const refill = find(rom, [0xc5, -1, 0x27, -1, 0xe6, 0x10, 0x26], take, take + 0x20);
  if (refill.length !== 1) return null;
  const refillBit = Math.log2(rd(refill[0]! + 1));
  if (!Number.isInteger(refillBit) || refillBit < 2) return null;
  const sp = find(rom, [0xc6, 0x05, 0x17, 0x7d, 0x00, -1, 0x2b, 0x02, 0x4f, 0x58, 0x36, 0xbd, -1, -1, 0x85, -1, 0x26, -1, 0x96, -1, 0x84, 0xc0, 0xd6, -1, 0x54, 0xc4, 0x20, 0x1b, 0xce], take, take + 0x80);
  if (sp.length !== 1) return null;
  const s = sp[0]!;
  const dipVar = rd(s + 5);
  if (rd(s + 19) !== dipVar) return null;
  const changeDipRow = dipVar - rows;
  const rawBit = Math.log2(rd(s + 15));
  if (!Number.isInteger(rawBit) || rawBit < 2) return null;
  const changeTable = (rd(s + 29) << 8) | rd(s + 30);
  return {
    shape: 'records', take, credit, ptrVar, table, lineOfIndex, rows,
    changeDipRow, changeTable, changeRawLine: r2 * 8 + rawBit - 2, refillLine: r2 * 8 + refillBit - 2,
    source: `MPU3 coin records ${hex(table)}`,
  };
}

export function locateMpu3Coins(rom: Uint8Array): Mpu3CoinCode | Refusal {
  return locateStrobed(rom) ?? locateRecords(rom) ?? { refused: 'no MPU3 coin reader this build can read was found in the program' };
}

export function mpu3Message(rom: Uint8Array, code: number): string | null {
  const rd = rdOf(rom);
  const r = find(rom, [0xfe, -1, -1, 0x36, 0x08, 0x6d, 0x00, 0x26, 0xfb, 0x4a, 0x26, 0xf8, 0x09]);
  if (r.length !== 1 || code <= 0) return null;
  const ptr = (rd(r[0]! + 1) << 8) | rd(r[0]! + 2);
  let x = (rd(ptr) << 8) | rd(ptr + 1);
  for (let n = code; n > 0; n--) {
    let guard = 0;
    do { x++; if (++guard > 0x400) return null; } while (rd(x) !== 0);
  }
  return String.fromCharCode(...Array.from({ length: 16 }, (_, i) => rd(x - 16 + i)));
}

export function mpu3Coins(code: Mpu3CoinCode, rom: Uint8Array, rowRaw: (strobe: number) => number): Mpu3Coin[] | null {
  if (code.shape === 'strobed') return code.strobed!;
  const rd = rdOf(rom);
  const out: Mpu3Coin[] = [];
  for (let i = 0; i < 8; i++) {
    const meter = rd(code.table! + i);
    let credits = rd(code.table! + 8 + i);
    const refill = rd(code.table! + 0x10 + i);
    const alarm = rd(code.table! + 0x18 + i);
    const line = code.lineOfIndex![i];
    if (line === null || line === undefined) {
      if (credits !== 0) return null;
      continue;
    }
    if (credits === 0 && meter === 0) continue;
    let change: ChangeTerm[][] = [];
    if (credits === 0x80) {
      const dip = rowRaw(code.changeDipRow!) & 0xfd;
      const on = (dip & 0x80) !== 0;
      credits = on ? 5 : 0;
      const tens = on ? 5 : 10;
      change = [[{ count: tens, pence: 10 }]];
      for (const big of [0, 1]) {
        const v = rd(code.changeTable! + (((dip & 0xc0) + (big ? 0x20 : 0)) >> 5));
        change.push([{ count: v & 0x1f, pence: 10 }, { count: v >> 5, pence: big ? 50 : 20 }]);
      }
      const val = (alt: ChangeTerm[]): number => alt.reduce((s, t) => s + t.count * (t.pence ?? 0), 0);
      if (change.some((alt) => val(alt) !== tens * 10)) return null;
    }
    const name = mpu3Message(rom, alarm)?.trim() ?? undefined;
    out.push({
      id: 0x100 | line, credits, change, token: !!name && /\bTOKEN\b/.test(name),
      ...(name ? { name } : {}),
      ...(refill ? { tubeSwitch: code.refillLine! } : {}),
    });
  }
  return out;
}

export interface Mpu3Payout {
  triacs: number;
  meter: number;
  units: number;
  meterBits: number;
}

export function mpu3Payouts(rom: Uint8Array): Mpu3Payout[] | null {
  const rd = rdOf(rom);
  const tab = find(rom, [0x96, -1, 0x8b, -1, 0x97, -1, 0x86, -1, 0x89, 0x00, 0x97, -1, 0xde, -1, 0x96, -1, 0x26]);
  const cnt = find(rom, [0xce, -1, -1, 0x08, 0x80, 0x03, 0x24, 0xfb]);
  const pat = find(rom, [0x96, -1, 0x8b, -1, 0x97, -1, 0x96, -1, 0x89, -1, 0x97, -1, 0xde, -1, 0x39]);
  if (tab.length !== 1 || cnt.length !== 1 || pat.length !== 1) return null;
  const base = (rd(tab[0]! + 7) << 8) + rd(tab[0]! + 3);
  const counters = ((rd(cnt[0]! + 1) << 8) | rd(cnt[0]! + 2)) + 1;
  const offset = (rd(pat[0]! + 9) << 8) | rd(pat[0]! + 3);
  const out: Mpu3Payout[] = [];
  for (let i = 0; i < 4; i++) {
    const meter = rd(base + 4 + i);
    const p = rd((counters + Math.floor(meter / 3) + offset) & 0xffff);
    out.push({ triacs: rd(base + i), meter, units: rd(base + 8 + i), meterBits: p & 0x80 ? 0 : ~p & 0x3f });
  }
  return out;
}

export function mpu3CoinTable(code: Mpu3CoinCode, coins: readonly Mpu3Coin[]): CoinLineTable {
  const lines: CoinLine[] = coins.map((c) => ({ line: c.id, credits: c.credits, change: c.change, ...(c.token ? { token: true } : {}) }));
  return { lines, pricePerCredit: null, source: code.source };
}
