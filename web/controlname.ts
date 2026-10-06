import type { CabLamp } from './dat';
import { acceptorBit, acceptorResolve, acceptorTakesToken, coinInputLine, type PlatformView } from './platform';
import type { CoinChute, CoinPortLines } from '../src/machine/machine';
import { str } from './i18n';

export function acceptorLine(
  lp: CabLamp,
  view: PlatformView,
  chutes?: readonly CoinChute[],
  port?: CoinPortLines,
): number {
  return acceptorBit(view, lp, chutes, port);
}

function slotPrice(
  line: number,
  coins: readonly { label: string; bit: number }[],
): string | undefined {
  const coin = coins.find((c) => c.bit === line);
  if (!coin) return undefined;
  return coin.label === 'Token' ? str('controlname.token_slot') : str('controlname.coin_slot_n', { 0: coin.label });
}

function roleOfPlatformLabel(label: string): string {
  const l = label.trim().toLowerCase();
  if (/\bcollect\b|\bcancel\/collect\b/.test(l)) return 'collect';
  if (/\bstart\b|\bplay\b/.test(l)) return 'start';
  if (/\bexchange\b/.test(l)) return 'exchange';
  if (/\bcancel\b/.test(l)) return 'cancel';
  if (/\btake\b/.test(l)) return 'take';
  if (/\bnudge\b/.test(l)) return 'nudge';
  return '';
}

export const UNNAMED = str('controlname.unnamed_button');

export const UNLABELLED = str('controlname.unlabelled_control');

export type NameSource = 'slot' | 'program' | 'layout' | 'board' | 'none';
export interface ControlNaming { label: string; source: NameSource }
const slot = (label: string): ControlNaming => ({ label, source: 'slot' });

export function controlName(
  lp: CabLamp,
  view: PlatformView,
  coins: readonly (CoinChute | { label: string; bit: number })[] = view.coins,
  capNames?: Record<number, { role: string; label: string }>,
  port?: CoinPortLines,
): string {
  return controlNaming(lp, view, coins, capNames, port).label;
}

export function controlNaming(
  lp: CabLamp,
  view: PlatformView,
  coins: readonly (CoinChute | { label: string; bit: number })[] = view.coins,
  capNames?: Record<number, { role: string; label: string }>,
  port?: CoinPortLines,
): ControlNaming {
  if (lp.acceptor) {
    const got = acceptorResolve(view, lp, coins, port);
    if (got.kind === 'note') return slot(got.line > 0 ? str('controlname.note_slot_note_n', { 0: got.line }) : str('controlname.note_slot'));
    return slot(slotPrice(got.line, coins) ?? (acceptorTakesToken(view, lp, got.line, coins) ? str('controlname.token_slot') : str('controlname.coin_slot')));
  }
  const coinLine = coinInputLine(view, lp.button ?? -1, coins);
  if (coinLine >= 0) {
    return slot(slotPrice(coinLine, coins) ?? (coinLine === view.tokenBit ? str('controlname.token_slot') : str('controlname.coin_slot')));
  }
  const measured = lp.button !== undefined ? capNames?.[lp.button] : undefined;
  if (measured) return { label: measured.label, source: 'program' };
  if (lp.label) return { label: lp.label, source: 'layout' };
  if (lp.name) return { label: lp.name, source: 'layout' };
  const legend = lp.legend?.off || lp.legend?.on;
  if (legend) return { label: legend, source: 'layout' };
  const pb = view.playButtons.find((p) => p.strobe * 8 + p.bit === lp.button);
  const measuredRoles = new Set(Object.values(capNames ?? {}).map((c) => c.role).filter(Boolean));
  if (pb?.certain && !measuredRoles.has(roleOfPlatformLabel(pb.label))) return { label: pb.label, source: 'board' };
  const ni = view.namedInputs.find((n) => n.strobe * 8 + n.bit === lp.button);
  if (ni) return { label: ni.label, source: 'board' };
  if (lp.button === undefined) {
    return { label: UNLABELLED, source: 'none' };
  }
  const wired = view.inputNames?.[lp.button];
  return wired ? { label: wired, source: 'board' } : { label: UNNAMED, source: 'none' };
}
