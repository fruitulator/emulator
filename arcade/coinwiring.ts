import type { MachineInfo } from '../web/emu-protocol';
import type { Emu } from '../web/emu-client';
import { markableLine, viewFor, type PlatformView } from '../web/platform';
import { CASH_COINS, isTokenCoin, wiringFromAnswers, readCoinWiring, namedCoinsOf, wiredCoinOn, markedSlots, playableWiring, slotCoinPence, type CoinWiring, type SlotCoin } from '../web/coinask';
import { hasInput, type CabLamp } from '../web/dat';
import type { NamedCoin } from '../src/machine/machine';
import { detectCoins, detectWiring, isLive, mapAsked as mapAskedByTable, measuredTable, measureWiring, NO_SINGLE_PRICE, markedCounted } from '../src/machine/coinwiring';
import { penceOf } from './wallet';
import { acceptorSlots, slotsToWire, type DrawnSlot } from '../web/coinslots';

export type { WireSlot } from '../web/coinslots';

export interface WiringRequest { slots: readonly number[]; info: MachineInfo }

export interface WiringFinder {
  detect(req: WiringRequest, emu: Emu): Promise<CoinWiring | null>;
  measure(req: WiringRequest, emu: Emu): Promise<CoinWiring | null>;
  mapAsked(w: CoinWiring, info: MachineInfo): CoinWiring;
}

export const wiringFinder: WiringFinder = {
  detect: async (req, emu) => {
    const f = emu.latestFrame?.();
    return detectWiring(req.slots, req.info.coinTable, f ? (f.coinRefusing | f.coinLinesShut) >>> 0 : 0, req.info.drawnCoins);
  },
  measure: async (req, emu) => {
    if (!req.slots.length) return null;
    const got = await emu.measureCoins(measureLines(req));
    if (!got) return null;
    const w = measureWiring(req.slots, got.result, req.info.drawnCoins);
    if (!w) {
      const t = measuredTable(got.result);
      console.info(`[arcade] coin lines measured in ${Math.round(got.wallMs)} ms, no wiring: ${'refused' in t ? t.refused : NO_SINGLE_PRICE}`);
    }
    return w;
  },
  mapAsked: (w, info) => mapAskedByTable(w, info.coinTable, info.slotlessCoins ?? []),
};

export function coinsTaken(info: MachineInfo | null | undefined): ReadonlySet<number> | null {
  if (!info?.coinTable) return null;
  const coins = detectCoins(info.coinTable);
  if (!(coins instanceof Map)) return null;
  const out = new Set<number>();
  for (const c of coins.values()) {
    const v = typeof c === 'number' ? c : c.token;
    if (v !== null) out.add(v);
  }
  return out.size ? out : null;
}

export function hostCoinsTaken(
  credits: ReadonlyMap<number, number>, w: CoinWiring, line: number,
  needed: readonly number[] = [],
): ReadonlySet<number> | null {
  const mine = credits.get(line);
  if (!mine) return null;
  for (const [k, s] of Object.entries(w)) {
    if (Number(k) === line) continue;
    const c = credits.get(Number(k));
    const v = s.coins.length ? slotCoinPence(s.coins[0].coin) : null;
    if (c && v !== null) return new Set([(v * mine) / c]);
  }
  const fits = (v: number): boolean => needed.every((l) => {
    const c = credits.get(l);
    return l === line || !c || CASH_COINS.includes((v * c) / mine);
  });
  return new Set(CASH_COINS.filter((v) => v % mine === 0 && fits(v)));
}

export function measureLines(req: WiringRequest): number[] {
  const chutes = req.info.coins ?? viewFor(req.info.system).coins;
  const out = new Set<number>(req.slots);
  for (const c of chutes) out.add(c.bit);
  return [...out].sort((a, b) => a - b);
}

export { slotsToWire };

export function slotlessToWire(info: MachineInfo | null, refusing: number, w: CoinWiring): number[] {
  const all = info?.slotlessCoins ?? [];
  if (!all.length) return [];
  const locked = (l: number): boolean => l >= 0 && l < 32 && ((refusing >>> l) & 1) === 1;
  const table = info?.coinTable?.lines.filter(isLive).map((l) => l.line) ?? all;
  const maskOn = table.some((l) => !locked(l));
  const carried = new Set<number>();
  for (const [k, s] of Object.entries(w)) {
    if (all.includes(Number(k))) continue;
    for (const c of s.coins) if (c.line !== null) carried.add(c.line);
  }
  return all.filter((l) => w[String(l)] !== undefined || (!(maskOn && locked(l)) && !carried.has(l)));
}

