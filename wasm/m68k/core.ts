
import { P_CPU32, P_TRACE } from './personality.gen';

// @ts-ignore: decorator
@external("env", "trapRead8") declare function trapRead8(a: u32): u32;
// @ts-ignore: decorator
@external("env", "trapRead16") declare function trapRead16(a: u32): u32;
// @ts-ignore: decorator
@external("env", "trapWrite8") declare function trapWrite8(a: u32, v: u32): void;
// @ts-ignore: decorator
@external("env", "trapWrite16") declare function trapWrite16(a: u32, v: u32): void;
// @ts-ignore: decorator
@external("env", "trapFetchPen") declare function trapFetchPen(a: u32): i32;

const SR_C: u32 = 0x0001;
const SR_V: u32 = 0x0002;
const SR_Z: u32 = 0x0004;
const SR_N: u32 = 0x0008;
const SR_X: u32 = 0x0010;
const SR_CCR: u32 = 0x001f;
const SR_INT: u32 = 0x0700;
const SR_S: u32 = 0x2000;
const SR_T: u32 = 0x8000;
const SR_IMPLEMENTED: u32 = SR_T | SR_S | SR_INT | SR_CCR;

const XM_DN: u32 = 0;
const XM_AN: u32 = 1;
const XM_AI: u32 = 2;
const XM_PI: u32 = 3;
const XM_PD: u32 = 4;
const XM_D16: u32 = 5;
const XM_IX: u32 = 6;
const XM_PCIX: u32 = 10;
const XM_IMM: u32 = 11;

const K_FALLBACK = 0;
const K_MOVE = 1;
const K_MOVEA = 2;
const K_MOVEQ = 3;
const K_LEA = 4;
const K_PEA = 5;
const K_CLR = 6;
const K_TST = 7;
const K_NOT = 8;
const K_NEG = 9;
const K_EXT = 10;
const K_EXTB = 11;
const K_SWAP = 12;
const K_ALU = 13;
const K_CMPA = 14;
const K_ADDA = 15;
const K_ADDQ = 16;
const K_IMM_ALU = 17;
const K_BITOP_DYN = 18;
const K_BITOP_IMM = 19;
const K_SHIFT_REG = 20;
const K_SHIFT_MEM = 21;
const K_BRA = 22;
const K_BSR = 23;
const K_BCC = 24;
const K_DBCC = 25;
const K_SCC = 26;
const K_JMP = 27;
const K_JSR = 28;
const K_RTS = 29;
const K_RTD = 30;
const K_RTR = 31;
const K_MUL_W = 32;
const K_MUL_L = 33;
const K_DIV_W = 34;
const K_DIV_L = 35;
const K_MOVEM = 36;
const K_LINK = 37;
const K_UNLK = 38;
const K_EXG = 39;
const K_NOP = 40;
const K_RTE = 41;
const K_SR_IMM = 42;
const K_MOVE_FROM_SR = 43;
const K_MOVE_TO_SR = 44;
const K_TRAP = 45;
const K_CHK = 46;

const ALU_OR = 0;
const ALU_AND = 1;
const ALU_SUB = 2;
const ALU_ADD = 3;
const ALU_EOR = 5;
const ALU_CMP = 6;

const REASON_OK = 0;
const REASON_BUDGET = 1;
const REASON_FALLBACK = 2;
const REASON_IRQ = 3;
const REASON_DIRTY = 4;

const IRQ6_VECTOR: u32 = 30;
const IRQ6_CYCLES: i32 = 30;
const EXCEPTION_TAIL: i32 = -2;
const DAC_NEVER: i32 = 0x7fffffff;

const DATA_BASE: u32 = 0x100000;
const REG_D: u32 = DATA_BASE;
const REG_A: u32 = DATA_BASE + 32;
const S_SR: u32 = DATA_BASE + 64;
const S_PC: u32 = DATA_BASE + 68;
const S_USED: u32 = DATA_BASE + 72;
const S_DIRTY: u32 = DATA_BASE + 76;
const S_BUDGET: u32 = DATA_BASE + 80;
const S_LAST: u32 = DATA_BASE + 84;
const S_PC0: u32 = DATA_BASE + 88;
const S_TRAP_PEN: u32 = DATA_BASE + 92;
const S_CARRY: u32 = DATA_BASE + 96;
const S_CARRY_TAIL: u32 = DATA_BASE + 100;
const S_HEAD: u32 = DATA_BASE + 104;
const S_TAIL: u32 = DATA_BASE + 108;
const S_OTHER_SP: u32 = DATA_BASE + 112;
const S_VBR: u32 = DATA_BASE + 116;
const S_IRQ_OTHER: u32 = DATA_BASE + 120;
const S_DAC_IN: u32 = DATA_BASE + 124;
const S_DAC_PENDING: u32 = DATA_BASE + 128;
const S_AVEC6: u32 = DATA_BASE + 132;
const S_SINK_WRITES: u32 = DATA_BASE + 140;
const S_SINK: u32 = DATA_BASE + 144;
const S_SHADOW: u32 = DATA_BASE + 148;
const S_INSTRS: u32 = DATA_BASE + 152;
const S_IRQ6_TAKEN: u32 = DATA_BASE + 156;
const S_INSTR_START: u32 = DATA_BASE + 160;
const S_PEN_IN: u32 = DATA_BASE + 164;
const S_RING_POS: u32 = DATA_BASE + 168;
const S_RUN_START: u32 = DATA_BASE + 172;
const S_LAST_PC: u32 = DATA_BASE + 176;
const S_RING: u32 = DATA_BASE + 1024;
const RING_ENTRIES: u32 = 4096;
const STATE_END: u32 = DATA_BASE + 0x21000;

let baseAddr: u32 = 0;
let nWords: u32 = 0;
let romOff: u32 = 0;
let romSize: u32 = 0;
let ramOff: u32 = 0;
let ramAlloc: u32 = 0;
let cartOff: u32 = 0;
let cartAlloc: u32 = 0;
let sramOff: u32 = 0;
let sramBase: u32 = 0;
let sramSize: u32 = 0;
let metaKind: u32 = 0;
let metaLen: u32 = 0;
let metaCyc: u32 = 0;
let metaA: u32 = 0;
let metaB: u32 = 0;
let metaC: u32 = 0;
let metaHead: u32 = 0;
let metaTail: u32 = 0;
let ramWords: u32 = 0;
let ramSeenOff: u32 = 0;
let codeMapOff: u32 = 0;
let ramCode: u32 = 0;

let romTop: u32 = 0;
let cs0Hi: u32 = 0;
let romWPen: i32 = 0;
let romBPen: i32 = 0;
let cartBase: u32 = 0;
let cartSize: u32 = 0;
let ramBase: u32 = 0;
let ramSize: u32 = 0;
let ramWPen: i32 = 0;
let ramBPen: i32 = 0;
let cs2Lo: u32 = 0;
let cs2Size: u32 = 0;
let cs2WPen: i32 = 0;
let cs2BPen: i32 = 0;
let cs2Wp: u32 = 0;
let watchLo: u32 = 0;
let watchSize: u32 = 0;
let shadowBase: u32 = 0;
let shadowSize: u32 = 0;
let sinkBase: u32 = 0;
let sinkSize: u32 = 0;
let cs1WPen: i32 = 0;
let cs1BPen: i32 = 0;

