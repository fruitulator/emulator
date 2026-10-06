import { AluOp, K, Predecode, XM_AI, XM_AL, XM_AN, XM_AW, XM_D16, XM_DN, XM_IMM, XM_IX,
  XM_PCD, XM_PCIX, XM_PD, XM_PI } from './m68kpredecode';

export interface CompiledRegion {
  fn: (cpu: unknown) => number;
  maxCycles: number;
  entryIdx: number;
  instructions: number;
}

const HOT_THRESHOLD = 400;
const MAX_BLOCKS = 12;
const MAX_INSTR = 160;
const WINDOW_BEFORE = 0x200;
const WINDOW_AFTER = 0x800;

const SIZE_BYTES = [1, 2, 4];

interface Instr {
  idx: number;
  k: number;
  len: number;
  cyc: number;
  a: number;
  b: number;
  c: number;
}

interface Block {
  startIdx: number;
  instrs: Instr[];
  term: Term;
}

type Term =
  | { kind: 'exit'; atIdx: number }
  | { kind: 'bra'; target: number; cyc: number }
  | { kind: 'bcc'; cc: number; target: number; fallIdx: number; cyc: number; len: number }
  | { kind: 'dbcc'; cc: number; reg: number; target: number; fallIdx: number; cyc: number; len: number }
  | { kind: 'jsr'; target: number; retIdx: number; atIdx: number; cyc: number }
  | { kind: 'rts'; atIdx: number; cyc: number };

export class Regions {
  private readonly hot = new Int32Array(4096);
  readonly regions: CompiledRegion[] = [];
  private readonly headByIdx = new Map<number, number>();
  private readonly refused = new Set<number>();
  entries = 0;
  compiled = 0;

  get refusedCount(): number {
    return this.refused.size;
  }

  constructor(
    private readonly pd: Predecode,
    readonly rom: Uint8Array,
    private readonly bus: unknown,
  ) {}

  at(idx: number): CompiledRegion | null {
    const id = this.headByIdx.get(idx);
    return id === undefined ? null : this.regions[id];
  }

  noteAddr(addr: number): void {
    this.note((addr - this.pd.base) >> 1);
  }

  enabled = true;

  note(idx: number): void {
    if (!this.enabled) return;
    if (idx < 0 || idx >= this.pd.nWords) return;
    const h = idx & 4095;
    if (++this.hot[h] !== HOT_THRESHOLD) return;
    this.hot[h] = 0;
    if (this.headByIdx.has(idx) || this.refused.has(idx)) return;
    const r = this.compile(idx);
    if (r === null) {
      this.refused.add(idx);
      return;
    }
    this.regions.push(r);
    this.headByIdx.set(idx, this.regions.length - 1);
    this.pd.page(idx).head[idx & 2047] = this.regions.length;
    this.compiled++;
  }

  private instrAt(idx: number): Instr {
    const p = this.pd.page(idx);
    const o = idx & 2047;
    const k = this.pd.kindAt(idx, p);
    return { idx, k, len: p.len[o], cyc: p.cyc[o], a: p.a[o], b: p.b[o], c: p.c[o] };
  }

  private compile(entry: number): CompiledRegion | null {
    const blocks = this.walk(entry);
    if (blocks === null) return null;
    let n = 0;
    for (const b of blocks.values()) n += b.instrs.length;
    try {
      return this.emit(entry, blocks, n);
    } catch {
      return null;
    }
  }

  private walk(entry: number): Map<number, Block> | null {
    const blocks = new Map<number, Block>();
    const queue = [entry];
    let total = 0;
    while (queue.length > 0 && blocks.size < MAX_BLOCKS) {
      const start = queue.shift()!;
      if (blocks.has(start)) continue;
      const block: Block = { startIdx: start, instrs: [], term: { kind: 'exit', atIdx: start } };
      blocks.set(start, block);
      let idx = start;
      for (;;) {
        if (total >= MAX_INSTR) { block.term = { kind: 'exit', atIdx: idx }; break; }
        const ins = this.instrAt(idx);
        const t = this.terminatorOf(ins, entry);
        if (t !== null) {
          block.term = t;
          const follow = (target: number) => {
            if (target >= entry - WINDOW_BEFORE && target <= entry + WINDOW_AFTER
              && target >= 0 && target < this.pd.nWords) queue.push(target);
          };
          if (t.kind === 'bra' || t.kind === 'jsr') follow(t.target);
          if (t.kind === 'bcc' || t.kind === 'dbcc') { follow(t.target); queue.push(t.fallIdx); }
          if (t.kind !== 'exit') total++;
          break;
        }
        if (!SUPPORTED.has(ins.k)) {
          block.term = { kind: 'exit', atIdx: idx };
          break;
        }
        block.instrs.push(ins);
        total++;
        idx += ins.len >> 1;
        if (blocks.has(idx) || queue.includes(idx)) { block.term = { kind: 'bra', target: idx, cyc: 0 }; break; }
      }
    }
    if (blocks.get(entry)!.instrs.length === 0 && blocks.get(entry)!.term.kind === 'exit') return null;
    return blocks;
  }

