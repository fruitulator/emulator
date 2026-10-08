import type { CoinLineTable, Refusal } from './coinwiring';
import { COIN_RAW } from './coinraw';
import { Z180 } from '../cpu/z180';

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

const ROM_TOP = 0xe000;
const RAM_BASE = 0xe000;

export const coinReachesRow = (id: number): boolean =>
  id >= 0 && id < COIN_RAW.length && !(id >= 0x1e && id <= 0x20) && !(id >= 0x27 && id <= 0x32);

export const TOK_PHOENIX = 0x43;

export interface PhxCoin {
  line: number;
  value: number;
  token: boolean;
  meter: number | null;
  record: number | null;
  also: number[];
}

interface RecordFormat {
  sw: number;
  sw2: number | null;
  value: number;
  valueHi: number | null;
  meter: number;
  meterMask: number;
}

export interface PhxCoinCode {
  shape: 'records' | 'list' | 'inline';
  unit: number;
  take: number;
  noCredit: number[];
  coins: PhxCoin[];
  listPtr: number | null;
  stride: number;
  format: RecordFormat | null;
  blocks: { line: number; start: number; next: number }[];
  cashEntry: number;
  cashCounter: number;
  lineOfSwitch: (Array<number | null>);
  source: string;
}

function find(rom: Uint8Array, pat: readonly number[], from = 0, to = ROM_TOP): number[] {
  const out: number[] = [];
  const end = Math.min(to, rom.length) - pat.length;
  outer: for (let i = from; i <= end; i++) {
    for (let j = 0; j < pat.length; j++) if (pat[j]! >= 0 && rom[i + j] !== pat[j]) continue outer;
    out.push(i);
  }
  return out;
}
const w16 = (rom: Uint8Array, a: number): number => rom[a]! | (rom[a + 1]! << 8);
const s8 = (v: number): number => (v << 24) >> 24;

function portRow(port: number, phoenix2: boolean): { row: number; mask: number } | null {
  if (port === 0x48) return { row: 2, mask: 0xff };
  if (port === 0x49) return { row: 0, mask: 0xff };
  if (port === 0x4a) return phoenix2 ? { row: 1, mask: 0x9f } : { row: 3, mask: 0xff };
  if (port === 0x51 && !phoenix2) return { row: 1, mask: 0xff };
  if (port === 0x52 && phoenix2) return { row: 3, mask: 0xff };
  return null;
}

function imageBuilders(rom: Uint8Array): Map<number, number> {
  const map = new Map<number, number>();
  for (const a of find(rom, [0x21, -1, -1, 0xed, 0x38])) {
    let at = w16(rom, a + 1);
    let p = a + 3;
    for (let n = 0; n < 16; n++) {
      if (rom[p] === 0xed && rom[p + 1] === 0x38 && rom[p + 3] === 0x77) { map.set(at, rom[p + 2]!); p += 4; continue; }
      if (rom[p] === 0x23) { at++; p++; continue; }
      break;
    }
  }
  return map;
}

function switchLines(rom: Uint8Array, at: number, phoenix2: boolean): (number | null)[] | Refusal {
  const pat = [0xe5, 0xd5, 0xc5, 0x47, 0xe6, 0x07, 0x5f, 0x16, 0x00, 0x21, -1, -1, 0x19, 0x4e, 0x78, 0xe6, 0x38, 0x0f, 0x0f, 0x0f, 0x5f, 0x21, -1, -1, 0x19, 0x7e, 0xa1];
  if (!find(rom, pat, at, at + pat.length).length) return { refused: `the coin records' switch test at ${hex(at)} is not one this reader follows` };
  const masks = w16(rom, at + 3 + 7);
  for (let i = 0; i < 8; i++) if (rom[masks + i] !== 1 << i) return { refused: `the switch test's bit table at ${hex(masks)} is not one bit per switch` };
  const image = w16(rom, at + 3 + 19);
  const ports = imageBuilders(rom);
  const out: (number | null)[] = [];
  for (let s = 0; s < 64; s++) {
    const port = ports.get(image + (s >> 3));
    const pr = port === undefined ? null : portRow(port, phoenix2);
    out.push(pr && pr.mask & (1 << (s & 7)) ? pr.row * 8 + (s & 7) : null);
  }
  return out;
}

