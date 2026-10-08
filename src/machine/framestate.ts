import type { DigitKind, Machine } from './machine';
import type { DisplayKind as DeviceDisplayKind } from './layoutdisplay';
import { unservedComponents, type UnservedComponent } from './unserved';
import { Sc5LedBoard } from '../hw/sc5ledboard';
import { bfmLedBit } from '../hw/bfmled';

type LampKind = 'sc4' | 'byte256' | 'byte128' | 'mfmelevel' | 'bits128' | 'bits512'
  | 'epoch';
export type { DigitKind };
type DisplayKind = 'none' | DeviceDisplayKind;

export interface FrameLayout {
  format?: number;
  system: string;
  reelCount: number;
  reelsByLayoutNumber: boolean;
  lampsDriven: number;
  stepsPerRevolution: number[];
  symbols: number[];
  lampKind: LampKind;
  lampBytes: number;
  digitKind: DigitKind;
  digitBytes: number;
  displayKind: DisplayKind;
  hasSegs: boolean;
  diagBytes: number;
  diagRamBase: number;
  dutyBytes: number;
  dotBytes: number;
  lcdBytes: number;
  muxLedBytes: number;
  muxLedFirst: number;
  ledBytes: number;
  ledKind?: 'bfm' | 'plain';
  udfBytes: number;
  cellDots: boolean;
  videoWidth: number;
  videoHeight: number;
  videoBytes: number;
  effectBytes: number;
  reelStripOffsets?: number[];
  unserved: UnservedComponent[];
  byteLength: number;
}

const DIAG_RAM_BYTES: Readonly<Record<string, number>> = { SCORPION4: 4, SCORPION5: 3 };

const HEADER_BYTES = 28;
const REEL_BYTES = 12;
const OFF_EPOCH = 0;
const OFF_SEQ = 4;
const OFF_STEP_MS = 8;
const OFF_DROPPED_MS = 12;
const OFF_STEPS = 16;
const OFF_FLAGS = 20;
const OFF_REEL_COUNT = 21;
const OFF_LAMP_PHASE = 22;
const OFF_LAMP_DIM = 23;
const OFF_COIN_REFUSING = 24;
const OFF_COIN_SHUT = 26;

export const LAMP_FULL = 255;
export const LAMP_HALF = 128;

export const EPOCH_LAMP_LEVELS: readonly number[] =
  [0x28, 0x46, 0x64, 0x82, 0xa0, 0xbe, 0xdc, 0xff];

const FLAG_COIN_BUSY = 1;
const FLAG_HALTED = 2;
const FLAG_PAUSED = 4;

export const EFFECT_LINES = 16;
export const FRAME_FORMAT = 2;
const EFFECT_BYTES = (EFFECT_LINES * 2 + 2) * 4 + 4 + 4 + 4;
const TRIAC_LEVELS_KNOWN = 0x80000000;

export interface FrameEffects {
  readonly triacs: Uint32Array;
  readonly meters: Uint32Array;
  readonly hopperCoins: Uint32Array;
  readonly hopperMotors: number;
  readonly triacLevels: number | null;
  readonly meterLevels: number | null;
}

interface EffectBoard {
  triacLevels?: unknown;
  meterLevels?: unknown;
  triacPulses?: unknown; slidePulses?: unknown; slideCoins?: unknown; slideEjects?: unknown;
  meterCounts?: unknown; meterCount?: unknown; meterPulses?: unknown; meters?: unknown;
  meterSounds?: unknown;
  hopper?: unknown; hopper1?: unknown; hopper2?: unknown; hoppers?: unknown;
}

function lineCounts(v: unknown): ArrayLike<number> | null {
  if (v === null || typeof v !== 'object') return null;
  const a = v as ArrayLike<unknown>;
  return typeof a.length === 'number' && a.length > 0 && typeof a[0] === 'number'
    ? a as ArrayLike<number> : null;
}

function hopperOf(v: unknown): { paid: number; running: boolean } | null {
  if (v === null || typeof v !== 'object') return null;
  const h = v as { paid?: unknown; running?: unknown };
  return typeof h.paid === 'number' ? { paid: h.paid, running: h.running === true } : null;
}

