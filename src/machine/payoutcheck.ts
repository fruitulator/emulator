import type { CashLedger } from './machine';

export interface CheckRow { line: number; token: boolean }

export interface OutMoney { cash: number; token: number; cashUnpriced: number; tokenUnpriced: number }

export interface PayoutReadings {
  rows: readonly CheckRow[];
  coins: Readonly<Record<number, number>>;
  meters: Readonly<Record<number, number>>;
  unnamed: Readonly<Record<number, number>>;
  money: OutMoney;
}

export interface PayoutFault { lines: number[]; why: 'unnamed' | 'value' }

const BASES = ['cashPence', 'cashCoins', 'tokenPence', 'tokenCoins', 'allPence', 'allCoins'] as const;
type Basis = typeof BASES[number];

interface MeterLearning { moved: boolean; ratio: Partial<Record<Basis, number | null>> }

export const QUIET_S = 5;
const SAME = 1e-6;

type Counts = Record<number, number>;
interface Snap { coins: Counts; meters: Counts; unnamed: Counts; money: OutMoney }
const delta = (now: Readonly<Counts>, then: Readonly<Counts>): Counts => {
  const out: Counts = {};
  for (const k of Object.keys(now)) {
    const d = (now[Number(k)] ?? 0) - (then[Number(k)] ?? 0);
    if (d > 0) out[Number(k)] = d;
  }
  return out;
};
const same = (a: Readonly<Counts>, b: Readonly<Counts>): boolean => {
  const ka = Object.keys(a).filter((k) => a[Number(k)]);
  const kb = Object.keys(b).filter((k) => b[Number(k)]);
  return ka.length === kb.length && ka.every((k) => a[Number(k)] === b[Number(k)]);
};
const fresh = (): MeterLearning => ({ moved: false, ratio: Object.fromEntries(BASES.map((b) => [b, null])) });

export class PayoutCheck {
  meters: Record<number, MeterLearning> = {};
  hostPence: Record<number, number> = {};
  private open: Snap | null = null;
  private last: Snap | null = null;
  private quietS = 0;
  faultCount = 0;
  faults: PayoutFault[] = [];
  windows = 0;

  named(line: number, pence: number): void {
    this.hostPence[line] = pence;
    for (const m of Object.values(this.meters)) {
      for (const b of BASES) if (b.endsWith('Pence') && b in m.ratio) m.ratio[b] = null;
    }
  }

  observe(r: PayoutReadings, seconds: number): void {
    const now: Snap = { coins: { ...r.coins }, meters: { ...r.meters }, unnamed: { ...r.unnamed }, money: { ...r.money } };
    const prev = this.last;
    this.last = now;
    if (!prev) return;
    const moved = !same(now.coins, prev.coins) || !same(now.meters, prev.meters) || !same(now.unnamed, prev.unnamed);
    if (moved) {
      if (!this.open) this.open = prev;
      this.quietS = 0;
      return;
    }
    if (!this.open) return;
    this.quietS += seconds;
    if (this.quietS < QUIET_S) return;
    const from = this.open;
    this.open = null;
    this.quietS = 0;
    const d = (k: keyof OutMoney): number => now.money[k] - from.money[k];
    this.judge(r.rows, delta(now.coins, from.coins), delta(now.meters, from.meters), delta(now.unnamed, from.unnamed),
      Object.keys(r.meters).map(Number), {
        cash: d('cashUnpriced') > 0 ? undefined : d('cash'),
        token: d('tokenUnpriced') > 0 ? undefined : d('token'),
      });
  }

  judge(rows: readonly CheckRow[], coins: Counts, meters: Counts, unnamed: Counts, outMeters: number[],
    pence: { cash?: number; token?: number }): void {
    this.windows++;
    const unnamedLines = Object.keys(unnamed).map(Number);
    const paidRows = rows.filter((r) => (coins[r.line] ?? 0) > 0);
    if (!outMeters.length) return;
    const q = quantities(rows, coins, pence);
    const wrongValue: number[] = [];
    let unexplained = false;
    for (const id of outMeters) {
      const clicks = meters[id] ?? 0;
      const m = (this.meters[id] ??= fresh());
      if (clicks > 0) m.moved = true;
      if (!m.moved) continue;
      if (!paidRows.length) {
        if (clicks > 0) unexplained = true;
        continue;
      }
      if (clicks === 0) continue;
      let any = false;
      for (const b of BASES.filter((x) => x in m.ratio)) {
        const qty = q[b];
        if (qty === undefined) { any = true; continue; }
        if (qty === 0) { delete m.ratio[b]; continue; }
        const r = clicks / qty;
        const was = m.ratio[b];
        if (was === null || was === undefined) { m.ratio[b] = r; any = true; continue; }
        if (Math.abs(r - was) <= SAME * Math.max(1, Math.abs(was))) any = true;
        else delete m.ratio[b];
      }
      if (!any) {
        wrongValue.push(...paidRows.map((r) => r.line));
        this.meters[id] = fresh();
      }
    }
    if (wrongValue.length) this.fault({ lines: [...new Set(wrongValue)].sort((a, b) => a - b), why: 'value' });
    if (unexplained && unnamedLines.length) this.fault({ lines: unnamedLines, why: 'unnamed' });
  }