  private terminatorOf(ins: Instr, entry: number): Term | null {
    const targetIdx = ((ins.b >>> 0) - this.pd.base) >> 1;
    switch (ins.k) {
      case K.BRA:
        return { kind: 'bra', target: targetIdx, cyc: ins.cyc };
      case K.BCC: {
        const fall = ins.idx + (ins.len >> 1);
        return { kind: 'bcc', cc: (ins.a >>> 18) & 0xff, target: targetIdx, fallIdx: fall, cyc: ins.cyc, len: ins.len };
      }
      case K.DBCC: {
        const fall = ins.idx + (ins.len >> 1);
        return {
          kind: 'dbcc', cc: (ins.a >>> 18) & 0xff, reg: (ins.a >>> 4) & 7,
          target: targetIdx, fallIdx: fall, cyc: ins.cyc, len: ins.len,
        };
      }
      case K.JMP: {
        const sx = ins.a & 15;
        if (sx === XM_AW || sx === XM_AL || sx === XM_PCD) {
          return { kind: 'bra', target: targetIdx, cyc: ins.cyc };
        }
        return { kind: 'exit', atIdx: ins.idx };
      }
      case K.JSR: {
        const sx = ins.a & 15;
        if (sx === XM_AW || sx === XM_AL || sx === XM_PCD) {
          return {
            kind: 'jsr', target: targetIdx, retIdx: ins.idx + (ins.len >> 1),
            atIdx: ins.idx, cyc: ins.cyc,
          };
        }
        return { kind: 'exit', atIdx: ins.idx };
      }
      case K.BSR:
        return { kind: 'jsr', target: targetIdx, retIdx: ins.idx + (ins.len >> 1), atIdx: ins.idx, cyc: ins.cyc };
      case K.RTS:
        return { kind: 'rts', atIdx: ins.idx, cyc: ins.cyc };
      default:
        return null;
    }
  }

  private emit(entry: number, blocks: Map<number, Block>, count: number): CompiledRegion {
    const order = [...blocks.keys()];
    const caseOf = new Map<number, number>();
    order.forEach((idx, i) => caseOf.set(idx, i));
    const pcOf = (idx: number) => `${(this.pd.base + idx * 2) >>> 0}`;

    let maxCycles = 0;
    for (const b of blocks.values()) {
      for (const i of b.instrs) maxCycles += i.cyc;
      const t = b.term;
      if (t.kind !== 'exit') maxCycles += t.cyc;
    }

    const L: string[] = [];
    L.push('"use strict";');
    L.push('const sram = bus.sram, ram = bus.ram;');
    L.push('let RB = 0;');
    L.push('const rd8 = (P) => P < 0x01000000 ? (P < rom.length ? rom[P] : 0xff)'
      + ' : (P - RB >>> 0) < 0x10000 ? sram[P - RB] : ram[P & 0xffff];');
    L.push('const rd16 = (P) => P < 0x01000000 ? (P + 1 < rom.length ? ((rom[P] << 8) | rom[P + 1]) : bus.read16(P))'
      + ' : (P - RB >>> 0) < 0x10000 ? ((sram[P - RB] << 8) | sram[P - RB + 1])'
      + ' : ((ram[P & 0xffff] << 8) | ram[(P + 1) & 0xffff]);');
    L.push('const rd32 = (P) => (((rd16(P) << 16) | rd16((P + 2) >>> 0)) >>> 0);');
    L.push('return function region(cpu) {');
    L.push('const d = cpu.d, a = cpu.a;');
    L.push('let sr = cpu.sr | 0;');
    L.push('let cyc = 0;');
    L.push('const budget = cpu.regionBudget | 0;');
    L.push('let A = 0, V = 0;');
    L.push('RB = bus.rambarBase >>> 0;');
    L.push(`let bb = ${caseOf.get(entry)};`);
    L.push('loop: for (;;) switch (bb) {');

    for (const idx of order) {
      const b = blocks.get(idx)!;
      L.push(`case ${caseOf.get(idx)}: {`);
      let blockCyc = 0;
      for (const ins of b.instrs) {
        this.emitInstr(L, ins, blockCyc);
        blockCyc += ins.cyc;
      }
      const t = b.term;
      const jump = (target: number, extraCyc: number): string => {
        const c = caseOf.get(target);
        if (c === undefined) return `cyc += ${blockCyc + extraCyc}; cpu.pc = ${pcOf(target)}; cpu.noteRegionExit(${target}); break loop;`;
        return `cyc += ${blockCyc + extraCyc}; if (cyc + ${maxCycles} > budget) { cpu.pc = ${pcOf(target)}; break loop; } bb = ${c}; continue loop;`;
      };
      switch (t.kind) {
        case 'exit':
          L.push(`cyc += ${blockCyc}; cpu.pc = ${pcOf(t.atIdx)}; cpu.noteRegionExit(${t.atIdx + (this.instrAt(t.atIdx).len >> 1)}); break loop;`);
          break;
        case 'bra':
          L.push(jump(t.target, t.cyc));
          break;
        case 'bcc':
          L.push(`if (${ccExpr(t.cc)}) { ${jump(t.target, t.cyc)} }`);
          L.push(jump(t.fallIdx, t.cyc));
          break;
        case 'dbcc': {
          const r = t.reg;
          L.push(`if (${ccExpr(t.cc)}) { ${jump(t.fallIdx, t.cyc)} }`);
          L.push(`V = (d[${r}] - 1) & 0xffff; d[${r}] = ((d[${r}] & ~0xffff) | V) >>> 0;`);
          L.push(`if (V !== 0xffff) { ${jump(t.target, t.cyc)} }`);
          L.push(jump(t.fallIdx, t.cyc));
          break;
        }
        case 'jsr': {
          L.push('A = (a[7] - 4) >>> 0;');
          L.push(`if (!((A - RB >>> 0) < 0xfffc || (A - 0x01000000 >>> 0) < 0xfffc)) { cyc += ${blockCyc}; cpu.pc = ${pcOf(t.atIdx)}; break loop; }`);
          L.push(`V = ${(this.pd.base + t.retIdx * 2) >>> 0};`);
          L.push(this.memWrite(4));
          L.push('a[7] = A;');
          L.push(jump(t.target, t.cyc));
          break;
        }
        case 'rts': {
          L.push('A = a[7];');
          L.push(`if (!((A - RB >>> 0) < 0xfffc || (A - 0x01000000 >>> 0) < 0xfffc)) { cyc += ${blockCyc}; cpu.pc = ${pcOf(t.atIdx)}; break loop; }`);
          L.push('V = rd32(A);');
          L.push(`if (V & 1) { cyc += ${blockCyc}; cpu.pc = ${pcOf(t.atIdx)}; break loop; }`);
          L.push('a[7] = (a[7] + 4) >>> 0;');
          L.push(`cyc += ${blockCyc + t.cyc}; cpu.pc = V >>> 0; cpu.noteRegionExitPc(V); break loop;`);
          break;
        }
      }
      L.push('}');
    }
    L.push('}');
    L.push('cpu.sr = sr & 0xffff;');
    L.push('cpu.cycles += cyc;');
    L.push('cpu.prefetchStale = true;');
    L.push('cpu.savedPc = cpu.pc;');
    L.push('return cyc;');
    L.push('};');

    const factory = new Function('bus', 'rom', L.join('\n')) as
      (bus: unknown, rom: Uint8Array) => CompiledRegion['fn'];
    const fn = factory(this.bus, this.rom);
    return { fn, maxCycles, entryIdx: entry, instructions: count };
  }