let SR: u32 = 0;
let PC: u32 = 0;
let surch: i32 = 0;
let penIn: i32 = 0;
let extra: i32 = 0;
let head: i32 = 0;
let tail: i32 = 0;

// @ts-ignore: decorator
@inline function align4(x: u32): u32 { return (x + 3) & ~3; }

export function configure(codeBase: u32, words: u32, rSize: u32, rLen: u32, cLen: u32, sLen: u32): u32 {
  baseAddr = codeBase;
  nWords = words;
  romSize = rSize;
  ramAlloc = rLen;
  cartAlloc = cLen;
  sramSize = sLen;
  sramBase = 0;
  ramWords = P_CPU32 ? rLen >> 1 : 0;
  ramCode = 0;
  const total = words + ramWords;
  metaKind = STATE_END;
  metaLen = metaKind + total;
  metaCyc = metaLen + total;
  metaHead = metaCyc + total;
  metaTail = metaHead + total;
  metaA = align4(metaTail + total);
  metaB = metaA + total * 4;
  metaC = metaB + total * 4;
  ramSeenOff = metaC + total * 4;
  codeMapOff = ramSeenOff + ramWords;
  romOff = align4(codeMapOff + (rLen >> 5) + 1);
  ramOff = align4(romOff + rSize);
  cartOff = align4(ramOff + rLen);
  sramOff = align4(cartOff + cLen);
  return align4(sramOff + sLen);
}

export function setSramBase(base: u32): void { sramBase = base; }

export function setRegions(
  rTop: u32, c0Hi: u32, rW: i32, rB: i32,
  cBase: u32, cSize: u32,
  rmBase: u32, rmSize: u32, rmW: i32, rmB: i32,
  c2Lo: u32, c2Size: u32, c2W: i32, c2B: i32, c2Wp: u32,
  wLo: u32, wSize: u32,
  shBase: u32, shSize: u32, skBase: u32, skSize: u32, c1W: i32, c1B: i32,
): void {
  romTop = rTop; cs0Hi = c0Hi; romWPen = rW; romBPen = rB;
  cartBase = cBase; cartSize = cSize;
  ramBase = rmBase; ramSize = rmSize; ramWPen = rmW; ramBPen = rmB;
  cs2Lo = c2Lo; cs2Size = c2Size; cs2WPen = c2W; cs2BPen = c2B; cs2Wp = c2Wp;
  watchLo = wLo; watchSize = wSize;
  shadowBase = shBase; shadowSize = shSize; sinkBase = skBase; sinkSize = skSize;
  cs1WPen = c1W; cs1BPen = c1B;
}

export function getRegD(): u32 { return REG_D; }
export function getStateBase(): u32 { return DATA_BASE; }
export function getMetaKind(): u32 { return metaKind; }
export function getMetaLen(): u32 { return metaLen; }
export function getMetaCyc(): u32 { return metaCyc; }
export function getMetaHead(): u32 { return metaHead; }
export function getMetaTail(): u32 { return metaTail; }
export function getMetaA(): u32 { return metaA; }
export function getMetaB(): u32 { return metaB; }
export function getMetaC(): u32 { return metaC; }
export function getRomOff(): u32 { return romOff; }
export function getRamOff(): u32 { return ramOff; }
export function getCartOff(): u32 { return cartOff; }
export function getSramOff(): u32 { return sramOff; }
export function getRamSeenOff(): u32 { return ramSeenOff; }
export function getCodeMapOff(): u32 { return codeMapOff; }
export function setRamCode(on: u32): void { ramCode = on; }

// @ts-ignore
@inline function getD(i: u32): u32 { return load<u32>(REG_D + (i << 2)); }
// @ts-ignore
@inline function setD(i: u32, v: u32): void { store<u32>(REG_D + (i << 2), v); }
// @ts-ignore
@inline function getA(i: u32): u32 { return load<u32>(REG_A + (i << 2)); }
// @ts-ignore
@inline function setA(i: u32, v: u32): void { store<u32>(REG_A + (i << 2), v); }

// @ts-ignore
@inline function maskOf(size: u32): u32 { return size == 1 ? 0xff : size == 2 ? 0xffff : 0xffffffff; }
// @ts-ignore
@inline function msbOf(size: u32): u32 { return size == 1 ? 0x80 : size == 2 ? 0x8000 : 0x80000000; }
// @ts-ignore
@inline function truncSz(v: u32, size: u32): u32 { return size == 4 ? v : v & maskOf(size); }
// @ts-ignore
@inline function signedSz(v: u32, size: u32): i32 {
  if (size == 1) return (<i32>(v << 24)) >> 24;
  if (size == 2) return (<i32>(v << 16)) >> 16;
  return <i32>v;
}

// @ts-ignore
@inline function readDsz(reg: u32, size: u32): u32 { return truncSz(getD(reg), size); }
// @ts-ignore
@inline function writeDsz(reg: u32, size: u32, v: u32): void {
  if (size == 4) { setD(reg, v); return; }
  const m = maskOf(size);
  setD(reg, (getD(reg) & ~m) | (v & m));
}

// @ts-ignore
@inline function sf(mask: u32, on: bool): void {
  if (on) SR |= mask;
  else SR &= ~mask & 0xffff;
}

// @ts-ignore
@inline function logic(v: u32, size: u32): u32 {
  const res = truncSz(v, size);
  sf(SR_N, (res & msbOf(size)) != 0);
  sf(SR_Z, res == 0);
  sf(SR_V | SR_C, false);
  return res;
}

// @ts-ignore
@inline function logicFlags(v: u32, size: u32): void {
  const masked = v & maskOf(size);
  sf(SR_N, signedSz(masked, size) < 0);
  sf(SR_Z, masked == 0);
  sf(SR_V | SR_C, false);
}

function addFlags(s: u32, d: u32, r: i64, size: u32, keepZ: bool): u32 {
  const m = <i64>maskOf(size);
  const msb = msbOf(size);
  const res = truncSz(<u32>r, size);
  sf(SR_C | SR_X, r > m || r < 0);
  sf(SR_V, ((s ^ res) & (d ^ res) & msb) != 0);
  sf(SR_N, (res & msb) != 0);
  if (keepZ) { if (res != 0) sf(SR_Z, false); }
  else sf(SR_Z, res == 0);
  return res;
}

function subFlags(s: u32, d: u32, r: i64, size: u32, keepZ: bool): u32 {
  const msb = msbOf(size);
  const res = truncSz(<u32>r, size);
  sf(SR_C | SR_X, r < 0);
  sf(SR_V, ((s ^ d) & (d ^ res) & msb) != 0);
  sf(SR_N, (res & msb) != 0);
  if (keepZ) { if (res != 0) sf(SR_Z, false); }
  else sf(SR_Z, res == 0);
  return res;
}

