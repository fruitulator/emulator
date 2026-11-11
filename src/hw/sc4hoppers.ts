import { Hopper, v20Waveform } from './hopper';

export class Sc4HopperPair {
  private readonly units: [Hopper, Hopper];
  private p = 0;
  private supply = false;
  private enable2 = false;
  private hoppersWord = 0;
  private lastLine1: 0 | 2 | null = null;

  onCoin?: (hopper: 1 | 2) => void;

  static waveform(clockHz: number) {
    return v20Waveform((0x411e / clockHz) * 1000, { beam: 0x14, gap: 0x96, start: 0x1e, restart: 'clear' });
  }

  constructor(clockHz: number) {
    const wave = Sc4HopperPair.waveform(clockHz);
    this.units = [new Hopper(clockHz, wave), new Hopper(clockHz, wave)];
    this.units[0].onCoin = () => this.onCoin?.(1);
    this.units[1].onCoin = () => this.onCoin?.(2);
    for (const u of this.units) u.optoDriveLine(true);
  }

  setHoppersWord(word: number): void {
    this.hoppersWord = word & 0xff;
  }

  get paid1(): number { return this.units[0].paid; }
  get paid2(): number { return this.units[1].paid; }
  get running1(): boolean { return this.units[0].running; }
  get running2(): boolean { return this.units[1].running; }

  reset(): void {
    for (const u of this.units) {
      u.reset();
      u.optoDriveLine(true);
    }
    this.p = 0;
    this.supply = false;
    this.enable2 = false;
    this.lastLine1 = null;
  }

  drivenLine(hopper: 1 | 2): number | null {
    if (hopper === 2) return 1;
    const on = this.p & 0x05;
    return on === 1 ? 0 : on === 4 ? 2 : on === 5 ? null : this.lastLine1;
  }

  tick(cycles: number): void {
    this.units[0].tick(cycles);
    this.units[1].tick(cycles);
  }

  writeP03(x: number): void {
    this.p = x & 0xff;
    this.drive();
  }

  writePayen1(x: number): void {
    this.supply = (x & 0xff) === 0x4d;
    this.drive();
  }

  writePayen2(x: number): void {
    this.enable2 = (x & 0xff) === 0x4d;
    this.drive();
  }

  private drive(): void {
    const on = this.supply && this.enable2;
    if (on && (this.p & 0x05) !== 0) this.lastLine1 = (this.p & 0x05) === 1 ? 0 : (this.p & 0x05) === 4 ? 2 : null;
    this.units[0].motorDrive(on && (this.p & 0x05) !== 0);
    this.units[1].motorDrive(on && (this.p & 0x02) !== 0);
  }

  private test(n: 0 | 1): boolean {
    const mask = n === 0 ? 0x09 : 0x0a;
    return this.supply && (this.p & mask) === mask;
  }

  private pin(n: 0 | 1): number {
    return this.test(n) ? 1 : this.units[n].countPin();
  }

  readPay(rio = false): number {
    const s1 = this.pin(0);
    const s2 = this.pin(1);
    let hop: number;
    switch (this.hoppersWord & 0x50) {
      case 0x10:
        hop = (s1 * (this.p & 0x05)) | (s2 << 1);
        break;
      case 0x00: {
        const v = (n: 0 | 1) => (((this.units[n].opto ? 1 : 0) ^ (this.test(n) ? 1 : 0)) ? 3 : 0);
        hop = (v(0) + v(1)) | 0x04;
        break;
      }
      default:
        hop = (s1 << 1) | (s2 ^ (this.units[1].running ? 1 : 0));
        break;
    }
    return (hop & 0xff) | (this.enable2 ? 0x40 : 0) | 0x20 | (rio ? 0x04 : 0);
  }

  readUnfitted(rio: boolean, strobe13 = 0): number {
    return (this.enable2 ? 0x40 : 0) | 0x20 | (strobe13 & 0x9f) | (rio ? 0x04 : 0)
      | ((this.p & 0x08) !== 0 ? 1 : 0) | 0x02;
  }
}

export type Sc4PayoutUnits =
  | { form: 'table'; table: number; countAt: number; modeAt?: number }
  | { form: 'list'; list: number };

export interface Sc4Coin { pence: number; token: boolean }

export interface Sc4HopperCoins {
  line: [Sc4Coin | null, Sc4Coin | null];
  cctalk: Map<number, Sc4Coin | null>;
}

