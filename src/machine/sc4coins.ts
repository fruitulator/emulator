import type { CoinLine, CoinLineTable, Refusal } from './coinwiring';

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

export const SC4_COIN_LINES = 6;
const CODE_END = 0x100000;
const RAM_BASE = 0x800000;
const STRIDE = 82;

export interface Sc4Select {
  binary: number;
  handlers: number[];
}

export type Sc4CoinTables =
  | { form: 'records'; base: number; count: number; countAt: number; coded: number; parallel: number; select: Sc4Select }
  | { form: 'list'; list: number; next: number; sw: number; codes: number | null; select: Sc4Select | null };

export type Sc4ProgramCoin = { pence: number; token: boolean } | 'refused' | null;

export interface Sc4Mem { w(a: number): number; l(a: number): number }

export function romMem(rom: Uint8Array, ram?: Uint8Array | null): Sc4Mem {
  const b = (a: number): number => (a >= RAM_BASE ? (ram?.[a - RAM_BASE] ?? 0) : (rom[a] ?? 0));
  const w = (a: number): number => (b(a) << 8) | b(a + 1);
  return { w, l: (a) => ((w(a) << 16) | w(a + 2)) >>> 0 };
}

const isRecordsTable = (r: Sc4Mem, x: number, kind: 'parallel' | 'coded'): boolean => {
  if (r.w(x) !== 0xfffe) return false;
  if (kind === 'parallel') return r.w(x + 2) < 0x40 && [2, 4, 8, 32].filter((i) => r.w(x + 2 * i) < 0x40).length >= 3;
  return r.w(x + 2) === 0xfffb && r.w(x + 2 * 0x1a) < 0x40;
};

const tstRam = (r: Sc4Mem, a: number): number | null =>
  r.w(a) === 0x4a79 && r.w(a + 2) === 0x0080 ? RAM_BASE | r.w(a + 4) : null;

function locateRecords(rom: Uint8Array): Sc4CoinTables | Refusal {
  const r = romMem(rom);
  const end = Math.min(rom.length, CODE_END) - 0x90;
  const parRefs: [number, number][] = [];
  const codedRefs: [number, number][] = [];
  for (let a = 0; a < end; a += 2) {
    if ((r.w(a) & 0xf1ff) !== 0x207c) continue;
    const x = r.l(a + 2);
    if (x >= end) continue;
    if (isRecordsTable(r, x, 'parallel')) parRefs.push([a, x]);
    else if (isRecordsTable(r, x, 'coded')) codedRefs.push([a, x]);
  }
  let found: { coded: number; parallel: number; binary: number; handlers: number[] } | null = null;
  for (const [ac, c] of codedRefs) {
    for (const [ap, p] of parRefs) {
      if (Math.abs(ac - ap) > 0x30) continue;
      const lo = Math.min(ac, ap);
      for (let b = lo - 2; b >= lo - 0x30; b -= 2) {
        const flag = tstRam(r, b);
        if (flag === null) continue;
        const handlers: number[] = [];
        if (r.w(b + 6) === 0x6608 && r.w(b + 8) === 0x200b && r.w(b + 10) === 0x6604 && r.w(b + 12) === 0x200a) {
          for (let k = b - 2; k >= b - 0x40; k -= 2) {
            if ((r.w(k) === 0x2679 || r.w(k) === 0x2479) && r.w(k + 2) === 0x0080) handlers.push(RAM_BASE | r.w(k + 4));
          }
          if (handlers.length !== 2) continue;
        }
        if (found && (found.coded !== c || found.parallel !== p || found.binary !== flag)) {
          if (found.coded !== c || found.parallel !== p) return { refused: 'Scorpion 4 coin tables: two dispatchers name different tables' };
          if (found.binary !== flag) return { refused: 'Scorpion 4 coin tables: two dispatchers test different flags' };
        }
        if (!found || handlers.length) found = { coded: c, parallel: p, binary: flag, handlers };
        break;
      }
    }
  }
  if (!found) return { refused: 'no Scorpion 4 coin dispatcher found' };
  const countAt = found.coded - 4;
  const count = r.w(countAt);
  if (count < 1 || count > 32 || r.w(countAt + 2) !== 0) return { refused: `Scorpion 4 coin tables: no record count before ${hex(found.coded)}` };
  let compared = false;
  for (let a = 0; a < end && !compared; a += 2) if ((r.w(a) & 0xf1ff) === 0xb079 && r.l(a + 2) === countAt) compared = true;
  if (!compared) return { refused: `Scorpion 4 coin tables: nothing compares against the count at ${hex(countAt)}` };
  const bases = new Set<number>();
  for (let a = 10; a < end; a += 2) {
    if ((r.w(a) & 0xf1ff) !== 0x207c || (r.w(a + 6) & 0xf03f) !== 0x2030 || (r.w(a + 8) !== 0x0800 && r.w(a + 8) !== 0)) continue;
    const x82 = (r.w(a - 10) === 0xe588 && r.w(a - 8) === 0xd081 && r.w(a - 6) === 0xe788 && r.w(a - 4) === 0xd081 && r.w(a - 2) === 0xd080)
      || (r.w(a - 4) === 0xc0fc && r.w(a - 2) === STRIDE);
    if (x82) bases.add(r.l(a + 2));
  }
  const inRom = countAt - STRIDE * count;
  const ram = [...bases].filter((b) => b >= RAM_BASE);
  const base = bases.has(inRom) ? inRom : ram.length === 1 ? ram[0]! : null;
  if (base === null) return { refused: 'Scorpion 4 coin tables: the coin records were not found' };
  return { form: 'records', base, count, countAt, coded: found.coded, parallel: found.parallel, select: { binary: found.binary, handlers: found.handlers } };
}