function cmpFlags(s: u32, d: u32, size: u32): void {
  const msb = msbOf(size);
  const r: i64 = <i64>d - <i64>s;
  const res = truncSz(<u32>r, size);
  sf(SR_C, r < 0);
  sf(SR_V, ((s ^ d) & (d ^ res) & msb) != 0);
  sf(SR_N, (res & msb) != 0);
  sf(SR_Z, res == 0);
}

function testCC(cc: u32): bool {
  const n = (SR & SR_N) != 0;
  const z = (SR & SR_Z) != 0;
  const v = (SR & SR_V) != 0;
  const c = (SR & SR_C) != 0;
  switch (cc) {
    case 0x0: return true;
    case 0x1: return false;
    case 0x2: return !c && !z;
    case 0x3: return c || z;
    case 0x4: return !c;
    case 0x5: return c;
    case 0x6: return !z;
    case 0x7: return z;
    case 0x8: return !v;
    case 0x9: return v;
    case 0xa: return !n;
    case 0xb: return n;
    case 0xc: return n == v;
    case 0xd: return n != v;
    case 0xe: return !z && n == v;
    default: return z || n != v;
  }
}

function shift(kind: u32, left: bool, v: u32, count: u32, size: u32): u32 {
  const m = maskOf(size);
  const msb = msbOf(size);
  let val = v & m;
  let carry = false;
  let overflow = false;
  for (let i: u32 = 0; i < count; i++) {
    const top = (val & msb) != 0;
    const bottom = (val & 1) != 0;
    if (kind == 0) {
      if (left) { carry = top; val = (val << 1) & m; if (((val & msb) != 0) != top) overflow = true; }
      else { carry = bottom; val = ((val >>> 1) | (top ? msb : 0)) & m; }
    } else if (kind == 1) {
      if (left) { carry = top; val = (val << 1) & m; }
      else { carry = bottom; val = (val >>> 1) & m; }
    } else if (kind == 2) {
      const x: u32 = (SR & SR_X) ? 1 : 0;
      if (left) { carry = top; val = ((val << 1) | x) & m; }
      else { carry = bottom; val = ((val >>> 1) | (x ? msb : 0)) & m; }
      sf(SR_X, carry);
    } else {
      if (left) { carry = top; val = ((val << 1) | (top ? 1 : 0)) & m; }
      else { carry = bottom; val = ((val >>> 1) | (bottom ? msb : 0)) & m; }
    }
  }
  if (count > 0) { sf(SR_C, carry); if (kind < 2) sf(SR_X, carry); }
  else sf(SR_C, false);
  sf(SR_V, kind == 0 && overflow);
  sf(SR_N, (val & msb) != 0);
  sf(SR_Z, val == 0);
  return val;
}

// @ts-ignore
@inline function setSR(v: u32): void {
  if (P_CPU32) {
    if (((SR ^ v) & SR_S) != 0) {
      const active = getA(7);
      setA(7, load<u32>(S_OTHER_SP));
      store<u32>(S_OTHER_SP, active);
    }
  }
  SR = v & SR_IMPLEMENTED;
}

// @ts-ignore
@inline function ramPenB(a: u32): i32 { return (a - cs2Lo) < cs2Size ? cs2BPen : ramBPen; }
// @ts-ignore
@inline function ramPenW(a: u32): i32 { return (a - cs2Lo) < cs2Size ? cs2WPen : ramWPen; }

// @ts-ignore
@inline function fits2(off: u32, size: u32): bool { return off < size && off + 1 < size; }

function ramWritten(off: u32, n: u32): void {
  const last = <i32>((off + n - 1) >> 1);
  let s = <i32>(off >> 1) - 4;
  if (s < 0) s = 0;
  for (; s <= last; s++) {
    if (load<u8>(ramSeenOff + <u32>s) == 0) continue;
    const i = nWords + <u32>s;
    if ((<u32>s << 1) + <u32>load<u8>(metaLen + i) > off) {
      store<u8>(metaKind + i, 0);
      store<u8>(ramSeenOff + <u32>s, 0);
    }
  }
}

// @ts-ignore
@inline function codeIndex(pc: u32): u32 {
  const rel = pc - baseAddr;
  if ((rel & 1) == 0 && (rel >> 1) < nWords) return rel >> 1;
  if (P_CPU32 && ramCode != 0) {
    const off = pc - ramBase;
    if ((off & 1) == 0 && off < ramSize) return nWords + (off >> 1);
  }
  return 0xffffffff;
}

// @ts-ignore
@inline function afterTrap(): void {
  if (P_CPU32) surch += load<i32>(S_TRAP_PEN);
}