export function locateSc4PayoutUnits(rom: Uint8Array, limit = rom.length): Sc4PayoutUnits | null {
  const end = Math.min(limit, rom.length);
  const w = (a: number): number => (a >= 0 && a + 1 < end ? (rom[a] << 8) | rom[a + 1] : -1);
  const l = (a: number): number => (a >= 0 && a + 3 < end ? ((w(a) << 16) | w(a + 2)) >>> 0 : -1);
  const tables = new Map<string, number>();
  const lists = new Map<number, number>();
  for (let a = 0; a + 6 < end; a += 2) {
    const op = w(a);
    if ((op & 0xf1ff) !== 0x207c) continue;
    const reg = (op >> 9) & 7;
    const base = l(a + 2);
    const step = 0xd1c0 | (reg << 9);
    let by64 = false;
    let countAt = -1;
    for (let k = a + 6; k < a + 0x90 && k + 6 < end; k += 2) {
      if (w(k) === 0x7040 && w(k + 2) === step) by64 = true;
      if ((w(k) & 0xf1ff) === 0xb079) countAt = l(k + 2);
      if (by64 && countAt >= 0) break;
    }
    const n = (countAt - base) / 64;
    if (by64 && Number.isInteger(n) && n >= 1 && n <= 16) {
      const key = `${base}:${countAt}`;
      tables.set(key, (tables.get(key) ?? 0) + 1);
      continue;
    }
    let by20 = false;
    let tst = false;
    for (let k = a + 6; k < a + 0x20 && k + 4 < end; k += 2) {
      if (w(k) === 0x7014 && w(k + 2) === step) by20 = true;
      if (w(k) === (0x4a90 | reg)) tst = true;
    }
    if (by20 && tst) lists.set(base, (lists.get(base) ?? 0) + 1);
  }
  const byVotes = <K>(m: Map<K, number>): K[] => [...m].sort((x, y) => y[1] - x[1]).map(([k]) => k);
  for (const key of byVotes(tables)) {
    const [table, countAt] = key.split(':').map(Number);
    if (countAt + 1 < end && w(countAt) !== (countAt - table) / 64) continue;
    const modeAt = locateSc4UnitMode(w, l, table, end);
    return modeAt === null ? { form: 'table', table, countAt } : { form: 'table', table, countAt, modeAt };
  }
  for (const list of byVotes(lists)) {
    if (list + 3 >= end) continue;
    const first = l(list);
    if (first > 0 && first < end) return { form: 'list', list };
  }
  return null;
}

function locateSc4UnitMode(w: (a: number) => number, l: (a: number) => number, table: number, end: number): number | null {
  for (let a = 8; a + 8 < end; a += 2) {
    if (w(a) !== 0x0281 || l(a + 2) !== 4 || w(a + 6) !== 0xb081) continue;
    const load = w(a - 2);
    if ((load & 0xfff8) !== 0x3210) continue;
    const reg = load & 7;
    let field = -1; let walks = false;
    for (let k = a - 4; k >= Math.max(0, a - 0x30); k -= 2) {
      if (w(k) === (0x207c | (reg << 9))) field = l(k + 2);
      if ((w(k) & 0xf1ff) === 0x207c && l(k + 2) === table) walks = true;
    }
    if (field >= 0 && walks) return field;
  }
  return null;
}

export function readSc4HopperCoins(
  units: Sc4PayoutUnits | null, word: (addr: number) => number,
  enabled?: (fn: number) => boolean | null,
): Sc4HopperCoins {
  const out: Sc4HopperCoins = { line: [null, null], cctalk: new Map() };
  if (!units) return out;
  const long = (a: number): number => {
    const hi = word(a);
    const lo = word(a + 2);
    return hi < 0 || lo < 0 ? -1 : ((hi << 16) | lo) >>> 0;
  };
  const lineBad = [false, false];
  const busBad = new Set<number>();
  const same = (x: Sc4Coin, y: Sc4Coin): boolean => x.pence === y.pence && x.token === y.token;
  const onLine = (line: number, coin: Sc4Coin): void => {
    if (line < 0 || line > 2) return;
    const h = line === 1 ? 1 : 0;
    const had = out.line[h];
    if (lineBad[h]) return;
    if (had === null) out.line[h] = coin;
    else if (!same(had, coin)) { out.line[h] = null; lineBad[h] = true; }
  };
  const onBus = (addr: number, coin: Sc4Coin): void => {
    if (busBad.has(addr)) return;
    const had = out.cctalk.get(addr);
    if (had === undefined || had === null) out.cctalk.set(addr, coin);
    else if (!same(had, coin)) { out.cctalk.set(addr, null); busBad.add(addr); }
  };
  const priced = (p: number): boolean => p > 0 && p <= 100_000;

  if (units.form === 'table') {
    const n = word(units.countAt);
    if (n < 1 || n !== (units.countAt - units.table) / 64) return out;
    for (let i = 0; i < n; i++) {
      const r = units.table + 64 * i;
      const head = word(r);
      if (head < 0 || head >> 8 !== 0) continue;
      const fn = enabled ? long(r + 0x3c) : 0;
      if (fn > 0 && enabled?.(fn) === false) continue;
      const pence = long(r + 2);
      const drive = long(r + 0x1e);
      const first = drive < 0 ? -1 : word(drive);
      if (!priced(pence) || first < 0) continue;
      const coin = { pence, token: false };
      if (first <= 3) onLine(first, coin);
      else if (first >> 8 >= 2) onBus(first >> 8, coin);
    }
    return out;
  }
  for (let e = units.list, i = 0; i < 16; e += 20, i++) {
    const r = long(e);
    if (r <= 0) break;
    const pence = word(r);
    const kind = word(r + 2);
    const w6 = word(r + 6);
    if (!priced(pence) || w6 < 0 || (kind !== 4 && kind !== 6)) continue;
    onLine(w6 >> 8, { pence, token: kind === 6 });
  }
  return out;
}