function writeEffectCounters(m: Machine, dv: DataView, off: number): void {
  const b = m as unknown as EffectBoard;
  const triacs = lineCounts(b.triacPulses) ?? lineCounts(b.slidePulses)
    ?? lineCounts(b.slideCoins) ?? lineCounts(b.slideEjects);
  const meters = lineCounts(b.meterCounts) ?? lineCounts(b.meterCount)
    ?? lineCounts(b.meterPulses) ?? lineCounts(b.meters);
  const sounds = lineCounts(b.meterSounds);
  for (let i = 0; i < EFFECT_LINES; i++) {
    dv.setUint32(off + i * 4, triacs && i < triacs.length ? triacs[i] >>> 0 : 0, true);
    const n = (meters && i < meters.length ? meters[i] : 0) + (sounds && i < sounds.length ? sounds[i] : 0);
    dv.setUint32(off + (EFFECT_LINES + i) * 4, n >>> 0, true);
  }
  const list = Array.isArray(b.hoppers) ? b.hoppers : [];
  const h1 = hopperOf(b.hopper1) ?? hopperOf(b.hopper) ?? hopperOf(list[0]);
  const h2 = hopperOf(b.hopper2) ?? hopperOf(list[1]);
  const h = off + EFFECT_LINES * 8;
  dv.setUint32(h, (h1?.paid ?? 0) >>> 0, true);
  dv.setUint32(h + 4, (h2?.paid ?? 0) >>> 0, true);
  dv.setUint32(h + 8, (h1?.running ? 1 : 0) | (h2?.running ? 2 : 0), true);
  const lv = b.triacLevels;
  dv.setUint32(h + 12, typeof lv === 'number' ? ((lv & 0xffff) | TRIAC_LEVELS_KNOWN) >>> 0 : 0, true);
  const ml = b.meterLevels;
  dv.setUint32(h + 16, typeof ml === 'number' ? ((ml & 0xffff) | TRIAC_LEVELS_KNOWN) >>> 0 : 0, true);
}

function readEffectCounters(dv: DataView, off: number, bytes: number): FrameEffects {
  const triacs = new Uint32Array(EFFECT_LINES);
  const meters = new Uint32Array(EFFECT_LINES);
  for (let i = 0; i < EFFECT_LINES; i++) {
    triacs[i] = dv.getUint32(off + i * 4, true);
    meters[i] = dv.getUint32(off + (EFFECT_LINES + i) * 4, true);
  }
  const h = off + EFFECT_LINES * 8;
  const hopperCoins = new Uint32Array([dv.getUint32(h, true), dv.getUint32(h + 4, true)]);
  const lv = dv.getUint32(h + 12, true);
  const ml = h + 20 <= off + bytes ? dv.getUint32(h + 16, true) : 0;
  return {
    triacs, meters, hopperCoins, hopperMotors: dv.getUint32(h + 8, true),
    triacLevels: lv & TRIAC_LEVELS_KNOWN ? lv & 0xffff : null,
    meterLevels: ml & TRIAC_LEVELS_KNOWN ? ml & 0xffff : null,
  };
}

interface RawBoards {
  lamps?: Uint8Array;
  segDigits?: Uint8Array;
  digits?: Uint16Array;
  outputs?: { lamps: Uint8Array; segments?: Uint8Array; leds?: Uint8Array; dots?: Uint8Array };
}

function rawLamps(m: Machine, kind: LampKind): Uint8Array {
  const b = m as unknown as RawBoards;
  const grouped = kind === 'byte128' || kind === 'mfmelevel';
  return (grouped ? b.outputs?.lamps ?? b.lamps : b.lamps)!;
}

function rawDots(m: Machine): Uint8Array | null {
  return (m as unknown as RawBoards).outputs?.dots ?? null;
}

function rawDigits(m: Machine, kind: DigitKind): Uint8Array | Uint16Array | null {
  const b = m as unknown as RawBoards;
  if (kind === 'impact' || kind === 'proconn' || kind === 'words' || kind === 'byte16' || kind === 'byte64') return b.digits!;
  if (kind === 'sc4') return b.segDigits!;
  if (kind === 'space') return b.outputs!.segments!;
  if (kind === 'mpu4led') {
    const l = b.outputs!.leds!;
    return new Uint8Array(l.buffer, l.byteOffset, l.length * 2);
  }
  if (kind === 'mpu5') return b.segDigits!;
  return null;
}

