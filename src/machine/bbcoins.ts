import type { CoinLineTable, Refusal } from './coinwiring';
import { COIN_RAW } from './coinraw';

export interface BbMeterPulse { meter: number; pulses: number }

export interface BbCoinRecord {
  at: number;
  bit: number | null;
  credits: number;
  bank: number;
  meters: BbMeterPulse[];
  alts: { at: number; credits: number; bank: number; meters: BbMeterPulse[] }[];
}

export interface BbCoinCode {
  records: BbCoinRecord[];
  take: number;
  ptr: number;
  door: number | null;
  countMeters: number[];
  source: string;
}

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

function card(rom: Uint8Array): { rd: (a: number) => number; inRom: (a: number) => boolean; word: (a: number) => number } {
  const inRom = (a: number): boolean => ((a & 0x7800) >= 0x6000);
  const rd = (a: number): number => (inRom(a) ? rom[a & 0x1fff] ?? 0 : 0);
  return { rd, inRom, word: (a: number): number => (rd(a) << 8) | rd(a + 1) };
}

function find(rom: Uint8Array, pat: readonly (number | null)[]): number[] {
  const out: number[] = [];
  outer: for (let i = 0; i + pat.length <= rom.length; i++) {
    for (let k = 0; k < pat.length; k++) if (pat[k] !== null && rom[i + k] !== pat[k]) continue outer;
    out.push(0x6000 + i);
  }
  return out;
}

const _ = null;

interface MeterCodes { door: number | null; table: number[]; bulk: number; base: number }

function meterCodes(rom: Uint8Array, fn: number): MeterCodes | null {
  const { rd, word } = card(rom);
  let pc = fn;
  let door: number | null = null;
  if (rd(pc) === 0x7d && rd(pc + 3) === 0x2a) { door = word(pc + 1); pc += 5; }
  if (rd(pc) === 0x37 && rd(pc + 1) === 0x5f) pc += 2;
  if (rd(pc) === 0x7e) pc = word(pc + 1);
  if (rd(pc) !== 0xce || rd(pc + 3) !== 0x85 || rd(pc + 4) !== 0x80 || rd(pc + 5) !== 0x26 || rd(pc + 6) !== 0x03 || rd(pc + 7) !== 0x7e) return null;
  const table = word(pc + 1);
  const search = word(pc + 8);
  if (rd(pc + 10) !== 0x84 || rd(pc + 11) !== 0x7f || rd(pc + 12) !== 0x9b) return null;
  const bulk = rd(pc + 13);
  if (rd(search) !== 0xa1 || rd(search + 1) !== 0x00 || rd(search + 2) !== 0x27 || rd(search + 4) !== 0x5c || rd(search + 5) !== 0x08 || rd(search + 6) !== 0x8c) return null;
  const end = word(search + 7);
  const hit = search + 4 + ((rd(search + 3) << 24) >> 24);
  if (rd(hit) !== 0x17 || rd(hit + 1) !== 0x4c || rd(hit + 2) !== 0xce || rd(hit + 5) !== 0x08 || rd(hit + 6) !== 0x4a || rd(hit + 9) !== 0x6c) return null;
  const base = word(hit + 3) + 1;
  if (end <= table || end - table > 16) return null;
  if (!find(rom, [0xce, base >> 8, base & 0xff, 0xc6, 0x10]).length) return null;
  const codes: number[] = [];
  for (let a = table; a < end; a++) codes.push(rd(a));
  return { door, table: codes, bulk, base };
}

