import { coldfireCycleTable } from './cfcycles';
import { CPU32_NO_ENTRY, cpu32CycleTable, cpu32ExceptionCycles } from './cpu32cycles';
import { HEAD_FROM_EA, cpu32EaHead, cpu32OpHeadTable, cpu32TailTable } from './cpu32overlap';
import {
  JMP_CYCLES68, JSR_CYCLES68, LEA_CYCLES68, MOVEM_TO_MEM68, MOVEM_TO_REG68, PEA_CYCLES68,
  aluBase68, controlCost68, eaCost68, moveDstCost68, rmwBase68,
} from './m68ktiming';

export enum K {
  FALLBACK = 0,
  MOVE,
  MOVEA,
  MOVEQ,
  LEA,
  PEA,
  CLR,
  TST,
  NOT,
  NEG,
  EXT,
  EXTB,
  SWAP,
  ALU,
  CMPA,
  ADDA,
  ADDQ,
  IMM_ALU,
  BITOP_DYN,
  BITOP_IMM,
  SHIFT_REG,
  SHIFT_MEM,
  BRA,
  BSR,
  BCC,
  DBCC,
  SCC,
  JMP,
  JSR,
  RTS,
  RTD,
  RTR,
  MUL_W,
  MUL_L,
  DIV_W,
  DIV_L,
  MOVEM,
  LINK,
  UNLK,
  EXG,
  NOP,
  RTE,
  SR_IMM,
  MOVE_FROM_SR,
  MOVE_TO_SR,
  TRAP,
  CHK,
}

export const XM_DN = 0;
export const XM_AN = 1;
export const XM_AI = 2;
export const XM_PI = 3;
export const XM_PD = 4;
export const XM_D16 = 5;
export const XM_IX = 6;
export const XM_AW = 7;
export const XM_AL = 8;
export const XM_PCD = 9;
export const XM_PCIX = 10;
export const XM_IMM = 11;
const XM_BAD = 15;

const SIZE_BYTES = [1, 2, 4];

export enum AluOp { Or = 0, And = 1, Sub = 2, Add = 3, Eor = 5, Cmp = 6 }

const PAGE_SHIFT = 11;
const PAGE_WORDS = 1 << PAGE_SHIFT;

export class PredecodePage {
  readonly kind = new Uint8Array(PAGE_WORDS);
  readonly len = new Uint8Array(PAGE_WORDS);
  readonly cyc = new Uint8Array(PAGE_WORDS);
  readonly a = new Int32Array(PAGE_WORDS);
  readonly b = new Int32Array(PAGE_WORDS);
  readonly c = new Int32Array(PAGE_WORDS);
  readonly c32Head = new Int8Array(PAGE_WORDS);
  readonly c32Tail = new Int8Array(PAGE_WORDS);
  readonly seen = new Uint8Array(PAGE_WORDS);
  readonly head = new Uint16Array(PAGE_WORDS);
}

interface Decoded {
  kind: K;
  words: number;
  a: number;
  b: number;
  c: number;
  cyc0?: number;
  head?: number;
  extra?: number;
  c68?: number;
}

const FALLBACK_D: Decoded = { kind: K.FALLBACK, words: 1, a: 0, b: 0, c: 0 };

export type PredecodeVariant = 'coldfire' | 'cpu32' | '68000';

const hd = cpu32EaHead;

export class Predecode {
  readonly base: number;
  readonly nWords: number;
  private readonly romW: Uint16Array | null;
  private readonly live: Uint8Array | null;
  private readonly pages: (PredecodePage | null)[];
  private readonly cf: Uint8Array | null;
  private readonly c32: Uint8Array | null;
  private readonly c32Heads: Int8Array | null;
  private readonly c32Tails: Int8Array | null;
  fallbacks = 0;
  lookups = 0;

  constructor(base: number, romBytes: Uint8Array, readonly variant: PredecodeVariant = 'coldfire', live = false) {
    this.base = base >>> 0;
    this.nWords = romBytes.length >> 1;
    if (live) {
      this.live = romBytes;
      this.romW = null;
    } else {
      const w = new Uint16Array(this.nWords);
      for (let i = 0; i < this.nWords; i++) w[i] = (romBytes[i * 2] << 8) | romBytes[i * 2 + 1];
      this.romW = w;
      this.live = null;
    }
    this.pages = new Array(((this.nWords + PAGE_WORDS - 1) >> PAGE_SHIFT)).fill(null);
    const cpu32 = variant === 'cpu32';
    this.cf = variant === 'coldfire' ? coldfireCycleTable() : null;
    this.c32 = cpu32 ? cpu32CycleTable() : null;
    this.c32Heads = cpu32 ? cpu32OpHeadTable() : null;
    this.c32Tails = cpu32 ? cpu32TailTable() : null;
  }

  page(idx: number): PredecodePage {
    const p = this.pages[idx >> PAGE_SHIFT];
    if (p !== null) return p;
    const fresh = new PredecodePage();
    this.pages[idx >> PAGE_SHIFT] = fresh;
    return fresh;
  }

  forget(idx: number): void {
    const p = this.pages[idx >> PAGE_SHIFT];
    if (p !== null) p.seen[idx & (PAGE_WORDS - 1)] = 0;
  }

