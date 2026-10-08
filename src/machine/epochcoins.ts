import type { CoinLineTable, CoinLine } from './coinwiring';
import type { EpochCoinTables } from '../hw/epochcoin';
import type { DeclaredCoin } from './layoutcoins';
import type { CoinChute } from './machine';
import { COIN_NOTES } from './layoutcoins';

const hex = (a: number): string => `$${a.toString(16).toUpperCase()}`;

export function epochCoinTable(t: EpochCoinTables | null): CoinLineTable | { refused: string } {
  if (!t) return { refused: 'no coin records found in the program' };
  const lines: CoinLine[] = [];
  t.records.forEach((r, i) => {
    if (r.pence === null) return;
    lines.push(r.token
      ? { line: i, credits: r.pence, change: [], token: true, tokenPence: r.pence }
      : { line: i, credits: r.pence, change: [] });
  });
  if (!lines.length) return { refused: 'no coin record of the program states a value' };
  const values = t.valuesAt !== null ? `values at ${hex(t.valuesAt)}` : 'values by the mech\'s coded output map';
  return { lines, pricePerCredit: 1, source: `Epoch coin records at ${hex(t.recordsAt)}, ${values}` };
}

export function epochShutLines(t: EpochCoinTables | null, mode: number): number {
  if (!t) return 0;
  let m = 0;
  t.records.forEach((r, i) => { if (i < 32 && !(r.codes[mode] ?? 0)) m |= 1 << i; });
  return m >>> 0;
}

export const EPOCH_COIN_BIT = 0;
export const EPOCH_TOKEN_BIT = 5;

export function epochSlotLine(c: DeclaredCoin, chutes: readonly CoinChute[]): number | null {
  if (c.named?.name.startsWith('ccTalk') || c.named?.name.startsWith('NV')) return null;
  if (c.line !== null) return c.line;
  if (c.note !== null) {
    const exact = chutes.find((x) => x.note === c.note);
    if (exact) return exact.bit;
    const n = COIN_NOTES.get(c.note);
    const hit = n?.token
      ? chutes.find((x) => x.token)
      : n && n.pence !== null ? chutes.find((x) => !x.token && x.pence === n.pence) : undefined;
    if (hit) return hit.bit;
  }
  return c.token ? EPOCH_TOKEN_BIT : EPOCH_COIN_BIT;
}
