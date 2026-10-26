import type { CoinWiring } from '../web/coinask';
import type { RoomLook } from './roomlook';
import { footprintAt, newPropId, posterArt, PROP_WALL_GAP, propFootprint, propKind, propOnWall, PROPS_MAX, wallHalfWidth, type PosterArt, type Prop, type PropKind } from './proplist';
import type { CashLedger } from '../src/machine/machine';
import type { GameConfig } from '../src/machine/registry';
import type { StateRec } from '../web/store';
import type { MachineLook } from './machines';
import type { MountMap } from './mounts';
import type { MoneyRecord } from './moneyrecord';
import type { CreditSince } from './serverwire';
import { str } from '../web/i18n';
import { cellCentre, cellOf, cellRect, GRID, gridGeometry, isDoorway, rectsOverlap, type Rect } from './floor';
import { DERIVED } from './cabinetsize';

export const ARCADE_FORMAT = 'fruitulator-arcade';
export const ARCADE_DOC_VERSION = 2;

export const FLOOR_COLS = GRID.cols;
export const FLOOR_ROWS = GRID.rows;
export const FLOOR_STEP = GRID.step;

export const FLOOR_GEOM = gridGeometry({ width: DERIVED.width, depth: DERIVED.depth });

export const FLOOR_CENTRE = { x: (FLOOR_GEOM.box.minX + FLOOR_GEOM.box.maxX) / 2, z: (FLOOR_GEOM.box.minZ + FLOOR_GEOM.box.maxZ) / 2 };

export const FLOOR_AISLES = 3;
export const AISLE_SLOTS = 10;
export const CAB_DIVS = 10;
export const AISLE_DIVS = 112;

export const ARCADE_MAX_MACHINES = 30;

export interface Place {
  col: number;
  row: number;
  turn?: Turn;
}

export type Turn = 0 | 1 | 2 | 3;

export const turnOf = (p: { turn?: unknown } | null | undefined): Turn =>
  (p && (p.turn === 1 || p.turn === 2 || p.turn === 3) ? p.turn : 0);

export interface MachineConfig {
  optionKeys?: Record<string, number>;
  panelSwitches?: Record<string, boolean>;
  coins?: CoinWiring;
}

export interface MachineSetup extends Partial<MachineLook> {
  cabinet?: string;
  mounts?: MountMap;
  noDeck?: boolean;
}

export interface MachineDetected {
  glass?: MachineLook['glass'];
  buttons?: MachineLook['buttons'];
  deck?: MachineLook['deck'];
  cabinetStyle?: string | null;
}

export interface CheckResult {
  id: string;
  pass: boolean | null;
  note: string;
}

export interface Validation {
  at: number;
  build: string;
  config: string;
  passed: boolean;
  checks: CheckResult[];
  skipped?: boolean;
}

export type MoneyTrust = 'billable' | 'untrusted' | 'none';

export interface BalanceReading {
  at: number;
  kind: 'float' | 'reading';
  ledger: CashLedger | null;
}

export interface MachineTrace {
  data: string;
  bytes: number;
  recordedAt: number;
  how: 'found' | 'host' | 'tool';
  config?: string;
}

export interface MachineState {
  data: string;
  bytes: number;
  schema: number;
  savedAt: number;
  cycles: number;
  build?: string;
  stamp?: string;
  nvram?: string;
  sinceGame?: CreditSince;
}

export function toMachineState(rec: StateRec): MachineState {
  const st: MachineState = {
    data: toBase64(rec.data), bytes: rec.data.length, schema: rec.schema, savedAt: rec.savedAt, cycles: rec.cycles,
  };
  if (rec.build !== undefined) st.build = rec.build;
  if (rec.stamp !== undefined) st.stamp = rec.stamp;
  if (rec.nvram && rec.nvram.length > 0) st.nvram = toBase64(rec.nvram);
  return st;
}

