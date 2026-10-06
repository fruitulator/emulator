
// @ts-ignore: decorator
@external("env", "trapRead8") declare function trapRead8(a: u32): u32;
// @ts-ignore: decorator
@external("env", "trapRead16") declare function trapRead16(a: u32): u32;
// @ts-ignore: decorator
@external("env", "trapWrite8") declare function trapWrite8(a: u32, v: u32): void;
// @ts-ignore: decorator
@external("env", "trapWrite16") declare function trapWrite16(a: u32, v: u32): void;

const SR_C: u32 = 0x0001;
const SR_V: u32 = 0x0002;
const SR_Z: u32 = 0x0004;
const SR_N: u32 = 0x0008;
const SR_X: u32 = 0x0010;
const SR_CCR: u32 = 0x001f;

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

const ALU_OR = 0;
const ALU_AND = 1;
const ALU_SUB = 2;
const ALU_ADD = 3;
const ALU_EOR = 5;
const ALU_CMP = 6;

const REASON_OK = 0;
const REASON_BUDGET = 1;
const REASON_FALLBACK = 2;

const DATA_BASE: u32 = 0x100000;
const REG_D: u32 = DATA_BASE;
const REG_A: u32 = DATA_BASE + 32;
const S_SR: u32 = DATA_BASE + 64;
const S_PC: u32 = DATA_BASE + 68;
const S_USED: u32 = DATA_BASE + 72;
const S_DIRTY: u32 = DATA_BASE + 76;
const STATE_END: u32 = DATA_BASE + 128;

let baseAddr: u32 = 0;
let nWords: u32 = 0;
let romOff: u32 = 0;
let romSize: u32 = 0;
let ramOff: u32 = 0;
let ramBase: u32 = 0;
let ramSize: u32 = 0;
let sramOff: u32 = 0;
let sramBase: u32 = 0;
let sramSize: u32 = 0;
let metaKind: u32 = 0;
let metaLen: u32 = 0;
let metaCyc: u32 = 0;
let metaA: u32 = 0;
let metaB: u32 = 0;
let metaC: u32 = 0;

let SR: u32 = 0;
let PC: u32 = 0;

// @ts-ignore: decorator
@inline function align4(x: u32): u32 { return (x + 3) & ~3; }

export function configure(codeBase: u32, words: u32, rSize: u32, rBase: u32, rLen: u32, sLen: u32): u32 {
  baseAddr = codeBase;
  nWords = words;
  romSize = rSize;
  ramBase = rBase;
  ramSize = rLen;
  sramSize = sLen;
  sramBase = 0;
  metaKind = STATE_END;
  metaLen = metaKind + words;
  metaCyc = metaLen + words;
  metaA = align4(metaCyc + words);
  metaB = metaA + words * 4;
  metaC = metaB + words * 4;
  romOff = align4(metaC + words * 4);
  ramOff = romOff + rSize;
  sramOff = align4(ramOff + rLen);
  return align4(sramOff + sLen);
}

export function setSramBase(base: u32): void { sramBase = base; }
export function setRamBase(base: u32): void { ramBase = base; }

