import type { CoinLineTable, Refusal } from './coinwiring';
import { COIN_RAW } from './coinraw';

export interface ProconnCoin {
  pattern: number;
  mask: number;
  code: number;
  value: number;
  token: boolean;
  creditAt?: number;
}

export interface ProconnCoinCode {
  coins: ProconnCoin[];
  pence: boolean;
  form: 'bit' | 'code';
  credit: { entry: number; at: number; exit: number } | null;
  route: number;
  tokenMeter: number | null;
  tokenOut: { at: number; acc: number; counts: number; meter: number; code: number; value: number } | null;
  unread: string[];
  source: string;
}

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;
const word = (b: Uint8Array, a: number): number => (b[a] ?? 0) | ((b[a + 1] ?? 0) << 8);

function find(rom: Uint8Array, pat: readonly (number | null)[], from = 0, to = rom.length): number[] {
  const out: number[] = [];
  outer: for (let i = from; i + pat.length <= to; i++) {
    for (let k = 0; k < pat.length; k++) if (pat[k] !== null && rom[i + k] !== pat[k]) continue outer;
    out.push(i);
  }
  return out;
}

export function z80Length(rom: Uint8Array, a: number): number {
  const op = rom[a] ?? 0;
  if (op === 0xcb) return 2;
  if (op === 0xed) {
    const o = rom[a + 1] ?? 0;
    return (o & 0xc7) === 0x43 ? 4 : 2;
  }
  if (op === 0xdd || op === 0xfd) {
    const o = rom[a + 1] ?? 0;
    if (o === 0xcb) return 4;
    if (o === 0x21 || o === 0x22 || o === 0x2a) return 4;
    if (o === 0x36) return 4;
    const mem = o === 0x34 || o === 0x35 || (o >= 0x46 && o <= 0x7e && ((o & 7) === 6 || (o & 0xf8) === 0x70) && o !== 0x76)
      || ((o & 0xc7) === 0x86);
    return mem ? 3 : 2;
  }
  if ([0x01, 0x11, 0x21, 0x31, 0x22, 0x2a, 0x32, 0x3a].includes(op)) return 3;
  if ((op & 0xc7) === 0xc2 || op === 0xc3 || (op & 0xc7) === 0xc4 || op === 0xcd) return 3;
  if ((op & 0xc7) === 0x06) return 2;
  if (op === 0x10 || op === 0x18 || (op & 0xe7) === 0x20) return 2;
  if ((op & 0xc7) === 0xc6 || op === 0xd3 || op === 0xdb) return 2;
  return 1;
}

function sampler(rom: Uint8Array): number[] {
  const out: number[] = [];
  for (const a of find(rom, [0x01, 0xd8, 0x02, 0xed, 0x40, 0x78, 0x2f, 0x47, 0x3a, null, null, 0xa0, 0x32])) {
    out.push(word(rom, a + 13));
  }
  return out;
}

interface ReaderCoin { pattern: number; counter: number }

