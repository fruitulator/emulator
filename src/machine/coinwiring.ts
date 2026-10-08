
import type { CoinWiring, SlotCoin, SlotWiring, WiredCoin } from '../../web/coinask';
export type { CoinWiring, SlotCoin, SlotWiring, WiredCoin };

export const UK_COINS: readonly number[] = [200, 100, 50, 20, 10, 5, 2];

export interface ChangeTerm { count: number; pence?: number; tube?: number }

export interface CoinLine {
  line: number;
  credits: number;
  change: ChangeTerm[][];
  token?: boolean;
  tokenPence?: number | null;
}

export interface CoinLineTable {
  lines: CoinLine[];
  pricePerCredit: number | null;
  source: string;
}

export interface Refusal { refused: string }

const EPS = 1e-9;
const isCoin = (v: number): boolean => UK_COINS.some((c) => Math.abs(c - v) < EPS);

function altValue(alt: readonly ChangeTerm[], tubes: ReadonlyMap<number, number>): number | null {
  let v = 0;
  for (const t of alt) {
    if (t.pence !== undefined) v += t.count * t.pence;
    else if (t.tube !== undefined) {
      const p = tubes.get(t.tube);
      if (p === undefined) return null;
      v += t.count * p;
    }
  }
  return v;
}

function lineValue(l: CoinLine, p: number, tubes: ReadonlyMap<number, number>): number {
  let change = 0;
  if (l.change.length) {
    const vals = l.change.map((a) => altValue(a, tubes));
    if (vals.some((v) => v === null)) return NaN;
    change = vals[0]!;
    if (vals.some((v) => Math.abs((v as number) - change) > EPS)) return NaN;
  }
  return l.credits * p + change;
}

function tubeIds(table: CoinLineTable): number[] {
  const s = new Set<number>();
  for (const l of table.lines) if (!l.token) for (const a of l.change) for (const t of a) if (t.tube !== undefined) s.add(t.tube);
  return [...s].sort((a, b) => a - b);
}

function* tubeAssignments(ids: readonly number[]): Generator<Map<number, number>> {
  if (!ids.length) { yield new Map(); return; }
  const [first, ...rest] = ids;
  for (const c of UK_COINS) for (const m of tubeAssignments(rest)) { m.set(first!, c); yield m; }
}

function priceCandidates(table: CoinLineTable): number[] {
  if (table.pricePerCredit !== null) return [table.pricePerCredit];
  const out = new Set<number>();
  for (const l of table.lines) {
    if (l.credits <= 0 || l.token) continue;
    const fixed = l.change.length && l.change.every((a) => a.every((t) => t.pence !== undefined))
      ? altValue(l.change[0]!, new Map()) ?? 0 : l.change.length ? null : 0;
    if (fixed === null) continue;
    for (const c of UK_COINS) if (c > fixed) out.add((c - fixed) / l.credits);
  }
  return [...out];
}

export const TOKEN_PENCE: readonly number[] = [5, 10, 20, 25, 50, 100];

export const isLive = (l: CoinLine): boolean => l.credits > 0 || l.change.length > 0 || (!!l.token && l.tokenPence !== undefined);

function tokenValue(l: CoinLine, p: number | null, tubes: ReadonlyMap<number, number>): number | null {
  if (l.tokenPence !== undefined) return l.tokenPence;
  if (p === null || (l.credits <= 0 && !l.change.length)) return null;
  const v = lineValue(l, p, tubes);
  return Number.isFinite(v) && v > EPS && Math.abs(v - Math.round(v)) < EPS ? Math.round(v) : null;
}

