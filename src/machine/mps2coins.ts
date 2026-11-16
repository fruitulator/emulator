import type { ChangeTerm, CoinLine, CoinLineTable, Refusal } from './coinwiring';
import { dataPakCoinInKind } from '../hw/datapak';

export interface Mps2CoinIo {
  rotaryByte: number;
  dil(select: number): number;
}

const LINES = [19, 20, 21, 22, 23] as const;

const hex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

function word(rom: Uint8Array, a: number): number {
  return a + 1 < rom.length ? (rom[a]! << 8) | rom[a + 1]! : -1;
}

function insnLen(rom: Uint8Array, a: number): number {
  const w = word(rom, a);
  if (w < 0) return 2;
  if (w >= 0x4000) {
    return 2 + (((w >> 4) & 3) === 2 ? 2 : 0) + (((w >> 10) & 3) === 2 ? 2 : 0);
  }
  if (w >= 0x2000) return 2 + (((w >> 4) & 3) === 2 ? 2 : 0);
  if (w >= 0x1000) return 2;
  if (w >= 0x0800) return 2;
  if (w >= 0x0400) return 2 + (((w >> 4) & 3) === 2 ? 2 : 0);
  if (w >= 0x0200) {
    const op = w & 0xffe0;
    return op === 0x02a0 || op === 0x02c0 ? 2 : 4;
  }
  return 2;
}

const isUncondJump = (w: number): boolean => (w & 0xff00) === 0x1000 || w === 0x0380 || (w & 0xffc0) === 0x0440;

export function readWordTable(rom: Uint8Array, io: Mps2CoinIo): CoinLineTable | null {
  for (let a = 0; a + 6 <= rom.length; a += 2) {
    const w0 = word(rom, a);
    if ((w0 & 0xfff0) !== 0x05c0) continue;
    if ((word(rom, a + 2) & 0xfff0) !== 0x0910) continue;
    if (word(rom, a + 4) !== 0x17fd) continue;
    const x = w0 & 15;
    let rotReg = -1; let shift = 0; let lastSla = -1;
    let variant = 0;
    let credit = -1; let change = -1;
    for (let p = a + 6, end = a + 6 + 0x60; p < end && p < rom.length;) {
      const w = word(rom, p);
      const len = insnLen(rom, p);
      if ((w & 0xfc3f) === 0xd020 && word(rom, p + 2) === 0xc00a) { rotReg = (w >> 6) & 15; shift = 0; }
      else if (rotReg >= 0 && (w & 0xff0f) === (0x0a00 | rotReg)) { shift += (w >> 4) & 15 || 16; lastSla = shift; }
      else if (w === 0x1702 && lastSla > 0 && word(rom, p + 2) === (0x0220 | x)) {
        const byteBit = 16 - lastSla - 8;
        if (byteBit >= 0 && byteBit < 8 && (io.rotaryByte >> byteBit) & 1) variant += word(rom, p + 4);
        lastSla = -1;
        p += 2 + 4;
        continue;
      }
      else if (credit < 0 && (w & 0xfc3f) === (0xc020 | x)) {
        const n = (w >> 6) & 15;
        const next = word(rom, p + 4);
        if ((next & 0xf03f) === (0xa000 | n) && ((next >> 4) & 3) === 0) credit = word(rom, p + 2);
      }
      else if ((w & 0xfc3f) === (0xa820 | x)) {
        const t = word(rom, p + 2);
        if (credit < 0) credit = t;
        else if (change < 0 && t !== credit) change = t;
      }
      if (credit >= 0 && isUncondJump(w)) break;
      p += len;
    }
    if (credit < 0) continue;
    const lines: CoinLine[] = [];
    for (const line of LINES) {
      const idx = 2 * (line - 18) + variant;
      const c = word(rom, credit + idx);
      const ch = change >= 0 ? word(rom, change + idx) : 0;
      if (c < 0 || c > 0xff || ch < 0 || ch > 0xff) { lines.length = 0; break; }
      lines.push({ line, credits: c, change: ch > 0 ? [[{ count: ch, pence: 10 }]] : [] });
    }
    if (!lines.length || lines.every((l) => l.credits === 0 && !l.change.length)) continue;
    const codes = readDataPakCoinCodes(rom, a + 6, x);
    if (codes) for (const l of lines) if (dataPakCoinInKind(codes.codes.get(l.line)!) === 'token') l.token = true;
    return {
      lines,
      pricePerCredit: null,
      source: `MPS2 word table ${hex(credit)}${variant ? ` + ${hex(variant)} (rotary)` : ''}${change >= 0 ? `, change ${hex(change)}` : ''}${codes ? `, DataPak codes ${hex(codes.table)}` : ''}, code ${hex(a)}`,
    };
  }
  return null;
}

function readDataPakCoinCodes(rom: Uint8Array, from: number, x: number): { table: number; codes: Map<number, number> } | null {
  let found: { table: number; codes: Map<number, number> } | null = null;
  for (let p = from, end = from + 0x60; p < end && p < rom.length;) {
    const w = word(rom, p);
    if (x !== 0 && (w & 0xf03f) === (0xd020 | x)) {
      const t = word(rom, p + 2);
      const codes = new Map<number, number>();
      for (const line of LINES) codes.set(line, rom[t + 2 * (line - 18)] ?? -1);
      if ([...codes.values()].every((c) => dataPakCoinInKind(c) !== null)) {
        if (found && [...codes].some(([l, c]) => dataPakCoinInKind(c) !== dataPakCoinInKind(found!.codes.get(l)!))) return null;
        found ??= { table: t, codes };
      }
    }
    p += insnLen(rom, p);
  }
  return found;
}

export interface JpmScript { index: number; adds: { amount: number; target: number }[] }

export function readJpmScripts(rom: Uint8Array, ctr: number): Map<number, JpmScript> | null {
  for (let a = 0; a + 14 <= rom.length; a += 2) {
    if (word(rom, a) !== 0x0202) continue;
    if (word(rom, a + 4) !== 0xc072 || (word(rom, a + 6) & 0xff00) !== 0x1300) continue;
    if (word(rom, a + 8) !== 0xd0d1 || word(rom, a + 10) !== 0x0983 || word(rom, a + 12) !== 0xd0e3) continue;
    if (word(rom, a + 14) !== ctr) continue;
    const out = new Map<number, JpmScript>();
    for (let i = word(rom, a + 2), guard = 0; guard < 64; i += 2, guard++) {
      const p = word(rom, i);
      if (p <= 0) break;
      const index = rom[p]!;
      const n = rom[p + 1]!;
      const q = p + 2 + n;
      const m = rom[q]!;
      if (q + 1 + 2 * m > rom.length) return null;
      const adds: JpmScript['adds'] = [];
      for (let k = 0; k < m; k++) {
        const t = rom[q + 2 + 2 * k]!;
        adds.push({ amount: rom[q + 1 + 2 * k]!, target: t < 0x80 ? t : t - 0x100 });
      }
      if (!out.has(index)) out.set(index, { index, adds });
    }
    return out.size ? out : null;
  }
  return null;
}