export function fromMachineState(st: MachineState, hash: string): StateRec {
  const rec: StateRec = { hash, schema: st.schema, savedAt: st.savedAt, cycles: st.cycles, data: fromBase64(st.data) };
  if (st.build !== undefined) rec.build = st.build;
  if (typeof st.stamp === 'string') rec.stamp = st.stamp;
  if (typeof st.nvram === 'string' && st.nvram) rec.nvram = fromBase64(st.nvram);
  return rec;
}

export type MachineStatus = 'pending' | 'installed';

export interface MachineStats {
  plays: number;
  lastPlayedAt: number | null;
  ledger: CashLedger | null;
  ledgerAt?: number;
}

export interface DocMachine {
  id: string;
  contentHash: string;
  contentRule: number;
  hash?: string;
  programHash?: string;
  name: string;
  board: string;
  status: MachineStatus;
  gameConfig?: GameConfig | null;
  config: MachineConfig;
  setup: MachineSetup;
  detected?: MachineDetected;
  money?: MoneyTrust;
  validation?: Validation | null;
  balance: BalanceReading[];
  trace: MachineTrace | null;
  state?: MachineState | null;
  installedAt?: number;
  outOfService?: boolean;
  stats?: MachineStats | null;
  moneyRecord?: MoneyRecord | null;
  place?: Place | null;
}

export interface ArcadeDoc {
  format: typeof ARCADE_FORMAT;
  version: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  machines: DocMachine[];
  room?: RoomLook;
  props?: Prop[];
  grid?: number;
  hostKey?: string;
}

export function configDigest(c: MachineConfig): string {
  const sort = (o: Record<string, unknown> | undefined): [string, unknown][] =>
    Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const marked = Object.entries(c.coins ?? {}).filter(([, s]) => s.how === 'marked')
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, s]) => [k, s.coins.map((x) => x.coin), !!s.checked]);
  return JSON.stringify([sort(c.optionKeys), sort(c.panelSwitches), ...(marked.length ? [marked] : [])]);
}

export function newArcade(name = ''): ArcadeDoc {
  const now = Date.now();
  return {
    format: ARCADE_FORMAT, version: ARCADE_DOC_VERSION, id: newId(), name, grid: FLOOR_STEP,
    createdAt: now, updatedAt: now, machines: [],
  };
}

function newId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function cannotAdd(doc: ArcadeDoc): string | null {
  if (doc.machines.length >= ARCADE_MAX_MACHINES) return str('arcade.doc.this_arcade_is_full_n', { 0: ARCADE_MAX_MACHINES });
  return null;
}