export function detectCoins(table: CoinLineTable): Map<number, SlotCoin> | Refusal {
  const live = table.lines.filter(isLive);
  if (!live.length) return { refused: 'the table credits no line' };
  const cash = live.filter((l) => !l.token);
  const tokens = live.filter((l) => l.token);
  const withTokens = (coins: Map<number, number>, p: number | null, tubes: ReadonlyMap<number, number>): Map<number, SlotCoin> => {
    const out = new Map<number, SlotCoin>(coins);
    for (const l of tokens) out.set(l.line, { token: tokenValue(l, p, tubes) });
    return new Map([...out].sort((a, b) => a[0] - b[0]));
  };
  if (!cash.length) return withTokens(new Map(), table.pricePerCredit, new Map());
  const ids = tubeIds(table);
  const found = new Map<string, Map<number, SlotCoin>>();
  for (const p of priceCandidates(table)) {
    for (const tubes of tubeAssignments(ids)) {
      const coins = new Map<number, number>();
      let ok = true;
      for (const l of cash) {
        const v = lineValue(l, p, tubes);
        if (!Number.isFinite(v) || !isCoin(v)) { ok = false; break; }
        coins.set(l.line, Math.round(v));
      }
      if (!ok) continue;
      const all = withTokens(coins, p, tubes);
      found.set(JSON.stringify([...all]), all);
    }
  }
  if (found.size === 0) return { refused: 'no single price per credit makes every line a coin' };
  if (found.size > 1) {
    const credited = new Set(tokens.filter((l) => l.tokenPence === undefined).map((l) => l.line));
    const fits = [...found.values()].filter((m) => credited.size > 0 && [...credited].every((line) => {
      const c = m.get(line);
      return typeof c === 'object' && c.token !== null && TOKEN_PENCE.includes(c.token);
    }));
    if (fits.length === 1) return fits[0]!;
    return { refused: `${found.size} prices per credit fit the table equally` };
  }
  return [...found.values()][0]!;
}

export function detectPrices(table: CoinLineTable): Map<number, number> | Refusal {
  const coins = detectCoins(table);
  if (!(coins instanceof Map)) return coins;
  const out = new Map<number, number>();
  for (const [line, c] of coins) { const v = coinValue(c); if (v !== null) out.set(line, v); }
  return out;
}

function coinValue(c: SlotCoin): number | null {
  return typeof c === 'number' ? c : c.token;
}

function groupBySlot(slots: readonly number[], coins: ReadonlyMap<number, SlotCoin>, how: SlotWiring['how'], drawn: Iterable<number> = []): CoinWiring | null {
  const reached = new Set<number>([...slots, ...drawn]);
  const own = new Map<number, SlotCoin>();
  for (const s of slots) { const c = coins.get(s); if (c !== undefined) own.set(s, c); }
  if (!own.size) return null;
  const rank = (c: SlotCoin): number => (typeof c === 'number' ? 1e6 + c : (c.token ?? 0));
  let big = -1; let bigV = -1;
  for (const [s, c] of own) if (rank(c) > bigV) { big = s; bigV = rank(c); }
  const worth = (c: SlotCoin): number => coinValue(c) ?? -1;
  const out: CoinWiring = {};
  for (const s of slots) {
    const list: WiredCoin[] = [];
    const oc = own.get(s);
    if (oc !== undefined) list.push({ coin: oc, line: s });
    if (s === big) {
      for (const [line, c] of [...coins].sort((a, b) => worth(b[1]) - worth(a[1]) || a[0] - b[0])) {
        if (!reached.has(line)) list.push({ coin: c, line });
      }
    }
    if (list.length) out[String(s)] = { coins: list, how };
  }
  return out;
}

export function detectWiring(slots: readonly number[], table: CoinLineTable | null | undefined, refusing = 0, drawn: Iterable<number> = []): CoinWiring | null {
  if (!table || !slots.length) return null;
  const coins = detectCoins(table);
  if (!(coins instanceof Map)) return null;
  const locked = (line: number): boolean => line < 32 && ((refusing >>> line) & 1) === 1;
  if ([...coins.keys()].some((l) => !locked(l))) for (const l of [...coins.keys()]) if (locked(l)) coins.delete(l);
  return groupBySlot(slots, coins, 'detected', drawn);
}