function locateList(rom: Uint8Array): Sc4CoinTables | Refusal {
  const r = romMem(rom);
  const end = Math.min(rom.length, CODE_END) - 0x40;
  let at: { list: number; next: number; sw: number } | null = null;
  for (let a = 0; a < end; a += 2) {
    if (r.w(a) !== 0x48c0 || r.w(a + 2) !== 0xe588 || r.w(a + 4) !== 0x207c || r.w(a + 10) !== 0x2470 || r.w(a + 12) !== 0x0800
      || r.w(a + 14) !== 0x6004 || r.w(a + 16) !== 0x246a || r.w(a + 20) !== 0x4aaa || r.w(a + 26) !== 0x4aaa) continue;
    const here = { list: r.l(a + 6), next: r.w(a + 18), sw: r.w(a + 28) };
    if (at && (at.list !== here.list || at.next !== here.next)) return { refused: 'Scorpion 4 coin list: two walkers name different lists' };
    at = here;
  }
  if (!at) return { refused: 'no Scorpion 4 coin list found' };
  let codes: number | null = null;
  let binary: number | null = null;
  for (let a = 0; a < end; a += 2) {
    const flag = tstRam(r, a);
    if (flag === null || (r.w(a + 6) & 0xff00) !== 0x6700 || r.w(a + 10) !== 0x0240 || r.w(a + 12) !== 0x001f
      || r.w(a + 14) !== 0xd040 || (r.w(a + 16) & 0xf1ff) !== 0x207c) continue;
    codes = r.l(a + 18);
    binary = flag;
    break;
  }
  return { form: 'list', ...at, codes, select: binary === null ? null : { binary, handlers: [] } };
}

export function locateSc4CoinTables(rom: Uint8Array): Sc4CoinTables | Refusal {
  const rec = locateRecords(rom);
  if (!('refused' in rec)) return rec;
  const list = locateList(rom);
  if (!('refused' in list)) return list;
  return { refused: 'no Scorpion 4 coin table this reader knows (neither coin records nor a coin list)' };
}

function coded(sel: Sc4Select | null, mem: Sc4Mem): boolean {
  if (!sel) return false;
  return mem.w(sel.binary) !== 0 || sel.handlers.some((h) => mem.l(h) !== 0);
}

const recordsCoin = (t: Extract<Sc4CoinTables, { form: 'records' }>, mem: Sc4Mem, idx: number): Sc4ProgramCoin => {
  if (idx >= t.count) return 'refused';
  const rec = t.base + STRIDE * idx;
  const pence = mem.l(rec);
  if (pence === 0 || pence > 100_000) return null;
  const kind = recordKind(t, mem, idx);
  if (kind === 'unread') return null;
  return { pence, token: false };
};

const scriptCounter = (mem: Sc4Mem, rec: number): number | null => {
  const p = mem.l(rec + 0x22);
  return p === 0 || p >= CODE_END + RAM_BASE ? null : mem.w(p);
};