interface VideoScreenSource { width: number; height: number; frame: Uint32Array; frameSerial: number }

function videoScreenOf(m: Machine): VideoScreenSource | null {
  const any = m as unknown as { ygv?: VideoScreenSource[] | null; video?: VideoScreenSource | null };
  return any.ygv?.[0] ?? any.video ?? null;
}

export function frameLayoutFor(
  system: string, m: Machine, cabLayout?: Uint8Array,
): FrameLayout {
  let lampKind: LampKind;
  const digitKind: DigitKind = m.digitKind ?? 'none';
  switch (system) {
    case 'SCORPION4':
      lampKind = 'sc4';
      break;
    case 'SCORPION2':
      lampKind = 'mfmelevel';
      break;
    case 'SCORPION1':
      lampKind = 'mfmelevel';
      break;
    case 'SYS85':
      lampKind = 'mfmelevel';
      break;
    case 'SYS5':
      lampKind = 'byte256';
      break;
    case 'MPU4':
    case 'MPU4VIDEO':
      lampKind = 'mfmelevel';
      break;
    case 'SPACE':
      lampKind = 'mfmelevel';
      break;
    case 'IMPACT':
      lampKind = 'mfmelevel';
      break;
    case 'M1AB':
      lampKind = 'mfmelevel';
      break;
    case 'MPU5':
      lampKind = 'mfmelevel';
      break;
    case 'SCORPION5':
    case 'ADDER5':
      lampKind = 'bits512';
      break;
    case 'EPOCH':
      lampKind = 'epoch';
      break;
    case 'MPS2':
      lampKind = 'byte256';
      break;
    case 'ASTRASYSA1':
      lampKind = 'mfmelevel';
      break;
    case 'PROCONN':
      lampKind = 'mfmelevel';
      break;
    case 'SYS1':
      lampKind = 'mfmelevel';
      break;
    case 'ELECTROCOIN':
      lampKind = 'mfmelevel';
      break;
    case 'PHOENIX':
    case 'PHOENIX2':
      lampKind = 'mfmelevel';
      break;
    case 'MPU3':
      lampKind = 'mfmelevel';
      break;
    case 'BLACKBOX':
      lampKind = 'byte256';
      break;
    case 'SRU':
    case 'SYSTEM80':
      lampKind = 'byte256';
      break;
    default:
      throw new Error(`frameLayoutFor: unknown system ${system}`);
  }
  const device = m.display as (typeof m.display & {
    cellWords?: Uint32Array; udfDots?: Uint8Array; cellDots?: Uint8Array; gfxDots?: Uint8Array;
  }) | null;
  const displayKind: DisplayKind = device?.kind ?? 'none';
  const hasSegs = !!device?.cellWords;
  const lampBytes = rawLamps(m, lampKind).length;
  const digits = rawDigits(m, digitKind);
  const digitBytes = digits ? digits.byteLength : 0;
  const charBytes = displayKind === 'none' ? 0 : 16;
  const segBytes = hasSegs ? 16 * 4 : 0;
  const driftBase = m.reelDriftBase;
  const diag = driftBase === undefined
    ? { base: 0, bytes: 0 }
    : { base: driftBase, bytes: DIAG_RAM_BYTES[system] ?? 0 };
  const diagBytes = diag.bytes;
  const dotBytes = system === 'SPACE' || system === 'SCORPION2'
    ? rawDots(m)?.length ?? 0 : 0;
  const lcdBytes = system === 'PROCONN' ? 80
    : system === 'EPOCH' ? 32 + 0x400
      : system === 'M1AB' && (m as unknown as { dot?: unknown }).dot ? 248 : 0;
  const ledBoard = (m as unknown as { ledBoard?: { colours: Uint32Array } }).ledBoard;
  const muxLedBytes = ledBoard ? ledBoard.colours.length * 4 : 0;
  const ledBytes = (m as unknown as { ledOutputs?: Uint8Array }).ledOutputs?.length ?? 0;
  const ledKind = (m as unknown as { ledKind?: 'bfm' | 'plain' }).ledKind ?? 'bfm';
  const dutyBytes = displayKind === 'none' ? 0 : 4;
  const cellDots = !device?.udfDots && !!device?.cellDots;
  const udfBytes = device?.udfDots ? 16 * 5 + (device.gfxDots?.length ?? 0) : cellDots ? 16 * 6 : 0;
  const screen = videoScreenOf(m);
  const videoWidth = screen?.width ?? 0;
  const videoHeight = screen?.height ?? 0;
  const videoBytes = screen ? 4 + videoWidth * videoHeight * 4 : 0;
  const reelCount = m.reels.length;
  const reelsByLayoutNumber = !!(m as unknown as { reelsByLayoutNumber?: boolean }).reelsByLayoutNumber;
  const lampsDriven = (m as unknown as { lampsDriven?: number }).lampsDriven ?? 0;
  const reelStripOffsets =
    (m as unknown as { reelStripOffsets?: number[] }).reelStripOffsets;
  return {
    system,
    unserved: unservedComponents(m, cabLayout, system, digitKind !== 'none'),
    reelStripOffsets,
    reelCount,
    reelsByLayoutNumber,
    lampsDriven,
    stepsPerRevolution: m.reels.map((r) => r.stepsPerRevolution),
    symbols: m.reels.map((r) => r.symbols),
    lampKind,
    lampBytes,
    digitKind,
    digitBytes,
    displayKind,
    hasSegs,
    diagBytes,
    diagRamBase: diag.base,
    dutyBytes,
    dotBytes,
    lcdBytes,
    muxLedBytes,
    muxLedFirst: muxLedBytes ? Sc5LedBoard.FIRST_LED : 0,
    ledBytes,
    ledKind,
    udfBytes,
    cellDots,
    videoWidth,
    videoHeight,
    videoBytes,
    format: FRAME_FORMAT,
    effectBytes: EFFECT_BYTES,
    byteLength:
      HEADER_BYTES + reelCount * REEL_BYTES + lampBytes + digitBytes + charBytes + segBytes
      + diagBytes + dutyBytes + dotBytes + lcdBytes + muxLedBytes + ledBytes + EFFECT_BYTES + udfBytes
      + videoBytes,
  };
}