const METER_PORT = 0xc002;
const CASH_IN_BIT = 0;
const TOKEN_IN_BIT = 2;

export function readJpmMeters(rom: Uint8Array, base: number): Map<number, number> | null {
  for (let a = 0; a + 20 <= rom.length; a += 2) {
    if (word(rom, a) !== 0x0202) continue;
    if (word(rom, a + 4) !== 0xd0f2 || (word(rom, a + 6) & 0xff00) !== 0x1100) continue;
    if (word(rom, a + 8) !== 0xd132 || word(rom, a + 10) !== 0xd1b2 || word(rom, a + 12) !== 0x0986) continue;
    let ctr = -1; let img = -1;
    for (let p = a + 14; p < a + 0x60 && p < rom.length; p += 2) {
      if (word(rom, p) === 0x0983 && word(rom, p + 2) === 0xd023) ctr = word(rom, p + 4);
      if (word(rom, p) === 0xf984) { img = word(rom, p + 2); break; }
    }
    if (ctr !== base || img < 0) continue;
    const port = imageByteOf(rom, img, METER_PORT);
    if (port === null) return null;
    const out = new Map<number, number>();
    for (let t = word(rom, a + 2), guard = 0; t < rom.length && guard < 32; t += 3, guard++) {
      const k = rom[t]!;
      if (k >= 0x80) return out;
      const mask = rom[t + 1]!;
      if (rom[t + 2] === port && mask && !(mask & (mask - 1))) out.set(k, 31 - Math.clz32(mask));
    }
    return null;
  }
  return null;
}

function imageByteOf(rom: Uint8Array, img: number, port: number): number | null {
  for (let a = 0; a + 4 <= rom.length; a += 2) {
    if (word(rom, a) !== 0x0201 || word(rom, a + 2) !== img) continue;
    const off = imageOffsetAt(rom, a, port);
    if (off !== null) return off;
  }
  return null;
}

function imageOffsetAt(rom: Uint8Array, a: number, port: number): number | null {
  let off = 0;
  for (let p = a + 4, n = 0; n < 24 && p < rom.length; n++) {
    const w = word(rom, p);
    if (w === 0xd811 && word(rom, p + 2) === port) return off;
    if (w === 0xd831 && word(rom, p + 2) === port) return off;
    if (w === 0xd831) off++;
    else if (w === 0x0581) off++;
    else if (w === 0x05c1) off += 2;
    else if ((w & 0xfff0) === 0x0200 && (w & 15) === 1) break;
    p += insnLen(rom, p);
  }
  return null;
}

function meterPortByte(rom: Uint8Array): number | null {
  const found = new Set<number>();
  for (let a = 0; a + 4 <= rom.length; a += 2) {
    if (word(rom, a) !== 0x0201) continue;
    const img = word(rom, a + 2);
    if (img < 0x8000) continue;
    const off = imageOffsetAt(rom, a, METER_PORT);
    if (off !== null) found.add(img + off);
  }
  return found.size === 1 ? [...found][0]! : null;
}

function scriptTargetBase(rom: Uint8Array): number | null {
  for (let a = 0; a + 10 <= rom.length; a += 2) {
    if (word(rom, a) !== 0xd0f1 || word(rom, a + 2) !== 0xd131 || word(rom, a + 4) !== 0x0884) continue;
    for (let p = a + 6; p < a + 0x20; p += 2) if (word(rom, p) === 0xb903) return word(rom, p + 2);
  }
  return null;
}

function dilWord(rom: Uint8Array, ram: number, io: Mps2CoinIo): { value: number; known: number } {
  let value = 0; let known = 0;
  for (let a = 0; a + 12 <= rom.length; a += 2) {
    if (word(rom, a) !== 0xd820 || word(rom, a + 4) !== 0xc00a) continue;
    if (word(rom, a + 6) !== 0xd820 || word(rom, a + 8) !== 0xc009) continue;
    const dst = word(rom, a + 10);
    if (dst !== ram && dst !== ram + 1) continue;
    const sel = rom[word(rom, a + 2)] ?? 0xff;
    const byte = io.dil(sel) & 0xff;
    const sh = dst === ram ? 8 : 0;
    value = (value & ~(0xff << sh)) | (byte << sh);
    known |= 0xff << sh;
  }
  for (let a = 0; a + 6 <= rom.length; a += 2) {
    if (word(rom, a) === 0xe820 && word(rom, a + 4) === ram) value |= word(rom, word(rom, a + 2)) & 0xffff;
  }
  return { value, known };
}

export function readJpmRecords(rom: Uint8Array, io: Mps2CoinIo): CoinLineTable | Refusal | null {
  for (let a = 4; a + 8 <= rom.length; a += 2) {
    const ai = word(rom, a);
    if ((ai & 0xfff0) !== 0x0220) continue;
    const r = ai & 15;
    const stride = word(rom, a + 2);
    if (stride !== 5 && stride !== 6) continue;
    const srl = word(rom, a + 4);
    if ((srl & 0xfff0) !== 0x0910 || word(rom, a + 6) !== 0x17fc) continue;
    if (word(rom, a - 4) !== (0x0200 | r)) continue;
    let base = word(rom, a - 2);
    let how = '';
    if (word(rom, a - 6) === 0x1302 && word(rom, a - 18) === (0x0200 | r)
      && (word(rom, a - 14) & 0xfc3f) === 0xc020 && (word(rom, a - 10) & 0xfc3f) === 0x2420) {
      const ram = word(rom, a - 12);
      const mask = word(rom, word(rom, a - 8));
      const dil = dilWord(rom, ram, io);
      if ((dil.known & mask) !== mask) {
        return { refused: `JPM records at code ${hex(a)}: a DIL switch picks the table and its read was not traced` };
      }
      const b1 = word(rom, a - 16);
      base = (dil.value & mask) === 0 ? b1 : base;
      how = `, DIL-picked (${hex(b1)} or ${hex(word(rom, a - 2))})`;
    }
    let ctr = -1;
    for (let p = a + 8; p < a + 0x90 && p < rom.length; p += 2) {
      const w = word(rom, p);
      if ((w & 0xfc30) === 0xb820 && ((w >> 10) & 3) === 2 && ((w >> 4) & 3) === 2) { ctr = word(rom, p + 4); break; }
    }
    if (ctr < 0) continue;
    const scripts = readJpmScripts(rom, ctr);
    if (!scripts) return { refused: `JPM records at ${hex(base)}: the meter-action scripts for counter ${hex(ctr)} were not found, so a line's change cannot be read` };
    const tb = scriptTargetBase(rom);
    const meters = tb === null ? null : readJpmMeters(rom, tb);
    const lines: CoinLine[] = [];
    const coinMeterBits = new Set<number>();
    for (const line of LINES) {
      const rec = base + stride * (line - 18);
      if (rec + stride > rom.length) return null;
      const credits = rom[rec]!;
      const alts = new Set<number>();
      for (let k = 1; k < stride - 1; k++) if (rom[rec + k]) alts.add(rom[rec + k]!);
      const change: ChangeTerm[][] = [];
      let anyChange = false;
      let tokenIn = alts.size > 0; let cashIn = false;
      for (const idx of alts) {
        const s = scripts.get(idx);
        if (!s) return { refused: `JPM records at ${hex(base)}: line ${line} names action ${idx}, which has no script` };
        const terms = s.adds.filter((x) => x.target < 0).map((x): ChangeTerm => ({ count: x.amount, tube: x.target }));
        if (terms.length) anyChange = true;
        change.push(terms);
        const bits = new Set(s.adds.filter((x) => x.target >= 0 && x.amount > 0).map((x) => meters?.get(x.target)));
        if (!bits.has(TOKEN_IN_BIT)) tokenIn = false;
        if (bits.has(CASH_IN_BIT)) cashIn = true;
        if (credits > 0 && !terms.length) for (const bit of bits) if (bit !== undefined) coinMeterBits.add(bit);
      }
      const token = meters !== null && tokenIn && !cashIn;
      lines.push({ line, credits, change: anyChange ? change : [], ...(token ? { token: true } : {}) });
    }
    if (lines.every((l) => l.credits === 0)) continue;
    return {
      lines,
      coinMeterBits: [...coinMeterBits].sort((x, y) => x - y),
      pricePerCredit: null,
      source: `JPM ${stride}-byte coin records ${hex(base)}${how}, scripts for counter ${hex(ctr)}, code ${hex(a)}`,
    };
  }
  return null;
}