  kindAt(idx: number, p: PredecodePage): number {
    const o = idx & (PAGE_WORDS - 1);
    if (p.seen[o]) return p.kind[o];
    const d = this.decode(idx);
    const op = this.word(idx);
    let cyc: number;
    let kind: number;
    if (this.cf !== null) {
      cyc = this.cf[op] || d.cyc0 || 0;
      kind = cyc === 0 ? K.FALLBACK : d.kind;
    } else if (this.c32 === null) {
      cyc = d.c68 ?? 0;
      kind = cyc === 0 || cyc > 255 ? K.FALLBACK : d.kind;
    } else {
      const c = this.c32![op];
      cyc = c === CPU32_NO_ENTRY ? 0 : c + (d.extra ?? 0);
      kind = cyc === 0 || cyc > 255 ? K.FALLBACK : d.kind;
      const h = this.c32Heads![op];
      p.c32Head[o] = h === HEAD_FROM_EA ? (d.head ?? 0) : h;
      p.c32Tail[o] = this.c32Tails![op];
    }
    p.seen[o] = 1;
    p.kind[o] = kind;
    p.len[o] = d.words * 2;
    p.cyc[o] = cyc;
    p.a[o] = d.a;
    p.b[o] = d.b;
    p.c[o] = d.c;
    return kind;
  }

  private word(idx: number): number {
    const l = this.live;
    return l === null ? this.romW![idx] : (l[idx * 2] << 8) | l[idx * 2 + 1];
  }

  private long(idx: number): number {
    return ((this.word(idx) << 16) | this.word(idx + 1)) | 0;
  }

  private decode(idx: number): Decoded {
    const op = this.word(idx);
    switch (op >> 12) {
      case 0x0: return this.decodeGroup0(op, idx);
      case 0x1: return this.decodeMove(op, idx, 0);
      case 0x2: return this.decodeMove(op, idx, 2);
      case 0x3: return this.decodeMove(op, idx, 1);
      case 0x4: return this.decodeGroup4(op, idx);
      case 0x5: return this.decodeGroup5(op, idx);
      case 0x6: return this.decodeBranch(op, idx);
      case 0x7:
        if (op & 0x0100) return FALLBACK_D;
        return { kind: K.MOVEQ, words: 1, a: ((op >> 9) & 7) << 12, b: (op << 24) >> 24, c: 0, c68: 4 };
      case 0x8: return this.decodeGroup8(op, idx);
      case 0x9: return this.decodeAddSub(op, idx, true);
      case 0xb: return this.decodeGroupB(op, idx);
      case 0xc: return this.decodeGroupC(op, idx);
      case 0xd: return this.decodeAddSub(op, idx, false);
      case 0xe: return this.decodeShift(op, idx);
      default: return FALLBACK_D;
    }
  }

  private ea(mode: number, reg: number, size: number, at: number, forWrite: boolean):
      { x: number; payload: number; payload2: number; words: number } {
    const none = { payload: 0, payload2: 0, words: 0 };
    switch (mode) {
      case 0: return { x: XM_DN, ...none };
      case 1: return { x: XM_AN, ...none };
      case 2: return { x: XM_AI, ...none };
      case 3: return { x: XM_PI, payload: size === 1 && reg === 7 ? 2 : size, payload2: 0, words: 0 };
      case 4: return { x: XM_PD, payload: size === 1 && reg === 7 ? 2 : size, payload2: 0, words: 0 };
      case 5: return { x: XM_D16, payload: (this.word(at) << 16) >> 16, payload2: 0, words: 1 };
      case 6: {
        const brief = this.brief(this.word(at));
        if (brief < 0) return { x: XM_BAD, ...none };
        return { x: XM_IX, payload: brief, payload2: 0, words: 1 };
      }
      case 7:
        switch (reg) {
          case 0: return { x: XM_AW, payload: ((this.word(at) << 16) >> 16) | 0, payload2: 0, words: 1 };
          case 1: return { x: XM_AL, payload: this.long(at), payload2: 0, words: 2 };
          case 2: {
            if (forWrite) return { x: XM_BAD, ...none };
            const base = (this.base + at * 2) >>> 0;
            return { x: XM_PCD, payload: (base + ((this.word(at) << 16) >> 16)) | 0, payload2: 0, words: 1 };
          }
          case 3: {
            if (forWrite) return { x: XM_BAD, ...none };
            const brief = this.brief(this.word(at));
            if (brief < 0) return { x: XM_BAD, ...none };
            const base = (this.base + at * 2) >>> 0;
            return { x: XM_PCIX, payload: brief, payload2: base | 0, words: 1 };
          }
          case 4: {
            if (forWrite) return { x: XM_BAD, ...none };
            if (size === 4) return { x: XM_IMM, payload: this.long(at), payload2: 0, words: 2 };
            const w = this.word(at);
            return { x: XM_IMM, payload: size === 1 ? w & 0xff : w, payload2: 0, words: 1 };
          }
        }
    }
    return { x: XM_BAD, ...none };
  }

  private brief(ext: number): number {
    if (this.variant === '68000') return Predecode.packBrief(ext) & ~(3 << 21);
    if (ext & 0x0100) return -1;
    return Predecode.packBrief(ext);
  }

  private static packBrief(ext: number): number {
    const reg = ((ext >> 12) & 7) | (ext & 0x8000 ? 8 : 0);
    const long = ext & 0x0800 ? 1 : 0;
    const scale = (ext >> 9) & 3;
    const disp = ext & 0xff;
    return disp | (reg << 16) | (long << 20) | (scale << 21);
  }

