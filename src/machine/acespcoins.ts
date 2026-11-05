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
  maskColumn: number | null;
  block: AceSpFlag | null;
  refill: AceSpFlag;
  refillColumn: Column;
  coinColumn: Column;
  bank: number;
  slots: number;
  events: number;
  op8AddsWord?: boolean;
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

function flagTest(mem: AceSpMem, a: number, branch: number): { flag: AceSpFlag; next: number } | null {
  if (mem(a) === 0xbd && mem(a + 4) === branch) {
    const flag = flagOf(mem, w16(mem, a + 1), mem(a + 3));
    return flag ? { flag, next: a + 6 } : null;
  }
  if (mem(a) === 0x7b && mem(a + 3) === branch) return { flag: { byte: mem(a + 2), mask: mem(a + 1) }, next: a + 5 };
  return null;
}

const rel8 = (mem: AceSpMem, a: number): number => a + 1 + ((mem(a) ^ 0x80) - 0x80);

function postAfterCompares(mem: AceSpMem, a: number): number | null {
  const seen = new Set<number>();
  const todo = [a];
  let post: number | null = null;
  while (todo.length) {
    const pc = todo.pop()!;
    if (seen.has(pc)) continue;
    if (seen.size > 32) return null;
    seen.add(pc);
    const op = mem(pc);
    if (op === 0x81) todo.push(pc + 2);
    else if (op === 0x26 || op === 0x27) todo.push(rel8(mem, pc + 1), pc + 2);
    else if (op === 0x20) todo.push(rel8(mem, pc + 1));
    else if (op === 0xbd) {
      const to = w16(mem, pc + 1);
      if (post !== null && post !== to) return null;
      post = to;
    } else return null;
  }
  return post;
}

const SCAN = [0xce, -1, -1, 0xdf, -1, 0xce, -1, -1, 0xe6, 0x00, 0x26, 0x08, 0x85, 0x01, 0x27, -1, 0x6c, 0x00, 0x20, -1, 0x85, 0x01, 0x27, -1, 0xc1, 0x08, 0x23, 0xf4];

const OLD_SCAN = [0xce, -1, -1, 0x96, -1, 0x6d, 0x00, 0x27, -1, 0x6f, 0x00, 0x85, 0x01, 0x27, 0x06, 0xbd, -1, -1, -1, 0x20, -1,
  0x18, 0x83, -1, -1, 0xc3, -1, -1, 0x18, 0x7b, -1, -1, 0x27, 0x08, 0xe6, -1, 0xbd, -1, -1, -1, 0x20, 0x06, 0xe6, -1, 0xbd, -1, -1, -1, 0x17, 0x27, 0x03, 0xbd];

function postOf(mem: AceSpMem, post: number): { bank: number; slots: number; events: number } | Refusal {
  if (!at(mem, post, [0x36, 0x37, 0x3c, 0x16, 0x5a, 0xc1, -1, 0x24, -1, 0xce, -1, -1, 0x3a, 0x3a])) return { refused: 'the coin event post was not read' };
  const slots = mem(post + 6);
  const bank = w16(mem, post + 10);
  let events = 0;
  for (let a = 0x2002; a < 0xfff0 && !events; a++) {
    if (at(mem, a, [0x37, 0x36, 0x30, 0x05, 0xe3, 0x00, 0xc3]) && mem(a - 3) === 0x83 && w16(mem, a - 2) === bank) events = w16(mem, a + 7);
  }
  if (!events) return { refused: 'the event table was not found' };
  return { bank, slots, events };
}

function op8AddsWord(mem: AceSpMem): boolean {
  const BODY = [0x30, 0xee, 0x02, 0xe6, 0x00, 0x37, 0x36, 0xec, 0x01, 0x08, 0x08, 0x08, 0xff, -1, -1, 0x38, 0x18, 0xbd];
  for (let a = 0x2000; a < 0xfff0; a++) {
    if (at(mem, a, [0xce, -1, -1, 0x3a, 0x3a, 0xee, 0x00, 0x3c, 0x39]) && at(mem, w16(mem, w16(mem, a + 1) + 14), BODY)) return true;
  }
  return false;
}