export interface FrameMeta {
  epoch: number;
  seq: number;
  stepMs: number;
  droppedMs: number;
  steps: number;
  halted?: boolean;
  paused?: boolean;
}

export function captureFrame(
  m: Machine, layout: FrameLayout, buf: ArrayBuffer, meta: FrameMeta,
): void {
  const dv = new DataView(buf);
  dv.setUint32(OFF_EPOCH, meta.epoch, true);
  dv.setUint32(OFF_SEQ, meta.seq, true);
  dv.setFloat32(OFF_STEP_MS, meta.stepMs, true);
  dv.setFloat32(OFF_DROPPED_MS, meta.droppedMs, true);
  dv.setUint32(OFF_STEPS, meta.steps, true);
  dv.setUint8(OFF_FLAGS,
    (m.coinBusy ? FLAG_COIN_BUSY : 0)
    | (meta.halted ? FLAG_HALTED : 0)
    | (meta.paused ? FLAG_PAUSED : 0));
  dv.setUint8(OFF_REEL_COUNT, layout.reelCount);
  dv.setUint16(OFF_COIN_REFUSING, (m.coinRefusing ?? 0) & 0xffff, true);
  dv.setUint16(OFF_COIN_SHUT, (m.coinLinesShut ?? 0) & 0xffff, true);
  dv.setUint8(OFF_LAMP_PHASE,
    (m as unknown as { lampPhase?(): number }).lampPhase?.() ?? 0);
  dv.setUint8(OFF_LAMP_DIM,
    (m as unknown as { lampDim?(): number }).lampDim?.() ?? 0);

  let off = HEADER_BYTES;
  for (const r of m.reels) {
    dv.setInt32(off, r.travel | 0, true);
    dv.setUint16(off + 4, r.position, true);
    const sub = (r as { subStep?: number }).subStep ?? 0;
    dv.setUint8(off + 6, Math.min(255, Math.round(Math.abs(sub) * 255)));
    dv.setUint8(off + 7, sub < 0 ? 1 : 0);
    const bounce = (r as { bounce?: number }).bounce ?? 0;
    dv.setInt16(off + 8, Math.max(-32768, Math.min(32767, Math.round(bounce * 1000))), true);
    off += REEL_BYTES;
  }
  const bytes = new Uint8Array(buf);
  bytes.set(rawLamps(m, layout.lampKind), off);
  off += layout.lampBytes;
  const digits = rawDigits(m, layout.digitKind);
  if (digits) {
    bytes.set(
      digits instanceof Uint16Array
        ? new Uint8Array(digits.buffer, digits.byteOffset, digits.byteLength)
        : digits,
      off,
    );
    off += layout.digitBytes;
  }
  const hidden = (m.display as unknown as { hiddenCells?: () => number } | null)?.hiddenCells?.() ?? 0;
  if (layout.displayKind !== 'none') {
    bytes.set(m.display!.chars, off);
    if (hidden) for (let i = 0; i < 16; i++) if (hidden & (1 << i)) bytes[off + i] = 0;
    off += 16;
  }
  if (layout.hasSegs) {
    const cells = (m.display as unknown as { cellWords: Uint32Array }).cellWords;
    bytes.set(new Uint8Array(cells.buffer, cells.byteOffset, cells.byteLength), off);
    if (hidden) for (let i = 0; i < 16; i++) if (hidden & (1 << i)) dv.setUint32(off + i * 4, 0, true);
    off += 16 * 4;
  }
  if (layout.diagBytes) {
    const ram = (m as unknown as { ram: Uint8Array }).ram;
    for (let i = 0; i < layout.diagBytes; i++) bytes[off + i] = ram[layout.diagRamBase + i];
    off += layout.diagBytes;
  }
  if (layout.dutyBytes) {
    bytes[off] = m.display!.duty ?? 31;
    off += layout.dutyBytes;
  }
  if (layout.dotBytes) {
    bytes.set(rawDots(m)!, off);
    off += layout.dotBytes;
  }
  if (layout.lcdBytes) {
    const src = (m as unknown as { lcd?: { cells: Uint8Array } }).lcd?.cells
      ?? (m as unknown as { panelBytes?: () => Uint8Array }).panelBytes?.();
    if (src) bytes.set(src.subarray(0, layout.lcdBytes), off);
    off += layout.lcdBytes;
  }
  if (layout.muxLedBytes) {
    const colours = (m as unknown as { ledBoard: { colours: Uint32Array } }).ledBoard.colours;
    for (let i = 0; i < layout.muxLedBytes >> 2; i++) dv.setUint32(off + i * 4, colours[i], true);
    off += layout.muxLedBytes;
  }
  if (layout.ledBytes) {
    bytes.set((m as unknown as { ledOutputs: Uint8Array }).ledOutputs, off);
    off += layout.ledBytes;
  }
  writeEffectCounters(m, dv, off);
  off += layout.effectBytes;
  if (layout.udfBytes) {
    const d = m.display as unknown as { udfDots?: Uint8Array; cellDots?: Uint8Array; gfxDots?: Uint8Array } | null;
    const udf = layout.cellDots ? d?.cellDots : d?.udfDots;
    if (udf) bytes.set(udf.subarray(0, layout.udfBytes), off);
    if (!layout.cellDots && d?.gfxDots && layout.udfBytes > 16 * 5) {
      bytes.set(d.gfxDots, off + 16 * 5);
      if (hidden) for (let i = 0; i < 16; i++) if (hidden & (1 << i)) bytes[off + 16 * 5 + i * 6 + 5] = 0;
    }
    off += layout.udfBytes;
  }
  if (layout.videoBytes) {
    const chip = videoScreenOf(m)!;
    dv.setUint32(off, chip.frameSerial, true);
    bytes.set(new Uint8Array(chip.frame.buffer, chip.frame.byteOffset, layout.videoBytes - 4), off + 4);
    off += layout.videoBytes;
  }
}

