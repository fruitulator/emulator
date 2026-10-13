import { acceptorResolve, type AcceptorView } from './platform';
import { hasInput, type CabLamp } from './dat';
import type { MachineInfo } from './emu-protocol';
import type { NamedCoin } from '../src/machine/machine';
import { slotsToName, type NamingInfo } from './coinask';

export interface WireSlot { line: number; left: number; top: number; width: number; height: number }

export function slotsToWire(lamps: readonly CabLamp[], view: AcceptorView, info: Pick<MachineInfo, 'unnamedCoins' | 'coins' | 'coinPort'> | null): WireSlot[] {
  const unnamed = info?.unnamedCoins;
  if (!unnamed?.length) return [];
  const by = new Map<number, WireSlot>();
  for (const lp of lamps) {
    let line = -1;
    if (lp.acceptor) {
      const r = acceptorResolve(view, lp, info?.coins, info?.coinPort);
      if (r.kind === 'note') continue;
      line = r.line;
    } else if (lp.coinInput !== undefined && hasInput(lp)) {
      line = lp.coinInput;
    }
    if (line < 0 || !unnamed.includes(line)) continue;
    const at = by.get(line);
    if (!at || lp.left < at.left || (lp.left === at.left && lp.top < at.top)) by.set(line, { line, left: lp.left, top: lp.top, width: lp.width, height: lp.height });
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