  private emitInstr(L: string[], ins: Instr, billedBefore: number): void {
    const aw = ins.a;
    const sx = aw & 15;
    const sReg = (aw >>> 4) & 7;
    const dx = (aw >>> 8) & 15;
    const dReg = (aw >>> 12) & 7;
    const size = SIZE_BYTES[(aw >>> 16) & 3];
    const aux = (aw >>> 18) & 0xff;
    const flag1 = (aw >>> 26) & 1;
    const b = ins.b;
    const c = ins.c;
    const pc = `${(this.pd.base + ins.idx * 2) >>> 0}`;
    const nBits = size === 4 ? 28 : size === 2 ? 12 : 4;
    const msb = size === 4 ? 0x80000000 : size === 2 ? 0x8000 : 0x80;
    const logicSr = `sr = (sr & ~0xf) | (V === 0 ? 4 : 0) | ((V >>> ${nBits}) & 8);`;

    const guardRead = (addrExpr: string): void => {
      L.push(`A = ${addrExpr};`);
      L.push(`if (!(A < 0x01000000 || (A - RB >>> 0) < 0x10000 || (A - 0x01000000 >>> 0) < 0x10000)) { cyc += ${billedBefore}; cpu.pc = ${pc}; cpu.noteRegionExit(${ins.idx + (ins.len >> 1)}); break loop; }`);
    };

    const read = (x: number, reg: number, payloadB: number, payloadC: number): string => {
      switch (x) {
        case XM_DN: return size === 4 ? `d[${reg}]` : `(d[${reg}] & ${size === 2 ? '0xffff' : '0xff'})`;
        case XM_AN: return size === 4 ? `a[${reg}]` : `(a[${reg}] & ${size === 2 ? '0xffff' : '0xff'})`;
        case XM_IMM: return `${size === 4 ? payloadB >>> 0 : payloadB}`;
        default: {
          guardRead(this.addrExpr(x, reg, payloadB, payloadC));
          this.commitAddrSideEffects(L, x, reg, payloadB);
          return this.memRead(size);
        }
      }
    };

    const writeD = (reg: number, expr: string): string =>
      size === 4 ? `d[${reg}] = (${expr}) >>> 0;`
        : size === 2 ? `d[${reg}] = ((d[${reg}] & ~0xffff) | ((${expr}) & 0xffff)) >>> 0;`
          : `d[${reg}] = ((d[${reg}] & ~0xff) | ((${expr}) & 0xff)) >>> 0;`;

    const store = (valExpr: string, nextIdx: number, extraCyc: number): void => {
      L.push(`V = ${valExpr};`);
      L.push(`if ((A - RB >>> 0) < 0x10000 || (A - 0x01000000 >>> 0) < 0x10000) { ${this.memWrite(size)} }`);
      L.push(`else { bus.deviceCatchUp?.(cyc + ${billedBefore}); ${this.busWrite(size)} cyc += ${billedBefore + extraCyc}; cpu.pc = ${(this.pd.base + nextIdx * 2) >>> 0}; cpu.noteRegionExit(${nextIdx}); cpu.budgetStale = true; break loop; }`);
    };

    switch (ins.k) {
      case K.NOP:
        break;
      case K.MOVEQ:
        L.push(`V = ${b | 0}; d[${(aw >>> 12) & 7}] = V >>> 0;`);
        L.push('sr = (sr & ~0xf) | (V === 0 ? 4 : 0) | ((V >>> 28) & 8);');
        break;
      case K.MOVE: {
        const src = read(sx, sReg, b, c);
        L.push(`V = ${src};`);
        L.push(logicSr);
        if (dx === XM_DN) L.push(writeD(dReg, 'V'));
        else {
          L.push(`A = ${this.addrExpr(dx, dReg, c, 0)};`);
          this.commitAddrSideEffects(L, dx, dReg, c);
          store('V', ins.idx + (ins.len >> 1), ins.cyc);
        }
        break;
      }
      case K.MOVEA: {
        const src = read(sx, sReg, b, c);
        L.push(`V = ${src};`);
        L.push(`a[${dReg}] = ${size === 2 ? '((V << 16) >> 16) >>> 0' : 'V >>> 0'};`);
        break;
      }
      case K.LEA:
        L.push(`a[${dReg}] = (${this.addrExpr(sx, sReg, b, c)}) >>> 0;`);
        break;
      case K.TST: {
        const src = read(sx, sReg, b, c);
        L.push(`V = ${src};`);
        L.push(logicSr);
        break;
      }
      case K.CLR:
        L.push('sr = (sr & ~0xf) | 4;');
        if (dx === XM_DN) L.push(writeD(dReg, '0'));
        else {
          guardRead(this.addrExpr(dx, dReg, c, 0));
          this.commitAddrSideEffects(L, dx, dReg, c);
          L.push(`V = ${this.memRead(size)};`);
          store('0', ins.idx + (ins.len >> 1), ins.cyc);
        }
        break;
      case K.NOT:
        if (dx === XM_DN) {
          L.push(`V = (~d[${dReg}]) & ${size === 4 ? '0xffffffff' : size === 2 ? '0xffff' : '0xff'};`);
          if (size === 4) L.push('V = V >>> 0;');
          L.push(logicSr);
          L.push(writeD(dReg, 'V'));
        } else {
          guardRead(this.addrExpr(dx, dReg, c, 0));
          this.commitAddrSideEffects(L, dx, dReg, c);
          L.push(`V = (~${this.memRead(size)}) & ${size === 4 ? '0xffffffff' : size === 2 ? '0xffff' : '0xff'};`);
          if (size === 4) L.push('V = V >>> 0;');
          L.push(logicSr);
          store('V', ins.idx + (ins.len >> 1), ins.cyc);
        }
        break;
      case K.EXT: {
        const r = sReg;
        if (size === 4) L.push(`V = ((d[${r}] << 16) >> 16) >>> 0; d[${r}] = V;`);
        else L.push(`V = ((d[${r}] << 24) >> 24) & 0xffff; d[${r}] = ((d[${r}] & ~0xffff) | V) >>> 0;`);
        L.push(logicSr);
        break;
      }
      case K.EXTB: {
        const r = sReg;
        L.push(`V = ((d[${r}] << 24) >> 24) >>> 0; d[${r}] = V;`);
        L.push('sr = (sr & ~0xf) | (V === 0 ? 4 : 0) | ((V >>> 28) & 8);');
        break;
      }
      case K.SWAP: {
        const r = sReg;
        L.push(`V = ((d[${r}] << 16) | (d[${r}] >>> 16)) >>> 0; d[${r}] = V;`);
        L.push('sr = (sr & ~0xf) | (V === 0 ? 4 : 0) | ((V >>> 28) & 8);');
        break;
      }
      case K.ALU: {
        if (flag1 === 0) {
          const src = read(sx, sReg, b, c);
          L.push(`V = ${src};`);
          this.emitAluToReg(L, aux, dReg, size, nBits, msb, writeD);
        } else if (dx === XM_DN) {
          L.push(`V = ((d[${dReg}] ^ d[${sReg}]) & ${size === 4 ? '0xffffffff' : size === 2 ? '0xffff' : '0xff'});`);
          if (size === 4) L.push('V = V >>> 0;');
          L.push(logicSr);
          L.push(writeD(dReg, 'V'));
        } else {
          guardRead(this.addrExpr(dx, dReg, c, 0));
          this.commitAddrSideEffects(L, dx, dReg, c);
          L.push(`V = ${this.memRead(size)};`);
          this.emitAluToMem(L, aux, sReg, size, nBits, msb);
          store('V', ins.idx + (ins.len >> 1), ins.cyc);
        }
        break;
      }
      case K.CMPA: {
        const raw = read(sx, sReg, b, c);
        L.push(`V = ${raw};`);
        if (size === 2) L.push('V = ((V << 16) >> 16) >>> 0;');
        L.push(`{ const dd = a[${dReg}]; const res = (dd - V) >>> 0;`
          + ' sr = (sr & ~0xf) | (dd < V ? 1 : 0)'
          + ' | (((V ^ dd) & (dd ^ res) & 0x80000000) !== 0 ? 2 : 0)'
          + ' | (res === 0 ? 4 : 0) | ((res >>> 28) & 8); }');
        break;
      }
      case K.ADDA: {
        const raw = read(sx, sReg, b, c);
        L.push(`V = ${raw};`);
        if (size === 2) L.push('V = (V << 16) >> 16;');
        L.push(`a[${dReg}] = (a[${dReg}] ${flag1 ? '-' : '+'} V) >>> 0;`);
        break;
      }
      case K.ADDQ: {
        const imm = aux;
        if (dx === XM_AN) {
          L.push(`a[${dReg}] = (a[${dReg}] ${flag1 ? '-' : '+'} ${imm}) >>> 0;`);
        } else if (dx === XM_DN) {
          this.emitAddSubImmReg(L, dReg, imm, flag1 === 1, size, nBits, msb, writeD);
        } else {
          guardRead(this.addrExpr(dx, dReg, c, 0));
          this.commitAddrSideEffects(L, dx, dReg, c);
          L.push(`V = ${this.memRead(size)};`);
          this.emitAddSubImmMem(L, imm, flag1 === 1, size, nBits, msb);
          store('V', ins.idx + (ins.len >> 1), ins.cyc);
        }
        break;
      }
      case K.IMM_ALU: {
        const imm = size === 4 ? b >>> 0 : b;
        if (aux === AluOp.Cmp) {
          const src = read(dx, dReg, c, 0);
          L.push(`V = ${src};`);
          L.push(`{ const s = ${imm}; const res = (V - s) >>> 0;`
            + ` sr = (sr & ~0xf) | (V < s ? 1 : 0)`
            + ` | (((s ^ V) & (V ^ res) & ${msb}) !== 0 ? 2 : 0)`
            + ` | (res === 0 ? 4 : 0) | ((res >>> ${nBits}) & 8); }`);
          break;
        }
        if (dx === XM_DN) {
          if (aux === AluOp.Or || aux === AluOp.And || aux === AluOp.Eor) {
            const op = aux === AluOp.Or ? '|' : aux === AluOp.And ? '&' : '^';
            L.push(`V = ((d[${dReg}] ${op} ${imm}) & ${size === 4 ? '0xffffffff' : size === 2 ? '0xffff' : '0xff'});`);
            if (size === 4) L.push('V = V >>> 0;');
            L.push(logicSr);
            L.push(writeD(dReg, 'V'));
          } else {
            this.emitAddSubImmReg(L, dReg, imm, aux === AluOp.Sub, size, nBits, msb, writeD);
          }
        } else {
          guardRead(this.addrExpr(dx, dReg, c, 0));
          this.commitAddrSideEffects(L, dx, dReg, c);
          L.push(`V = ${this.memRead(size)};`);
          if (aux === AluOp.Or || aux === AluOp.And || aux === AluOp.Eor) {
            const op = aux === AluOp.Or ? '|' : aux === AluOp.And ? '&' : '^';
            L.push(`V = ((V ${op} ${imm}) & ${size === 4 ? '0xffffffff' : size === 2 ? '0xffff' : '0xff'});`);
            if (size === 4) L.push('V = V >>> 0;');
            L.push(logicSr);
          } else {
            this.emitAddSubImmMem(L, imm, aux === AluOp.Sub, size, nBits, msb);
          }
          store('V', ins.idx + (ins.len >> 1), ins.cyc);
        }
        break;
      }
      case K.SHIFT_REG: {
        const kind = aux & 3;
        const immCount0 = aux >> 2;
        if (kind !== 1) {
          const cnt = immCount0 === 0 ? `d[${sReg}] & 63` : `${immCount0}`;
          L.push(`cpu.sr = sr & 0xffff; cpu.regionShift(${kind}, ${flag1 === 1}, ${dReg}, ${cnt}, ${size}); sr = cpu.sr | 0;`);
          break;
        }
        const immCount = aux >> 2;
        const left = flag1 === 1;
        const cnt = immCount === 0 ? `(d[${sReg}] & 63)` : `${immCount}`;
        const val = size === 4 ? `d[${dReg}]` : size === 2 ? `(d[${dReg}] & 0xffff)` : `(d[${dReg}] & 0xff)`;
        const bits = size * 8;
        L.push(`{ const cnt = ${cnt}; const val = ${val}; let r = 0, carry = 0;`);
        L.push('if (cnt === 0) { sr = (sr & ~0xf) | (val === 0 ? 4 : 0) | '
          + `((val >>> ${nBits}) & 8); }`);
        L.push('else {');
        L.push(`if (cnt < ${bits}) { `
          + (left
            ? `r = (val << cnt) ${size === 4 ? '>>> 0' : `& ${size === 2 ? '0xffff' : '0xff'}`}; carry = (val >>> (${bits} - cnt)) & 1; `
            : 'r = val >>> cnt; carry = (val >>> (cnt - 1)) & 1; ')
          + '}');
        L.push(`else if (cnt === ${bits}) { r = 0; carry = ${left ? 'val & 1' : `(val >>> ${bits - 1}) & 1`}; }`);
        L.push('else { r = 0; carry = 0; }');
        L.push(`sr = (sr & ~0x1f) | (carry ? 0x11 : 0) | (r === 0 ? 4 : 0) | ((r >>> ${nBits}) & 8);`);
        L.push(writeD(dReg, 'r'));
        L.push('} }');
        break;
      }
      case K.SCC: {
        L.push(`V = ${ccExpr(aux)} ? 0xff : 0;`);
        if (dx === XM_DN) {
          L.push(`d[${dReg}] = ((d[${dReg}] & ~0xff) | V) >>> 0;`);
        } else {
          guardRead(this.addrExpr(dx, dReg, c, 0));
          this.commitAddrSideEffects(L, dx, dReg, c);
          L.push(`${this.memRead(1)};`);
          store('V', ins.idx + (ins.len >> 1), ins.cyc);
        }
        break;
      }
      case K.BITOP_DYN:
      case K.BITOP_IMM: {
        const toRegister = sx === XM_DN;
        const bitExpr = ins.k === K.BITOP_DYN
          ? `(1 << (d[${dReg}] & ${toRegister ? 31 : 7}))`
          : `${1 << (c & (toRegister ? 31 : 7))}`;
        if (aux === 0) {
          const src = toRegister ? `d[${sReg}]`
            : sx === XM_IMM ? `${b}` : null;
          if (src !== null) L.push(`V = ${src};`);
          else {
            guardRead(this.addrExpr(sx, sReg, b, ins.k === K.BITOP_DYN ? c : 0));
            this.commitAddrSideEffects(L, sx, sReg, b);
            L.push(`V = ${this.memRead(1)};`);
          }
          L.push(`sr = (sr & ~4) | ((V & ${bitExpr}) === 0 ? 4 : 0);`);
        } else {
          const op = aux === 1 ? '^' : aux === 2 ? '& ~' : '|';
          if (toRegister) {
            L.push(`V = d[${sReg}];`);
            L.push(`sr = (sr & ~4) | ((V & ${bitExpr}) === 0 ? 4 : 0);`);
            L.push(`d[${sReg}] = (V ${op} ${bitExpr}) >>> 0;`);
          } else {
            guardRead(this.addrExpr(sx, sReg, b, 0));
            this.commitAddrSideEffects(L, sx, sReg, b);
            L.push(`V = ${this.memRead(1)};`);
            L.push(`sr = (sr & ~4) | ((V & ${bitExpr}) === 0 ? 4 : 0);`);
            L.push(`V = (V ${op} ${bitExpr}) & 0xff;`);
            store('V', ins.idx + (ins.len >> 1), ins.cyc);
          }
        }
        break;
      }
      case K.EXG: {
        if (aux === 0) L.push(`V = d[${dReg}]; d[${dReg}] = d[${sReg}]; d[${sReg}] = V;`);
        else if (aux === 1) L.push(`V = a[${dReg}]; a[${dReg}] = a[${sReg}]; a[${sReg}] = V;`);
        else L.push(`V = d[${dReg}]; d[${dReg}] = a[${sReg}]; a[${sReg}] = V;`);
        break;
      }
      case K.LINK: {
        L.push('A = (a[7] - 4) >>> 0;');
        L.push(`if (!((A - RB >>> 0) < 0xfffc || (A - 0x01000000 >>> 0) < 0xfffc)) { cyc += ${billedBefore}; cpu.pc = ${pc}; break loop; }`);
        L.push(`V = a[${sReg}];`);
        L.push(this.memWrite(4));
        L.push(`a[${sReg}] = A;`);
        L.push(`a[7] = (A + ${b}) >>> 0;`);
        break;
      }
      case K.UNLK: {
        L.push(`A = a[${sReg}];`);
        L.push(`if (!((A - RB >>> 0) < 0xfffc || (A - 0x01000000 >>> 0) < 0xfffc)) { cyc += ${billedBefore}; cpu.pc = ${pc}; break loop; }`);
        L.push('V = rd32(A);');
        L.push('a[7] = (A + 4) >>> 0;');
        L.push(`a[${sReg}] = V >>> 0;`);
        break;
      }
      case K.PEA: {
        L.push(`V = ${this.addrExpr(sx, sReg, b, c)};`);
        L.push('A = (a[7] - 4) >>> 0;');
        L.push(`if (!((A - RB >>> 0) < 0xfffc || (A - 0x01000000 >>> 0) < 0xfffc)) { cyc += ${billedBefore}; cpu.pc = ${pc}; break loop; }`);
        L.push(this.memWrite(4));
        L.push('a[7] = A;');
        break;
      }
      case K.MOVEM: {
        const mask = b & 0xffff;
        const toRegs = flag1 === 1;
        const step = size;
        let bits = 0;
        for (let i = 0; i < 16; i++) if (mask & (1 << i)) bits++;
        const span = bits * step;
        const startExpr = sx === XM_PI || sx === XM_PD ? `a[${sReg}]` : this.addrExpr(sx, sReg, c, 0);
        if (sx === XM_PD) {
          L.push(`A = (${startExpr} - ${span}) >>> 0;`);
          L.push(`if (!((A - RB >>> 0) < ${0x10000 - span} || (A - 0x01000000 >>> 0) < ${0x10000 - span})) { cyc += ${billedBefore}; cpu.pc = ${pc}; break loop; }`);
          L.push(`a[${sReg}] = A;`);
          let k = 0;
          for (let i = 0; i < 16; i++) {
            if (!(mask & (1 << i))) continue;
            const r = 15 - i;
            const src = r < 8 ? `d[${r}]` : `a[${r - 8}]`;
            const at = span - ++k * step;
            L.push(`V = ${src}; { const P = (A + ${at}) >>> 0; ${this.memWriteAt('P', size)} }`);
          }
        } else {
          L.push(`A = ${startExpr};`);
          if (toRegs) {
            L.push(`if (!(A < ${0x01000000 - span} || (A - RB >>> 0) < ${0x10000 - span} || (A - 0x01000000 >>> 0) < ${0x10000 - span})) { cyc += ${billedBefore}; cpu.pc = ${pc}; break loop; }`);
          } else {
            L.push(`if (!((A - RB >>> 0) < ${0x10000 - span} || (A - 0x01000000 >>> 0) < ${0x10000 - span})) { cyc += ${billedBefore}; cpu.pc = ${pc}; break loop; }`);
          }
          let at = 0;
          for (let i = 0; i < 16; i++) {
            if (!(mask & (1 << i))) continue;
            const reg = i < 8 ? `d[${i}]` : `a[${i - 8}]`;
            if (toRegs) {
              const rd = size === 4 ? `rd32((A + ${at}) >>> 0)` : `rd16((A + ${at}) >>> 0)`;
              L.push(size === 4 ? `${reg} = ${rd};` : `${reg} = (((${rd}) << 16) >> 16) >>> 0;`);
            } else {
              L.push(`V = ${reg}; { const P = (A + ${at}) >>> 0; ${this.memWriteAt('P', size)} }`);
            }
            at += step;
          }
          if (sx === XM_PI) L.push(`a[${sReg}] = (A + ${span}) >>> 0;`);
        }
        break;
      }
      case K.MUL_W: {
        const src = read(sx, sReg, b, c);
        L.push(`V = ${src};`);
        L.push(`cpu.sr = sr & 0xffff; cpu.regionMulW(${flag1 === 1}, V, ${dReg}); sr = cpu.sr | 0;`);
        break;
      }
      case K.MUL_L: {
        const src = read(sx, sReg, b, c);
        L.push(`V = ${src};`);
        L.push(`cpu.sr = sr & 0xffff; cpu.regionMulL(${flag1 === 1}, V, ${dReg}); sr = cpu.sr | 0;`);
        break;
      }
      case K.DIV_W: {
        const src = read(sx, sReg, b, c);
        L.push(`V = ${src};`);
        L.push(`if (V === 0) { cyc += ${billedBefore}; cpu.pc = ${pc}; break loop; }`);
        L.push(`cpu.sr = sr & 0xffff; cpu.regionDivW(${flag1 === 1}, V, ${dReg}); sr = cpu.sr | 0;`);
        break;
      }
      case K.DIV_L: {
        const src = read(sx, sReg, b, c);
        L.push(`V = ${src};`);
        L.push(`if (V === 0) { cyc += ${billedBefore}; cpu.pc = ${pc}; break loop; }`);
        L.push(`cpu.sr = sr & 0xffff; cpu.regionDivL(${flag1 === 1}, V, ${dReg}, ${aux}); sr = cpu.sr | 0;`);
        break;
      }
      default:
        throw new Error(`emit gap for kind ${ins.k}`);
    }
    void msb;
  }

