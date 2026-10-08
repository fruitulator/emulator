import type { CoinLineTable, Refusal } from './coinwiring';

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

const CASH_IN_METER = 0x31;
const TOKEN_IN_METER = 0x39;

export interface M1abCoinRead {
  table: CoinLineTable;
  cashMetered: number[];
  lockouts: (number | null)[];
  coins: M1abLineCoin[];
}

export type M1abLineCoin = { pence: number; token: boolean } | 'none' | null;

interface Desc { mask: number; credit: number; change: number; meter: number; count: number; count2: number; lockout: number | null; at: number }

const w16 = (rom: Uint8Array, p: number): number => ((rom[p] ?? 0) << 8) | (rom[p + 1] ?? 0);

function matches(rom: Uint8Array, p: number, pat: readonly number[]): boolean {
  for (let i = 0; i < pat.length; i++) if (pat[i]! >= 0 && rom[p + i] !== pat[i]) return false;
  return true;
}

function find(rom: Uint8Array, lo: number, hi: number, pat: readonly number[]): number[] {
  const out: number[] = [];
  for (let p = lo; p + pat.length <= hi; p++) if (matches(rom, p, pat)) out.push(p);
  return out;
}

const _ = -1;

const A_FILL = [0x10, 0x8e, _, _, 0x8e, _, _, 0x10, 0x8c, _, _, 0x24, _, 0xec, 0x84, 0x27, 0x04, 0xa6, 0x94, 0x26, _, 0xaf, 0xa1];
const A_MASK = [0xa5, 0x02, 0x26, 0x04, 0xcb, 0x02, 0x20, 0xf6];
const A_VALUE = [0xe6, 0x03, 0x4f, 0xf3];
const A_CHANGE = [0xa6, 0x04, 0x27, 0x06, 0xb7, _, _, 0xbd, _, _];
const A_METER = [0xa6, _, 0x27, 0x05, 0xe6, _, 0xbd];

const B_FILL = [0xce, _, _, 0x8e, _, _, 0x11, 0x83, _, _, 0x24, _, 0x10, 0xae, 0xc4, 0xec, 0x84, 0x26, _, 0xec, 0x27, 0x27, _,
  0xa6, 0xb8, 0x07, 0x2b, _, 0x10, 0xaf, 0x84, 0x20, _, 0x31, 0xa9, 0x00, 0x15];
const B_VALUE = [0xe6, 0xc4, 0x4f, 0xf3];
const B_CHANGE = [0xa6, 0x22, 0x84, 0x04, 0x27, _, 0xa6, 0x21];

const A_LIMIT = [0xae, 0xa4, 0xe6, 0x03, 0x4f, 0xf3, _, _, 0x10, _, _, _, 0x23, 0x08, 0xa6, _, 0xba, _, _, 0xb7];
const B_LIMIT = [0xae, 0xb8, 0x04, 0xe6, 0x84, 0x4f, 0xf3, _, _, 0x10, _, _, _, 0x23, 0x08, 0xa6, _, 0xba, _, _, 0xb7];

function lockoutAt(rom: Uint8Array, page: number, pat: readonly number[], stride: number): number | null {
  const L = pat.length;
  const cmp = pat.indexOf(0x10) + 1;
  const at = new Set(codeHits(rom, page, pat)
    .filter((h) => rom[h + cmp] === 0x83 || rom[h + cmp] === 0xb3)
    .filter((h) => w16(rom, h + L - 3) === w16(rom, h + L))
    .map((h) => rom[h + L - 5]!)
    .filter((n) => n < stride));
  return at.size === 1 ? [...at][0]! : null;
}

const at = (page: number, a: number): number => (a < 0xe000 ? page + a : a);

function codeHits(rom: Uint8Array, page: number, pat: readonly number[]): number[] {
  return find(rom, page + 0x2800, Math.min(rom.length, page + (page ? 0xe000 : 0x10000)), pat);
}

