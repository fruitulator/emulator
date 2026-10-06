import {
  type ControlTable, JMP_CYCLES68, JSR_CYCLES68, LEA_CYCLES68, MOVEM_TO_MEM68, MOVEM_TO_REG68,
  PEA_CYCLES68, aluBase68, controlCost68, eaCost68, moveDstCost68, rmwBase68,
} from './m68ktiming';
import { coldfireCycleTable } from './cfcycles';
import { CPU32_NO_ENTRY, cpu32CycleTable, cpu32ExceptionCycles } from './cpu32cycles';
import { CPU32_EXCEPTION_TAIL, HEAD_FROM_EA, cpu32EaHead, cpu32OpHeadTable, cpu32TailTable } from './cpu32overlap';
import {
  AluOp as PD_AluOp, K as PD_K, Predecode, PredecodePage, XM_AN as PD_XM_AN, XM_DN as PD_XM_DN,
  XM_IMM as PD_XM_IMM, XM_PCIX as PD_XM_PCIX, XM_PD as PD_XM_PD, XM_PI as PD_XM_PI,
} from './m68kpredecode';
const K = PD_K;
type K = PD_K;
const AluOp = PD_AluOp;
type AluOp = PD_AluOp;
const XM_AN = PD_XM_AN;
const XM_DN = PD_XM_DN;
const XM_IMM = PD_XM_IMM;
const XM_PCIX = PD_XM_PCIX;
const XM_PD = PD_XM_PD;
const XM_PI = PD_XM_PI;
import { Regions } from './m68kregions';
import type { Bus16 } from './bus68k';

export const SR_C = 0x0001;
export const SR_V = 0x0002;
export const SR_Z = 0x0004;
export const SR_N = 0x0008;
export const SR_X = 0x0010;
export const SR_CCR = 0x001f;
export const SR_INT = 0x0700;
export const SR_S = 0x2000;
export const SR_T = 0x8000;
export const SR_IMPLEMENTED = SR_T | SR_S | SR_INT | SR_CCR;

export const enum Size {
  Byte = 1,
  Word = 2,
  Long = 4,
}

const VEC_BUS_ERROR = 2;
const VEC_ADDRESS_ERROR = 3;
const VEC_ILLEGAL = 4;
const VEC_DIVIDE_ZERO = 5;
const VEC_PRIVILEGE = 8;
const VEC_LINE_A = 10;
const VEC_LINE_F = 11;
const VEC_FORMAT_ERROR = 14;

export type M68kVariant = '68000' | 'cpu32' | 'coldfire';

const SIZES = [Size.Byte, Size.Word, Size.Long] as const;

export interface M68000Options {
  variant?: M68kVariant;
}

const CR_SFC = 0x000;
const CR_DFC = 0x001;
const CR_CACR = 0x002;
const CR_ACR0 = 0x004;
const CR_ACR1 = 0x005;
const CR_USP = 0x800;
const CR_VBR = 0x801;
const CR_RAMBAR = 0xc04;
const CR_MBAR = 0xc0f;

const EA_DN = 0x800;
const EA_AN = 0x400;
const EA_AI = 0x200;
const EA_PI = 0x100;
const EA_PD = 0x080;
const EA_DI = 0x040;
const EA_IX = 0x020;
const EA_AW = 0x010;
const EA_AL = 0x008;
const EA_IMM = 0x004;
const EA_PCDI = 0x002;
const EA_PCIX = 0x001;

const EA_ALL = 0xfff;
const EA_DATA = EA_ALL & ~EA_AN;
const EA_ALTERABLE = EA_ALL & ~(EA_PCDI | EA_PCIX | EA_IMM);
const EA_DATA_ALT = EA_DATA & EA_ALTERABLE;
const EA_MEM_ALT = EA_DATA_ALT & ~EA_DN;
const EA_CONTROL = EA_AI | EA_DI | EA_IX | EA_AW | EA_AL | EA_PCDI | EA_PCIX;
const EA_CONTROL_PD = (EA_CONTROL & EA_ALTERABLE) | EA_PD;
const EA_CONTROL_PI = EA_CONTROL | EA_PI;
const EA_DATA_NO_IMM = EA_DATA & ~EA_IMM;

class AddressError extends Error {
  constructor(
    readonly addr: number,
    readonly isWrite: boolean,
    readonly isProgram: boolean,
  ) {
    super(`address error at ${addr.toString(16)}`);
  }
}

class IllegalEncoding extends Error {
  constructor(mode: number, reg: number) {
    super(`no effective address for mode ${mode}/${reg}`);
  }
}

export class M68000 {
  d = new Uint32Array(8);
  a = new Uint32Array(8);

  bindRegisters(d: Uint32Array<ArrayBuffer>, a: Uint32Array<ArrayBuffer>): void {
    d.set(this.d);
    a.set(this.a);
    this.d = d;
    this.a = a;
  }

  private otherSp = 0;

  sr = SR_S | SR_INT;
  pc = 0;

  irc0 = 0;
  irc1 = 0;

  cycles = 0;
  instrHead = 0;
  private headSeen = false;
  private headFromEa = true;

  instrTail = 0;

  halted = false;

  onIllegal: ((op: number, pc: number, vector: number) => void) | null = null;

  onInterruptAck: ((level: number, vector: number) => number | void) | null = null;

  onResetInstruction: (() => void) | null = null;

  onControlReg: ((reg: number, value: number) => void) | null = null;

  readonly variant: M68kVariant;

  private readonly addrMask: number;

  vbr = 0;
  sfc = 0;
  dfc = 0;

  cacr = 0;
  acr0 = 0;
  acr1 = 0;
  rambar = 0;
  mbar = 0;

  private readonly isColdfire: boolean;
  private readonly isCpu32: boolean;
  private readonly is68000: boolean;
  private undoN = 0;
  private undoR0 = 0;
  private undoV0 = 0;
  private undoR1 = 0;
  private undoV1 = 0;
  private undoSr = 0;
  private readonly cfCycles: Uint8Array | null;
  private readonly c32Cycles: Uint8Array | null;
  private readonly c32Tails: Int8Array | null;
  private readonly c32Heads: Int8Array | null;

  private extraCycles = 0;

  private predecode: Predecode | null = null;

  private prefetchStale = false;

  private readonly fetchCost: ((addr: number, words: number) => void) | null;
  private readonly refetch16: (addr: number) => number;
  private readonly penaltyMark: (() => number) | null;
  private readonly penaltyRestore: ((mark: number) => void) | null;

  setCodeRegion(base: number, romBytes: Uint8Array): void {
    if (this.isCpu32) {
      this.predecode = new Predecode(base, romBytes, 'cpu32');
      return;
    }
    if (this.is68000) {
      this.predecode = new Predecode(base, romBytes, '68000');
      return;
    }
    if (!this.isColdfire) return;
    this.predecode = new Predecode(base, romBytes);
    this.regions = new Regions(this.predecode, romBytes, this.bus);
    this.regions.enabled = this.regionsEnabled;
  }

  useInterpreter(): void {
    this.predecode = null;
    this.regions = null;
  }

  get onFastPath(): boolean { return this.predecode !== null; }

  regionBudget = 0;
  private regions: Regions | null = null;

  private regionsEnabled = true;
  setRegionsEnabled(on: boolean): void {
    this.regionsEnabled = on;
    if (this.regions) this.regions.enabled = on;
  }

  regionCycles = 0;
  budgetStale = false;

  regionShift(kind: number, left: boolean, reg: number, count: number, size: Size): void {
    this.writeD(reg, size, this.shift(kind, left, this.readD(reg, size), count, size));
  }

  regionMulW(signed: boolean, raw: number, dreg: number): void {
    const v = signed
      ? Math.imul(M68000.signed(raw, Size.Word), M68000.signed(this.readD(dreg, Size.Word), Size.Word))
      : raw * this.readD(dreg, Size.Word);
    this.d[dreg] = v >>> 0;
    this.logic(v, Size.Long);
  }

  regionMulL(signed: boolean, src: number, dl: number): void {
    const a1 = BigInt(signed ? src | 0 : src >>> 0);
    const b1 = BigInt(signed ? this.d[dl] | 0 : this.d[dl] >>> 0);
    const p = a1 * b1;
    const low = Number(p & 0xffffffffn) >>> 0;
    this.d[dl] = low;
    this.setFlags(SR_N, (low & 0x80000000) !== 0);
    this.setFlags(SR_Z, low === 0);
    const fits = signed ? p >= -0x80000000n && p <= 0x7fffffffn : p <= 0xffffffffn;
    this.setFlags(SR_V, !fits);
    this.setFlags(SR_C, false);
  }

  regionDivW(signed: boolean, divisor: number, dreg: number): void {
    const dividend = signed ? this.d[dreg] | 0 : this.d[dreg] >>> 0;
    const div = signed ? M68000.signed(divisor, Size.Word) : divisor;
    const q = signed ? Math.trunc(dividend / div) : Math.floor(dividend / div);
    const r = dividend - q * div;
    const overflow = signed ? q < -0x8000 || q > 0x7fff : q > 0xffff;
    if (overflow) {
      this.setFlags(SR_V, true);
      this.setFlags(SR_C, false);
      return;
    }
    this.setFlags(SR_V | SR_C, false);
    this.setFlags(SR_N, (q & 0x8000) !== 0);
    this.setFlags(SR_Z, (q & 0xffff) === 0);
    this.d[dreg] = (((r & 0xffff) << 16) | (q & 0xffff)) >>> 0;
  }

  regionDivL(signed: boolean, src: number, dq: number, dr: number): void {
    const divisor = BigInt(signed ? src | 0 : src >>> 0);
    const dividend = signed ? BigInt(this.d[dq] | 0) : BigInt(this.d[dq] >>> 0);
    const q = dividend / divisor;
    const r = dividend - q * divisor;
    const fits = signed ? q >= -0x80000000n && q <= 0x7fffffffn : q <= 0xffffffffn;
    if (!fits) {
      this.setFlags(SR_V, true);
      this.setFlags(SR_C, false);
      return;
    }
    this.storeDivL(q, r, dq, dr);
  }

  private storeDivL(q: bigint, r: bigint, dq: number, dr: number): void {
    const ql = Number(q & 0xffffffffn) >>> 0;
    if (dr !== dq) this.d[dr] = Number(r & 0xffffffffn) >>> 0;
    if (dr === dq || this.variant !== 'coldfire') this.d[dq] = ql;
    this.setFlags(SR_N, (ql & 0x80000000) !== 0);
    this.setFlags(SR_Z, ql === 0);
    this.setFlags(SR_V | SR_C, false);
  }

  noteRegionExit(idx: number): void {
    this.regions!.note(idx);
  }

  noteRegionExitPc(pc: number): void {
    this.regions!.noteAddr(pc >>> 0);
  }

  regionStats(): [number, number] {
    const r = this.regions;
    return r === null ? [0, 0] : [r.compiled, r.entries];
  }

  fastStats(): [number, number] {
    const pd = this.predecode;
    return pd === null ? [0, 0] : [pd.lookups - pd.fallbacks, pd.fallbacks];
  }

  constructor(private readonly bus: Bus16, opts: M68000Options = {}) {
    this.variant = opts.variant ?? '68000';
    this.addrMask = this.variant === '68000' ? 0xffffff : 0xffffffff;
    this.isColdfire = this.variant === 'coldfire';
    this.isCpu32 = this.variant === 'cpu32';
    this.is68000 = this.variant === '68000';
    this.cfCycles = this.isColdfire ? coldfireCycleTable() : null;
    this.c32Cycles = this.isCpu32 ? cpu32CycleTable() : null;
    this.c32Tails = this.isCpu32 ? cpu32TailTable() : null;
    this.c32Heads = this.isCpu32 ? cpu32OpHeadTable() : null;
    this.fetchCost = bus.fetchCost ? bus.fetchCost.bind(bus) : null;
    this.penaltyMark = bus.penaltyMark ? bus.penaltyMark.bind(bus) : null;
    this.penaltyRestore = bus.penaltyRestore ? bus.penaltyRestore.bind(bus) : null;
    this.refetch16 = bus.refetch16 ? bus.refetch16.bind(bus) : bus.read16.bind(bus);
  }

  get supervisor(): boolean {
    return (this.sr & SR_S) !== 0;
  }

  get usp(): number {
    return this.supervisor ? this.otherSp : this.a[7];
  }

  set usp(v: number) {
    if (this.supervisor) this.otherSp = v >>> 0;
    else this.a[7] = v >>> 0;
  }

  get ssp(): number {
    return this.supervisor ? this.a[7] : this.otherSp;
  }

  set ssp(v: number) {
    if (this.supervisor) this.a[7] = v >>> 0;
    else this.otherSp = v >>> 0;
  }

  setSR(v: number): void {
    if (this.variant !== 'coldfire') {
      const was = this.supervisor;
      const now = (v & SR_S) !== 0;
      if (was !== now) {
        const active = this.a[7];
        this.a[7] = this.otherSp;
        this.otherSp = active;
      }
    }
    this.sr = v & SR_IMPLEMENTED;
  }

  private busAddr(a: number): number {
    return (a & this.addrMask) >>> 0;
  }

  fillPrefetch(): void {
    this.irc0 = this.bus.read16(this.busAddr(this.pc));
    this.irc1 = this.bus.read16(this.busAddr(this.pc + 2));
    this.prefetchStale = false;
  }