export function slotlessLines(table: CoinLineTable | null | undefined, drawn: Iterable<number>): number[] {
  if (!table) return [];
  const reached = new Set(drawn);
  const coins = detectCoins(table);
  const priced = new Set<number>();
  if (coins instanceof Map) {
    for (const [line, c] of coins) if (typeof c === 'number' || c.token !== null) priced.add(line);
  }
  const out = new Set<number>();
  for (const l of table.lines) if (isLive(l) && !reached.has(l.line) && !priced.has(l.line)) out.add(l.line);
  return [...out].sort((a, b) => a - b);
}

export function mapAsked(wiring: CoinWiring, table: CoinLineTable | null | undefined, slotless: readonly number[] = []): CoinWiring {
  if (!table) return wiring;
  const out: CoinWiring = {};
  const slots = Object.keys(wiring).map(Number);
  const owned = new Set(slots);
  const lines = table?.lines.filter(isLive) ?? [];
  const tokenLines = new Set(lines.filter((l) => l.token).map((l) => l.line));

  const asked = [...new Set(Object.values(wiring).flatMap((s) => s.coins.map((c) => coinValue(c.coin))).filter((v): v is number => v !== null))];
  const solutions: Map<number, number[]>[] = [];
  if (table && asked.length) {
    const fixed = detectPrices(table);
    const tries: Map<number, number>[] = [];
    if (fixed instanceof Map) tries.push(fixed);
    else {
      const ids = tubeIds(table);
      const cands = new Set<number>(table.pricePerCredit !== null ? [table.pricePerCredit] : []);
      if (table.pricePerCredit === null) for (const l of lines) if (l.credits > 0 && !l.token) for (const v of asked) cands.add(v / l.credits);
      for (const p of cands) for (const tubes of tubeAssignments(ids)) {
        const m = new Map<number, number>();
        for (const l of lines) {
          const v = l.token ? tokenValue(l, p, tubes) ?? NaN : lineValue(l, p, tubes);
          if (Number.isFinite(v)) m.set(l.line, v);
        }
        tries.push(m);
      }
    }
    let best = 0;
    for (const m of tries) {
      const at = new Map<number, number[]>();
      for (const v of asked) {
        const hit = [...m].filter(([, lv]) => Math.abs(lv - v) < EPS).map(([l]) => l);
        if (hit.length) at.set(v, hit);
      }
      if (at.size > best) { best = at.size; solutions.length = 0; }
      if (at.size === best && best > 0) solutions.push(at);
    }
  }

  for (const [key, slot] of Object.entries(wiring)) {
    if (slot.how !== 'asked') { out[key] = slot; continue; }
    if (slotless.includes(Number(key))) {
      out[key] = { coins: slot.coins.map((c) => ({ coin: c.coin, line: c.line ?? Number(key) })), how: slot.how };
      continue;
    }
    const own = Number(key);
    const placed: WiredCoin[] = [];
    for (const c of slot.coins) {
      const v = coinValue(c.coin);
      let line: number | null = null;
      if (v !== null && solutions.length) {
        const kind = (hits: readonly number[]): number[] => {
          const token = typeof c.coin === 'object';
          const mine = hits.filter((l) => tokenLines.has(l) === token);
          return mine.length ? mine : [...hits];
        };
        const picks = solutions.map((sol) => pickLine(kind(sol.get(v) ?? []), own, owned));
        line = picks.every((p) => p !== null && p === picks[0]) ? picks[0]! : null;
      }
      placed.push({ coin: c.coin, line: line ?? c.line });
    }
    for (const p of placed) {
      if (p.line === null && typeof p.coin === 'object' && p.coin.token === null
        && !placed.some((q) => q.line === own) && placed.filter((q) => typeof q.coin === 'object' && q.coin.token === null).length === 1) {
        p.line = own;
      }
    }
    out[key] = { coins: placed, how: slot.how };
  }
  return out;
}

function pickLine(hits: readonly number[], own: number, owned: ReadonlySet<number>): number | null {
  if (hits.length === 1) return hits[0]!;
  if (hits.includes(own)) return own;
  const free = hits.filter((l) => !owned.has(l));
  return free.length === 1 ? free[0]! : null;
}