function pulsesOf(codes: readonly number[], mc: MeterCodes): BbMeterPulse[] {
  const out = new Map<number, number>();
  for (const c of codes) {
    if (c & 0x80) { const k = mc.bulk - mc.base; out.set(k, (out.get(k) ?? 0) + (c & 0x7f)); continue; }
    const k = mc.table.indexOf(c);
    if (k >= 0) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return [...out].map(([meter, pulses]) => ({ meter, pulses })).filter((p) => p.pulses > 0).sort((a, b) => a.meter - b.meter);
}

function walk(rom: Uint8Array, start: number, chk: number, take: number, ptr: number): { rec: number; alts: number[] }[] {
  const { rd, word, inRom } = card(rom);
  const out: { rec: number; alts: number[] }[] = [];
  let pc = start;
  let x: number | null = null;
  for (let n = 0; n < 64; n++) {
    const op = rd(pc);
    if (op === 0xce) { x = word(pc + 1); pc += 3; continue; }
    if (op === 0x01) { pc += 1; continue; }
    if (op === 0x7e) { pc = word(pc + 1); continue; }
    if (op === 0x20) { pc = pc + 2 + ((rd(pc + 1) << 24) >> 24); continue; }
    if (op === 0x7d && inRom(word(pc + 1)) && (rd(pc + 3) === 0x2b || rd(pc + 3) === 0x2a)) {
      const neg = (rd(word(pc + 1)) & 0x80) !== 0;
      const taken = rd(pc + 3) === 0x2b ? neg : !neg;
      pc = taken ? pc + 5 + ((rd(pc + 4) << 24) >> 24) : pc + 5;
      continue;
    }
    if (op === 0xbd && word(pc + 1) === chk) {
      if (x === null) break;
      const rec = { rec: x, alts: [] as number[] };
      out.push(rec);
      pc += 3;
      const br = rd(pc);
      const t = pc + 2 + ((rd(pc + 1) << 24) >> 24);
      if (br === 0x26 && t === take) { pc += 2; x = null; continue; }
      if (br === 0x27) {
        for (let a = pc + 2; a < pc + 24; a++) {
          if (rd(a) === 0xce && rd(a + 3) === 0xdf && rd(a + 4) === ptr) rec.alts.push(word(a + 1));
        }
        pc = t;
        x = null;
        continue;
      }
      break;
    }
    break;
  }
  return out;
}

export function locateBlackBoxCoins(rom: Uint8Array): BbCoinCode | Refusal {
  const { rd, word } = card(rom);
  const chks = find(rom, [0xdf, _, 0xee, 0x00, 0xa6, 0x00, 0xde, _, 0xee, 0x02]).filter((a) => rd(a + 1) === rd(a + 7));
  if (chks.length !== 1) return { refused: chks.length ? 'two coin check routines found' : 'no coin check routine found in the program' };
  const chk = chks[0]!;
  const ptr = rd(chk + 1);
  const takes = find(rom, [0xde, ptr, 0xa6, 0x06, 0xbd, _, _, 0xa6, 0x05, 0x9b, _, 0x97, _, 0xa6, 0x04, 0x9b, _, 0x97, _, 0xa6, 0x07, 0xbd, _, _, 0xde, ptr, 0xa6, 0x08, 0x27, 0x03, 0xbd])
    .filter((a) => rd(a + 10) === rd(a + 12) && rd(a + 16) === rd(a + 18) && word(a + 22) === word(a + 31));
  if (takes.length !== 1) return { refused: 'no coin take found beside the check routine' };
  const take = takes[0]!;
  const bank = rd(take + 10);
  const credit = rd(take + 16);
  const mc = meterCodes(rom, word(take + 22));
  if (!mc) return { refused: 'the coin meter routine was not read' };
  const consumer = find(rom, [0x96, bank, 0x26, 0x01, 0x39, 0x3e, 0x7f, 0x00, bank, 0x16, 0xc4, 0x07, 0x47, 0x47, 0x47, 0x47, 0x84, 0x07, 0x9b, credit, 0x97, credit]).length > 0;
  const sites = find(rom, [0xce, _, _, 0xbd, chk >> 8, chk & 0xff]);
  const seen = new Map<number, number[]>();
  for (const s of sites) for (const r of walk(rom, s, chk, take, ptr)) if (!seen.has(r.rec)) seen.set(r.rec, r.alts);
  if (!seen.size) return { refused: 'no coin record reached from the reader' };
  const recOf = (a: number): { credits: number; bank: number; meters: BbMeterPulse[] } => ({
    credits: rd(a + 4), bank: rd(a + 5), meters: pulsesOf([rd(a + 7), rd(a + 8)], mc),
  });
  const records: BbCoinRecord[] = [];
  for (const [at, alts] of seen) {
    const input = word(at);
    const r = recOf(at);
    records.push({
      at,
      bit: (input & 0xfff8) === 0x2000 ? input & 7 : null,
      ...r,
      alts: alts.map((a) => ({ at: a, ...recOf(a) })),
    });
  }
  const banked = records.some((r) => r.bank || r.alts.some((a) => a.bank));
  if (banked && !consumer) return { refused: 'a coin record uses a delayed credit the program\'s consumer was not read for' };
  const live = records.filter((r) => creditsOf(r) > 0);
  const counts = new Set<number>();
  for (const r of live) for (const p of r.meters) if (p.pulses !== creditsOf(r)) counts.add(p.meter);
  for (const r of live) for (const p of r.meters) if (p.pulses === creditsOf(r) && counts.has(p.meter)) {
    return { refused: 'a coin meter the records pulse both as a value and as a count' };
  }
  return {
    records,
    take,
    ptr,
    door: mc.door,
    countMeters: [...counts].sort((a, b) => a - b),
    source: `Black Box coin check ${hex(chk)}, take ${hex(take)}, records ${records.map((r) => hex(r.at)).join(' ')}`,
  };
}

export function creditsOf(r: { credits: number; bank: number }): number {
  return r.credits + ((r.bank >> 4) & 7);
}

export function bbCoinParts(id: number): { row: number; mask: number; direct: boolean }[] {
  let raw: number;
  if (id >= 0x100 && id < 0x180) raw = id;
  else if (id >= 0 && id < COIN_RAW.length) raw = COIN_RAW[id]!;
  else return [];
  const out: { row: number; mask: number; direct: boolean }[] = [];
  for (let n = 0; raw && n < 4; n++, raw = raw >>> 12) {
    if (raw & 0x100) out.push({ row: (raw & 0x78) >> 3, mask: 1 << (raw & 7), direct: true });
    else if (raw & 0xff) out.push({ row: 0, mask: raw & 0xff, direct: false });
  }
  return out;
}

export function bbRecordOf(code: BbCoinCode, id: number): BbCoinRecord | null {
  const first = bbCoinParts(id)[0];
  if (!first || first.row !== 0) return null;
  const hit = code.records.filter((r) => r.bit !== null && (first.mask >> r.bit) & 1);
  return hit.length === 1 ? hit[0]! : null;
}

export function bbCoinBits(code: BbCoinCode): number {
  return code.records.reduce((m, r) => (r.bit === null ? m : m | (1 << r.bit)), 0);
}

const CANONICAL_IDS = [53, 54, 55, 15, 16, 17, 18, 19, 20, 21, 22];

export function bbCoinTable(code: BbCoinCode, drawn: readonly number[]): CoinLineTable {
  const lines: CoinLineTable['lines'] = [];
  const seen = new Set<number>();
  for (const r of code.records) {
    if (r.bit === null) continue;
    const hit = (id: number): boolean => {
      const p = bbCoinParts(id)[0];
      return !!p && p.row === 0 && p.mask === 1 << r.bit!;
    };
    const id = [...drawn].sort((a, b) => a - b).find(hit) ?? CANONICAL_IDS.find(hit);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const back = r.bank & 7;
    lines.push({ line: id, credits: creditsOf(r), change: back ? [[{ count: back, tube: 0 }]] : [] });
  }
  lines.sort((a, b) => a.line - b.line);
  return { lines, pricePerCredit: null, source: code.source };
}