function readHandler(rom: Uint8Array, h: number): { format: Omit<RecordFormat, 'sw' | 'sw2'>; take: number; noCredit: number[]; credit: number } | Refusal {
  let value = -1;
  let valueHi: number | null = null;
  const noCredit: number[] = [];
  let take = -1;
  let credit = -1;
  let meter = -1;
  let meterMask = 0xff;
  for (let p = h; p < h + 0xa0; p++) {
    if (value < 0 && rom[p] === 0xdd && rom[p + 1] === 0x4e) {
      if (rom[p + 3] === 0x06 && rom[p + 4] === 0x00) value = rom[p + 2]!;
      else if (rom[p + 3] === 0xdd && rom[p + 4] === 0x46 && [5, 6, 7, 8, 9, 10, 11, 12].every((k, i) => rom[p + 6 + i] === (i % 2 ? 0x38 : 0xcb))) {
        value = rom[p + 2]!;
        valueHi = rom[p + 5]!;
      }
      continue;
    }
    if (take < 0 && value >= 0 && rom[p] === 0xfd && rom[p + 1] === 0xcb && rom[p + 4] === 0x28) {
      noCredit.push(p + 6);
      continue;
    }
    if (take < 0 && rom[p] === 0xf3 && rom[p + 1] === 0x2a && rom[p + 4] === 0x09 && rom[p + 5] === 0x22 && w16(rom, p + 2) === w16(rom, p + 6)) {
      take = p;
      credit = w16(rom, p + 2);
      continue;
    }
    if (take >= 0 && rom[p] === 0xdd && rom[p + 1] === 0x7e && (rom[p + 3] === 0xcd || (rom[p + 3] === 0xe6 && rom[p + 4] === 0x0f))) {
      meter = rom[p + 2]!;
      if (rom[p + 3] === 0xe6) meterMask = 0x0f;
      break;
    }
  }
  if (value < 0) return { refused: `the coin take handler at ${hex(h)} loads no record value` };
  if (take < 0) return { refused: `the coin take handler at ${hex(h)} adds no credit` };
  if (meter < 0) return { refused: `the coin take handler at ${hex(h)} names no meter` };
  if (noCredit.length !== 2) return { refused: `the coin take handler at ${hex(h)} has ${noCredit.length} paths around the credit, not the refill key's and the test's` };
  return { format: { value, valueHi, meter, meterMask }, take, noCredit, credit };
}

function readRecord(rom: Uint8Array, at: number, f: RecordFormat, lines: (number | null)[]): PhxCoin | null {
  const sw = rom[at + f.sw]!;
  if (sw & 0x80) return null;
  const line = lines[sw & 0x3f] ?? null;
  if (line === null) return null;
  const also: number[] = [];
  if (f.sw2 !== null && rom[at + f.sw2] !== 0xff) {
    const l2 = lines[rom[at + f.sw2]! & 0x3f] ?? null;
    if (l2 === null || rom[at + f.sw2]! & 0x80) return null;
    also.push(l2);
  }
  const value = rom[at + f.value]! | (f.valueHi === null ? 0 : (rom[at + f.valueHi]! >> 4) << 8);
  const code = rom[at + f.meter]! & f.meterMask;
  const meter = code >= 8 && code < 16 ? code - 8 : null;
  return { line, value, token: meter === TOKEN_IN_METER, meter, record: at, also };
}

export const TOKEN_IN_METER = 2;
export const TOKEN_OUT_METER = 3;

function readScan(rom: Uint8Array, phoenix2: boolean): PhxCoinCode | Refusal | null {
  const walks = find(rom, [0xc5, 0x01, -1, -1, 0xc5, 0xe5, 0x4e, 0xcb, 0x21, 0x06, 0x00, 0x21, -1, -1, 0x09]);
  if (!walks.length) return null;
  if (walks.length > 1) return { refused: `${walks.length} coin record walks found, not one` };
  const wk = walks[0]!;
  const next = w16(rom, wk + 2);
  const handlers = w16(rom, wk + 12);
  if (rom[next] !== 0x01 || rom[next + 2] !== 0x00 || rom[next + 3] !== 0xdd || rom[next + 4] !== 0x09) {
    return { refused: `the coin record walk's step at ${hex(next)} is not LD BC,stride / ADD IX,BC` };
  }
  const stride = rom[next + 1]!;
  const idle = w16(rom, handlers);
  const takeAt = w16(rom, handlers + 4);
  const hd = readHandler(rom, takeAt);
  if ('refused' in hd) return hd;
  const two = find(rom, [0xdd, 0x7e, -1, 0x3c, 0xc8], idle, idle + 0x20)[0];
  const call = find(rom, [0xcd, -1, -1], idle, idle + 0x14)[0];
  if (call === undefined) return { refused: `the coin records' idle state at ${hex(idle)} tests no switch` };
  const lines = switchLines(rom, w16(rom, call + 1), phoenix2);
  if ('refused' in lines) return lines;
  const format: RecordFormat = { sw: 0, sw2: two === undefined ? null : rom[two + 2]!, ...hd.format };
  const fixed = rom[wk - 12] === 0xdd && rom[wk - 11] === 0x21 && rom[wk - 8] === 0x21 && rom[wk - 5] === 0x11 && rom[wk - 2] === 0x06;
  return buildScan(rom, wk, fixed, stride, format, hd, lines);
}