function readerBlocks(rom: Uint8Array, coin: number): { at: number; mask: number; coins: ReaderCoin[]; other: number } | null {
  for (const a of find(rom, [0x3a, coin & 0xff, coin >> 8])) {
    let pc = a + 3;
    let mask = 0xff;
    if (rom[pc] === 0xe6) { mask = rom[pc + 1]!; pc += 2; }
    if (rom[pc] !== 0x5f) continue;
    pc += 1;
    const coins: ReaderCoin[] = [];
    let other = 0;
    let eFromCoin = true;
    const end = Math.min(rom.length, a + 0x180);
    const counterAt = (p: number): number | null => (rom[p] === 0x21 && rom[p + 3] === 0x34 ? word(rom, p + 1) : null);
    while (pc < end && rom[pc] !== 0xc9) {
      const op = rom[pc]!;
      if (op === 0x3a && rom[pc + 3] === 0x5f) { eFromCoin = word(rom, pc + 1) === coin; pc += 4; continue; }
      if (op === 0x21) {
        const b = rom[pc + 4]!;
        let pattern: number | null = null;
        let next = 0;
        if (rom[pc + 3] === 0xcb && (b & 0xc7) === 0x43 && rom[pc + 5] === 0xcd) { pattern = 1 << ((b >> 3) & 7); next = pc + 8; }
        else if (rom[pc + 3] === 0x7b && rom[pc + 4] === 0xfe && rom[pc + 6] === 0xcd) { pattern = rom[pc + 5]!; next = pc + 9; }
        if (pattern !== null) {
          if (rom[next] === 0xcd) next += 3;
          let counter: number | null = null;
          const gated = (p: number): number => (rom[p] === 0xcb && (rom[p + 1]! & 0xc7) === 0x42 && rom[p + 2] === 0x28 ? p + 4 : p);
          if (rom[next] === 0x20) counter = counterAt(gated(next + 2));
          else if (rom[next] === 0x28) counter = counterAt(next + 2 + ((rom[next + 1]! << 24) >> 24));
          if (counter !== null) {
            if (eFromCoin) coins.push({ pattern, counter });
            else other++;
            pc = next + 2;
            continue;
          }
        }
      }
      pc += z80Length(rom, pc);
    }
    if (!coins.length) continue;
    return { at: a, mask, coins, other };
  }
  return null;
}

function isCounterDec(rom: Uint8Array, a: number): number | null {
  const ok = rom[a] === 0x3a && rom[a + 3] === 0xe6 && rom[a + 4] === 0x0f && rom[a + 5] === 0x4f
    && rom[a + 6] === 0x06 && rom[a + 7] === 0x00 && rom[a + 8] === 0xcb && rom[a + 9] === 0x21 && rom[a + 10] === 0x09;
  return ok ? word(rom, a + 1) : null;
}

function valueForm(rom: Uint8Array, a: number, r: number): 'byte' | 'word' | null {
  const at = find(rom, [0x3a, r & 0xff, r >> 8, 0xe6, 0x0f, 0x4f, 0x06, 0x00], a, a + 12)[0];
  if (at === undefined) return null;
  if (rom[at + 8] === 0x09 && rom[at + 9] === 0x46) return 'byte';
  if (rom[at + 8] === 0x09 && rom[at + 9] === 0x09) return 'word';
  return null;
}

function creditPoints(rom: Uint8Array, entry: number, r: number): { at: number; exit: number } | null {
  const chk = find(rom, [0x3a, r & 0xff, r >> 8, 0xe6, 0x70, 0xfe, 0x50, 0x28], entry, entry + 16)[0];
  if (chk === undefined) return null;
  const exit = chk + 9 + ((rom[chk + 8]! << 24) >> 24);
  for (let pc = chk + 9; pc < exit; pc += z80Length(rom, pc)) if (rom[pc] === 0xf3) return { at: pc, exit };
  return null;
}

function tokenRoute(rom: Uint8Array, r: number): { acc: number } | null {
  for (const a of find(rom, [0x3a, r & 0xff, r >> 8, 0x4f, 0xe6, 0x70, 0xfe, 0x30, 0x28])) {
    const x = a + 10 + ((rom[a + 9]! << 24) >> 24);
    if (rom[x] !== 0xcb || rom[x + 1] !== 0x59 || rom[x + 2] !== 0x20) continue;
    const t = x + 4 + ((rom[x + 3]! << 24) >> 24);
    if (rom[t] === 0x2a) return { acc: word(rom, t + 1) };
  }
  return null;
}

