import type { EffectGridRow, SlideEffect } from '../layout/fmlconfig';
import { COIN_NOTES, COIN_NOTE_BLANK, type DeclaredCoin } from './layoutcoins';
import type { CashLedger, CoinChute, NamedCoin, PayoutDeviceRow, PayoutRow } from './machine';

export function unnamedOutputLines(wired: Iterable<number>, grid: readonly EffectGridRow[] | null): number[] {
  return [...new Set(wired)].filter((line) => !(grid?.[line]?.on)).sort((a, b) => a - b);
}

export type BookedCoin = number | { token: number } | 'token' | null;

export function namedBooking(coin: NamedCoin): BookedCoin {
  if (coin === 'token') return 'token';
  if (typeof coin === 'object') return Number.isInteger(coin.token) && coin.token > 0 ? { token: coin.token } : null;
  return Number.isInteger(coin) && coin > 0 ? coin : null;
}

export function coinName(pence: number): string {
  return pence >= 100 ? (pence % 100 ? `£${(pence / 100).toFixed(2)}` : `£${pence / 100}`) : `${pence}p`;
}

export function coinOfNote(id: number): BookedCoin {
  const n = COIN_NOTES.get(id);
  if (!n) return null;
  if (n.token) return 'token';
  return n.pence;
}

export class TokenPayouts {
  private readonly named = new Map<number, number>();

  name(line: number, pence: number): void {
    if (Number.isInteger(pence) && pence > 0) this.named.set(line, pence);
    else this.named.delete(line);
  }

  value(line: number): number | undefined { return this.named.get(line) ?? this.defaults.get(line); }

  private readonly cash = new Map<number, boolean>();
  setCash(line: number, cash: boolean): void { this.cash.set(line, cash); }
  isCash(line: number): boolean { return this.cash.get(line) === true; }
  isToken(line: number, stated: boolean): boolean {
    const cash = this.cash.get(line);
    return cash === undefined ? stated : !cash;
  }

  setDefault(line: number, pence: number | null): void {
    if (pence !== null && Number.isInteger(pence) && pence > 0) this.defaults.set(line, pence);
    else this.defaults.delete(line);
  }
  private readonly defaults = new Map<number, number>();

  private readonly unpriced = new Set<number>();
  get unpricedLines(): readonly number[] { return [...this.unpriced]; }
  noteUnpriced(line: number): void { this.unpriced.add(line); }

  book(ledger: CashLedger, line: number): void {
    const v = this.value(line);
    if (v === undefined) { ledger.unpricedTokenOut++; this.unpriced.add(line); }
    else ledger.tokenOutPence += v;
  }

  bookCash(ledger: CashLedger, line: number): void {
    const v = this.value(line);
    if (v === undefined) { ledger.unpricedOut++; this.unpriced.add(line); }
    else ledger.outPence += v;
  }
}

export class CoinBook {
  static readonly snapshotConfig: readonly string[] = ['slides', 'changeGap', 'payouts', 'outputs', 'notPayouts'];

  readonly payouts = new TokenPayouts();
  get unpricedPaidLines(): readonly number[] { return this.payouts.unpricedLines; }

  slides: SlideEffect[] = [];
  outputs: number[] = [];
  setOutputLines(lines: readonly number[]): void {
    this.outputs = [...new Set(lines)];
  }

  get namesNoPayout(): boolean {
    return !this.hasSlides;
  }

  notPayouts: number[] = [];
  setNotPayouts(lines: readonly number[]): void {
    this.notPayouts = [...new Set(lines)].sort((a, b) => a - b);
  }

  get outputRows(): PayoutRow[] {
    return this.outputs.map((line) => ({ kind: 'output' as const, line, pence: null, token: false }));
  }

  output(line: number, unit: 'token' | 'unpriced'): void {
    if (this.notPayouts.includes(line)) return;
    this.lineCoins[line] = (this.lineCoins[line] ?? 0) + 1;
    const v = this.payouts.value(line);
    if (v === undefined) {
      this.pay(unit);
      this.payouts.noteUnpriced(line);
    } else if (this.payouts.isCash(line)) this.cashOut(v);
    else this.pay({ token: v });
  }