  private fault(f: PayoutFault): void {
    this.faultCount++;
    this.faults.push(f);
    if (this.faults.length > 16) this.faults.shift();
  }

  faultLines(since: number): number[] {
    const n = this.faultCount - since;
    if (n <= 0) return [];
    return [...new Set(this.faults.slice(-Math.min(n, this.faults.length)).flatMap((f) => f.lines))].sort((a, b) => a - b);
  }
}

function quantities(rows: readonly CheckRow[], coins: Counts, pence: { cash?: number; token?: number }): Partial<Record<Basis, number>> {
  let cashCoins = 0;
  let tokenCoins = 0;
  for (const r of rows) {
    const n = coins[r.line] ?? 0;
    if (r.token) tokenCoins += n; else cashCoins += n;
  }
  return {
    cashPence: pence.cash, tokenPence: pence.token,
    allPence: pence.cash === undefined || pence.token === undefined ? undefined : pence.cash + pence.token,
    cashCoins, tokenCoins, allCoins: cashCoins + tokenCoins,
  };
}

export function outMoneyOf(l: CashLedger | undefined): OutMoney {
  return {
    cash: l?.outPence ?? 0, token: l?.tokenOutPence ?? 0,
    cashUnpriced: l?.unpricedOut ?? 0, tokenUnpriced: l?.unpricedTokenOut ?? 0,
  };
}

export function payoutReadings(m: {
  payoutDevices?: readonly { line: number; kind: string }[];
  rowCoins?: Readonly<Record<number, number>>;
  outMeterClicks?: Readonly<Record<number, number>>;
  unnamedPulses?: Readonly<Record<number, number>>;
  cashLedger?: CashLedger;
}, check: PayoutCheck): PayoutReadings {
  const rows: CheckRow[] = (m.payoutDevices ?? []).map((d) => ({ line: d.line, token: d.kind.startsWith('token') }));
  const coins: Record<number, number> = { ...(m.rowCoins ?? {}) };
  const unnamed: Record<number, number> = { ...(m.unnamedPulses ?? {}) };
  for (const k of Object.keys(check.hostPence)) {
    const line = Number(k);
    if (rows.some((r) => r.line === line) || unnamed[line] === undefined) continue;
    rows.push({ line, token: false });
    coins[line] = unnamed[line]!;
    delete unnamed[line];
  }
  return { rows, coins, meters: m.outMeterClicks ?? {}, unnamed, money: outMoneyOf(m.cashLedger) };
}

export function attachPayoutCheck(m: {
  rowCoins?: unknown; payoutCheck?: PayoutCheck; namePayout?(line: number, pence: number): void;
}): void {
  if (m.rowCoins === undefined || m.payoutCheck) return;
  const check = new PayoutCheck();
  m.payoutCheck = check;
  const own = m.namePayout?.bind(m);
  if (own) {
    Object.defineProperty(m, 'namePayout', {
      value: (line: number, pence: number) => { own(line, pence); check.named(line, pence); },
      enumerable: false, configurable: true, writable: true,
    });
  }
}

export function observePayouts(m: Parameters<typeof payoutReadings>[0] & { payoutCheck?: PayoutCheck }, seconds: number): void {
  const c = m.payoutCheck;
  if (c) c.observe(payoutReadings(m, c), seconds);
}

export function countOutClick(clicks: number[], key: number, outMult: number | undefined, n = 1): void {
  if ((outMult ?? 0) > 0 && n > 0) clicks[key] = (clicks[key] ?? 0) + n;
}

export function outClicksOf(clicks: readonly number[], outMult: readonly (number | undefined)[]): Record<number, number> {
  const out: Record<number, number> = {};
  outMult.forEach((x, i) => { if ((x ?? 0) > 0) out[i] = clicks[i] ?? 0; });
  return out;
}