function tokenPayout(rom: Uint8Array, r: number): { at: number; acc: number; counts: number; codes: number[] } | null {
  for (const a of find(rom, [0x3a, r & 0xff, r >> 8, 0x4f, 0xe6, 0x70, 0xfe, 0x30, 0x28])) {
    const b = find(rom, [0xfe, 0x40, 0x20, null, 0xf5, 0x3a, r & 0xff, r >> 8, 0xe6, 0x0f, 0xfe, null, 0x28, null, 0xfe, null, 0x28], a + 10, a + 0x40)[0];
    if (b === undefined) continue;
    const y1 = b + 14 + ((rom[b + 13]! << 24) >> 24);
    const y2 = b + 18 + ((rom[b + 17]! << 24) >> 24);
    if (y1 !== y2 || rom[y1] !== 0xf1 || rom[y1 + 1] !== 0x2a) continue;
    const acc = word(rom, y1 + 2);
    let n = 0;
    while (rom[y1 + 4 + n] === 0x23) n++;
    const st = y1 + 4 + n;
    if (!n || rom[st] !== 0x22 || word(rom, st + 1) !== acc) continue;
    return { at: y1 + 1, acc, counts: n, codes: [rom[b + 11]!, rom[b + 15]!] };
  }
  return null;
}

function accumulatorMeter(rom: Uint8Array, acc: number): number | null {
  for (const a of [...find(rom, [0x2a, acc & 0xff, acc >> 8, 0x7c, 0xb5]), ...find(rom, [0x2a, acc & 0xff, acc >> 8, 0xd5, 0x11, 0x00, 0x00, 0xcd])]) {
    const st = find(rom, [0x22, acc & 0xff, acc >> 8], a + 5, a + 24)[0];
    if (st === undefined) continue;
    const m = rom[st + 3] === 0x3e || rom[st + 3] === 0xf6 ? rom[st + 4]! : -1;
    if (m > 0 && !(m & (m - 1))) return 31 - Math.clz32(m);
  }
  return null;
}

function locateLatched(rom: Uint8Array): ProconnCoinCode | Refusal | null {
  for (const s of find(rom, [0x01, 0xd8, 0x02, 0xed, 0x78, 0x2f, 0xe6, null, 0x32])) {
    const mask = rom[s + 7]!;
    let coin = -1;
    for (const l of find(rom, [0x3a, null, null, 0x32], s + 11, s + 0x50)) {
      const hold = word(rom, l + 1);
      if (find(rom, [0x32, hold & 0xff, hold >> 8], s + 11, l).length) { coin = word(rom, l + 4); break; }
    }
    if (coin < 0) continue;
    const blocks = find(rom, [0x3a, coin & 0xff, coin >> 8, 0xcb, null, 0x28, null, 0xaf, 0x32, coin & 0xff, coin >> 8])
      .filter((b) => (rom[b + 4]! & 0xc7) === 0x47);
    if (!blocks.length) continue;
    const jr = (p: number): number => p + 2 + ((rom[p + 1]! << 24) >> 24);
    const joins = (p: number): number | null => {
      if (rom[p] !== 0x3e) return null;
      if (rom[p + 2] === 0x18) return jr(p + 2);
      return rom[p + 2] === 0xcd ? p + 2 : null;
    };
    const ranges = blocks.map((b) => ({ b, end: jr(b + 5) }));
    const hits = new Map<number, number>();
    for (const { b, end } of ranges) {
      for (let pc = b + 11; pc < end; pc += z80Length(rom, pc)) {
        const t = joins(pc);
        if (t !== null && rom[t] === 0xcd) hits.set(t, (hits.get(t) ?? 0) + 1);
      }
    }
    const site = [...hits].sort((x, y) => y[1] - x[1])[0]?.[0];
    if (site === undefined) continue;
    const coins: ProconnCoin[] = [];
    for (const { b, end } of ranges) {
      const at: number[] = [];
      for (let pc = b + 11; pc < end; pc += z80Length(rom, pc)) if (joins(pc) === site) at.push(pc);
      if (at.length !== 1) return { refused: `latched coin block ${hex(b)}: ${at.length} credited paths` };
      const bit = 1 << ((rom[b + 4]! >> 3) & 7);
      coins.push({ pattern: bit, mask: mask & ranges.reduce((m, r) => m | (1 << ((rom[r.b + 4]! >> 3) & 7)), 0), code: coins.length, value: rom[at[0]! + 1]!, token: false, creditAt: at[0]! });
    }
    return {
      coins,
      pence: false,
      form: 'bit',
      credit: null,
      route: -1,
      tokenMeter: null,
      tokenOut: null,
      unread: [],
      source: `Proconn latched coin reader ${hex(s)}, latch ${hex(coin)}, credit ${hex(site)} (10p counts)`,
    };
  }
  return null;
}