  private memWriteAt(v: string, size: number): string {
    return this.memWrite(size).split('A').join(v).split(`r${v}m`).join('ram').split(`sr${v}m`).join('sram');
  }

  private emitAluToReg(L: string[], aux: number, dReg: number, size: number,
      nBits: number, msb: number, writeD: (r: number, e: string) => string): void {
    const mask = size === 4 ? '0xffffffff' : size === 2 ? '0xffff' : '0xff';
    const dd = size === 4 ? `d[${dReg}]` : `(d[${dReg}] & ${mask})`;
    switch (aux) {
      case AluOp.Or: case AluOp.And: {
        const op = aux === AluOp.Or ? '|' : '&';
        L.push(`V = ((${dd} ${op} V) & ${mask});`);
        if (size === 4) L.push('V = V >>> 0;');
        L.push(`sr = (sr & ~0xf) | (V === 0 ? 4 : 0) | ((V >>> ${nBits}) & 8);`);
        L.push(writeD(dReg, 'V'));
        break;
      }
      case AluOp.Add:
        L.push(`{ const dd = ${dd}; const sum = dd + V; const r = sum & ${mask};`
          + (size === 4 ? ' const ru = r >>> 0;' : ' const ru = r;')
          + ` sr = (sr & ~0x1f) | (sum > ${mask === '0xffffffff' ? '0xffffffff' : mask} ? 0x11 : 0)`
          + ` | (((V ^ ru) & (dd ^ ru) & ${msb}) !== 0 ? 2 : 0)`
          + ` | (ru === 0 ? 4 : 0) | ((ru >>> ${nBits}) & 8); V = ru; }`);
        L.push(writeD(dReg, 'V'));
        break;
      case AluOp.Sub:
        L.push(`{ const dd = ${dd}; const diff = dd - V; const ru = ${size === 4 ? 'diff >>> 0' : `diff & ${mask}`};`
          + ' sr = (sr & ~0x1f) | (diff < 0 ? 0x11 : 0)'
          + ` | (((V ^ dd) & (dd ^ ru) & ${msb}) !== 0 ? 2 : 0)`
          + ` | (ru === 0 ? 4 : 0) | ((ru >>> ${nBits}) & 8); V = ru; }`);
        L.push(writeD(dReg, 'V'));
        break;
      default:
        L.push(`{ const dd = ${dd}; const diff = dd - V; const ru = ${size === 4 ? 'diff >>> 0' : `diff & ${mask}`};`
          + ' sr = (sr & ~0xf) | (diff < 0 ? 1 : 0)'
          + ` | (((V ^ dd) & (dd ^ ru) & ${msb}) !== 0 ? 2 : 0)`
          + ` | (ru === 0 ? 4 : 0) | ((ru >>> ${nBits}) & 8); }`);
        break;
    }
  }