// @ts-ignore
@inline function gRead8(a: u32): u32 {
  if (P_CPU32) {
    let off = a - ramBase;
    if (off < ramSize) { surch += ramPenB(a); return load<u8>(ramOff + off); }
    if (a < romTop) { surch += romBPen; return load<u8>(romOff + a); }
    off = a - cartBase;
    if (off < cartSize) { surch += romBPen; return load<u8>(cartOff + off); }
    off = a - shadowBase;
    if (off < shadowSize) { surch += cs1BPen; return load<u8>(S_SHADOW + off); }
    const v = trapRead8(a);
    afterTrap();
    return v;
  }
  if (a < romSize) return load<u8>(romOff + a);
  if (a >= ramBase && a < ramBase + ramSize) return load<u8>(ramOff + (a - ramBase));
  if (sramBase != 0 && a >= sramBase && a < sramBase + sramSize) return load<u8>(sramOff + (a - sramBase));
  return trapRead8(a);
}
// @ts-ignore
@inline function gRead16(a: u32): u32 {
  if (P_CPU32) {
    let off = a - ramBase;
    if (fits2(off, ramSize)) {
      surch += ramPenW(a);
      const i = ramOff + off;
      return (<u32>load<u8>(i) << 8) | <u32>load<u8>(i + 1);
    }
    if (a + 1 < romTop) { surch += romWPen; return (<u32>load<u8>(romOff + a) << 8) | <u32>load<u8>(romOff + a + 1); }
    off = a - cartBase;
    if (fits2(off, cartSize)) {
      surch += romWPen;
      const i = cartOff + off;
      return (<u32>load<u8>(i) << 8) | <u32>load<u8>(i + 1);
    }
    off = a - shadowBase;
    if (fits2(off, shadowSize)) {
      surch += cs1WPen;
      const i = S_SHADOW + off;
      return (<u32>load<u8>(i) << 8) | <u32>load<u8>(i + 1);
    }
    const v = trapRead16(a);
    afterTrap();
    return v;
  }
  if (a + 1 < romSize) return (<u32>load<u8>(romOff + a) << 8) | <u32>load<u8>(romOff + a + 1);
  if (a >= ramBase && a + 1 < ramBase + ramSize) {
    const i = ramOff + (a - ramBase);
    return (<u32>load<u8>(i) << 8) | <u32>load<u8>(i + 1);
  }
  if (sramBase != 0 && a >= sramBase && a + 1 < sramBase + sramSize) {
    const i = sramOff + (a - sramBase);
    return (<u32>load<u8>(i) << 8) | <u32>load<u8>(i + 1);
  }
  return trapRead16(a);
}
// @ts-ignore
@inline function gWrite8(a: u32, v: u32): void {
  if (P_CPU32) {
    const off = a - ramBase;
    if (off < ramSize && !(cs2Wp != 0 && (a - cs2Lo) < cs2Size) && (a - watchLo) >= watchSize) {
      surch += ramPenB(a);
      store<u8>(ramOff + off, <u8>v);
      if (load<u8>(codeMapOff + (off >> 5)) != 0) ramWritten(off, 1);
      return;
    }
    if ((a - sinkBase) < sinkSize) {
      surch += cs1BPen;
      store<u8>(S_SINK + (a - sinkBase), <u8>v);
      if (a == sinkBase) store<u32>(S_SINK_WRITES, load<u32>(S_SINK_WRITES) + 1);
      return;
    }
    trapWrite8(a, v);
    afterTrap();
    return;
  }
  if (a >= ramBase && a < ramBase + ramSize) { store<u8>(ramOff + (a - ramBase), <u8>v); return; }
  if (sramBase != 0 && a >= sramBase && a < sramBase + sramSize) { store<u8>(sramOff + (a - sramBase), <u8>v); return; }
  trapWrite8(a, v);
}
// @ts-ignore
@inline function gWrite16(a: u32, v: u32): void {
  if (P_CPU32) {
    const off = a - ramBase;
    if (fits2(off, ramSize) && !(cs2Wp != 0 && (a - cs2Lo) < cs2Size) && (a - watchLo) >= watchSize && (a + 1 - watchLo) >= watchSize) {
      surch += ramPenW(a);
      const i = ramOff + off;
      store<u8>(i, <u8>(v >> 8));
      store<u8>(i + 1, <u8>v);
      if ((load<u8>(codeMapOff + (off >> 5)) | load<u8>(codeMapOff + ((off + 1) >> 5))) != 0) ramWritten(off, 2);
      return;
    }
    if (a == sinkBase && sinkSize == 2) {
      surch += cs1WPen;
      store<u8>(S_SINK, <u8>(v >> 8));
      store<u8>(S_SINK + 1, <u8>v);
      store<u32>(S_SINK_WRITES, load<u32>(S_SINK_WRITES) + 1);
      return;
    }
    trapWrite16(a, v);
    afterTrap();
    return;
  }
  if (a >= ramBase && a + 1 < ramBase + ramSize) {
    const i = ramOff + (a - ramBase);
    store<u8>(i, <u8>(v >> 8));
    store<u8>(i + 1, <u8>v);
    return;
  }
  if (sramBase != 0 && a >= sramBase && a + 1 < sramBase + sramSize) {
    const i = sramOff + (a - sramBase);
    store<u8>(i, <u8>(v >> 8));
    store<u8>(i + 1, <u8>v);
    return;
  }
  trapWrite16(a, v);
}

// @ts-ignore
@inline function readMem(addr: u32, size: u32): u32 {
  if (size == 1) return gRead8(addr);
  if (size == 2) return gRead16(addr);
  return (gRead16(addr) << 16) | gRead16(addr + 2);
}
// @ts-ignore
@inline function writeMem(addr: u32, size: u32, v: u32): void {
  if (size == 1) { gWrite8(addr, v & 0xff); return; }
  if (size == 2) { gWrite16(addr, v & 0xffff); return; }
  gWrite16(addr, (v >>> 16) & 0xffff);
  gWrite16(addr + 2, v & 0xffff);
}

// @ts-ignore
@inline function pushLong(v: u32): void {
  const sp = getA(7) - 4;
  setA(7, sp);
  writeMem(sp, 4, v);
}
// @ts-ignore
@inline function pushWord(v: u32): void {
  const sp = getA(7) - 2;
  setA(7, sp);
  writeMem(sp, 2, v);
}

function fetchPenAt(a: u32): i32 {
  if (a < cs0Hi) return romWPen;
  if ((a - ramBase) < ramSize) return ramPenW(a);
  return trapFetchPen(a);
}
// @ts-ignore
@inline function fetchPenSpan(a: u32, n: u32): i32 {
  if (a + (n << 1) <= cs0Hi) return romWPen * <i32>n;
  let total: i32 = 0;
  let block: u32 = 0xffffffff;
  let price: i32 = 0;
  for (let i: u32 = 0; i < n; i++) {
    const w = a + (i << 1);
    if ((w >> 8) != block) { block = w >> 8; price = fetchPenAt(w); }
    total += price;
  }
  return total;
}

// @ts-ignore
@inline function flow(target: u32): void {
  PC = target;
  if (P_CPU32) { tail = -2; surch += fetchPenSpan(target, 2); }
}

function briefFast(base: u32, p: i32): u32 {
  const reg = <u32>((p >>> 16) & 15);
  const raw = reg < 8 ? getD(reg) : getA(reg - 8);
  const index = (p & 0x100000) ? <i32>raw : (<i32>(raw << 16)) >> 16;
  const scale = (p >>> 21) & 3;
  const disp = (p << 24) >> 24;
  return base + (<u32>(index << scale)) + <u32>disp;
}

function opAddrFast(x: u32, reg: u32, payload: i32, payload2: i32): u32 {
  switch (x) {
    case XM_AI: return getA(reg);
    case XM_PI: { const addr = getA(reg); setA(reg, addr + <u32>payload); return addr; }
    case XM_PD: { const addr = getA(reg) - <u32>payload; setA(reg, addr); return addr; }
    case XM_D16: return getA(reg) + <u32>payload;
    case XM_IX: return briefFast(getA(reg), payload);
    case XM_PCIX: return briefFast(<u32>payload2, payload);
    default: return <u32>payload;
  }
}

function opAddrPeek(x: u32, reg: u32, payload: i32, payload2: i32): u32 {
  if (x == XM_PI) return getA(reg);
  if (x == XM_PD) return getA(reg) - <u32>payload;
  return opAddrFast(x, reg, payload, payload2);
}
// @ts-ignore
@inline function commitAdjust(x: u32, reg: u32, payload: i32): void {
  if (x == XM_PI) setA(reg, getA(reg) + <u32>payload);
  else if (x == XM_PD) setA(reg, getA(reg) - <u32>payload);
}
function readDivisor(x: u32, reg: u32, size: u32, payload: i32, payload2: i32): u32 {
  if (x == XM_DN) return readDsz(reg, size);
  if (x == XM_AN) return truncSz(getA(reg), size);
  if (x == XM_IMM) return <u32>payload;
  return readMem(opAddrPeek(x, reg, payload, payload2), size);
}