export function sc4UnitCoin(
  units: Sc4PayoutUnits & { form: 'table' }, word: (addr: number) => number,
  enabled: (fn: number, mode: number) => boolean | null, mode: number, line: number,
): Sc4Coin | null {
  const long = (a: number): number => ((word(a) << 16) | word(a + 2)) >>> 0;
  let coin: Sc4Coin | null = null;
  for (let i = 0, n = word(units.countAt); i < n; i++) {
    const r = units.table + 64 * i;
    if (word(r) >> 8 !== mode) continue;
    if (word(long(r + 0x1e)) !== line) continue;
    const fn = long(r + 0x3c);
    if (fn > 0 && enabled(fn, mode) === false) continue;
    const value = long(r + 2);
    if (value <= 0 || value > 100_000) return null;
    if (coin !== null && coin.pence !== value) return null;
    coin = { pence: value, token: false };
  }
  return coin;
}

export function sc4UnitEnabled(fn: number, word: (addr: number) => number, switchOn: (id: number) => boolean | null, unitMode = 0): boolean | null {
  const byMode = sc4UnitByMode(fn, word, unitMode);
  if (byMode !== undefined) return byMode;
  const oneSwitch = (a: number): { id: number; next: number } | null => {
    if (word(a) !== 0x3f3c || word(a + 4) !== 0x4eb9) return null;
    return { id: word(a + 2), next: a + 10 };
  };
  const one = oneSwitch(fn);
  if (one) {
    const on = switchOn(one.id);
    if (on === null) return null;
    const after = word(one.next);
    const skip = after === 0x548f ? one.next + 2 : -1;
    if (skip < 0) return null;
    if (word(skip) === 0x4e75) return on;
    if (word(skip) === 0x48c0 && word(skip + 2) === 0x5380) return !on;
    return null;
  }
  if (word(fn) !== 0x2f02 || word(fn + 2) !== 0x6100 || word(fn + 6) !== 0x3400) return null;
  const disp = word(fn + 4);
  const mode = sc4UnitMode(fn + 4 + (disp >= 0x8000 ? disp - 0x10000 : disp), word, switchOn);
  if (mode === null) return null;
  const modes: number[] = [];
  let p = fn + 8;
  for (let n = 0; n < 4; n++) {
    if ((word(p) & 0xff00) === 0x6700) { modes.push(0); p += 2; continue; }
    if (word(p) === 0x0c42 && (word(p + 4) & 0xff00) === 0x6700) { modes.push(word(p + 2)); p += 6; continue; }
    break;
  }
  return modes.length ? modes.includes(mode) : null;
}

function sc4UnitByMode(fn: number, word: (addr: number) => number, mode: number): boolean | null | undefined {
  if (word(fn) !== 0x3f3c || word(fn + 2) !== 0xffff || word(fn + 4) !== 0x4eb9 || word(fn + 10) !== 0x548f) return undefined;
  if (word(fn + 12) !== 0x0240 || word(fn + 14) !== 4) return undefined;
  const test = word(fn + 16);
  if (test !== 0x670c && test !== 0x660c) return undefined;
  if (word(fn + 18) !== 0x4eb9 || word(fn + 24) !== 0x0240 || word(fn + 26) !== 2 || (word(fn + 28) & 0xff00) !== 0x6700) return undefined;
  const on = fn + 30;
  if (((mode & 4) !== 0) === (test === 0x660c)) {  } else {
    const getFlags = (word(fn + 20) << 16 | word(fn + 22)) >>> 0;
    if (word(getFlags) !== 0x3039 || word(getFlags + 6) !== 0x4e75) return undefined;
    const flags = word((word(getFlags + 2) << 16 | word(getFlags + 4)) >>> 0);
    if (flags < 0) return null;
    if ((flags & 2) === 0) return false;
  }
  if (word(on) === 0x7001) return true;
  if (word(on) !== 0x3039) return undefined;
  const held = word((word(on + 2) << 16 | word(on + 4)) >>> 0);
  if (held < 0) return null;
  if (word(on + 6) === 0x4e75) return held !== 0;
  if (word(on + 6) === 0x48c0 && word(on + 8) === 0x5380) return held === 0;
  return undefined;
}

function sc4UnitMode(at: number, word: (addr: number) => number, switchOn: (id: number) => boolean | null): number | null {
  let mode = 0; let found = 0;
  for (let a = at; a < at + 0x40; a += 2) {
    if (word(a) !== 0x3f3c || word(a + 4) !== 0x4eb9) continue;
    for (let k = a + 10; k < a + 22; k += 2) {
      if (word(k) !== 0x0044) continue;
      const on = switchOn(word(a + 2));
      if (on === null) return null;
      if (on) mode |= word(k + 2);
      found++;
      break;
    }
  }
  return found ? mode : null;
}
