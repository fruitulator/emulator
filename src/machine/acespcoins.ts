import type { CoinLine, CoinLineTable, Refusal } from './coinwiring';

export type AceSpMem = (a: number) => number;

export interface AceSpFlag { byte: number; mask: number }

type Column = { off: number } | { byte: number; eq: number; ifEq: number; ifNot: number };

export interface AceSpCoinCode {
  routine: number;
  table: number;
  counters: number;
  lines: number;
  inhibit: number;
  maskColumn: number;
  block: AceSpFlag;
  refill: AceSpFlag;
  refillColumn: Column;
  coinColumn: Column;
  bank: number;
  slots: number;
  events: number;
}

export const ACESP_PROGRAM_LINE_TO_MECH: readonly (number | undefined)[] = [3, 2, 1, 0, 4];

const OP_LEN: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 3, 5: 3, 6: 7, 7: 4, 8: 4 };

const w16 = (mem: AceSpMem, a: number): number => (mem(a) << 8) | mem(a + 1);

function at(mem: AceSpMem, a: number, pat: readonly number[]): boolean {
  for (let i = 0; i < pat.length; i++) if (pat[i]! >= 0 && mem(a + i) !== pat[i]) return false;
  return true;
}

function flagRoutine(mem: AceSpMem, a: number): { bits: number; base: number } | null {
  const HEAD = [0x36, 0x37, 0x3c, 0x30, 0xee, 0x04, 0xe6, 0x00, 0x30, 0x6c, 0x05, 0x26, 0x02, 0x6c, 0x04, 0x5a, 0x17, 0x44, 0x44, 0x44, 0xce, -1, -1, 0xc4, 0x07, 0x3a, 0x16, 0xa6, 0x00, 0xce, -1, -1, 0x3a, 0x16, 0xe5, 0x00];
  if (!at(mem, a, HEAD)) return null;
  return { bits: w16(mem, a + 21), base: w16(mem, a + 30) };
}

function flagOf(mem: AceSpMem, routine: number, code: number): AceSpFlag | null {
  const r = flagRoutine(mem, routine);
  if (!r || code < 1) return null;
  return { byte: r.base + ((code - 1) >> 3), mask: mem(r.bits + ((code - 1) & 7)) };
}

const SCAN = [0xce, -1, -1, 0xdf, -1, 0xce, -1, -1, 0xe6, 0x00, 0x26, 0x08, 0x85, 0x01, 0x27, -1, 0x6c, 0x00, 0x20, -1, 0x85, 0x01, 0x27, -1, 0xc1, 0x08, 0x23, 0xf4];

export function locateAceSpCoins(mem: AceSpMem): AceSpCoinCode | Refusal {
  const found: number[] = [];
  for (let a = 0x2000; a < 0xffe0; a++) if (at(mem, a, SCAN)) found.push(a);
  if (!found.length) return { refused: 'the program\'s coin scan was not found' };
  if (found.length > 1) return { refused: 'the program has two coin scans' };
  const r = found[0]!;
  const table = w16(mem, r + 1);
  const tp = mem(r + 4);
  const counters = w16(mem, r + 6);
  const loop = r + 8;
  let lines = 0;
  for (let a = r; a < r + 0x180 && !lines; a++) {
    if (at(mem, a, [0x08, 0x8c, -1, -1, 0x27, 0x04, 0x44, 0x7e]) && w16(mem, a + 8) === loop) lines = w16(mem, a + 2) - counters;
  }
  if (lines < 5 || lines > 8) return { refused: 'the coin scan\'s line count was not read' };
  const rel = r + 23 + 1 + (((mem(r + 23) ^ 0x80) - 0x80));
  const REL = [0x6f, 0x00, 0xc1, 0x09, 0x22, -1, 0xdf, -1, 0x36, 0xde, tp, 0x96, -1, 0xa4, -1, 0x26, -1, 0xbd, -1, -1, -1, 0x26, -1, 0x86, -1, 0xb7, -1, -1, 0x7c, -1, -1, 0xbd, -1, -1, -1, 0x27, -1];
  if (!at(mem, rel, REL)) return { refused: 'the coin scan\'s release was not read' };
  const inhibit = mem(rel + 12);
  const maskColumn = mem(rel + 14);
  const block = flagOf(mem, w16(mem, rel + 18), mem(rel + 20));
  const refill = flagOf(mem, w16(mem, rel + 32), mem(rel + 34));
  if (!block || !refill) return { refused: 'the coin scan\'s flag tests were not read' };
  const pick = rel + 37;
  let refillColumn: Column; let coinColumn: Column; let post: number;
  if (at(mem, pick, [0xa6, -1, 0x26, 0x04, 0xa6, -1, 0x27, 0x03, 0xbd])) {
    refillColumn = { off: mem(pick + 1) };
    coinColumn = { off: mem(pick + 5) };
    post = w16(mem, pick + 9);
  } else if (at(mem, pick, [0xb6, -1, -1, 0x81, -1, 0x27, 0x04, 0xa6, -1, 0x20, 0x02, 0xa6, -1, 0x26, -1,
    0xb6, -1, -1, 0x81, -1, 0x27, 0x04, 0xa6, -1, 0x20, 0x02, 0xa6, -1, 0x27, 0x03, 0xbd])
    && w16(mem, pick + 1) === w16(mem, pick + 16) && mem(pick + 4) === mem(pick + 19)) {
    const byte = w16(mem, pick + 1); const eq = mem(pick + 4);
    refillColumn = { byte, eq, ifEq: mem(pick + 12), ifNot: mem(pick + 8) };
    coinColumn = { byte, eq, ifEq: mem(pick + 27), ifNot: mem(pick + 23) };
    post = w16(mem, pick + 31);
  } else {
    return { refused: 'the coin scan\'s coin column was not read' };
  }
  if (!at(mem, post, [0x36, 0x37, 0x3c, 0x16, 0x5a, 0xc1, -1, 0x24, -1, 0xce, -1, -1, 0x3a, 0x3a])) return { refused: 'the coin event post was not read' };
  const slots = mem(post + 6);
  const bank = w16(mem, post + 10);
  let events = 0;
  for (let a = 0x2002; a < 0xfff0 && !events; a++) {
    if (at(mem, a, [0x37, 0x36, 0x30, 0x05, 0xe3, 0x00, 0xc3]) && mem(a - 3) === 0x83 && w16(mem, a - 2) === bank) events = w16(mem, a + 7);
  }
  if (!events) return { refused: 'the event table was not found' };
  return { routine: r, table, counters, lines, inhibit, maskColumn, block, refill, refillColumn, coinColumn, bank, slots, events };
}