export function readPatternRecords(rom: Uint8Array, io: Mps2CoinIo): CoinLineTable | Refusal | null {
  for (let a = 0; a + 12 <= rom.length; a += 2) {
    if ((word(rom, a) & 0xfff0) !== 0x0200) continue;
    if (word(rom, a + 4) !== (0x0220 | (word(rom, a) & 15)) || word(rom, a + 6) !== 0x0008) continue;
    if ((word(rom, a + 10) & 0xff00) !== 0x1300 || word(rom, a + 12) !== 0x2db0) continue;
    const records: ValueRecord[] = [];
    for (let r = word(rom, a + 2) + 8; r + 8 <= rom.length && word(rom, r) > 0 && records.length < 16; r += 8) {
      records.push({ at: r, pattern: word(rom, r), value: word(rom, r + 2), total: word(rom, r + 4), counter: word(rom, r + 6) });
    }
    const found = `value records at code ${hex(a)} (${records.map((x) => x.value).join(', ')})`;
    const got = readPatternLines(rom, io, a, records);
    if (typeof got === 'string') return { refused: `${found}: ${got}` };
    return got;
  }
  return null;
}

interface ValueRecord { at: number; pattern: number; value: number; total: number; counter: number }

type MidOp =
  | { kind: 'set'; arrs: number[] }
  | { kind: 'test'; arr: number; eqWhenSet: boolean };

function readMidOps(rom: Uint8Array): { ops: Map<number, MidOp>; term: number } | string {
  const h = word(rom, 0x000a);
  let table = -1;
  for (let p = h; p < h + 0x20 && p + 16 <= rom.length; p += 2) {
    if (word(rom, p) === 0x024f && word(rom, p + 2) === 0x000f && word(rom, p + 4) === 0xc2ad && word(rom, p + 6) === 0x0014
      && word(rom, p + 8) === 0xc22e && word(rom, p + 10) === 0xfffe && word(rom, p + 12) === 0xc028 && word(rom, p + 16) === 0x0450) {
      table = word(rom, p + 14);
      break;
    }
  }
  if (table < 0) return `the MID handler at ${hex(h)} is a dialect not read`;
  let term = -1;
  let masks = -1;
  const ops = new Map<number, MidOp>();
  for (let k = 0; k < 0x20; k += 2) {
    const r = word(rom, table + k);
    if (r < 0 || r + 16 > rom.length || word(rom, r) !== 0x06a0) continue;
    const idx = word(rom, r + 2);
    if (word(rom, idx) !== 0x980a || (word(rom, idx + 4) & 0xff00) !== 0x1300 || word(rom, idx + 6) !== 0x097a
      || word(rom, idx + 8) !== 0xc04a || word(rom, idx + 10) !== 0xc08a || word(rom, idx + 12) !== 0x0242
      || word(rom, idx + 14) !== 0x001e || word(rom, idx + 16) !== 0x0941 || word(rom, idx + 18) !== 0x045b) continue;
    const t = rom[word(rom, idx + 2)]!;
    if (term >= 0 && t !== term) return 'the MID ops disagree on the pattern terminator';
    term = t;
    const p = r + 4;
    const w = word(rom, p);
    if (w === 0xe862) {
      const arrs: number[] = [];
      let q = p;
      for (; word(rom, q) === 0xe862; q += 6) {
        if (masks >= 0 && word(rom, q + 2) !== masks) return 'the MID ops use two mask tables';
        masks = word(rom, q + 2);
        arrs.push(word(rom, q + 4));
      }
      if (word(rom, q) === 0x0380) ops.set(k, { kind: 'set', arrs });
    } else if (w === 0xc0e1) {
      const c = word(rom, p + 4);
      if ((c !== 0x24e2 && c !== 0x20e2) || word(rom, p + 8) !== 0x1602 || word(rom, p + 10) !== 0x026f
        || word(rom, p + 12) !== 0x2000 || word(rom, p + 14) !== 0x0380) continue;
      if (masks >= 0 && word(rom, p + 6) !== masks) return 'the MID ops use two mask tables';
      masks = word(rom, p + 6);
      ops.set(k, { kind: 'test', arr: word(rom, p + 2), eqWhenSet: c === 0x20e2 });
    }
  }
  if (term < 0 || masks < 0) return `the MID ops at ${hex(table)} are not the flag tests read here`;
  for (let b = 0; b < 16; b++) if (word(rom, masks + 2 * b) !== 1 << b) return `the MID ops' mask table at ${hex(masks)} is not one bit per flag`;
  return { ops, term };
}

