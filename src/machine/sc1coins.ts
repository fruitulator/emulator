import { detectCoins, type CoinLine, type CoinLineTable, type Refusal } from './coinwiring';
import type { CashLedger } from './machine';

const REC = 27;
export const SC1_COIN_LINES = 5;
const TOKEN_CHUTE = 4;

export const SELECTOR = [0x34, 0x02, 0xa6, 0x01, 0x85, 0x08, 0x26, 0x05, 0x30, 0x88, 0x1b, 0x20, 0xf5,
  0x10, 0xae, 0x0a, 0x27, 0x09, 0x6d, 0xa4, 0x2a, 0x05, 0x30, 0x88, 0x1b, 0x20, 0xf2, 0x35, 0x02, 0x39];
export const CREDIT_ADD = [0xa6, 0x02, 0x31, 0xa6, 0x10, 0xbf];
const SCAN_BODY = [0xa6, 0x84, 0x44, 0x44, 0x44, 0x44, 0xb1, -1, -1, 0x27, 0x09, 0xb7, -1, -1, 0xbd, -1, -1,
  0xb7, -1, -1, 0x11, 0xa3, 0x02, 0x26, 0x06, 0xa6, 0x01, 0xaa, 0xe4, 0xa7, 0xe4];

const SEQUENCE = [0x8e, -1, -1, 0x8c, -1, -1, 0x24, -1, 0xb6, -1, -1, 0xb8, -1, -1, 0x43, 0xb4, -1, -1,
  0xa5, 0x04, 0x27, 0x05, 0xc6, 0xff, 0xe7, 0x98, 0x02];

export interface Sc1CoinTables {
  table: number;
  groups: number;
  coinByte: number;
  switches: readonly number[];
  switchFlag: number | null;
  sequences: readonly { first: number; second: number }[];
  lock?: Sc1CoinLock | null;
}

export interface Sc1CoinLock {
  lockByte: number;
  lastByte: number;
  sequenceForce: number | null;
}

export type Sc1Mem = (a: number) => number;

export function at(rom: Uint8Array, p: number, sig: readonly number[]): boolean {
  if (p < 0 || p + sig.length > rom.length) return false;
  for (let k = 0; k < sig.length; k++) if (sig[k]! >= 0 && rom[p + k] !== sig[k]) return false;
  return true;
}

export function findAll(rom: Uint8Array, sig: readonly number[]): number[] {
  const out: number[] = [];
  for (let p = 0; p + sig.length <= rom.length; p++) if (at(rom, p, sig)) out.push(p);
  return out;
}

export const word = (rom: Uint8Array, p: number): number => (rom[p]! << 8) | rom[p + 1]!;

