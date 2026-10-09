
import type { Machine } from '../src/machine/machine';
import type { DiagEntry } from './diaglog';

export const DENY = new Set([
  'bus', 'hooks', 'rom', 'sampleRom', 'onIllegal', 'onSnap',
  'ioLog', 'strayReads', 'strays', 'txLog', 'reads', 'writes', 'mbusLog',
  'paySeen', 'phaseTable', 'payFrame', 'ccHoppers',
  'orange1', 'orange2', 'dil1', 'dil2',
  'switchIds',
  'coinLockStated',
  'okiVolumeManual',
  'volumeApplies', 'volumeV9',
  'audioSource',
  'mirrored',
  'ring', 'chunk',
  'reelStripOffsets',
  'boardDefaults', 'boardDefaultsStated',
  'cfCycles', 'c32Cycles', 'c32Tails', 'c32Heads',
  'predecode', 'regions',
  'allListsCache', 'coinTableCache',
  'wasm', 'wasmMode', 'wasmBytesOverride',
  'rxQueue',
  'opticStart', 'opticWidth',
  'indexStart', 'indexEnd', 'indexPattern',
  'stepsPerRevolution', 'symbols',
  'mfmeJpm', 'mame',
  'tonePeriods',
  'hoppersFlag',
  'meterInPence', 'meterOutPence', 'meterInMult', 'meterOutMult', 'meterMapFitted',
  'meterMapStated', 'meterPencePerPulse', 'secInMult', 'secOutMult',
  'hopperCoinPence', 'hopperCoinRecords', 'tokenPayout', 'payoutUnits',
  'slidePence', 'triacSlides', 'tokenInMeter', 'tokenOutMeter', 'coinPence', 'coinTables',
  'portMap', 'portMapFromLayout',
  'meterLedgerMult', 'secLedgerMult', 'meterInMultRaw', 'meterOutMultRaw', 'moneyGrid',
  'dip1', 'dip2', 'dip3', 'dips', 'dsw', 'dsw2', 'rotary', 'pct', 'percentKey', 'stakeKey',
  'jackpotKey', 'keyCode', 'stakeBits', 'stakeWire', 'jackpotWire', 'fittedStake',
  'fittedPrize', 'fittedPercentage', 'optionSwitches1', 'doorMask', 'doorSwitches', 'panel',
  'varStake', 'bnvKey', 'desKeys', 'desFitted', 'machineCode',
  'partBnvKeys',
  'dilLabels',
  'hoppersWord', 'hopperBits', 'hopperType', 'hopperOpto', 'reel56Optos', 'hopperMotor', 'parHopperFitted',
  'hopperLaw', 'hopper2Fitted', 'payoutLag',
  'lampTestPass',
  'vendHoppers', 'serialHopper',
  'mechType', 'binaryMech', 'vendBus', 'vendHopper', 'vendMech', 'vendNote', 'nv4Fitted', 'secFitted', 'secDetect', 'dataPakType',
  'dataportFitted', 'updFitted', 'dotFitted', 'fpgaDesign', 'muxType', 'lampExtender',
  'segmentedAlpha', 'bd1Drawn', 'drawsHidden',
  'alphaRoute', 'alphaDrawn',
  'ledType', 'soundType', 'protocol', 'phoenix2', 'reelMux', 'reelOpticInverted',
  'reelFromLayout', 'reelFit', 'numReels', 'reelJumpers', 'mux5Extended',
  'reelBounce', 'bounce',
  'sampleTable', 'sampleBankMask', 'sampleBankBases', 'packSamples',
  'presentMask', 'tabs', 'windows', 'reelBoard', 'reelInverted',
  'romTop', 'romHigh', 'romPages', 'romLength', 'bankCount', 'commandAddr', 'phrases',
  'phraseRates',
  'driftBase',
  'r.steps', 'r.winStart', 'r.winEnd', 'r.inverted', 'r.present',
  'sreels.steps', 'sreels.present', 'sreels.optoStart', 'sreels.optoWidth',
  'sreels.inverted', 'sreels.band', 'sreels.flip',
  'reels.steps', 'reels.adjust', 'reels.present',
  'pic.config', 'pic.identity', 'pic.type',
  'characteriser.table',
  'seg7.mode',
  'security.key',
  'sound.loaded',
  'coin.switches',
  'sec.fingerprint',
  'sec.stallTimeout',
  'sec.clockAtReset',
  'sec.v20',
]);