function readXop6Ops(rom: Uint8Array): Map<number, { mid: number; neg: boolean }> | string {
  const h = word(rom, 0x005a);
  if (word(rom, h) !== 0xd07b || word(rom, h + 2) !== 0x0981 || word(rom, h + 4) !== 0xc061 || word(rom, h + 8) !== 0x0451) {
    return `XOP 6 at ${hex(h)} is not the op table read here`;
  }
  const table = word(rom, h + 6);
  const out = new Map<number, { mid: number; neg: boolean }>();
  for (let b = 0; b < 0x40; b += 2) {
    const e = word(rom, table + b);
    if (e < 0 || e + 4 > rom.length || word(rom, e) !== 0xd29b) break;
    const mid = word(rom, e + 2);
    if (mid >= 0x20 || mid & 1) break;
    let p = e + 4;
    if ((word(rom, p) & 0xff00) === 0x1000) p = p + 2 + 2 * (((word(rom, p) & 0xff) << 24) >> 24);
    if (word(rom, p) !== 0x02cf) continue;
    if (word(rom, p + 2) === 0x0380) out.set(b, { mid, neg: false });
    else if (word(rom, p + 2) === 0xc020 && word(rom, word(rom, p + 4)) === 0x2000 && word(rom, p + 6) === 0x2bc0 && word(rom, p + 8) === 0x0380) {
      out.set(b, { mid, neg: true });
    }
  }
  return out.size ? out : `XOP 6's op table at ${hex(table)} holds no op read here`;
}

const flagAt = (arr: number, n: number): { at: number; bit: number } => ({ at: (arr + (n >> 3)) & ~1, bit: n & 15 });

function storedFromC005(rom: Uint8Array, at: number): boolean {
  for (let a = 0; a + 4 <= rom.length; a += 2) {
    if ((word(rom, a) & 0xfc3f) !== 0xd020 || word(rom, a + 2) !== 0xc005) continue;
    for (let p = a + 4; p < a + 0x40 && p + 4 <= rom.length; p += 2) if ((word(rom, p) & 0xfff0) === 0xc800 && word(rom, p + 2) === at) return true;
  }
  return false;
}

function readCoinScan(rom: Uint8Array, io: Mps2CoinIo, recordsAt: number, mids: Map<number, MidOp>): { flags: Map<number, number>; set: number; table: number } | string {
  const from = Math.max(0, recordsAt - 0x100);
  let t = -1; let set = -1;
  for (let p = from; p < recordsAt; p += 2) {
    if (word(rom, p) === 0xd2a4 && mids.get(word(rom, p + 4))?.kind === 'set') { t = word(rom, p + 2); set = word(rom, p + 4); }
  }
  if (t < 0) return 'no coin scan that sets a flag per line before them';
  const flags = new Map<number, number>();
  for (let p = from; p < recordsAt; p += 2) {
    if (word(rom, p) !== 0xd0e0 || word(rom, p + 4) !== 0x0983 || word(rom, p + 6) !== 0x0543 || word(rom, p + 8) !== 0x0243
      || word(rom, p + 10) !== 0x001f || word(rom, p + 12) !== 0x04c2 || word(rom, p + 14) !== 0x0913 || (word(rom, p + 16) & 0xff00) !== 0x1800) continue;
    const scan = word(rom, p + 2);
    if (scan & 1 || !storedFromC005(rom, scan)) return `the coin scan at ${hex(p)} reads ${hex(scan)}, which is not traced to $C005`;
    let halves = false;
    for (let q = p + 16; q < recordsAt; q += 2) if (word(rom, q) === 0xc102 && word(rom, q + 2) === 0x0914 && word(rom, q + 4) === 0xd2a4) halves = true;
    if (!halves) return `the coin scan at ${hex(p)} indexes its flags another way`;
    for (const line of LINES) flags.set(line, rom[t + line - 19]!);
    return { flags, set, table: t };
  }
  for (let p = from; p < recordsAt; p += 2) {
    if (word(rom, p) !== 0x04c2 || word(rom, p + 2) !== 0x04c4) continue;
    let lists: number[] = [];
    let q = p + 4;
    if (word(rom, q) === 0xd2a4) { lists.push(word(rom, q + 2)); q += 4; }
    else if (word(rom, q) === 0x0205 && word(rom, q + 4) === 0xd2b5) { lists.push(word(rom, q + 2)); q += 6; }
    else if (word(rom, q) === 0x0205 && (word(rom, q + 4) & 0xfc3f) === 0xc020 && (word(rom, q + 8) & 0xfc3f) === 0x2420
      && ((word(rom, q + 4) >> 6) & 15) === (word(rom, q + 8) >> 6 & 15)
      && (word(rom, q + 12) === 0x1602 || word(rom, q + 12) === 0x1302) && word(rom, q + 14) === 0x0205 && word(rom, q + 18) === 0xd2b5) {
      const x = word(rom, q + 6); const mask = word(rom, word(rom, q + 10));
      const a = word(rom, q + 2); const b = word(rom, q + 16);
      const known = x + 1 < rom.length && x < 0xe000 ? { value: word(rom, x), known: 0xffff } : dilWord(rom, x, io);
      const aWhenSet = word(rom, q + 12) === 0x1602;
      lists = (known.known & mask) === mask ? [((known.value & mask) !== 0) === aWhenSet ? a : b] : [a, b];
      q += 20;
    } else continue;
    const test = mids.get(word(rom, q));
    if (test?.kind !== 'test') return `the coin scan at ${hex(p)} tests its inputs with a MID op not read`;
    const term = readMidOps(rom);
    if (typeof term === 'string') return term;
    const per = lists.map((list) => {
      const m = new Map<number, number>();
      for (let i = 0; i < 8; i++) {
        const n = rom[list + i]!;
        if (n === term.term) break;
        const { at, bit } = flagAt(test.arr, n);
        if (bit < 8 || bit > 12 || !storedFromC005(rom, at)) return `the coin scan at ${hex(p)} lists input flag ${hex(n)}, which is not a coin line`;
        m.set(19 + bit - 8, rom[t + i]!);
      }
      return m;
    });
    for (const m of per) if (typeof m === 'string') return m;
    const maps = per as Map<number, number>[];
    for (const [line, f] of maps[0]!) if (maps.every((m) => m.get(line) === f)) flags.set(line, f);
    const coinArrs = (mids.get(set) as Extract<MidOp, { kind: 'set' }>).arrs;
    const scanWord = flagAt(test.arr, 0x18).at;
    const tableFlags: number[] = [];
    for (let i = 0; i < 16 && rom[t + i] !== term.term; i++) tableFlags.push(rom[t + i]!);
    const listed = new Set(maps.flatMap((m) => [...m.values()]));
    for (const line of LINES) {
      if (flags.has(line)) continue;
      const bit = 1 << (8 + line - 19);
      let tests = false;
      const hits = new Set<number>();
      for (let r = p; r < p + 0x200 && r + 6 <= rom.length; r += 2) {
        if (word(rom, r) === 0xc2a0 && word(rom, r + 2) === scanWord && word(rom, r + 4) === 0x26a0 && word(rom, word(rom, r + 6)) === bit) tests = true;
        if (word(rom, r) !== 0xe820) continue;
        const m = word(rom, word(rom, r + 2)); const w = word(rom, r + 4);
        if (m <= 0 || m & (m - 1)) continue;
        for (const arr of coinArrs) {
          if (w < arr || w >= arr + 0x20 || (w - arr) & 1) continue;
          const n = ((w - arr) >> 1) * 16 + 31 - Math.clz32(m);
          if (tableFlags.includes(n) && !listed.has(n)) hits.add(n);
        }
      }
      if (tests && hits.size === 1) flags.set(line, [...hits][0]!);
    }
    return flags.size ? { flags, set, table: t } : `the coin scan at ${hex(p)} lists no coin line`;
  }
  return 'no coin scan of a shape read here before them';
}

