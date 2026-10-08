import type { ChangeTerm, CoinLine, CoinLineTable, Refusal } from './coinwiring';

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
    return {
      lines,
      pricePerCredit: null,
      source: `MPS2 word table ${hex(credit)}${variant ? ` + ${hex(variant)} (rotary)` : ''}${change >= 0 ? `, change ${hex(change)}` : ''}, code ${hex(a)}`,
    };
  }
  return null;
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
      }
      const token = meters !== null && tokenIn && !cashIn;
      lines.push({ line, credits, change: anyChange ? change : [], ...(token ? { token: true } : {}) });
    }
    if (lines.every((l) => l.credits === 0)) continue;
    return {
      lines,
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

export function readMps2CoinTable(rom: Uint8Array, io: Mps2CoinIo): CoinLineTable | Refusal {
  const words = readWordTable(rom, io);
  if (words) return words;
  const jpm = readJpmRecords(rom, io);
  if (jpm) return jpm;
  const pat = readPatternRecords(rom);
  if (pat) return pat;
  return { refused: 'no known MPS2 coin-table code (word table, JPM records, pence records)' };
}