  private refillPrefetch(): void {
    this.irc0 = this.refetch16(this.busAddr(this.pc));
    this.irc1 = this.refetch16(this.busAddr(this.pc + 2));
    this.prefetchStale = false;
  }

  private fetch(): number {
    const v = this.irc0;
    this.pc = (this.pc + 2) >>> 0;
    this.irc0 = this.irc1;
    this.irc1 = this.bus.read16(this.busAddr(this.pc + 2));
    return v;
  }

  private fetchLong(): number {
    const hi = this.fetch();
    return ((hi << 16) | this.fetch()) >>> 0;
  }

  private setFlags(mask: number, on: boolean): void {
    if (on) this.sr |= mask;
    else this.sr &= ~mask & 0xffff;
  }

  private static signed(v: number, size: Size): number {
    switch (size) {
      case Size.Byte:
        return (v << 24) >> 24;
      case Size.Word:
        return (v << 16) >> 16;
      default:
        return v | 0;
    }
  }

  private static mask(size: Size): number {
    return size === Size.Byte ? 0xff : size === Size.Word ? 0xffff : 0xffffffff;
  }

  private static trunc(v: number, size: Size): number {
    return size === Size.Long ? v >>> 0 : v & M68000.mask(size);
  }

  private logicFlags(v: number, size: Size): void {
    const masked = v & M68000.mask(size);
    this.setFlags(SR_N, M68000.signed(masked, size) < 0);
    this.setFlags(SR_Z, masked === 0);
    this.setFlags(SR_V | SR_C, false);
  }

  private readD(reg: number, size: Size): number {
    return M68000.trunc(this.d[reg], size);
  }

  private writeD(reg: number, size: Size, v: number): void {
    const m = M68000.mask(size);
    this.d[reg] = size === Size.Long ? v >>> 0 : ((this.d[reg] & ~m) | (v & m)) >>> 0;
  }

  private checkAlign(addr: number, size: Size, isWrite: boolean): void {
    if (size !== Size.Byte && (addr & 1) && this.variant === '68000') {
      throw new AddressError(addr >>> 0, isWrite, false);
    }
  }

  private readMem(addr: number, size: Size, fc?: number): number {
    this.checkAlign(addr, size, false);
    const a = this.busAddr(addr);
    switch (size) {
      case Size.Byte:
        return this.bus.read8(a, fc);
      case Size.Word:
        return this.bus.read16(a, fc);
      default:
        return ((this.bus.read16(a, fc) << 16)
          | this.bus.read16(this.busAddr(a + 2), fc)) >>> 0;
    }
  }

  private writeMem(addr: number, size: Size, v: number, fc?: number): void {
    this.checkAlign(addr, size, true);
    const a = this.busAddr(addr);
    switch (size) {
      case Size.Byte:
        this.bus.write8(a, v & 0xff, fc);
        break;
      case Size.Word:
        this.bus.write16(a, v & 0xffff, fc);
        break;
      default:
        this.bus.write16(a, (v >>> 16) & 0xffff, fc);
        this.bus.write16(this.busAddr(a + 2), v & 0xffff, fc);
        break;
    }
  }

  static eaHead(mode: number, reg: number): number {
    return cpu32EaHead(mode, reg);
  }

  private static eaCost(mode: number, reg: number, size: Size): number {
    return eaCost68(mode, reg, size);
  }

  private static moveDstCost(mode: number, reg: number, size: Size): number {
    return moveDstCost68(mode, reg, size);
  }

  private static aluBase(toMemory: boolean, size: Size, mode: number, reg: number): number {
    return aluBase68(toMemory, size, mode, reg);
  }

  private static rmwBase(size: Size, mode: number): number {
    return rmwBase68(size, mode);
  }

  private static controlCost(table: ControlTable, mode: number, reg: number): number {
    return controlCost68(table, mode, reg);
  }

  private static readonly MOVEM_TO_REG: ControlTable = MOVEM_TO_REG68;
  private static readonly MOVEM_TO_MEM: ControlTable = MOVEM_TO_MEM68;

  private static readonly LEA_CYCLES: ControlTable = LEA_CYCLES68;
  private static readonly PEA_CYCLES: ControlTable = PEA_CYCLES68;
  private static readonly JMP_CYCLES: ControlTable = JMP_CYCLES68;
  private static readonly JSR_CYCLES: ControlTable = JSR_CYCLES68;

  private static stride(reg: number, size: Size): number {
    return size === Size.Byte && reg === 7 ? 2 : size;
  }

  private briefIndex(base: number): number {
    const ext = this.fetch();
    if (this.variant !== '68000' && (ext & 0x0100)) {
      if (this.variant !== 'cpu32') throw new IllegalEncoding(6, -1);
      return this.fullIndex(base, ext);
    }
    const reg = (ext >> 12) & 7;
    const isAddr = (ext & 0x8000) !== 0;
    const raw = isAddr ? this.a[reg] : this.d[reg];
    const index = ext & 0x0800 ? raw | 0 : (raw << 16) >> 16;
    const scale = this.variant === '68000' ? 0 : (ext >> 9) & 3;
    const disp = (ext << 24) >> 24;
    return (base + (index << scale) + disp) >>> 0;
  }

  private fullIndex(base: number, ext: number): number {
    if ((ext & 7) !== 0) throw new IllegalEncoding(6, -1);
    const bdSize = (ext >> 4) & 3;
    if (bdSize === 0) throw new IllegalEncoding(6, -1);
    let bd = 0;
    if (bdSize === 2) bd = (this.fetch() << 16) >> 16;
    else if (bdSize === 3) bd = this.fetchLong() | 0;
    let index = 0;
    if (!(ext & 0x0040)) {
      const reg = (ext >> 12) & 7;
      const raw = ext & 0x8000 ? this.a[reg] : this.d[reg];
      index = (ext & 0x0800 ? raw | 0 : (raw << 16) >> 16) << ((ext >> 9) & 3);
    }
    this.cycles += bdSize === 3 ? 12 : 8;
    if (this.isCpu32) this.extraCycles += bdSize === 3 ? 6 : bdSize === 2 ? 2 : 0;
    return ((ext & 0x0080 ? 0 : base) + bd + index) >>> 0;
  }

  private effectiveAddress(
    mode: number,
    reg: number,
    size: Size,
    isWrite: boolean,
  ): number {
    this.cycles += M68000.eaCost(mode, reg, size);
    if (!this.headSeen) {
      if (this.headFromEa) this.instrHead = M68000.eaHead(mode, reg);
      this.headSeen = true;
    }
    switch (mode) {
      case 2:
        return this.a[reg];
      case 3: {
        const addr = this.a[reg];
        if (isWrite) this.checkAlign(addr, size, true);
        this.a[reg] = (addr + M68000.stride(reg, size)) >>> 0;
        return addr;
      }
      case 4: {
        const addr = (this.a[reg] - M68000.stride(reg, size)) >>> 0;
        this.a[reg] = addr;
        return addr;
      }
      case 5:
        return (this.a[reg] + ((this.fetch() << 16) >> 16)) >>> 0;
      case 6:
        return this.briefIndex(this.a[reg]);
      case 7:
        switch (reg) {
          case 0:
            return ((this.fetch() << 16) >> 16) >>> 0;
          case 1:
            return this.fetchLong();
          case 2: {
            const base = this.pc;
            return (base + ((this.fetch() << 16) >> 16)) >>> 0;
          }
          case 3: {
            const base = this.pc;
            return this.briefIndex(base);
          }
        }
    }
    throw new IllegalEncoding(mode, reg);
  }

  private readEA(mode: number, reg: number, size: Size): number {
    if (mode === 0) return this.readD(reg, size);
    if (mode === 1) return M68000.trunc(this.a[reg], size);
    if (mode === 7 && reg === 4) {
      this.cycles += M68000.eaCost(mode, reg, size);
      if (!this.headSeen) {
        if (this.headFromEa) this.instrHead = M68000.eaHead(mode, reg);
        this.headSeen = true;
      }
      if (size === Size.Long) return this.fetchLong();
      const w = this.fetch();
      return size === Size.Byte ? w & 0xff : w;
    }
    return this.readMem(this.effectiveAddress(mode, reg, size, false), size);
  }

  private pushLong(v: number): void {
    this.a[7] = (this.a[7] - 4) >>> 0;
    this.writeMem(this.a[7], Size.Long, v);
  }

  private pushWord(v: number): void {
    this.a[7] = (this.a[7] - 2) >>> 0;
    this.writeMem(this.a[7], Size.Word, v);
  }

  private pushFrame(oldSr: number, pc: number, vector: number): void {
    if (this.isCpu32) this.instrTail = CPU32_EXCEPTION_TAIL;
    if (this.variant === 'coldfire') {
      this.pushLong(pc);
      this.pushLong((((0x4 << 28) | ((vector & 0xff) << 18) | (oldSr & 0xffff))) >>> 0);
      return;
    }
    if (this.variant === 'cpu32') this.pushWord((vector * 4) & 0x0fff);
    this.pushLong(pc);
    this.pushWord(oldSr);
  }

  exception(vector: number): void {
    const oldSr = this.sr;
    if (!this.supervisor) this.setSR(this.sr | SR_S);
    this.sr &= ~SR_T & 0xffff;
    this.pushFrame(oldSr, this.pc, vector);
    this.pc = this.readMem(this.vbr + vector * 4, Size.Long) >>> 0;
    this.fillPrefetch();
    const cost = this.isCpu32 ? cpu32ExceptionCycles(vector) : 34;
    this.cycles += cost;
    this.extraCycles += cost;
  }

  reset(): void {
    this.sr = SR_S | SR_INT;
    this.otherSp = 0;
    this.vbr = 0;
    this.sfc = 0;
    this.dfc = 0;
    this.cacr = 0;
    this.acr0 = 0;
    this.acr1 = 0;
    this.rambar = 0;
    this.mbar = 0;
    this.a[7] = this.readMem(0, Size.Long) >>> 0;
    this.pc = this.readMem(4, Size.Long) >>> 0;
    this.halted = false;
    this.fillPrefetch();
  }

  private savedOp = 0;
  private savedPc = 0;
  private instrStart = 0;

  get instructionPc(): number {
    return this.savedPc;
  }

  setInstructionContext(pc: number, startCycle: number): void {
    this.savedPc = pc >>> 0;
    this.instrStart = startCycle;
  }

  get inactiveSp(): number { return this.otherSp; }
  set inactiveSp(v: number) { this.otherSp = v >>> 0; }

  get instructionCycle(): number {
    return this.instrStart;
  }

  private addressError(e: AddressError): void {
    if (this.isCpu32) this.instrHead = 0;
    if (this.variant !== '68000') {
      this.pc = this.savedPc;
      this.exception(VEC_ADDRESS_ERROR);
      return;
    }
    const faultPc = e.isProgram ? (e.addr - 4) >>> 0 : (this.pc - 2) >>> 0;
    const oldSr = this.sr;
    if (!this.supervisor) this.setSR(this.sr | SR_S);
    this.sr &= ~SR_T & 0xffff;

    const fc = (oldSr & SR_S ? 4 : 0) | (e.isProgram ? 2 : 1);
    const ssw =
      (this.savedOp & ~0x1f) | (e.isWrite ? 0 : 0x10) | (e.isProgram ? 0x08 : 0) | fc;

    this.pushLong(faultPc);
    this.pushWord(oldSr);
    this.pushWord(this.savedOp);
    this.pushLong(e.addr);
    this.pushWord(ssw);

    this.pc = this.readMem(VEC_ADDRESS_ERROR * 4, Size.Long) & 0xffffff;
    this.fillPrefetch();
    this.cycles = this.instrStart + 50;
  }

  private irqLevel = 0;
  private irqVector: number | null = null;

  setIRQ(level: number, vector: number | null = null): void {
    this.irqLevel = level & 7;
    this.irqVector = vector;
  }

  interruptPending(): boolean {
    if (this.irqLevel === 0) return false;
    if (this.irqLevel === 7) return true;
    return this.irqLevel > ((this.sr & SR_INT) >> 8);
  }

  private takeInterrupt(): void {
    const level = this.irqLevel;
    const latched = this.irqVector ?? 24 + level;
    const supplied = this.onInterruptAck?.(level, latched);
    const vec = typeof supplied === 'number' ? supplied : latched;
    const oldSr = this.sr;
    if (!this.supervisor) this.setSR(this.sr | SR_S);
    this.sr &= ~SR_T & 0xffff;
    this.sr = (this.sr & ~SR_INT) | ((level << 8) & SR_INT);

    this.pushFrame(oldSr, this.pc, vec);

    this.pc = this.readMem(this.vbr + vec * 4, Size.Long) >>> 0;
    this.fillPrefetch();
    this.halted = false;
    this.cycles += this.isCpu32 ? 30 : 44;
  }