// @ts-ignore
@inline function readOpFast(x: u32, reg: u32, size: u32, payload: i32, payload2: i32): u32 {
  if (x == XM_DN) return readDsz(reg, size);
  if (x == XM_AN) return truncSz(getA(reg), size);
  if (x == XM_IMM) return <u32>payload;
  return readMem(opAddrFast(x, reg, payload, payload2), size);
}

function execOne(idx: u32, k: u32): i32 {
  const aw = load<i32>(metaA + (idx << 2));
  const b = load<i32>(metaB + (idx << 2));
  const c = load<i32>(metaC + (idx << 2));
  const len = <u32>load<u8>(metaLen + idx);
  const cyc = <i32>load<u8>(metaCyc + idx);
  const pc0 = PC;
  PC = pc0 + len;
  if (P_CPU32) {
    surch = fetchPenSpan(pc0 + 4, len >> 1) + penIn;
    penIn = 0;
    extra = 0;
    head = <i32>load<i8>(metaHead + idx);
    tail = <i32>load<i8>(metaTail + idx);
  }

  const sx = <u32>(aw & 15);
  const sreg = <u32>((aw >>> 4) & 7);
  const dx = <u32>((aw >>> 8) & 15);
  const dreg = <u32>((aw >>> 12) & 7);
  const sizeIdx = (aw >>> 16) & 3;
  const size: u32 = sizeIdx == 0 ? 1 : sizeIdx == 1 ? 2 : 4;
  const aux = <u32>((aw >>> 18) & 0xff);
  const flag1 = (aw >>> 26) & 1;

  switch (k) {
    case K_MOVE: {
      const v = readOpFast(sx, sreg, size, b, c);
      logicFlags(v, size);
      if (dx == XM_DN) writeDsz(dreg, size, v);
      else writeMem(opAddrFast(dx, dreg, c, 0), size, v);
      break;
    }
    case K_MOVEA: {
      const v = readOpFast(sx, sreg, size, b, c);
      setA(dreg, size == 2 ? <u32>((<i32>(v << 16)) >> 16) : v);
      break;
    }
    case K_MOVEQ: {
      setD(<u32>((aw >>> 12) & 7), <u32>b);
      logic(<u32>b, 4);
      break;
    }
    case K_LEA: setA(dreg, opAddrFast(sx, sreg, b, c)); break;
    case K_PEA: pushLong(opAddrFast(sx, sreg, b, c)); break;
    case K_CLR:
      if (dx == XM_DN) writeDsz(dreg, size, 0);
      else {
        const addr = opAddrFast(dx, dreg, c, 0);
        readMem(addr, size);
        writeMem(addr, size, 0);
      }
      sf(SR_N | SR_V | SR_C, false);
      sf(SR_Z, true);
      break;
    case K_TST: logic(readOpFast(sx, sreg, size, b, c), size); break;
    case K_NOT:
      if (dx == XM_DN) writeDsz(dreg, size, logic(~readDsz(dreg, size), size));
      else {
        const addr = opAddrFast(dx, dreg, c, 0);
        writeMem(addr, size, logic(~readMem(addr, size), size));
      }
      break;
    case K_NEG: {
      const isNegx = flag1 == 1;
      const x: u32 = (isNegx && (SR & SR_X)) ? 1 : 0;
      if (dx == XM_DN) {
        const d = readDsz(dreg, size);
        writeDsz(dreg, size, subFlags(d, 0, -<i64>d - <i64>x, size, isNegx));
      } else {
        const addr = opAddrFast(dx, dreg, c, 0);
        const d = readMem(addr, size);
        writeMem(addr, size, subFlags(d, 0, -<i64>d - <i64>x, size, isNegx));
      }
      break;
    }
    case K_EXT: {
      const v: i32 = size == 4 ? (<i32>(getD(sreg) << 16)) >> 16 : (<i32>(getD(sreg) << 24)) >> 24;
      writeDsz(sreg, size, <u32>v);
      logic(<u32>v, size);
      break;
    }
    case K_EXTB: {
      const v: i32 = (<i32>(getD(sreg) << 24)) >> 24;
      setD(sreg, <u32>v);
      logic(<u32>v, 4);
      break;
    }
    case K_SWAP: {
      const v = getD(sreg);
      const r = (v << 16) | (v >>> 16);
      setD(sreg, r);
      logic(r, 4);
      break;
    }
    case K_ALU: {
      if (flag1 == 0) {
        const v = readOpFast(sx, sreg, size, b, c);
        if (aux == ALU_OR) writeDsz(dreg, size, logic(readDsz(dreg, size) | v, size));
        else if (aux == ALU_AND) writeDsz(dreg, size, logic(readDsz(dreg, size) & v, size));
        else if (aux == ALU_SUB) { const d = readDsz(dreg, size); writeDsz(dreg, size, subFlags(v, d, <i64>d - <i64>v, size, false)); }
        else if (aux == ALU_ADD) { const d = readDsz(dreg, size); writeDsz(dreg, size, addFlags(v, d, <i64>d + <i64>v, size, false)); }
        else cmpFlags(v, readDsz(dreg, size), size);
        break;
      }
      const v = readDsz(sreg, size);
      if (dx == XM_DN) { writeDsz(dreg, size, logic(readDsz(dreg, size) ^ v, size)); break; }
      const addr = opAddrFast(dx, dreg, c, 0);
      const d = readMem(addr, size);
      let r: u32;
      if (aux == ALU_OR) r = logic(d | v, size);
      else if (aux == ALU_AND) r = logic(d & v, size);
      else if (aux == ALU_SUB) r = subFlags(v, d, <i64>d - <i64>v, size, false);
      else if (aux == ALU_ADD) r = addFlags(v, d, <i64>d + <i64>v, size, false);
      else r = logic(d ^ v, size);
      writeMem(addr, size, r);
      break;
    }
    case K_CMPA: {
      const raw = readOpFast(sx, sreg, size, b, c);
      const v = size == 2 ? <u32>((<i32>(raw << 16)) >> 16) : raw;
      cmpFlags(v, getA(dreg), 4);
      break;
    }
    case K_ADDA: {
      const raw = readOpFast(sx, sreg, size, b, c);
      const v: i32 = size == 2 ? (<i32>(raw << 16)) >> 16 : <i32>raw;
      setA(dreg, flag1 ? getA(dreg) - <u32>v : getA(dreg) + <u32>v);
      break;
    }
    case K_ADDQ: {
      const imm = aux;
      if (dx == XM_AN) { setA(dreg, flag1 ? getA(dreg) - imm : getA(dreg) + imm); break; }
      if (dx == XM_DN) {
        const d = readDsz(dreg, size);
        writeDsz(dreg, size, flag1 ? subFlags(imm, d, <i64>d - <i64>imm, size, false)
                                   : addFlags(imm, d, <i64>d + <i64>imm, size, false));
        break;
      }
      const addr = opAddrFast(dx, dreg, c, 0);
      const d = readMem(addr, size);
      writeMem(addr, size, flag1 ? subFlags(imm, d, <i64>d - <i64>imm, size, false)
                                 : addFlags(imm, d, <i64>d + <i64>imm, size, false));
      break;
    }
    case K_IMM_ALU: {
      const imm = <u32>b;
      if (aux == ALU_CMP) { cmpFlags(imm, readOpFast(dx, dreg, size, c, 0), size); break; }
      let addr: u32 = 0;
      let d: u32;
      if (dx == XM_DN) d = readDsz(dreg, size);
      else { addr = opAddrFast(dx, dreg, c, 0); d = readMem(addr, size); }
      let r: u32;
      if (aux == ALU_OR) r = logic(d | imm, size);
      else if (aux == ALU_AND) r = logic(d & imm, size);
      else if (aux == ALU_SUB) r = subFlags(imm, d, <i64>d - <i64>imm, size, false);
      else if (aux == ALU_ADD) r = addFlags(imm, d, <i64>d + <i64>imm, size, false);
      else r = logic(d ^ imm, size);
      if (dx == XM_DN) writeDsz(dreg, size, r);
      else writeMem(addr, size, r);
      break;
    }
    case K_BITOP_DYN:
    case K_BITOP_IMM: {
      const toRegister = sx == XM_DN;
      const bitNo = k == K_BITOP_DYN ? getD(dreg) : <u32>c;
      const bit: u32 = 1 << (bitNo & (toRegister ? 31 : 7));
      const opSize: u32 = toRegister ? 4 : 1;
      if (aux == 0) {
        const v = readOpFast(sx, sreg, opSize, b, k == K_BITOP_DYN ? c : 0);
        sf(SR_Z, (v & bit) == 0);
        break;
      }
      let addr: u32 = 0;
      let v: u32;
      if (toRegister) v = readDsz(sreg, opSize);
      else { addr = opAddrFast(sx, sreg, b, 0); v = readMem(addr, opSize); }
      sf(SR_Z, (v & bit) == 0);
      const r = aux == 1 ? v ^ bit : aux == 2 ? v & ~bit : v | bit;
      if (toRegister) writeDsz(sreg, opSize, r);
      else writeMem(addr, opSize, r);
      break;
    }
    case K_SHIFT_REG: {
      const kind = aux & 3;
      const immCount = aux >> 2;
      const count = immCount == 0 ? getD(sreg) & 63 : immCount;
      writeDsz(dreg, size, shift(kind, flag1 == 1, readDsz(dreg, size), count, size));
      break;
    }
    case K_SHIFT_MEM: {
      const addr = opAddrFast(dx, dreg, c, 0);
      writeMem(addr, 2, shift(aux, flag1 == 1, readMem(addr, 2), 1, 2));
      break;
    }
    case K_BRA:
      if (P_CPU32) head = 2;
      flow(<u32>b);
      break;
    case K_BSR: pushLong(PC); flow(<u32>b); break;
    case K_BCC:
      if (testCC(aux)) {
        if (P_CPU32) head = 2;
        flow(<u32>b);
      } else if (P_CPU32 && len == 2) {
        extra -= 2;
      }
      break;
    case K_DBCC: {
      if (testCC(aux)) break;
      const next = (readDsz(sreg, 2) - 1) & 0xffff;
      writeDsz(sreg, 2, next);
      if (next != 0xffff) {
        if (P_CPU32) head = 6;
        flow(<u32>b);
      } else if (P_CPU32) {
        head = 2;
        extra += 4;
      }
      break;
    }
    case K_SCC: {
      const taken: u32 = testCC(aux) ? 0xff : 0x00;
      if (dx == XM_DN) writeDsz(dreg, 1, taken);
      else {
        const addr = opAddrFast(dx, dreg, c, 0);
        readMem(addr, 1);
        writeMem(addr, 1, taken);
      }
      break;
    }
    case K_JMP: {
      const addr = opAddrFast(sx, sreg, b, c);
      if (addr & 1) { PC = pc0; return -1; }
      flow(addr);
      break;
    }
    case K_JSR: {
      const addr = opAddrFast(sx, sreg, b, c);
      if (addr & 1) { PC = pc0; return -1; }
      pushLong(PC);
      flow(addr);
      break;
    }
    case K_RTS: {
      const pcv = readMem(getA(7), 4);
      if (pcv & 1) { PC = pc0; return -1; }
      setA(7, getA(7) + 4);
      flow(pcv);
      break;
    }
    case K_RTD: {
      const pcv = readMem(getA(7), 4);
      if (pcv & 1) { PC = pc0; return -1; }
      setA(7, getA(7) + 4 + <u32>b);
      flow(pcv);
      break;
    }
    case K_RTR: {
      const ccr = readMem(getA(7), 2);
      const pcv = readMem(getA(7) + 2, 4);
      if (pcv & 1) { PC = pc0; return -1; }
      setA(7, getA(7) + 6);
      SR = (SR & ~SR_CCR) | (ccr & SR_CCR);
      flow(pcv);
      break;
    }
    case K_RTE: {
      if (!P_CPU32) { PC = pc0; return -1; }
      if ((SR & SR_S) == 0) { PC = pc0; return -1; }
      const sp = getA(7);
      const sr = readMem(sp, 2);
      const pcv = readMem(sp + 2, 4);
      const format = readMem(sp + 6, 2) >> 12;
      if (format != 0 || (pcv & 1)) { PC = pc0; return -1; }
      setA(7, sp + 8);
      setSR(sr);
      flow(pcv);
      break;
    }
    case K_MUL_W: {
      const raw = readOpFast(sx, sreg, 2, b, c);
      if (flag1) {
        const v: i32 = signedSz(raw, 2) * signedSz(getD(dreg), 2);
        setD(dreg, <u32>v);
        logic(<u32>v, 4);
      } else {
        const v = (raw & 0xffff) * (getD(dreg) & 0xffff);
        setD(dreg, v);
        logic(v, 4);
      }
      break;
    }
    case K_MUL_L: {
      const src = readOpFast(sx, sreg, 4, b, c);
      const signed = flag1 == 1;
      if (signed) {
        const p: i64 = <i64>(<i32>src) * <i64>(<i32>getD(dreg));
        const low = <u32>(p & 0xffffffff);
        setD(dreg, low);
        sf(SR_N, (low & 0x80000000) != 0);
        sf(SR_Z, low == 0);
        sf(SR_V, !(p >= -0x80000000 && p <= 0x7fffffff));
        sf(SR_C, false);
      } else {
        const p: u64 = <u64>src * <u64>getD(dreg);
        const low = <u32>(p & 0xffffffff);
        setD(dreg, low);
        sf(SR_N, (low & 0x80000000) != 0);
        sf(SR_Z, low == 0);
        sf(SR_V, p > 0xffffffff);
        sf(SR_C, false);
      }
      break;
    }
    case K_DIV_W: {
      const divisor = readDivisor(sx, sreg, 2, b, c);
      if (divisor == 0) { PC = pc0; return -1; }
      commitAdjust(sx, sreg, b);
      const signed = flag1 == 1;
      if (signed) {
        const dividend: i32 = <i32>getD(dreg);
        const div: i32 = signedSz(divisor, 2);
        const q: i32 = dividend / div;
        const r: i32 = dividend - q * div;
        if (q < -0x8000 || q > 0x7fff) { sf(SR_V, true); sf(SR_C, false); break; }
        sf(SR_V | SR_C, false);
        sf(SR_N, (q & 0x8000) != 0);
        sf(SR_Z, (q & 0xffff) == 0);
        setD(dreg, ((<u32>r & 0xffff) << 16) | (<u32>q & 0xffff));
      } else {
        const dividend: u32 = getD(dreg);
        const q: u32 = dividend / divisor;
        const r: u32 = dividend - q * divisor;
        if (q > 0xffff) { sf(SR_V, true); sf(SR_C, false); break; }
        sf(SR_V | SR_C, false);
        sf(SR_N, (q & 0x8000) != 0);
        sf(SR_Z, (q & 0xffff) == 0);
        setD(dreg, ((r & 0xffff) << 16) | (q & 0xffff));
      }
      break;
    }
    case K_DIV_L: {
      const src = readDivisor(sx, sreg, 4, b, c);
      if (src == 0) { PC = pc0; return -1; }
      commitAdjust(sx, sreg, b);
      const signed = flag1 == 1;
      const remReg = aux;
      if (signed) {
        const divisor: i64 = <i64>(<i32>src);
        const dividend: i64 = <i64>(<i32>getD(dreg));
        const q: i64 = dividend / divisor;
        const r: i64 = dividend - q * divisor;
        if (!(q >= -0x80000000 && q <= 0x7fffffff)) { sf(SR_V, true); sf(SR_C, false); break; }
        const ql = <u32>(q & 0xffffffff);
        if (remReg != dreg) setD(remReg, <u32>(r & 0xffffffff));
        setD(dreg, ql);
        sf(SR_N, (ql & 0x80000000) != 0);
        sf(SR_Z, ql == 0);
        sf(SR_V | SR_C, false);
      } else {
        const divisor: u64 = <u64>src;
        const dividend: u64 = <u64>getD(dreg);
        const q: u64 = dividend / divisor;
        const r: u64 = dividend - q * divisor;
        if (q > 0xffffffff) { sf(SR_V, true); sf(SR_C, false); break; }
        const ql = <u32>(q & 0xffffffff);
        if (remReg != dreg) setD(remReg, <u32>(r & 0xffffffff));
        setD(dreg, ql);
        sf(SR_N, (ql & 0x80000000) != 0);
        sf(SR_Z, ql == 0);
        sf(SR_V | SR_C, false);
      }
      break;
    }
    case K_MOVEM: {
      const mask = <u32>b & 0xffff;
      const toRegs = flag1 == 1;
      const step = size;
      if (sx == XM_PD) {
        let addr = getA(sreg);
        for (let i: u32 = 0; i < 16; i++) {
          if (!(mask & (1 << i))) continue;
          const r = 15 - i;
          const v = r < 8 ? getD(r) : getA(r - 8);
          addr = addr - step;
          writeMem(addr, size, v);
        }
        setA(sreg, addr);
        break;
      }
      let addr = sx == XM_PI ? getA(sreg) : opAddrFast(sx, sreg, c, 0);
      for (let i: u32 = 0; i < 16; i++) {
        if (!(mask & (1 << i))) continue;
        if (toRegs) {
          const v = readMem(addr, size);
          const full = size == 2 ? <u32>((<i32>(v << 16)) >> 16) : v;
          if (i < 8) setD(i, full); else setA(i - 8, full);
        } else {
          writeMem(addr, size, i < 8 ? getD(i) : getA(i - 8));
        }
        addr = addr + step;
      }
      if (sx == XM_PI) setA(sreg, addr);
      break;
    }
    case K_LINK: {
      const sp = getA(7) - 4;
      setA(7, sp);
      writeMem(sp, 4, getA(sreg));
      setA(sreg, sp);
      setA(7, sp + <u32>b);
      break;
    }
    case K_UNLK: {
      const sp = getA(sreg);
      const v = readMem(sp, 4);
      setA(7, sp + 4);
      setA(sreg, v);
      break;
    }
    case K_EXG: {
      if (aux == 0) { const t = getD(dreg); setD(dreg, getD(sreg)); setD(sreg, t); }
      else if (aux == 1) { const t = getA(dreg); setA(dreg, getA(sreg)); setA(sreg, t); }
      else { const t = getD(dreg); setD(dreg, getA(sreg)); setA(sreg, t); }
      break;
    }
    case K_SR_IMM: {
      if (!P_CPU32) { PC = pc0; return -1; }
      const toSr = flag1 == 1;
      if (toSr && (SR & SR_S) == 0) { PC = pc0; return -1; }
      const imm = <u32>b;
      const cur = toSr ? SR : SR & SR_CCR;
      const v = aux == 0 ? cur | imm : aux == 1 ? cur & imm : cur ^ imm;
      if (toSr) setSR(v);
      else SR = (SR & ~SR_CCR) | (v & SR_CCR);
      break;
    }
    case K_MOVE_FROM_SR: {
      if (!P_CPU32) { PC = pc0; return -1; }
      const v = flag1 ? SR & SR_CCR : SR;
      if (dx == XM_DN) writeDsz(dreg, 2, v);
      else {
        const addr = opAddrFast(dx, dreg, c, 0);
        readMem(addr, 2);
        writeMem(addr, 2, v);
      }
      break;
    }
    case K_MOVE_TO_SR: {
      if (!P_CPU32) { PC = pc0; return -1; }
      if (!flag1 && (SR & SR_S) == 0) { PC = pc0; return -1; }
      const v = readOpFast(sx, sreg, 2, b, c);
      if (flag1) SR = (SR & ~SR_CCR) | (v & SR_CCR);
      else setSR(v);
      break;
    }
    case K_TRAP: {
      if (!P_CPU32) { PC = pc0; return -1; }
      takeException(<u32>b);
      extra += <i32>aux;
      break;
    }
    case K_CHK: {
      if (!P_CPU32) { PC = pc0; return -1; }
      const bound = signedSz(readOpFast(sx, sreg, 2, b, c), 2);
      const v = signedSz(getD(dreg), 2);
      if (v < 0 || v > bound) {
        sf(SR_N, v < 0);
        takeException(6);
        extra += <i32>aux;
      }
      break;
    }
    case K_NOP: break;
    default: PC = pc0; return -1;
  }
  return cyc;
}

