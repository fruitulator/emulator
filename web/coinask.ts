import type { NamedCoin } from '../src/machine/machine';
import { str } from './i18n';

export type SlotCoin = number | { token: number | null };

export interface WiredCoin { coin: SlotCoin; line: number | null }

export type WiringHow = 'detected' | 'measured' | 'asked';

export interface SlotWiring { coins: WiredCoin[]; how: WiringHow }

export type CoinWiring = Record<string, SlotWiring>;

export const CASH_COINS: readonly number[] = [200, 100, 50, 20, 10, 5, 2];

export const TOKEN_VALUES: readonly number[] = [5, 10, 20, 25, 50, 100];

export function cashLabel(pence: number): string {
  return pence >= 100 && pence % 100 === 0 ? `£${pence / 100}` : pence >= 100 ? `£${(pence / 100).toFixed(2)}` : `${pence}p`;
}

export function slotCoinLabel(c: SlotCoin): string {
  if (typeof c === 'number') return cashLabel(c);
  return c.token === null ? str('coinask.token') : str('coinask.n_token', { 0: cashLabel(c.token) });
}

export function isTokenCoin(c: SlotCoin): c is { token: number | null } {
  return typeof c !== 'number';
}

export function slotCoinPence(c: SlotCoin): number | null {
  return typeof c === 'number' ? c : c.token;
}

export function sameCoin(a: SlotCoin, b: SlotCoin): boolean {
  if (typeof a === 'number' || typeof b === 'number') return a === b;
  return a.token === b.token;
}

const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

function readSlotCoin(v: unknown): SlotCoin | null {
  if (posInt(v)) return v;
  if (v && typeof v === 'object' && 'token' in v) {
    const t = (v as { token: unknown }).token;
    return { token: posInt(t) ? t : null };
  }
  return null;
}

export function readCoinWiring(raw: unknown): CoinWiring {
  const out: CoinWiring = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(k) || !v || typeof v !== 'object') continue;
    const s = v as { coins?: unknown; how?: unknown };
    if (!Array.isArray(s.coins)) continue;
    if (!s.coins.length) { out[k] = { coins: [], how: 'asked' }; continue; }
    const coins: WiredCoin[] = [];
    for (const c of s.coins) {
      if (!c || typeof c !== 'object') continue;
      const coin = readSlotCoin((c as { coin?: unknown }).coin);
      if (coin === null) continue;
      const line = (c as { line?: unknown }).line;
      coins.push({ coin, line: typeof line === 'number' && Number.isInteger(line) && line >= 0 ? line : null });
    }
    if (!coins.length) continue;
    const how: WiringHow = s.how === 'detected' || s.how === 'measured' ? s.how : 'asked';
    out[k] = { coins, how };
  }
  return out;
}

export function wiringFromAnswers(raw: unknown): CoinWiring {
  const out: CoinWiring = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(k)) continue;
    const coin: SlotCoin | null = v === 'token' ? { token: null } : posInt(v) ? v : null;
    if (coin !== null) out[k] = { coins: [{ coin, line: Number(k) }], how: 'asked' };
  }
  return out;
}

export function askedSlot(slotLine: number, coins: readonly SlotCoin[]): SlotWiring {
  return {
    coins: coins.map((coin) => ({ coin, line: coins.length === 1 ? slotLine : null })),
    how: 'asked',
  };
}

export function namedCoinsOf(w: CoinWiring): Record<string, NamedCoin> {
  const by = new Map<number, SlotCoin[]>();
  for (const s of Object.values(w)) {
    for (const c of s.coins) if (c.line !== null) by.set(c.line, [...(by.get(c.line) ?? []), c.coin]);
  }
  const out: Record<string, NamedCoin> = {};
  for (const [line, coins] of by) {
    if (coins.length !== 1 && !coins.every((c) => sameCoin(c, coins[0]))) continue;
    const c = coins[0];
    out[String(line)] = typeof c === 'number' ? c : 'token';
  }
  return out;
}

export function wiredCoinOn(w: CoinWiring, line: number): SlotCoin | null | undefined {
  const on: SlotCoin[] = [];
  for (const s of Object.values(w)) for (const c of s.coins) if (c.line === line) on.push(c.coin);
  if (on.length) return on.every((c) => sameCoin(c, on[0])) ? on[0] : null;
  return w[String(line)] ? null : undefined;
}

export function editedSlot(prev: SlotWiring | undefined, slotLine: number, coins: readonly SlotCoin[]): SlotWiring {
  const fresh = askedSlot(slotLine, coins);
  if (!prev) return fresh;
  const same = coins.length === prev.coins.length && coins.every((c) => prev.coins.some((p) => sameCoin(p.coin, c)));
  if (same) return { coins: prev.coins.map((c) => ({ ...c })), how: prev.how };
  return {
    coins: fresh.coins.map((c) => {
      const v = slotCoinPence(c.coin);
      const was = prev.coins.find((p) => p.line !== null && v !== null && slotCoinPence(p.coin) === v);
      return was ? { coin: c.coin, line: was.line } : c;
    }),
    how: 'asked',
  };
}

export function unplacedCoins(s: SlotWiring): SlotCoin[] {
  return s.coins.filter((c) => c.line === null).map((c) => c.coin);
}

export interface CoinChoice { label: string; line: number; pence: number | null; token: boolean }

export function coinChoices(s: SlotWiring, have: { cashPence: number; tokenPence: number } | null): CoinChoice[] {
  const out: CoinChoice[] = [];
  for (const c of s.coins) {
    if (c.line === null) continue;
    const token = isTokenCoin(c.coin);
    const pence = slotCoinPence(c.coin);
    if (have) {
      const purse = token ? have.tokenPence : have.cashPence;
      if (pence === null ? purse <= 0 : pence > purse) continue;
    }
    if (out.some((o) => o.token === token && o.pence === pence)) continue;
    out.push({ label: slotCoinLabel(c.coin), line: c.line, pence, token });
  }
  return out.sort((a, b) => (b.pence ?? 0) - (a.pence ?? 0) || Number(a.token) - Number(b.token));
}

export function slotlessChoices(
  w: CoinWiring, slotless: readonly number[],
  have: { cashPence: number; tokenPence: number } | null, refusing: number,
): CoinChoice[] | null {
  const coins: WiredCoin[] = [];
  for (const l of slotless) for (const c of w[String(l)]?.coins ?? []) coins.push(c);
  if (!coins.length) return null;
  const shut = (line: number): boolean => line >= 0 && line < 32 && ((refusing >>> line) & 1) === 1;
  return coinChoices({ coins, how: 'asked' }, have).filter((c) => !shut(c.line));
}

export function readCoinAnswers(raw: unknown): Record<string, NamedCoin> {
  const out: Record<string, NamedCoin> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d+$/.test(k) && (v === 'token' || posInt(v))) out[k] = v;
  }
  return out;
}