  step(): number {
    const start = this.cycles;

    if (this.interruptPending()) {
      this.seedOverlap(start);
      this.takeInterrupt();
      return this.cycles - start;
    }
    if (this.halted) {
      this.seedOverlap(start);
      this.cycles += 4;
      return 4;
    }

    const pd = this.predecode;
    if (pd !== null) {
      let idx = (this.pc - pd.base) >> 1;
      if (idx >= 0 && idx < pd.nWords) {
        pd.lookups++;
        let page = pd.page(idx);
        let total = 0;
        for (;;) {
          const hid = page.head[idx & 2047];
          if (hid === 0) break;
          const r = this.regions!.regions[hid - 1];
          if (this.regionBudget <= r.maxCycles) break;
          this.regions!.entries++;
          const used = r.fn(this) as number;
          this.regionCycles += used;
          total += used;
          this.regionBudget -= used;
          if (used === 0) break;
          if (this.budgetStale) { this.budgetStale = false; return total; }
          idx = (this.pc - pd.base) >> 1;
          if (idx < 0 || idx >= pd.nWords) return total;
          page = pd.page(idx);
        }
        if (total > 0) return total;
        const k = pd.kindAt(idx, page);
        if (k !== K.FALLBACK) return this.execFast(page, idx, k, start);
        pd.fallbacks++;
      }
    }
    this.seedOverlap(start);
    if (this.prefetchStale) this.refillPrefetch();
    return this.stepInterpret(start);
  }

  idle(steps: number): void {
    this.cycles += steps * 4;
    this.instrStart = this.cycles - 4;
  }

  stepInterpretOnce(): number {
    const start = this.cycles;
    if (this.interruptPending()) {
      this.seedOverlap(start);
      this.takeInterrupt();
      return this.cycles - start;
    }
    if (this.halted) {
      this.seedOverlap(start);
      this.cycles += 4;
      return 4;
    }
    this.seedOverlap(start);
    this.refillPrefetch();
    return this.stepInterpret(start);
  }

  private seedOverlap(start: number): void {
    this.instrStart = start;
    this.extraCycles = 0;
    this.instrHead = 0;
    this.headSeen = false;
    this.headFromEa = true;
    this.instrTail = 0;
  }

  private stepInterpret(start: number): number {
    this.savedPc = this.pc;
    const op = this.fetch();
    this.savedOp = op;
    if (this.isCpu32) {
      this.instrTail = this.c32Tails![op];
      const h = this.c32Heads![op];
      this.headFromEa = h === HEAD_FROM_EA;
      if (!this.headFromEa) this.instrHead = h;
    }
    let trapped = false;
    try {
      this.execute(op);
    } catch (e) {
      if (e instanceof AddressError) { this.addressError(e); trapped = true; }
      else if (e instanceof IllegalEncoding) { this.illegal(op); trapped = true; }
      else throw e;
    }
    if (this.isColdfire && !trapped) {
      const cf = this.cfCycles![op];
      if (cf > 0) this.cycles = start + cf;
    }
    else if (this.isCpu32 && !trapped) {
      const c = this.c32Cycles![op];
      if (c !== CPU32_NO_ENTRY) this.cycles = start + c + this.extraCycles;
    }
    return this.cycles - start;
  }

  private execFast(page: PredecodePage, idx: number, k: number, start: number): number {
    const o = idx & 2047;
    const aw = page.a[o];
    const b = page.b[o];
    const c = page.c[o];
    const pc0 = this.pc;
    this.savedPc = pc0;
    this.prefetchStale = true;
    this.pc = (pc0 + page.len[o]) >>> 0;
    const nWords = page.len[o] >> 1;
    const mark = this.penaltyMark !== null ? this.penaltyMark() : 0;
    if (this.fetchCost !== null) this.fetchCost(pc0 + 4, nWords);
    this.instrStart = start;
    if (this.isCpu32) {
      this.extraCycles = 0;
      this.instrHead = page.c32Head[o];
      this.instrTail = page.c32Tail[o];
    }
    if (this.is68000) {
      this.extraCycles = 0;
      this.undoN = 0;
      this.undoSr = this.sr;
    }

    const sx = aw & 15;
    const sr = (aw >>> 4) & 7;
    const dx = (aw >>> 8) & 15;
    const dr = (aw >>> 12) & 7;
    const size = SIZES[(aw >>> 16) & 3];
    const aux = (aw >>> 18) & 0xff;
    const flag1 = (aw >>> 26) & 1;

    try {
      switch (k) {
        case K.MOVE: {
          const v = this.readOpFast(sx, sr, size, b, c);
          this.logicFlags(v, size);
          if (dx === XM_DN) this.writeD(dr, size, v);
          else this.writeMem(this.opAddrFast(dx, dr, c, 0), size, v);
          break;
        }
        case K.MOVEA: {
          const v = this.readOpFast(sx, sr, size, b, c);
          this.a[dr] = (size === Size.Word ? (v << 16) >> 16 : v) >>> 0;
          break;
        }
        case K.MOVEQ: {
          this.d[(aw >>> 12) & 7] = b >>> 0;
          this.logic(b, Size.Long);
          break;
        }
        case K.LEA:
          this.a[dr] = this.opAddrFast(sx, sr, b, c) >>> 0;
          break;
        case K.PEA:
          if (this.is68000) this.noteA(7);
          this.pushLong(this.opAddrFast(sx, sr, b, c));
          break;
        case K.CLR:
          if (dx === XM_DN) this.writeD(dr, size, 0);
          else {
            const addr = this.opAddrFast(dx, dr, c, 0);
            this.readMem(addr, size);
            this.writeMem(addr, size, 0);
          }
          this.setFlags(SR_N | SR_V | SR_C, false);
          this.setFlags(SR_Z, true);
          break;
        case K.TST:
          this.logic(this.readOpFast(sx, sr, size, b, c), size);
          break;
        case K.NOT:
          if (dx === XM_DN) this.writeD(dr, size, this.logic(~this.readD(dr, size), size));
          else {
            const addr = this.opAddrFast(dx, dr, c, 0);
            this.writeMem(addr, size, this.logic(~this.readMem(addr, size), size));
          }
          break;
        case K.NEG: {
          const isNegx = flag1 === 1;
          const x = isNegx && (this.sr & SR_X) ? 1 : 0;
          if (dx === XM_DN) {
            const d = this.readD(dr, size);
            this.writeD(dr, size, this.subFlags(d, 0, -d - x, size, isNegx));
          } else {
            const addr = this.opAddrFast(dx, dr, c, 0);
            const d = this.readMem(addr, size);
            this.writeMem(addr, size, this.subFlags(d, 0, -d - x, size, isNegx));
          }
          break;
        }
        case K.EXT: {
          const v = size === Size.Long
            ? (this.d[sr] << 16) >> 16
            : (this.d[sr] << 24) >> 24;
          this.writeD(sr, size, v);
          this.logic(v, size);
          break;
        }
        case K.EXTB: {
          const v = (this.d[sr] << 24) >> 24;
          this.d[sr] = v >>> 0;
          this.logic(v, Size.Long);
          break;
        }
        case K.SWAP: {
          const v = this.d[sr];
          this.d[sr] = ((v << 16) | (v >>> 16)) >>> 0;
          this.logic(this.d[sr], Size.Long);
          break;
        }
        case K.ALU: {
          if (flag1 === 0) {
            const v = this.readOpFast(sx, sr, size, b, c);
            switch (aux) {
              case AluOp.Or: this.writeD(dr, size, this.logic(this.readD(dr, size) | v, size)); break;
              case AluOp.And: this.writeD(dr, size, this.logic(this.readD(dr, size) & v, size)); break;
              case AluOp.Sub: {
                const d = this.readD(dr, size);
                this.writeD(dr, size, this.subFlags(v, d, d - v, size));
                break;
              }
              case AluOp.Add: {
                const d = this.readD(dr, size);
                this.writeD(dr, size, this.addFlags(v, d, d + v, size));
                break;
              }
              default: this.cmpFlags(v, this.readD(dr, size), size); break;
            }
            break;
          }
          const v = this.readD(sr, size);
          if (dx === XM_DN) {
            this.writeD(dr, size, this.logic(this.readD(dr, size) ^ v, size));
            break;
          }
          const addr = this.opAddrFast(dx, dr, c, 0);
          const d = this.readMem(addr, size);
          let r: number;
          switch (aux) {
            case AluOp.Or: r = this.logic(d | v, size); break;
            case AluOp.And: r = this.logic(d & v, size); break;
            case AluOp.Sub: r = this.subFlags(v, d, d - v, size); break;
            case AluOp.Add: r = this.addFlags(v, d, d + v, size); break;
            default: r = this.logic(d ^ v, size); break;
          }
          this.writeMem(addr, size, r);
          break;
        }
        case K.CMPA: {
          const raw = this.readOpFast(sx, sr, size, b, c);
          const v = size === Size.Word ? ((raw << 16) >> 16) >>> 0 : raw;
          this.cmpFlags(v, this.a[dr], Size.Long);
          break;
        }
        case K.ADDA: {
          const raw = this.readOpFast(sx, sr, size, b, c);
          const v = size === Size.Word ? (raw << 16) >> 16 : raw;
          this.a[dr] = (flag1 ? this.a[dr] - v : this.a[dr] + v) >>> 0;
          break;
        }
        case K.ADDQ: {
          const imm = aux;
          if (dx === XM_AN) {
            this.a[dr] = (flag1 ? this.a[dr] - imm : this.a[dr] + imm) >>> 0;
            break;
          }
          if (dx === XM_DN) {
            const d = this.readD(dr, size);
            this.writeD(dr, size, flag1
              ? this.subFlags(imm, d, d - imm, size)
              : this.addFlags(imm, d, d + imm, size));
            break;
          }
          const addr = this.opAddrFast(dx, dr, c, 0);
          const d = this.readMem(addr, size);
          this.writeMem(addr, size, flag1
            ? this.subFlags(imm, d, d - imm, size)
            : this.addFlags(imm, d, d + imm, size));
          break;
        }
        case K.IMM_ALU: {
          const imm = size === Size.Long ? b >>> 0 : b;
          if (aux === AluOp.Cmp) {
            this.cmpFlags(imm, this.readOpFast(dx, dr, size, c, 0), size);
            break;
          }
          let addr = 0;
          const d = dx === XM_DN ? this.readD(dr, size)
            : this.readMem(addr = this.opAddrFast(dx, dr, c, 0), size);
          let r: number;
          switch (aux) {
            case AluOp.Or: r = this.logic(d | imm, size); break;
            case AluOp.And: r = this.logic(d & imm, size); break;
            case AluOp.Sub: r = this.subFlags(imm, d, d - imm, size); break;
            case AluOp.Add: r = this.addFlags(imm, d, d + imm, size); break;
            default: r = this.logic(d ^ imm, size); break;
          }
          if (dx === XM_DN) this.writeD(dr, size, r);
          else this.writeMem(addr, size, r);
          break;
        }
        case K.BITOP_DYN:
        case K.BITOP_IMM: {
          const toRegister = sx === XM_DN;
          const bitNo = k === K.BITOP_DYN ? this.d[dr] : c;
          const bit = 1 << (bitNo & (toRegister ? 31 : 7));
          const opSize = toRegister ? Size.Long : Size.Byte;
          if (aux === 0) {
            const v = this.readOpFast(sx, sr, opSize, b, k === K.BITOP_DYN ? c : 0);
            this.setFlags(SR_Z, (v & bit) === 0);
            break;
          }
          let addr = 0;
          const v = toRegister ? this.readD(sr, opSize)
            : this.readMem(addr = this.opAddrFast(sx, sr, b, 0), opSize);
          this.setFlags(SR_Z, (v & bit) === 0);
          const r = aux === 1 ? v ^ bit : aux === 2 ? v & ~bit : v | bit;
          if (toRegister) this.writeD(sr, opSize, r);
          else this.writeMem(addr, opSize, r);
          break;
        }
        case K.SHIFT_REG: {
          const kind = aux & 3;
          const immCount = aux >> 2;
          const count = immCount === 0 ? this.d[sr] & 63 : immCount;
          if (this.is68000) this.extraCycles += 2 * count;
          this.writeD(dr, size, this.shift(kind, flag1 === 1, this.readD(dr, size), count, size));
          break;
        }
        case K.SHIFT_MEM: {
          const addr = this.opAddrFast(dx, dr, c, 0);
          this.writeMem(addr, Size.Word,
            this.shift(aux, flag1 === 1, this.readMem(addr, Size.Word), 1, Size.Word));
          break;
        }
        case K.BRA:
          if (this.isCpu32) this.instrHead = 2;
          this.flowFast(b);
          break;
        case K.BSR:
          if (this.is68000) this.noteA(7);
          this.pushLong(this.pc);
          this.flowFast(b);
          break;
        case K.BCC:
          if (this.testCC(aux)) {
            if (this.isCpu32) this.instrHead = 2;
            this.flowFast(b);
          } else if (this.isCpu32) {
            if (page.len[o] === 2) this.extraCycles -= 2;
          } else if (this.is68000) {
            this.extraCycles += page.len[o] === 4 ? 2 : -2;
          }
          break;
        case K.DBCC: {
          if (this.testCC(aux)) {
            if (this.is68000) this.extraCycles += 2;
            break;
          }
          const next = (this.readD(sr, Size.Word) - 1) & 0xffff;
          this.writeD(sr, Size.Word, next);
          if (next !== 0xffff) {
            if (this.isCpu32) this.instrHead = 6;
            this.flowFast(b);
          } else if (this.isCpu32) {
            this.instrHead = 2;
            this.extraCycles += 4;
          } else if (this.is68000) {
            this.extraCycles += 4;
          }
          break;
        }
        case K.SCC: {
          const taken = this.testCC(aux) ? 0xff : 0x00;
          if (dx === XM_DN) {
            this.writeD(dr, Size.Byte, taken);
            if (this.is68000 && taken) this.extraCycles += 2;
          }
          else {
            const addr = this.opAddrFast(dx, dr, c, 0);
            this.readMem(addr, Size.Byte);
            this.writeMem(addr, Size.Byte, taken);
          }
          break;
        }
        case K.JMP: {
          const addr = this.opAddrFast(sx, sr, b, c);
          if (addr & 1) return this.replaySlow(pc0, start, nWords, mark);
          this.flowFast(addr);
          break;
        }
        case K.JSR: {
          const addr = this.opAddrFast(sx, sr, b, c);
          if (addr & 1) return this.replaySlow(pc0, start, nWords, mark);
          if (this.is68000) this.noteA(7);
          this.pushLong(this.pc);
          this.flowFast(addr);
          break;
        }
        case K.RTS: {
          const pcv = this.readMem(this.a[7], Size.Long);
          if (pcv & 1) return this.replaySlow(pc0, start, nWords, mark);
          this.a[7] = (this.a[7] + 4) >>> 0;
          this.flowFast(pcv);
          break;
        }
        case K.RTD: {
          const pcv = this.readMem(this.a[7], Size.Long);
          if (pcv & 1) return this.replaySlow(pc0, start, nWords, mark);
          this.a[7] = (this.a[7] + 4 + b) >>> 0;
          this.flowFast(pcv);
          break;
        }
        case K.RTR: {
          const ccr = this.readMem(this.a[7], Size.Word);
          const pcv = this.readMem(this.a[7] + 2, Size.Long);
          if (pcv & 1) return this.replaySlow(pc0, start, nWords, mark);
          this.a[7] = (this.a[7] + 6) >>> 0;
          this.sr = (this.sr & ~SR_CCR) | (ccr & SR_CCR);
          this.pc = pcv >>> 0;
          if (this.isCpu32) this.instrTail = -2;
          if (this.fetchCost !== null) this.fetchCost(this.pc, 2);
          break;
        }
        case K.RTE: {
          if (!this.supervisor) return this.replaySlow(pc0, start, nWords, mark);
          const sp = this.a[7];
          const frameSr = this.readMem(sp, Size.Word);
          const pcv = this.readMem(sp + 2, Size.Long);
          const format = this.readMem(sp + 6, Size.Word) >> 12;
          if (format !== 0 || (pcv & 1)) return this.replaySlow(pc0, start, nWords, mark);
          this.a[7] = (sp + 8) >>> 0;
          this.setSR(frameSr);
          this.flowFast(pcv);
          break;
        }
        case K.MUL_W: {
          const raw = this.readOpFast(sx, sr, Size.Word, b, c);
          if (this.is68000) this.extraCycles += 2 * (flag1 ? M68000.transitionCount(raw) : M68000.onesCount(raw));
          if (flag1) {
            const v = Math.imul(M68000.signed(raw, Size.Word), M68000.signed(this.readD(dr, Size.Word), Size.Word));
            this.d[dr] = v >>> 0;
            this.logic(v, Size.Long);
          } else {
            const v = raw * this.readD(dr, Size.Word);
            this.d[dr] = v >>> 0;
            this.logic(v, Size.Long);
          }
          break;
        }
        case K.MUL_L: {
          const src = this.readOpFast(sx, sr, Size.Long, b, c);
          const signed = flag1 === 1;
          const a1 = BigInt(signed ? src | 0 : src >>> 0);
          const b1 = BigInt(signed ? this.d[dr] | 0 : this.d[dr] >>> 0);
          const p = a1 * b1;
          const low = Number(p & 0xffffffffn) >>> 0;
          this.d[dr] = low;
          this.setFlags(SR_N, (low & 0x80000000) !== 0);
          this.setFlags(SR_Z, low === 0);
          const fits = signed ? p >= -0x80000000n && p <= 0x7fffffffn : p <= 0xffffffffn;
          this.setFlags(SR_V, !fits);
          this.setFlags(SR_C, false);
          break;
        }
        case K.DIV_W: {
          const divisor = this.readOpFast(sx, sr, Size.Word, b, c);
          if (divisor === 0) {
            if (this.is68000) return this.undoAndReplay(pc0, start, nWords, mark);
            this.exception(VEC_DIVIDE_ZERO);
            break;
          }
          const signed = flag1 === 1;
          const dividend = signed ? this.d[dr] | 0 : this.d[dr] >>> 0;
          const div = signed ? M68000.signed(divisor, Size.Word) : divisor;
          const q = signed ? Math.trunc(dividend / div) : Math.floor(dividend / div);
          const r = dividend - q * div;
          const overflow = signed ? q < -0x8000 || q > 0x7fff : q > 0xffff;
          if (overflow) {
            if (this.is68000) this.extraCycles += signed ? 16 : 10;
            this.setFlags(SR_V, true);
            this.setFlags(SR_C, false);
            break;
          }
          if (this.is68000) this.extraCycles += signed ? 138 : 120;
          this.setFlags(SR_V | SR_C, false);
          this.setFlags(SR_N, (q & 0x8000) !== 0);
          this.setFlags(SR_Z, (q & 0xffff) === 0);
          this.d[dr] = (((r & 0xffff) << 16) | (q & 0xffff)) >>> 0;
          break;
        }
        case K.DIV_L: {
          const src = this.readOpFast(sx, sr, Size.Long, b, c);
          if (src === 0) {
            this.exception(VEC_DIVIDE_ZERO);
            break;
          }
          const signed = flag1 === 1;
          const remReg = aux;
          const divisor = BigInt(signed ? src | 0 : src >>> 0);
          const dividend = signed ? BigInt(this.d[dr] | 0) : BigInt(this.d[dr] >>> 0);
          const q = dividend / divisor;
          const r = dividend - q * divisor;
          const fits = signed ? q >= -0x80000000n && q <= 0x7fffffffn : q <= 0xffffffffn;
          if (!fits) {
            this.setFlags(SR_V, true);
            this.setFlags(SR_C, false);
            break;
          }
          this.storeDivL(q, r, dr, remReg);
          break;
        }
        case K.MOVEM: {
          const mask = b & 0xffff;
          const toRegs = flag1 === 1;
          const step = size;
          if (sx === XM_PD) {
            let addr = this.a[sr];
            for (let i = 0; i < 16; i++) {
              if (!(mask & (1 << i))) continue;
              const r = 15 - i;
              const v = r < 8 ? this.d[r] : this.a[r - 8];
              addr = (addr - step) >>> 0;
              this.writeMem(addr, size, v);
            }
            this.a[sr] = addr;
            break;
          }
          let addr = sx === XM_PI ? this.a[sr] : this.opAddrFast(sx, sr, c, 0);
          for (let i = 0; i < 16; i++) {
            if (!(mask & (1 << i))) continue;
            if (toRegs) {
              const v = this.readMem(addr, size);
              const full = size === Size.Word ? ((v << 16) >> 16) >>> 0 : v >>> 0;
              if (i < 8) this.d[i] = full;
              else this.a[i - 8] = full;
            } else {
              this.writeMem(addr, size, i < 8 ? this.d[i] : this.a[i - 8]);
            }
            addr = (addr + step) >>> 0;
          }
          if (sx === XM_PI) this.a[sr] = addr;
          break;
        }
        case K.LINK: {
          if (this.is68000) this.noteA(7);
          const sp = (this.a[7] - 4) >>> 0;
          this.a[7] = sp;
          this.writeMem(sp, Size.Long, this.a[sr]);
          this.a[sr] = sp;
          this.a[7] = (sp + b) >>> 0;
          break;
        }
        case K.UNLK: {
          const sp = this.a[sr];
          const v = this.readMem(sp, Size.Long);
          this.a[7] = (sp + 4) >>> 0;
          this.a[sr] = v;
          break;
        }
        case K.EXG: {
          if (aux === 0) {
            const t = this.d[dr]; this.d[dr] = this.d[sr]; this.d[sr] = t;
          } else if (aux === 1) {
            const t = this.a[dr]; this.a[dr] = this.a[sr]; this.a[sr] = t;
          } else {
            const t = this.d[dr]; this.d[dr] = this.a[sr]; this.a[sr] = t;
          }
          break;
        }
        case K.SR_IMM: {
          const toSr = flag1 === 1;
          if (toSr && !this.supervisor) return this.replaySlow(pc0, start, nWords, mark);
          const cur = toSr ? this.sr : this.sr & SR_CCR;
          const v = aux === 0 ? cur | b : aux === 1 ? cur & b : cur ^ b;
          if (toSr) this.setSR(v);
          else this.sr = (this.sr & ~SR_CCR) | (v & SR_CCR);
          break;
        }
        case K.MOVE_FROM_SR: {
          const v = flag1 ? this.sr & SR_CCR : this.sr;
          if (dx === XM_DN) this.writeD(dr, Size.Word, v);
          else {
            const addr = this.opAddrFast(dx, dr, c, 0);
            this.readMem(addr, Size.Word);
            this.writeMem(addr, Size.Word, v);
          }
          break;
        }
        case K.MOVE_TO_SR: {
          if (!flag1 && !this.supervisor) return this.replaySlow(pc0, start, nWords, mark);
          const v = this.readOpFast(sx, sr, Size.Word, b, c);
          if (flag1) this.sr = (this.sr & ~SR_CCR) | (v & SR_CCR);
          else this.setSR(v);
          break;
        }
        case K.TRAP:
          this.exception(b);
          break;
        case K.CHK: {
          const bound = M68000.signed(this.readOpFast(sx, sr, Size.Word, b, c), Size.Word);
          const v = M68000.signed(this.readD(dr, Size.Word), Size.Word);
          if (v < 0 || v > bound) {
            this.setFlags(SR_N, v < 0);
            this.exception(6);
          }
          break;
        }
      }
    } catch (e) {
      if (!this.is68000 || !(e instanceof AddressError)) throw e;
      return this.undoAndReplay(pc0, start, nWords, mark);
    }

    const cyc = page.cyc[o];
    if (this.isCpu32 || this.is68000) {
      const total = cyc + this.extraCycles;
      this.cycles = start + total;
      return total;
    }
    this.cycles = start + cyc;
    return cyc;
  }