function readCoinScripts(rom: Uint8Array): { scripts: Map<number, { code: number | null; adds: { amount: number; target: number }[] }>; credit: number; total: number } | string {
  let credit = -1; let total = -1;
  for (let a = 0; a + 12 <= rom.length; a += 2) {
    if (word(rom, a) !== 0xc0b1 || word(rom, a + 2) !== 0xc112 || (word(rom, a + 4) & 0xff00) !== 0x1300 || word(rom, a + 6) !== 0x0612
      || word(rom, a + 8) !== 0xc0b1 || word(rom, a + 10) !== 0xa042 || word(rom, a + 12) !== 0x0581) continue;
    for (let p = a + 14; p < a + 0x40; p += 2) {
      if (word(rom, p) === 0xa503 && word(rom, p + 2) === 0x0284 && (word(rom, p + 6) & 0xff00) === 0x1600 && word(rom, p + 8) === 0x6803) {
        credit = word(rom, p + 4); total = word(rom, p + 10);
        break;
      }
    }
    break;
  }
  if (credit < 0) return 'the script walker that moves the value to the credit was not found';
  for (let a = 0; a + 12 <= rom.length; a += 2) {
    if (word(rom, a) !== 0x0202 || word(rom, a + 4) !== 0xc072 || (word(rom, a + 6) & 0xff00) !== 0x1300
      || word(rom, a + 8) !== 0xc0d1 || word(rom, a + 10) !== 0xc0d3 || (word(rom, a + 12) & 0xff00) !== 0x1300) continue;
    const scripts = new Map<number, { code: number | null; adds: { amount: number; target: number }[] }>();
    for (let i = word(rom, a + 2), guard = 0; guard < 64; i += 2, guard++) {
      const s = word(rom, i);
      if (s <= 0) break;
      const n = word(rom, s + 2);
      if (n < 0 || n > 16) return `the coin script at ${hex(s)} is not the shape read here`;
      const m0 = (s + 5 + n) & ~1;
      const m = word(rom, m0);
      if (m < 0 || m > 16) return `the coin script at ${hex(s)} is not the shape read here`;
      const adds: { amount: number; target: number }[] = [];
      for (let k = 0; k < m; k++) adds.push({ amount: word(rom, m0 + 2 + 4 * k), target: word(rom, m0 + 4 + 4 * k) });
      const counter = word(rom, s);
      if (!scripts.has(counter)) scripts.set(counter, { code: n ? rom[s + 4]! : null, adds });
    }
    return scripts.size ? { scripts, credit, total } : 'the coin scripts list is empty';
  }
  return 'the coin scripts list was not found';
}

function readPatternMeters(rom: Uint8Array, mids: Map<number, MidOp>): Map<number, number> | null {
  const port = meterPortByte(rom);
  if (port === null) return null;
  for (let a = 0; a + 22 <= rom.length; a += 2) {
    if (word(rom, a) !== 0x0202 || word(rom, a + 4) !== 0xc0f2 || (word(rom, a + 6) & 0xff00) !== 0x1300
      || word(rom, a + 8) !== 0xc132) continue;
    const b = word(rom, a + 10) === 0xc145 && (word(rom, a + 12) & 0xff00) === 0x1600 ? a + 14 : a + 10;
    if (word(rom, b) !== 0xc013 || (word(rom, b + 2) & 0xff00) !== 0x1300 || word(rom, b + 4) !== 0x0613
      || word(rom, b + 6) !== 0xd284) continue;
    const op = mids.get(word(rom, b + 8));
    if (op?.kind !== 'set' || op.arrs.length !== 1) return null;
    const arr = op.arrs[0]!;
    const out = new Map<number, number>();
    for (let t = word(rom, a + 2), guard = 0; t + 4 <= rom.length && guard < 32; t += 4, guard++) {
      const ctr = word(rom, t);
      if (ctr === 0) return out;
      const n = rom[t + 2]!;
      const { at, bit } = flagAt(arr, n);
      const byte = at + (bit < 8 ? 1 : 0);
      if (byte === port) out.set(ctr, bit & 7);
    }
    return null;
  }
  return null;
}