export function decodeLamp(kind: LampKind, raw: Uint8Array, n: number, phase = 0): boolean {
  switch (kind) {
    case 'sc4':
      if (n >= 528 && n < 544 && (n >> 3) < raw.length) return (raw[n >> 3] & (1 << (n & 7))) !== 0;
      return (raw[((n >> 8) & 1) * 32 + ((n >> 3) & 31)] & (1 << (n & 7))) !== 0;
    case 'byte256':
      return n >= 0 && n < raw.length && raw[n] !== 0;
    case 'byte128':
      return n >= 0 && n < raw.length && raw[n] !== 0;
    case 'mfmelevel':
      return n >= 0 && n < raw.length && raw[n] !== 0;
    case 'epoch': {
      if (n < 0 || n >= raw.length) return false;
      const b = raw[n];
      if ((b & 1) === 0) return false;
      const rate = (b >> 1) & 7;
      if (rate === 0) return true;
      const list = Math.min(rate, 6) - 1;
      return ((phase >> list) & 1) !== (b >> 7);
    }
    case 'bits128':
      return (raw[(n >> 3) & 15] & (1 << (n & 7))) !== 0;
    case 'bits512': {
      const i = n >> 3;
      return (raw[i >= 0 && i < raw.length ? i : i & 63] & (1 << (n & 7))) !== 0;
    }
  }
}

