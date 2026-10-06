import type { Machine, NamedCoin } from '../src/machine/machine';
import type { FrameLayout } from '../src/machine/framestate';
import type { Game } from '../src/machine/registry';
import type { Schematic, SchematicNode } from '../src/machine/schematic';
import type { UnservedComponent } from '../src/machine/unserved';
import { TAILORED_IDS, bucketIoCounts } from '../src/machine/schematic';
import { applyParts } from '../src/machine/parts';
import { acceptorResolve, viewFor } from './platform';
import { declaredCoins } from '../src/machine/layoutcoins';
import { boardDefaultsOf, noteBoardDefault } from '../src/machine/boarddefaults';
import { schematicFor } from '../src/machine/schematics';
import { Sc4 } from '../src/machine/sc4';
import type { MachineInfo } from './emu-protocol';
import { layoutSwitchIdsFrom, hasControl } from '../src/layout/fmlconfig';
import { Ay8910 } from '../src/hw/ay8910';
import { Ym2413 } from '../src/hw/ym2413';
import { Msm6376 } from '../src/hw/msm6376';
import { Upd7759 } from '../src/hw/upd7759';
import { Ymz280b } from '../src/hw/ymz280b';

export function offerNote(m: Machine, billType: number, parallel = false): string {
  const r = (parallel ? m.insertParallelNote?.(billType) : m.insertNote?.(billType)) ?? 'unfitted';
  switch (r) {
    case 'stacked': return `note ${billType} taken`;
    case 'escrow': return `note ${billType} held in escrow`;
    case 'busy': return `IGNORED note ${billType} - the reader still holds the last one`;
    case 'inhibited': return `IGNORED note ${billType} - the machine has the note reader inhibited`;
    case 'unprogrammed': return `IGNORED note ${billType} - the fitted reader carries no note on that type`;
    default: return `IGNORED note ${billType} - no note reader this app models is fitted`;
  }
}

export const MAX_CATCHUP_SECONDS = 0.1;

export function buildMachineInfo(game: Game, m: Machine, layout: FrameLayout): MachineInfo {
  const system = game.system;
  const buttons = viewFor(system).playButtons;
  const sourced = buttons.filter((b) => b.certain);
  if (sourced.length && !m.capNames?.size) {
    const named = buttons.every((b) => b.certain) ? 'documented switch matrix' : 'cited entries';
    noteBoardDefault(m, {
      axis: 'button',
      text: `unlabelled buttons are named from the ${system} board's ${named}; this program names none of its own`,
      ifWrong: 'A button may carry the wrong name. The layout\'s own captions and key bindings are unaffected.',
    });
  }
  const view = viewFor(system);
  const resolved = declaredCoins(game.layout).map((c) => acceptorResolve(view, {
    button: c.button ?? -1,
    acceptor: { ...(c.line !== null ? { line: c.line } : {}), ...(c.note !== null ? { note: c.note } : {}), token: c.token },
  }, m.coinChutes, m.coinPortLines));
  const standIn = resolved.filter((r) => !r.fromCabinet && r.kind !== 'note');
  const noChute = resolved.filter((r) => r.fromCabinet && r.line < 0 && r.kind !== 'note');
  if (noChute.length) {
    noteBoardDefault(m, {
      axis: 'coin',
      text: `${noChute.length} coin slot(s) feed an input the ${system} board has no chute for and drop nothing`,
      ifWrong: 'That slot does nothing when clicked; the machine cannot take that coin.',
    });
  }
  if (standIn.length) {
    noteBoardDefault(m, {
      axis: 'coin',
      text: `${standIn.length} coin slot(s) use the ${system} board's default coin line - the cabinet states none`,
      ifWrong: 'A slot may drop a different coin than its label says, and the ledger books that coin.',
    });
  }
  if (typeof m.coinLockHarnessRead === 'boolean' && !m.coinLockHarnessRead) {
    noteBoardDefault(m, {
      axis: 'coin',
      text: 'this program states no coin-lockout table - coins are taken and the mech is not held back',
      ifWrong: 'A coin may be accepted at a moment the real cabinet would have rejected it.',
    });
  }
  const notes = resolved.filter((r) => r.kind === 'note'
    && (!r.fromCabinet || (r.parallel
      ? !m.insertParallelNote || m.parallelNoteReaderFitted === false
      : !m.insertNote || m.noteReaderFitted === false))).length;
  if (notes) {
    noteBoardDefault(m, {
      axis: 'coin',
      text: `${notes} note slot(s) are drawn and no note reader here serves them`,
      ifWrong: 'Those slots do nothing when clicked; the machine cannot take a note.',
    });
  }
  return {
    system,
    clockHz: m.clockHz,
    audioRate: m.audioSource?.rate ?? null,
    optionKeys: (m.optionKeys ?? []).map((k) => ({
      label: k.label,
      positions: [...k.positions],
      position: k.position(),
    })),
    switchPanel: (m.switchPanel ?? []).map((sw) => ({
      id: sw.id,
      label: sw.label,
      on: sw.on,
      ...(sw.group ? { group: sw.group } : {}),
      ...(sw.bootOnly ? { bootOnly: true } : {}),
      ...(sw.option ? { option: true } : {}),
    })),
    switchIds: layoutSwitchIdsFrom(game.layout, system),
    ...(m.capNames?.size
      ? { capNames: Object.fromEntries([...m.capNames].map(([b, c]) => [b, { role: c.role, label: c.label }])) }
      : {}),
    ...(m.coinChutes ? { coins: m.coinChutes.map((c) => ({ ...c })) } : {}),
    ...(m.unnamedCoinLines?.length ? { unnamedCoins: [...m.unnamedCoinLines] } : {}),
    ...(m.coinPortLines
      ? { coinPort: { compare: m.coinPortLines.compare, lines: m.coinPortLines.lines.map((l) => ({ ...l })) } }
      : {}),
    layout,
    schematic: buildSchematic(system, m, game, layout),
    ...(boardDefaultsOf(m).length ? { boardDefaults: boardDefaultsOf(m).map((d) => ({ ...d })) } : {}),
    codegen: codegenOf(m),
  };
}

