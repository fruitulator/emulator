
import { isAacsContainer, readAacsContainer } from './fml';
import SCORPION2 from './gameconfig/SCORPION2.json';
import SCORPION4 from './gameconfig/SCORPION4.json';
import SCORPION5 from './gameconfig/SCORPION5.json';
import MPU4 from './gameconfig/MPU4.json';
import MPU5 from './gameconfig/MPU5.json';
import IMPACT from './gameconfig/IMPACT.json';
import M1AB from './gameconfig/M1AB.json';
import SpACE from './gameconfig/SpACE.json';
import EPOCH from './gameconfig/EPOCH.json';
import SYSTEM80 from './gameconfig/SYSTEM80.json';
import SYS5 from './gameconfig/SYS5.json';
import MPS2 from './gameconfig/MPS2.json';
import ASTRASYSA1 from './gameconfig/ASTRASYSA1.json';
import SYS1 from './gameconfig/SYS1.json';
import BLACKBOX from './gameconfig/BLACKBOX.json';
import MPU3 from './gameconfig/MPU3.json';
import MMM from './gameconfig/MMM.json';
import MPU2 from './gameconfig/MPU2.json';
import SYS83 from './gameconfig/SYS83.json';
import ACEVIDEO from './gameconfig/ACEVIDEO.json';
import PLUTO5 from './gameconfig/PLUTO5.json';
import MPU4VIDEO from './gameconfig/MPU4VIDEO.json';
import PROCONN from './gameconfig/PROCONN.json';
import ELECTROCOIN from './gameconfig/ELECTROCOIN.json';
import SRU from './gameconfig/SRU.json';
import PHOENIX from './gameconfig/PHOENIX.json';
import PHOENIX2 from './gameconfig/PHOENIX2.json';
import SCORPION1 from './gameconfig/SCORPION1.json';
import SYS85 from './gameconfig/SYS85.json';

const TERMINATOR = 0xffffffff;

const STRING_TABLE_COUNTS = new Map([[0x43, 8], [0x44, 8], [0x45, 4]]);

function stringTableSpan(
  payload: Uint8Array, offset: number, hostTagByte: number, count: number,
): number {
  let pos = offset;
  for (let i = 1; i < count; i++) {
    if (pos + 4 > payload.length) return pos - offset;
    const len = u32(payload, pos);
    if (len > hostTagByte) return pos - offset;
    if (pos + 4 + len > payload.length) return pos - offset;
    pos += 4 + len;
  }
  return pos - offset;
}