export const MPU5_DIGITS = 72;

export function decodeDigitLevel(kind: DigitKind, raw: Uint8Array, n: number): number {
  if (kind === 'mpu4led') {
    const cells = raw.length / 2;
    return n >= 0 && n < cells ? raw[cells + n] : 0xff;
  }
  return 0xff;
}

export function decodeDigitSegLevel(kind: DigitKind, raw: Uint8Array, n: number, seg: number): number {
  if (kind === 'mpu5') {
    return n >= 0 && n < MPU5_DIGITS && seg >= 0 && seg < 8 ? raw[MPU5_DIGITS + n * 8 + seg] : 0xff;
  }
  return decodeDigitLevel(kind, raw, n);
}

export function decodeDigit(
  kind: DigitKind, raw: Uint8Array, u16: Uint16Array | null, n: number,
): number {
  switch (kind) {
    case 'impact':
      return u16![n & 15];
    case 'proconn':
      return n >= 0 && n < 8 ? u16![7 - n] : u16![n & 15];
    case 'words':
      return n >= 0 && n < u16!.length ? u16![n] : 0;
    case 'byte64':
      return raw[n & 63];
    case 'byte16':
      return raw[n & 15];
    case 'sc4':
      return n >= 0 && n < raw.length ? raw[n] : 0;
    case 'space':
      return raw[n & 0x3f];
    case 'mpu4led':
      return n >= 0 && n < raw.length / 2 ? raw[n] : 0;
    case 'mpu5':
      return n >= 0 && n < MPU5_DIGITS ? raw[n] : 0;
    case 'none':
      return 0;
  }
}

export function displayCells(_kind: DisplayKind): number {
  return 16;
}

export function decodeDisplayText(kind: DisplayKind, chars: Uint8Array): string {
  let s = '';
  for (let i = 0; i < displayCells(kind); i++) {
    const c = chars[i];
    switch (kind) {
      case 'bda':
        s += c === 0x21 ? '£' : c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ' ';
        break;
      case 'msc':
      case 'epochalpha':
        s += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : ' ';
        break;
      case 'mpu5alpha': {
        const ch = c & 0x7f;
        s += (ch >= 0x20 && ch <= 0x7e ? String.fromCharCode(ch) : ' ') + (c & 0x80 ? '.' : '');
        break;
      }
      case 's16':
        s += c === 0 ? ' ' : String.fromCharCode(c);
        break;
      default:
        s += ' ';
    }
  }
  return s;
}

export interface FrameReel {
  readonly position: number;
  readonly travel: number;
  readonly subStep: number;
  readonly bounce: number;
  readonly stepsPerRevolution: number;
  symbol(): number;
}

export interface FrameDisplay {
  readonly chars: Uint8Array;
  readonly cellWords?: Uint32Array;
  readonly duty?: number;
  text(): string;
  cellGlyph?(cell: number): Uint8Array | null;
  cellPunct?(cell: number): number;
  cellGfx?(cell: number): Uint8Array | null;
}

