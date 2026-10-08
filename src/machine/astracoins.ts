import type { CoinLine, CoinLineTable, Refusal } from './coinwiring';

export type AstraMem = (a: number) => number;

const be16 = (r: Uint8Array, a: number): number => ((r[a]! << 8) | r[a + 1]!) >>> 0;
const be32 = (r: Uint8Array, a: number): number => ((be16(r, a) << 16) | be16(r, a + 2)) >>> 0;
const m16 = (m: AstraMem, a: number): number => ((m(a) << 8) | m(a + 1)) >>> 0;
const m32 = (m: AstraMem, a: number): number => ((m16(m, a) << 16) | m16(m, a + 2)) >>> 0;

function find(rom: Uint8Array, pat: readonly (number | null)[], from = 0, to = rom.length): number[] {
  const out: number[] = [];
  const end = Math.min(to, rom.length - pat.length + 1);
  outer: for (let a = Math.max(0, from); a < end; a++) {
    for (let k = 0; k < pat.length; k++) { const p = pat[k]; if (p !== null && rom[a + k] !== p) continue outer; }
    out.push(a);
  }
  return out;
}

const _ = null;
const DECODE = [0x10, 0x02, 0x48, 0x80, 0x46, 0x40, 0x02, 0x40, 0x00, _, 0x34, 0x00, 0x20, 0x7c, _, _, _, _, 0x10, 0x30, 0x20, 0x00, 0x49, 0xc0];
const HANDOFF = [0x20, 0x79, _, _, _, _, 0x10, 0x10, 0xd0, 0x39, _, _, _, _, 0x2f, 0x00, 0x20, 0x79, _, _, _, _, 0x4e, 0x90];
const HANDLER = [0x4e, 0x56, 0x00, 0x00, 0x48, 0xe7, 0x20, 0x30, 0x10, 0x2e, 0x00, 0x0b, 0x49, 0xc0, 0x20, 0x7c, _, _, _, _, 0x26, 0x70, 0x0c, 0x00, 0x24, 0x6b, 0x00, 0x02];
const ENABLE = [0x22, 0x7c, _, _, _, _, 0x10, 0x2f, 0x00, 0x07, _, _, 0x20, 0x7c, _, _, _, _, 0x10, 0x30, _, 0x00, 0x81, 0x11];

export interface AstraCoinCode {
  mask: number;
  decode: number;
  basePtr: number;
  handlerPtr: number;
  inhibit: { byte: number; table: number } | null;
  at: number;
}

export function locateAstraCoinCode(rom: Uint8Array, len = rom.length): AstraCoinCode | Refusal {
  const dec = find(rom, DECODE, 0, len);
  if (!dec.length) return { refused: 'no coin decode found in the program' };
  const masks = new Set(dec.map((a) => rom[a + 9]!));
  const tabs = new Set(dec.map((a) => be32(rom, a + 14)));
  if (masks.size !== 1 || tabs.size !== 1) return { refused: 'the program decodes coins through more than one table' };
  const mask = [...masks][0]!;
  if (mask !== 0x1f && mask !== 0x3f) return { refused: 'the program reads its coin input at an unread width' };
  const decode = [...tabs][0]!;
  if (decode + mask + 1 > len) return { refused: 'the coin decode table lies outside the program' };
  const last = Math.max(...dec);
  const hand = find(rom, HANDOFF, last, last + 0x200);
  if (hand.length !== 1) return { refused: 'no single coin hand-off follows the decode' };
  const h = hand[0]!;
  const en = find(rom, ENABLE, Math.max(0, last - 0x800), last);
  const inh = new Set(en.map((a) => `${be32(rom, a + 2)},${be32(rom, a + 14)}`));
  const inhibit = inh.size === 1 ? { byte: be32(rom, en[0]! + 2), table: be32(rom, en[0]! + 14) } : null;
  return { mask, decode, basePtr: be32(rom, h + 2), handlerPtr: be32(rom, h + 18), inhibit, at: last };
}

export interface AstraCoin {
  code: number;
  pence: number;
  token: boolean;
  meters: number[];
}

export interface AstraCoins {
  code: AstraCoinCode;
  coins: Map<number, AstraCoin>;
}

