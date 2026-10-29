import type { CashLedger } from '../src/machine/machine';
import type { MoneyTrust } from './doc';
import audit from './bookkeeping.json';
import { AUDIT_WHY, type AuditVerdict } from './auditwords';
import { str } from '../web/i18n';

export interface AuditRow {
  verdict: AuditVerdict;
  why: string;
}

const BOARDS = (audit as { boards: Record<string, AuditRow> }).boards;

export function auditRow(board: string): AuditRow | null {
  return BOARDS[board.toUpperCase()] ?? null;
}

export const NO_BOOKKEEPING = str('arcade.moneygate.no_book_keeping_available_on');

export const PAYOUT_UNVERIFIED = str('arcade.moneygate.payout_unverified_money_out_hasn');

export interface MoneyVerdict {
  trust: MoneyTrust;
  why: string;
}

export function moneyTrust(board: string): MoneyVerdict {
  const row = auditRow(board);
  if (!row) return { trust: 'untrusted', why: AUDIT_WHY.notAudited };
  switch (row.verdict) {
    case 'cannot-book': return { trust: 'none', why: row.why || str('arcade.moneygate.this_board_cannot_book_money') };
    case 'books': return { trust: 'billable', why: '' };
    default: return { trust: 'untrusted', why: row.why || str('arcade.moneygate.money_out_not_yet_trusted') };
  }
}

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
