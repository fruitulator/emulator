import { acceptorResolve, coinInputLine, type AcceptorView, type PlatformView } from './platform';
import { hasInput, type CabLamp } from './dat';
import type { MachineInfo } from './emu-protocol';
import type { NamedCoin } from '../src/machine/machine';
import { slotsToName, type NamingInfo } from './coinask';

export interface WireSlot { line: number; left: number; top: number; width: number; height: number }

export function slotsToWire(lamps: readonly CabLamp[], view: AcceptorView, info: Pick<MachineInfo, 'unnamedCoins' | 'coins' | 'coinPort'> | null): WireSlot[] {
  const unnamed = info?.unnamedCoins;
  if (!unnamed?.length) return [];
  return coinLineSlots(lamps, view, info, unnamed);
}

export interface DrawnSlot extends WireSlot { acceptor: boolean }

export function coinLineSlots(
  lamps: readonly CabLamp[], view: AcceptorView & Partial<Pick<PlatformView, 'coins'>>,
  info: Pick<MachineInfo, 'coins' | 'coinPort'> | null, lines: readonly number[],
): DrawnSlot[] {
  const by = new Map<number, DrawnSlot>();
  for (const lp of lamps) {
    if (lp.hidden) continue;
    let line = -1;
    const acceptor = !!lp.acceptor;
    if (lp.acceptor) {
      const r = acceptorResolve(view, lp, info?.coins, info?.coinPort);
      if (r.kind === 'note') continue;
      line = r.line;
    } else if (hasInput(lp)) {
      line = lp.coinInput ?? (view.coins ? coinInputLine({ ...view, coins: view.coins }, lp.button, info?.coins ?? view.coins) : -1);
    }
    if (line < 0 || !lines.includes(line)) continue;
    const at = by.get(line);
    if (!at || lp.left < at.left || (lp.left === at.left && lp.top < at.top)) {
      by.set(line, { line, left: lp.left, top: lp.top, width: lp.width, height: lp.height, acceptor: acceptor || !!at?.acceptor });
    } else if (acceptor) at.acceptor = true;
  }
  return [...by.values()].sort((a, b) => a.left - b.left || a.top - b.top);
}

export interface NamingSlot { line: number; coin: NamedCoin | null }

export function namingSlots(
  lamps: readonly CabLamp[], view: AcceptorView,
  info: (NamingInfo & Pick<MachineInfo, 'unnamedCoins' | 'coins' | 'coinPort'>) | null | undefined,
  answers: Readonly<Record<string, NamedCoin>>,
): NamingSlot[] {
  const lines = slotsToName(info, answers);
  if (!lines.length) return [];
  const drawn = slotsToWire(lamps, view, info ?? null).map((s) => s.line).filter((l) => lines.includes(l));
  return [...drawn, ...lines.filter((l) => !drawn.includes(l))]
    .map((line) => ({ line, coin: answers[String(line)] ?? null }));
}

export interface AcceptorSlot { key: number; part: WireSlot | null; parts: number[]; lines: number[]; token: boolean }

export function acceptorSlots(parts: readonly (WireSlot & { acceptor?: boolean })[], coins: ReadonlyMap<number, NamedCoinish>): AcceptorSlot[] {
  const seen = new Set<number>();
  const drawn = parts.filter((p) => !seen.has(p.line) && seen.add(p.line))
    .sort((a, b) => a.left - b.left || a.top - b.top);
  const area = (p: WireSlot): number => p.width * p.height;
  const drawnAcceptor = (p: WireSlot & { acceptor?: boolean }): boolean => !!p.acceptor;
  const gap = (a: WireSlot, b: WireSlot): number =>
    Math.max(0, a.left - (b.left + b.width), b.left - (a.left + a.width))
    + Math.max(0, a.top - (b.top + b.height), b.top - (a.top + a.height));
  const besides = (p: WireSlot & { acceptor?: boolean }, q: WireSlot): boolean => p !== q && !drawnAcceptor(p) && area(p) * 2 <= area(q) && gap(p, q) <= Math.max(p.width, p.height);
  const tokenOn = (line: number): boolean => { const c = coins.get(line); return c !== undefined && typeof c === 'object'; };
  const hosts = drawn.filter((p) => !drawn.some((q) => besides(p, q)));
  const slots: AcceptorSlot[] = hosts.map((p) => ({ key: p.line, part: p, parts: [p.line], lines: [p.line], token: tokenOn(p.line) }));
  for (const p of drawn) {
    if (hosts.includes(p)) continue;
    const near = slots.filter((s) => s.part && besides(p, s.part) && s.token === tokenOn(p.line))
      .sort((a, b) => gap(p, a.part!) - gap(p, b.part!))[0];
    if (near) { near.parts.push(p.line); near.lines.push(p.line); }
    else slots.push({ key: p.line, part: p, parts: [p.line], lines: [p.line], token: tokenOn(p.line) });
  }
  slots.sort((a, b) => a.part!.left - b.part!.left || a.part!.top - b.part!.top);
  const held = new Set(slots.flatMap((s) => s.lines));
  const drawnSlots = slots.length;
  for (const line of [...coins.keys()].sort((a, b) => a - b)) {
    if (held.has(line)) continue;
    const token = tokenOn(line);
    const main = slots.find((s) => s.token === token) ?? (drawnSlots ? slots[0] : undefined);
    if (main) main.lines.push(line);
    else slots.push({ key: line, part: null, parts: [], lines: [line], token });
  }
  return slots;
}

type NamedCoinish = number | { token: number | null };
