import type { SlideEffect } from '../layout/fmlconfig';
import { COIN_NOTES, COIN_NOTE_BLANK, type DeclaredCoin } from './layoutcoins';
import type { CashLedger, CoinChute, NamedCoin } from './machine';

export type BookedCoin = number | { token: number } | 'token' | null;

export function coinName(pence: number): string {
  return pence >= 100 ? (pence % 100 ? `£${(pence / 100).toFixed(2)}` : `£${pence / 100}`) : `${pence}p`;
}

export function coinOfNote(id: number): BookedCoin {
  const n = COIN_NOTES.get(id);
  if (!n) return null;
  if (n.token) return 'token';
  return n.pence;
}

export class CoinBook {
  static readonly snapshotConfig: readonly string[] = ['slides', 'changeGap', 'openOnCoin'];

  slides: SlideEffect[] = [];
  changeWindow = 0;
  open: boolean;

  private declare readonly ledger: CashLedger;

  constructor(ledger: CashLedger, private changeGap: number, private openOnCoin = false) {
    Object.defineProperty(this, 'ledger', { value: ledger, enumerable: false });
    this.open = !openOnCoin;
  }

  reset(): void {
    this.changeWindow = 0;
    this.open = !this.openOnCoin;
  }

  setSlides(slides: readonly SlideEffect[] | null): void {
    this.slides = slides ? [...slides] : [];
  }

  get hasSlides(): boolean {
    return this.slides.some((s) => s !== null);
  }

  coin(c: BookedCoin, hold = 0): void {
    this.open = true;
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
    this.pay(this.slides[line] ?? null);
  }

  pay(s: SlideEffect | { token: number }): void {
    if (!this.open || s === null) return;
    const l = this.ledger;
    if (s === 'token') l.unpricedTokenOut++;
    else if (s === 'unpriced') l.unpricedOut++;
    else if (typeof s === 'number') this.cashOut(s);
    else l.tokenOutPence += s.token;
  }

  cashOut(pence: number): void {
    if (!this.open) return;
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
    if (coin === 'token') this.named.set(line, 'token');
    else if (Number.isInteger(coin) && coin > 0) this.named.set(line, coin);
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

export function bookedOfSlotCoin(c: number | { token: number | null }): BookedCoin {
  if (typeof c === 'number') return c;
  return c.token === null ? 'token' : { token: c.token };
}

export function slotOrNoteCoin(slots: SlotCoins, id: number): BookedCoin {
  const s = slots.coinOn(id);
  if (s !== null) return s;
  return id >= 0 && id < 0x100 ? coinOfNote(id) : null;
}