export function lineCoins(info: MachineInfo | null, refusing: number, w: CoinWiring): { line: number; coin: SlotCoin }[] {
  const table = info?.coinTable;
  if (!info || !table) return [];
  const all = table.lines.filter(isLive).map((l) => l.line);
  const open = slotlessToWire({ ...info, slotlessCoins: all }, refusing, {});
  const lines = all.filter((l) => open.includes(l) || w[String(l)] !== undefined);
  const read = detectCoins(table);
  const door: readonly { label: string; bit: number; pence?: number | null; token?: boolean }[] = info.coins ?? viewFor(info.system).coins;
  const out: { line: number; coin: SlotCoin }[] = [];
  for (const line of lines) {
    const r = read instanceof Map ? read.get(line) : undefined;
    if (r !== undefined) { out.push({ line, coin: r }); continue; }
    const d = door.find((c) => c.bit === line);
    const p = d ? penceOf(d) : 0;
    if (d?.token) out.push({ line, coin: { token: p > 0 ? p : null } });
    else if (p > 0) out.push({ line, coin: p });
  }
  return out;
}

export const sameKindCoin = (a: SlotCoin, b: SlotCoin): boolean => (isTokenCoin(a) ? isTokenCoin(b) : a === b);

export function stepLineCoins(info: MachineInfo, refusing: number, w: CoinWiring): Map<number, SlotCoin> {
  const coinOf = new Map<number, SlotCoin>(lineCoins(info, refusing, w).map((c) => [c.line, c.coin]));
  if (!info.coinTable) {
    for (const c of info.coins ?? []) {
      const p = penceOf(c);
      if (coinOf.has(c.bit)) continue;
      if (c.token) coinOf.set(c.bit, { token: p > 0 ? p : null });
      else if (p > 0) coinOf.set(c.bit, p);
    }
  }
  return coinOf;
}

export interface StepSlot { key: number; parts: readonly number[]; lines: readonly number[] }

export function stepSlots(o: {
  info: MachineInfo; lamps: readonly CabLamp[]; view: PlatformView; wiring: CoinWiring; refusing: number; drawn: readonly DrawnSlot[];
}): StepSlot[] {
  const wire = slotsToWire(o.lamps, o.view, o.info);
  if (o.info.unpricedCoins) return wire.map((s) => ({ key: s.line, parts: [s.line], lines: [s.line] }));
  return acceptorSlots([...wire, ...o.drawn], stepLineCoins(o.info, o.refusing, o.wiring));
}

export function slotNumberOf(line: number, w: CoinWiring, slots: readonly StepSlot[]): number | null {
  let i = slots.findIndex((s) => w[String(s.key)]?.coins.some((c) => c.line === line) ?? false);
  if (i < 0) i = slots.findIndex((s) => s.key === line || s.parts.includes(line));
  if (i < 0) i = slots.findIndex((s) => s.lines.includes(line));
  return i < 0 ? null : i + 1;
}

export function slotOffer(coinOf: ReadonlyMap<number, SlotCoin>, unnamedCoins: readonly number[], tokenForCash = false): {
  takes: ReadonlySet<number> | null;
  token: boolean;
  unnamed: number[];
  lineFor(s: { lines: readonly number[] }, c: SlotCoin): number | null;
} {
  const unnamed = unnamedCoins.filter((l) => !coinOf.has(l));
  const takes = new Set<number>();
  let token = unnamed.length > 0;
  for (const c of coinOf.values()) {
    if (isTokenCoin(c)) token = true;
    else takes.add(c);
  }
  if (tokenForCash && takes.size) token = true;
  const cashLine = (l: number): boolean => { const o = coinOf.get(l); return o !== undefined && !isTokenCoin(o); };
  const lineFor = (s: { lines: readonly number[] }, c: SlotCoin): number | null => {
    const match = (l: number): boolean => { const o = coinOf.get(l); return o !== undefined && sameKindCoin(c, o); };
    const asCash = tokenForCash && isTokenCoin(c) ? s.lines.find(cashLine) : undefined;
    return s.lines.find(match) ?? [...coinOf.keys()].find(match) ?? s.lines.find((l) => unnamed.includes(l)) ?? asCash ?? unnamed[0]
      ?? (tokenForCash && isTokenCoin(c) ? [...coinOf.keys()].find(cashLine) : undefined) ?? null;
  };
  return { takes: unnamed.length ? null : takes, token, unnamed, lineFor };
}

