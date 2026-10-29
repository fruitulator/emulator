import type { CashLedger, CoinChute } from '../src/machine/machine';
import type { WalletPayDay } from './serverwire';

export interface Balance {
  cashPence: number; tokenPence: number;
  coinsSpent?: number; coinsRejected?: number;
  payDay?: WalletPayDay;
}

export interface CoinCounts { spent: number; rejected: number }

export interface WalletServer {
  balance(): Promise<Balance>;
}

export const HOLD_MS = 6000;

export function penceOf(c: { label: string; pence?: number | null }): number {
  if (typeof c.pence === 'number') return c.pence;
  const pounds = /^£(\d+(?:\.\d+)?)$/.exec(c.label.trim());
  if (pounds) return Math.round(Number(pounds[1]) * 100);
  const p = /^(\d+)p$/i.exec(c.label.trim());
  return p ? Number(p[1]) : -1;
}

export function costOf(c: { label: string; pence?: number | null; token?: boolean }): number {
  const p = penceOf(c);
  if (p >= 0 || !isToken(c)) return p;
  const t = /^(\d+)p\s+token$/i.exec(c.label.trim());
  return t ? Number(t[1]) : -1;
}

export function unpriced(c: { label: string; pence?: number | null; token?: boolean }): boolean {
  return costOf(c) < 0;
}

export function isToken(c: { label: string; token?: boolean }): boolean {
  return c.token ?? /token/i.test(c.label);
}

export function moved(from: CashLedger, to: CashLedger): Balance | null {
  if (to.inPence < from.inPence || to.outPence < from.outPence
    || to.tokenInPence < from.tokenInPence || to.tokenOutPence < from.tokenOutPence) return null;
  return {
    cashPence: (to.outPence - from.outPence) - (to.inPence - from.inPence),
    tokenPence: (to.tokenOutPence - from.tokenOutPence) - (to.tokenInPence - from.tokenInPence),
  };
}

export function formatBalance(b: Balance): string {
  const money = (p: number): string => `${p < 0 ? '-' : ''}£${(Math.abs(p) / 100).toFixed(2)}`;
  return b.tokenPence ? `${money(b.cashPence)} · ${money(b.tokenPence)} tokens` : money(b.cashPence);
}

export type WalletCoin = { label: string; bit?: number; pence?: number | null; token?: boolean };

interface Held { token: boolean; pence: number; at: number; bit?: number; booked?: boolean }

export class Wallet {
  private known: Balance | null = null;
  private base: CashLedger | null = null;
  private now: CashLedger | null = null;
  private held: Held[] = [];
  private unsent: CoinCounts = { spent: 0, rejected: 0 };
  private sinceStart = 0;
  onChange: (() => void) | null = null;

  constructor(private readonly server: WalletServer) {}

  async refresh(): Promise<void> {
    try {
      const b = await this.server.balance();
      this.known = b;
      this.changed();
    } catch (e) {
      console.warn('[arcade] the balance could not be read', e);
    }
  }

  shown(at: number = Date.now()): Balance | null {
    if (!this.known) return null;
    this.expire(at);
    const d = this.base && this.now ? moved(this.base, this.now) : null;
    let cash = this.known.cashPence + (d?.cashPence ?? 0);
    let token = this.known.tokenPence + (d?.tokenPence ?? 0);
    for (const h of this.held) {
      if (h.token) token -= h.pence;
      else cash -= h.pence;
    }
    return { cashPence: cash, tokenPence: token, ...(this.known.payDay ? { payDay: this.known.payDay } : {}) };
  }

  counts(at: number = Date.now()): CoinCounts | null {
    if (!this.known) return null;
    this.expire(at);
    return {
      spent: (this.known.coinsSpent ?? 0) + this.unsent.spent,
      rejected: (this.known.coinsRejected ?? 0) + this.unsent.rejected,
    };
  }

  pay(coin: WalletCoin, at: number = Date.now()): boolean {
    if (!this.canPay(coin, at)) return false;
    const bit = coin.bit !== undefined ? { bit: coin.bit } : {};
    this.held.push({ token: isToken(coin), pence: costOf(coin), at, ...bit });
    this.changed();
    return true;
  }

  canPay(coin: WalletCoin, at: number = Date.now()): boolean {
    const b = this.shown(at);
    if (!b || unpriced(coin)) return false;
    return costOf(coin) <= (isToken(coin) ? b.tokenPence : b.cashPence);
  }

  rejected(bit: number): void {
    const i = this.held.findIndex((h) => h.bit === bit && !h.booked);
    if (i < 0) return;
    this.held.splice(i, 1);
    this.unsent.rejected++;
    this.changed();
  }

  turnedAway(): void {
    if (!this.known) return;
    this.unsent.rejected++;
    this.changed();
  }

  takeCoins(): CoinCounts {
    const c = this.unsent;
    this.unsent = { spent: 0, rejected: 0 };
    this.sinceStart = 0;
    return c;
  }

  putBackCoins(c: CoinCounts): void {
    this.unsent = { spent: this.unsent.spent + c.spent, rejected: this.unsent.rejected + c.rejected };
  }

  started(ledger: CashLedger | null): void {
    this.base = ledger ? { ...ledger } : null;
    this.now = this.base;
    this.held = [];
    this.sinceStart = 0;
    this.changed();
  }

  async forfeit(): Promise<void> {
    const back = this.sinceStart + this.held.filter((h) => !h.booked).length;
    this.unsent = { spent: this.unsent.spent - this.sinceStart, rejected: this.unsent.rejected + back };
    this.sinceStart = 0;
    await this.ended();
  }

  reading(ledger: CashLedger | null, at: number = Date.now()): void {
    if (!ledger) return;
    const prev = this.now;
    this.now = { ...ledger };
    if (prev) {
      let cashIn = Math.max(0, ledger.inPence - prev.inPence);
      let tokenIn = Math.max(0, ledger.tokenInPence - prev.tokenInPence);
      this.held = this.held.filter((h) => {
        const left = h.token ? tokenIn : cashIn;
        if (left <= 0) return true;
        if (!h.booked) {
          h.booked = true;
          this.unsent.spent++;
          this.sinceStart++;
        }
        if (left < h.pence) {
          h.pence -= left;
          h.at = at;
          if (h.token) tokenIn = 0;
          else cashIn = 0;
          return true;
        }
        if (h.token) tokenIn -= h.pence;
        else cashIn -= h.pence;
        return false;
      });
    }
    this.expire(at);
    this.changed();
  }

  settled(b: Balance, ledger: CashLedger | null): void {
    this.known = b;
    if (ledger && this.base) this.base = { ...ledger };
    this.changed();
  }

  async ended(): Promise<void> {
    this.base = null;
    this.now = null;
    this.held = [];
    await this.refresh();
  }

  private expire(at: number): void {
    if (!this.held.some((h) => at - h.at > HOLD_MS)) return;
    const old = this.held.filter((h) => at - h.at > HOLD_MS);
    this.held = this.held.filter((h) => at - h.at <= HOLD_MS);
    this.unsent.rejected += old.filter((h) => !h.booked).length;
  }

  private changed(): void {
    this.onChange?.();
  }
}

export function payForCoin(wallet: Wallet | null, coin: CoinChute | Parameters<Wallet['pay']>[0]): boolean {
  return wallet ? wallet.pay(coin) : true;
}