  private emitAluToMem(L: string[], aux: number, sReg: number, size: number,
      nBits: number, msb: number): void {
    const mask = size === 4 ? '0xffffffff' : size === 2 ? '0xffff' : '0xff';
    const sv = size === 4 ? `d[${sReg}]` : `(d[${sReg}] & ${mask})`;
    switch (aux) {
      case AluOp.Or: case AluOp.And: case AluOp.Eor: {
        const op = aux === AluOp.Or ? '|' : aux === AluOp.And ? '&' : '^';
        L.push(`V = ((V ${op} ${sv}) & ${mask});`);
        if (size === 4) L.push('V = V >>> 0;');
        L.push(`sr = (sr & ~0xf) | (V === 0 ? 4 : 0) | ((V >>> ${nBits}) & 8);`);
        break;
      }
      case AluOp.Add:
        L.push(`{ const s = ${sv}; const sum = V + s; const ru = ${size === 4 ? 'sum >>> 0' : `sum & ${mask}`};`
          + ` sr = (sr & ~0x1f) | (sum > ${mask} ? 0x11 : 0)`
          + ` | (((s ^ ru) & (V ^ ru) & ${msb}) !== 0 ? 2 : 0)`
          + ` | (ru === 0 ? 4 : 0) | ((ru >>> ${nBits}) & 8); V = ru; }`);
        break;
      default:
        L.push(`{ const s = ${sv}; const diff = V - s; const ru = ${size === 4 ? 'diff >>> 0' : `diff & ${mask}`};`
          + ' sr = (sr & ~0x1f) | (diff < 0 ? 0x11 : 0)'
          + ` | (((s ^ V) & (V ^ ru) & ${msb}) !== 0 ? 2 : 0)`
          + ` | (ru === 0 ? 4 : 0) | ((ru >>> ${nBits}) & 8); V = ru; }`);
        break;
    }
  }

