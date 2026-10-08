
export interface EpochCoinType {
  readonly name: string;
  readonly pence: number;
  readonly codes: readonly number[];
  readonly token?: true;
}

export const EPOCH_COINS: readonly EpochCoinType[] = [
  { name: '1 POUND COIN', pence: 100, codes: [0x01, 0x05, 0x18, 0x12, 0x01, 0x1a, 0x11] },
  { name: '50P COIN', pence: 50, codes: [0x02, 0x04, 0x17, 0x11, 0x02, 0x0d, 0x12] },
  { name: '20P COIN', pence: 20, codes: [0x04, 0x02, 0x16, 0x10, 0x04, 0x0b, 0x13] },
  { name: '10P COIN', pence: 10, codes: [0x08, 0x01, 0x15, 0x0f, 0x08, 0x1c, 0x14] },
  { name: '5P  COIN', pence: 5, codes: [0x10, 0x00, 0x14, 0x00, 0x20, 0x08, 0x10] },
  { name: '20P TOKEN', pence: 20, codes: [0x20, 0x07, 0x1a, 0x13, 0x10, 0x0e, 0x15], token: true },
  { name: '2 POUND COIN', pence: 200, codes: [0x40, 0x06, 0x19, 0x00, 0x00, 0x1f, 0x10] },
];

export const CODE_SWITCHES: readonly number[] = [19, 20, 21, 22, 18];

const HOLD = 16_000_000 * 0.1;
const GAP = 16_000_000 * 0.25;

export class EpochCoin {
  private timer = 0;
  private phase: 'idle' | 'code' | 'gap' = 'idle';
  private switches: readonly number[] = CODE_SWITCHES;

  constructor(private readonly setSwitch: (n: number, on: boolean) => void) {}