function valueCall(rom: Uint8Array, p: number, route: number):
  { form: 'byte' | 'word'; values: number | null; tables: number[]; next: number } | null {
  const tables: number[] = [];
  for (let pc = p; pc < p + 20; pc += z80Length(rom, pc)) {
    if (rom[pc] === 0x21 && !(rom[pc + 3] === 0xcb && (rom[pc + 4]! & 7) === 6)) tables.push(word(rom, pc + 1));
    if (rom[pc] !== 0xcd) continue;
    const form = valueForm(rom, word(rom, pc + 1), route);
    if (!form || !tables.length || tables.length > 2) return null;
    return { form, values: tables.length === 1 ? tables[0]! : null, tables, next: pc + 3 };
  }
  return null;
}

function meterTable(rom: Uint8Array, route: number, exclude: readonly number[]): number | null {
  const found = new Set<number>();
  for (const a of find(rom, [0x21, null, null, 0xcd])) {
    const t = word(rom, a + 1);
    if (exclude.includes(t)) continue;
    if (valueForm(rom, word(rom, a + 4), route) === 'byte') found.add(t);
  }
  return found.size === 1 ? [...found][0]! : null;
}

export function locateProconnCoins(rom: Uint8Array): ProconnCoinCode | Refusal {
  const coinBytes = sampler(rom);
  if (!coinBytes.length) return locateLatched(rom) ?? { refused: 'no coin-row sampler found in the program' };
  let reader: NonNullable<ReturnType<typeof readerBlocks>> | null = null;
  for (const c of coinBytes) { reader = readerBlocks(rom, c); if (reader) break; }
  if (!reader) return { refused: 'no coin reader found on the coin byte' };
  for (const a of find(rom, [0x21, null, null, 0xcd])) {
    const route = isCounterDec(rom, word(rom, a + 4));
    if (route === null) continue;
    const seq = valueCall(rom, a + 6, route);
    if (!seq) continue;
    let entry = 0;
    let credit: ReturnType<typeof creditPoints> = null;
    for (let c = seq.next; c < seq.next + 9 && rom[c] === 0xcd && !credit; c += 3) {
      entry = word(rom, c + 1);
      credit = creditPoints(rom, entry, route);
    }
    if (!credit) continue;
    let { form, values } = seq;
    if (values === null) {
      const m = meterTable(rom, route, seq.tables);
      if (m === null) return { refused: 'the program picks its coin values by a setting, and no meter table names the coin' };
      const agree = form === 'word'
        ? seq.tables.filter((t) => [...Array(16).keys()].every((k) => !rom[m + k] || word(rom, t + 2 * k) === 10 * rom[m + k]!))
        : [];
      if (agree.length === 1) values = agree[0]!;
      else { form = 'byte'; values = m; }
    }
    const counters = word(rom, a + 1);
    const codeOf = new Map<number, number>();
    for (let k = 0; k < 16; k++) { const ctr = word(rom, counters + 2 * k); if (ctr) codeOf.set(ctr, k); }
    const tok = tokenRoute(rom, route);
    const coins: ProconnCoin[] = [];
    const readMask = reader.mask & reader.coins.reduce((m, c) => (c.pattern & (c.pattern - 1) ? m : m | c.pattern), 0);
    const bitReader = reader.coins.every((c) => !(c.pattern & (c.pattern - 1)));
    let bad = false;
    for (const rc of reader.coins) {
      const code = codeOf.get(rc.counter);
      if (code === undefined) { bad = true; break; }
      const value = form === 'byte' ? rom[values + code]! : word(rom, values + 2 * code);
      coins.push({
        pattern: rc.pattern,
        mask: bitReader ? readMask : reader.mask,
        code,
        value,
        token: tok !== null && (code & 8) !== 0,
      });
    }
    if (bad) return { refused: 'a coin counter the program\'s counter table does not name' };
    const tp = tok ? tokenPayout(rom, route) : null;
    const tCode = tp?.codes.find((k) => (k & 8) !== 0);
    const tMeter = tp ? accumulatorMeter(rom, tp.acc) : null;
    const tokenOut = tp && tCode !== undefined && tMeter !== null
      ? { at: tp.at, acc: tp.acc, counts: tp.counts, meter: tMeter, code: tCode, value: form === 'byte' ? rom[values + tCode]! : word(rom, values + 2 * tCode) }
      : null;
    const unread = reader.other ? [`${reader.other} coin(s) read off another input than the coin row`] : [];
    return {
      coins,
      pence: form === 'word',
      form: bitReader ? 'bit' : 'code',
      credit: { entry, at: credit.at, exit: credit.exit },
      route,
      tokenMeter: tok ? accumulatorMeter(rom, tok.acc) : null,
      tokenOut,
      unread,
      source: `Proconn coin reader ${hex(reader.at)}, counters ${hex(counters)}, values ${hex(values)} (${form === 'word' ? 'pence' : '10p counts'}), credit ${hex(entry)}`,
    };
  }
  return { refused: 'no coin counter and value tables found' };
}