  private emitAddSubImmReg(L: string[], dReg: number, imm: number, isSub: boolean,
      size: number, nBits: number, msb: number, writeD: (r: number, e: string) => string): void {
    const mask = size === 4 ? '0xffffffff' : size === 2 ? '0xffff' : '0xff';
    const dd = size === 4 ? `d[${dReg}]` : `(d[${dReg}] & ${mask})`;
    if (isSub) {
      L.push(`{ const dd = ${dd}; const diff = dd - ${imm}; V = ${size === 4 ? 'diff >>> 0' : `diff & ${mask}`};`
        + ' sr = (sr & ~0x1f) | (diff < 0 ? 0x11 : 0)'
        + ` | (((${imm} ^ dd) & (dd ^ V) & ${msb}) !== 0 ? 2 : 0)`
        + ` | (V === 0 ? 4 : 0) | ((V >>> ${nBits}) & 8); }`);
    } else {
      L.push(`{ const dd = ${dd}; const sum = dd + ${imm}; V = ${size === 4 ? 'sum >>> 0' : `sum & ${mask}`};`
        + ` sr = (sr & ~0x1f) | (sum > ${mask} ? 0x11 : 0)`
        + ` | (((${imm} ^ V) & (dd ^ V) & ${msb}) !== 0 ? 2 : 0)`
        + ` | (V === 0 ? 4 : 0) | ((V >>> ${nBits}) & 8); }`);
    }
    L.push(writeD(dReg, 'V'));
  }

