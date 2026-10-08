import type { CoinLine, CoinLineTable, Refusal } from './coinwiring';

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(5, '0')}`;

export interface ImpactCoinRead {
  table: CoinLineTable;
  cash: number[];
}

const KIND_CASH = 1;
const KIND_TOKEN = 2;

const LINES = 6;

const CODE_END = 0x80000;

interface Entry { chan: number; rec: number; mask: number; kind: number; value: number }

function codeRefs(rom: Uint8Array, r16: (p: number) => number, r32: (p: number) => number, end: number): Set<number> {
  const out = new Set<number>();
  for (let p = 0; p + 6 <= end; p += 2) {
    const op = r16(p);
    if (op === 0x23fc || (op & 0xf1ff) === 0x207c || (op & 0xf1ff) === 0x20bc || (op & 0xf1ff) === 0x41f9) {
      const v = r32(p + 2);
      if (v > 0 && v < end && !(v & 1)) out.add(v);
    }
  }
  return out;
}

interface CoinList { at: number; stride: number; entries: Entry[] }

function parseList(r16: (p: number) => number, r32: (p: number) => number, end: number, at: number, stride: number): Entry[] | null {
  const ptr = (v: number): boolean => v > 0 && v + 16 <= end && !(v & 1);
  const out: Entry[] = [];
  for (let k = 0; k < 24; k++) {
    const q = at + stride * k;
    if (q + 8 > end) return null;
    const chan = r32(q);
    const rec = r32(q + 4);
    if (chan === 0) return out.length >= 3 ? out : null;
    if (!ptr(chan) || !ptr(rec)) return null;
    const kindOfChan = r32(chan);
    if (kindOfChan < 1 || kindOfChan > 15) return null;
    const value = r32(rec);
    const kind = r32(rec + 4);
    const id = r32(rec + 8);
    if (value < 1 || value > 100000 || kind < 1 || kind > 15 || id === 0 || (id & (id - 1)) !== 0) return null;
    const a4 = r32(chan + 4);
    let mask: number;
    if (a4 >= 0x400000 && a4 < 0x410000 && r32(chan + 8) === a4 + 1) mask = r32(chan + 12);
    else if (ptr(a4)) mask = r32(chan + 8);
    else return null;
    out.push({ chan, rec, mask, kind, value });
  }
  return null;
}

function scanLists(rom: Uint8Array): CoinList[] {
  const end = Math.min(rom.length, CODE_END);
  const r16 = (p: number): number => ((rom[p] ?? 0) << 8) | (rom[p + 1] ?? 0);
  const r32 = (p: number): number => ((r16(p) << 16) | r16(p + 2)) >>> 0;
  const lists: CoinList[] = [];
  for (const at of [...codeRefs(rom, r16, r32, end)].sort((a, b) => a - b)) {
    for (const stride of [8, 12, 14]) {
      const e = parseList(r16, r32, end, at, stride);
      if (e) { lists.push({ at, stride, entries: e }); break; }
    }
  }
  return lists;
}

const coinMasks = (l: CoinList): number[] => l.entries.filter((e) => e.kind === KIND_CASH || e.kind === KIND_TOKEN).map((e) => e.mask);

function isParallel(l: CoinList): boolean {
  const masks = coinMasks(l);
  return masks.length >= 3 && masks.every((m) => m > 0 && m < 1 << LINES && (m & (m - 1)) === 0)
    && new Set(masks).size === masks.length;
}

function isBinary(l: CoinList): boolean {
  const masks = coinMasks(l);
  return !isParallel(l) && masks.length >= 3 && masks.every((m) => m > 0x20 && m < 0x40)
    && new Set(masks).size === masks.length;
}

export function readImpactCoinLists(rom: Uint8Array): CoinList[] | Refusal {
  const lists = scanLists(rom);
  const parallel = lists.filter(isParallel);
  if (!parallel.length) {
    return { refused: lists.length ? 'IMPACT coin channel lists found, none for a parallel mech' : 'no IMPACT coin channel list in this program' };
  }
  return parallel;
}

export interface ImpactAllLists { parallel: CoinList[]; binary: CoinList[] }
export function readImpactAllCoinLists(rom: Uint8Array): ImpactAllLists {
  const lists = scanLists(rom);
  return { parallel: lists.filter(isParallel), binary: lists.filter(isBinary) };
}

export type ProgramCoin = { pence: number; token: boolean } | 'refused' | { unvalued: 'token' } | null;
export function programCoin(rom: Uint8Array, all: ImpactAllLists, ram: Uint8Array | null | undefined, binary: boolean, code: number): ProgramCoin {
  const own = binary ? all.binary : all.parallel;
  const named = listsNamed(rom, [...all.parallel, ...all.binary], ram);
  const find = (l: CoinList): Entry | null => l.entries.find((e) => e.mask === code && (e.kind === KIND_CASH || e.kind === KIND_TOKEN)) ?? null;
  const coinOf = (found: (Entry | null)[]): ProgramCoin => {
    const keys = new Set(found.map((e) => `${e!.value}:${e!.kind}`));
    if (keys.size === 1) return { pence: found[0]!.value, token: found[0]!.kind === KIND_TOKEN };
    if (found.every((e) => e!.kind === KIND_TOKEN)) return { unvalued: 'token' };
    return null;
  };
  if (named.length) {
    const found = named.map(find).filter((e) => e !== null);
    return found.length ? coinOf(found) : 'refused';
  }
  if (!own.length) return null;
  const found = own.map(find);
  if (found.every((e) => e === null)) return 'refused';
  if (found.some((e) => e === null)) return null;
  return coinOf(found);
}

export function listInForce(rom: Uint8Array, lists: readonly CoinList[], ram: Uint8Array | null | undefined): CoinList | null {
  if (!ram || lists.length < 2) return null;
  const hits = listsNamed(rom, lists, ram);
  return hits.length === 1 ? hits[0]! : null;
}

function listsNamed(rom: Uint8Array, lists: readonly CoinList[], ram: Uint8Array | null | undefined): CoinList[] {
  if (!ram) return [];
  return lists.filter((l) => {
    const hi = (l.at >>> 24) & 0xff, b2 = (l.at >>> 16) & 0xff, b1 = (l.at >>> 8) & 0xff, b0 = l.at & 0xff;
    for (let p = 0; p + 4 <= ram.length; p += 2) {
      if (ram[p] === hi && ram[p + 1] === b2 && ram[p + 2] === b1 && ram[p + 3] === b0) return true;
    }
    const n = l.stride * l.entries.length + 8;
    if (l.at + n > rom.length) return false;
    for (let p = 0; p + n <= ram.length; p += 2) {
      let k = 0;
      while (k < n && ram[p + k] === rom[l.at + k]) k++;
      if (k === n) return true;
    }
    return false;
  });
}

export function readImpactCoinTable(rom: Uint8Array, ram?: Uint8Array | null): ImpactCoinRead | Refusal {
  const read = readImpactCoinLists(rom);
  if (!Array.isArray(read)) return read;
  return impactCoinTable(read, listInForce(rom, read, ram));
}

export function impactCoinTable(lists: readonly CoinList[], inForce: CoinList | null): ImpactCoinRead | Refusal {
  const parallel = inForce ? [inForce] : lists;
  const seen = new Map<number, Set<string>>();
  for (const { entries } of parallel) {
    for (const e of entries) {
      if (e.kind !== KIND_CASH && e.kind !== KIND_TOKEN) continue;
      const line = 31 - Math.clz32(e.mask);
      let s = seen.get(line);
      if (!s) seen.set(line, (s = new Set()));
      s.add(`${e.value}:${e.kind}`);
    }
  }
  const lines: { line: number; value: number; kind: number; unvalued?: true }[] = [];
  for (const [line, s] of seen) {
    const coins = [...s].map((k) => k.split(':').map(Number) as [number, number]);
    if (coins.length === 1) lines.push({ line, value: coins[0]![0], kind: coins[0]![1] });
    else if (coins.every(([, kind]) => kind === KIND_TOKEN)) lines.push({ line, value: 0, kind: KIND_TOKEN, unvalued: true });
  }
  lines.sort((a, b) => a.line - b.line);
  if (lines.filter((l) => !l.unvalued).length < 3) return { refused: 'fewer than three IMPACT coin lines agree across the program\'s lists' };
  const where = parallel.map((l) => hex(l.at)).join(', ');
  return {
    table: {
      lines: lines.map((l): CoinLine => ({
        line: l.line, credits: l.value, change: [],
        ...(l.kind === KIND_TOKEN ? { token: true } : {}),
        ...(l.unvalued ? { tokenPence: null } : {}),
      })),
      pricePerCredit: null,
      source: `IMPACT coin channel list${parallel.length > 1 ? 's' : ''} ${where}${inForce ? ' (the one in force)' : ''}: each coin record's value`,
    },
    cash: lines.filter((l) => l.kind === KIND_CASH).map((l) => l.line),
  };
}
