import type { CashLedger } from '../src/machine/machine';

export const MONEY_RECORD_VERSION = 1;

export interface MoneyTotals {
  v: number;
  total: CashLedger;
  since: number;
  at: number;
  restarts: number;
}

export const LEDGER_FIELDS = [
  'inPence', 'outPence', 'unpricedOut', 'tokenInPence', 'tokenOutPence', 'unpricedTokenOut', 'unpricedTokenIn',
] as const;
const n = (x: number | undefined): number => x ?? 0;

export function zeroLedger(): CashLedger {
  return { inPence: 0, outPence: 0, unpricedOut: 0, tokenInPence: 0, tokenOutPence: 0, unpricedTokenOut: 0, unpricedTokenIn: 0 };
}

export function emptyRecord(now: number): MoneyTotals {
  return { v: MONEY_RECORD_VERSION, total: zeroLedger(), since: now, at: now, restarts: 0 };
}

export function sameRun(from: CashLedger, to: CashLedger): boolean {
  return LEDGER_FIELDS.every((k) => n(to[k]) >= n(from[k]));
}

export function addReading<T extends MoneyTotals>(rec: T, from: CashLedger | null, to: CashLedger, now: number): T {
  const restarted = !!from && !sameRun(from, to);
  const base = from && !restarted ? from : zeroLedger();
  const total = { ...rec.total };
  let moved = false;
  for (const k of LEDGER_FIELDS) {
    const d = n(to[k]) - n(base[k]);
    if (d) { total[k] = n(total[k]) + d; moved = true; }
  }
  return { ...rec, total, at: moved ? now : rec.at, restarts: rec.restarts + (restarted ? 1 : 0) };
}

export function keptNumber(y: unknown): number {
  return typeof y === 'number' && Number.isFinite(y) && y >= 0 ? Math.round(y) : 0;
}

export function readMoneyTotals(x: unknown, now: number): MoneyTotals | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const t = o.total as Record<string, unknown> | null | undefined;
  if (!t || typeof t !== 'object') return null;
  const total = zeroLedger();
  for (const k of LEDGER_FIELDS) total[k] = keptNumber(t[k]);
  return {
    v: MONEY_RECORD_VERSION,
    total,
    since: typeof o.since === 'number' ? o.since : now,
    at: typeof o.at === 'number' ? o.at : now,
    restarts: keptNumber(o.restarts),
  };
}