export function newMachineKey(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function machineKeyFor(doc: ArcadeDoc, contentHash: string): string {
  return doc.machines.some((m) => m.id === contentHash) ? newMachineKey() : contentHash;
}

export function keyMachines(doc: ArcadeDoc): boolean {
  let changed = false;
  const taken = new Set<string>();
  for (const m of doc.machines) {
    if (typeof m.id !== 'string' || !m.id || taken.has(m.id)) {
      m.id = taken.has(m.contentHash) ? newMachineKey() : m.contentHash;
      changed = true;
    }
    taken.add(m.id);
  }
  return changed;
}

export function machineById(doc: ArcadeDoc, id: string): DocMachine | null {
  return doc.machines.find((m) => m.id === id) ?? null;
}

const inFloor = (p: Place | null | undefined): p is Place => !!p
  && Number.isInteger(p.col) && p.col >= 0 && p.col + FLOOR_STEP <= FLOOR_COLS
  && Number.isInteger(p.row) && p.row >= 0 && p.row + FLOOR_STEP <= FLOOR_ROWS
  && !overDoorway(p);

function overDoorway(p: { col: number; row: number }): boolean {
  for (let r = p.row; r < p.row + FLOOR_STEP; r++) {
    if (isDoorway(p.col, r, FLOOR_COLS, FLOOR_ROWS) || isDoorway(p.col + FLOOR_STEP - 1, r, FLOOR_COLS, FLOOR_ROWS)) return true;
  }
  return false;
}

export const isFloor = (p: { col: number; row: number }): boolean => inFloor({ col: p.col, row: p.row });

const cellsOverlap = (a: { col: number; row: number }, b: { col: number; row: number }): boolean =>
  Math.abs(a.col - b.col) < FLOOR_STEP && Math.abs(a.row - b.row) < FLOOR_STEP;

export function machineAt(doc: ArcadeDoc, p: Place, except?: string): DocMachine | null {
  return doc.machines.find((m) => m.id !== except && inFloor(m.place) && cellsOverlap(m.place, p)) ?? null;
}

export const machineRect = (p: { col: number; row: number }): Rect => cellRect(p, FLOOR_GEOM);

export function propRect(p: Prop): Rect | null {
  return footprintAt(p.kind, propStand(p));
}

export function propAt(doc: ArcadeDoc, p: { col: number; row: number }, exceptProp?: string): Prop | null {
  const r = machineRect(p);
  return (doc.props ?? []).find((q) => q.id !== exceptProp && propRect(q) && rectsOverlap(propRect(q)!, r)) ?? null;
}

export function fits(doc: ArcadeDoc, p: Place, except?: string): boolean {
  return inFloor(p) && !machineAt(doc, p, except) && !propAt(doc, p);
}

const DOORWAY_RECT: Rect = (() => {
  const d = FLOOR_COLS - 5 * FLOOR_STEP;
  return cellRect({ col: d, row: FLOOR_ROWS - FLOOR_STEP }, FLOOR_GEOM, 3 * FLOOR_STEP);
})();

export function propFits(doc: ArcadeDoc, p: Prop, exceptProp: string | undefined = p.id): boolean {
  const r = propRect(p);
  if (!r) return true;
  const b = FLOOR_GEOM.box;
  if (!propKind(p.kind).wall && (r.minX < b.minX + PROP_WALL_GAP || r.maxX > b.maxX - PROP_WALL_GAP || r.minZ < b.minZ + PROP_WALL_GAP || r.maxZ > b.maxZ - PROP_WALL_GAP)) return false;
  if (rectsOverlap(r, DOORWAY_RECT)) return false;
  if (doc.machines.some((m) => inFloor(m.place) && rectsOverlap(r, machineRect(m.place)))) return false;
  return !(doc.props ?? []).some((q) => q.id !== exceptProp && propRect(q) && rectsOverlap(propRect(q)!, r));
}

export function snapProp(x: number, z: number, hold?: Prop): { x: number; z: number } {
  const g = FLOOR_GEOM;
  const c = cellOf(x, z, g);
  const col = Math.max(0, Math.min(FLOOR_COLS - 1, Math.floor(c.col)));
  const row = Math.max(0, Math.min(FLOOR_ROWS - 1, Math.floor(c.row)));
  const at = cellCentre({ col, row }, g);
  if (hold && !propKind(hold.kind).wall) {
    const f = propFootprint({ ...hold, x: 0, z: 0 }, { x: 0, z: 0 });
    const flush = (v: number, half: number, lo: number, hi: number): number => Math.min(hi - PROP_WALL_GAP - half - 1e-6, Math.max(lo + PROP_WALL_GAP + half + 1e-6, v));
    at.x = flush(at.x, f.maxX, g.box.minX, g.box.maxX);
    at.z = flush(at.z, f.maxZ, g.box.minZ, g.box.maxZ);
  }
  return { x: at.x - FLOOR_CENTRE.x, z: at.z - FLOOR_CENTRE.z };
}

export function propStand(p: Prop): { x: number; z: number; yaw: number } {
  if (propKind(p.kind).wall) return propOnWall(p, FLOOR_GEOM.box, FLOOR_CENTRE);
  return { x: FLOOR_CENTRE.x + p.x, z: FLOOR_CENTRE.z + p.z, yaw: p.yaw };
}

export function propSpot(doc: ArcadeDoc, kind: PropKind, art?: PosterArt): { x: number; z: number } | null {
  const b = FLOOR_GEOM.box;
  if (propKind(kind).wall) {
    const hung = (doc.props ?? []).filter((p) => propKind(p.kind).wall).map((p) => ({ at: propStand(p), hw: wallHalfWidth(p) }));
    const mid = (b.minX + b.maxX) / 2;
    const hw = wallHalfWidth({ id: '', kind, art, x: 0, z: 0, yaw: 0 });
    for (let k = 0; k < 40; k++) {
      const x = mid + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.9;
      if (x - hw < b.minX || x + hw > b.maxX) continue;
      if (!hung.every((q) => Math.abs(q.at.z - b.minZ) > 0.01 || Math.abs(q.at.x - x) >= q.hw + hw)) continue;
      const p: Prop = { id: '', kind, x: x - FLOOR_CENTRE.x, z: b.minZ - FLOOR_CENTRE.z, yaw: 0 };
      if (propFits(doc, p)) return { x: p.x, z: p.z };
    }
    return null;
  }
  const c0 = Math.floor(FLOOR_COLS / 2), r0 = Math.floor(FLOOR_ROWS / 2);
  const tries: { col: number; row: number; d: number }[] = [];
  for (let col = 0; col < FLOOR_COLS; col++) for (let row = 0; row < FLOOR_ROWS; row++) tries.push({ col, row, d: Math.hypot(col - c0, row - r0) });
  tries.sort((u, v) => u.d - v.d);
  for (const t of tries) {
    const at = cellCentre(t, FLOOR_GEOM);
    const p: Prop = { id: '', kind, x: at.x - FLOOR_CENTRE.x, z: at.z - FLOOR_CENTRE.z, yaw: 0 };
    if (propFits(doc, p)) return { x: p.x, z: p.z };
  }
  return null;
}

export function addProp(doc: ArcadeDoc, kind: PropKind, art?: PosterArt, at?: { x: number; z: number } | null): Prop | null {
  const props = doc.props ?? [];
  if (props.length >= PROPS_MAX) return null;
  if (at && !propFits(doc, { id: '', kind, art, x: at.x, z: at.z, yaw: 0 })) return null;
  at ??= propSpot(doc, kind, art);
  if (!at) return null;
  const p: Prop = { id: newPropId(), kind, x: at.x, z: at.z, yaw: 0 };
  if (kind === 'poster') p.art = posterArt(art).id;
  doc.props = [...props, p];
  return p;
}

export function moveProp(doc: ArcadeDoc, id: string, to: { x: number; z: number }): boolean {
  const p = (doc.props ?? []).find((q) => q.id === id);
  if (!p || (p.x === to.x && p.z === to.z)) return false;
  const next: Prop = { ...p, x: to.x, z: to.z };
  if (!propFits(doc, next)) return false;
  p.x = to.x;
  p.z = to.z;
  return true;
}

export function turnProp(doc: ArcadeDoc, id: string): boolean {
  const p = (doc.props ?? []).find((q) => q.id === id);
  if (!p || propKind(p.kind).wall) return false;
  p.yaw = (p.yaw + Math.PI / 4) % (Math.PI * 2);
  return true;
}

export function faceProp(doc: ArcadeDoc, id: string, yaw: number): boolean {
  const p = (doc.props ?? []).find((q) => q.id === id);
  if (!p || propKind(p.kind).wall) return false;
  const to = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (Math.abs(to - p.yaw) < 1e-6) return false;
  p.yaw = to;
  return true;
}

export function removeProp(doc: ArcadeDoc, id: string): boolean {
  const props = doc.props ?? [];
  if (!props.some((p) => p.id === id)) return false;
  doc.props = props.filter((p) => p.id !== id);
  return true;
}

export const propSize = (kind: PropKind): { w: number; d: number } => ({ w: propKind(kind).w, d: propKind(kind).d });

export function cellAt(slot: number): number {
  return Math.round((slot * AISLE_DIVS) / AISLE_SLOTS);
}

export function fromAislePlace(aisle: number, at: number, turn: Turn): Place {
  const cabs = FLOOR_COLS / FLOOR_STEP;
  const row = ([0, 5, 6][aisle] ?? 0) * FLOOR_STEP;
  const col = Math.max(0, Math.min(cabs - 1, Math.round(at / CAB_DIVS + (cabs - AISLE_DIVS / CAB_DIVS) / 2))) * FLOOR_STEP;
  const t = ((aisle === 1 ? 2 : 0) + turn) % 4 as Turn;
  return t ? { col, row, turn: t } : { col, row };
}

export function firstFree(doc: ArcadeDoc, except?: string): Place | null {
  for (let row = 0; row + FLOOR_STEP <= FLOOR_ROWS; row++) {
    for (let col = 0; col + FLOOR_STEP <= FLOOR_COLS; col++) if (fits(doc, { col, row }, except)) return { col, row };
  }
  return null;
}

export function facedAway(p: Place): Place {
  const t = turnOf(p);
  const wall = (t === 0 && p.row === FLOOR_ROWS - FLOOR_STEP) || (t === 2 && p.row === 0) || (t === 1 && p.col === 0) || (t === 3 && p.col === FLOOR_COLS - FLOOR_STEP);
  const turn = (wall ? (t + 2) % 4 : t) as Turn;
  return turn ? { col: p.col, row: p.row, turn } : { col: p.col, row: p.row };
}

export function placeAll(doc: ArcadeDoc): boolean {
  let changed = keyMachines(doc);
  const was = Number.isInteger(doc.grid) && (doc.grid as number) > 0 ? doc.grid as number : 1;
  if (was !== FLOOR_STEP) {
    for (const m of doc.machines) {
      const p = m.place as { col?: unknown; row?: unknown } | null | undefined;
      if (p && Number.isInteger(p.col) && Number.isInteger(p.row)) {
        p.col = Math.round((p.col as number) * FLOOR_STEP / was);
        p.row = Math.round((p.row as number) * FLOOR_STEP / was);
      }
    }
    doc.grid = FLOOR_STEP;
    changed = true;
  }
  for (const m of doc.machines) {
    const old = m.place as unknown as { col?: unknown; aisle?: unknown; slot?: unknown; at?: unknown; turn?: unknown } | null | undefined;
    if (old && old.col === undefined && Number.isInteger(old.aisle)) {
      const at = Number.isInteger(old.at) ? old.at as number : Number.isInteger(old.slot) ? cellAt(old.slot as number) : NaN;
      m.place = Number.isNaN(at) ? null : fromAislePlace(old.aisle as number, at, turnOf(old));
      changed = true;
    }
  }
  const kept: DocMachine[] = [];
  const homeless: DocMachine[] = [];
  for (const m of doc.machines) {
    const p = m.place;
    if (inFloor(p) && !kept.some((k) => cellsOverlap(k.place!, p))) {
      if (p.turn !== undefined && p.turn !== turnOf(p)) { delete p.turn; changed = true; }
      kept.push(m);
    } else homeless.push(m);
  }
  for (const m of homeless) {
    m.place = null;
    m.place = firstFree(doc, m.id);
    changed = true;
  }
  return changed;
}

export function fillProgramHashes(
  doc: ArcadeDoc, library: readonly { hash: string; contentHash?: string; programHash?: string }[],
): boolean {
  const byContent = new Map<string, string>();
  const byKey = new Map<string, string>();
  for (const g of library) {
    if (!g.programHash) continue;
    if (g.contentHash && !byContent.has(g.contentHash)) byContent.set(g.contentHash, g.programHash);
    byKey.set(g.hash, g.programHash);
  }
  let changed = false;
  for (const m of doc.machines) {
    if (m.programHash) continue;
    const p = byContent.get(m.contentHash) ?? (m.hash ? byKey.get(m.hash) : undefined);
    if (p) { m.programHash = p; changed = true; }
  }
  return changed;
}

export function addMachine(
  doc: ArcadeDoc, m: Omit<DocMachine, 'id' | 'status' | 'config' | 'setup' | 'balance' | 'trace' | 'place'>, place?: Place | null,
): DocMachine {
  const why = cannotAdd(doc);
  if (why) throw new Error(why);
  const at = place && fits(doc, place) ? facedAway(place) : firstFree(doc);
  const row: DocMachine = {
    ...m, id: machineKeyFor(doc, m.contentHash), status: 'pending', config: {}, setup: {}, balance: [], trace: null, place: at ? facedAway(at) : null,
  };
  doc.machines.push(row);
  return row;
}

export function duplicateMachine(doc: ArcadeDoc, id: string, place?: Place | null): DocMachine | null {
  const src = machineById(doc, id);
  if (!src) return null;
  const why = cannotAdd(doc);
  if (why) throw new Error(why);
  const at = place && fits(doc, place) ? facedAway(place) : firstFree(doc);
  const copy: DocMachine = {
    id: newMachineKey(), contentHash: src.contentHash, contentRule: src.contentRule, name: src.name, board: src.board,
    status: src.status, config: structuredClone(src.config ?? {}), setup: structuredClone(src.setup ?? {}),
    balance: src.balance.map((b) => structuredClone(b)), trace: src.trace ? { ...src.trace } : null, place: at ? facedAway(at) : null,
  };
  if (src.state) copy.state = { ...src.state };
  if (src.hash !== undefined) copy.hash = src.hash;
  if (src.programHash !== undefined) copy.programHash = src.programHash;
  if (src.gameConfig !== undefined) copy.gameConfig = structuredClone(src.gameConfig);
  if (src.detected !== undefined) copy.detected = structuredClone(src.detected);
  if (src.money !== undefined) copy.money = src.money;
  if (src.validation !== undefined) copy.validation = structuredClone(src.validation);
  if (src.status === 'installed') copy.installedAt = Date.now();
  doc.machines.push(copy);
  return copy;
}

export function removeMachine(doc: ArcadeDoc, id: string): void {
  doc.machines = doc.machines.filter((m) => m.id !== id);
}

export function moveMachine(doc: ArcadeDoc, id: string, to: Place): boolean {
  const m = machineById(doc, id);
  if (!m || !fits(doc, to, id)) return false;
  const from = m.place ?? null;
  const turn = to.turn === undefined ? turnOf(from) : turnOf(to);
  const next = to.turn === undefined ? facedAway({ col: to.col, row: to.row, turn }) : (turn ? { col: to.col, row: to.row, turn } : { col: to.col, row: to.row });
  if (from && from.col === next.col && from.row === next.row && turnOf(from) === turnOf(next)) return false;
  m.place = next;
  return true;
}

export function turnMachine(doc: ArcadeDoc, id: string, quarters: number): boolean {
  const m = machineById(doc, id);
  if (!m || !inFloor(m.place) || !Number.isInteger(quarters)) return false;
  const turn = ((((turnOf(m.place) + quarters) % 4) + 4) % 4) as Turn;
  return moveMachine(doc, id, { col: m.place.col, row: m.place.row, turn });
}

export function standing(doc: ArcadeDoc): (DocMachine & { place: Place })[] {
  return doc.machines
    .filter((m): m is DocMachine & { place: Place } => m.status === 'installed' && inFloor(m.place))
    .sort((a, b) => a.place.row - b.place.row || a.place.col - b.place.col);
}

export function onFloor(doc: ArcadeDoc): (DocMachine & { place: Place })[] {
  return doc.machines
    .filter((m): m is DocMachine & { place: Place } => inFloor(m.place))
    .sort((a, b) => a.place.row - b.place.row || a.place.col - b.place.col);
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function traceId(t: MachineTrace): string {
  let a = 0x811c9dc5;
  for (let i = 0; i < t.data.length; i++) a = Math.imul(a ^ t.data.charCodeAt(i), 0x01000193) >>> 0;
  return `${t.bytes}-${a.toString(16)}`;
}