export class FrameView {
  readonly epoch: number;
  readonly lampPhase: number;
  readonly lampDim: number;
  readonly seq: number;
  readonly stepMs: number;
  readonly droppedMs: number;
  readonly steps: number;
  readonly coinBusy: boolean;
  readonly coinRefusing: number;
  readonly coinLinesShut: number;
  readonly halted: boolean;
  readonly paused: boolean;
  readonly reels: FrameReel[];
  readonly display: FrameDisplay | null;
  readonly lampsRaw: Uint8Array;
  readonly diagRam: Uint8Array;
  readonly dotsRaw: Uint8Array;
  readonly lcdRaw: Uint8Array;
  readonly videoRaw: Uint8Array;
  readonly videoSerial: number;
  readonly effects: FrameEffects;
  private readonly digitsRaw: Uint8Array;
  private readonly digitsU16: Uint16Array | null;

  constructor(readonly layout: FrameLayout, readonly buf: ArrayBuffer) {
    const dv = new DataView(buf);
    this.epoch = dv.getUint32(OFF_EPOCH, true);
    this.lampPhase = dv.getUint8(OFF_LAMP_PHASE);
    this.lampDim = dv.getUint8(OFF_LAMP_DIM);
    this.seq = dv.getUint32(OFF_SEQ, true);
    this.stepMs = dv.getFloat32(OFF_STEP_MS, true);
    this.droppedMs = dv.getFloat32(OFF_DROPPED_MS, true);
    this.steps = dv.getUint32(OFF_STEPS, true);
    const flags = dv.getUint8(OFF_FLAGS);
    this.coinBusy = (flags & FLAG_COIN_BUSY) !== 0;
    this.coinRefusing = dv.getUint16(OFF_COIN_REFUSING, true);
    this.coinLinesShut = dv.getUint16(OFF_COIN_SHUT, true);
    this.halted = (flags & FLAG_HALTED) !== 0;
    this.paused = (flags & FLAG_PAUSED) !== 0;

    let off = HEADER_BYTES;
    this.reels = [];
    for (let i = 0; i < layout.reelCount; i++) {
      const travel = dv.getInt32(off, true);
      const position = dv.getUint16(off + 4, true);
      const subStep = (dv.getUint8(off + 7) ? -1 : 1) * (dv.getUint8(off + 6) / 255);
      const bounce = dv.getInt16(off + 8, true) / 1000;
      const spr = layout.stepsPerRevolution[i];
      const symbols = layout.symbols[i];
      this.reels.push({
        position,
        travel,
        subStep,
        bounce,
        stepsPerRevolution: spr,
        symbol: () => Math.floor(position / (spr / symbols)) % symbols,
      });
      off += REEL_BYTES;
    }
    this.lampsRaw = new Uint8Array(buf, off, layout.lampBytes);
    off += layout.lampBytes;
    this.digitsRaw = new Uint8Array(buf, off, layout.digitBytes);
    this.digitsU16 = layout.digitKind === 'impact' || layout.digitKind === 'proconn' || layout.digitKind === 'words'
      ? new Uint16Array(buf, off, layout.digitBytes / 2)
      : null;
    off += layout.digitBytes;
    if (layout.displayKind !== 'none') {
      const chars = new Uint8Array(buf, off, displayCells(layout.displayKind));
      off += 16;
      const cellWords = layout.hasSegs ? new Uint32Array(buf, off, 16) : undefined;
      if (layout.hasSegs) off += 16 * 4;
      const kind = layout.displayKind;
      const duty = layout.dutyBytes ? new Uint8Array(buf, off + layout.diagBytes, 2) : null;
      const udf = layout.udfBytes
        ? new Uint8Array(buf, layout.byteLength - layout.udfBytes, layout.udfBytes) : null;
      this.display = {
        chars,
        cellWords,
        get duty() { return duty ? duty[0] : 31; },
        text: () => decodeDisplayText(kind, chars),
        cellGlyph: (cell: number) => {
          if (layout.cellDots) {
            const i = (cell & 15) * 6;
            return udf ? udf.subarray(i, i + 5) : null;
          }
          const c = chars[cell & 15];
          if (!udf || !(c & 0x80)) return null;
          const slot = c & 0x0f;
          return udf.subarray(slot * 5, slot * 5 + 5);
        },
        cellPunct: layout.cellDots && udf
          ? (cell: number) => udf[(cell & 15) * 6 + 5]
          : undefined,
        cellGfx: !layout.cellDots && udf && udf.length > 16 * 5
          ? (cell: number) => {
            const i = 16 * 5 + (cell & 15) * 6;
            return udf[i + 5] ? udf.subarray(i, i + 6) : null;
          }
          : undefined,
      };
    } else {
      this.display = null;
    }
    this.diagRam = new Uint8Array(buf, off, layout.diagBytes);
    off += layout.diagBytes + layout.dutyBytes;
    this.dotsRaw = new Uint8Array(buf, off, layout.dotBytes);
    this.lcdRaw = new Uint8Array(buf, off + layout.dotBytes, layout.lcdBytes);
    this.muxLedOffset = off + layout.dotBytes + layout.lcdBytes;
    this.ledsRaw = new Uint8Array(buf, this.muxLedOffset + layout.muxLedBytes, layout.ledBytes);
    this.effects = readEffectCounters(
      dv, layout.byteLength - layout.videoBytes - layout.udfBytes - layout.effectBytes, layout.effectBytes);
    const vOff = layout.byteLength - layout.videoBytes;
    this.videoSerial = layout.videoBytes ? dv.getUint32(vOff, true) : 0;
    this.videoRaw = new Uint8Array(buf, layout.videoBytes ? vOff + 4 : vOff, Math.max(0, layout.videoBytes - 4));
  }