function codegenOf(m: Machine): 'regions' | 'predecode' | 'wasm' | null {
  if ((m as { usingWasm?: boolean }).usingWasm) return 'wasm';
  const cpu = (m as { cpu?: { regions?: unknown; predecode?: unknown } }).cpu;
  if (!cpu) return null;
  return cpu.regions ? 'regions' : cpu.predecode ? 'predecode' : null;
}

function buildSchematic(
  system: string, m: Machine, game: Game, layout: FrameLayout,
): Schematic | null {
  const base = schematicFor(system);
  if (!base) return null;
  const s: Schematic = structuredClone(base);
  const by = new Map(s.nodes.map((n) => [n.id, n]));
  if (m.parts?.length) applyParts(s, m.parts, hasIoCounters(m));
  const fitted = (id: string, model: string | null | undefined, part?: string): void => {
    const n = by.get(id);
    if (!n) return;
    if (!model) {
      n.state = 'unfitted';
      delete n.activity;
      n.note = `${n.note ? n.note + ' ' : ''}This set fits none.`;
      return;
    }
    n.part = part ?? model;
  };

  const p = game.layoutProps?.peripherals;
  if (p) {
    if (hasControl(system, 'Coin Mech')) fitted(TAILORED_IDS.coinMech, p.coinMech);
    if (hasControl(system, 'Hopper Type') || hasControl(system, 'Hopper 1')) {
      fitted(TAILORED_IDS.hopper, p.hopperType ?? p.hoppers[0]);
    }
    if (hasControl(system, 'Hopper 2')) fitted(TAILORED_IDS.hopper2, p.hoppers[1]);
    if (hasControl(system, 'Note Acceptor')) fitted(TAILORED_IDS.notes, p.noteAcceptor);
  }

  const reels = by.get(TAILORED_IDS.reels);
  if (reels) {
    if (!layout.reelCount) markUnfitted(reels, 'This set has no reels.');
    else {
      reels.label = `REEL MECH × ${layout.reelCount}`;
      const spr = layout.stepsPerRevolution[0];
      reels.part = spr ? `${spr} steps · ${layout.symbols[0]} symbols` : reels.part;
    }
  }
  const display = by.get(TAILORED_IDS.display);
  if (display && layout.displayKind === 'none') {
    const un = layout.unserved.filter((u) => u.axis === 'display');
    if (un.length) {
      display.state = 'unserved';
      delete display.activity;
      display.label = un[0].component.toUpperCase();
      display.part = 'declared · not driven';
      display.note = un.map((u) => u.reason).join(' ');
    } else {
      markUnfitted(display, 'This cabinet declares no alphanumeric display.');
    }
  }
  const digits = by.get(TAILORED_IDS.digits);
  if (digits && layout.digitKind === 'none') {
    const un = layout.unserved.filter((u) => u.axis === 'digit');
    if (un.length) {
      digits.state = 'unserved';
      delete digits.activity;
      digits.label = un[0].component.toUpperCase();
      digits.part = 'declared · not driven';
      digits.note = un[0].reason;
    } else {
      markUnfitted(digits, 'This cabinet declares no digits lit from a digit bank.');
    }
  }
  const dots = by.get(TAILORED_IDS.dots);
  if (dots && !layout.dotBytes) markUnfitted(dots, 'This set has no dot panel.');
  appendUnserved(s, layout.unserved, by);
  for (const d of boardDefaultsOf(m)) {
    const n = d.node ? by.get(d.node) : undefined;
    if (!n) continue;
    const line = `Board default: ${d.text}. ${d.ifWrong}`;
    n.note = n.note ? `${n.note} ${line}` : line;
  }
  return s;
}