function buildScan(
  rom: Uint8Array, wk: number, fixed: boolean, stride: number, format: RecordFormat,
  hd: { take: number; noCredit: number[]; credit: number }, lines: (number | null)[],
): PhxCoinCode | Refusal {
  const base = {
    unit: 1, take: hd.take, noCredit: hd.noCredit, stride, format,
    blocks: [], cashEntry: -1, cashCounter: -1, lineOfSwitch: lines,
  };
  if (fixed) {
    const at = w16(rom, wk - 10);
    const count = rom[wk - 1]!;
    if (count < 1 || count > 8) return { refused: `the coin record scan at ${hex(wk - 12)} walks ${count} records` };
    const coins: PhxCoin[] = [];
    for (let i = 0; i < count; i++) {
      const c = readRecord(rom, at + i * stride, format, lines);
      if (c) coins.push(c);
    }
    return { shape: 'records', ...base, coins, listPtr: null,
      source: `Phoenix coin records ${hex(at)} x${count}, take ${hex(hd.take)}` };
  }
  const lp = find(rom, [0x2a, -1, -1, 0x7c, 0xb5, 0xc8, 0xe5, 0xdd, 0xe1, 0x21, -1, -1, 0x11, -1, -1, 0xdd, 0x7e, 0x00, 0xdd, 0x23, 0xb7, 0xc8], Math.max(0, wk - 0x60), wk);
  if (lp.length !== 1) return { refused: `the coin record walk at ${hex(wk)} has no record list behind it` };
  return { shape: 'list', ...base, coins: [], listPtr: w16(rom, lp[0]! + 1),
    source: `Phoenix 2 coin record list at RAM ${hex(w16(rom, lp[0]! + 1))}, take ${hex(hd.take)}` };
}