  private noteA(reg: number): void {
    if (this.undoN === 0) { this.undoR0 = reg; this.undoV0 = this.a[reg]; }
    else { this.undoR1 = reg; this.undoV1 = this.a[reg]; }
    this.undoN++;
  }

  private undoAndReplay(pc0: number, start: number, nWords: number, mark: number): number {
    if (this.undoN > 1) this.a[this.undoR1] = this.undoV1;
    if (this.undoN > 0) this.a[this.undoR0] = this.undoV0;
    this.undoN = 0;
    this.sr = this.undoSr;
    return this.replaySlow(pc0, start, nWords, mark);
  }

  private replaySlow(pc0: number, start: number, nWords: number, mark = 0): number {
    if (this.penaltyRestore !== null) this.penaltyRestore(mark);
    else if (this.fetchCost !== null) this.fetchCost(pc0 + 4, -nWords);
    this.pc = pc0;
    this.seedOverlap(start);
    if (this.prefetchStale) this.refillPrefetch();
    return this.stepInterpret(start);
  }

  private flowFast(target: number): void {
    this.pc = target >>> 0;
    if (this.isCpu32) this.instrTail = -2;
    if (this.fetchCost !== null) this.fetchCost(this.pc, 2);
    if (this.regions !== null) this.regions.noteAddr(this.pc);
  }

  private readOpFast(x: number, reg: number, size: Size, payload: number, payload2: number): number {
    if (x === XM_DN) return this.readD(reg, size);
    if (x === XM_AN) return M68000.trunc(this.a[reg], size);
    if (x === XM_IMM) return size === Size.Long ? payload >>> 0 : payload;
    return this.readMem(this.opAddrFast(x, reg, payload, payload2), size);
  }

  private opAddrFast(x: number, reg: number, payload: number, payload2: number): number {
    switch (x) {
      case 2: return this.a[reg];
      case XM_PI: {
        const addr = this.a[reg];
        if (this.is68000) this.noteA(reg);
        this.a[reg] = (addr + payload) >>> 0;
        return addr;
      }
      case XM_PD: {
        const addr = (this.a[reg] - payload) >>> 0;
        if (this.is68000) this.noteA(reg);
        this.a[reg] = addr;
        return addr;
      }
      case 5: return (this.a[reg] + payload) >>> 0;
      case 6: return this.briefFast(this.a[reg], payload);
      case XM_PCIX: return this.briefFast(payload2 >>> 0, payload);
      default: return payload >>> 0;
    }
  }

  private briefFast(base: number, p: number): number {
    const reg = (p >>> 16) & 15;
    const raw = reg < 8 ? this.d[reg] : this.a[reg - 8];
    const index = p & 0x100000 ? raw | 0 : (raw << 16) >> 16;
    const scale = (p >>> 21) & 3;
    const disp = (p << 24) >> 24;
    return (base + (index << scale) + disp) >>> 0;
  }