  deviceText(): string {
    const t = this.display?.text() ?? '';
    if (this.layout.displayKind !== 'epochalpha' || t.trim() || this.lcdRaw.length < 16) return t;
    let s = '';
    for (let i = 0; i < 16; i++) {
      const c = this.lcdRaw[i];
      s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ' ';
    }
    return s;
  }

  private readonly muxLedOffset: number;

  private readonly ledsRaw: Uint8Array;

  ledServed(n: number): boolean {
    return n >= 0 && n < this.layout.ledBytes * 8;
  }

  layoutLed(n: number): boolean {
    if (this.layout.ledKind === 'plain') {
      return this.ledServed(n) && ((this.ledsRaw[n >> 3] >> (n & 7)) & 1) !== 0;
    }
    return bfmLedBit(this.ledsRaw, n);
  }

  muxLedColour(n: number): number {
    const i = n - this.layout.muxLedFirst;
    if (!this.layout.muxLedBytes || i < 0 || i * 4 >= this.layout.muxLedBytes) return 0;
    return new DataView(this.buf).getUint32(this.muxLedOffset + i * 4, true);
  }

  layoutLamp(n: number): boolean {
    if (this.beyondBoard(n)) return true;
    return decodeLamp(this.layout.lampKind, this.lampsRaw, n, this.lampPhase);
  }

  private beyondBoard(n: number): boolean {
    return this.layout.lampsDriven > 0 && n >= this.layout.lampsDriven;
  }

  get lampCount(): number {
    const k = this.layout.lampKind;
    return (k === 'sc4' || k === 'bits128' || k === 'bits512')
      ? this.layout.lampBytes * 8 : this.layout.lampBytes;
  }

  layoutLampLevel(n: number): number {
    if (this.beyondBoard(n)) return LAMP_FULL;
    if (!decodeLamp(this.layout.lampKind, this.lampsRaw, n, this.lampPhase)) return 0;
    if (this.layout.lampKind === 'epoch') {
      return (this.lampsRaw[n] & 0x40)
        ? EPOCH_LAMP_LEVELS[this.lampDim & 7] : LAMP_FULL;
    }
    if (this.layout.lampKind === 'mfmelevel') return this.lampsRaw[n];
    return LAMP_FULL;
  }

  layoutDigit(n: number): number {
    return decodeDigit(this.layout.digitKind, this.digitsRaw, this.digitsU16, n);
  }

  layoutDigitLevel(n: number): number {
    return decodeDigitLevel(this.layout.digitKind, this.digitsRaw, n);
  }

  layoutDigitSegLevel(n: number, seg: number): number {
    return decodeDigitSegLevel(this.layout.digitKind, this.digitsRaw, n, seg);
  }
}