export function proconnRowPattern(id: number): number | null {
  let raw: number;
  if (id >= 0x100 && id < 0x180) raw = id;
  else if (id >= 0 && id < COIN_RAW.length && !(id >= 0x1e && id <= 0x20) && !(id >= 0x27 && id <= 0x32)) raw = COIN_RAW[id]!;
  else return null;
  if (raw & 0x100) return ((raw & 0x78) >> 3) === 6 ? 1 << (raw & 7) : null;
  return raw & 0xff || null;
}

export function proconnCoinOf(code: ProconnCoinCode, id: number): ProconnCoin | null {
  const p = proconnRowPattern(id);
  if (p === null) return null;
  return code.coins.find((c) => (p & c.mask) === c.pattern) ?? null;
}

const CODED_IDS = [33, 34, 35, 36, 37, 38];
const BIT_IDS = [15, 16, 17, 18, 19, 20, 21, 22];
const LINE_IDS = [0x130, 0x131, 0x132, 0x133, 0x134, 0x135, 0x136, 0x137];
const canonicalIds = (form: ProconnCoinCode['form']): number[] =>
  form === 'code' ? [...CODED_IDS, ...BIT_IDS, ...LINE_IDS] : [...BIT_IDS, ...LINE_IDS, ...CODED_IDS];

export function proconnCoinTable(code: ProconnCoinCode, drawn: readonly number[]): CoinLineTable {
  const lines: CoinLineTable['lines'] = [];
  const seen = new Set<number>();
  for (const c of code.coins) {
    const hit = (id: number): boolean => { const p = proconnRowPattern(id); return p !== null && (p & c.mask) === c.pattern; };
    const id = [...drawn].sort((a, b) => a - b).find(hit) ?? canonicalIds(code.form).find(hit);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    lines.push({ line: id, credits: c.value, change: [], ...(c.token ? { token: true } : {}) });
  }
  lines.sort((a, b) => a.line - b.line);
  return { lines, pricePerCredit: code.pence ? 1 : null, source: code.source };
}