  private execute(op: number): void {
    switch (op >> 12) {
      case 0x0: this.group0(op); return;
      case 0x1: this.move(op, Size.Byte); return;
      case 0x2: this.move(op, Size.Long); return;
      case 0x3: this.move(op, Size.Word); return;
      case 0x4: this.group4(op); return;
      case 0x5: this.group5(op); return;
      case 0x6: this.branch(op); return;
      case 0x7: this.moveq(op); return;
      case 0x8: this.group8(op); return;
      case 0x9: this.groupSub(op); return;
      case 0xa: this.unimplemented(op, VEC_LINE_A); return;
      case 0xb: this.groupB(op); return;
      case 0xc: this.groupC(op); return;
      case 0xd: this.groupAdd(op); return;
      case 0xe: this.groupShift(op); return;
      case 0xf:
        if (this.variant === 'cpu32' && (op & 0xffc0) === 0xf800 && this.tbl(op)) return;
        this.unimplemented(op, VEC_LINE_F);
        return;
      default: this.illegal(op);
    }
  }

  private static eaBit(mode: number, reg: number): number {
    if (mode < 7) return EA_DN >> mode;
    return [EA_AW, EA_AL, EA_PCDI, EA_PCIX, EA_IMM][reg] ?? 0;
  }

  private badEa(op: number, mode: number, reg: number, allowed: number): boolean {
    if ((M68000.eaBit(mode, reg) & allowed) !== 0) return false;
    this.illegal(op);
    return true;
  }

  private static sizeOf(bits: number): Size | null {
    return bits === 0 ? Size.Byte : bits === 1 ? Size.Word : bits === 2 ? Size.Long : null;
  }

  private rmwEA(mode: number, reg: number, size: Size, fn: (v: number) => number): void {
    if (mode === 0) {
      this.writeD(reg, size, fn(this.readD(reg, size)));
      return;
    }
    if (mode === 1) {
      this.a[reg] = fn(this.a[reg]) >>> 0;
      return;
    }
    const addr = this.effectiveAddress(mode, reg, size, false);
    this.writeMem(addr, size, fn(this.readMem(addr, size)));
  }

  private static onesCount(v: number): number {
    let n = 0;
    for (let i = 0; i < 16; i++) if (v & (1 << i)) n++;
    return n;
  }

  private static transitionCount(v: number): number {
    let n = 0;
    let prev = 0;
    for (let i = 0; i < 16; i++) {
      const bit = (v >> i) & 1;
      if (bit !== prev) n++;
      prev = bit;
    }
    return n;
  }

  private static msb(size: Size): number {
    return size === Size.Byte ? 0x80 : size === Size.Word ? 0x8000 : 0x80000000;
  }

  private addFlags(s: number, d: number, r: number, size: Size, keepZ = false): number {
    const m = M68000.mask(size);
    const msb = M68000.msb(size);
    const res = M68000.trunc(r, size);
    const carry = r > m || r < 0;
    this.setFlags(SR_C | SR_X, carry);
    this.setFlags(SR_V, ((s ^ res) & (d ^ res) & msb) !== 0);
    this.setFlags(SR_N, (res & msb) !== 0);
    if (keepZ) {
      if (res !== 0) this.setFlags(SR_Z, false);
    } else {
      this.setFlags(SR_Z, res === 0);
    }
    return res;
  }

  private subFlags(s: number, d: number, r: number, size: Size, keepZ = false): number {
    const msb = M68000.msb(size);
    const res = M68000.trunc(r, size);
    this.setFlags(SR_C | SR_X, r < 0);
    this.setFlags(SR_V, ((s ^ d) & (d ^ res) & msb) !== 0);
    this.setFlags(SR_N, (res & msb) !== 0);
    if (keepZ) {
      if (res !== 0) this.setFlags(SR_Z, false);
    } else {
      this.setFlags(SR_Z, res === 0);
    }
    return res;
  }

  private cmpFlags(s: number, d: number, size: Size): void {
    const msb = M68000.msb(size);
    const r = d - s;
    const res = M68000.trunc(r, size);
    this.setFlags(SR_C, r < 0);
    this.setFlags(SR_V, ((s ^ d) & (d ^ res) & msb) !== 0);
    this.setFlags(SR_N, (res & msb) !== 0);
    this.setFlags(SR_Z, res === 0);
  }