export function locateSc1CoinTables(rom: Uint8Array): Sc1CoinTables | Refusal {
  const found = new Set<string>();
  for (let p = 0; p + 12 <= rom.length; p++) {
    if (rom[p] !== 0xc6 || rom[p + 2] !== 0x34 || rom[p + 3] !== 0x04 || rom[p + 4] !== 0x8e
      || rom[p + 7] !== 0x17 || rom[p + 10] !== 0xa5 || rom[p + 11] !== 0x0c) continue;
    const rel = ((rom[p + 8]! << 8) | rom[p + 9]!) << 16 >> 16;
    if (!at(rom, p + 10 + rel, SELECTOR)) continue;
    found.add(`${word(rom, p + 5)},${rom[p + 1]!}`);
  }
  if (found.size !== 1) return { refused: found.size ? 'the program names two coin tables' : 'no coin records found in the program' };
  const [table, groups] = [...found][0]!.split(',').map(Number) as [number, number];
  if (table < 0x8000 || table + groups * REC * 4 > rom.length) return { refused: 'the coin records are not in fixed ROM' };
  if (groups < 1 || groups > 8) return { refused: 'the coin record count is out of range' };
  if (findAll(rom, CREDIT_ADD).length !== 1) return { refused: 'the program\'s credit routine was not found' };

  const scans = findAll(rom, SCAN_BODY);
  if (scans.length !== 1) return { refused: scans.length ? 'the program has two switch scans' : 'the program\'s switch scan was not found' };
  const body = scans[0]!;
  const head = body - 5;
  if (rom[head] !== 0xbc || rom[head + 3] !== 0x24) return { refused: 'the switch scan\'s loop was not read' };
  let switches: number[];
  let switchFlag: number | null = null;
  if (rom[head - 11] === 0x8e && rom[head - 8] === 0x7d && rom[head - 5] === 0x27 && rom[head - 4] === 0x03 && rom[head - 3] === 0x8e) {
    switches = [word(rom, head - 10), word(rom, head - 2)];
    switchFlag = word(rom, head - 7);
  } else if (rom[head - 3] === 0x8e) {
    switches = [word(rom, head - 2)];
  } else return { refused: 'the switch scan\'s table was not read' };
  let coinByte = -1;
  for (let p = head - 0x80; p < head; p++) {
    if (rom[p] === 0x6f && rom[p + 1] === 0xe2 && rom[p + 2] === 0xce) {
      if (coinByte >= 0) return { refused: 'the switch scan names two coin bytes' };
      coinByte = word(rom, p + 3);
    }
  }
  if (coinByte < 0 || coinByte >= 0x2000) return { refused: 'the switch scan\'s coin byte was not found' };
  if (switches.some((s) => s < 0x8000 || s >= rom.length)) return { refused: 'the switch table is not in fixed ROM' };
  const sequences = readCoinSequences(rom, 0x8000);
  if ('refused' in sequences) return sequences;
  return { table, groups, coinByte, switches, switchFlag, sequences, lock: readCoinLock(rom, coinByte) };
}

const DEBOUNCE_TAIL = [0x43, 0xb4, -1, -1, 0xb7, -1, -1, 0x43, 0xba, -1, -1, 0x43, 0xba, -1, -1, 0xb7, -1, -1];

export function readCoinLock(rom: Uint8Array, coinByte: number): Sc1CoinLock | null {
  const hits: Sc1CoinLock[] = [];
  for (const p of findAll(rom, DEBOUNCE_TAIL)) {
    const last = word(rom, p + 2);
    const lockByte = word(rom, p + 9);
    const pending = word(rom, p + 13);
    if (word(rom, p + 16) !== pending || lockByte >= 0x2000 || last >= 0x2000) continue;
    if (!findAll(rom, [0xa6, 0x0c, 0xb5, pending >> 8, pending & 0xff]).length) continue;
    let reads = false;
    let stores = false;
    for (let q = Math.max(0, p - 0x60); q < p; q++) {
      if (at(rom, q, [0xb6, coinByte >> 8, coinByte & 0xff, 0xb8, last >> 8, last & 0xff])) reads = true;
      if (!reads && at(rom, q, [0xb7, lockByte >> 8, lockByte & 0xff])) stores = true;
    }
    if (reads && stores) hits.push({ lockByte, lastByte: last, sequenceForce: null });
  }
  if (hits.length !== 1) return null;
  const lock = hits[0]!;
  const seqs = findAll(rom, SEQUENCE);
  if (seqs.length === 1) {
    if (word(rom, seqs[0]! + 9) !== lock.lockByte) return null;
    lock.sequenceForce = word(rom, seqs[0]! + 12);
  }
  return lock;
}

export function sc1LockedLines(t: Sc1CoinTables, rom: Uint8Array, mem: Sc1Mem): number {
  if (!t.lock) return 0;
  const coins = sc1LineCoins(t, rom, mem);
  if (!Array.isArray(coins)) return 0;
  const lock = mem(t.lock.lockByte);
  const force = t.lock.sequenceForce === null ? 0 : mem(t.lock.sequenceForce);
  let m = 0;
  for (const c of coins) {
    const seq = c.sw.length > 1 ? t.sequences.find((q) => q.first === c.mask) : undefined;
    const locked = seq ? ((lock ^ force) & (seq.first | seq.second)) !== 0 : (lock & c.mask) !== 0;
    if (locked) m |= 1 << c.line;
  }
  return m;
}