  private static packA(srcX: number, srcReg: number, dstX: number, dstReg: number,
      sizeIdx: number, aux: number, flag1: number): number {
    return srcX | (srcReg << 4) | (dstX << 8) | (dstReg << 12)
      | (sizeIdx << 16) | (aux << 18) | (flag1 << 26);
  }

  private decodeMove(op: number, idx: number, sizeIdx: number): Decoded {
    const size = SIZE_BYTES[sizeIdx];
    const srcMode = (op >> 3) & 7;
    const srcReg = op & 7;
    const dstMode = (op >> 6) & 7;
    const dstReg = (op >> 9) & 7;
    if (sizeIdx === 0 && srcMode === 1) return FALLBACK_D;
    if (dstMode === 7 && dstReg > 1) return FALLBACK_D;
    const src = this.ea(srcMode, srcReg, size, idx + 1, false);
    if (src.x === XM_BAD) return FALLBACK_D;
    if (dstMode === 1) {
      if (sizeIdx === 0) return FALLBACK_D;
      return {
        kind: K.MOVEA, words: 1 + src.words,
        a: Predecode.packA(src.x, srcReg, XM_AN, dstReg, sizeIdx, 0, 0),
        b: src.payload, c: src.payload2,
        head: hd(srcMode, srcReg),
        c68: eaCost68(srcMode, srcReg, size) + 4,
      };
    }
    const dst = this.ea(dstMode, dstReg, size, idx + 1 + src.words, true);
    if (dst.x === XM_BAD) return FALLBACK_D;
    if (src.x === XM_PCIX && dst.x !== XM_DN && dst.x !== XM_AI) return FALLBACK_D;
    const c = src.x === XM_PCIX ? src.payload2 : dst.payload;
    return {
      kind: K.MOVE, words: 1 + src.words + dst.words,
      a: Predecode.packA(src.x, srcReg, dst.x, dstReg, sizeIdx, 0, 0),
      b: src.payload, c,
      head: hd(srcMode, srcReg) || hd(dstMode, dstReg),
      c68: eaCost68(srcMode, srcReg, size) + (dstMode === 0 ? 0 : moveDstCost68(dstMode, dstReg, size)) + 4,
    };
  }

  private decodeGroup0(op: number, idx: number): Decoded {
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    if (op & 0x0100) {
      if (mode === 1) return FALLBACK_D;
      const kindBits = (op >> 6) & 3;
      const size = mode === 0 ? 4 : 1;
      const eaOp = this.ea(mode, reg, size, idx + 1, kindBits !== 0);
      if (eaOp.x === XM_BAD || eaOp.x === XM_AN) return FALLBACK_D;
      return {
        kind: K.BITOP_DYN, words: 1 + eaOp.words,
        a: Predecode.packA(eaOp.x, reg, XM_DN, (op >> 9) & 7, mode === 0 ? 2 : 0, kindBits, 0),
        b: eaOp.payload, c: eaOp.payload2,
        head: hd(mode, reg),
        c68: Predecode.bit68(kindBits, mode, reg, size, 0),
      };
    }
    if ((op & 0x0f00) === 0x0800) {
      const kindBits = (op >> 6) & 3;
      const bitNo = this.word(idx + 1) & 0xff;
      const size = mode === 0 ? 4 : 1;
      const eaOp = this.ea(mode, reg, size, idx + 2, kindBits !== 0);
      if (eaOp.x === XM_BAD || eaOp.x === XM_AN || eaOp.x === XM_IMM
        || eaOp.x === XM_PCIX) return FALLBACK_D;
      return {
        kind: K.BITOP_IMM, words: 2 + eaOp.words,
        a: Predecode.packA(eaOp.x, reg, XM_DN, 0, mode === 0 ? 2 : 0, kindBits, 0),
        b: eaOp.payload,
        c: bitNo,
        head: hd(mode, reg),
        c68: Predecode.bit68(kindBits, mode, reg, size, 4),
      };
    }
    const sizeBits = (op >> 6) & 3;
    if (sizeBits === 3) return FALLBACK_D;
    const kind = (op >> 9) & 7;
    if (kind === 7 || kind === 4) return FALLBACK_D;
    if (mode === 7 && reg === 4) {
      if (this.variant !== 'cpu32' || !(kind === 0 || kind === 1 || kind === 5) || sizeBits === 2) return FALLBACK_D;
      return {
        kind: K.SR_IMM, words: 2,
        a: Predecode.packA(XM_IMM, 0, XM_DN, 0, sizeBits, kind, sizeBits === 1 ? 1 : 0),
        b: this.word(idx + 1), c: 0,
      };
    }
    const size = SIZE_BYTES[sizeBits];
    const immWords = size === 4 ? 2 : 1;
    const imm = size === 4 ? this.long(idx + 1)
      : size === 1 ? this.word(idx + 1) & 0xff : this.word(idx + 1);
    const dst = this.ea(mode, reg, size, idx + 1 + immWords, kind !== 6);
    if (dst.x === XM_BAD || dst.x === XM_AN || dst.x === XM_IMM) return FALLBACK_D;
    if (kind === 6 && (dst.x === XM_PCD || dst.x === XM_PCIX)) return FALLBACK_D;
    if (dst.x === XM_PCIX) return FALLBACK_D;
    return {
      kind: K.IMM_ALU, words: 1 + immWords + dst.words,
      a: Predecode.packA(XM_IMM, 0, dst.x, reg, sizeBits, kind, 0),
      b: imm, c: dst.payload,
      head: hd(7, 4),
      c68: eaCost68(7, 4, size) + eaCost68(mode, reg, size)
        + (kind === 6 ? (mode === 0 && size === 4 ? 6 : 4)
          : mode === 0 ? (size === 4 ? 8 : 4) : (size === 4 ? 12 : 8)),
    };
  }