function locateOldScan(mem: AceSpMem): AceSpCoinCode | Refusal | null {
  const found: number[] = [];
  for (let a = 0x2000; a < 0xffe0; a++) if (at(mem, a, OLD_SCAN)) found.push(a);
  if (!found.length) return null;
  if (found.length > 1) return { refused: 'the program has two coin scans' };
  const r = found[0]!;
  const counters = w16(mem, r + 1);
  if (w16(mem, r + 23) !== counters) return { refused: 'the coin scan\'s release was not read' };
  const next = rel8(mem, r + 8);
  if (!at(mem, next, [0x08, 0x44, 0x8c])) return { refused: 'the coin scan\'s line count was not read' };
  const lines = w16(mem, next + 3) - counters;
  if (lines < 4 || lines > 8) return { refused: 'the coin scan\'s line count was not read' };
  const p = postOf(mem, w16(mem, r + 52));
  if ('refused' in p) return p;
  return {
    routine: r, table: w16(mem, r + 26), counters, lines,
    inhibit: mem(r + 4), maskColumn: null, block: null,
    refill: { byte: mem(r + 31), mask: mem(r + 30) },
    refillColumn: { off: mem(r + 35) }, coinColumn: { off: mem(r + 43) },
    op8AddsWord: op8AddsWord(mem),
    ...p,
  };
}

export function locateAceSpCoins(mem: AceSpMem): AceSpCoinCode | Refusal {
  const found: number[] = [];
  for (let a = 0x2000; a < 0xffe0; a++) if (at(mem, a, SCAN)) found.push(a);
  if (!found.length) return locateOldScan(mem) ?? { refused: 'the program\'s coin scan was not found' };
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
  const REL = [0x6f, 0x00, 0xc1, -1, 0x22, -1, 0xdf, -1, 0x36, 0xde, tp, 0x96, -1, 0xa4, -1, 0x26, -1];
  if (!at(mem, rel, REL) || (mem(rel + 3) !== 8 && mem(rel + 3) !== 9)) return { refused: 'the coin scan\'s release was not read' };
  const inhibit = mem(rel + 12);
  const maskColumn = mem(rel + 14);
  const STAMP = [0x86, -1, 0xb7, -1, -1, 0x7c, -1, -1];
  let pc = rel + 17;
  let block: AceSpFlag | null = null;
  if (!at(mem, pc, STAMP)) {
    const t = flagTest(mem, pc, 0x26);
    if (!t) return { refused: 'the coin scan\'s flag tests were not read' };
    block = t.flag;
    pc = t.next;
    if (!at(mem, pc, STAMP)) return { refused: 'the coin scan\'s release was not read' };
  }
  const key = flagTest(mem, pc + STAMP.length, 0x27);
  if (!key) return { refused: 'the coin scan\'s flag tests were not read' };
  const refill = key.flag;
  const pick = key.next;
  let refillColumn: Column; let coinColumn: Column; let post: number;
  if (at(mem, pick, [0xa6, -1, 0x26, -1, 0xa6, -1, 0x27, -1])) {
    refillColumn = { off: mem(pick + 1) };
    coinColumn = { off: mem(pick + 5) };
    const toPost = rel8(mem, pick + 3);
    const onward = postAfterCompares(mem, pick + 8);
    if (mem(toPost) !== 0xbd || onward === null || onward !== w16(mem, toPost + 1)) return { refused: 'the coin scan\'s coin column was not read' };
    post = onward;
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
  const p = postOf(mem, post);
  if ('refused' in p) return p;
  return { routine: r, table, counters, lines, inhibit, maskColumn, block, refill, refillColumn, coinColumn, ...p };
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
    else if (op === 8 && !code.op8AddsWord) posted.push(mem(p + 3) - 1);
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
  const gate = code.maskColumn === null ? 1 << k : mem(code.table + code.maskColumn + k);
  if (mem(code.inhibit) & gate) return 'locked';
  if (code.block && mem(code.block.byte) & code.block.mask) return 'locked';
  const slot = slotOf(code, mem, k, (mem(code.refill.byte) & code.refill.mask) !== 0);
  if (slot < 0) return 0;
  return aceSpEvent(code, mem, slot)?.credits ?? null;
}

export function aceSpCounter(code: AceSpCoinCode, line: number): number {
  const k = ACESP_PROGRAM_LINE_TO_MECH.indexOf(line);
  return k < 0 || k >= code.lines ? -1 : code.counters + k;
}