function readA(rom: Uint8Array, page: number): { descs: Desc[][]; src: string } | Refusal | null {
  for (const p of codeHits(rom, page, A_FILL)) {
    let q = p + A_FILL.length;
    let flag: number;
    if (rom[q] === 0x86) { flag = rom[q + 1]!; q += 2; }
    else if (rom[q] === 0xb6) { flag = rom[at(page, w16(rom, q + 1))]!; q += 3; }
    else continue;
    if (!matches(rom, q, [0x30, 0x88, _, 0xa5, _, 0x27, 0xf9])) continue;
    const stride = rom[q + 2]!;
    const flagAt = rom[q + 4]!;
    if (stride < 16 || stride > 32 || flag === 0 || flagAt >= stride) continue;
    const meterCall = codeHits(rom, page, A_METER).find((h) => rom[h + 5] === rom[h + 1]! + 1 && rom[h + 1]! >= 6 && rom[h + 1]! + 1 < stride);
    if (!codeHits(rom, page, A_MASK).length || !codeHits(rom, page, A_VALUE).length || meterCall === undefined) {
      return { refused: `M1A/B coin descriptors at ${hex(w16(rom, p + 5))}: the coin code that reads them is not the known shape` };
    }
    const meterAt = rom[meterCall + 1]!;
    const paysChange = codeHits(rom, page, A_CHANGE).length > 0;
    const list = w16(rom, p + 2);
    const table = w16(rom, p + 5);
    const n = (w16(rom, p + 9) - list) / 2;
    if (!Number.isInteger(n) || n < 1 || n > 8) continue;
    const end = Math.min(rom.length, table < 0xe000 ? page + 0xe000 : 0x10000);
    const lockAt = lockoutAt(rom, page, A_LIMIT, stride);
    const descs: Desc[][] = [];
    let g0 = at(page, table);
    for (let g = 0; g < n; g++) {
      const group: Desc[] = [];
      for (let r = g0; ; r += stride) {
        if (r + stride > end) return { refused: `M1A/B coin descriptors at ${hex(table)} run off the program` };
        if (r !== g0 && (rom[r + flagAt]! & flag)) break;
        group.push({
          mask: rom[r + 2]!, credit: rom[r + 3]!, change: paysChange ? rom[r + 4]! : 0,
          meter: rom[r + meterAt]!, count: rom[r + meterAt + 1]!, count2: rom[r + meterAt + 5]!,
          lockout: lockAt === null ? null : rom[r + lockAt]!, at: r & 0xffff,
        });
        if (w16(rom, r) === 0) break;
      }
      descs.push(group);
      let r = g0 + stride;
      while (r + stride <= end && !(rom[r + flagAt]! & flag)) r += stride;
      g0 = r;
    }
    return { descs, src: `M1A/B coin descriptors (${stride}-byte) ${hex(table)}, filled at ${hex(p & 0xffff)}` };
  }
  return null;
}

function readB(rom: Uint8Array, page: number): { descs: Desc[][]; src: string } | Refusal | null {
  for (const p of codeHits(rom, page, B_FILL)) {
    if (!codeHits(rom, page, B_VALUE).length || !codeHits(rom, page, B_CHANGE).length) {
      return { refused: `M1A/B coin descriptor chains at ${hex(w16(rom, p + 1))}: the coin code that reads them is not the known shape` };
    }
    const ptrs = w16(rom, p + 1);
    const n = (w16(rom, p + 8) - ptrs) / 2;
    if (!Number.isInteger(n) || n < 1 || n > 8) continue;
    const stride = 0x15;
    const lockAt = lockoutAt(rom, page, B_LIMIT, stride);
    const descs: Desc[][] = [];
    for (let k = 0; k < n; k++) {
      const group: Desc[] = [];
      const first = w16(rom, at(page, ptrs) + 2 * k);
      const end = first < 0xe000 ? page + 0xe000 : 0x10000;
      for (let r = at(page, first); ; r += stride) {
        if (first < 0x2800 || r + stride > end || group.length > 8) return { refused: `M1A/B coin descriptor chains at ${hex(ptrs)} run off the program` };
        group.push({
          mask: 1 << k, credit: rom[r]!, change: rom[r + 2]! & 4 ? rom[r + 1]! : 0,
          meter: rom[r + 11]!, count: rom[r + 12]!, count2: rom[r + 16]!,
          lockout: lockAt === null ? null : rom[r + lockAt]!, at: r & 0xffff,
        });
        if (w16(rom, r + 7) === 0) break;
      }
      descs.push(group);
    }
    return { descs, src: `M1A/B coin descriptor chains (21-byte) from ${hex(ptrs)}, filled at ${hex(p & 0xffff)}` };
  }
  return null;
}