const SCHEM_WIDTH = 820;
const SCHEM_MARGIN = 6;
const SCHEM_GUTTER = 8;
const SCHEM_TOP = 10;
const SCHEM_ROW_GAP = 24;
const SCHEM_ROW_H = 42;

function appendUnserved(
  s: Schematic, unserved: FrameLayout['unserved'], by: Map<string, SchematicNode>,
): void {
  const shownInPlace = new Set(
    [...by.values()].filter((n) => n.state === 'unserved').map((n) => n.label.toLowerCase()),
  );
  const grouped = new Map<string, { u: UnservedComponent; n: number }>();
  for (const u of unserved) {
    if (shownInPlace.has(u.component.toLowerCase())) continue;
    const g = grouped.get(`${u.axis}:${u.component}`);
    if (g) g.n++;
    else grouped.set(`${u.axis}:${u.component}`, { u, n: 1 });
  }
  const rest = [...grouped.values()];
  if (!rest.length) return;
  const y = s.height - SCHEM_TOP + SCHEM_ROW_GAP;
  const usable = SCHEM_WIDTH - 2 * SCHEM_MARGIN - SCHEM_GUTTER * (rest.length - 1);
  let x = SCHEM_MARGIN;
  rest.forEach(({ u, n }, i) => {
    const w = i === rest.length - 1
      ? SCHEM_WIDTH - SCHEM_MARGIN - x
      : Math.round(usable / rest.length);
    s.nodes.push({
      id: `unserved-${u.axis}-${i}`,
      label: `${u.component.toUpperCase()}${n > 1 ? ` × ${n}` : ''}`,
      part: `${u.axis} · declared · not driven`,
      x, y, w, h: SCHEM_ROW_H,
      band: 'peripheral',
      state: 'unserved',
      note: u.reason,
    });
    x += w + SCHEM_GUTTER;
  });
  s.height = Math.round(y + SCHEM_ROW_H + SCHEM_TOP);
}

function markUnfitted(n: SchematicNode, why: string): void {
  n.state = 'unfitted';
  delete n.activity;
  n.note = `${n.note ? n.note + ' ' : ''}${why}`;
}

export function readIoCounts(
  m: Machine | null, schematic: Schematic | null,
): Record<string, number> | null {
  if (!m || !schematic) return null;
  const log = ioLogOf(m);
  return log ? bucketIoCounts(schematic, log) : null;
}

function ioLogOf(
  m: Machine,
): ReadonlyMap<number, { reads: number; writes: number }> | undefined {
  return (m as unknown as {
    ioLog?: ReadonlyMap<number, { reads: number; writes: number }>;
  }).ioLog;
}

export function hasIoCounters(m: Machine): boolean {
  return ioLogOf(m) !== undefined;
}

export function applyOptionKeyState(
  m: Machine, state: Record<string, number> | undefined,
): void {
  if (!state) return;
  for (const k of m.optionKeys ?? []) {
    const v = state[k.label];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < k.positions.length) {
      k.fit(v);
    }
  }
}

export function applyPanelSwitchState(
  m: Machine, state: Record<string, boolean> | undefined,
): void {
  if (!state) return;
  for (const sw of m.switchPanel ?? []) {
    const v = state[String(sw.id)];
    if (typeof v === 'boolean' && v !== sw.on) m.layoutInput(sw.id, v);
  }
}

export function applyNamedCoins(m: Machine, named: Record<string, NamedCoin> | undefined): void {
  if (!named || !m.nameCoin) return;
  for (const [line, coin] of Object.entries(named)) m.nameCoin(Number(line), coin);
}

export function powerCycleOrThrow(m: Machine): void {
  if (!m.powerCycle) throw new Error('this board cannot be restarted with its memory kept');
  m.powerCycle();
}