  private testCC(cc: number): boolean {
    const n = (this.sr & SR_N) !== 0;
    const z = (this.sr & SR_Z) !== 0;
    const v = (this.sr & SR_V) !== 0;
    const c = (this.sr & SR_C) !== 0;
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
      case 0xc: return n === v;
      case 0xd: return n !== v;
      case 0xe: return !z && n === v;
      default: return z || n !== v;
    }
  }

  private jump(addr: number): void {
    if (this.isCpu32) this.instrTail = -2;
    this.checkJump(addr);
    this.pc = addr >>> 0;
    this.fillPrefetch();
  }

  private checkJump(addr: number): void {
    if (addr & 1) throw new AddressError(addr >>> 0, false, true);
  }

  private group0(op: number): void {
    const mode = (op >> 3) & 7;
    const reg = op & 7;

    if (op & 0x0100) {
      if (mode === 1) {
        this.movep(op);
        return;
      }
      if (this.badEa(op, mode, reg, (op & 0x00c0) === 0 ? EA_DATA : EA_DATA_ALT)) return;
      this.bitOp(op, (op >> 9) & 7, mode, reg, false);
      return;
    }

    if ((op & 0x0f00) === 0x0800) {
      if (this.badEa(op, mode, reg, (op & 0x00c0) === 0 ? EA_DATA_NO_IMM : EA_DATA_ALT)) return;
      this.bitOp(op, -1, mode, reg, true);
      return;
    }

    const sizeBits = (op >> 6) & 3;
    const size = M68000.sizeOf(sizeBits);
    if (size === null) {
      if (this.variant === 'cpu32' && (op & 0xf9c0) === 0x00c0 && ((op >> 9) & 3) !== 3) {
        this.cmp2chk2(op, mode, reg);
        return;
      }
      this.illegal(op);
      return;
    }

    const kind = (op >> 9) & 7;
    if (kind === 7) {
      if (this.variant === 'cpu32') this.moves(op, size, mode, reg);
      else this.illegal(op);
      return;
    }

    if (mode === 7 && reg === 4 && (kind === 0 || kind === 1 || kind === 5)) {
      if (size === Size.Long) {
        this.illegal(op);
        return;
      }
      const toSr = size === Size.Word;
      if (toSr && !this.supervisor) {
        this.privilegeViolation();
        return;
      }
      const imm = this.fetch();
      const cur = toSr ? this.sr : this.sr & SR_CCR;
      const v = kind === 0 ? cur | imm : kind === 1 ? cur & imm : cur ^ imm;
      if (toSr) this.setSR(v);
      else this.sr = (this.sr & ~SR_CCR) | (v & SR_CCR);
      this.cycles += 20;
      return;
    }

    if (this.badEa(op, mode, reg, EA_DATA_ALT)) return;

    const imm = this.readEA(7, 4, size);

    if (kind === 6) {
      this.cmpFlags(imm, this.readEA(mode, reg, size), size);
      this.cycles += mode === 0 && size === Size.Long ? 6 : 4;
      return;
    }

    this.rmwEA(mode, reg, size, (d) => {
      switch (kind) {
        case 0: return this.logic(d | imm, size);
        case 1: return this.logic(d & imm, size);
        case 2: return this.subFlags(imm, d, d - imm, size);
        case 3: return this.addFlags(imm, d, d + imm, size);
        case 5: return this.logic(d ^ imm, size);
        default: return d;
      }
    });
    this.cycles +=
      mode === 0 ? (size === Size.Long ? 8 : 4) : (size === Size.Long ? 12 : 8);
  }

  private logic(v: number, size: Size): number {
    const res = M68000.trunc(v, size);
    this.setFlags(SR_N, (res & M68000.msb(size)) !== 0);
    this.setFlags(SR_Z, res === 0);
    this.setFlags(SR_V | SR_C, false);
    return res;
  }

  private bitOp(op: number, srcReg: number, mode: number, reg: number, immediate: boolean): void {
    const kind = (op >> 6) & 3;
    const bitNo = immediate ? this.fetch() & 0xff : this.d[srcReg];
    const size = mode === 0 ? Size.Long : Size.Byte;
    const bit = 1 << (bitNo & (mode === 0 ? 31 : 7));

    const toRegister = mode === 0;
    const extra = immediate ? 4 : 0;

    if (kind === 0) {
      const v = this.readEA(mode, reg, size);
      this.setFlags(SR_Z, (v & bit) === 0);
      this.cycles += (toRegister ? 6 : 4) + extra;
      return;
    }

    this.rmwEA(mode, reg, size, (v) => {
      this.setFlags(SR_Z, (v & bit) === 0);
      if (kind === 1) return v ^ bit;
      if (kind === 2) return v & ~bit;
      return v | bit;
    });
    this.cycles += (toRegister && kind === 2 ? 10 : 8) + extra;
  }

  private movep(op: number): void {
    const dreg = (op >> 9) & 7;
    const areg = op & 7;
    const long = (op & 0x0040) !== 0;
    const toMem = (op & 0x0080) !== 0;
    const addr = (this.a[areg] + ((this.fetch() << 16) >> 16)) >>> 0;
    const n = long ? 4 : 2;

    if (toMem) {
      for (let i = 0; i < n; i++) {
        const shift = (n - 1 - i) * 8;
        this.bus.write8(this.busAddr(addr + i * 2), (this.d[dreg] >>> shift) & 0xff);
      }
    } else {
      let v = 0;
      for (let i = 0; i < n; i++) v = (v << 8) | this.bus.read8(this.busAddr(addr + i * 2));
      this.writeD(dreg, long ? Size.Long : Size.Word, v);
    }
    this.cycles += long ? 24 : 16;
  }

  private group4(op: number): void {
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    const sizeBits = (op >> 6) & 3;

    if (op === 0x4afc) {
      this.illegal(op);
      return;
    }

    if ((op & 0xfff8) === 0x49c0 && this.variant !== '68000') {
      const v = (this.d[reg] << 24) >> 24;
      this.d[reg] = v >>> 0;
      this.logic(v, Size.Long);
      this.cycles += 4;
      return;
    }

    if ((op & 0xf1c0) === 0x41c0) {
      if (this.badEa(op, mode, reg, EA_CONTROL)) return;
      const before = this.cycles;
      this.a[(op >> 9) & 7] = this.effectiveAddress(mode, reg, Size.Word, false) >>> 0;
      this.cycles = before + M68000.controlCost(M68000.LEA_CYCLES, mode, reg);
      return;
    }
    if ((op & 0xf1c0) === 0x4180) {
      if (this.badEa(op, mode, reg, EA_DATA)) return;
      const bound = M68000.signed(this.readEA(mode, reg, Size.Word), Size.Word);
      const v = M68000.signed(this.readD((op >> 9) & 7, Size.Word), Size.Word);
      this.cycles += 10;
      if (v < 0 || v > bound) {
        this.setFlags(SR_N, v < 0);
        this.exception(6);
      }
      return;
    }

    if ((op & 0xffc0) === 0x40c0) {
      if (this.badEa(op, mode, reg, EA_DATA_ALT)) return;
      this.rmwEA(mode, reg, Size.Word, () => this.sr);
      this.cycles += mode === 0 ? 6 : 8;
      return;
    }
    if ((op & 0xffc0) === 0x42c0 && this.variant !== '68000') {
      if (this.badEa(op, mode, reg, EA_DATA_ALT)) return;
      this.rmwEA(mode, reg, Size.Word, () => this.sr & SR_CCR);
      this.cycles += 4;
      return;
    }
    if ((op & 0xffc0) === 0x44c0) {
      if (this.badEa(op, mode, reg, EA_DATA)) return;
      this.sr = (this.sr & ~SR_CCR) | (this.readEA(mode, reg, Size.Word) & SR_CCR);
      this.cycles += 12;
      return;
    }
    if ((op & 0xffc0) === 0x46c0) {
      if (this.badEa(op, mode, reg, EA_DATA)) return;
      if (!this.supervisor) {
        this.privilegeViolation();
        return;
      }
      this.setSR(this.readEA(mode, reg, Size.Word));
      this.cycles += 12;
      return;
    }

    switch (op & 0xff00) {
      case 0x4000:
      case 0x4400: {
        const size = M68000.sizeOf(sizeBits);
        if (size === null) break;
        if (this.badEa(op, mode, reg, EA_DATA_ALT)) return;
        const x = op & 0x0400 ? 0 : this.sr & SR_X ? 1 : 0;
        const keepZ = (op & 0xff00) === 0x4000;
        this.rmwEA(mode, reg, size, (d) => this.subFlags(d, 0, -d - x, size, keepZ));
        this.cycles += M68000.rmwBase(size, mode);
        return;
      }
      case 0x4200: {
        const size = M68000.sizeOf(sizeBits);
        if (size === null) break;
        if (this.badEa(op, mode, reg, EA_DATA_ALT)) return;
        this.rmwEA(mode, reg, size, () => 0);
        this.setFlags(SR_N | SR_V | SR_C, false);
        this.setFlags(SR_Z, true);
        this.cycles += M68000.rmwBase(size, mode);
        return;
      }
      case 0x4600: {
        const size = M68000.sizeOf(sizeBits);
        if (size === null) break;
        if (this.badEa(op, mode, reg, EA_DATA_ALT)) return;
        this.rmwEA(mode, reg, size, (d) => this.logic(~d, size));
        this.cycles += M68000.rmwBase(size, mode);
        return;
      }
      case 0x4a00: {
        const wide = this.variant !== '68000' && sizeBits !== 3
          && sizeBits !== 0;
        if (this.badEa(op, mode, reg, wide ? EA_ALL : EA_DATA_ALT)) return;
        if (sizeBits === 3) {
          this.rmwEA(mode, reg, Size.Byte, (d) => {
            this.logic(d, Size.Byte);
            return d | 0x80;
          });
          this.cycles += 4;
          return;
        }
        const size = M68000.sizeOf(sizeBits);
        if (size === null) break;
        this.logic(this.readEA(mode, reg, size), size);
        this.cycles += 4;
        return;
      }
    }

    if ((op & 0xfff8) === 0x4840) {
      const v = this.d[reg];
      this.d[reg] = (((v << 16) | (v >>> 16)) >>> 0);
      this.logic(this.d[reg], Size.Long);
      this.cycles += 4;
      return;
    }
    if ((op & 0xffc0) === 0x4840) {
      if (this.badEa(op, mode, reg, EA_CONTROL)) return;
      const before = this.cycles;
      const addr = this.effectiveAddress(mode, reg, Size.Word, false);
      this.cycles = before + M68000.controlCost(M68000.PEA_CYCLES, mode, reg);
      this.pushLong(addr);
      return;
    }
    if ((op & 0xffb8) === 0x4880) {
      const long = (op & 0x0040) !== 0;
      const v = long
        ? (this.d[reg] << 16) >> 16
        : (this.d[reg] << 24) >> 24;
      this.writeD(reg, long ? Size.Long : Size.Word, v);
      this.logic(v, long ? Size.Long : Size.Word);
      this.cycles += 4;
      return;
    }
    if ((op & 0xfff8) === 0x4808 && this.variant === 'cpu32') {
      const disp = this.fetchLong();
      const sp = (this.a[7] - 4) >>> 0;
      this.a[7] = sp;
      this.writeMem(sp, Size.Long, this.a[reg]);
      this.a[reg] = sp;
      this.a[7] = (sp + disp) >>> 0;
      this.cycles += 18;
      return;
    }
    if ((op & 0xffc0) === 0x4800) {
      if (this.badEa(op, mode, reg, EA_DATA_ALT)) return;
      this.rmwEA(mode, reg, Size.Byte, (d) => this.bcdSub(0, d));
      this.cycles += 6;
      return;
    }
    if ((op & 0xffc0) === 0x4c00 && this.variant !== '68000') {
      this.mulLong(op, mode, reg);
      return;
    }
    if ((op & 0xffc0) === 0x4c40 && this.variant !== '68000') {
      this.divLong(op, mode, reg);
      return;
    }
    if ((op & 0xfb80) === 0x4880) {
      this.movem(op);
      return;
    }

    switch (op) {
      case 0x4e70: {
        if (!this.supervisor) {
          this.privilegeViolation();
          return;
        }
        this.onResetInstruction?.();
        const cost = this.isCpu32 ? 518 : 132;
        this.cycles += cost;
        this.extraCycles += cost;
        return;
      }
      case 0x4e71: this.cycles += 4; return;
      case 0x4e72: {
        const sr = this.fetch();
        if (!this.supervisor) {
          this.privilegeViolation();
          return;
        }
        this.setSR(sr);
        this.halted = true;
        this.cycles += 4;
        return;
      }
      case 0x4e73: {
        if (!this.supervisor) {
          this.privilegeViolation();
          return;
        }
        if (this.variant === 'coldfire') {
          this.rteColdfire();
          return;
        }
        if (this.variant === 'cpu32') {
          this.rteCpu32();
          return;
        }
        const sr = this.readMem(this.a[7], Size.Word);
        this.a[7] = (this.a[7] + 2) >>> 0;
        const pc = this.readMem(this.a[7], Size.Long);
        this.a[7] = (this.a[7] + 4) >>> 0;
        this.setSR(sr);
        this.jump(pc);
        this.cycles += 20;
        return;
      }
      case 0x4e74: {
        if (this.variant === '68000') break;
        const disp = (this.fetch() << 16) >> 16;
        const pc = this.readMem(this.a[7], Size.Long);
        this.a[7] = (this.a[7] + 4 + disp) >>> 0;
        this.jump(pc);
        this.cycles += 16;
        return;
      }
      case 0x4e75: {
        const pc = this.readMem(this.a[7], Size.Long);
        this.a[7] = (this.a[7] + 4) >>> 0;
        this.jump(pc);
        this.cycles += 16;
        return;
      }
      case 0x4e76:
        this.cycles += 4;
        if (this.sr & SR_V) this.exception(7);
        return;
      case 0x4e77: {
        const ccr = this.readMem(this.a[7], Size.Word);
        this.a[7] = (this.a[7] + 2) >>> 0;
        const pc = this.readMem(this.a[7], Size.Long);
        this.a[7] = (this.a[7] + 4) >>> 0;
        this.sr = (this.sr & ~SR_CCR) | (ccr & SR_CCR);
        this.jump(pc);
        this.cycles += 20;
        return;
      }
    }

    if ((op & 0xfff0) === 0x4e40) {
      this.exception(32 + (op & 0x0f));
      return;
    }
    if ((op & 0xfff8) === 0x4e50) {
      const disp = (this.fetch() << 16) >> 16;
      const sp = (this.a[7] - 4) >>> 0;
      this.a[7] = sp;
      this.writeMem(sp, Size.Long, this.a[reg]);
      this.a[reg] = sp;
      this.a[7] = (sp + disp) >>> 0;
      this.cycles += 16;
      return;
    }
    if ((op & 0xfff8) === 0x4e58) {
      const sp = this.a[reg];
      const v = this.readMem(sp, Size.Long);
      this.a[7] = (sp + 4) >>> 0;
      this.a[reg] = v;
      this.cycles += 12;
      return;
    }
    if ((op & 0xfff0) === 0x4e60) {
      if (!this.supervisor) {
        this.privilegeViolation();
        return;
      }
      if (op & 0x0008) this.a[reg] = this.usp;
      else this.usp = this.a[reg];
      this.cycles += 4;
      return;
    }
    if ((op & 0xffc0) === 0x4e80) {
      if (this.badEa(op, mode, reg, EA_CONTROL)) return;
      const before = this.cycles;
      const addr = this.effectiveAddress(mode, reg, Size.Word, false);
      this.cycles = before + M68000.controlCost(M68000.JSR_CYCLES, mode, reg);
      this.checkJump(addr);
      this.pushLong(this.pc);
      this.jump(addr);
      return;
    }
    if ((op & 0xffc0) === 0x4ec0) {
      if (this.badEa(op, mode, reg, EA_CONTROL)) return;
      const before = this.cycles;
      const addr = this.effectiveAddress(mode, reg, Size.Word, false);
      this.cycles = before + M68000.controlCost(M68000.JMP_CYCLES, mode, reg);
      this.jump(addr);
      return;
    }
    if ((op & 0xfffe) === 0x4e7a && this.variant !== '68000') {
      this.movec(op);
      return;
    }

    this.illegal(op);
  }

  private movec(op: number): void {
    if (!this.supervisor) {
      this.privilegeViolation();
      return;
    }
    const toControl = (op & 1) !== 0;
    if (this.variant === 'coldfire' && !toControl) {
      this.illegal(op);
      return;
    }
    const ext = this.fetch();
    const rn = (ext >> 12) & 7;
    const regs = ext & 0x8000 ? this.a : this.d;
    const rc = ext & 0xfff;
    this.cycles += 12;

    if (!toControl) {
      switch (rc) {
        case CR_SFC: regs[rn] = this.sfc; return;
        case CR_DFC: regs[rn] = this.dfc; return;
        case CR_USP: regs[rn] = this.usp; return;
        case CR_VBR: regs[rn] = this.vbr; return;
        default: this.illegal(op); return;
      }
    }

    const v = regs[rn] >>> 0;
    if (this.variant === 'cpu32') {
      switch (rc) {
        case CR_SFC: this.sfc = v & 7; break;
        case CR_DFC: this.dfc = v & 7; break;
        case CR_USP: this.usp = v; break;
        case CR_VBR: this.vbr = v; break;
        default: this.illegal(op); return;
      }
    } else {
      switch (rc) {
        case CR_VBR: this.vbr = v & 0xfff00000; break;
        case CR_CACR: this.cacr = v; break;
        case CR_ACR0: this.acr0 = v; break;
        case CR_ACR1: this.acr1 = v; break;
        case CR_RAMBAR: this.rambar = v; break;
        case CR_MBAR: this.mbar = v; break;
        default: this.illegal(op); return;
      }
    }
    this.onControlReg?.(rc, v);
  }

  private moves(op: number, size: Size, mode: number, reg: number): void {
    if (this.badEa(op, mode, reg, EA_MEM_ALT)) return;
    if (!this.supervisor) {
      this.privilegeViolation();
      return;
    }
    const ext = this.fetch();
    const rn = (ext >> 12) & 7;
    const isAddr = (ext & 0x8000) !== 0;
    const toMem = (ext & 0x0800) !== 0;
    const addr = this.effectiveAddress(mode, reg, size, toMem);
    if (toMem) {
      const v = isAddr ? M68000.trunc(this.a[rn], size) : this.readD(rn, size);
      this.writeMem(addr, size, v, this.dfc);
    } else {
      const v = this.readMem(addr, size, this.sfc);
      if (isAddr) this.a[rn] = M68000.signed(v, size) >>> 0;
      else this.writeD(rn, size, v);
    }
    this.cycles += 18;
  }

  private mulLong(op: number, mode: number, reg: number): void {
    if (this.badEa(op, mode, reg, EA_DATA)) return;
    const ext = this.fetch();
    const dl = (ext >> 12) & 7;
    const isSigned = (ext & 0x0800) !== 0;
    const wide = (ext & 0x0400) !== 0;
    const dh = ext & 7;
    if (wide && this.variant !== 'cpu32') {
      this.illegal(op);
      return;
    }
    const src = this.readEA(mode, reg, Size.Long);
    const a = BigInt(isSigned ? src | 0 : src >>> 0);
    const b = BigInt(isSigned ? this.d[dl] | 0 : this.d[dl] >>> 0);
    const p = a * b;
    const low = Number(p & 0xffffffffn) >>> 0;
    this.d[dl] = low;
    if (wide) {
      const high = Number((p >> 32n) & 0xffffffffn) >>> 0;
      this.d[dh] = high;
      this.setFlags(SR_N, (high & 0x80000000) !== 0);
      this.setFlags(SR_Z, p === 0n);
      this.setFlags(SR_V | SR_C, false);
    } else {
      this.setFlags(SR_N, (low & 0x80000000) !== 0);
      this.setFlags(SR_Z, low === 0);
      const fits = isSigned ? p >= -0x80000000n && p <= 0x7fffffffn : p <= 0xffffffffn;
      this.setFlags(SR_V, !fits);
      this.setFlags(SR_C, false);
    }
    this.cycles += 44;
  }

  private divLong(op: number, mode: number, reg: number): void {
    if (this.badEa(op, mode, reg, EA_DATA)) return;
    const ext = this.fetch();
    const dq = (ext >> 12) & 7;
    const isSigned = (ext & 0x0800) !== 0;
    const wide = (ext & 0x0400) !== 0;
    const dr = ext & 7;
    if (wide && this.variant !== 'cpu32') {
      this.illegal(op);
      return;
    }
    const src = this.readEA(mode, reg, Size.Long);
    if (src === 0) {
      this.exception(VEC_DIVIDE_ZERO);
      return;
    }
    const divisor = BigInt(isSigned ? src | 0 : src >>> 0);
    const low = BigInt(this.d[dq] >>> 0);
    const dividend = wide
      ? (BigInt(isSigned ? this.d[dr] | 0 : this.d[dr] >>> 0) << 32n) | low
      : isSigned ? BigInt(this.d[dq] | 0) : low;
    const q = dividend / divisor;
    const r = dividend - q * divisor;
    this.cycles += 90;
    const fits = isSigned ? q >= -0x80000000n && q <= 0x7fffffffn : q <= 0xffffffffn;
    if (!fits) {
      this.setFlags(SR_V, true);
      this.setFlags(SR_C, false);
      return;
    }
    this.storeDivL(q, r, dq, dr);
  }

  private rteCpu32(): void {
    for (;;) {
      const sp = this.a[7];
      const sr = this.readMem(sp, Size.Word);
      const pc = this.readMem(sp + 2, Size.Long);
      const format = this.readMem(sp + 6, Size.Word) >> 12;
      if (format === 1) {
        this.a[7] = (sp + 8) >>> 0;
        this.setSR(sr);
        continue;
      }
      if (format === 0 || format === 2) {
        this.a[7] = (sp + (format === 2 ? 12 : 8)) >>> 0;
        this.setSR(sr);
        this.jump(pc);
        break;
      }
      this.pc = this.savedPc;
      this.exception(VEC_FORMAT_ERROR);
      break;
    }
    this.cycles += 20;
  }

  private rteColdfire(): void {
    const sp = this.a[7];
    const fvs = this.readMem(sp, Size.Long);
    const pc = this.readMem(sp + 4, Size.Long);
    const format = (fvs >>> 28) & 0xf;
    this.a[7] = (sp + 8 + (format & 3)) >>> 0;
    this.setSR(fvs & 0xffff);
    this.jump(pc);
    this.cycles += 20;
  }

  private movem(op: number): void {
    const toRegs = (op & 0x0400) !== 0;
    const size = op & 0x0040 ? Size.Long : Size.Word;
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    if (this.badEa(op, mode, reg, toRegs ? EA_CONTROL_PI : EA_CONTROL_PD)) return;

    const before = this.cycles;
    const mask = this.fetch();
    const step = size;

    let registers = 0;
    for (let i = 0; i < 16; i++) if (mask & (1 << i)) registers++;
    const setup = toRegs
      ? M68000.controlCost(M68000.MOVEM_TO_REG, mode, reg)
      : M68000.controlCost(M68000.MOVEM_TO_MEM, mode, reg);
    const total = setup + registers * (size === Size.Long ? 8 : 4);
    if (this.isCpu32) this.extraCycles += registers * 4;
    const charge = () => {
      this.cycles = before + total;
    };

    if (mode === 4) {
      let addr = this.a[reg];
      for (let i = 0; i < 16; i++) {
        if (!(mask & (1 << i))) continue;
        const r = 15 - i;
        const v = r < 8 ? this.d[r] : this.a[r - 8];
        addr = (addr - step) >>> 0;
        this.writeMem(addr, size, v);
      }
      this.a[reg] = addr;
      charge();
      return;
    }

    if (mode === 3 && toRegs) {
      let addr = this.a[reg];
      for (let i = 0; i < 16; i++) {
        if (!(mask & (1 << i))) continue;
        const v = this.readMem(addr, size);
        const full = size === Size.Word ? ((v << 16) >> 16) >>> 0 : v >>> 0;
        if (i < 8) this.d[i] = full;
        else this.a[i - 8] = full;
        addr = (addr + step) >>> 0;
      }
      this.a[reg] = addr;
      charge();
      return;
    }

    let addr = this.effectiveAddress(mode, reg, size, !toRegs);
    for (let i = 0; i < 16; i++) {
      if (!(mask & (1 << i))) continue;
      if (toRegs) {
        const v = this.readMem(addr, size);
        const full = size === Size.Word ? ((v << 16) >> 16) >>> 0 : v >>> 0;
        if (i < 8) this.d[i] = full;
        else this.a[i - 8] = full;
      } else {
        this.writeMem(addr, size, i < 8 ? this.d[i] : this.a[i - 8]);
      }
      addr = (addr + step) >>> 0;
    }
    charge();
  }

  private group5(op: number): void {
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    const sizeBits = (op >> 6) & 3;

    if (sizeBits === 3) {
      const cc = (op >> 8) & 0x0f;
      if (mode === 1) {
        const disp = (this.fetch() << 16) >> 16;
        const target = (this.pc + disp - 2) >>> 0;
        if (this.testCC(cc)) {
          this.cycles += 12;
          return;
        }
        const next = (this.readD(reg, Size.Word) - 1) & 0xffff;
        this.writeD(reg, Size.Word, next);
        if (next !== 0xffff) {
          if (this.isCpu32) this.instrHead = 6;
          this.jump(target);
          this.cycles += 10;
        } else {
          if (this.isCpu32) this.instrHead = 2;
          this.cycles += 14;
          if (this.isCpu32) this.extraCycles += 4;
        }
        return;
      }
      if (this.badEa(op, mode, reg, EA_DATA_ALT)) return;
      const taken = this.testCC(cc);
      this.rmwEA(mode, reg, Size.Byte, () => (taken ? 0xff : 0x00));
      this.cycles += mode === 0 ? (taken ? 6 : 4) : 8;
      return;
    }

    const size = M68000.sizeOf(sizeBits);
    if (size === null) {
      this.illegal(op);
      return;
    }
    if (this.badEa(op, mode, reg, size === Size.Byte ? EA_DATA_ALT : EA_ALTERABLE)) return;
    const imm = ((op >> 9) & 7) || 8;

    if (mode === 1) {
      this.a[reg] =
        (op & 0x0100 ? this.a[reg] - imm : this.a[reg] + imm) >>> 0;
      this.cycles += 8;
      return;
    }

    this.rmwEA(mode, reg, size, (d) =>
      op & 0x0100
        ? this.subFlags(imm, d, d - imm, size)
        : this.addFlags(imm, d, d + imm, size),
    );
    this.cycles += 4;
  }

  private branch(op: number): void {
    const cc = (op >> 8) & 0x0f;
    let disp = (op << 24) >> 24;
    const base = this.pc;
    if ((op & 0xff) === 0x00) disp = (this.fetch() << 16) >> 16;

    if (cc === 1) {
      this.pushLong(this.pc);
      this.jump((base + disp) >>> 0);
      this.cycles += 18;
      return;
    }
    const wordDisp = (op & 0xff) === 0x00;
    if (this.testCC(cc)) {
      if (this.isCpu32) this.instrHead = 2;
      this.jump((base + disp) >>> 0);
      this.cycles += 10;
      return;
    }
    this.cycles += wordDisp ? 12 : 8;
    if (this.isCpu32 && !wordDisp) this.extraCycles -= 2;
  }

  private moveq(op: number): void {
    if (op & 0x0100) {
      this.illegal(op);
      return;
    }
    const v = ((op & 0xff) << 24) >> 24;
    this.d[(op >> 9) & 7] = v >>> 0;
    this.logic(v, Size.Long);
    this.cycles += 4;
  }

  private group8(op: number): void {
    const dreg = (op >> 9) & 7;
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    const sizeBits = (op >> 6) & 3;

    if ((op & 0x01c0) === 0x00c0) {
      if (this.badEa(op, mode, reg, EA_DATA)) return;
      this.divide(op, false);
      return;
    }
    if ((op & 0x01c0) === 0x01c0) {
      if (this.badEa(op, mode, reg, EA_DATA)) return;
      this.divide(op, true);
      return;
    }
    if ((op & 0x01f0) === 0x0100) {
      this.bcdOp(op, true);
      return;
    }

    const size = M68000.sizeOf(sizeBits);
    if (size === null) {
      this.illegal(op);
      return;
    }
    const toMemory = (op & 0x0100) !== 0;
    if (this.badEa(op, mode, reg, toMemory ? EA_MEM_ALT : EA_DATA)) return;
    if (toMemory) {
      const v = this.readD(dreg, size);
      this.rmwEA(mode, reg, size, (d) => this.logic(d | v, size));
    } else {
      const v = this.readEA(mode, reg, size);
      this.writeD(dreg, size, this.logic(this.readD(dreg, size) | v, size));
    }
    this.cycles += M68000.aluBase(toMemory, size, mode, reg);
  }

  private divide(op: number, signed: boolean): void {
    const dreg = (op >> 9) & 7;
    const divisor = this.readEA((op >> 3) & 7, op & 7, Size.Word);

    if (divisor === 0) {
      this.exception(5);
      return;
    }

    const dividend = signed ? this.d[dreg] | 0 : this.d[dreg] >>> 0;
    const div = signed ? M68000.signed(divisor, Size.Word) : divisor;
    const q = signed ? Math.trunc(dividend / div) : Math.floor(dividend / div);
    const r = dividend - q * div;

    const overflow = signed ? q < -0x8000 || q > 0x7fff : q > 0xffff;
    if (overflow) {
      this.cycles += signed ? 16 : 10;
      this.setFlags(SR_V, true);
      this.setFlags(SR_C, false);
      return;
    }
    this.cycles += signed ? 138 : 120;

    this.setFlags(SR_V | SR_C, false);
    this.setFlags(SR_N, (q & 0x8000) !== 0);
    this.setFlags(SR_Z, (q & 0xffff) === 0);
    this.d[dreg] = (((r & 0xffff) << 16) | (q & 0xffff)) >>> 0;
  }

  private groupSub(op: number): void {
    this.addSub(op, true);
  }

  private groupAdd(op: number): void {
    this.addSub(op, false);
  }

  private addSub(op: number, isSub: boolean): void {
    const dreg = (op >> 9) & 7;
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    const sizeBits = (op >> 6) & 3;

    if (sizeBits === 3) {
      const size = op & 0x0100 ? Size.Long : Size.Word;
      if (this.badEa(op, mode, reg, EA_ALL)) return;
      const raw = this.readEA(mode, reg, size);
      const v = size === Size.Word ? (raw << 16) >> 16 : raw;
      this.a[dreg] = (isSub ? this.a[dreg] - v : this.a[dreg] + v) >>> 0;
      const fromRegisterOrImmediate = mode === 0 || mode === 1 || (mode === 7 && reg === 4);
      this.cycles += size === Size.Word || fromRegisterOrImmediate ? 8 : 6;
      return;
    }

    const size = M68000.sizeOf(sizeBits);
    if (size === null) {
      this.illegal(op);
      return;
    }

    if ((op & 0x0130) === 0x0100) {
      this.addSubX(op, isSub, size);
      return;
    }

    const toMemory = (op & 0x0100) !== 0;
    if (this.badEa(op, mode, reg, toMemory ? EA_MEM_ALT : size === Size.Byte ? EA_DATA : EA_ALL)) {
      return;
    }
    if (toMemory) {
      const v = this.readD(dreg, size);
      this.rmwEA(mode, reg, size, (d) =>
        isSub ? this.subFlags(v, d, d - v, size) : this.addFlags(v, d, d + v, size),
      );
    } else {
      const v = this.readEA(mode, reg, size);
      const d = this.readD(dreg, size);
      this.writeD(
        dreg,
        size,
        isSub ? this.subFlags(v, d, d - v, size) : this.addFlags(v, d, d + v, size),
      );
    }
    this.cycles += M68000.aluBase(toMemory, size, mode, reg);
  }

  private addSubX(op: number, isSub: boolean, size: Size): void {
    const dreg = (op >> 9) & 7;
    const reg = op & 7;
    const x = this.sr & SR_X ? 1 : 0;
    this.cycles += op & 0x0008
      ? (size === Size.Long ? 30 : 18)
      : (size === Size.Long ? 8 : 4);

    if (op & 0x0008) {
      const sAddr = (this.a[reg] - M68000.stride(reg, size)) >>> 0;
      this.a[reg] = sAddr;
      const dAddr = (this.a[dreg] - M68000.stride(dreg, size)) >>> 0;
      this.a[dreg] = dAddr;
      const s = this.readMem(sAddr, size);
      const d = this.readMem(dAddr, size);
      const r = isSub
        ? this.subFlags(s, d, d - s - x, size, true)
        : this.addFlags(s, d, d + s + x, size, true);
      this.writeMem(dAddr, size, r);
      return;
    }

    const s = this.readD(reg, size);
    const d = this.readD(dreg, size);
    this.writeD(
      dreg,
      size,
      isSub
        ? this.subFlags(s, d, d - s - x, size, true)
        : this.addFlags(s, d, d + s + x, size, true),
    );
  }

  private groupB(op: number): void {
    const dreg = (op >> 9) & 7;
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    const sizeBits = (op >> 6) & 3;

    if (sizeBits === 3) {
      const size = op & 0x0100 ? Size.Long : Size.Word;
      if (this.badEa(op, mode, reg, EA_ALL)) return;
      const raw = this.readEA(mode, reg, size);
      const v = size === Size.Word ? ((raw << 16) >> 16) >>> 0 : raw;
      this.cmpFlags(v, this.a[dreg], Size.Long);
      this.cycles += 6;
      return;
    }

    const size = M68000.sizeOf(sizeBits);
    if (size === null) {
      this.illegal(op);
      return;
    }

    if (!(op & 0x0100)) {
      if (this.badEa(op, mode, reg, size === Size.Byte ? EA_DATA : EA_ALL)) return;
      this.cmpFlags(this.readEA(mode, reg, size), this.readD(dreg, size), size);
      this.cycles += size === Size.Long ? 6 : 4;
      return;
    }

    if (mode === 1) {
      const s = this.readMem(this.effectiveAddress(3, reg, size, false), size);
      const d = this.readMem(this.effectiveAddress(3, dreg, size, false), size);
      this.cmpFlags(s, d, size);
      this.cycles += size === Size.Long ? 20 : 12;
      return;
    }

    if (this.badEa(op, mode, reg, EA_DATA_ALT)) return;
    const v = this.readD(dreg, size);
    this.rmwEA(mode, reg, size, (d) => this.logic(d ^ v, size));
    this.cycles += M68000.aluBase(mode !== 0, size, mode, reg);
  }

  private groupC(op: number): void {
    const dreg = (op >> 9) & 7;
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    const sizeBits = (op >> 6) & 3;

    if ((op & 0x01c0) === 0x00c0) {
      if (this.badEa(op, mode, reg, EA_DATA)) return;
      const src = this.readEA(mode, reg, Size.Word);
      const v = src * this.readD(dreg, Size.Word);
      this.d[dreg] = v >>> 0;
      this.logic(v, Size.Long);
      this.cycles += 38 + 2 * M68000.onesCount(src);
      return;
    }
    if ((op & 0x01c0) === 0x01c0) {
      if (this.badEa(op, mode, reg, EA_DATA)) return;
      const raw = this.readEA(mode, reg, Size.Word);
      const s = M68000.signed(raw, Size.Word);
      const d = M68000.signed(this.readD(dreg, Size.Word), Size.Word);
      const v = Math.imul(s, d);
      this.d[dreg] = v >>> 0;
      this.logic(v, Size.Long);
      this.cycles += 38 + 2 * M68000.transitionCount(raw);
      return;
    }
    if ((op & 0x01f0) === 0x0100) {
      this.bcdOp(op, false);
      return;
    }
    if ((op & 0x0130) === 0x0100) {
      const kind = op & 0x00f8;
      if (kind !== 0x0040 && kind !== 0x0048 && kind !== 0x0088) {
        this.illegal(op);
        return;
      }
      this.cycles += 6;
      if (kind === 0x0040) {
        const t = this.d[dreg];
        this.d[dreg] = this.d[reg];
        this.d[reg] = t;
      } else if (kind === 0x0048) {
        const t = this.a[dreg];
        this.a[dreg] = this.a[reg];
        this.a[reg] = t;
      } else {
        const t = this.d[dreg];
        this.d[dreg] = this.a[reg];
        this.a[reg] = t;
      }
      return;
    }

    const size = M68000.sizeOf(sizeBits);
    if (size === null) {
      this.illegal(op);
      return;
    }
    const toMemory = (op & 0x0100) !== 0;
    if (this.badEa(op, mode, reg, toMemory ? EA_MEM_ALT : EA_DATA)) return;
    if (toMemory) {
      const v = this.readD(dreg, size);
      this.rmwEA(mode, reg, size, (d) => this.logic(d & v, size));
    } else {
      const v = this.readEA(mode, reg, size);
      this.writeD(dreg, size, this.logic(this.readD(dreg, size) & v, size));
    }
    this.cycles += M68000.aluBase(toMemory, size, mode, reg);
  }

  private bcdAdd(s: number, d: number): number {
    const x = this.sr & SR_X ? 1 : 0;
    let lo = (d & 0x0f) + (s & 0x0f) + x;
    let hi = (d >> 4) + (s >> 4);
    if (lo > 9) {
      lo -= 10;
      hi += 1;
    }
    let carry = false;
    if (hi > 9) {
      hi -= 10;
      carry = true;
    }
    const res = ((hi << 4) | lo) & 0xff;
    this.setFlags(SR_C | SR_X, carry);
    this.setFlags(SR_N, (res & 0x80) !== 0);
    if (res !== 0) this.setFlags(SR_Z, false);
    return res;
  }

  private bcdSub(s: number, d: number): number {
    const x = this.sr & SR_X ? 1 : 0;
    let lo = (d & 0x0f) - (s & 0x0f) - x;
    let hi = (d >> 4) - (s >> 4);
    if (lo < 0) {
      lo += 10;
      hi -= 1;
    }
    let borrow = false;
    if (hi < 0) {
      hi += 10;
      borrow = true;
    }
    const res = ((hi << 4) | lo) & 0xff;
    this.setFlags(SR_C | SR_X, borrow);
    this.setFlags(SR_N, (res & 0x80) !== 0);
    if (res !== 0) this.setFlags(SR_Z, false);
    return res;
  }

  private bcdOp(op: number, isSub: boolean): void {
    const dreg = (op >> 9) & 7;
    const reg = op & 7;
    this.cycles += op & 0x0008 ? 18 : 6;

    if (op & 0x0008) {
      const sAddr = (this.a[reg] - M68000.stride(reg, Size.Byte)) >>> 0;
      this.a[reg] = sAddr;
      const dAddr = (this.a[dreg] - M68000.stride(dreg, Size.Byte)) >>> 0;
      this.a[dreg] = dAddr;
      const s = this.readMem(sAddr, Size.Byte);
      const d = this.readMem(dAddr, Size.Byte);
      this.writeMem(dAddr, Size.Byte, isSub ? this.bcdSub(s, d) : this.bcdAdd(s, d));
      return;
    }

    const s = this.readD(reg, Size.Byte);
    const d = this.readD(dreg, Size.Byte);
    this.writeD(dreg, Size.Byte, isSub ? this.bcdSub(s, d) : this.bcdAdd(s, d));
  }

  private groupShift(op: number): void {
    const sizeBits = (op >> 6) & 3;
    const left = (op & 0x0100) !== 0;

    if (sizeBits === 3) {
      const mode = (op >> 3) & 7;
      const memReg = op & 7;
      if (op & 0x0800) {
        this.illegal(op);
        return;
      }
      if (this.badEa(op, mode, memReg, EA_MEM_ALT)) return;
      const kind = (op >> 9) & 3;
      this.rmwEA(mode, memReg, Size.Word, (v) => this.shift(kind, left, v, 1, Size.Word));
      this.cycles += 8;
      return;
    }

    const size = M68000.sizeOf(sizeBits);
    if (size === null) {
      this.illegal(op);
      return;
    }
    const reg = op & 7;
    const kind = (op >> 3) & 3;
    const count = op & 0x0020 ? this.d[(op >> 9) & 7] & 63 : ((op >> 9) & 7) || 8;
    this.writeD(reg, size, this.shift(kind, left, this.readD(reg, size), count, size));
    this.cycles += (size === Size.Long ? 8 : 6) + 2 * count;
  }

  private shift(kind: number, left: boolean, v: number, count: number, size: Size): number {
    const bits = size * 8;
    const m = M68000.mask(size);
    const msb = M68000.msb(size);
    let val = v & m;
    let carry = false;
    let overflow = false;

    for (let i = 0; i < count; i++) {
      const top = (val & msb) !== 0;
      const bottom = (val & 1) !== 0;
      switch (kind) {
        case 0:
          if (left) {
            carry = top;
            val = (val << 1) & m;
            if (((val & msb) !== 0) !== top) overflow = true;
          } else {
            carry = bottom;
            val = ((val >>> 1) | (top ? msb : 0)) & m;
          }
          break;
        case 1:
          if (left) {
            carry = top;
            val = (val << 1) & m;
          } else {
            carry = bottom;
            val = (val >>> 1) & m;
          }
          break;
        case 2: {
          const x = this.sr & SR_X ? 1 : 0;
          if (left) {
            carry = top;
            val = ((val << 1) | x) & m;
          } else {
            carry = bottom;
            val = ((val >>> 1) | (x ? msb : 0)) & m;
          }
          this.setFlags(SR_X, carry);
          break;
        }
        default:
          if (left) {
            carry = top;
            val = ((val << 1) | (top ? 1 : 0)) & m;
          } else {
            carry = bottom;
            val = ((val >>> 1) | (bottom ? msb : 0)) & m;
          }
          break;
      }
    }

    if (count > 0) {
      this.setFlags(SR_C, carry);
      if (kind < 2) this.setFlags(SR_X, carry);
    } else {
      this.setFlags(SR_C, false);
    }
    this.setFlags(SR_V, kind === 0 && overflow);
    this.setFlags(SR_N, (val & msb) !== 0);
    this.setFlags(SR_Z, val === 0);
    void bits;
    return val;
  }

  private privilegeViolation(): void {
    if (this.isCpu32) this.instrHead = 0;
    this.pc = this.savedPc;
    this.exception(VEC_PRIVILEGE);
  }

  private move(op: number, size: Size): void {
    const srcMode = (op >> 3) & 7;
    const srcReg = op & 7;
    const dstMode = (op >> 6) & 7;
    const dstReg = (op >> 9) & 7;

    if (this.badEa(op, srcMode, srcReg, size === Size.Byte ? EA_DATA : EA_ALL)) return;
    if (dstMode === 1) {
      if (size === Size.Byte) {
        this.illegal(op);
        return;
      }
    } else if (this.badEa(op, dstMode, dstReg, EA_DATA_ALT)) {
      return;
    }

    const value = this.readEA(srcMode, srcReg, size);

    if (dstMode === 1) {
      this.a[dstReg] = (size === Size.Word ? (value << 16) >> 16 : value) >>> 0;
      this.cycles += 4;
      return;
    }

    this.logicFlags(value, size);

    if (dstMode === 0) {
      this.writeD(dstReg, size, value);
    } else {
      const addr = this.effectiveAddress(dstMode, dstReg, size, true);
      this.cycles +=
        M68000.moveDstCost(dstMode, dstReg, size) - M68000.eaCost(dstMode, dstReg, size);
      this.writeMem(addr, size, value);
    }
    this.cycles += 4;
  }

  private unimplemented(op: number, vector: number): void {
    this.pc = this.savedPc;
    this.onIllegal?.(op, this.pc, vector);
    this.exception(vector);
  }

  private cmp2chk2(op: number, mode: number, reg: number): void {
    if (this.badEa(op, mode, reg, EA_CONTROL)) return;
    const size = [Size.Byte, Size.Word, Size.Long][(op >> 9) & 3];
    const ext = this.fetch();
    const r = (ext >> 12) & 7;
    const isAddr = (ext & 0x8000) !== 0;
    const addr = this.effectiveAddress(mode, reg, size, false) >>> 0;
    const step = size === Size.Byte ? 1 : size === Size.Word ? 2 : 4;
    let lower = this.readMem(addr, size);
    let upper = this.readMem((addr + step) >>> 0, size);
    let compare: number;
    if (size === Size.Long) {
      compare = (isAddr ? this.a[r] : this.d[r]) >>> 0;
      if (lower & 0x80000000) {
        lower |= 0; upper |= 0; compare |= 0;
      }
    } else {
      const signBit = size === Size.Byte ? 0x80 : 0x8000;
      compare = isAddr ? this.a[r] | 0 : M68000.trunc(this.d[r], size);
      if (lower & signBit) {
        lower = M68000.signed(lower, size);
        upper = M68000.signed(upper, size);
        if (!isAddr) compare = M68000.signed(compare, size);
      }
    }
    const out = !(compare >= lower && compare <= upper);
    this.setFlags(SR_C, out);
    this.setFlags(SR_Z, compare === lower || compare === upper);
    if (out && (ext & 0x0800)) this.exception(6);
  }

  private tbl(op: number): boolean {
    const mode = (op >> 3) & 7;
    const reg = op & 7;
    const ext = this.fetch();
    const sizeBits = (ext >> 6) & 3;
    const tableMode = (ext & 0x0100) !== 0;
    if (ext === 0x01c0 || (ext & 0x8200) !== 0 || sizeBits === 3) return false;
    if (tableMode) {
      const control = mode === 2 || mode === 5 || mode === 6 || (mode === 7 && reg <= 3);
      if (!control || (ext & 0x003f) !== 0) return false;
    } else if (mode !== 0 || (ext & 0x0038) !== 0) return false;

    const size = [Size.Byte, Size.Word, Size.Long][sizeBits];
    const bytes = 1 << sizeBits;
    const signed = (ext & 0x0800) !== 0;
    const rounded = (ext & 0x0400) === 0;
    const dx = (ext >> 12) & 7;
    const x = this.d[dx];
    const frac = x & 0xff;
    const widen = (v: number) => (signed ? M68000.signed(v, size) : M68000.trunc(v, size));
    const before = this.cycles;
    let e0: number;
    let e1: number;
    if (tableMode) {
      const base = this.effectiveAddress(mode, reg, size, false) >>> 0;
      const addr = (base + ((x >>> 8) & 0xff) * bytes) >>> 0;
      e0 = widen(this.readMem(addr, size));
      e1 = widen(this.readMem((addr + bytes) >>> 0, size));
    } else {
      e0 = widen(this.d[reg]);
      e1 = widen(this.d[ext & 7]);
    }
    const prod = (e1 - e0) * frac;
    const low32 = (v: number) => (((v % 4294967296) + 4294967296) % 4294967296) >>> 0;
    if (rounded) {
      let q = Math.trunc(prod / 256);
      const r = prod - q * 256;
      if (r >= 128) q++;
      else if (signed && r <= -128) q--;
      const v = e0 + q;
      this.writeD(dx, size, v);
      const res = M68000.trunc(v, size);
      const msb = size === Size.Byte ? 0x80 : size === Size.Word ? 0x8000 : 0x80000000;
      this.setFlags(SR_N, (res & msb) !== 0);
      this.setFlags(SR_Z, res === 0);
      this.setFlags(SR_V | SR_C, false);
      this.cycles = before + (tableMode ? 33 : 28);
      return true;
    }
    const full = e0 * 256 + prod;
    let out: number;
    let overflow = false;
    if (size === Size.Long) {
      out = low32(full);
      const integer = Math.floor(full / 256);
      overflow = signed ? integer < -0x800000 || integer > 0x7fffff : integer < 0 || integer > 0xffffff;
    } else {
      const bits = size === Size.Byte ? 16 : 24;
      const lo = low32(full) % 2 ** bits;
      out = (signed && lo >= 2 ** (bits - 1) ? lo - 2 ** bits : lo) >>> 0;
    }
    this.d[dx] = out >>> 0;
    this.setFlags(SR_N, (out & 0x80000000) !== 0);
    this.setFlags(SR_Z, out === 0);
    this.setFlags(SR_V, overflow);
    this.setFlags(SR_C, false);
    this.cycles = before + (tableMode ? (signed ? 35 : 39) : (signed ? 30 : 34));
    return true;
  }

  private illegal(op: number): void {
    if (this.isCpu32) this.instrHead = 0;
    this.unimplemented(op, VEC_ILLEGAL);
  }

  trace(): string {
    const h = (v: number, n: number) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
    const regs = [...this.d].map((v) => h(v, 8)).join(' ');
    const addr = [...this.a].map((v) => h(v, 8)).join(' ');
    return `PC=${h(this.pc, 6)} SR=${h(this.sr, 4)}\n D: ${regs}\n A: ${addr}`;
  }
}

export { VEC_BUS_ERROR, VEC_ADDRESS_ERROR, VEC_PRIVILEGE };