  get outputCounts(): number[] {
    return this.outputs.map((line) => this.lineCoins[line] ?? 0);
  }
  changeWindow = 0;

  private declare readonly ledger: CashLedger;

  constructor(ledger: CashLedger, private changeGap: number) {
    Object.defineProperty(this, 'ledger', { value: ledger, enumerable: false });
  }

  lineCoins: number[] = [];
  unnamedCount: number[] = [];

  unnamed(line: number): void { this.unnamedCount[line] = (this.unnamedCount[line] ?? 0) + 1; }

  rowCoins(rows: readonly { line: number }[]): Record<number, number> {
    const out: Record<number, number> = {};
    for (const r of rows) out[r.line] = this.lineCoins[r.line] ?? 0;
    return out;
  }

  unnamedPulses(rows: readonly { line: number }[]): Record<number, number> {
    const isRow = new Set([...rows.map((r) => r.line), ...this.outputs]);
    const out: Record<number, number> = {};
    this.unnamedCount.forEach((n, i) => { if (n && !isRow.has(i)) out[i] = n; });
    this.lineCoins.forEach((n, i) => { if (n && !isRow.has(i)) out[i] = (out[i] ?? 0) + n; });
    return out;
  }

  get slideRows(): PayoutDeviceRow<'tube' | 'token-tube'>[] {
    return this.slides.flatMap((s, line) => s === null ? [] : [{
      line, kind: s === 'token' ? 'token-tube' as const : 'tube' as const,
      displayNumber: line + 1, defaultPence: typeof s === 'number' ? s : null,
      ...(typeof s === 'number' ? { defaultFrom: 'layout' as const } : {}),
    }]);
  }

  reset(): void {
    this.changeWindow = 0;
  }

  setSlides(slides: readonly SlideEffect[] | null): void {
    this.slides = slides ? [...slides] : [];
  }

  get unpricedSlides(): number[] {
    return this.slides.flatMap((s, i) => (s === 'token' || s === 'unpriced' ? [i] : []));
  }

  get tokenSlides(): number[] {
    return this.slides.flatMap((s, i) => (s === 'token' ? [i] : []));
  }

  get hasSlides(): boolean {
    return this.slides.some((s) => s !== null);
  }

  coin(c: BookedCoin, hold = 0): void {
    const l = this.ledger;
    if (typeof c === 'number') l.inPence += c;
    else if (c === null) {
      l.unpricedIn = (l.unpricedIn ?? 0) + 1;
      this.changeWindow = hold + this.changeGap;
    } else if (c === 'token') {
      l.unpricedTokenIn++;
      this.changeWindow = hold + this.changeGap;
    } else l.tokenInPence += c.token;
  }

  slide(line: number): void {
    const s = this.slides[line] ?? null;
    if (s === null && this.outputs.includes(line)) { this.output(line, 'token'); return; }
    this.lineCoins[line] = (this.lineCoins[line] ?? 0) + 1;
    if (s === null) return;
    const named = this.payouts.value(line);
    const token = this.payouts.isToken(line, s === 'token');
    if (named !== undefined) {
      if (token) this.pay({ token: named });
      else this.cashOut(named);
      return;
    }
    if (typeof s === 'number' && token) { this.pay({ token: s }); return; }
    this.pay(s);
    if (s === 'token' || s === 'unpriced') this.payouts.noteUnpriced(line);
  }

  tube(line: number): void {
    this.part(line, this.slides[line] ?? null);
  }

  part(line: number, stated: SlideEffect | { token: number }): void {
    this.lineCoins[line] = (this.lineCoins[line] ?? 0) + 1;
    const named = this.payouts.value(line);
    const token = this.payouts.isToken(line, stated === 'token' || (stated !== null && typeof stated === 'object'));
    if (named !== undefined) {
      if (token) this.pay({ token: named });
      else this.cashOut(named);
    } else if (typeof stated === 'number' && token) {
      this.pay({ token: stated });
    } else {
      this.pay(stated ?? 'unpriced');
      if (stated === null || stated === 'token' || stated === 'unpriced') this.payouts.noteUnpriced(line);
    }
  }

  pay(s: SlideEffect | { token: number }): void {
    if (s === null) return;
    const l = this.ledger;
    if (s === 'token') l.unpricedTokenOut++;
    else if (s === 'unpriced') l.unpricedOut++;
    else if (typeof s === 'number') this.cashOut(s);
    else l.tokenOutPence += s.token;
  }

