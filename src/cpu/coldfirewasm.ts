import { Predecode } from './m68kpredecode';
import type { Bus16 } from './bus68k';
import { COLDFIRE_WASM_B64 } from './coldfirewasm.data';

export const REASON_OK = 0;
export const REASON_BUDGET = 1;
export const REASON_FALLBACK = 2;

function defaultWasmBytes(): Uint8Array {
  const g = globalThis as unknown as { atob?: (s: string) => string; Buffer?: { from(s: string, e: string): Uint8Array } };
  if (g.Buffer) return g.Buffer.from(COLDFIRE_WASM_B64, 'base64');
  const bin = g.atob!(COLDFIRE_WASM_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface Exports {
  memory: WebAssembly.Memory;
  _start(): void;
  configure(codeBase: number, words: number, romSize: number, ramBase: number, ramLen: number, sramLen: number): number;
  setSramBase(base: number): void;
  setRamBase(base: number): void;
  getRegD(): number;
  getStateSr(): number;
  getStatePc(): number;
  getStateUsed(): number;
  getStateDirty(): number;
  getMetaKind(): number;
  getMetaLen(): number;
  getMetaCyc(): number;
  getMetaA(): number;
  getMetaB(): number;
  getMetaC(): number;
  getRomOff(): number;
  getRamOff(): number;
  getSramOff(): number;
  run(budget: number): number;
  stepOne(): number;
}

export class ColdfireWasm {
  private readonly ex: Exports;
  readonly d: Uint32Array<ArrayBuffer>;
  readonly a: Uint32Array<ArrayBuffer>;
  readonly ram: Uint8Array<ArrayBuffer>;
  readonly sram: Uint8Array<ArrayBuffer>;
  private readonly state: DataView;
  private readonly srOff: number;
  private readonly pcOff: number;
  private readonly usedOff: number;

  onDeviceTime: ((pre: number) => void) | null = null;
  private tickedThisRun = 0;
  private dirty!: Uint8Array;
  private markDirty(): void { this.dirty[0] = 1; }

  constructor(opts: {
    wasmBytes?: Uint8Array | ArrayBuffer;
    bus: Bus16;
    codeBase: number;
    romBytes: Uint8Array;
    ramBase: number;
    ramSize: number;
    sramSize?: number;
  }) {
    const bytes = opts.wasmBytes
      ? (opts.wasmBytes instanceof Uint8Array ? opts.wasmBytes : new Uint8Array(opts.wasmBytes))
      : defaultWasmBytes();
    const bus = opts.bus;
    const catchUp = () => {
      if (!this.onDeviceTime) return;
      const pre = this.used - this.tickedThisRun;
      if (pre > 0) { this.onDeviceTime(pre); this.tickedThisRun += pre; }
    };
    const env = {
      abort(_msg: number, _file: number, line: number, col: number) {
        throw new Error(`wasm abort at ${line}:${col}`);
      },
      trapRead8: (a: number) => { catchUp(); return bus.read8(a >>> 0) & 0xff; },
      trapRead16: (a: number) => { catchUp(); return bus.read16(a >>> 0) & 0xffff; },
      trapWrite8: (a: number, v: number) => { catchUp(); bus.write8(a >>> 0, v & 0xff); this.markDirty(); },
      trapWrite16: (a: number, v: number) => { catchUp(); bus.write16(a >>> 0, v & 0xffff); this.markDirty(); },
    };
    const module = new WebAssembly.Module(bytes as unknown as BufferSource);
    const instance = new WebAssembly.Instance(module, { env });
    this.ex = instance.exports as unknown as Exports;
    this.ex._start();

    const nWords = opts.romBytes.length >> 1;
    const sramSize = opts.sramSize ?? 0;
    const total = this.ex.configure(
      opts.codeBase >>> 0, nWords, opts.romBytes.length, opts.ramBase >>> 0, opts.ramSize, sramSize,
    ) >>> 0;

    const mem = this.ex.memory;
    const need = Math.ceil(total / 65536);
    const have = mem.buffer.byteLength / 65536;
    if (need > have) mem.grow(need - have);
    const buf = mem.buffer;

    const regD = this.ex.getRegD();
    this.d = new Uint32Array(buf, regD, 8);
    this.a = new Uint32Array(buf, regD + 32, 8);
    this.state = new DataView(buf);
    this.srOff = this.ex.getStateSr();
    this.pcOff = this.ex.getStatePc();
    this.usedOff = this.ex.getStateUsed();
    this.dirty = new Uint8Array(buf, this.ex.getStateDirty(), 1);

    new Uint8Array(buf, this.ex.getRomOff(), opts.romBytes.length).set(opts.romBytes);
    this.ram = new Uint8Array(buf, this.ex.getRamOff(), opts.ramSize);
    this.sram = sramSize > 0 ? new Uint8Array(buf, this.ex.getSramOff(), sramSize) : new Uint8Array(0);

    const pd = new Predecode(opts.codeBase, opts.romBytes);
    const kind = new Uint8Array(buf, this.ex.getMetaKind(), nWords);
    const len = new Uint8Array(buf, this.ex.getMetaLen(), nWords);
    const cyc = new Uint8Array(buf, this.ex.getMetaCyc(), nWords);
    const mA = new Int32Array(buf, this.ex.getMetaA(), nWords);
    const mB = new Int32Array(buf, this.ex.getMetaB(), nWords);
    const mC = new Int32Array(buf, this.ex.getMetaC(), nWords);
    for (let idx = 0; idx < nWords; idx++) {
      const page = pd.page(idx);
      pd.kindAt(idx, page);
      const o = idx & 2047;
      kind[idx] = page.kind[o];
      len[idx] = page.len[o];
      cyc[idx] = page.cyc[o];
      mA[idx] = page.a[o];
      mB[idx] = page.b[o];
      mC[idx] = page.c[o];
    }
  }

  get sr(): number { return this.state.getUint32(this.srOff, true) >>> 0; }
  set sr(v: number) { this.state.setUint32(this.srOff, v >>> 0, true); }
  get pc(): number { return this.state.getUint32(this.pcOff, true) >>> 0; }
  set pc(v: number) { this.state.setUint32(this.pcOff, v >>> 0, true); }
  get used(): number { return this.state.getInt32(this.usedOff, true); }

  setSramBase(base: number): void { this.ex.setSramBase(base >>> 0); }
  setRamBase(base: number): void { this.ex.setRamBase(base >>> 0); }

  run(budget: number): number { this.tickedThisRun = 0; return this.ex.run(budget | 0); }
  stepOne(): number { return this.ex.stepOne(); }
}