function readPatternLines(rom: Uint8Array, io: Mps2CoinIo, recordsAt: number, records: ValueRecord[]): CoinLineTable | string {
  const xops = readXop6Ops(rom);
  if (typeof xops === 'string') return xops;
  const midOps = readMidOps(rom);
  if (typeof midOps === 'string') return midOps;
  const { ops: mids, term } = midOps;
  const scan = readCoinScan(rom, io, recordsAt, mids);
  if (typeof scan === 'string') return scan;
  const coinArrs = (mids.get(scan.set) as Extract<MidOp, { kind: 'set' }>).arrs;
  let clears = false;
  for (let p = recordsAt; p < recordsAt + 0x80 && !clears; p += 2) {
    clears = word(rom, p) === 0x0201 && word(rom, p + 2) === scan.table && word(rom, p + 4) === 0xd2b1 && (word(rom, p + 8) & 0xff00) === 0x1700;
  }
  if (!clears) return `the coin flags at ${hex(scan.table)} are not cleared after a coin as read here`;
  const coinFlags = new Set<number>();
  for (let i = 0; i < 16 && rom[scan.table + i] !== term; i++) coinFlags.add(rom[scan.table + i]!);
  const scr = readCoinScripts(rom);
  if (typeof scr === 'string') return scr;
  const needs = (rec: ValueRecord, flag: number): Map<string, boolean> | false | string => {
    const want = new Map<string, boolean>();
    for (let p = rec.pattern, guard = 0; guard < 32; p += 2, guard++) {
      const x = xops.get(rom[p]!);
      const n = rom[p + 1]!;
      if (!x) return `record ${hex(rec.at)}'s pattern uses XOP 6 op ${hex(rom[p]!)}, not read`;
      if (n === term) return want;
      const op = mids.get(x.mid);
      if (op?.kind !== 'test') return `record ${hex(rec.at)}'s pattern uses MID op ${hex(x.mid)}, not read`;
      const passOn = op.eqWhenSet !== x.neg;
      const { at, bit } = flagAt(op.arr, n);
      let set: boolean | null = null;
      if (coinArrs.includes(op.arr) && coinFlags.has(n)) set = n === flag;
      else {
        const dil = dilWord(rom, at, io);
        if ((dil.known >> bit) & 1) set = ((dil.value >> bit) & 1) === 1;
      }
      if (set !== null) { if (set !== passOn) return false; continue; }
      const key = `${at}.${bit}`;
      if (want.has(key) && want.get(key) !== passOn) return false;
      want.set(key, passOn);
    }
    return `record ${hex(rec.at)}'s pattern has no end`;
  };
  const lines: CoinLine[] = [];
  for (const line of LINES) {
    const flag = scan.flags.get(line);
    if (flag === undefined) continue;
    const conds: { rec: ValueRecord; want: Map<string, boolean> }[] = [];
    for (const rec of records) {
      const r = needs(rec, flag);
      if (typeof r === 'string') return r;
      if (r !== false) conds.push({ rec, want: r });
    }
    const keys = [...new Set(conds.flatMap((c) => [...c.want.keys()]))];
    if (keys.length > 12) return `line ${line}'s records rest on ${keys.length} flags not read`;
    const reached = new Set<ValueRecord>();
    for (let v = 0; v < 1 << keys.length; v++) {
      const hit = conds.find((c) => [...c.want].every(([k, w]) => (((v >> keys.indexOf(k)) & 1) === 1) === w));
      if (hit) reached.add(hit.rec);
    }
    const reach = records.filter((rec) => reached.has(rec));
    const credited = reach.filter((rec) => rec.total === scr.total);
    if (!credited.length) { lines.push({ line, credits: 0, change: [] }); continue; }
    const values = new Set(credited.map((rec) => rec.value));
    if (values.size > 1) return `line ${line} can be taken by records of ${[...values].join(' or ')} on flags not read`;
    let token: boolean | null = null;
    for (const rec of credited) {
      const s = scr.scripts.get(rec.counter);
      if (!s) return `record ${hex(rec.at)}'s counter ${hex(rec.counter)} has no script`;
      const moved = s.adds.filter((x) => x.target === scr.credit).reduce((sum, x) => sum + x.amount, 0);
      if (moved !== rec.value) return `record ${hex(rec.at)} credits ${rec.value} and its script moves ${moved}`;
      if (s.adds.some((x) => { const c = scr.scripts.get(x.target)?.code; return c !== undefined && c !== null && c >= 0x40 && c <= 0x47; })) {
        return `line ${line} at these settings credits ${rec.value} and pays change, which is not read`;
      }
      const kind = s.code === null ? null : dataPakCoinInKind(s.code);
      if (kind === null) return `record ${hex(rec.at)}'s script reports status ${s.code === null ? 'none' : hex(s.code)}, not a coin in`;
      const tok = kind === 'token';
      if (token !== null && token !== tok) return `line ${line}'s records disagree on whether it is a token`;
      token = tok;
    }
    lines.push({ line, credits: [...values][0]!, change: [], ...(token ? { token: true } : {}) });
  }
  if (lines.every((l) => l.credits === 0)) return 'no line reaches a record that credits';
  const meters = readPatternMeters(rom, mids);
  const coinMeterBits = new Set<number>();
  if (meters) {
    for (const s of scr.scripts.values()) {
      if (s.code === null || dataPakCoinInKind(s.code) === null) continue;
      if (!s.adds.some((x) => x.target === scr.credit && x.amount > 0)) continue;
      for (const x of s.adds) {
        const bit = x.amount > 0 && x.target !== scr.credit ? meters.get(x.target) : undefined;
        if (bit !== undefined) coinMeterBits.add(bit);
      }
    }
  }
  return {
    lines,
    ...(coinMeterBits.size ? { coinMeterBits: [...coinMeterBits].sort((x, y) => x - y) } : {}),
    pricePerCredit: null,
    source: `MPS2 value records ${hex(records[0]!.at)} matched by XOP 6, credit ${hex(scr.credit)}, code ${hex(recordsAt)}`,
  };
}

export function readCoinHandlers(rom: Uint8Array, io: Mps2CoinIo): CoinLineTable | Refusal | null {
  const test = (a: number): { bit: number; base: number; handler: number } | null => {
    const m = word(rom, a + 2);
    const base = word(rom, a + 6);
    if (word(rom, a) !== 0xc2a0 || word(rom, a + 4) !== 0xc2aa || word(rom, a + 8) !== 0x22a0 || word(rom, a + 10) !== m + 2) return null;
    if (word(rom, a + 12) !== 0x1607 || word(rom, a + 14) !== 0xc2a0 || word(rom, a + 16) !== m) return null;
    if (word(rom, a + 18) !== 0x4aa0 || word(rom, a + 20) !== m + 2 || word(rom, a + 22) !== base || word(rom, a + 24) !== 0x0460) return null;
    const mask = word(rom, m + 2);
    if (word(rom, m) !== 0 || mask <= 0 || mask >= 0x20 || (mask & (mask - 1))) return null;
    return { bit: 31 - Math.clz32(mask), base, handler: word(rom, a + 26) };
  };
  let scan = false;
  for (let a = 0; a + 4 <= rom.length && !scan; a += 2) scan = word(rom, a) === 0xc820 && word(rom, a + 2) === 0xc004;
  if (!scan) return null;
  for (let a = 0; a + 28 <= rom.length; a += 2) {
    const chain: { bit: number; handler: number }[] = [];
    for (let t = test(a), p = a; t && t.base === test(a)!.base; p += 28, t = test(p)) chain.push(t);
    if (chain.length !== LINES.length || new Set(chain.map((c) => c.bit)).size !== LINES.length) continue;
    const lines: CoinLine[] = [];
    let counter = -1;
    for (const { bit, handler } of chain) {
      const got = handlerCredit(rom, handler, io);
      if (got === null) return null;
      if ('refused' in got) return got;
      if (counter >= 0 && got.counter !== counter) return null;
      counter = got.counter;
      lines.push({ line: 19 + bit, credits: got.credits, change: [], ...(got.code !== null && dataPakCoinInKind(got.code) === 'token' ? { token: true } : {}) });
    }
    lines.sort((x, y) => x.line - y.line);
    return { lines, pricePerCredit: null, source: `MPS2 coin handlers, code ${hex(a)}` };
  }
  return null;
}