  private decodeGroup4(op: number, idx: number): Decoded {
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    if (op === 0x4afc) return FALLBACK_D;
    if ((op & 0xfff8) === 0x49c0) {
      return { kind: K.EXTB, words: 1, a: reg << 4, b: 0, c: 0 };
    }
    if ((op & 0xf1c0) === 0x41c0) {
      const eaOp = this.controlEa(mode, reg, idx + 1);
      if (eaOp === null) return FALLBACK_D;
      return {
        kind: K.LEA, words: 1 + eaOp.words,
        a: Predecode.packA(eaOp.x, reg, XM_AN, (op >> 9) & 7, 2, 0, 0),
        b: eaOp.payload, c: eaOp.payload2,
        head: hd(mode, reg),
        c68: controlCost68(LEA_CYCLES68, mode, reg),
      };
    }
    if ((op & 0xf1c0) === 0x4180) {
      if (this.variant !== 'cpu32') return FALLBACK_D;
      const src = this.ea(mode, reg, 2, idx + 1, false);
      if (src.x === XM_BAD || src.x === XM_AN) return FALLBACK_D;
      return {
        kind: K.CHK, words: 1 + src.words,
        a: Predecode.packA(src.x, reg, XM_DN, (op >> 9) & 7, 1, cpu32ExceptionCycles(6), 0),
        b: src.payload, c: src.payload2,
        head: hd(mode, reg),
      };
    }
    if ((op & 0xffc0) === 0x40c0 || (op & 0xffc0) === 0x42c0) {
      if (this.variant !== 'cpu32') return FALLBACK_D;
      const dst = this.rmwEaOf(mode, reg, 2, idx + 1);
      if (dst === null) return FALLBACK_D;
      return {
        kind: K.MOVE_FROM_SR, words: 1 + dst.words,
        a: Predecode.packA(XM_DN, 0, dst.x, reg, 1, 0, (op & 0xffc0) === 0x42c0 ? 1 : 0),
        b: 0, c: dst.payload,
        head: hd(mode, reg),
      };
    }
    if ((op & 0xffc0) === 0x44c0 || (op & 0xffc0) === 0x46c0) {
      if (this.variant !== 'cpu32') return FALLBACK_D;
      const src = this.ea(mode, reg, 2, idx + 1, false);
      if (src.x === XM_BAD || src.x === XM_AN) return FALLBACK_D;
      return {
        kind: K.MOVE_TO_SR, words: 1 + src.words,
        a: Predecode.packA(src.x, reg, XM_DN, 0, 1, 0, (op & 0xffc0) === 0x44c0 ? 1 : 0),
        b: src.payload, c: src.payload2,
        head: hd(mode, reg),
      };
    }

    const sizeBits = (op >> 6) & 3;
    switch (op & 0xff00) {
      case 0x4000: case 0x4400: {
        if (sizeBits === 3) break;
        const dst = this.rmwEaOf(mode, reg, SIZE_BYTES[sizeBits], idx + 1);
        if (dst === null) return FALLBACK_D;
        return {
          kind: K.NEG, words: 1 + dst.words,
          a: Predecode.packA(XM_DN, 0, dst.x, reg, sizeBits, 0, (op & 0x0400) ? 0 : 1),
          b: 0, c: dst.payload,
          head: hd(mode, reg),
          c68: eaCost68(mode, reg, SIZE_BYTES[sizeBits]) + rmwBase68(SIZE_BYTES[sizeBits], mode),
        };
      }
      case 0x4200: {
        if (sizeBits === 3) break;
        const dst = this.rmwEaOf(mode, reg, SIZE_BYTES[sizeBits], idx + 1);
        if (dst === null) return FALLBACK_D;
        return {
          kind: K.CLR, words: 1 + dst.words,
          a: Predecode.packA(XM_DN, 0, dst.x, reg, sizeBits, 0, 0),
          b: 0, c: dst.payload,
          head: hd(mode, reg),
          c68: eaCost68(mode, reg, SIZE_BYTES[sizeBits]) + rmwBase68(SIZE_BYTES[sizeBits], mode),
        };
      }
      case 0x4600: {
        if (sizeBits === 3) break;
        const dst = this.rmwEaOf(mode, reg, SIZE_BYTES[sizeBits], idx + 1);
        if (dst === null) return FALLBACK_D;
        return {
          kind: K.NOT, words: 1 + dst.words,
          a: Predecode.packA(XM_DN, 0, dst.x, reg, sizeBits, 0, 0),
          b: 0, c: dst.payload,
          head: hd(mode, reg),
          c68: eaCost68(mode, reg, SIZE_BYTES[sizeBits]) + rmwBase68(SIZE_BYTES[sizeBits], mode),
        };
      }
      case 0x4a00: {
        if (sizeBits === 3) return FALLBACK_D;
        if (sizeBits === 0 && (mode === 1 || (mode === 7 && reg > 1))) return FALLBACK_D;
        const src = this.ea(mode, reg, SIZE_BYTES[sizeBits], idx + 1, false);
        if (src.x === XM_BAD || src.x === XM_PCIX) return FALLBACK_D;
        return {
          kind: K.TST, words: 1 + src.words,
          a: Predecode.packA(src.x, reg, XM_DN, 0, sizeBits, 0, 0),
          b: src.payload, c: 0,
          head: hd(mode, reg),
          c68: mode === 1 || (mode === 7 && reg > 1) ? undefined : eaCost68(mode, reg, SIZE_BYTES[sizeBits]) + 4,
        };
      }
    }

    if ((op & 0xfff8) === 0x4840) {
      return { kind: K.SWAP, words: 1, a: reg << 4, b: 0, c: 0, c68: 4 };
    }
    if ((op & 0xffc0) === 0x4840) {
      const eaOp = this.controlEa(mode, reg, idx + 1);
      if (eaOp === null) return FALLBACK_D;
      return {
        kind: K.PEA, words: 1 + eaOp.words,
        a: Predecode.packA(eaOp.x, reg, XM_DN, 0, 2, 0, 0),
        b: eaOp.payload, c: eaOp.payload2,
        head: hd(mode, reg),
        c68: controlCost68(PEA_CYCLES68, mode, reg),
      };
    }
    if ((op & 0xffb8) === 0x4880) {
      return { kind: K.EXT, words: 1, a: (reg << 4) | ((op & 0x0040) ? (2 << 16) : (1 << 16)), b: 0, c: 0, c68: 4 };
    }
    if ((op & 0xfff8) === 0x4808) return FALLBACK_D;
    if ((op & 0xffc0) === 0x4800) return FALLBACK_D;
    if ((op & 0xffc0) === 0x4c00) {
      const ext = this.word(idx + 1);
      if (ext & 0x0400) return FALLBACK_D;
      const src = this.ea(mode, reg, 4, idx + 2, false);
      if (src.x === XM_BAD || src.x === XM_AN || src.x === XM_PCIX) return FALLBACK_D;
      return {
        kind: K.MUL_L, words: 2 + src.words,
        a: Predecode.packA(src.x, reg, XM_DN, (ext >> 12) & 7, 2, 0, (ext & 0x0800) ? 1 : 0),
        b: src.payload, c: 0,
        head: hd(mode, reg),
      };
    }
    if ((op & 0xffc0) === 0x4c40) {
      const ext = this.word(idx + 1);
      if (ext & 0x0400) return FALLBACK_D;
      const src = this.ea(mode, reg, 4, idx + 2, false);
      if (src.x === XM_BAD || src.x === XM_AN || src.x === XM_PCIX) return FALLBACK_D;
      return {
        kind: K.DIV_L, words: 2 + src.words,
        a: Predecode.packA(src.x, reg, XM_DN, (ext >> 12) & 7, 2, ext & 7, (ext & 0x0800) ? 1 : 0),
        b: src.payload, c: 0,
        head: hd(mode, reg),
      };
    }
    if ((op & 0xfb80) === 0x4880) {
      const toRegs = (op & 0x0400) !== 0;
      const size = op & 0x0040 ? 4 : 2;
      const mask = this.word(idx + 1);
      let registers = 0;
      for (let i = 0; i < 16; i++) if (mask & (1 << i)) registers++;
      const extra = registers * 4;
      const c68 = controlCost68(toRegs ? MOVEM_TO_REG68 : MOVEM_TO_MEM68, mode, reg) + registers * (size === 4 ? 8 : 4);
      if (mode === 3) {
        if (!toRegs) return FALLBACK_D;
        return {
          kind: K.MOVEM, words: 2,
          a: Predecode.packA(XM_PI, reg, XM_DN, 0, size === 4 ? 2 : 1, 0, 1),
          b: mask, c: 0, extra, c68,
        };
      }
      if (mode === 4) {
        if (toRegs) return FALLBACK_D;
        return {
          kind: K.MOVEM, words: 2,
          a: Predecode.packA(XM_PD, reg, XM_DN, 0, size === 4 ? 2 : 1, 0, 0),
          b: mask, c: 0, extra, c68,
        };
      }
      const eaOp = this.controlEa(mode, reg, idx + 2);
      if (eaOp === null) return FALLBACK_D;
      if (!toRegs && (eaOp.x === XM_PCD || eaOp.x === XM_PCIX)) return FALLBACK_D;
      if (eaOp.x === XM_PCIX) return FALLBACK_D;
      return {
        kind: K.MOVEM, words: 2 + eaOp.words,
        a: Predecode.packA(eaOp.x, reg, XM_DN, 0, size === 4 ? 2 : 1, 0, toRegs ? 1 : 0),
        b: mask, c: eaOp.payload, extra, c68,
        head: hd(mode, reg),
      };
    }

    switch (op) {
      case 0x4e71: return { kind: K.NOP, words: 1, a: 0, b: 0, c: 0, c68: 4 };
      case 0x4e75: return { kind: K.RTS, words: 1, a: 0, b: 0, c: 0, c68: 16 };
      case 0x4e74: return { kind: K.RTD, words: 2, a: 0, b: (this.word(idx + 1) << 16) >> 16, c: 0 };
      case 0x4e77: return { kind: K.RTR, words: 1, a: 0, b: 0, c: 0, c68: 20 };
      case 0x4e73: return this.variant === 'cpu32' ? { kind: K.RTE, words: 1, a: 0, b: 0, c: 0 } : FALLBACK_D;
    }
    if ((op & 0xfff0) === 0x4e40) {
      if (this.variant !== 'cpu32') return FALLBACK_D;
      const vector = 32 + (op & 0x0f);
      return { kind: K.TRAP, words: 1, a: cpu32ExceptionCycles(vector) << 18, b: vector, c: 0 };
    }
    if ((op & 0xfff8) === 0x4e50) {
      return { kind: K.LINK, words: 2, a: reg << 4, b: (this.word(idx + 1) << 16) >> 16, c: 0, c68: 16 };
    }
    if ((op & 0xfff8) === 0x4e58) {
      return { kind: K.UNLK, words: 1, a: reg << 4, b: 0, c: 0, c68: 12 };
    }
    if ((op & 0xffc0) === 0x4e80) {
      const eaOp = this.controlEa(mode, reg, idx + 1);
      if (eaOp === null) return FALLBACK_D;
      return {
        kind: K.JSR, words: 1 + eaOp.words,
        a: Predecode.packA(eaOp.x, reg, XM_DN, 0, 2, 0, 0),
        b: eaOp.payload, c: eaOp.payload2,
        cyc0: Predecode.JSR_CYCLES[Predecode.controlIdx(eaOp.x)],
        head: hd(mode, reg),
        c68: controlCost68(JSR_CYCLES68, mode, reg),
      };
    }
    if ((op & 0xffc0) === 0x4ec0) {
      const eaOp = this.controlEa(mode, reg, idx + 1);
      if (eaOp === null) return FALLBACK_D;
      return {
        kind: K.JMP, words: 1 + eaOp.words,
        a: Predecode.packA(eaOp.x, reg, XM_DN, 0, 2, 0, 0),
        b: eaOp.payload, c: eaOp.payload2,
        cyc0: Predecode.JMP_CYCLES[Predecode.controlIdx(eaOp.x)],
        head: hd(mode, reg),
        c68: controlCost68(JMP_CYCLES68, mode, reg),
      };
    }
    return FALLBACK_D;
  }

