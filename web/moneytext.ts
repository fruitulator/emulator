import type { CashLedger } from '../src/machine/machine';
import { str } from './i18n';

export const pounds = (p: number): string => `${p < 0 ? '-' : ''}£${(Math.abs(p) / 100).toFixed(2)}`;

export const euros = (c: number): string => `${c < 0 ? '-' : ''}€${(Math.abs(c) / 100).toFixed(2)}`;

const n = (x: number | undefined): number => x ?? 0;

function join(cash: number, euro: number, coins: number): string {
  const parts: string[] = [];
  if (cash || (!euro && !coins)) parts.push(pounds(cash));
  if (euro) parts.push(euros(euro));
  if (coins) parts.push(str('moneytext.n_coins_of_unknown_value', { n: coins }));
  return parts.join(' + ');
}

export function moneyInText(t: Partial<CashLedger>): string {
  return join(n(t.inPence), n(t.euroInCents), n(t.unpricedIn));
}

export function moneyOutText(t: Partial<CashLedger>): string {
  return join(n(t.outPence), n(t.euroOutCents), n(t.unpricedOut));
}