function handlerCredit(rom: Uint8Array, h: number, io: Mps2CoinIo): { credits: number; counter: number; code: number | null } | Refusal | null {
  if (word(rom, h) !== 0x0283 || word(rom, h + 2) !== 3) return null;
  let p = h + 4;
  if (word(rom, p) === 0x1602 && word(rom, p + 2) === 0x0460) p += 6;
  else if ((word(rom, p) & 0xff00) === 0x1300) p += 2;
  else return null;
  let r5: number | null = null; let code: number | null = null;
  for (let n = 0; n < 8; n++) {
    const w = word(rom, p);
    if (w === 0x0420) {
      if (r5 !== null && code === null) code = r5;
      r5 = null; p += 4;
    } else if (w === 0x0205) {
      r5 = word(rom, p + 2); p += 4;
    } else if (w === 0xa805) {
      return r5 === null ? null : { credits: r5, counter: word(rom, p + 2), code };
    } else if (w === 0xd160 && word(rom, p + 2) === 0xc00a) {
      if (word(rom, p + 4) !== 0x06c5 || word(rom, p + 6) !== 0x0945 || word(rom, p + 8) !== 0x0545 || word(rom, p + 10) !== 0x0245) return null;
      if (word(rom, p + 14) !== 0x1604 || word(rom, p + 16) !== 0x0205 || word(rom, p + 20) !== 0x0460) return null;
      const position = ~(io.rotaryByte >> 4) & word(rom, p + 12);
      if (position !== 0) return { refused: `coin handler at code ${hex(h)}: this rotary position pays change down a path that is not read` };
      return { credits: word(rom, p + 18), counter: creditCounter(rom, word(rom, p + 22)), code };
    } else return null;
  }
  return null;
}

function creditCounter(rom: Uint8Array, store: number): number {
  return word(rom, store) === 0xa805 ? word(rom, store + 2) : -1;
}

export function metersInPairs(rom: Uint8Array): boolean {
  return pairedBank(rom) !== null;
}

export function pairedBank(rom: Uint8Array): number | null {
  for (let a = 0; a + 28 <= rom.length; a += 2) {
    if (word(rom, a) !== 0x0247 || word(rom, a + 2) !== 0xfffe || word(rom, a + 4) !== 0x05a0) continue;
    const bank = word(rom, a + 6);
    if (word(rom, a + 8) === 0xa707 && word(rom, a + 10) === 0xc1e0 && word(rom, a + 12) === bank
      && word(rom, a + 14) === 0xc207 && word(rom, a + 16) === 0x0247 && word(rom, a + 18) === 0xfffe
      && word(rom, a + 20) === 0xa707 && word(rom, a + 22) === 0x0248 && word(rom, a + 24) === 1
      && word(rom, a + 26) === 0xc808 && word(rom, a + 28) === bank) return bank;
  }
  return null;
}

export function readCountedMeters(rom: Uint8Array): { coinBit: number; payBit: number; tubeBits: number } | null {
  const pc = word(rom, 0x46);
  if (pc < 0 || word(rom, pc) !== 0x62cd) return null;
  let base = -1;
  for (let p = pc + 2; p < pc + 12; p += 2) if (word(rom, p) === 0x05ab) { base = word(rom, p + 2); break; }
  if (base < 0) return null;
  let first = -1;
  let portACounters = 0;
  for (let a = 0; a + 4 <= rom.length && first < 0; a += 2) {
    if (word(rom, a) !== 0x0201 || word(rom, a + 2) !== base) continue;
    let counter = 0; let sinceBit0 = -1;
    for (let p = a + 4, n = 0; n < 40; n++) {
      const w = word(rom, p);
      if (w === 0x0202) sinceBit0 = word(rom, p + 2) === 0x0100 ? 0 : -1;
      else if (w === 0x06a0) { counter++; if (sinceBit0 >= 0) sinceBit0++; }
      else if (w === 0xd820 && word(rom, p + 4) === METER_PORT) {
        if (sinceBit0 === 8) first = counter - 8;
        break;
      } else if (w === 0xd820 && word(rom, p + 4) === 0xc000 && sinceBit0 === counter) portACounters = counter;
      else if (w !== 0x0200 && w !== 0xd820) break;
      p += insnLen(rom, p);
    }
  }
  if (first < 0) return null;
  const bitOf = (xop: number): number | null => {
    if ((xop & 0xfff0) !== 0x2c40) return null;
    const bit = (xop & 15) - first;
    return bit >= 0 && bit < 8 ? bit : null;
  };
  const added = (p: number): boolean => word(rom, p) === 0x2ca0 && word(rom, p + 4) === 0x2ca0;
  let coinBit: number | null = null; let payBit: number | null = null; let payAt = -1;
  for (let a = 8; a + 16 <= rom.length; a += 2) {
    if (coinBit === null && word(rom, a) === 0xc0c2 && added(a + 4) && word(rom, a + 12) === 0x0603 && (word(rom, a + 14) & 0xff00) === 0x1600
      && word(rom, a - 8) === 0xc24b) {
      let calls = 0;
      for (let c = 4; c + 4 <= rom.length; c += 2) {
        if (word(rom, c) !== 0x06a0 || word(rom, c + 2) !== a - 8) continue;
        for (let back = c - 4; back >= Math.max(0, c - 12); back -= 2) if (word(rom, back) === 0x0202 && word(rom, back + 2) > 0) { calls++; break; }
      }
      if (calls >= 2) coinBit = bitOf(word(rom, a + 2));
    }
    if (payBit === null && word(rom, a) === 0x6801 && word(rom, a + 4) === 0x7420 && added(a + 10)) { payBit = bitOf(word(rom, a + 8)); payAt = a; }
  }
  if (coinBit === null || payBit === null || coinBit === payBit) return null;
  let tubeBits = 0;
  for (let a = 0; a + 12 <= rom.length; a += 2) {
    const x = word(rom, a);
    if ((x & 0xfff0) !== 0x2c40 || word(rom, a + 2) !== 0x0200 || word(rom, a + 6) !== 0x0201 || word(rom, a + 8) <= 0) continue;
    const next = a + 10; const j = word(rom, next);
    const reaches = next === payAt || ((j & 0xff00) === 0x1000 && next + 2 + ((j << 24) >> 23) === payAt);
    if (reaches && (x & 15) < portACounters) tubeBits |= 1 << (x & 15);
  }
  return { coinBit, payBit, tubeBits };
}