export function sc1PlainCoinMask(t: Sc1CoinTables, rom: Uint8Array, mem: Sc1Mem, line: number): number {
  const coins = sc1LineCoins(t, rom, mem);
  if (!Array.isArray(coins)) return 0;
  const c = coins.find((q) => q.line === line);
  return c && c.sw.length === 1 ? c.mask : 0;
}

export class CoinLockJudge {
  line = -1;
  mask = 0;
  locked = false;
  seen = false;
  wait = 0;
  bookedIn = 0;
  bookedToken = 0;
  bookedUnpriced = 0;

  begin(line: number, mask: number, lockedAtDrop: boolean, waitCycles: number): void {
    this.line = mask ? line : -1;
    this.mask = mask;
    this.locked = lockedAtDrop;
    this.seen = false;
    this.wait = waitCycles;
    this.bookedIn = this.bookedToken = this.bookedUnpriced = 0;
  }

  book(l: CashLedger, booking: () => void): void {
    const [i0, t0, u0] = [l.inPence, l.tokenInPence, l.unpricedTokenIn];
    booking();
    this.bookedIn = l.inPence - i0;
    this.bookedToken = l.tokenInPence - t0;
    this.bookedUnpriced = l.unpricedTokenIn - u0;
  }

  watch(cycles: number, lock: Sc1CoinLock | null | undefined, mem: Sc1Mem, l: CashLedger): 'refused' | 'taken' | null {
    if (this.line < 0) return null;
    if (!lock) { this.line = -1; return null; }
    const inLast = (mem(lock.lastByte) & this.mask) !== 0;
    if (!this.seen || inLast) {
      if (inLast) this.seen = true;
      this.wait -= cycles;
      if (this.wait <= 0) this.line = -1;
      return null;
    }
    this.line = -1;
    const lockedNow = (mem(lock.lockByte) & this.mask) !== 0;
    if (lockedNow === this.locked) return null;
    if (!lockedNow) return 'taken';
    l.inPence -= this.bookedIn;
    l.tokenInPence -= this.bookedToken;
    l.unpricedTokenIn -= this.bookedUnpriced;
    return 'refused';
  }
}

export function readCoinSequences(rom: Uint8Array, base: number): { first: number; second: number }[] | Refusal {
  const seqs = findAll(rom, SEQUENCE);
  if (seqs.length > 1) return { refused: 'the program has two coin sequence tables' };
  const sequences: { first: number; second: number }[] = [];
  if (seqs.length) {
    const s0 = word(rom, seqs[0]! + 1);
    const s1 = word(rom, seqs[0]! + 4);
    if (s0 < base || s1 > rom.length || s1 < s0 || (s1 - s0) % 6 !== 0 || s1 - s0 > 6 * 8) return { refused: 'the coin sequence table was not read' };
    for (let x = s0; x < s1; x += 6) sequences.push({ first: rom[x + 4]!, second: rom[x + 5]! });
  }
  return sequences;
}

interface Entry { sw: number; bit: number; addr: number }

function switchEntries(t: Sc1CoinTables, rom: Uint8Array, mem: Sc1Mem): Entry[] {
  const start = t.switchFlag !== null && mem(t.switchFlag) !== 0 ? t.switches[1]! : t.switches[0]!;
  const out: Entry[] = [];
  for (let x = start; x + 4 <= rom.length && out.length < 64; x += 4) {
    if (rom[x] === 0xff || x === t.table) break;
    out.push({ sw: rom[x]!, bit: rom[x + 1]!, addr: word(rom, x + 2) });
  }
  return out;
}

export interface Sc1Coin {
  at: number;
  mask: number;
  credits: number;
  change: number;
  counter: number;
}