export function wiringFor(configCoins: unknown, oldAnswers: unknown, info: MachineInfo | null): CoinWiring {
  const own = playableWiring(readCoinWiring(configCoins));
  const w = Object.keys(own).length ? own : wiringFromAnswers(oldAnswers);
  return info ? wiringFinder.mapAsked(w, info) : w;
}

export function coinsForLoad(configCoins: unknown, oldAnswers: unknown, info: MachineInfo | null): { coinWiring?: CoinWiring; namedCoins: Record<string, NamedCoin> } {
  const w = wiringFor(configCoins, oldAnswers, info);
  return { ...(Object.keys(w).length ? { coinWiring: w } : {}), namedCoins: namedCoinsOf(w) };
}

export function unsetCoinLine(w: CoinWiring, info: MachineInfo | null | undefined, line: number): boolean {
  return !!info?.unnamedCoins?.includes(line) && wiredCoinOn(w, line) === undefined;
}

export function unsetCoinLines(w: CoinWiring, info: MachineInfo | null | undefined): number[] {
  return (info?.unnamedCoins ?? []).filter((l) => unsetCoinLine(w, info, l));
}

export function takesNoCoinAtAll(
  info: MachineInfo | null | undefined, refusing: number, platformCoins: readonly { bit: number }[] = [],
): boolean {
  const lines = new Set<number>([
    ...(info?.coins ?? platformCoins).map((c) => c.bit),
    ...(info?.drawnCoins ?? []),
    ...(info?.slotlessCoins ?? []),
    ...(info?.unnamedCoins ?? []),
  ]);
  lines.delete(-1);
  if (!lines.size) return false;
  for (const l of lines) if (l < 0 || l >= 32 || ((refusing >>> l) & 1) === 0) return false;
  return true;
}

export function takesACoin(
  w: CoinWiring, info: MachineInfo | null | undefined, platformCoins: readonly { bit: number }[] = [],
): boolean {
  if (!unsetCoinLines(w, info).length) return true;
  const read = info?.unpricedCoins?.length ? new Set(info.unpricedCoins.map((c) => c.line)) : null;
  for (const s of Object.values(w)) if (s.coins.some((c) => c.line !== null && (!read || read.has(c.line)) && slotCoinPence(c.coin) !== null)) return true;
  const lines = read ?? new Set<number>([
    ...(info?.coins ?? platformCoins).map((c) => c.bit),
    ...(info?.drawnCoins ?? []),
    ...(info?.slotlessCoins ?? []),
    ...(info?.unnamedCoins ?? []),
  ]);
  for (const l of lines) {
    if (l < 0) continue;
    const wired = wiredCoinOn(w, l);
    if (wired) {
      if (slotCoinPence(wired) !== null) return true;
      continue;
    }
    if (wired === undefined && !unsetCoinLine(w, info, l)) return true;
  }
  return false;
}

export interface MarkableButton { button: number; line: number; lamp: CabLamp }

export function markableButtons(lamps: readonly CabLamp[], view: Pick<PlatformView, 'coinRegister'>, marked: ReadonlySet<number> = new Set()): MarkableButton[] {
  const by = new Map<number, MarkableButton>();
  for (const lp of lamps) {
    if (lp.hidden || !hasInput(lp) || lp.acceptor || (lp.coinInput !== undefined && !marked.has(lp.coinInput))) continue;
    const line = markableLine(view, lp.button);
    if (line < 0) continue;
    const at = by.get(lp.button);
    if (!at || lp.left < at.lamp.left || (lp.left === at.lamp.left && lp.top < at.lamp.top)) by.set(lp.button, { button: lp.button, line, lamp: lp });
  }
  return [...by.values()].sort((a, b) => a.lamp.left - b.lamp.left || a.lamp.top - b.lamp.top);
}

export function markedChutes(w: CoinWiring, info: Pick<MachineInfo, 'coins'> | null | undefined): { label: string; bit: number }[] {
  const own = info?.coins?.length ? info.coins : null;
  return markedSlots(playableWiring(w))
    .filter(({ line }) => !own || own.some((c) => c.bit === line))
    .map(({ line }) => ({ label: '', bit: line }));
}

export { markedCounted };
