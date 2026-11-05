import type { CoinLine, CoinLineTable, Refusal } from './coinwiring';

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

export const SC4_COIN_LINES = 6;
const CODE_END = 0x100000;
const RAM_BASE = 0x800000;
const STRIDE = 82;
const MAX_VALUE = 100_000;

export interface Sc4Select {
  binary: number;
  handlers: number[];
}

export type Sc4CoinTables =
  | { form: 'records'; base: number; count: number; countAt: number; coded: number; parallel: number; select: Sc4Select }
  | { form: 'list'; list: number; next: number; sw: number; codes: number | null; select: Sc4Select | null }
  | { form: 'strobed'; base: number; stride: number };

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

const isDecodeTable = (r: Sc4Mem, x: number): boolean => {
  if (r.w(x) !== 0xfffe) return false;
  for (let i = 1; i < 64; i++) {
    const v = r.w(x + 2 * i);
    if (v >= 0x40 && (v < 0xfffa || v > 0xfffe)) return false;
  }
  return true;
};

const loadsImm = (r: Sc4Mem, a: number): number | null => {
  const w = r.w(a) & 0xf1ff;
  return w === 0x207c || w === 0x41f9 ? r.l(a + 2) : null;
};

function dispatcherTables(r: Sc4Mem, end: number): { coded: number; parallel: number } | null {
  for (let a = 0; a < end; a += 2) {
    if (tstRam(r, a) === null || (r.w(a + 6) & 0xff00) !== 0x6700) continue;
    const taken = a + 8 + ((r.w(a + 6) << 24) >> 24);
    let coded: number | null = null;
    for (let b = a + 8; b < taken; b += 2) if ((coded = loadsImm(r, b)) !== null) break;
    if (coded === null || coded >= end || !isDecodeTable(r, coded)) continue;
    for (let b = taken; b < taken + 0x10; b += 2) {
      const parallel = loadsImm(r, b);
      if (parallel === null) continue;
      if (parallel < end && parallel !== coded && isDecodeTable(r, parallel)) return { coded, parallel };
      break;
    }
  }
  return null;
}

function recordsWalked(r: Sc4Mem, end: number, countAt: number, inRom: number, count: number): number | null {
  let priced = true;
  for (let i = 0; i < count && priced; i++) priced = r.l(inRom + STRIDE * i) > 0 && r.l(inRom + STRIDE * i) <= MAX_VALUE;
  const walked = new Map<number, number>();
  for (let a = 0; a < end; a += 2) {
    if (loadsImm(r, a) === inRom && priced) return inRom;
    if ((r.w(a) & 0xf1ff) !== 0x207c || r.l(a + 2) < RAM_BASE) continue;
    const adda = 0xd1c0 | (r.w(a) & 0x0e00);
    for (let b = a + 6; b < a + 0x100 && b < end; b += 2) {
      if (r.w(b) !== 0x7052 || r.w(b + 2) !== adda) continue;
      let named = false;
      for (let c = a + 6; c < b + 0x20 && !named; c += 2) named = r.l(c) === countAt;
      if (named) walked.set(r.l(a + 2), (walked.get(r.l(a + 2)) ?? 0) + 1);
      break;
    }
  }
  const top = [...walked].sort((x, y) => y[1] - x[1]);
  return top.length && top[0]![1] > (top[1]?.[1] ?? 0) ? top[0]![0] : null;
}