function recordKind(t: Extract<Sc4CoinTables, { form: 'records' }>, mem: Sc4Mem, idx: number): 'cash' | 'unread' {
  const tally = new Map<number, number>();
  for (let i = 0; i < t.count; i++) {
    const c = scriptCounter(mem, t.base + STRIDE * i);
    if (c !== null) tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  const cash = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
  return cash !== undefined && scriptCounter(mem, t.base + STRIDE * idx) === cash ? 'cash' : 'unread';
}

const listCoin = (t: Extract<Sc4CoinTables, { form: 'list' }>, mem: Sc4Mem, mask: number): Sc4ProgramCoin => {
  if (mask === 0) return 'refused';
  const hits: { pence: number; token: boolean }[] = [];
  for (let p = t.list; mem.l(p) !== 0 && p < t.list + 4 * 32; p += 4) {
    let rec = mem.l(p);
    const alts: number[] = [rec];
    for (let k = 0; k < 8 && mem.l(rec + t.next) !== 0 && mem.l(rec + t.sw) !== 0; k++) alts.push(rec = mem.l(rec + t.next));
    const m = mem.w(alts[0]! + 6);
    if (!(m & mask)) continue;
    const coins = alts.map((a) => ({ pence: mem.w(a), token: /TOKEN/.test(nameAt(mem, mem.l(a + 0x0e))) }));
    if (coins.some((c) => c.pence !== coins[0]!.pence || c.token !== coins[0]!.token)) return null;
    hits.push(coins[0]!);
  }
  if (!hits.length) return 'refused';
  return hits.length === 1 ? hits[0]! : null;
};

const nameAt = (mem: Sc4Mem, a: number): string => {
  let s = '';
  for (let i = 0; i < 16 && a; i++) {
    const c = mem.w(a + i) >> 8;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
};

export function sc4ProgramCoin(t: Sc4CoinTables, mem: Sc4Mem, pattern: number): Sc4ProgramCoin {
  const p = pattern & 0x3f;
  if (t.form === 'records') {
    const isCoded = coded(t.select, mem);
    const idx = isCoded ? mem.w(t.coded + 2 * (mem.w(t.select.binary) ? p & 0x1f : p)) : mem.w(t.parallel + 2 * p);
    return recordsCoin(t, mem, idx);
  }
  if (coded(t.select, mem)) {
    if (t.codes === null) return null;
    return listCoin(t, mem, mem.w(t.codes + 2 * (p & 0x1f)));
  }
  return listCoin(t, mem, p);
}

export function sc4TokenLine(t: Sc4CoinTables, mem: Sc4Mem): number | null {
  if (t.form !== 'list') return null;
  const lines: number[] = [];
  for (let p = t.list; mem.l(p) !== 0 && p < t.list + 4 * 32; p += 4) {
    const rec = mem.l(p);
    if (!/TOKEN/.test(nameAt(mem, mem.l(rec + 0x0e)))) continue;
    const m = mem.w(rec + 6);
    for (let b = 0; b < SC4_COIN_LINES; b++) if (m === 1 << b) lines.push(b);
  }
  return lines.length === 1 ? lines[0]! : null;
}

export function sc4CoinSource(t: Sc4CoinTables): string {
  return t.form === 'records'
    ? `Scorpion 4 coin records ${hex(t.base)} (${t.count}), decode tables ${hex(t.parallel)}/${hex(t.coded)}`
    : `Scorpion 4 coin list ${hex(t.list)}${t.codes === null ? '' : `, codes ${hex(t.codes)}`}`;
}

export function sc4CoinTable(t: Sc4CoinTables, mem: Sc4Mem, patterns: readonly number[]): CoinLineTable | Refusal {
  const lines: CoinLine[] = [];
  for (let line = 0; line < SC4_COIN_LINES; line++) {
    const pat = patterns[line];
    if (pat === undefined) continue;
    const c = sc4ProgramCoin(t, mem, pat);
    if (c === null || c === 'refused') continue;
    lines.push(c.token
      ? { line, credits: c.pence, change: [], token: true, tokenPence: c.pence }
      : { line, credits: c.pence, change: [] });
  }
  if (!lines.length) return { refused: `${sc4CoinSource(t)}: no coin line reads as a coin` };
  return { lines, pricePerCredit: 1, source: sc4CoinSource(t) };
}