function columnOf(c: Column, mem: AceSpMem): number {
  return 'off' in c ? c.off : mem(c.byte) === c.eq ? c.ifEq : c.ifNot;
}

export interface AceSpEvent { credits: number; cashIn: boolean; tokenIn: boolean }

export function aceSpEvent(code: AceSpCoinCode, mem: AceSpMem, slot: number, depth = 0): AceSpEvent | null {
  if (slot < 0 || slot >= code.slots) return null;
  const script = w16(mem, code.events + 6 * slot + 2);
  const out: AceSpEvent = { credits: 0, cashIn: false, tokenIn: false };
  if (script === 0) return out;
  const posted: number[] = [];
  let p = script;
  for (let n = 0; ; n++) {
    const op = mem(p);
    if (op === 0) break;
    const len = OP_LEN[op];
    if (!len || n > 40) return null;
    if (op === 1) out.credits += ((mem(p + 1) ^ 0x80) - 0x80);
    else if (op === 4) {
      if (mem(p + 2) === 1) out.cashIn = true;
      if (mem(p + 2) === 3) out.tokenIn = true;
    } else if (op === 5) posted.push(mem(p + 2) - 1);
    else if (op === 8) posted.push(mem(p + 3) - 1);
    p += len;
  }
  for (const s of posted) {
    if (depth > 2) return null;
    const e = aceSpEvent(code, mem, s, depth + 1);
    if (!e || e.credits !== 0) return null;
  }
  return out;
}

function slotOf(code: AceSpCoinCode, mem: AceSpMem, k: number, refill: boolean): number {
  if (refill) {
    const a = mem(code.table + columnOf(code.refillColumn, mem) + k);
    if (a) return a - 1;
  }
  const a = mem(code.table + columnOf(code.coinColumn, mem) + k);
  return a ? a - 1 : -1;
}

export function aceSpCoinTable(code: AceSpCoinCode, mem: AceSpMem): CoinLineTable | Refusal {
  const lines: CoinLine[] = [];
  for (let k = 0; k < code.lines; k++) {
    const line = ACESP_PROGRAM_LINE_TO_MECH[k];
    if (line === undefined) continue;
    const slot = slotOf(code, mem, k, false);
    if (slot < 0) continue;
    const e = aceSpEvent(code, mem, slot);
    if (!e) return { refused: 'a coin event\'s script was not read' };
    if (e.credits <= 0) continue;
    const token = e.tokenIn && !e.cashIn;
    lines.push({ line, credits: e.credits, change: [], ...(token ? { token: true } : {}) });
  }
  if (!lines.length) return { refused: 'the coin table credits no line' };
  return { lines: lines.sort((a, b) => a.line - b.line), pricePerCredit: null, source: `sp.ACE coin scan $${code.routine.toString(16).toUpperCase()}` };
}

export function aceSpVerdict(code: AceSpCoinCode, mem: AceSpMem, line: number): number | 'locked' | null {
  const k = ACESP_PROGRAM_LINE_TO_MECH.indexOf(line);
  if (k < 0 || k >= code.lines) return null;
  if (mem(code.inhibit) & mem(code.table + code.maskColumn + k)) return 'locked';
  if (mem(code.block.byte) & code.block.mask) return 'locked';
  const slot = slotOf(code, mem, k, (mem(code.refill.byte) & code.refill.mask) !== 0);
  if (slot < 0) return 0;
  return aceSpEvent(code, mem, slot)?.credits ?? null;
}

export function aceSpCounter(code: AceSpCoinCode, line: number): number {
  const k = ACESP_PROGRAM_LINE_TO_MECH.indexOf(line);
  return k < 0 || k >= code.lines ? -1 : code.counters + k;
}