export interface BlankRebuildSettings {
  optionKeys?: Record<string, number>;
  panelSwitches?: Record<string, boolean>;
  namedCoins?: Record<string, NamedCoin>;
  wasm?: boolean;
  noRegions?: boolean;
}

export function rebuildWithBlankMemory(
  build: (game: Game) => Machine, game: Game, old: Machine | null, o: BlankRebuildSettings,
): Machine {
  const m = build(blankMemoryGame(game));
  applyOptionKeyState(m, o.optionKeys);
  applyPanelSwitchState(m, o.panelSwitches);
  applyNamedCoins(m, o.namedCoins);
  if (old) carryCashLedger(old, m);
  if (o.noRegions) {
    (m as { cpu?: { setRegionsEnabled?: (on: boolean) => void } }).cpu?.setRegionsEnabled?.(false);
  }
  if (o.wasm === false) {
    (m as { useInterpreter?: () => void }).useInterpreter?.();
  } else if (o.wasm === true) {
    (m as { useWasmCore?: () => void }).useWasmCore?.();
  }
  return m;
}

export function blankMemoryGame(game: Game): Game {
  return { ...game, nvram: undefined };
}

export function carryCashLedger(from: Machine, to: Machine): void {
  const a = from.cashLedger;
  const b = to.cashLedger;
  if (a && b) Object.assign(b, a);
}

export function sameFrameLayout(a: FrameLayout | null, b: FrameLayout): boolean {
  return !!a && JSON.stringify(a) === JSON.stringify(b);
}

export function disableAudioTicks(): void {
  const noop = function (this: unknown): void {};
  for (const cls of [Ay8910, Ym2413, Msm6376, Upd7759, Ymz280b]) {
    cls.prototype.tick = noop;
  }
}

export const MIN_PRESS_SECONDS = 0.1;

export class InputDwell {
  private readonly owed = new Map<number, number>();
  private readonly waiting = new Set<number>();

  press(m: Machine, id: number): void {
    this.waiting.delete(id);
    this.owed.set(id, Math.round(m.clockHz * MIN_PRESS_SECONDS));
    m.layoutInput(id, true);
  }

  release(m: Machine, id: number): void {
    if ((this.owed.get(id) ?? 0) > 0) { this.waiting.add(id); return; }
    this.owed.delete(id);
    m.layoutInput(id, false);
  }

  ran(m: Machine, cycles: number): void {
    if (!this.owed.size) return;
    for (const [id, left] of this.owed) {
      const now = left - cycles;
      if (now > 0) { this.owed.set(id, now); continue; }
      this.owed.delete(id);
      if (this.waiting.delete(id)) m.layoutInput(id, false);
    }
  }

  clear(): void {
    this.owed.clear();
    this.waiting.clear();
  }
}

export const COIN_SPACING_SECONDS = 0.33;

export const COIN_QUEUE_MAX = 10;

export type CoinEvent = 'in' | 'queued' | 'dropped' | 'refused' | 'returned';

export function coinLogLine(event: CoinEvent, name: string): string {
  switch (event) {
    case 'in': return `in ${name}`;
    case 'queued': return `waiting ${name}: the mech takes about 3 coins a second`;
    case 'dropped': return `IGNORED ${name}: ${COIN_QUEUE_MAX} coins already waiting`;
    case 'refused': return `REFUSED ${name}: the mech is not taking it now`;
    case 'returned': return `RETURNED ${name}: it was waiting when the mech stopped taking coins`;
  }
}

export function coinRejected(e: CoinEvent): boolean {
  return e === 'dropped' || e === 'refused' || e === 'returned';
}

export class CoinPacer {
  private readonly queue: number[] = [];
  private owed = 0;

  constructor(private readonly log: (event: CoinEvent, bit: number) => void) {}

  offer(m: Machine, bit: number): void {
    if (!this.queue.length && this.owed <= 0 && !m.coinBusy) {
      this.deliver(m, bit);
      return;
    }
    if (this.queue.length >= COIN_QUEUE_MAX) {
      this.log('dropped', bit);
      return;
    }
    this.queue.push(bit);
    this.log('queued', bit);
  }

  ran(m: Machine, cycles: number): void {
    if (this.owed > 0) this.owed -= cycles;
    if (this.queue.length && this.owed <= 0 && !m.coinBusy) this.deliver(m, this.queue.shift()!);
  }

  get waiting(): number {
    return this.queue.length;
  }