export function linesOf(wiring: CoinWiring): { coins: Map<number, SlotCoin>; conflicts: number[] } {
  const coins = new Map<number, SlotCoin>();
  const bad = new Set<number>();
  const same = (a: SlotCoin, b: SlotCoin): boolean => JSON.stringify(a) === JSON.stringify(b);
  for (const s of Object.values(wiring)) {
    for (const c of s.coins) {
      if (c.line === null) continue;
      const had = coins.get(c.line);
      if (had !== undefined && !same(had, c.coin)) bad.add(c.line);
      else coins.set(c.line, c.coin);
    }
  }
  for (const l of bad) coins.delete(l);
  return { coins, conflicts: [...bad].sort((a, b) => a - b) };
}

export function changeOf(table: CoinLineTable | null | undefined, coins: ReadonlyMap<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  if (!table) return out;
  let p: number | null = table.pricePerCredit;
  if (p === null) {
    for (const l of table.lines) {
      const v = coins.get(l.line);
      if (l.change.length || l.credits <= 0 || l.token || v === undefined) continue;
      const q = v / l.credits;
      if (p === null) p = q;
      else if (Math.abs(p - q) > EPS) return out;
    }
  }
  if (p === null) return out;
  for (const l of table.lines) {
    const v = coins.get(l.line);
    if (!l.change.length || v === undefined) continue;
    const c = v - l.credits * p;
    if (c > EPS) out.set(l.line, c);
  }
  return out;
}

export interface StepSample { pence: number; counts: number }

export function meterStep(samples: readonly StepSample[]): number | null {
  if (!samples.length) return null;
  let step: number | null = null;
  for (const s of samples) {
    if (!(s.counts > 0) || !(s.pence > 0)) return null;
    const v = s.pence / s.counts;
    if (step === null) step = v;
    else if (Math.abs(v - step) > EPS * Math.max(1, step)) return null;
  }
  return step;
}

export type StepState = 'waiting' | 'calibrated' | 'disagrees';

export type WatchedCoin = number | null | undefined;

export interface StepWindow { coins: WatchedCoin[]; counts: number }

export class MeterStepCalibrator {
  state: StepState = 'waiting';
  step: number | null = null;

  constructor(private readonly quiet: number, private readonly firstWait: number, private readonly s: CalibratorState = calibratorState()) {
    this.state = s.state;
    this.step = s.step;
  }

  coin(c: WatchedCoin, at: number): void {
    const w = this.s.win;
    if (w.open) { w.coins.push(c); w.last = at; }
    else { w.open = true; w.coins = [c]; w.counts = 0; w.last = at; }
  }

  count(n: number, at: number): void {
    const w = this.s.win;
    if (!w.open || n <= 0) return;
    w.counts += n;
    w.last = at;
  }

  tick(at: number): StepWindow | null {
    const w = this.s.win;
    if (!w.open) return null;
    if (at - w.last < (w.counts > 0 ? this.quiet : this.firstWait)) return null;
    const closed = { coins: w.coins, counts: w.counts };
    w.open = false; w.coins = []; w.counts = 0;
    const c = closed.coins[0];
    if (closed.coins.length === 1 && typeof c === 'number' && closed.counts > 0 && this.state !== 'disagrees') {
      this.s.samples.push({ pence: c, counts: closed.counts });
      const st = meterStep(this.s.samples);
      if (st === null) { this.state = 'disagrees'; this.step = null; } else { this.state = 'calibrated'; this.step = st; }
      this.s.state = this.state; this.s.step = this.step;
    }
    return closed;
  }

  get taken(): readonly StepSample[] { return this.s.samples; }
}

export interface CalibratorState {
  samples: StepSample[];
  win: { open: boolean; coins: WatchedCoin[]; counts: number; last: number };
  state: StepState;
  step: number | null;
}

export function calibratorState(): CalibratorState {
  return { samples: [], win: { open: false, coins: [], counts: 0, last: 0 }, state: 'waiting', step: null };
}

export function wiringStateFor<S extends { key: string }>(cur: S, hadWiring: boolean, key: string, fresh: (key: string) => S): S {
  return !hadWiring && cur.key === key ? cur : fresh(key);
}