function u32(b: Uint8Array, at: number): number {
  return ((b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0);
}

let tagReadRecorder: ((tag: number) => void) | null = null;
export function recordTagReads(cb: ((tag: number) => void) | null): void {
  tagReadRecorder = cb;
}
class RecordingTagMap extends Map<number, Uint8Array> {
  constructor(private readonly rec: (tag: number) => void) { super(); }
  override get(tag: number): Uint8Array | undefined { this.rec(tag); return super.get(tag); }
  override has(tag: number): boolean { this.rec(tag); return super.has(tag); }
}

export function fileLevelTags(payload: Uint8Array): Map<number, Uint8Array> {
  const out = tagReadRecorder ? new RecordingTagMap(tagReadRecorder) : new Map<number, Uint8Array>();
  let pos = 0;
  while (pos + 8 <= payload.length) {
    const tag = u32(payload, pos);
    const length = u32(payload, pos + 4);
    pos += 8;
    if (tag === TERMINATOR) break;
    if (length > payload.length - pos) break;
    out.set(tag, payload.subarray(pos, pos + length));
    pos += length;
    const count = STRING_TABLE_COUNTS.get(tag);
    if (count !== undefined) pos += stringTableSpan(payload, pos, tag & 0xff, count);
  }
  return out;
}

export function dipSwitchLabels(payload: Uint8Array): string[] | null {
  let found = false;
  const out = new Array<string>(20).fill('');
  let pos = 0;
  while (pos + 8 <= payload.length) {
    const tag = u32(payload, pos);
    const length = u32(payload, pos + 4);
    pos += 8;
    if (tag === TERMINATOR) break;
    if (length > payload.length - pos) break;
    const count = STRING_TABLE_COUNTS.get(tag);
    if (count === undefined) { pos += length; continue; }
    tagReadRecorder?.(tag);
    found = true;
    const first = tag === 0x43 ? 0 : tag === 0x44 ? 8 : 16;
    let at = pos;
    let len = length;
    for (let i = 0; i < count; i++) {
      if (at + len > payload.length || len > (tag & 0xff)) break;
      let s = '';
      for (let k = 0; k < len && payload[at + k] !== 0; k++) s += String.fromCharCode(payload[at + k]);
      out[first + i] = s.trim();
      at += len;
      if (i + 1 >= count) break;
      if (at + 4 > payload.length) break;
      len = u32(payload, at);
      at += 4;
    }
    pos += length + stringTableSpan(payload, pos + length, tag & 0xff, count);
  }
  return found ? out : null;
}

export function dipSwitchLabelsFrom(layout: Uint8Array | undefined): string[] | null {
  const payload = decodedLayout(layout);
  return payload ? dipSwitchLabels(payload) : null;
}

export function mfmeVersion(payload: Uint8Array): string | null {
  const value = fileLevelTags(payload).get(MFME_VERSION_TAG);
  if (!value || value.length === 0) return null;

  const wide = value.length >= 4 && value[1] === 0 && value[3] === 0;
  let s = '';
  for (let i = 0; i + (wide ? 1 : 0) < value.length; i += wide ? 2 : 1) {
    const ch = wide ? value[i] | (value[i + 1] << 8) : value[i];
    if (ch === 0) break;
    s += String.fromCharCode(ch);
  }
  return s.trim() || null;
}

const MFME_VERSION_TAG = 0x2f;

export function mfmeMajor(payload: Uint8Array): number | null {
  const digits = /(\d+)/.exec(mfmeVersion(payload) ?? '');
  return digits ? Number(digits[1]) : null;
}

export interface Control {
  kind: string;
  storage: string;
  tag?: string;
  tags?: string[];
  byteOffset?: number;
  encoding?: string;
  values?: Record<string, number | number[]>;
  byteIndex?: number | null;
  mask?: number | null;
  inverted?: boolean | null;
  meterTriacBlock?: {
    byteOffset: number;
    rowCount: number;
    rowStride: number;
    rowLayout: { meterIn: number; meterOut: number; triacIn: number; triacOut: number };
  };
  secBlock?: {
    byteOffset: number;
    entryCount: number;
    entryStride: number;
    entryLayout: { in: number; out: number };
  };
  inMultiplierValues?: Record<string, number>;
  outMultiplierValues?: Record<string, number>;
  rows?: number;
  rowStride?: number;
  fields?: Record<string, { byteOffset: number; encoding?: string }>;
  confirmedEffectCodes?: Record<string, number>;
}

interface SystemMap { system: string; controls: Record<string, Control> }

const MAPS: Record<string, SystemMap> = {
  SCORPION2: SCORPION2 as SystemMap,
  SCORPION4: SCORPION4 as SystemMap,
  SCORPION5: SCORPION5 as SystemMap,
  MPU4: MPU4 as SystemMap,
  MPU5: MPU5 as SystemMap,
  IMPACT: IMPACT as SystemMap,
  M1AB: M1AB as SystemMap,
  SPACE: SpACE as SystemMap,
  EPOCH: EPOCH as SystemMap,
  SYSTEM80: SYSTEM80 as SystemMap,
  MPS2: MPS2 as SystemMap,
  SYS5: SYS5 as SystemMap,
  ASTRASYSA1: ASTRASYSA1 as SystemMap,
  SYS1: SYS1 as SystemMap,
  PROCONN: PROCONN as SystemMap,
  ELECTROCOIN: ELECTROCOIN as SystemMap,
  SRU: SRU as SystemMap,
  PHOENIX: PHOENIX as SystemMap,
  PHOENIX2: PHOENIX2 as SystemMap,
  SCORPION1: SCORPION1 as SystemMap,
  SYS85: SYS85 as SystemMap,
  BLACKBOX: BLACKBOX as SystemMap,
  MPU3: MPU3 as unknown as SystemMap,
  MMM: MMM as unknown as SystemMap,
  MPU2: MPU2 as unknown as SystemMap,
  SYS83: SYS83 as unknown as SystemMap,
  ACEVIDEO: ACEVIDEO as unknown as SystemMap,
  PLUTO5: PLUTO5 as unknown as SystemMap,
  MPU4VIDEO: MPU4VIDEO as unknown as SystemMap,
  MPU4PLASMA: MPU4 as SystemMap,
};

export function gameConfigControls(system: string): Readonly<Record<string, Readonly<Control>>> | null {
  return MAPS[normalise(system)]?.controls ?? null;
}

export function hasGameConfig(system: string): boolean {
  return normalise(system) in MAPS;
}

export function hasControl(system: string, control: string): boolean {
  return !!MAPS[normalise(system)]?.controls[control];
}

function normalise(system: string): string {
  return system.replace(/[\s_-]/g, '').toUpperCase();
}

export function readSetting(
  payload: Uint8Array,
  system: string,
  control: string,
): string | null {
  const map = MAPS[normalise(system)];
  const spec = map?.controls[control];
  if (!spec || spec.storage !== 'fml' || !spec.values) return null;

  const tagText = spec.tag ?? spec.tags?.[0];
  if (!tagText) return null;
  const tag = Number(tagText);
  if (!Number.isFinite(tag)) return null;

  const value = fileLevelTags(payload).get(tag);
  if (!value) return null;

  if (spec.kind === 'checkbox') return null;
  const offset = spec.byteOffset ?? 0;
  if (value.length < offset + 4) return null;
  const chosen = u32(value, offset);

  for (const [name, v] of Object.entries(spec.values)) {
    if (typeof v === 'number' && v === chosen) return name;
  }
  return null;
}

export function readSwitchNumber(
  payload: Uint8Array,
  system: string,
  control: string,
): number | null {
  const spec = MAPS[normalise(system)]?.controls[control];
  if (!spec || spec.storage !== 'fml' || spec.kind !== 'switch-number') return null;

  const tagText = spec.tag ?? spec.tags?.[0];
  if (!tagText) return null;
  const tag = Number(tagText);
  if (!Number.isFinite(tag)) return null;

  const value = fileLevelTags(payload).get(tag);
  if (!value || value.length < 4) return null;
  const n = u32(value, 0);
  return n === 255 ? null : n;
}

export function readOperatorSwitch(
  payload: Uint8Array,
  system: string,
  control: string,
): { line: number; invert: boolean } | null {
  const spec = MAPS[normalise(system)]?.controls[control];
  if (!spec || spec.storage !== 'fml' || spec.kind !== 'switch-number') return null;

  const tagText = spec.tag ?? spec.tags?.[0];
  if (!tagText) return null;
  const tag = Number(tagText);
  if (!Number.isFinite(tag)) return null;

  return readOperatorTag(payload, tag);
}

export function readOperatorTag(payload: Uint8Array, tag: number): { line: number; invert: boolean } | null {
  const value = fileLevelTags(payload).get(tag);
  if (!value || value.length < 4) return null;
  const raw = u32(value, 0) | 0;
  if (raw < 0) return { line: -raw, invert: true };
  return raw === 255 ? null : { line: raw, invert: false };
}

export function readLayoutWord(payload: Uint8Array, tag: number): number | null {
  const value = fileLevelTags(payload).get(tag);
  return value && value.length >= 4 ? u32(value, 0) : null;
}

export function readNumber(
  payload: Uint8Array,
  system: string,
  control: string,
): number | null {
  const spec = MAPS[normalise(system)]?.controls[control];
  if (!spec || spec.storage !== 'fml' || (spec.kind !== 'number' && spec.kind !== 'slider')) return null;
  const tag = Number(spec.tag ?? spec.tags?.[0]);
  if (!Number.isFinite(tag)) return null;
  const value = fileLevelTags(payload).get(tag);
  return value && value.length >= 4 ? u32(value, 0) : null;
}

export const SWITCH_CONTROLS = ['Cash', 'Refill', 'Service', 'Test', 'Test 2', 'Top Up'] as const;
export type SwitchControl = (typeof SWITCH_CONTROLS)[number];

const SWITCH_ID_SYSTEMS = new Set(['SCORPION2', 'SCORPION4', 'MPU4', 'MPU4PLASMA', 'IMPACT', 'M1AB', 'SPACE', 'EPOCH', 'SYSTEM80', 'ELECTROCOIN', 'PHOENIX', 'PHOENIX2', 'SYS5', 'SYS85', 'PROCONN', 'ASTRASYSA1']);

export function layoutSwitchIds(
  payload: Uint8Array,
  system: string,
): Partial<Record<SwitchControl, number>> {
  const out: Partial<Record<SwitchControl, number>> = {};
  if (!SWITCH_ID_SYSTEMS.has(normalise(system))) return out;
  for (const control of SWITCH_CONTROLS) {
    const n = readSwitchNumber(payload, system, control);
    if (n !== null && n < 0x80000000) out[control] = n;
  }
  return out;
}

export function layoutSwitchIdsFrom(
  layout: Uint8Array | undefined,
  system: string,
): Partial<Record<SwitchControl, number>> {
  if (!layout || layout.length === 0 || !hasGameConfig(system)) return {};
  try {
    const payload = decodedLayout(layout);
    if (!payload) return {};
    return layoutSwitchIds(payload, system);
  } catch {
    return {};
  }
}

export function readTextSetting(
  payload: Uint8Array,
  system: string,
  control: string,
): string | null {
  const map = MAPS[normalise(system)];
  const spec = map?.controls[control];
  if (!spec || spec.storage !== 'fml' || spec.kind !== 'text') return null;

  const tagText = spec.tag ?? spec.tags?.[0];
  if (!tagText) return null;
  const tag = Number(tagText);
  if (!Number.isFinite(tag)) return null;

  const value = fileLevelTags(payload).get(tag);
  if (!value) return null;

  const fixed = /^ascii-(\d+)$/.exec(spec.encoding ?? '');
  const width = fixed ? Number(fixed[1]) : value.length;
  if (value.length < width) return null;

  let text = '';
  for (let i = 0; i < width; i++) {
    const c = value[i];
    if (c === 0) break;
    if (c < 0x20 || c > 0x7e) return null;
    text += String.fromCharCode(c);
  }
  text = text.trim();
  return text.length ? text : null;
}

export function readCheckboxSetting(
  payload: Uint8Array,
  system: string,
  control: string,
): boolean | null {
  const map = MAPS[normalise(system)];
  const spec = map?.controls[control];
  if (!spec || spec.storage !== 'fml' || spec.kind !== 'checkbox') return null;
  if (spec.mask == null) return null;

  const tag = Number(spec.tag ?? spec.tags?.[0]);
  if (!Number.isFinite(tag)) return null;
  const value = fileLevelTags(payload).get(tag);
  if (!value) return null;

  const byte = value[spec.byteIndex ?? 0];
  if (byte === undefined) return null;
  const set = (byte & spec.mask) !== 0;
  return spec.inverted ? !set : set;
}

export function readCheckboxByte(
  payload: Uint8Array,
  system: string,
  control: string,
): number | null {
  const spec = MAPS[normalise(system)]?.controls[control];
  if (!spec || spec.storage !== 'fml' || spec.kind !== 'checkbox') return null;
  const tag = Number(spec.tag ?? spec.tags?.[0]);
  if (!Number.isFinite(tag)) return null;
  const value = fileLevelTags(payload).get(tag);
  if (!value) return null;
  const byte = value[spec.byteIndex ?? 0];
  return byte === undefined ? null : byte;
}

export interface MeterMoneyMap {
  meterIn: number[];
  meterOut: number[];
  triacIn: number[];
  triacOut: number[];
  secIn: number[];
  secOut: number[];
}

function signedCell(d: Uint8Array, at: number): number {
  return u32(d, at) | 0;
}

export function meterMoneyMap(payload: Uint8Array, system: string): MeterMoneyMap | null {
  const spec = MAPS[normalise(system)]?.controls['Meters'];
  const block = spec?.meterTriacBlock;
  if (!spec || spec.storage !== 'fml' || spec.kind !== 'meter-grid' || !block) return null;

  const tag = Number(spec.tag ?? spec.tags?.[0]);
  if (!Number.isFinite(tag)) return null;
  const value = fileLevelTags(payload).get(tag);
  if (!value || value.length < block.byteOffset + block.rowCount * block.rowStride) return null;

  const out: MeterMoneyMap = { meterIn: [], meterOut: [], triacIn: [], triacOut: [], secIn: [], secOut: [] };
  for (let row = 0; row < block.rowCount; row++) {
    const at = block.byteOffset + row * block.rowStride;
    out.meterIn.push(signedCell(value, at + block.rowLayout.meterIn));
    out.meterOut.push(signedCell(value, at + block.rowLayout.meterOut));
    out.triacIn.push(signedCell(value, at + block.rowLayout.triacIn));
    out.triacOut.push(signedCell(value, at + block.rowLayout.triacOut));
  }
  const sec = spec.secBlock;
  if (sec && value.length >= sec.byteOffset + sec.entryCount * sec.entryStride) {
    for (let i = 0; i < sec.entryCount; i++) {
      const at = sec.byteOffset + i * sec.entryStride;
      out.secIn.push(signedCell(value, at + sec.entryLayout.in));
      out.secOut.push(signedCell(value, at + sec.entryLayout.out));
    }
  }
  return out;
}

export type SlideEffect = number | 'token' | 'unpriced' | null;

export function triacSlidePence(
  payload: Uint8Array,
  system: string,
): SlideEffect[] | null {
  const spec = MAPS[normalise(system)]?.controls['Triac Effects'];
  if (!spec || spec.storage !== 'fml' || spec.kind !== 'effect-grid') return null;
  const rows = spec.rows ?? 16;
  const stride = spec.rowStride ?? 8;
  const onOffset = spec.fields?.['on']?.byteOffset ?? 0;

  const tag = Number(spec.tag ?? spec.tags?.[0]);
  if (!Number.isFinite(tag)) return null;
  const value = fileLevelTags(payload).get(tag);
  if (!value) return null;

  const label = new Map<number, string>();
  for (const [name, code] of Object.entries(spec.confirmedEffectCodes ?? {})) {
    label.set(code, name);
  }

  const out: SlideEffect[] = [];
  for (let r = 0; r < rows && (r + 1) * stride <= value.length; r++) {
    const name = label.get(u32(value, r * stride + onOffset)) ?? '';
    const p = /^(\d+)p Slide$/.exec(name);
    const gbp = /^£(\d+) Slide$/.exec(name);
    if (p) out.push(Number(p[1]));
    else if (gbp) out.push(Number(gbp[1]) * 100);
    else if (name === 'Token Slide') out.push('token');
    else if (name === 'Misc Slide') out.push('unpriced');
    else out.push(null);
  }
  return out;
}

export interface EffectGridRow { on: number; off: number }

export function effectGrid(
  payload: Uint8Array,
  system: string,
  control: 'Triac Effects' | 'Meter Effects',
): EffectGridRow[] | null {
  const spec = MAPS[normalise(system)]?.controls[control];
  if (!spec || spec.storage !== 'fml' || spec.kind !== 'effect-grid') return null;
  const tag = Number(spec.tag ?? spec.tags?.[0]);
  if (!Number.isFinite(tag)) return null;
  const value = fileLevelTags(payload).get(tag);
  if (!value) return null;
  const rows = spec.rows ?? 16;
  const stride = spec.rowStride ?? 8;
  const on = spec.fields?.['on']?.byteOffset ?? 0;
  const off = spec.fields?.['off']?.byteOffset ?? 4;
  const out: EffectGridRow[] = [];
  for (let r = 0; r < rows && (r + 1) * stride <= value.length; r++) {
    out.push({ on: u32(value, r * stride + on), off: u32(value, r * stride + off) });
  }
  return out;
}

export function decodedLayout(layout: Uint8Array | undefined): Uint8Array | null {
  if (!layout || layout.length === 0) return null;
  try {
    return isAacsContainer(layout) ? readAacsContainer(layout).payload : layout;
  } catch {
    return null;
  }
}

export interface FittedPeripherals {
  coinMech: string | null;
  hoppers: (string | null)[];
  noteAcceptor: string | null;
  picType: string | null;
  picCode: string | null;
  lampExtender: string | null;
  hopperType: string | null;
  reelJumpers?: Mpu5ReelJumpers | null;
}

export interface Mpu5ReelJumpers {
  mode: number;
  units: [number[], number[]];
}

export function mpu5ReelJumpers(payload: Uint8Array): Mpu5ReelJumpers | null {
  const tags = fileLevelTags(payload);
  if (![0x27, 0x4e, 0x4f, 0x50, 0x51].some((t) => tags.has(t))) return null;
  const pair = (tag: number): number[] => {
    const b = tags.get(tag);
    return [0, 4].map((at) => (b && b.length >= at + 4 ? u32(b, at) : 0));
  };
  const mode = tags.get(0x4f);
  return {
    mode: mode && mode.length >= 4 ? u32(mode, 0) : 0,
    units: [[...pair(0x27), ...pair(0x50)], [...pair(0x4e), ...pair(0x51)]],
  };
}

export function mpu5ReelJumpersFrom(layout: Uint8Array | undefined): Mpu5ReelJumpers | null {
  const payload = decodedLayout(layout);
  return payload ? mpu5ReelJumpers(payload) : null;
}

export function mpu5Mux5ExtendedFrom(layout: Uint8Array | undefined): boolean {
  const payload = decodedLayout(layout);
  return payload ? readSetting(payload, 'MPU5', 'MUX5E') === 'Yes' : false;
}

export function fittedPeripheralsFrom(
  layout: Uint8Array | undefined,
  system: string,
): FittedPeripherals {
  const none: FittedPeripherals = {
    coinMech: null, hoppers: [null, null], noteAcceptor: null, picType: null,
    picCode: null, lampExtender: null, hopperType: null,
  };
  if (!layout || layout.length === 0 || !hasGameConfig(system)) return none;
  try {
    const payload = decodedLayout(layout);
    if (!payload) return none;
    return fittedPeripherals(payload, system);
  } catch {
    return none;
  }
}

export function fittedPeripherals(payload: Uint8Array, system: string): FittedPeripherals {
  return {
    coinMech: readSetting(payload, system, 'Coin Mech'),
    hoppers: [
      readSetting(payload, system, 'Hopper 1'),
      readSetting(payload, system, 'Hopper 2'),
    ],
    noteAcceptor: readSetting(payload, system, 'Note Acceptor'),
    picType: readSetting(payload, system, 'PIC Type') ?? readSetting(payload, system, 'PIC'),
    picCode: readTextSetting(payload, system, 'PIC Code'),
    lampExtender: readSetting(payload, system, 'Extender Aux1'),
    hopperType: readSetting(payload, system, 'Hopper Type'),
    reelJumpers: system.toUpperCase() === 'MPU5' ? mpu5ReelJumpers(payload) : null,
  };
}

export interface Mpu4CharacteriserConfig {
  type: string;
  responses: Uint8Array | null;
  lamps: Uint8Array | null;
  character: Uint8Array | null;
}

const MPU4_CHARACTER_TAG = 0x05;
const MPU4_CHARACTER_LENGTH = 72;

function characterArrayRecorded(array: Uint8Array): boolean {
  return array[1] !== 0;
}

export function mpu4CharacteriserConfig(payload: Uint8Array): Mpu4CharacteriserConfig | null {
  const type = readSetting(payload, 'MPU4', 'Character');
  const raw = fileLevelTags(payload).get(MPU4_CHARACTER_TAG);
  const stored = raw && raw.length === MPU4_CHARACTER_LENGTH ? raw : null;
  const array = stored && characterArrayRecorded(stored) ? stored : null;
  if (type === null && !array) return null;
  return {
    type: type ?? 'Barcrest',
    responses: array ? array.slice(0, 64) : null,
    lamps: array ? array.slice(64, 72) : null,
    character: stored ? stored.slice() : null,
  };
}

export function m1abDongleConfig(payload: Uint8Array): { fitted: boolean; key: number | null } | null {
  const spec = MAPS[normalise('M1AB')]?.controls['Dongle Fitted'];
  const tag = Number(spec?.tag);
  if (!Number.isFinite(tag)) return null;
  const tags = fileLevelTags(payload);
  const value = tags.get(tag);
  if (!value || value.length < 4) return null;
  const array = tags.get(MPU4_CHARACTER_TAG);
  return { fitted: u32(value, 0) !== 0, key: array && array.length >= 1 ? array[0] : null };
}

export function mpu4CharacteriserConfigFrom(
  layout: Uint8Array | undefined,
): Mpu4CharacteriserConfig | null {
  const payload = decodedLayout(layout);
  return payload ? mpu4CharacteriserConfig(payload) : null;
}