  private static readonly JMP_CYCLES = JMP_CYCLES68;
  private static readonly JSR_CYCLES = JSR_CYCLES68;

  private static bit68(kindBits: number, mode: number, reg: number, size: number, extra: number): number {
    const ea = eaCost68(mode, reg, size);
    if (kindBits === 0) return ea + (mode === 0 ? 6 : 4) + extra;
    return ea + (mode === 0 && kindBits === 2 ? 10 : 8) + extra;
  }

  private static controlIdx(x: number): number {
    switch (x) {
      case XM_AI: return 0;
      case XM_D16: return 1;
      case XM_IX: return 2;
      case XM_AW: return 3;
      case XM_AL: return 4;
      case XM_PCD: return 5;
      default: return 6;
    }
  }

  private controlEa(mode: number, reg: number, at: number):
      { x: number; payload: number; payload2: number; words: number } | null {
    if (mode < 2 || mode === 3 || mode === 4) return null;
    const eaOp = this.ea(mode, reg, 2, at, false);
    if (eaOp.x === XM_BAD || eaOp.x === XM_IMM) return null;
    return eaOp;
  }

  private rmwEaOf(mode: number, reg: number, size: number, at: number):
      { x: number; payload: number; words: number } | null {
    if (mode === 1) return null;
    const eaOp = this.ea(mode, reg, size, at, true);
    if (eaOp.x === XM_BAD || eaOp.x === XM_IMM || eaOp.x === XM_PCD || eaOp.x === XM_PCIX) return null;
    return eaOp;
  }