export function wiringKey(w: CoinWiring): string {
  const { coins, conflicts } = linesOf(w);
  const lines = [...coins].sort((a, b) => a[0] - b[0]).map(([l, c]) => `${l}=${JSON.stringify(c)}`);
  return lines.join(' ') + (conflicts.length ? ` !${[...conflicts].sort((a, b) => a - b).join(',')}` : '');
}

export interface LineMeasurement {
  line: number | null;
  inCounts: number;
  outCounts: number;
  meters: number[];
  refused: boolean;
  seconds: number;
  closed: 'quiet' | 'nothing' | 'cap';
}

export type CoinMeasurement =
  | { control: LineMeasurement; lines: LineMeasurement[] }
  | Refusal;

export interface MeasuredTable { table: CoinLineTable; unsettled: Map<number, string>; ties: number[] }

export function measuredTable(m: CoinMeasurement): MeasuredTable | Refusal {
  if ('refused' in m) return m;
  const c = m.control;
  if (c.inCounts !== 0 || c.outCounts !== 0) return { refused: 'the machine counted money with no coin in' };
  const unsettled = new Map<number, string>();
  const lines: CoinLine[] = [];
  for (const l of m.lines) {
    if (l.line === null) continue;
    if (l.closed === 'cap') { unsettled.set(l.line, `still counting after ${l.seconds.toFixed(0)} machine seconds`); continue; }
    if (l.outCounts < 0) { unsettled.set(l.line, 'its money out count went down (the grid nets money in against money out)'); continue; }
    lines.push({ line: l.line, credits: l.inCounts + l.outCounts, change: [] });
  }
  lines.sort((a, b) => a.line - b.line);
  if (!lines.some((l) => l.credits > 0)) {
    return { refused: unsettled.size ? 'no line could be measured to the end' : 'no coin line counted any money in' };
  }
  const ties = lines.filter((l) => l.credits > 0 && lines.some((o) => o !== l && o.credits === l.credits)).map((l) => l.line);
  return { table: { lines, pricePerCredit: null, source: 'measured: money counts per coin' }, unsettled, ties };
}

export const NO_SINGLE_PRICE = 'the counts fit no single price';

export function measureWiring(slots: readonly number[], m: CoinMeasurement, drawn: Iterable<number> = []): CoinWiring | null {
  if (!slots.length) return null;
  const t = measuredTable(m);
  if ('refused' in t) return null;
  const prices = detectCoins(t.table);
  if (!(prices instanceof Map)) return null;
  for (const l of t.ties) prices.delete(l);
  return groupBySlot(slots, prices, 'measured', drawn);
}

export class MeterUnitCheck {
  constructor(readonly unit: number, private readonly slack: number, private readonly quiet: number, private readonly s: MeterCheckState = meterCheckState()) {}

  get state(): StepState { return this.s.state; }

  get step(): number | null { return this.s.state === 'calibrated' ? this.unit : null; }

  coin(c: WatchedCoin, at: number): void {
    if (typeof c === 'number') this.s.pence += c;
    this.s.last = at;
    this.s.dirty = true;
  }

  count(n: number, at: number): void {
    if (n <= 0) return;
    this.s.counts += n;
    this.s.last = at;
    this.s.dirty = true;
  }

  tick(at: number): boolean {
    const s = this.s;
    if (!s.dirty || s.state === 'disagrees' || at - s.last < this.quiet) return false;
    s.dirty = false;
    const behind = s.pence - s.counts * this.unit;
    if (behind < -EPS || behind > this.slack + EPS) s.state = 'disagrees';
    else if (s.counts > 0) s.state = 'calibrated';
    return true;
  }

  get totals(): { pence: number; counts: number } { return { pence: this.s.pence, counts: this.s.counts }; }
}

export interface MeterCheckState { pence: number; counts: number; last: number; dirty: boolean; state: StepState }

export function meterCheckState(): MeterCheckState {
  return { pence: 0, counts: 0, last: 0, dirty: false, state: 'waiting' };
}
