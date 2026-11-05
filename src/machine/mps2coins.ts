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
  }
  return null;
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

export function readPatternRecords(rom: Uint8Array): Refusal | null {
  for (let a = 0; a + 12 <= rom.length; a += 2) {
    if ((word(rom, a) & 0xfff0) !== 0x0200) continue;
    if (word(rom, a + 4) !== (0x0220 | (word(rom, a) & 15)) || word(rom, a + 6) !== 0x0008) continue;
    if ((word(rom, a + 10) & 0xff00) !== 0x1300 || word(rom, a + 12) !== 0x2db0) continue;
    const pence: number[] = [];
    for (let r = word(rom, a + 2) + 8; r + 8 <= rom.length && word(rom, r) > 0 && pence.length < 16; r += 8) pence.push(word(rom, r + 2));
    return {
      refused: `pence coin records at code ${hex(a)} (${pence.map((p) => `${p}p`).join(', ')}): which line each is lives in a pulse pattern that is not read`,
    };
  }
  return null;
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
  const pat = readPatternRecords(rom);
  if (pat) return pat;
  const handlers = readCoinHandlers(rom, io);
  if (handlers) return handlers;
  return { refused: 'no known MPS2 coin-table code (word table, JPM records, pence records, coin handlers)' };
}