  private decodeGroup5(op: number, idx: number): Decoded {
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    const sizeBits = (op >> 6) & 3;
    if (sizeBits === 3) {
      const cc = (op >> 8) & 0x0f;
      if (mode === 1) {
        const disp = (this.word(idx + 1) << 16) >> 16;
        const target = (this.base + (idx + 1) * 2 + disp) | 0;
        if (target & 1) return FALLBACK_D;
        return { kind: K.DBCC, words: 2, a: (reg << 4) | (cc << 18), b: target, c: 0, c68: 10 };
      }
      const dst = this.rmwEaOf(mode, reg, 1, idx + 1);
      if (dst === null) return FALLBACK_D;
      return {
        kind: K.SCC, words: 1 + dst.words,
        a: Predecode.packA(XM_DN, 0, dst.x, reg, 0, cc, 0),
        b: 0, c: dst.payload,
        head: hd(mode, reg),
        c68: mode === 0 ? 4 : eaCost68(mode, reg, 1) + 8,
      };
    }
    const imm = ((op >> 9) & 7) || 8;
    const isSub = (op & 0x0100) !== 0;
    if (mode === 1) {
      if (sizeBits === 0) return FALLBACK_D;
      return { kind: K.ADDQ, words: 1, a: Predecode.packA(XM_DN, 0, XM_AN, reg, sizeBits, imm, isSub ? 1 : 0), b: 0, c: 0, c68: 8 };
    }
    const dst = this.rmwEaOf(mode, reg, SIZE_BYTES[sizeBits], idx + 1);
    if (dst === null) return FALLBACK_D;
    return {
      kind: K.ADDQ, words: 1 + dst.words,
      a: Predecode.packA(XM_DN, 0, dst.x, reg, sizeBits, imm, isSub ? 1 : 0),
      b: 0, c: dst.payload,
      head: hd(mode, reg),
      c68: eaCost68(mode, reg, SIZE_BYTES[sizeBits]) + 4,
    };
  }