  private emitAddSubImmMem(L: string[], imm: number, isSub: boolean,
      size: number, nBits: number, msb: number): void {
    const mask = size === 4 ? '0xffffffff' : size === 2 ? '0xffff' : '0xff';
    if (isSub) {
      L.push(`{ const diff = V - ${imm}; const ru = ${size === 4 ? 'diff >>> 0' : `diff & ${mask}`};`
        + ' sr = (sr & ~0x1f) | (diff < 0 ? 0x11 : 0)'
        + ` | (((${imm} ^ V) & (V ^ ru) & ${msb}) !== 0 ? 2 : 0)`
        + ` | (ru === 0 ? 4 : 0) | ((ru >>> ${nBits}) & 8); V = ru; }`);
    } else {
      L.push(`{ const sum = V + ${imm}; const ru = ${size === 4 ? 'sum >>> 0' : `sum & ${mask}`};`
        + ` sr = (sr & ~0x1f) | (sum > ${mask} ? 0x11 : 0)`
        + ` | (((${imm} ^ ru) & (V ^ ru) & ${msb}) !== 0 ? 2 : 0)`
        + ` | (ru === 0 ? 4 : 0) | ((ru >>> ${nBits}) & 8); V = ru; }`);
    }
  }

  private addrExpr(x: number, reg: number, payload: number, payload2: number): string {
    switch (x) {
      case XM_AI: return `a[${reg}]`;
      case XM_PI: return `a[${reg}]`;
      case XM_PD: return `((a[${reg}] - ${payload}) >>> 0)`;
      case XM_D16: return `((a[${reg}] + ${payload}) >>> 0)`;
      case XM_IX: return this.briefExpr(`a[${reg}]`, payload);
      case XM_AW: case XM_AL: case XM_PCD: return `${payload >>> 0}`;
      case XM_PCIX: return this.briefExpr(`${payload2 >>> 0}`, payload);
      default: throw new Error(`no address for xmode ${x}`);
    }
  }