let carry: i32 = 0;
let carryTail: i32 = 0;
// @ts-ignore
@inline function trace(pc0: u32, total: i32, carryBefore: i32): void {
  if (!P_TRACE) return;
  const pos = load<u32>(S_RING_POS) & (RING_ENTRIES - 1);
  const e = S_RING + pos * 32;
  store<u32>(e, pc0);
  store<i32>(e + 4, total);
  store<i32>(e + 8, surch);
  store<i32>(e + 12, head);
  store<i32>(e + 16, tail);
  store<i32>(e + 20, carryBefore);
  store<u32>(e + 24, load<u32>(S_RUN_START) + <u32>load<i32>(S_USED) + <u32>total);
  store<u32>(S_RING_POS, pos + 1);
}

// @ts-ignore
@inline function settle(instr: i32): i32 {
  const owed = carry;
  let t = carryTail + owed;
  if (t < 0) t = 0;
  const absorbed = t < head ? t : head;
  let charged = owed - absorbed;
  if (instr + charged < 0) charged = -instr;
  carry = surch;
  carryTail = tail;
  return instr + charged;
}

function takeIrq6(): i32 {
  surch = penIn;
  penIn = 0;
  head = 0;
  tail = EXCEPTION_TAIL;
  const oldSr = SR;
  if ((SR & SR_S) == 0) setSR(SR | SR_S);
  SR &= ~SR_T & 0xffff;
  SR = (SR & ~SR_INT) | (6 << 8);
  pushWord((IRQ6_VECTOR * 4) & 0x0fff);
  pushLong(PC);
  pushWord(oldSr);
  PC = readMem(load<u32>(S_VBR) + IRQ6_VECTOR * 4, 4);
  surch += fetchPenSpan(PC, 2);
  store<u32>(S_DAC_PENDING, 0);
  store<u32>(S_IRQ6_TAKEN, load<u32>(S_IRQ6_TAKEN) + 1);
  return settle(IRQ6_CYCLES);
}