function readInline(rom: Uint8Array, phoenix2: boolean): PhxCoinCode | Refusal | null {
  const deb = find(rom, [0x2f, 0x4f, 0xdd, 0xa6, 0x00, 0x57, 0x79, 0xdd, 0xb6, 0x00, 0x5f, 0xdd, 0x7e, 0x00, 0xdd, 0x77, 0x06, 0xdd, 0x71, 0x00]);
  if (!deb.length) return null;
  if (deb.length > 1) return { refused: `${deb.length} input debounce routines found, not one` };
  const d = deb[0]!;
  const latchOffsets = find(rom, [0xdd, 0xb6, -1, 0xdd, 0x77], d, d + 0x40).filter((p) => rom[p + 2] === rom[p + 5]).map((p) => rom[p + 2]!);
  if (!latchOffsets.length) return { refused: `the input debounce at ${hex(d)} keeps no edge latch` };
  const ports = imageBuilders(rom);
  const ixPort = new Map<number, number>();
  for (const a of find(rom, [0xdd, 0x21, -1, -1, 0x21, -1, -1, 0x06, -1, 0x7e, 0xcd, d & 0xff, d >> 8])) {
    const ix = w16(rom, a + 2), raw = w16(rom, a + 5), n = rom[a + 8]!;
    for (let k = 0; k < n; k++) { const p = ports.get(raw + k); if (p !== undefined) ixPort.set(ix + k, p); }
  }
  for (const a of find(rom, [0xdd, 0x21, -1, -1, 0xed, 0x38, -1, 0xcd, d & 0xff, d >> 8])) ixPort.set(w16(rom, a + 2), rom[a + 6]!);
  for (const a of find(rom, [0xdd, 0x21, -1, -1, 0x3a, -1, -1, 0xcd, d & 0xff, d >> 8])) {
    const p = ports.get(w16(rom, a + 5));
    if (p !== undefined) ixPort.set(w16(rom, a + 2), p);
  }
  const cr = find(rom, [0x21, -1, -1, 0xe5, 0x47, 0x4f, 0x3a, -1, -1, 0xfe, 0x0a, 0x28, -1, 0x30, -1, 0xfe, 0x05]);
  if (cr.length !== 1) return { refused: `the coin credit routine was found ${cr.length} times, not once` };
  const blocks: { line: number; start: number; next: number }[] = [];
  for (const [ix, port] of ixPort) {
    const pr = portRow(port, phoenix2);
    if (!pr) continue;
    for (const o of latchOffsets) {
      const latch = ix + o;
      for (let b = 0; b < 8; b++) {
        if (!(pr.mask & (1 << b))) continue;
        for (const a of find(rom, [0x21, latch & 0xff, latch >> 8, 0xcb, 0x46 | (b << 3), 0x28, -1, 0xcb, 0x86 | (b << 3)])) {
          blocks.push({ line: pr.row * 8 + b, start: a, next: a + 7 + s8(rom[a + 6]!) });
        }
      }
    }
  }
  const cash = cr[0]!, take = cash + 3;
  const calls = (b: { start: number; next: number }): boolean => find(rom, [0xcd, -1, -1], b.start, b.next).some((a) => [cash, take].includes(w16(rom, a + 1)));
  const jumps = (b: { start: number; next: number }): number[] => {
    const out: number[] = [];
    for (let p = b.start + 9; p < b.next; p++) {
      if ([0x18, 0x20, 0x28, 0x30, 0x38].includes(rom[p]!)) out.push(p + 2 + s8(rom[p + 1]!));
      if ([0xc3, 0xc2, 0xca].includes(rom[p]!)) out.push(w16(rom, p + 1));
    }
    return out;
  };
  const coinBlocks = new Set(blocks.filter(calls));
  for (let grew = true; grew;) {
    grew = false;
    for (const b of blocks) {
      if (coinBlocks.has(b)) continue;
      if (jumps(b).some((t) => [...coinBlocks].some((c) => t >= c.start && t < c.next))) { coinBlocks.add(b); grew = true; }
    }
  }
  blocks.splice(0, blocks.length, ...[...coinBlocks]);
  if (!blocks.length) return { refused: 'no coin block spends an input latch' };
  blocks.sort((x, y) => x.start - y.start);
  return {
    shape: 'inline', unit: 10, take: cr[0]! + 3, noCredit: [], coins: [], listPtr: null, stride: 0, format: null,
    blocks, cashEntry: cr[0]!, cashCounter: w16(rom, cr[0]! + 1), lineOfSwitch: [],
    source: `Phoenix coin blocks ${blocks.map((b) => hex(b.start)).join(' ')}, credit ${hex(cr[0]! + 3)}`,
  };
}

export function locatePhoenixCoins(rom: Uint8Array, phoenix2: boolean): PhxCoinCode | Refusal {
  const scan = readScan(rom, phoenix2);
  if (scan) return scan;
  const inline = readInline(rom, phoenix2);
  if (inline) return inline;
  return { refused: 'no coin record scan or coin block was found' };
}

export function phoenixCoins(code: PhxCoinCode, rom: Uint8Array, ram: Uint8Array, sp = 0xff00): PhxCoin[] | Refusal {
  if (code.shape === 'records') return code.coins;
  if (code.shape === 'list') {
    const at = code.listPtr! - RAM_BASE;
    const ptr = ram[at]! | (ram[at + 1]! << 8);
    if (!ptr || ptr >= ROM_TOP) return { refused: 'the program has not loaded its coin list yet' };
    const n = rom[ptr]!;
    if (n < 1 || n > 8) return { refused: `the coin list at ${hex(ptr)} holds ${n} records` };
    const out: PhxCoin[] = [];
    for (let i = 0; i < n; i++) {
      const c = readRecord(rom, ptr + 1 + i * code.stride, code.format!, code.lineOfSwitch);
      if (c) out.push(c);
    }
    return out;
  }
  const out: PhxCoin[] = [];
  for (const b of code.blocks) {
    const r = runBlock(code, b, rom, ram, sp);
    if (!r) { out.push({ line: b.line, value: 0, token: false, meter: null, record: null, also: [] }); continue; }
    const token = r.counter !== code.cashCounter;
    const step = (r.counter - code.cashCounter) / 8;
    const meter = Number.isInteger(step) && step >= 0 && step < 8 ? step : null;
    const also = token ? phxCoinParts(TOK_PHOENIX).map(lineOfPart).filter((l): l is number => l !== null && l !== b.line) : [];
    out.push({ line: b.line, value: r.value, token, meter, record: null, also });
  }
  return out;
}