  private commitAddrSideEffects(L: string[], x: number, reg: number, payload: number): void {
    if (x === XM_PI) L.push(`a[${reg}] = (a[${reg}] + ${payload}) >>> 0;`);
    else if (x === XM_PD) L.push(`a[${reg}] = A;`);
  }

  private briefExpr(baseExpr: string, p: number): string {
    const reg = (p >>> 16) & 15;
    const raw = reg < 8 ? `d[${reg}]` : `a[${reg - 8}]`;
    const index = p & 0x100000 ? `(${raw} | 0)` : `((${raw} << 16) >> 16)`;
    const scale = (p >>> 21) & 3;
    const disp = (p << 24) >> 24;
    return `((${baseExpr} + (${index} << ${scale}) + ${disp}) >>> 0)`;
  }

  private memRead(size: number): string {
    return size === 1 ? 'rd8(A)' : size === 2 ? 'rd16(A)' : 'rd32(A)';
  }

  private memWrite(size: number): string {
    if (size === 1) {
      return 'if ((A - RB >>> 0) < 0x10000) sram[A - RB] = V; else ram[A & 0xffff] = V;';
    }
    if (size === 2) {
      return 'if ((A - RB >>> 0) < 0x10000) { sram[A - RB] = V >>> 8; sram[A - RB + 1] = V; }'
        + ' else { ram[A & 0xffff] = V >>> 8; ram[(A + 1) & 0xffff] = V; }';
    }
    return 'if ((A - RB >>> 0) < 0x10000) { const t = A - RB; sram[t] = V >>> 24; sram[t + 1] = V >>> 16; sram[t + 2] = V >>> 8; sram[t + 3] = V; }'
      + ' else { ram[A & 0xffff] = V >>> 24; ram[(A + 1) & 0xffff] = V >>> 16; ram[(A + 2) & 0xffff] = V >>> 8; ram[(A + 3) & 0xffff] = V; }';
  }

  private busWrite(size: number): string {
    if (size === 1) return 'bus.write8(A, V & 0xff);';
    if (size === 2) return 'bus.write16(A, V & 0xffff);';
    return 'bus.write16(A, (V >>> 16) & 0xffff); bus.write16((A + 2) >>> 0, V & 0xffff);';
  }
}

const SUPPORTED = new Set<number>([
  K.NOP, K.MOVEQ, K.MOVE, K.MOVEA, K.LEA, K.TST, K.CLR, K.NOT, K.EXT, K.EXTB,
  K.SWAP, K.ALU, K.CMPA, K.ADDA, K.ADDQ, K.IMM_ALU, K.SCC, K.BITOP_DYN, K.BITOP_IMM,
  K.SHIFT_REG, K.EXG, K.LINK, K.UNLK, K.PEA, K.MOVEM,
  K.MUL_W, K.MUL_L, K.DIV_W, K.DIV_L,
]);

function ccExpr(cc: number): string {
  switch (cc) {
    case 0x0: return 'true';
    case 0x1: return 'false';
    case 0x2: return '((sr & 5) === 0)';
    case 0x3: return '((sr & 5) !== 0)';
    case 0x4: return '((sr & 1) === 0)';
    case 0x5: return '((sr & 1) !== 0)';
    case 0x6: return '((sr & 4) === 0)';
    case 0x7: return '((sr & 4) !== 0)';
    case 0x8: return '((sr & 2) === 0)';
    case 0x9: return '((sr & 2) !== 0)';
    case 0xa: return '((sr & 8) === 0)';
    case 0xb: return '((sr & 8) !== 0)';
    case 0xc: return '((((sr >> 3) ^ (sr >> 1)) & 1) === 0)';
    case 0xd: return '((((sr >> 3) ^ (sr >> 1)) & 1) !== 0)';
    case 0xe: return '((sr & 4) === 0 && (((sr >> 3) ^ (sr >> 1)) & 1) === 0)';
    default: return '((sr & 4) !== 0 || (((sr >> 3) ^ (sr >> 1)) & 1) !== 0)';
  }
}