export function readCreditMeters(rom: Uint8Array): { payBit: number; tubeBits: number } | null {
  const isRam = (a: number): boolean => a >= 0xe800 && a < 0xf100;
  const records = (() => {
    for (let a = 4; a + 8 <= rom.length; a += 2) {
      const ai = word(rom, a);
      if ((ai & 0xfff0) !== 0x0220 || word(rom, a + 2) !== 4 || (word(rom, a + 4) & 0xfff0) !== 0x0910 || word(rom, a + 6) !== 0x17fc) continue;
      if (word(rom, a - 4) !== (0x0200 | (ai & 15))) continue;
      const base = word(rom, a - 2);
      let n = 0;
      for (let k = 1; k <= 8; k++) {
        const c = word(rom, base + 4 * k); const v = word(rom, base + 4 * k + 2);
        if (!isRam(c) || v < 1 || v > 0xff) break;
        n++;
      }
      if (n >= 3) return true;
    }
    return false;
  })();
  const pairs = (a: number): Map<number, number> => {
    const m = new Map<number, number>();
    for (let p = a; isRam(word(rom, p)) && word(rom, p + 2) < 0x40; p += 4) m.set(word(rom, p), word(rom, p + 2));
    return m;
  };
  let meters: Map<number, number> | null = null; let tubeBits = 0;
  for (let a = 4; a + 8 <= rom.length && !meters; a += 2) {
    if (!isRam(word(rom, a)) || word(rom, a + 2) !== 0x20 || word(rom, a - 2) !== 0) continue;
    const m = pairs(a);
    if (m.size < 3) continue;
    meters = m;
    for (let p = a - 6; p >= 0 && isRam(word(rom, p)) && word(rom, p + 2) < 0x40; p -= 4) {
      const out = word(rom, p + 2);
      if (out >= 0x10 && out <= 0x12) tubeBits |= 1 << (out - 0x10);
    }
  }
  const bit = (out: number | undefined): number | null => (out !== undefined && out >= 0x20 && out < 0x28 ? out - 0x20 : null);
  if (meters) {
    for (let a = 0; a + 18 <= rom.length; a += 2) {
      if (word(rom, a) !== 0x6822 || word(rom, a + 6) !== 0x0622 || word(rom, a + 10) !== 0xa822 || word(rom, a + 12) !== word(rom, a + 2)) continue;
      const payBit = bit(meters.get(word(rom, a + 14)));
      if (payBit !== null && tubeBits) return { payBit, tubeBits };
    }
    if (!records) return null;
    for (let a = 0; a + 12 <= rom.length; a += 2) {
      if ((word(rom, a) & 0xff00) !== 0x8000 || !isRam(word(rom, a + 2)) || (word(rom, a + 4) & 0xff00) !== 0x4000 || !isRam(word(rom, a + 6))) continue;
      if (word(rom, a + 8) !== 0x8001 || !isRam(word(rom, a + 10))) continue;
      const payBit = bit(meters.get(word(rom, a + 2)));
      if (payBit !== null && tubeBits) return { payBit, tubeBits };
      return null;
    }
    return null;
  }
  if (!records) return null;
  for (let n = 3; n < 16; n++) {
    const h = word(rom, 0x42 + n * 4);
    if (h <= 0 || h + 32 > rom.length || (word(rom, h) & 0xfff0) !== 0xc1f0) continue;
    let list = -1;
    for (let p = h + 2; p < h + 30; p += 2) {
      if (word(rom, p) === 0xc1a7) list = word(rom, p + 2);
      if (word(rom, p) === 0x0380) break;
    }
    if (list < 0) continue;
    let k = -1;
    const xop = 0x2c00 | (n << 6);
    for (let a = 0x60; a + 6 <= rom.length; a += 2) {
      const w = word(rom, a);
      if ((w & 0xfff0) !== (xop | 0x20) || !(w & 15)) continue;
      const d = word(rom, a + 4);
      if (word(rom, word(rom, a + 2)) > 0 && word(rom, word(rom, a + 2)) <= 0xff && !(d & 1) && d <= 14 && (k < 0 || d < k)) k = d;
    }
    if (k < 0) continue;
    let end = list;
    while (isRam(word(rom, end)) || word(rom, end) === 0) end += 2;
    const outs = rom.subarray(end + 2, end + 2 + (end - list) / 2);
    const payBit = bit(outs[k / 2]);
    if (payBit === null) continue;
    let tubes = 7;
    for (const o of outs) if (o >= 0x10 && o <= 0x12) tubes &= ~(1 << (o - 0x10));
    return tubes ? { payBit, tubeBits: tubes } : null;
  }
  return null;
}

export class PendingCounterFinder {
  private static readonly STEPS = 5;
  private static readonly MAX_STEPS = 9;
  private static readonly GAP = 1_500_000;
  private static readonly DROP_WAIT = 4_500_000;
  private base: Uint8Array | null = null;
  private baseAt = 0;
  rose = false;
  private last: Uint8Array | null = null;
  private candidates: number[] = [];
  private line = -1;
  private at = 0;
  private steps = 0;
  private dropSeen = false;

  dropped(ram: Uint8Array, lo: number, hi: number, now: number): void {
    this.dropSeen = true;
    if (!this.last && !this.base) { this.base = ram.slice(lo, hi + 1); this.baseAt = now; }
  }

  pulse(line: number, ram: Uint8Array, lo: number, hi: number, now: number): number | null {
    if (this.last && (now < this.at || now - this.at > PendingCounterFinder.GAP)) this.last = null;
    if (!this.last) {
      if (!this.base) return null;
      const base = this.base;
      this.base = null;
      if (now < this.baseAt || now - this.baseAt > PendingCounterFinder.DROP_WAIT) return null;
      this.candidates = [];
      for (let a = lo; a <= hi; a++) {
        const up = (ram[a]! - base[a - lo]!) & 0xff;
        if (up > 0 && up < 0x80) this.candidates.push(a);
      }
      if (!this.candidates.length) return null;
      this.last = ram.slice(lo, hi + 1);
      this.line = line;
      this.at = now;
      this.steps = 0;
      this.dropSeen = false;
      return null;
    }
    if (line !== this.line) return null;
    this.at = now;
    const last = this.last;
    const dropSeen = this.dropSeen;
    let rose = false;
    this.candidates = this.candidates.filter((a) => {
      const d = (ram[a]! - last[a - lo]!) & 0xff;
      if (d === 0xff) return true;
      if (dropSeen && d > 0 && d < 0x80) return (rose = true);
      return false;
    });
    this.rose = rose;
    this.dropSeen = false;
    if (!this.candidates.length) { this.last = null; return null; }
    last.set(ram.subarray(lo, hi + 1));
    this.steps++;
    if (this.steps < PendingCounterFinder.STEPS || (this.candidates.length > 1 && this.steps < PendingCounterFinder.MAX_STEPS)) return null;
    this.last = null;
    return this.candidates[0]!;
  }
}

export function readMps2CoinTable(rom: Uint8Array, io: Mps2CoinIo): CoinLineTable | Refusal {
  const words = readWordTable(rom, io);
  if (words) return words;
  const jpm = readJpmRecords(rom, io);
  if (jpm) return jpm;
  const pat = readPatternRecords(rom, io);
  if (pat) return pat;
  const handlers = readCoinHandlers(rom, io);
  if (handlers) return handlers;
  return { refused: 'no known MPS2 coin-table code (word table, JPM records, pence records, coin handlers)' };
}