function takeException(vector: u32): void {
  const oldSr = SR;
  if ((SR & SR_S) == 0) setSR(SR | SR_S);
  SR &= ~SR_T & 0xffff;
  tail = EXCEPTION_TAIL;
  pushWord((vector * 4) & 0x0fff);
  pushLong(PC);
  pushWord(oldSr);
  PC = readMem(load<u32>(S_VBR) + vector * 4, 4);
  surch += fetchPenSpan(PC, 2);
}

export function run(budget: i32): i32 {
  SR = load<u32>(S_SR);
  PC = load<u32>(S_PC);
  store<u8>(S_DIRTY, 0);
  store<i32>(S_BUDGET, budget);
  store<u32>(S_INSTRS, 0);
  store<u32>(S_IRQ6_TAKEN, 0);
  let used: i32 = 0;
  let last: i32 = 0;
  let instrs: u32 = 0;
  let reason = REASON_BUDGET;
  if (P_CPU32) {
    carry = load<i32>(S_CARRY);
    carryTail = load<i32>(S_CARRY_TAIL);
    head = load<i32>(S_HEAD);
    tail = load<i32>(S_TAIL);
    penIn = load<i32>(S_PEN_IN);
    store<i32>(S_PEN_IN, 0);
  }
  while (used < load<i32>(S_BUDGET)) {
    if (P_CPU32) {
      let level = load<u32>(S_IRQ_OTHER);
      const pending6 = load<u32>(S_DAC_PENDING) != 0;
      if (pending6 && level < 6) level = 6;
      if (level != 0 && (level == 7 || level > ((SR & SR_INT) >> 8))) {
        if (level == 6 && pending6 && load<u32>(S_AVEC6) != 0) {
          store<i32>(S_USED, used);
          store<i32>(S_INSTR_START, used);
          const cb = carry;
          last = takeIrq6();
          trace(0xffffffff, last, cb);
          used += last;
          store<i32>(S_LAST, last);
          dacTick(used);
          continue;
        }
        reason = REASON_IRQ;
        break;
      }
    }
    store<i32>(S_USED, used);
    store<u32>(S_PC0, PC);
    const idx = codeIndex(PC);
    if (idx == 0xffffffff) { reason = REASON_FALLBACK; break; }
    const kind = <u32>load<u8>(metaKind + idx);
    if (kind == K_FALLBACK) { reason = REASON_FALLBACK; break; }
    const cyc = execOne(idx, kind);
    if (cyc < 0) { reason = REASON_FALLBACK; break; }
    store<i32>(S_INSTR_START, used);
    const cb = carry;
    last = P_CPU32 ? settle(cyc + extra) : cyc;
    store<u32>(S_LAST_PC, load<u32>(S_PC0));
    trace(load<u32>(S_PC0), last, cb);
    used += last;
    instrs++;
    store<i32>(S_LAST, last);
    if (P_CPU32) dacTick(used);
    if (load<u8>(S_DIRTY) != 0) { store<u8>(S_DIRTY, 0); reason = REASON_DIRTY; break; }
  }
  store<u32>(S_SR, SR);
  store<u32>(S_PC, PC);
  store<i32>(S_USED, used);
  store<i32>(S_LAST, last);
  store<u32>(S_INSTRS, instrs);
  if (P_CPU32) {
    store<i32>(S_CARRY, carry);
    store<i32>(S_CARRY_TAIL, carryTail);
    store<i32>(S_HEAD, head);
    store<i32>(S_TAIL, tail);
    store<i32>(S_PEN_IN, penIn);
  }
  return reason;
}

