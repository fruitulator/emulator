import { Hopper, v20Waveform } from './hopper';

export class Sc4HopperPair {
  private readonly units: [Hopper, Hopper];
  private p = 0;
  private supply = false;
  private enable2 = false;
  private hoppersWord = 0;

  onCoin?: (hopper: 1 | 2) => void;

  static waveform(clockHz: number) {
    return v20Waveform((0x411e / clockHz) * 1000, { beam: 0x14, gap: 0x96, start: 0x1e });
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

  readPay(): number {
    const s1 = this.pin(0);
    const s2 = this.pin(1);
    let hop: number;
    switch (this.hoppersWord & 0x50) {
      case 0x10:
        hop = (s1 * (this.p & 0x05)) | (s2 << 1);
        break;
      case 0x00: {
        const v = (n: 0 | 1) => (((this.units[n].opto ? 1 : 0) ^ (this.test(n) ? 1 : 0)) ? 3 : 0);
        hop = v(0) + v(1);
        break;
      }
      default:
        hop = (s1 << 1) | (s2 ^ (this.units[1].running ? 1 : 0));
        break;
    }
    return (hop & 0xff) | (this.enable2 ? 0x40 : 0) | 0x20 | 0x04;
  }
}

export type Sc4PayoutUnits =
  | { form: 'table'; table: number; countAt: number }
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
    return { form: 'table', table, countAt };
  }
  for (const list of byVotes(lists)) {
    if (list + 3 >= end) continue;
    const first = l(list);
    if (first > 0 && first < end) return { form: 'list', list };
  }
  return null;
}

export function readSc4HopperCoins(units: Sc4PayoutUnits | null, word: (addr: number) => number): Sc4HopperCoins {
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