function locateRecords(rom: Uint8Array): Sc4CoinTables | Refusal {
  const r = romMem(rom);
  const end = Math.min(rom.length, CODE_END) - 0x90;
  const known = dispatcherTables(r, end);
  const scan = (read: boolean): { par: [number, number][]; coded: [number, number][] } => {
    const par: [number, number][] = [];
    const coded: [number, number][] = [];
    for (let a = 0; a < end; a += 2) {
      const x = loadsImm(r, a);
      if (x === null || x >= end) continue;
      if (read ? x === known?.parallel : isRecordsTable(r, x, 'parallel')) par.push([a, x]);
      else if (read ? x === known?.coded : isRecordsTable(r, x, 'coded')) coded.push([a, x]);
    }
    return { par, coded };
  };
  let refs = scan(false);
  if (!refs.par.length || !refs.coded.length || !refs.coded.some(([ac]) => refs.par.some(([ap]) => Math.abs(ac - ap) <= 0x30))) {
    if (known) refs = scan(true);
  }
  const parRefs = refs.par;
  const codedRefs = refs.coded;
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
  let base = bases.has(inRom) ? inRom : ram.length === 1 ? ram[0]! : null;
  if (base === null) base = recordsWalked(r, end, countAt, inRom, count);
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

function locateStrobed(rom: Uint8Array): Sc4CoinTables | Refusal {
  const r = romMem(rom);
  const end = Math.min(rom.length, CODE_END) - 0x30;
  for (let a = 0x10; a < end; a += 2) {
    if ((r.w(a) & 0xfff8) !== 0x0200 || r.w(a + 2) !== 0x0017) continue;
    let strobe = false;
    for (let b = a - 2; b >= a - 0x10; b -= 2) if ((r.w(b) & 0xfff8) === 0x0800 && r.w(b + 2) === 3) strobe = true;
    if (!strobe) continue;
    const walked = walkIndex(r, a + 4, r.w(a) & 7);
    if (walked) return { form: 'strobed', ...walked };
  }
  return { refused: 'no Scorpion 4 strobed coin scan found' };
}

function walkIndex(r: Sc4Mem, from: number, start: number): { base: number; stride: number } | null {
  const d: (number | null)[] = new Array(8).fill(null);
  const an: (number | null)[] = new Array(8).fill(null);
  const addr: (number | null)[] = new Array(8).fill(null);
  d[start] = 1;
  for (let a = from, n = 0; n < 16; n++) {
    const w = r.w(a);
    const dst = (w >> 9) & 7;
    const src = w & 7;
    if ((w & 0xf100) === 0x7000) { d[dst] = 0; a += 2; }
    else if ((w & 0xf1f8) === 0x1000) { d[dst] = d[src]; a += 2; }
    else if ((w & 0xf1f8) === 0x2000) { d[dst] = d[src]; a += 2; }
    else if ((w & 0xf1f8) === 0x2040) { an[dst] = d[src]; a += 2; }
    else if ((w & 0xf1f8) === 0x2048) { an[dst] = an[src]; addr[dst] = addr[src]; a += 2; }
    else if ((w & 0xf1f8) === 0xd080) { if (d[dst] === null || d[src] === null) return null; d[dst]! += d[src]!; a += 2; }
    else if ((w & 0xf1f8) === 0x9080) { if (d[dst] === null || d[src] === null) return null; d[dst]! -= d[src]!; a += 2; }
    else if ((w & 0xf1f8) === 0xe188) { if (d[src] === null) return null; d[src]! *= 1 << (dst || 8); a += 2; }
    else if ((w & 0xf1f8) === 0xd1c0) { if (an[dst] === null || d[src] === null) return null; an[dst]! += d[src]!; a += 2; }
    else if ((w & 0xf1f8) === 0xd1c8) { if (an[dst] === null || an[src] === null) return null; an[dst]! += an[src]!; a += 2; }
    else if ((w & 0xf1ff) === 0xd1fc) { addr[dst] = r.l(a + 2); a += 6; }
    else if ((w & 0xf1ff) === 0x41f9) { addr[dst] = r.l(a + 2); an[dst] = 0; a += 6; }
    else if ((w & 0xfff8) === 0x4a30) {
      const ext = r.w(a + 2);
      if ((ext & 0x0fff) !== 0x0800) return null;
      const rn = (ext >> 12) & 7;
      const base = addr[w & 7];
      const index = ext & 0x8000 ? an[rn] : d[rn];
      const onBase = an[w & 7];
      if (base === null || base === undefined || index === null || index === undefined || onBase === null || onBase === undefined) return null;
      const stride = index + onBase;
      if (stride !== 20 && stride !== 22) return null;
      return { base, stride };
    } else return null;
  }
  return null;
}

export function locateSc4CoinTables(rom: Uint8Array): Sc4CoinTables | Refusal {
  const rec = locateRecords(rom);
  if (!('refused' in rec)) return rec;
  const list = locateList(rom);
  if (!('refused' in list)) return list;
  const strobed = locateStrobed(rom);
  if (!('refused' in strobed)) return strobed;
  return { refused: 'no Scorpion 4 coin table this reader knows (no coin records, coin list or strobed scan)' };
}

function coded(sel: Sc4Select | null, mem: Sc4Mem): boolean {
  if (!sel) return false;
  return mem.w(sel.binary) !== 0 || sel.handlers.some((h) => mem.l(h) !== 0);
}

const recordsCoin = (t: Extract<Sc4CoinTables, { form: 'records' }>, mem: Sc4Mem, idx: number): Sc4ProgramCoin => {
  if (idx >= t.count) return 'refused';
  const rec = t.base + STRIDE * idx;
  const pence = mem.l(rec);
  if (pence === 0 || pence > MAX_VALUE) return null;
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

const recordIndex = (t: Extract<Sc4CoinTables, { form: 'records' }>, mem: Sc4Mem, p: number, isCoded: boolean): number =>
  (isCoded ? mem.w(t.coded + 2 * (mem.w(t.select.binary) ? p & 0x1f : p)) : mem.w(t.parallel + 2 * p));

export function sc4ProgramCoin(t: Sc4CoinTables, mem: Sc4Mem, pattern: number): Sc4ProgramCoin {
  const p = pattern & 0x3f;
  if (t.form === 'strobed') return strobedCoin(t, mem, p);
  if (t.form === 'records') {
    return recordsCoin(t, mem, recordIndex(t, mem, p, coded(t.select, mem)));
  }
  if (coded(t.select, mem)) {
    if (t.codes === null) return null;
    return listCoin(t, mem, mem.w(t.codes + 2 * (p & 0x1f)));
  }
  return listCoin(t, mem, p);
}

const strobedCoin = (t: Extract<Sc4CoinTables, { form: 'strobed' }>, mem: Sc4Mem, p: number): Sc4ProgramCoin => {
  let built = false;
  for (let i = 0; i < 0x18 && !built; i++) built = (mem.w(t.base + t.stride * i) >> 8) !== 0;
  if (!built) return null;
  if (!(p & 8)) return 'refused';
  const rec = t.base + t.stride * (p & 0x17);
  if ((mem.w(rec) >> 8) === 0) return 'refused';
  const pence = mem.w(rec + 2);
  return pence === 0 ? 'refused' : { pence, token: false };
};

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

export function sc4CoinName(name: string, value: number): 'agrees' | 'neutral' | 'other' {
  if (!/^\d/.test(name)) return 'neutral';
  const m = /^(\d+)\s*(PND|PD|POUND|P|T)\b/.exec(name);
  if (!m) return 'other';
  return Number(m[1]) * (m[2] === 'P' || m[2] === 'T' ? 1 : 100) === value ? 'agrees' : 'other';
}

export function sc4CoinsUnpriced(t: Sc4CoinTables, mem: Sc4Mem, patterns: readonly number[]): boolean {
  if (t.form !== 'records') return false;
  const isCoded = coded(t.select, mem);
  for (const pattern of patterns) {
    const idx = recordIndex(t, mem, pattern & 0x3f, isCoded);
    if (idx >= t.count) continue;
    const rec = t.base + STRIDE * idx;
    const at = mem.l(rec + 0x46);
    if (at === 0 || at >= CODE_END) continue;
    if (sc4CoinName(nameAt(mem, at), mem.l(rec)) === 'other') return true;
  }
  return false;
}

export function locateSc4CoinDebounce(rom: Uint8Array): number | null {
  const r = romMem(rom);
  const end = Math.min(rom.length, CODE_END) - 12;
  for (let a = 0x20; a < end; a += 2) {
    if ((r.w(a) & 0xfff8) !== 0x3210 || (r.w(a + 2) & 0xfff8) !== 0x8250 || (r.w(a + 4) & 0xfff8) !== 0xc250
      || (r.w(a + 6) & 0xfff8) !== 0x3010 || (r.w(a + 8) & 0xfff8) !== 0xc050 || r.w(a + 10) !== 0x8240) continue;
    const reg = r.w(a + 4) & 7;
    for (let b = a - 6; b >= a - 0x20; b -= 2) {
      if (r.w(b) === (0x207c | (reg << 9))) {
        const at = r.l(b + 2);
        return at >= RAM_BASE ? at : null;
      }
    }
    return null;
  }
  return null;
}

export function sc4CoinSource(t: Sc4CoinTables): string {
  if (t.form === 'strobed') return `Scorpion 4 strobed coin records ${hex(t.base)} (${t.stride} bytes each)`;
  return t.form === 'records'
    ? `Scorpion 4 coin records ${hex(t.base)} (${t.count}), decode tables ${hex(t.parallel)}/${hex(t.coded)}`
    : `Scorpion 4 coin list ${hex(t.list)}${t.codes === null ? '' : `, codes ${hex(t.codes)}`}`;
}

export function sc4CoinTable(t: Sc4CoinTables, mem: Sc4Mem, patterns: readonly number[]): CoinLineTable | Refusal {
  if (sc4CoinsUnpriced(t, mem, patterns)) return { refused: `${sc4CoinSource(t)}: the program's coins state no price` };
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