function runBlock(code: PhxCoinCode, b: { line: number; start: number; next: number }, rom: Uint8Array, ram: Uint8Array, sp: number): { value: number; counter: number } | null {
  const mem = new Uint8Array(0x10000);
  mem.set(rom.subarray(0, ROM_TOP));
  mem.set(ram.subarray(0, 0x10000 - RAM_BASE), RAM_BASE);
  const latch = mem[b.start + 1]! | (mem[b.start + 2]! << 8);
  mem[latch] = 1 << ((mem[b.start + 4]! >> 3) & 7);
  const cpu = new Z180(
    { read8: (a) => mem[a & 0xffff]!, write8: (a, v) => { if ((a & 0xffff) >= RAM_BASE) mem[a & 0xffff] = v; } },
    { in: () => 0xff, out: () => {} },
  );
  cpu.pc = b.start;
  cpu.sp = sp & 0xffff;
  const stops = new Set<number>();
  for (const x of code.blocks) { if (x.start !== b.start) stops.add(x.start); stops.add(x.next); }
  stops.delete(b.start);
  for (let n = 0; n < 20000; n++) {
    if (cpu.pc === code.take) return { value: cpu.a, counter: cpu.hl };
    if (n > 0 && stops.has(cpu.pc)) return null;
    cpu.step();
  }
  return null;
}

export function phxCoinParts(id: number): { row: number; mask: number; direct: boolean }[] {
  let raw: number;
  if (id >= 0x100 && id < 0x180) raw = id;
  else if (coinReachesRow(id)) raw = COIN_RAW[id]!;
  else return [];
  const out: { row: number; mask: number; direct: boolean }[] = [];
  for (let n = 0; raw && n < 4; n++, raw = raw >>> 12) {
    const code = raw & 0xfff;
    if (code & 0x100) out.push({ row: (code & 0x78) >> 3, mask: 1 << (code & 7), direct: true });
    else if (code & 0xff) out.push({ row: 0, mask: code & 0xff, direct: false });
  }
  return out;
}

function lineOfPart(p: { row: number; mask: number }): number | null {
  return p.mask && !(p.mask & (p.mask - 1)) ? p.row * 8 + Math.log2(p.mask) : null;
}

export function phxIdHits(id: number, l: number): boolean {
  return phxCoinParts(id).some((p) => p.row === l >> 3 && (p.mask >> (l & 7)) & 1);
}

export function phxCoinOf(coins: readonly PhxCoin[], id: number): PhxCoin | null {
  const hit = coins.filter((c) => phxIdHits(id, c.line));
  return hit.length === 1 ? hit[0]! : null;
}

export function phxReadLines(coins: readonly PhxCoin[]): Set<number> {
  const s = new Set<number>();
  for (const c of coins) { s.add(c.line); for (const l of c.also) s.add(l); }
  return s;
}

export function phxSlotId(c: { line: number | null; button: number | null; note: number | null; token: boolean }): number {
  if (c.line !== null) return c.line;
  if (c.note !== null && c.note !== 0x47) return c.note;
  if (c.note === 0x47 && c.button !== null && c.button >= 0) return 0x100 | (c.button & 0x7f);
  return c.token ? 0x100 : 0x104;
}

export function phxCoinTable(code: PhxCoinCode, coins: readonly PhxCoin[], drawn: readonly number[]): CoinLineTable {
  const lines: CoinLineTable['lines'] = [];
  const seen = new Set<number>();
  for (const c of coins) {
    const hit = (id: number): boolean => phxCoinOf(coins, id) === c;
    const id = [...drawn].sort((a, b) => a - b).find(hit) ?? [TOK_PHOENIX, 0x100 | c.line].find(hit);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    lines.push(c.token && c.value > 0
      ? { line: id, credits: c.value, change: [], token: true, tokenPence: c.value * code.unit }
      : { line: id, credits: c.value, change: [] });
  }
  lines.sort((a, b) => a.line - b.line);
  return { lines, pricePerCredit: code.unit, source: code.source };
}
