import { Predecode, type PredecodeVariant } from './m68kpredecode';
import type { Bus16 } from './bus68k';

export const REASON_OK = 0;
export const REASON_BUDGET = 1;
export const REASON_FALLBACK = 2;
export const REASON_IRQ = 3;
export const REASON_DIRTY = 4;

const PAGE_WORDS = 2048;

function decodeB64(b64: string): Uint8Array {
  const g = globalThis as unknown as { atob?: (s: string) => string; Buffer?: { from(s: string, e: string): Uint8Array } };
  if (g.Buffer) return g.Buffer.from(b64, 'base64');
  const bin = g.atob!(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface Exports {
  memory: WebAssembly.Memory;
  _start(): void;
  configure(codeBase: number, words: number, romSize: number, ramLen: number, cartLen: number, sramLen: number): number;
  setSramBase(base: number): void;
  setRegions(...args: number[]): void;
  setDacPeriod(p: number): void;
  getRegD(): number;
  getStateBase(): number;
  getMetaKind(): number;
  getMetaLen(): number;
  getMetaCyc(): number;
  getMetaHead(): number;
  getMetaTail(): number;
  getMetaA(): number;
  getMetaB(): number;
  getMetaC(): number;
  getRomOff(): number;
  getRamOff(): number;
  getCartOff(): number;
  getSramOff(): number;
  getRamSeenOff(): number;
  getCodeMapOff(): number;
  setRamCode(on: number): void;
  run(budget: number): number;
  stepOne(): number;
}

const C_SR = 16;
const C_PC = 17;
const C_USED = 18;
const C_LAST = 21;
const C_PC0 = 22;
const C_TRAP_PEN = 23;
const C_CARRY = 24;
const C_CARRY_TAIL = 25;
const C_HEAD = 26;
const C_TAIL = 27;
const C_OTHER_SP = 28;
const C_VBR = 29;
const C_IRQ_OTHER = 30;
const C_DAC_IN = 31;
const C_DAC_PENDING = 32;
const C_AVEC6 = 33;
const C_BUDGET = 20;
const C_SINK_WRITES = 35;
const C_INSTRS = 38;
const C_IRQ6_TAKEN = 39;
const C_INSTR_START = 40;
const C_PEN_IN = 41;
const C_LAST_PC = 44;

export interface Cpu32Regions {
  romTop: number;
  cs0Hi: number;
  romWordPen: number;
  romBytePen: number;
  cartBase: number;
  cartSize: number;
  ramBase: number;
  ramSize: number;
  ramWordPen: number;
  ramBytePen: number;
  cs2Lo: number;
  cs2Size: number;
  cs2WordPen: number;
  cs2BytePen: number;
  cs2WriteProtect: boolean;
  watchLo: number;
  watchSize: number;
  shadowBase: number;
  shadowSize: number;
  sinkBase: number;
  sinkSize: number;
  cs1WordPen: number;
  cs1BytePen: number;
}

export class M68kWasm {
  private readonly ex: Exports;
  readonly d: Uint32Array<ArrayBuffer>;
  readonly a: Uint32Array<ArrayBuffer>;
  readonly ram: Uint8Array<ArrayBuffer>;
  readonly cart: Uint8Array<ArrayBuffer>;
  readonly sram: Uint8Array<ArrayBuffer>;
  private readonly s: Uint32Array<ArrayBuffer>;
  private readonly si: Int32Array<ArrayBuffer>;
  private readonly sb: Uint8Array<ArrayBuffer>;
  private readonly pd: Predecode;
  private readonly mKind: Uint8Array<ArrayBuffer>;
  private readonly mLen: Uint8Array<ArrayBuffer>;
  private readonly mCyc: Uint8Array<ArrayBuffer>;
  private readonly mHead: Int8Array<ArrayBuffer>;
  private readonly mTail: Int8Array<ArrayBuffer>;
  private readonly mA: Int32Array<ArrayBuffer>;
  private readonly mB: Int32Array<ArrayBuffer>;
  private readonly mC: Int32Array<ArrayBuffer>;
  readonly present: Uint8Array;
  readonly nWords: number;
  readonly codeBase: number;
  pagesMarshalled = 0;
  private readonly ramWords: number;
  private readonly ramSeen: Uint8Array;
  private readonly codeMap: Uint8Array;
  private readonly variant: PredecodeVariant;
  private ramPd: Predecode | null = null;
  private ramCodeBase = 0;
  private ramCodeSize = 0;
  ramWordsMarshalled = 0;

  constructor(opts: {
    wasmBytes: Uint8Array | string;
    bus: Bus16;
    variant: PredecodeVariant;
    codeBase: number;
    romBytes: Uint8Array;
    ramSize: number;
    cartSize?: number;
    sramSize?: number;
    onTrapPre: () => void;
    onTrapPost: (write: boolean) => void;
    fetchPen: (addr: number) => number;
  }) {
    const bytes = typeof opts.wasmBytes === 'string' ? decodeB64(opts.wasmBytes) : opts.wasmBytes;
    const bus = opts.bus;
    const pre = opts.onTrapPre;
    const post = opts.onTrapPost;
    const env = {
      abort(_msg: number, _file: number, line: number, col: number) {
        throw new Error(`wasm abort at ${line}:${col}`);
      },
      trapRead8: (a: number) => { pre(); const v = bus.read8(a >>> 0) & 0xff; post(false); return v; },
      trapRead16: (a: number) => { pre(); const v = bus.read16(a >>> 0) & 0xffff; post(false); return v; },
      trapWrite8: (a: number, v: number) => { pre(); bus.write8(a >>> 0, v & 0xff); post(true); },
      trapWrite16: (a: number, v: number) => { pre(); bus.write16(a >>> 0, v & 0xffff); post(true); },
      trapFetchPen: (a: number) => opts.fetchPen(a >>> 0) | 0,
    };
    const module = new WebAssembly.Module(bytes as unknown as BufferSource);
    const instance = new WebAssembly.Instance(module, { env });
    this.ex = instance.exports as unknown as Exports;
    this.ex._start();

    const nWords = opts.romBytes.length >> 1;
    this.nWords = nWords;
    this.variant = opts.variant;
    const ramWords = opts.variant === 'cpu32' ? opts.ramSize >> 1 : 0;
    this.ramWords = ramWords;
    const metaWords = nWords + ramWords;
    this.codeBase = opts.codeBase >>> 0;
    const cartSize = opts.cartSize ?? 0;
    const sramSize = opts.sramSize ?? 0;
    const total = this.ex.configure(
      opts.codeBase >>> 0, nWords, opts.romBytes.length, opts.ramSize, cartSize, sramSize,
    ) >>> 0;

    const mem = this.ex.memory;
    const need = Math.ceil(total / 65536);
    const have = mem.buffer.byteLength / 65536;
    if (need > have) mem.grow(need - have);
    const buf = mem.buffer as ArrayBuffer;

    const regD = this.ex.getRegD();
    this.d = new Uint32Array(buf, regD, 8);
    this.a = new Uint32Array(buf, regD + 32, 8);
    const sbase = this.ex.getStateBase();
    this.s = new Uint32Array(buf, sbase, 0x21000 >> 2);
    this.si = new Int32Array(buf, sbase, 0x21000 >> 2);
    this.sb = new Uint8Array(buf, sbase, 256);

    new Uint8Array(buf, this.ex.getRomOff(), opts.romBytes.length).set(opts.romBytes);
    this.ram = new Uint8Array(buf, this.ex.getRamOff(), opts.ramSize);
    this.cart = cartSize > 0 ? new Uint8Array(buf, this.ex.getCartOff(), cartSize) : new Uint8Array(new ArrayBuffer(0));
    this.sram = sramSize > 0 ? new Uint8Array(buf, this.ex.getSramOff(), sramSize) : new Uint8Array(new ArrayBuffer(0));

    this.pd = new Predecode(opts.codeBase, opts.romBytes, opts.variant);
    this.mKind = new Uint8Array(buf, this.ex.getMetaKind(), metaWords);
    this.mLen = new Uint8Array(buf, this.ex.getMetaLen(), metaWords);
    this.mCyc = new Uint8Array(buf, this.ex.getMetaCyc(), metaWords);
    this.mHead = new Int8Array(buf, this.ex.getMetaHead(), metaWords);
    this.mTail = new Int8Array(buf, this.ex.getMetaTail(), metaWords);
    this.mA = new Int32Array(buf, this.ex.getMetaA(), metaWords);
    this.mB = new Int32Array(buf, this.ex.getMetaB(), metaWords);
    this.mC = new Int32Array(buf, this.ex.getMetaC(), metaWords);
    this.present = new Uint8Array((nWords + PAGE_WORDS - 1) >> 11);
    this.ramSeen = new Uint8Array(buf, this.ex.getRamSeenOff(), ramWords);
    this.codeMap = new Uint8Array(buf, this.ex.getCodeMapOff(), (opts.ramSize >> 5) + 1);
  }

  setRamCode(base: number, size: number): void {
    base >>>= 0;
    if (this.ramWords === 0) size = 0;
    if (this.ramPd !== null && base === this.ramCodeBase && size === this.ramCodeSize) return;
    this.invalidateAllRam();
    this.ramCodeBase = base;
    this.ramCodeSize = size;
    this.ramPd = size > 0 ? new Predecode(base, this.ram, this.variant, true) : null;
    this.ex.setRamCode(size > 0 ? 1 : 0);
  }

  invalidateAllRam(): void {
    if (this.ramWords === 0) return;
    this.mKind.fill(0, this.nWords);
    this.ramSeen.fill(0);
    this.codeMap.fill(0);
    if (this.ramPd !== null) this.ramPd = new Predecode(this.ramCodeBase, this.ram, this.variant, true);
  }

  ramWritten(off: number, n: number): void {
    const map = this.codeMap;
    if ((map[off >> 5] | map[(off + n - 1) >> 5]) === 0) return;
    const last = (off + n - 1) >> 1;
    for (let s = Math.max(0, (off >> 1) - 4); s <= last; s++) {
      if (this.ramSeen[s] === 0) continue;
      const i = this.nWords + s;
      if (s * 2 + this.mLen[i] > off) {
        this.mKind[i] = 0;
        this.ramSeen[s] = 0;
        this.ramPd!.forget(s);
      }
    }
  }

  get predecode(): Predecode { return this.pd; }

  wordIndex(pc: number): number {
    const rel = ((pc >>> 0) - this.codeBase) >>> 0;
    if ((rel & 1) === 0 && (rel >>> 1) < this.nWords) return rel >>> 1;
    if (this.ramCodeSize > 0) {
      const off = ((pc >>> 0) - this.ramCodeBase) >>> 0;
      if ((off & 1) === 0 && off < this.ramCodeSize) return this.nWords + (off >>> 1);
    }
    return -1;
  }

  needsMarshal(idx: number): boolean {
    return idx < this.nWords ? this.present[idx >> 11] === 0 : this.ramSeen[idx - this.nWords] === 0;
  }

  marshal(idx: number): void {
    if (idx < this.nWords) { this.marshalPage(idx); return; }
    const r = idx - this.nWords;
    const pd = this.ramPd!;
    pd.forget(r);
    const page = pd.page(r);
    pd.kindAt(r, page);
    const o = r & 2047;
    this.mKind[idx] = page.kind[o];
    this.mLen[idx] = page.len[o];
    this.mCyc[idx] = page.cyc[o];
    this.mHead[idx] = page.c32Head[o];
    this.mTail[idx] = page.c32Tail[o];
    this.mA[idx] = page.a[o];
    this.mB[idx] = page.b[o];
    this.mC[idx] = page.c[o];
    this.ramSeen[r] = 1;
    const start = r * 2;
    const end = start + Math.max(2, page.len[o]);
    for (let b = start >> 5; b <= (end - 1) >> 5; b++) this.codeMap[b] = 1;
    this.ramWordsMarshalled++;
  }

  needsPage(pc: number): boolean {
    const idx = this.wordIndex(pc);
    return idx >= 0 && this.present[idx >> 11] === 0;
  }

  marshalPage(idx: number): void {
    const pageNo = idx >> 11;
    if (this.present[pageNo]) return;
    const page = this.pd.page(idx);
    const start = pageNo << 11;
    const end = Math.min(start + PAGE_WORDS, this.nWords);
    for (let i = start; i < end; i++) {
      this.pd.kindAt(i, page);
      const o = i & 2047;
      this.mKind[i] = page.kind[o];
      this.mLen[i] = page.len[o];
      this.mCyc[i] = page.cyc[o];
      this.mHead[i] = page.c32Head[o];
      this.mTail[i] = page.c32Tail[o];
      this.mA[i] = page.a[o];
      this.mB[i] = page.b[o];
      this.mC[i] = page.c[o];
    }
    this.present[pageNo] = 1;
    this.pagesMarshalled++;
  }

  kindAt(pc: number): number {
    const idx = this.wordIndex(pc);
    return idx < 0 ? -1 : this.mKind[idx];
  }

  get sr(): number { return this.s[C_SR]; }
  set sr(v: number) { this.s[C_SR] = v >>> 0; }
  get pc(): number { return this.s[C_PC]; }
  set pc(v: number) { this.s[C_PC] = v >>> 0; }
  get used(): number { return this.si[C_USED]; }
  get last(): number { return this.si[C_LAST]; }
  get instrStart(): number { return this.si[C_INSTR_START]; }
  get pc0(): number { return this.s[C_PC0]; }
  get lastPc(): number { return this.s[C_LAST_PC]; }
  markDirty(): void { this.sb[76] = 1; }
  set trapPen(v: number) { this.si[C_TRAP_PEN] = v | 0; }
  capBudget(cap: number): void { if (cap < this.si[C_BUDGET]) this.si[C_BUDGET] = cap | 0; }
  get penIn(): number { return this.si[C_PEN_IN]; }
  set penIn(v: number) { this.si[C_PEN_IN] = v | 0; }
  get carry(): number { return this.si[C_CARRY]; }
  set carry(v: number) { this.si[C_CARRY] = v | 0; }
  get carryTail(): number { return this.si[C_CARRY_TAIL]; }
  set carryTail(v: number) { this.si[C_CARRY_TAIL] = v | 0; }
  get head(): number { return this.si[C_HEAD]; }
  set head(v: number) { this.si[C_HEAD] = v | 0; }
  get tail(): number { return this.si[C_TAIL]; }
  set tail(v: number) { this.si[C_TAIL] = v | 0; }
  get otherSp(): number { return this.s[C_OTHER_SP]; }
  set otherSp(v: number) { this.s[C_OTHER_SP] = v >>> 0; }
  set vbr(v: number) { this.s[C_VBR] = v >>> 0; }
  set irqOther(v: number) { this.s[C_IRQ_OTHER] = v >>> 0; }
  get dacIn(): number { return this.si[C_DAC_IN]; }
  set dacIn(v: number) { this.si[C_DAC_IN] = v | 0; }
  get dacPending(): boolean { return this.s[C_DAC_PENDING] !== 0; }
  set dacPending(v: boolean) { this.s[C_DAC_PENDING] = v ? 1 : 0; }
  set avec6(v: boolean) { this.s[C_AVEC6] = v ? 1 : 0; }
  takeSinkWrites(): number { const n = this.s[C_SINK_WRITES]; this.s[C_SINK_WRITES] = 0; return n; }
  get sinkHi(): number { return this.sb[144]; }
  get sinkLo(): number { return this.sb[145]; }
  setSink(hi: number, lo: number): void { this.sb[144] = hi & 0xff; this.sb[145] = lo & 0xff; }
  setShadow(b4: number, b5: number, b6: number, b7: number): void {
    this.sb[148] = b4 & 0xff; this.sb[149] = b5 & 0xff; this.sb[150] = b6 & 0xff; this.sb[151] = b7 & 0xff;
  }
  get instrs(): number { return this.s[C_INSTRS]; }
  set runStart(v: number) { this.s[43] = v >>> 0; }
  trace(n = 32): { pc: number; total: number; surch: number; head: number; tail: number; carry: number; at: number }[] {
    const pos = this.s[42];
    const out = [];
    for (let i = n; i >= 1; i--) {
      const slot = (pos - i) & 4095;
      const e = 256 + slot * 8;
      out.push({ pc: this.s[e], total: this.si[e + 1], surch: this.si[e + 2], head: this.si[e + 3], tail: this.si[e + 4], carry: this.si[e + 5], at: this.s[e + 6] });
    }
    return out;
  }
  get irq6Taken(): number { return this.s[C_IRQ6_TAKEN]; }

  static readonly DAC_NEVER = 0x7fffffff;

  setSramBase(base: number): void { this.ex.setSramBase(base >>> 0); }
  setDacPeriod(p: number): void { this.ex.setDacPeriod(p | 0); }
  setRegions(r: Cpu32Regions): void {
    this.ex.setRegions(
      r.romTop >>> 0, r.cs0Hi >>> 0, r.romWordPen | 0, r.romBytePen | 0,
      r.cartBase >>> 0, r.cartSize >>> 0,
      r.ramBase >>> 0, r.ramSize >>> 0, r.ramWordPen | 0, r.ramBytePen | 0,
      r.cs2Lo >>> 0, r.cs2Size >>> 0, r.cs2WordPen | 0, r.cs2BytePen | 0, r.cs2WriteProtect ? 1 : 0,
      r.watchLo >>> 0, r.watchSize >>> 0,
      r.shadowBase >>> 0, r.shadowSize >>> 0, r.sinkBase >>> 0, r.sinkSize >>> 0,
      r.cs1WordPen | 0, r.cs1BytePen | 0,
    );
  }

  run(budget: number): number { return this.ex.run(budget | 0); }
  stepOne(): number { return this.ex.stepOne(); }
}