  clear(): void {
    this.returnAll();
    this.owed = 0;
  }

  private returnAll(): void {
    for (const bit of this.queue.splice(0)) this.log('returned', bit);
  }

  private deliver(m: Machine, bit: number): void {
    this.owed = Math.round(m.clockHz * COIN_SPACING_SECONDS);
    const refusing = (((m.coinRefusing ?? 0) >>> bit) & 1) === 1;
    const before = m.coinsRefused;
    m.insertCoin(bit);
    const refused = refusing || (before !== undefined && m.coinsRefused !== before);
    this.log(refused ? 'refused' : 'in', bit);
    if (refused) this.returnAll();
  }
}

export function calibrateHost(): number {
  const t = performance.now();
  let x = 0;
  for (let i = 0; i < 30_000_000; i++) x = (x + i) ^ (x >>> 3);
  (globalThis as unknown as { __calibSink?: number }).__calibSink = x;
  return performance.now() - t;
}

export function regionStats(m: Machine | null): { compiled: number; refused: number } {
  const regions = (m as { cpu?: { regions?: { compiled: number; refusedCount: number } } } | null)
    ?.cpu?.regions;
  return regions
    ? { compiled: regions.compiled, refused: regions.refusedCount }
    : { compiled: 0, refused: 0 };
}

export function runBudget(m: Machine, budget: number, benchStep: boolean): number {
  if (!benchStep) {
    m.run(budget);
    return 0;
  }
  let steps = 0;
  let done = 0;
  while (done < budget) {
    done += m.step();
    steps++;
  }
  return steps;
}

export function pumpAudioToPort(
  m: Machine, port: MessagePort | null, scratch: Float32Array,
): void {
  const src = m.audioSource;
  if (!src || !port) return;
  const frames = src.buffered();
  if (frames <= 0) return;
  const n = Math.min(frames, scratch.length >> 1);
  const got = src.readAudio(scratch, n);
  if (got <= 0) return;
  const chunk = scratch.slice(0, got * 2);
  for (let i = 0; i < got; i++) {
    const mix = (chunk[i * 2] + chunk[i * 2 + 1]) / 2;
    chunk[i * 2] = mix;
    chunk[i * 2 + 1] = mix;
  }
  port.postMessage({ chunk, rate: src.rate }, [chunk.buffer]);
}

export class ReelDiagnostics {
  private stillTicks: number[] = [];
  private lastTravel: number[] = [];
  private traces: { nib: number; steps: number; n: number }[][] = [];

  install(m: Machine): void {
    this.stillTicks = m.reels.map(() => 0);
    this.lastTravel = m.reels.map((r) => r.travel);
    this.traces = m.reels.map(() => []);
    m.reels.forEach((r, i) => {
      r.onSnap = (delta, steps) =>
        console.log(`[reel] r${i} relock snap delta=${delta} counted=${steps} pos=${r.position}`);
      const trace = this.traces[i];
      const orig = r.update.bind(r);
      r.update = (nib: number) => {
        const s = orig(nib);
        const last = trace[trace.length - 1];
        if (last && last.nib === (nib & 0xf) && last.steps === s) last.n++;
        else {
          trace.push({ nib: nib & 0xf, steps: s, n: 1 });
          if (trace.length > 100) trace.shift();
        }
        return s;
      };
    });
  }

  tick(m: Machine): void {
    if (!(m instanceof Sc4)) return;
    m.reels.forEach((r, i) => {
      const moved = r.travel !== this.lastTravel[i];
      this.lastTravel[i] = r.travel;
      this.stillTicks[i] = moved ? 0 : this.stillTicks[i] + 1;
      if (this.stillTicks[i] === 8 && i < 3
          && this.stillTicks.slice(0, 3).every((f, j) => j === i || f >= 8)
          && m.vfd.text().trim().startsWith('£')) {
        const row = ((Math.round((r.position - 1) / 6) + 8) % 16 + 16) % 16;
        const fw = m.ram[0x31f0 + i] % 16;
        if (row !== fw) {
          console.log(
            `[reel] r${i} IDLE MISMATCH pos=${r.position} row=${row} fw=${fw} travel=${r.travel}`,
          );
          const tr = this.traces[i];
          console.log(
            `[reel] r${i} writes: `
              + tr.map((e) => `${e.nib.toString(16)}${e.steps ? ':' + e.steps : ''}${e.n > 1 ? 'x' + e.n : ''}`).join(' '),
          );
          tr.length = 0;
        }
      }
    });
  }
}
