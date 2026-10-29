import type { MachineInfo } from '../web/emu-protocol';
import type { Emu } from '../web/emu-client';
import { markableLine, viewFor, type PlatformView } from '../web/platform';
import { wiringFromAnswers, readCoinWiring, namedCoinsOf, wiredCoinOn, markedSlots, playableWiring, slotCoinPence, type CoinWiring } from '../web/coinask';
import { hasInput, type CabLamp } from '../web/dat';
import type { NamedCoin } from '../src/machine/machine';
import { detectWiring, isLive, mapAsked as mapAskedByTable, measuredTable, measureWiring, NO_SINGLE_PRICE, markedCounted } from '../src/machine/coinwiring';

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

export function measureLines(req: WiringRequest): number[] {
  const chutes = req.info.coins ?? viewFor(req.info.system).coins;
  const out = new Set<number>(req.slots);
  for (const c of chutes) out.add(c.bit);
  return [...out].sort((a, b) => a - b);
}

export { slotsToWire } from '../web/coinslots';

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
  for (const s of Object.values(w)) if (s.coins.some((c) => c.line !== null && slotCoinPence(c.coin) !== null)) return true;
  const lines = new Set<number>([
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