export function readM1abCoinTable(rom: Uint8Array): M1abCoinRead | Refusal {
  let r: { descs: Desc[][]; src: string } | Refusal | null = null;
  for (let page = 0; page < rom.length && r === null; page += 0x10000) r = readA(rom, page) ?? readB(rom, page);
  if (r === null) return { refused: 'no M1A/B coin descriptors in this program' };
  if ('refused' in r) return r;
  const lines = new Map<number, { credit: number; cash: boolean; token: boolean; count: number | null }>();
  const lockouts: (number | null)[] = [];
  const described = new Set<number>();
  const inert = new Set<number>();
  for (const group of r.descs) {
    const mask = group[0]!.mask;
    if (mask === 0 || (mask & (mask - 1)) !== 0 || group.some((d) => d.mask !== mask)) {
      return { refused: `a coin descriptor at ${hex(group[0]!.at)} names no single coin line` };
    }
    const line = 31 - Math.clz32(mask);
    if (lines.has(line)) return { refused: `two coin descriptor groups for one line (${hex(group[0]!.at)})` };
    const lock = new Set(group.map((d) => d.lockout));
    const l0 = group[0]!.lockout;
    while (lockouts.length <= line) lockouts.push(null);
    lockouts[line] = lock.size === 1 && l0 ? l0 : null;
    described.add(line);
    if (group.every((d) => d.credit === 0 && d.change === 0 && d.count === 0 && d.count2 === 0)) inert.add(line);
    const plain = new Set(group.filter((d) => d.change === 0).map((d) => d.credit));
    if (plain.size !== 1) continue;
    const credit = [...plain][0]!;
    if (group.some((d) => d.change !== 0 && d.credit >= credit)) continue;
    const counts = new Set(group.filter((d) => d.change === 0).map((d) => d.count));
    lines.set(line, {
      credit, cash: group.every((d) => d.meter === CASH_IN_METER), token: group.every((d) => d.meter === TOKEN_IN_METER),
      count: counts.size === 1 ? [...counts][0]! : null,
    });
  }
  if (lines.size < 3) return { refused: 'fewer than three coin lines read' };
  const sorted = [...lines].sort((a, b) => a[0] - b[0]);
  const units = new Set(sorted.filter(([, v]) => v.cash && v.count !== null && v.credit > 0).map(([, v]) => (v.count! * 10) / v.credit));
  const unit = units.size === 1 ? [...units][0]! : null;
  const coins: M1abLineCoin[] = [];
  for (let line = 0; line < 8; line++) {
    const v = lines.get(line);
    if (!described.has(line) || inert.has(line)) coins.push('none');
    else if (v === undefined) coins.push(null);
    else if (v.cash && v.count !== null && v.count > 0) coins.push({ pence: v.count * 10, token: false });
    else if (v.credit > 0 && unit !== null && Number.isInteger(v.credit * unit)) coins.push({ pence: v.credit * unit, token: v.token });
    else coins.push(null);
  }
  return {
    table: {
      lines: sorted.map(([line, v]) => ({ line, credits: v.credit, change: [], ...(v.token ? { token: true } : {}) })),
      pricePerCredit: null,
      source: `${r.src}: each line's credit with no change paid`,
    },
    cashMetered: sorted.filter(([, v]) => v.cash).map(([l]) => l),
    lockouts,
    coins,
  };
}