const classConfig = new WeakMap<object, ReadonlySet<string> | null>();
function configOf(v: any): ReadonlySet<string> | null {
  const c = v?.constructor;
  if (typeof c !== 'function' || c === Object) return null;
  let s = classConfig.get(c);
  if (s === undefined) {
    const list = (c as { snapshotConfig?: readonly string[] }).snapshotConfig;
    s = Array.isArray(list) ? new Set(list) : null;
    classConfig.set(c, s);
  }
  return s;
}

export function skipped(owner: unknown, parent: string, k: string): boolean {
  return DENY.has(k) || DENY.has(`${parent}.${k}`) || !!configOf(owner)?.has(k);
}

type TypedArray =
  | Uint8Array | Int8Array | Uint16Array | Int16Array
  | Uint32Array | Int32Array | Float32Array | Float64Array;

function isTypedArray(v: unknown): v is TypedArray {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

function bytesToB64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const PAGED_MIN_BYTES = 1 << 20;
const PAGE_BYTES = 1 << 16;

function pageIsZero(bytes: Uint8Array, at: number, end: number): boolean {
  if (((bytes.byteOffset + at) & 3) === 0 && ((end - at) & 3) === 0) {
    const w = new Uint32Array(bytes.buffer, bytes.byteOffset + at, (end - at) >> 2);
    for (let i = 0; i < w.length; i++) if (w[i] !== 0) return false;
    return true;
  }
  for (let i = at; i < end; i++) if (bytes[i] !== 0) return false;
  return true;
}

function storeTa(name: string, ta: TypedArray): { $ta: string; d?: string; n?: number; p?: Record<string, string> } {
  const bytes = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
  if (bytes.length < PAGED_MIN_BYTES) return { $ta: name, d: bytesToB64(bytes) };
  const p: Record<string, string> = {};
  for (let at = 0; at < bytes.length; at += PAGE_BYTES) {
    const end = Math.min(at + PAGE_BYTES, bytes.length);
    if (!pageIsZero(bytes, at, end)) p[at / PAGE_BYTES] = bytesToB64(bytes.subarray(at, end));
  }
  return { $ta: name, n: bytes.length, p };
}

function restoreTa(cur: unknown, dv: any): void {
  if (!isTypedArray(cur)) return;
  const dst = new Uint8Array(cur.buffer, cur.byteOffset, cur.byteLength);
  if (typeof dv.d === 'string') { dst.set(b64ToBytes(dv.d)); return; }
  if (dv.p && typeof dv.p === 'object') {
    dst.fill(0);
    for (const k of Object.keys(dv.p)) {
      const at = Number(k) * PAGE_BYTES;
      const page = b64ToBytes(dv.p[k]);
      if (at + page.length <= dst.length) dst.set(page, at);
    }
  }
}

function snap(v: any, raw: boolean, seen: WeakSet<object> = new WeakSet(), parent = ''): unknown {
  if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
    return v;
  }
  if (isTypedArray(v)) {
    if (raw) return { $ta: v.constructor.name, buf: v.slice() };
    return storeTa(v.constructor.name, v);
  }
  if (Array.isArray(v)) {
    if (seen.has(v)) return undefined;
    seen.add(v);
    const out = v.map((x) => snap(x, raw, seen, parent));
    seen.delete(v);
    return out;
  }
  if (v instanceof Map || v instanceof Set) return undefined;
  if (typeof v === 'object') {
    if (seen.has(v)) return undefined;
    seen.add(v);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      if (skipped(v, parent, k)) continue;
      const val = v[k];
      if (typeof val === 'function') continue;
      const s = snap(val, raw, seen, k);
      if (s !== undefined) out[k] = s;
    }
    seen.delete(v);
    return out;
  }
  return undefined;
}

