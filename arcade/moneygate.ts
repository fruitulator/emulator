import type { CashLedger } from '../src/machine/machine';
import { str } from '../web/i18n';

export const NO_BOOKKEEPING = str('arcade.moneygate.no_book_keeping_available_on');

export function unpricedMoved(a: CashLedger | null, b: CashLedger | null): boolean {
  if (!a || !b) return false;
  return b.unpricedOut !== a.unpricedOut || b.unpricedTokenOut !== a.unpricedTokenOut
    || (b.euroOutCents ?? 0) !== (a.euroOutCents ?? 0);
}

export function unknownMoneyMoved(a: CashLedger | null, b: CashLedger | null): boolean {
  if (!a || !b) return false;
  return unpricedMoved(a, b)
    || (b.unpricedIn ?? 0) !== (a.unpricedIn ?? 0)
    || (b.unpricedTokenIn ?? 0) !== (a.unpricedTokenIn ?? 0)
    || (b.euroInCents ?? 0) !== (a.euroInCents ?? 0);
}