export function astraCoins(code: AstraCoinCode, rom: Uint8Array, mem: AstraMem): AstraCoins | Refusal {
  const handler = m32(mem, code.handlerPtr);
  if (handler + HANDLER.length > rom.length || !find(rom, HANDLER, handler, handler + 1).length) {
    return { refused: 'the program has no coin handler of the read shape installed' };
  }
  const records = be32(rom, handler + 16);
  const base = mem(m32(mem, code.basePtr));
  const codes = new Set<number>();
  for (let i = 0; i <= code.mask; i++) { const c = rom[code.decode + i]!; if (c !== 0xff) codes.add(c); }
  if (!codes.size || [...codes].some((c) => c > 15)) return { refused: 'the coin decode table names no coin, or one out of range' };
  const raw: { code: number; pence: number; bank: number; meters: number[] }[] = [];
  for (const c of [...codes].sort((a, b) => a - b)) {
    const r = m32(mem, records + 4 * ((base + c) & 0xff));
    if (!r) return { refused: `the program has no record for coin code ${c}` };
    const credits = m32(mem, r + 6);
    if (!credits) continue;
    const pence = m32(mem, credits);
    const bank = m32(mem, credits + 4);
    if (pence <= 0 || pence > 1000) return { refused: `coin code ${c} credits an amount out of range` };
    const meters: number[] = [];
    for (let p = m32(mem, r + 2), n = 0; p && m16(mem, p) && n < 8; p += 4, n++) {
      if (m16(mem, p) !== pence) return { refused: `coin code ${c} meters another amount than it credits` };
      meters.push(m16(mem, p + 2));
    }
    raw.push({ code: c, pence, bank, meters });
  }
  if (!raw.length) return { refused: 'the program\'s records credit no coin' };
  const biggest = raw.reduce((a, b) => (b.pence > a.pence ? b : a));
  const coins = new Map<number, AstraCoin>();
  for (const x of raw) coins.set(x.code, { code: x.code, pence: x.pence, token: x.bank !== biggest.bank, meters: x.meters });
  return { code, coins };
}

export function astraCodeOf(code: AstraCoinCode, rom: Uint8Array, pattern: number): number | null {
  const c = rom[code.decode + (pattern & code.mask)]!;
  return c === 0xff ? null : c;
}

export function astraCodeLocked(code: AstraCoinCode, rom: Uint8Array, mem: AstraMem, c: number): boolean {
  if (!code.inhibit) return false;
  const bit = rom[code.inhibit.table + c] ?? 0;
  return bit !== 0 && (mem(code.inhibit.byte) & bit) === 0;
}

export function astraCoinTable(c: AstraCoins, rom: Uint8Array, ids: readonly number[], patternOf: (id: number) => number | null): CoinLineTable {
  const lines: CoinLine[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    const p = patternOf(id);
    if (p === null) continue;
    const k = astraCodeOf(c.code, rom, p);
    if (k === null || seen.has(k)) continue;
    const coin = c.coins.get(k);
    if (!coin) continue;
    seen.add(k);
    lines.push(coin.token
      ? { line: id, credits: coin.pence, change: [], token: true, tokenPence: coin.pence }
      : { line: id, credits: coin.pence, change: [] });
  }
  return { lines, pricePerCredit: 1, source: `Astra coin records (decode $${c.code.decode.toString(16).toUpperCase()})` };
}

const METER_CALL = [0x30, 0x2a, 0x00, 0x02, 0x2f, 0x00, 0x4e, 0xb9];
const METER_FN = [0x4e, 0x56, 0x00, 0x00, 0x48, 0xe7, 0x30, 0x20, 0x30, 0x2e, 0x00, 0x0a, 0x20, 0x79, _, _, _, _, 0x24, 0x70, 0x04, 0x00];

export function astraBoardMeter(c: AstraCoins, rom: Uint8Array, mem: AstraMem, logical: number): number | null {
  const handler = m32(mem, c.code.handlerPtr);
  const call = find(rom, METER_CALL, handler, handler + 0x60);
  if (call.length !== 1) return null;
  const fn = be32(rom, call[0]! + 8);
  if (!find(rom, METER_FN, fn, fn + 1).length) return null;
  const table = m32(mem, be32(rom, fn + 14));
  const obj = m32(mem, table + 4 * logical);
  if (!obj) return null;
  const phys = m32(mem, m32(mem, obj + 4));
  const id = m16(mem, m32(mem, phys)) & 0xff;
  if (id >> 3 !== 11) return null;
  const bit = id & 7;
  return bit >= 4 ? bit - 4 : bit === 3 ? 4 : null;
}