function toStored(x: any): any {
  if (!x || typeof x !== 'object') return x;
  if (typeof x.$ta === 'string' && isTypedArray(x.buf)) return storeTa(x.$ta, x.buf as TypedArray);
  if (typeof x.$ta === 'string') return x;
  if (Array.isArray(x)) return x.map(toStored);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(x)) out[k] = toStored(x[k]);
  return out;
}

function isTaSnap(x: any): x is { $ta: string; d?: string; n?: number; p?: Record<string, string> } {
  return x && typeof x === 'object' && typeof x.$ta === 'string';
}

function isReadOnlyAccessor(obj: any, k: string): boolean {
  for (let o = obj; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (d) return d.get !== undefined && d.set === undefined;
  }
  return false;
}

function restore(target: any, data: any, parent = ''): void {
  if (!target || !data || typeof data !== 'object') return;
  for (const k of Object.keys(data)) {
    if (skipped(target, parent, k)) continue;
    const dv = data[k];
    const cur = target[k];
    if (isTaSnap(dv)) {
      restoreTa(cur, dv);
      continue;
    }
    if (Array.isArray(dv)) {
      if (!Array.isArray(cur)) {
        if ((cur === null || cur === undefined) && !isReadOnlyAccessor(target, k)
          && dv.every((x: unknown) => x === null || typeof x !== 'object')) {
          target[k] = [...dv];
        }
        continue;
      }
      for (let i = 0; i < dv.length; i++) {
        const di = dv[i];
        if (isTaSnap(di)) {
          restoreTa(cur[i], di);
        } else if (di && typeof di === 'object' && cur[i] && typeof cur[i] === 'object') {
          restore(cur[i], di, k);
        } else {
          cur[i] = di;
        }
      }
      continue;
    }
    if (dv && typeof dv === 'object') {
      if (cur && typeof cur === 'object') restore(cur, dv, k);
      continue;
    }
    if (isReadOnlyAccessor(target, k)) continue;
    target[k] = dv;
  }
  const steps = target.steps;
  if (typeof steps === 'number' && steps > 0) {
    for (const p of ['pos', 'reelpos']) {
      if (typeof target[p] === 'number' && target[p] >= steps) target[p] %= steps;
    }
  }
}

export const SNAPSHOT_VERSION = 27;

export interface Snapshot {
  format: 'fruitulator-snapshot';
  version: number;
  game: string;
  cycles: number;
  state: unknown;
  diag?: DiagEntry[];
}

export type RawSnapshot = Snapshot;

export function captureStateRaw(m: Machine, game: string): RawSnapshot {
  return {
    format: 'fruitulator-snapshot',
    version: SNAPSHOT_VERSION,
    game,
    cycles: (m as any).totalCycles ?? 0,
    state: snap(m, true),
  };
}

export function serializeState(s: RawSnapshot): Snapshot {
  return { ...s, state: toStored(s.state) };
}

export function captureState(m: Machine, game: string): Snapshot {
  return serializeState(captureStateRaw(m, game));
}

export function applyState(m: Machine, snapshot: Snapshot): void {
  if (snapshot.format !== 'fruitulator-snapshot') {
    throw new Error('not a snapshot');
  }
  if ((snapshot.version ?? 0) !== SNAPSHOT_VERSION) {
    throw new Error(`snapshot version ${snapshot.version} is from an incompatible build (expected ${SNAPSHOT_VERSION})`);
  }
  restore(m, snapshot.state);
  for (const r of m.reels ?? []) {
    if (r && r.stepsPerRevolution > 0 && r.position >= r.stepsPerRevolution) r.position %= r.stepsPerRevolution;
  }
  (m as { postRestore?: () => void }).postRestore?.();
  const fault = m.restoredStateFault?.();
  if (fault) throw new Error(fault);
}