export function getRegD(): u32 { return REG_D; }
export function getStateSr(): u32 { return S_SR; }
export function getStatePc(): u32 { return S_PC; }
export function getStateUsed(): u32 { return S_USED; }
export function getStateDirty(): u32 { return S_DIRTY; }
export function getMetaKind(): u32 { return metaKind; }
export function getMetaLen(): u32 { return metaLen; }
export function getMetaCyc(): u32 { return metaCyc; }
export function getMetaA(): u32 { return metaA; }
export function getMetaB(): u32 { return metaB; }
export function getMetaC(): u32 { return metaC; }
export function getRomOff(): u32 { return romOff; }
export function getRamOff(): u32 { return ramOff; }
export function getSramOff(): u32 { return sramOff; }

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
@inline function gRead8(a: u32): u32 {
  if (a < romSize) return load<u8>(romOff + a);
  if (a >= ramBase && a < ramBase + ramSize) return load<u8>(ramOff + (a - ramBase));
  if (sramBase != 0 && a >= sramBase && a < sramBase + sramSize) return load<u8>(sramOff + (a - sramBase));
  return trapRead8(a);
}
// @ts-ignore
@inline function gRead16(a: u32): u32 {
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
  if (a >= ramBase && a < ramBase + ramSize) { store<u8>(ramOff + (a - ramBase), <u8>v); return; }
  if (sramBase != 0 && a >= sramBase && a < sramBase + sramSize) { store<u8>(sramOff + (a - sramBase), <u8>v); return; }
  trapWrite8(a, v);
}
// @ts-ignore
@inline function gWrite16(a: u32, v: u32): void {
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
    case K_BRA: PC = <u32>b; break;
    case K_BSR: pushLong(PC); PC = <u32>b; break;
    case K_BCC: if (testCC(aux)) PC = <u32>b; break;
    case K_DBCC: {
      if (testCC(aux)) break;
      const next = (readDsz(sreg, 2) - 1) & 0xffff;
      writeDsz(sreg, 2, next);
      if (next != 0xffff) PC = <u32>b;
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
      PC = addr;
      break;
    }
    case K_JSR: {
      const addr = opAddrFast(sx, sreg, b, c);
      if (addr & 1) { PC = pc0; return -1; }
      pushLong(PC);
      PC = addr;
      break;
    }
    case K_RTS: {
      const pcv = readMem(getA(7), 4);
      if (pcv & 1) { PC = pc0; return -1; }
      setA(7, getA(7) + 4);
      PC = pcv;
      break;
    }
    case K_RTD: {
      const pcv = readMem(getA(7), 4);
      if (pcv & 1) { PC = pc0; return -1; }
      setA(7, getA(7) + 4 + <u32>b);
      PC = pcv;
      break;
    }
    case K_RTR: {
      const ccr = readMem(getA(7), 2);
      const pcv = readMem(getA(7) + 2, 4);
      if (pcv & 1) { PC = pc0; return -1; }
      setA(7, getA(7) + 6);
      SR = (SR & ~SR_CCR) | (ccr & SR_CCR);
      PC = pcv;
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
      const divisor = readOpFast(sx, sreg, 2, b, c);
      if (divisor == 0) { PC = pc0; return -1; }
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
      const src = readOpFast(sx, sreg, 4, b, c);
      if (src == 0) { PC = pc0; return -1; }
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
        else setD(dreg, ql);
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
        else setD(dreg, ql);
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
    case K_NOP: break;
    default: PC = pc0; return -1;
  }
  return cyc;
}

export function run(budget: i32): i32 {
  SR = load<u32>(S_SR);
  PC = load<u32>(S_PC);
  store<u8>(S_DIRTY, 0);
  let used = 0;
  let reason = REASON_BUDGET;
  while (used < budget) {
    store<i32>(S_USED, used);
    const rel: u32 = PC - baseAddr;
    const idx: u32 = rel >> 1;
    if ((rel & 1) != 0 || idx >= nWords) { reason = REASON_FALLBACK; break; }
    const kind = <u32>load<u8>(metaKind + idx);
    if (kind == K_FALLBACK) { reason = REASON_FALLBACK; break; }
    const cyc = execOne(idx, kind);
    if (cyc < 0) { reason = REASON_FALLBACK; break; }
    used += cyc;
    if (load<u8>(S_DIRTY) != 0) { store<u8>(S_DIRTY, 0); break; }
  }
  store<u32>(S_SR, SR);
  store<u32>(S_PC, PC);
  store<i32>(S_USED, used);
  return reason;
}

export function stepOne(): i32 {
  SR = load<u32>(S_SR);
  PC = load<u32>(S_PC);
  let reason: i32;
  const rel: u32 = PC - baseAddr;
  const idx: u32 = rel >> 1;
  if ((rel & 1) != 0 || idx >= nWords) reason = REASON_FALLBACK;
  else {
    const kind = <u32>load<u8>(metaKind + idx);
    if (kind == K_FALLBACK) reason = REASON_FALLBACK;
    else {
      const cyc = execOne(idx, kind);
      if (cyc < 0) reason = REASON_FALLBACK;
      else { store<i32>(S_USED, cyc); reason = REASON_OK; }
    }
  }
  store<u32>(S_SR, SR);
  store<u32>(S_PC, PC);
  return reason;
}