export function sc1Coins(t: Sc1CoinTables, rom: Uint8Array, mem: Sc1Mem): Sc1Coin[] | Refusal {
  const out: Sc1Coin[] = [];
  let x = t.table;
  const end = t.table + (t.groups * 4 + 4) * REC;
  for (let g = 0; g < t.groups; g++) {
    while (x < end && !(rom[x + 1]! & 0x08)) x += REC;
    for (;;) {
      if (x >= end) return { refused: 'the coin records run past their table' };
      const ptr = word(rom, x + 10);
      if (ptr === 0 || !(mem(ptr) & 0x80)) break;
      x += REC;
    }
    const mask = rom[x + 12]!;
    if (!mask || (mask & (mask - 1)) !== 0) return { refused: 'a coin record names no single coin bit' };
    if (out.some((c) => c.mask === mask)) return { refused: 'two coin records name one coin bit' };
    out.push({ at: x, mask, credits: rom[x + 2]!, change: rom[x + 3]!, counter: rom[x + 15]! });
    x += REC;
  }
  return out;
}

export interface Sc1CoinSwitch { strobe: number; bit: number }

export interface Sc1LineCoin extends Sc1Coin { line: number; sw: Sc1CoinSwitch[]; token: boolean }

export function sc1LineCoins(t: Sc1CoinTables, rom: Uint8Array, mem: Sc1Mem): Sc1LineCoin[] | Refusal {
  const coins = sc1Coins(t, rom, mem);
  if (!Array.isArray(coins)) return coins;
  const entries = switchEntries(t, rom, mem);
  const big = coins.reduce((a, b) => (b.credits + b.change > a.credits + a.change ? b : a));
  const out: Sc1LineCoin[] = [];
  const switchOf = (mask: number): Sc1CoinSwitch | null => {
    const hits = entries.filter((e) => e.addr === t.coinByte && e.bit === mask);
    return hits.length === 1 ? { strobe: (hits[0]!.sw >> 4) & 7, bit: hits[0]!.sw & 7 } : null;
  };
  for (const c of coins) {
    const sw = switchOf(c.mask);
    if (!sw) continue;
    const sws = [sw];
    const seq = t.sequences.find((q) => q.first === c.mask);
    if (seq) {
      const second = switchOf(seq.second);
      if (!second) continue;
      sws.push(second);
    }
    const token = c.counter !== 0 && c.counter !== big.counter;
    let line: number | null = null;
    if (sw.strobe === 0 && sw.bit < TOKEN_CHUTE && sws.length === 1) line = sw.bit;
    else if (token || (sw.strobe === 0 && sw.bit === TOKEN_CHUTE)) line = TOKEN_CHUTE;
    if (line === null || out.some((o) => o.line === line)) continue;
    out.push({ ...c, line, sw: sws, token });
  }
  return out.sort((a, b) => a.line - b.line);
}

export function sc1CoinTable(t: Sc1CoinTables, rom: Uint8Array, mem: Sc1Mem, board = 'Scorpion 1'): CoinLineTable | Refusal {
  const coins = sc1LineCoins(t, rom, mem);
  if (!Array.isArray(coins)) return coins;
  if (!coins.length) return { refused: 'no coin record is on a switch the board drops coins on' };
  const source = `${board} coin records at $${t.table.toString(16).toUpperCase()}`;
  const line = (c: Sc1LineCoin, change: CoinLine['change']): CoinLine => ({
    line: c.line, credits: c.credits, change, ...(c.token ? { token: true } : {}),
  });
  const bare = detectCoins({ lines: coins.map((c) => line(c, [])), pricePerCredit: null, source });
  if (!(bare instanceof Map)) return bare;
  const priced = coins.find((c) => !c.token && c.credits > 0 && typeof bare.get(c.line) === 'number');
  if (!priced) return { refused: 'no cash coin fixes the price per credit' };
  const price = (bare.get(priced.line) as number) / priced.credits;
  return {
    lines: coins.map((c) => line(c, c.change ? [[{ count: c.change, pence: price }]] : [])),
    pricePerCredit: null,
    source,
  };
}

export function sc1CoinSwitches(t: Sc1CoinTables | Refusal, rom: Uint8Array, mem: Sc1Mem, line: number): Sc1CoinSwitch[] {
  const plain = [{ strobe: 0, bit: line & 7 }];
  if ('refused' in t) return plain;
  const coins = sc1LineCoins(t, rom, mem);
  if (!Array.isArray(coins)) return plain;
  return coins.find((c) => c.line === line)?.sw ?? plain;
}