  private decodeBranch(op: number, idx: number): Decoded {
    const cc = (op >> 8) & 0x0f;
    const byteDisp = (op << 24) >> 24;
    const words = (op & 0xff) === 0 ? 2 : 1;
    const disp = words === 2 ? (this.word(idx + 1) << 16) >> 16 : byteDisp;
    const target = (this.base + (idx + 1) * 2 + disp) | 0;
    if (target & 1) return FALLBACK_D;
    if (cc === 1) return { kind: K.BSR, words, a: 0, b: target, c: 0, c68: 18 };
    if (cc === 0) return { kind: K.BRA, words, a: 0, b: target, c: 0, c68: 10 };
    return { kind: K.BCC, words, a: cc << 18, b: target, c: 0, c68: 10 };
  }

  private decodeGroup8(op: number, idx: number): Decoded {
    if ((op & 0x01c0) === 0x00c0) return this.decodeDivW(op, idx, false);
    if ((op & 0x01c0) === 0x01c0) return this.decodeDivW(op, idx, true);
    if ((op & 0x01f0) === 0x0100) return FALLBACK_D;
    return this.decodeAluEa(op, idx, AluOp.Or);
  }

  private decodeGroupB(op: number, idx: number): Decoded {
    const sizeBits = (op >> 6) & 3;
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    if (sizeBits === 3) {
      const size = op & 0x0100 ? 4 : 2;
      const src = this.ea(mode, reg, size, idx + 1, false);
      if (src.x === XM_BAD || src.x === XM_PCIX) return FALLBACK_D;
      return {
        kind: K.CMPA, words: 1 + src.words,
        a: Predecode.packA(src.x, reg, XM_AN, (op >> 9) & 7, size === 4 ? 2 : 1, 0, 0),
        b: src.payload, c: 0,
        head: hd(mode, reg),
        c68: eaCost68(mode, reg, size) + 6,
      };
    }
    if (!(op & 0x0100)) {
      if (sizeBits === 0 && mode === 1) return FALLBACK_D;
      const src = this.ea(mode, reg, SIZE_BYTES[sizeBits], idx + 1, false);
      if (src.x === XM_BAD || src.x === XM_PCIX) return FALLBACK_D;
      return {
        kind: K.ALU, words: 1 + src.words,
        a: Predecode.packA(src.x, reg, XM_DN, (op >> 9) & 7, sizeBits, AluOp.Cmp, 0),
        b: src.payload, c: 0,
        head: hd(mode, reg),
        c68: eaCost68(mode, reg, SIZE_BYTES[sizeBits]) + (sizeBits === 2 ? 6 : 4),
      };
    }
    if (mode === 1) return FALLBACK_D;
    const dst = this.rmwEaOf(mode, reg, SIZE_BYTES[sizeBits], idx + 1);
    if (dst === null) return FALLBACK_D;
    return {
      kind: K.ALU, words: 1 + dst.words,
      a: Predecode.packA(XM_DN, (op >> 9) & 7, dst.x, reg, sizeBits, AluOp.Eor, 1),
      b: 0, c: dst.payload,
      head: hd(mode, reg),
      c68: eaCost68(mode, reg, SIZE_BYTES[sizeBits]) + aluBase68(mode !== 0, SIZE_BYTES[sizeBits], mode, reg),
    };
  }

  private decodeGroupC(op: number, idx: number): Decoded {
    if ((op & 0x01c0) === 0x00c0) return this.decodeMulW(op, idx, false);
    if ((op & 0x01c0) === 0x01c0) return this.decodeMulW(op, idx, true);
    if ((op & 0x01f0) === 0x0100) return FALLBACK_D;
    if ((op & 0x0130) === 0x0100) {
      const kind = op & 0x00f8;
      if (kind !== 0x0040 && kind !== 0x0048 && kind !== 0x0088) return FALLBACK_D;
      return {
        kind: K.EXG, words: 1,
        a: ((op & 7) << 4) | (((op >> 9) & 7) << 12) | ((kind === 0x0040 ? 0 : kind === 0x0048 ? 1 : 2) << 18),
        b: 0, c: 0, c68: 6,
      };
    }
    return this.decodeAluEa(op, idx, AluOp.And);
  }

  private decodeMulW(op: number, idx: number, signed: boolean): Decoded {
    const src = this.ea((op >> 3) & 7, op & 7, 2, idx + 1, false);
    if (src.x === XM_BAD || src.x === XM_AN || src.x === XM_PCIX) return FALLBACK_D;
    return {
      kind: K.MUL_W, words: 1 + src.words,
      a: Predecode.packA(src.x, op & 7, XM_DN, (op >> 9) & 7, 1, 0, signed ? 1 : 0),
      b: src.payload, c: 0,
      head: hd((op >> 3) & 7, op & 7),
      c68: eaCost68((op >> 3) & 7, op & 7, 2) + 38,
    };
  }

  private decodeDivW(op: number, idx: number, signed: boolean): Decoded {
    const src = this.ea((op >> 3) & 7, op & 7, 2, idx + 1, false);
    if (src.x === XM_BAD || src.x === XM_AN || src.x === XM_PCIX) return FALLBACK_D;
    return {
      kind: K.DIV_W, words: 1 + src.words,
      a: Predecode.packA(src.x, op & 7, XM_DN, (op >> 9) & 7, 1, 0, signed ? 1 : 0),
      b: src.payload, c: 0,
      head: hd((op >> 3) & 7, op & 7),
      c68: eaCost68((op >> 3) & 7, op & 7, 2),
    };
  }