  cashOut(pence: number): void {
    const l = this.ledger;
    if (this.changeWindow > 0) {
      l.unpricedOut++;
      this.changeWindow = this.changeGap;
    } else l.outPence += pence;
  }

  elapse(cycles: number): void {
    if (this.changeWindow > 0) this.changeWindow = Math.max(0, this.changeWindow - cycles);
  }
}

export class SlotCoins {
  private readonly stated = new Map<number, BookedCoin>();
  private readonly named = new Map<number, BookedCoin>();

  setLines(lines: Iterable<readonly [number, BookedCoin]>): void {
    this.stated.clear();
    for (const [line, c] of lines) this.stated.set(line, c);
  }

  get unnamed(): number[] {
    return [...this.stated].filter(([, c]) => c === null || c === 'token').map(([l]) => l).sort((a, b) => a - b);
  }

  name(line: number, coin: NamedCoin): void {
    const st = this.stated.get(line);
    if (st !== null && st !== 'token') return;
    const c = namedBooking(coin);
    if (c !== null) this.named.set(line, c);
  }

  coinOn(line: number): BookedCoin {
    const st = this.stated.get(line);
    if (st !== undefined && st !== null && st !== 'token') return st;
    return this.named.get(line) ?? st ?? null;
  }

  chutes(label: (line: number) => string): CoinChute[] {
    return [...this.stated.keys()].sort((a, b) => a - b).map((bit): CoinChute => {
      const c = this.coinOn(bit);
      if (typeof c === 'number') return { label: coinName(c), bit, pence: c };
      if (c !== null) return { label: 'Token', bit, pence: null, token: true };
      return { label: label(bit), bit };
    });
  }
}

export function directCoinSlots(declared: readonly DeclaredCoin[]): [number, BookedCoin][] {
  const out = new Map<number, BookedCoin>();
  for (const c of declared) {
    if (c.note !== COIN_NOTE_BLANK || c.button === null || c.button < 0) continue;
    const line = 0x100 | (c.button & 0x7f);
    const coin: BookedCoin = c.token ? 'token' : null;
    out.set(line, out.has(line) && out.get(line) !== coin ? null : coin);
  }
  return [...out];
}

export function statedCoinOf(c: Pick<DeclaredCoin, 'pence' | 'token'>): BookedCoin {
  if (c.pence !== null) return c.token ? { token: c.pence } : c.pence;
  return c.token ? 'token' : null;
}

export function slotStatedCoins(list: readonly DeclaredCoin[], idOf: (c: DeclaredCoin) => number | null): Map<number, BookedCoin> {
  const out = new Map<number, BookedCoin>();
  for (const c of list) {
    const id = idOf(c);
    if (id === null) continue;
    const coin = statedCoinOf(c);
    const had = out.get(id);
    out.set(id, had === undefined || JSON.stringify(had) === JSON.stringify(coin) ? coin : null);
  }
  return out;
}

export function ccTalkCoin(hostOnSlot: number | { token: number | null } | null | undefined, coinId: string): BookedCoin {
  if (hostOnSlot === null) return null;
  if (hostOnSlot !== undefined) return bookedOfSlotCoin(hostOnSlot);
  const gb = /^GB(\d{3})/.exec(coinId);
  if (gb) return Number(gb[1]);
  return /^TK/.test(coinId) ? 'token' : null;
}

export function bookCoinIn(l: CashLedger, c: BookedCoin): void {
  if (typeof c === 'number') l.inPence += c;
  else if (c === null) l.unpricedIn = (l.unpricedIn ?? 0) + 1;
  else if (c === 'token') l.unpricedTokenIn++;
  else l.tokenInPence += c.token;
}

export function bookedOfSlotCoin(c: number | { token: number | null }): BookedCoin {
  if (typeof c === 'number') return c;
  return c.token === null ? 'token' : { token: c.token };
}

export function slotOrNoteCoin(slots: SlotCoins, id: number): BookedCoin {
  const s = slots.coinOn(id);
  if (s !== null) return s;
  return id >= 0 && id < 0x100 ? coinOfNote(id) : null;
}