let dacPeriodCycles: i32 = DAC_NEVER;
export function setDacPeriod(p: i32): void { dacPeriodCycles = p; }
// @ts-ignore
@inline function dacTick(used: i32): void {
  const dacIn = load<i32>(S_DAC_IN);
  if (used >= dacIn) { store<i32>(S_DAC_IN, dacIn + dacPeriodCycles); store<u32>(S_DAC_PENDING, 1); }
}

export function stepOne(): i32 {
  SR = load<u32>(S_SR);
  PC = load<u32>(S_PC);
  if (P_CPU32) {
    carry = load<i32>(S_CARRY);
    carryTail = load<i32>(S_CARRY_TAIL);
    penIn = load<i32>(S_PEN_IN);
    store<i32>(S_PEN_IN, 0);
  }
  let reason: i32;
  store<i32>(S_USED, 0);
  store<u32>(S_PC0, PC);
  const idx = codeIndex(PC);
  if (idx == 0xffffffff) reason = REASON_FALLBACK;
  else {
    const kind = <u32>load<u8>(metaKind + idx);
    if (kind == K_FALLBACK) reason = REASON_FALLBACK;
    else {
      const cyc = execOne(idx, kind);
      if (cyc < 0) reason = REASON_FALLBACK;
      else {
        const total = P_CPU32 ? settle(cyc + extra) : cyc;
        store<i32>(S_USED, total);
        store<i32>(S_LAST, total);
        reason = REASON_OK;
      }
    }
  }
  store<u32>(S_SR, SR);
  store<u32>(S_PC, PC);
  if (P_CPU32) {
    store<i32>(S_CARRY, carry);
    store<i32>(S_CARRY_TAIL, carryTail);
    store<i32>(S_HEAD, head);
    store<i32>(S_TAIL, tail);
    store<i32>(S_PEN_IN, penIn);
  }
  return reason;
}