  private decodeAluEa(op: number, idx: number, alu: AluOp): Decoded {
    const sizeBits = (op >> 6) & 3;
    if (sizeBits === 3) return FALLBACK_D;
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    const dreg = (op >> 9) & 7;
    const toMemory = (op & 0x0100) !== 0;
    if (toMemory) {
      const dst = this.rmwEaOf(mode, reg, SIZE_BYTES[sizeBits], idx + 1);
      if (dst === null || dst.x === XM_DN) return FALLBACK_D;
      return {
        kind: K.ALU, words: 1 + dst.words,
        a: Predecode.packA(XM_DN, dreg, dst.x, reg, sizeBits, alu, 1),
        b: 0, c: dst.payload,
        head: hd(mode, reg),
        c68: eaCost68(mode, reg, SIZE_BYTES[sizeBits]) + aluBase68(true, SIZE_BYTES[sizeBits], mode, reg),
      };
    }
    if (mode === 1) return FALLBACK_D;
    const src = this.ea(mode, reg, SIZE_BYTES[sizeBits], idx + 1, false);
    if (src.x === XM_BAD || src.x === XM_PCIX) return FALLBACK_D;
    return {
      kind: K.ALU, words: 1 + src.words,
      a: Predecode.packA(src.x, reg, XM_DN, dreg, sizeBits, alu, 0),
      b: src.payload, c: 0,
      head: hd(mode, reg),
      c68: eaCost68(mode, reg, SIZE_BYTES[sizeBits]) + aluBase68(false, SIZE_BYTES[sizeBits], mode, reg),
    };
  }

  private decodeAddSub(op: number, idx: number, isSub: boolean): Decoded {
    const sizeBits = (op >> 6) & 3;
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    const dreg = (op >> 9) & 7;
    if (sizeBits === 3) {
      const size = op & 0x0100 ? 4 : 2;
      const src = this.ea(mode, reg, size, idx + 1, false);
      if (src.x === XM_BAD || src.x === XM_PCIX) return FALLBACK_D;
      return {
        kind: K.ADDA, words: 1 + src.words,
        a: Predecode.packA(src.x, reg, XM_AN, dreg, size === 4 ? 2 : 1, 0, isSub ? 1 : 0),
        b: src.payload, c: 0,
        head: hd(mode, reg),
        c68: eaCost68(mode, reg, size)
          + (size === 2 || mode === 0 || mode === 1 || (mode === 7 && reg === 4) ? 8 : 6),
      };
    }
    if ((op & 0x0130) === 0x0100) return FALLBACK_D;
    const alu = isSub ? AluOp.Sub : AluOp.Add;
    const toMemory = (op & 0x0100) !== 0;
    if (toMemory) {
      const dst = this.rmwEaOf(mode, reg, SIZE_BYTES[sizeBits], idx + 1);
      if (dst === null || dst.x === XM_DN) return FALLBACK_D;
      return {
        kind: K.ALU, words: 1 + dst.words,
        a: Predecode.packA(XM_DN, dreg, dst.x, reg, sizeBits, alu, 1),
        b: 0, c: dst.payload,
        head: hd(mode, reg),
        c68: eaCost68(mode, reg, SIZE_BYTES[sizeBits]) + aluBase68(true, SIZE_BYTES[sizeBits], mode, reg),
      };
    }
    if (sizeBits === 0 && mode === 1) return FALLBACK_D;
    const src = this.ea(mode, reg, SIZE_BYTES[sizeBits], idx + 1, false);
    if (src.x === XM_BAD || src.x === XM_PCIX) return FALLBACK_D;
    return {
      kind: K.ALU, words: 1 + src.words,
      a: Predecode.packA(src.x, reg, XM_DN, dreg, sizeBits, alu, 0),
      b: src.payload, c: 0,
      head: hd(mode, reg),
      c68: eaCost68(mode, reg, SIZE_BYTES[sizeBits]) + aluBase68(false, SIZE_BYTES[sizeBits], mode, reg),
    };
  }

  private decodeShift(op: number, idx: number): Decoded {
    const sizeBits = (op >> 6) & 3;
    const left = (op & 0x0100) !== 0;
    if (sizeBits === 3) {
      if (op & 0x0800) return FALLBACK_D;
      const dst = this.rmwEaOf((op >> 3) & 7, op & 7, 2, idx + 1);
      if (dst === null || dst.x === XM_DN) return FALLBACK_D;
      return {
        kind: K.SHIFT_MEM, words: 1 + dst.words,
        a: Predecode.packA(XM_DN, 0, dst.x, op & 7, 1, (op >> 9) & 3, left ? 1 : 0),
        b: 0, c: dst.payload,
        head: hd((op >> 3) & 7, op & 7),
        c68: eaCost68((op >> 3) & 7, op & 7, 2) + 8,
      };
    }
    const kind = (op >> 3) & 3;
    const fromReg = (op & 0x0020) !== 0;
    const count = fromReg ? 0 : (((op >> 9) & 7) || 8);
    return {
      kind: K.SHIFT_REG, words: 1,
      a: Predecode.packA(XM_DN, (op >> 9) & 7, XM_DN, op & 7, sizeBits, kind | (count << 2), left ? 1 : 0),
      b: 0, c: 0,
      c68: sizeBits === 2 ? 8 : 6,
    };
  }
}