  setSwitches(switches: readonly number[]): void {
    this.switches = [...switches];
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  reset(): void {
    this.phase = 'idle';
    this.timer = 0;
    this.present(0);
  }

  insertCode(code: number): void {
    if (this.busy || code === 0) return;
    this.phase = 'code';
    this.timer = HOLD;
    this.present(code);
  }

  insert(index: number, mode: number): void {
    const coin = EPOCH_COINS[index];
    if (!coin) return;
    this.insertCode(coin.codes[mode] ?? 0);
  }

  tick(cycles: number): void {
    if (this.phase === 'idle') return;
    this.timer -= cycles;
    if (this.timer > 0) return;
    if (this.phase === 'code') {
      this.present(0);
      this.phase = 'gap';
      this.timer = GAP;
      return;
    }
    this.phase = 'idle';
  }

  private present(code: number): void {
    this.switches.forEach((n, bit) => this.setSwitch(n, (code >> bit & 1) !== 0));
  }
}

export interface EpochCoinRecord {
  readonly codes: readonly number[];
  readonly event: number;
  readonly pence: number | null;
  readonly name: string;
  readonly token: boolean;
  readonly source: 'firmware' | 'mei-bco' | 'unread';
}

export interface EpochCoinTables {
  readonly modeWord: number;
  readonly selectorSwitch: number;
  readonly codeSwitches: readonly number[];
  readonly recordsAt: number;
  readonly records: readonly EpochCoinRecord[];
  readonly valuesAt: number | null;
}

const MEI_BCO: ReadonlyMap<number, { pence: number; name: string; token?: true }> = new Map([
  [0x08, { pence: 5, name: '5p' }],
  [0x1c, { pence: 10, name: '10p' }],
  [0x0b, { pence: 20, name: '20p' }],
  [0x19, { pence: 50, name: '50p (old)' }],
  [0x0d, { pence: 50, name: '50p' }],
  [0x1a, { pence: 100, name: '£1' }],
  [0x1f, { pence: 200, name: '£2' }],
  [0x0e, { pence: 20, name: '20p token', token: true }],
]);

const be16 = (rom: Uint8Array, a: number): number => (rom[a] << 8) | rom[a + 1];
const be32 = (rom: Uint8Array, a: number): number =>
  ((rom[a] << 24) | (rom[a + 1] << 16) | (rom[a + 2] << 8) | rom[a + 3]) >>> 0;

function findPattern(rom: Uint8Array, pat: readonly (number | null)[], from = 0): number {
  outer: for (let i = from; i + pat.length <= rom.length; i++) {
    for (let j = 0; j < pat.length; j++) {
      const p = pat[j];
      if (p !== null && rom[i + j] !== p) continue outer;
    }
    return i;
  }
  return -1;
}

function stringAt(rom: Uint8Array, a: number): string | null {
  if (a <= 0 || a >= rom.length) return null;
  let s = '';
  for (let i = a; i < rom.length && i < a + 24; i++) {
    const c = rom[i];
    if (c === 0) return s.length >= 2 ? s.trimEnd() : null;
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
  }
  return null;
}

export function findEpochCoinTables(rom: Uint8Array): EpochCoinTables | null {
  let modeWord = -1;
  let sw = -1;
  const sel = findPattern(rom, [
    0xfa, 0x05, 0x6a, 0xaa, 0x00, 0xfe, null, null,
    0x79, 0x02, 0x00, 0x05, 0x6b, 0xa2, 0x00, 0xfe, null, null,
  ]);
  if (sel >= 0) {
    modeWord = be16(rom, sel + 16);
    for (let a = sel - 6; a >= sel - 40 && a >= 0; a--) {
      if (rom[a] === 0x6b && rom[a + 1] === 0x22 && rom[a + 2] === 0x00) { sw = be32(rom, a + 2) & 0xffffff; break; }
    }
  } else {
    const alt = findPattern(rom, [
      0x6b, 0x22, 0x00, null, null, null, 0x0d, 0x20, 0x5e, null, null, null,
      0x79, 0x02, 0x00, 0x04, 0x6b, 0xa2, 0x00, 0xfe, null, null,
    ]);
    if (alt < 0) return null;
    sw = be32(rom, alt + 2) & 0xffffff;
    modeWord = be16(rom, alt + 20);
  }
  if (sw < 0 || sw + 12 > rom.length) return null;
  const selectorSwitch = be16(rom, sw);
  const codeSwitches = findEpochCodeLines(rom) ?? [0, 1, 2, 3, 4].map((i) => be16(rom, sw + 2 + 2 * i));

  const rec = findPattern(rom, [
    0x7a, 0x01, 0x00, 0x00, 0x00, 0x0e, 0x0f, 0xa0, 0x5e, null, null, null,
    0x0f, 0x83, 0x7a, 0x02, 0x00, null, null, null,
  ]);
  if (rec < 0) return null;
  const recordsAt = be32(rom, rec + 16) & 0xffffff;
  if (recordsAt + 14 * 8 > rom.length) return null;

  let valuesAt: number | null = null;
  for (let a = 0; a + 64 <= rom.length; a += 2) {
    if (be32(rom, a + 4) === 100 && be32(rom, a + 20) === 50 && be32(rom, a + 36) === 20 && be32(rom, a + 52) === 10) {
      valuesAt = a;
      break;
    }
  }
  const values = new Map<number, { pence: number; name: string | null }>();
  if (valuesAt !== null) {
    for (let i = 0; i < 8; i++) {
      const row = valuesAt + 16 * i;
      const mask = rom[row];
      const pence = be32(rom, row + 4);
      if (!mask || !pence || pence > 10_000) break;
      if (values.has(mask)) break;
      values.set(mask, { pence, name: stringAt(rom, be32(rom, row + 12) & 0xffffff) });
    }
  }

  const records: EpochCoinRecord[] = [];
  for (let i = 0; i < 7; i++) {
    const at = recordsAt + 14 * i;
    const codes = [0, 1, 2, 3, 4, 5].map((k) => be16(rom, at + 2 * k));
    const event = be16(rom, at + 12);
    if (codes.every((c) => c === 0) && event === 0) break;
    const fw = values.get(codes[0]);
    const bco = MEI_BCO.get(codes[5]);
    if (fw) {
      const name = fw.name ?? bco?.name ?? `coin ${i}`;
      records.push({ codes, event, pence: fw.pence, name, token: /TOKEN/i.test(name) || !!bco?.token, source: 'firmware' });
    } else if (bco) {
      records.push({ codes, event, pence: bco.pence, name: bco.name, token: !!bco.token, source: 'mei-bco' });
    } else {
      records.push({ codes, event, pence: null, name: `coin ${i} (value unread)`, token: false, source: 'unread' });
    }
  }
  if (!records.length) return null;
  return { modeWord, selectorSwitch, codeSwitches, recordsAt, records, valuesAt };
}

export function findEpochCodeLines(rom: Uint8Array): number[] | null {
  const bit3 = [
    0x6b, 0x22, 0x00, null, null, null, 0x0d, 0x20, 0x5e, null, null, null,
    0x0d, 0x03, 0x0d, 0x32, 0x10, 0x92, 0x10, 0x92, 0x10, 0x92, 0x6f, 0xe2, 0xff, 0xfe,
  ];
  for (let at = findPattern(rom, bit3); at >= 0; at = findPattern(rom, bit3, at + 2)) {
    const jsr = rom.subarray(at + 9, at + 12);
    const cmp = findPattern(rom.subarray(at + 26, at + 48), [0x79, 0x03, 0x00, 0x04, 0x1d, 0x32, 0x58, 0x60]);
    if (cmp < 0) continue;
    const reads: number[] = [];
    let a = at + 26 + cmp + 10;
    while (reads.length < 4 && a < at + 26 + cmp + 200 && a + 12 <= rom.length) {
      if (rom[a] === 0x6b && rom[a + 1] === 0x22 && rom[a + 2] === 0x00 && rom[a + 6] === 0x0d && rom[a + 7] === 0x20
        && rom[a + 8] === 0x5e && rom[a + 9] === jsr[0] && rom[a + 10] === jsr[1] && rom[a + 11] === jsr[2]) {
        reads.push(((rom[a + 3] << 16) | (rom[a + 4] << 8) | rom[a + 5]) >>> 0);
        a += 12;
      } else a += 2;
    }
    if (reads.length < 4) continue;
    const words = [reads[0], reads[1], reads[2], ((rom[at + 3] << 16) | (rom[at + 4] << 8) | rom[at + 5]) >>> 0, reads[3]];
    if (words.some((w) => w + 2 > rom.length)) continue;
    const lines = words.map((w) => be16(rom, w));
    if (lines.every((n) => n >= 1 && n <= 64) && new Set(lines).size === 5) return lines;
  }
  return null;
}

export interface EpochHopperCoin {
  pence: number;
  token: boolean;
  name: string;
}

export function findEpochHopperCoins(rom: Uint8Array): [EpochHopperCoin | null, EpochHopperCoin | null] {
  const out: [EpochHopperCoin | null, EpochHopperCoin | null] = [null, null];
  const values = epochValueRows(rom);
  const text = (a: number): string | null => {
    if (a <= 0 || a >= rom.length) return null;
    let s = '';
    for (let i = a; i < rom.length && i < a + 40; i++) {
      const c = rom[i];
      if (c === 0) return s;
      if (c < 0x20 || c > 0x7e) return null;
      s += String.fromCharCode(c);
    }
    return null;
  };
  for (let a = 0; a + 28 <= rom.length; a += 2) {
    const coin = be16(rom, a);
    if (!coin || coin > 0x80 || (coin & (coin - 1)) || be16(rom, a + 2) !== 0) continue;
    const ptr = be32(rom, a + 4);
    if (ptr === 0 || ptr >= rom.length) continue;
    const name = text(ptr);
    if (!name || !/hopper/i.test(name)) continue;
    const lines: number[] = [];
    for (let k = 0; k < 10; k++) lines.push(be16(rom, a + 8 + 2 * k));
    const one = lines.includes(41);
    const two = lines.includes(42);
    if (one === two) continue;
    const h = one ? 0 : 1;
    if (out[h]) continue;
    const v = values.get(coin);
    if (v) out[h] = { pence: v.pence, token: /TOKEN/i.test(v.name ?? ''), name: v.name ?? name };
  }
  return out;
}

function epochValueRows(rom: Uint8Array): Map<number, { pence: number; name: string | null }> {
  const rows = new Map<number, { pence: number; name: string | null }>();
  const rowAt = (a: number, mask: number): boolean => {
    if (rom[a] !== mask || rom[a + 1] || rom[a + 2] || rom[a + 3]) return false;
    const p = be32(rom, a + 4);
    return p > 0 && p <= 10_000;
  };
  for (let a = 0; a + 128 <= rom.length; a += 2) {
    if (!rowAt(a, 1) || !rowAt(a + 16, 2) || !rowAt(a + 32, 4) || !rowAt(a + 48, 8)) continue;
    for (let i = 0; i < 8; i++) {
      const r = a + 16 * i;
      const mask = rom[r];
      const pence = be32(rom, r + 4);
      if (!mask || (mask & (mask - 1)) || !pence || pence > 10_000 || rows.has(mask)) break;
      rows.set(mask, { pence, name: stringAt(rom, be32(rom, r + 12) & 0xffffff) });
    }
    break;
  }
  return rows;
}
