import type { Machine } from './machine';
import { coinLineRefused } from './framestate';
import type { CoinMeasurement, LineMeasurement } from './coinwiring';

export interface MeasureWindows { firstWaitS: number; quietS: number; capS: number; chunkS: number }
export const MEASURE_WINDOWS: MeasureWindows = { firstWaitS: 4, quietS: 2, capS: 40, chunkS: 0.25 };

function meterPulses(m: Machine): number[] {
  const b = m as unknown as { meterCounts?: unknown; meterCount?: unknown; meterPulses?: unknown };
  for (const v of [b.meterCounts, b.meterCount, b.meterPulses]) {
    if (v && typeof v === 'object' && typeof (v as ArrayLike<unknown>).length === 'number') {
      const a = v as ArrayLike<unknown>;
      if (a.length > 0 && typeof a[0] === 'number') return Array.from(a as ArrayLike<number>);
    }
  }
  return [];
}

function secPulses(m: Machine): number[] {
  return m.secPulses ? Array.from(m.secPulses) : [];
}

function triacTicks(m: Machine): number[] {
  return m.triacTicks ? Array.from(m.triacTicks) : [];
}

function chutesOf(m: Machine): Record<string, number> | undefined {
  if (!m.chutePence) return undefined;
  const o: Record<string, number> = {};
  Array.from(m.chutePence).forEach((p, i) => { if (p > 0) o[`t${i + 1}`] = p; });
  return Object.keys(o).length ? o : undefined;
}

export interface CreditWatch { lamps: readonly number[] }

const CREDIT_SAMPLES = 16;

function creditSignature(m: Machine, watch: CreditWatch): string {
  let s = '';
  if (m.layoutDigit) for (let n = 0; n < 64; n++) s += `${m.layoutDigit(n)},`;
  s += `|${(m.display?.text() ?? '').replace(/\D+/g, '')}|`;
  for (const n of watch.lamps) s += m.layoutLamp(n) ? '1' : '0';
  return s;
}

export const REPEAT_DROPS = 5;

function measureOne(m: Machine, line: number | null, at: Date | null, w: MeasureWindows, drops = 1, watch?: CreditWatch): LineMeasurement & { sigs: string[] } {
  if (at) m.pinHostClock?.(at);
  const totals = m.meterTotals!;
  const in0 = totals.in;
  const out0 = totals.out;
  const meters0 = meterPulses(m);
  const secs0 = secPulses(m);
  const triacs0 = triacTicks(m);
  const refused0 = m.coinsRefused ?? 0;
  const refusing = line !== null && coinLineRefused(m, line);
  const chunk = Math.max(1, Math.round(m.clockHz * w.chunkS));
  const state = (): string => `${totals.in},${totals.out},${meterPulses(m).join('.')},${secPulses(m).join('.')},${triacTicks(m).join('.')}`;
  const sigs: string[] = [];
  const accepted0 = m.acceptedPence ?? 0;
  let t = 0;
  let closed: LineMeasurement['closed'] = 'cap';
  for (let d = 0; d < (line === null ? 1 : drops); d++) {
    if (line !== null) m.insertCoin(line);
    let w0 = 0;
    let lastChange = 0;
    let moved = false;
    let seen = state();
    closed = 'cap';
    while (w0 < w.capS) {
      m.run(chunk);
      w0 += w.chunkS;
      if (watch && d === 0 && sigs.length < CREDIT_SAMPLES) sigs.push(creditSignature(m, watch));
      const now = state();
      if (now !== seen) { seen = now; lastChange = w0; moved = true; }
      if (moved && w0 - lastChange >= w.quietS) { closed = 'quiet'; break; }
      if (!moved && w0 >= w.firstWaitS) { closed = 'nothing'; break; }
    }
    t += w0;
  }
  const meters1 = meterPulses(m);
  return {
    line,
    inCounts: totals.in - in0,
    outCounts: totals.out - out0,
    meters: meters1.map((v, i) => v - (meters0[i] ?? 0)),
    ...(secs0.length ? { secs: secPulses(m).map((v, i) => v - (secs0[i] ?? 0)) } : {}),
    ...(triacs0.length ? { triacs: triacTicks(m).map((v, i) => v - (triacs0[i] ?? 0)) } : {}),
    ...(chutesOf(m) ? { chutes: chutesOf(m) } : {}),
    refused: refusing || (m.coinsRefused ?? 0) > refused0,
    seconds: t,
    closed,
    ...(m.acceptedPence !== undefined ? { acceptorPence: m.acceptedPence - accepted0 } : {}),
    sigs,
  };
}

function ticked(l: LineMeasurement, control?: LineMeasurement): boolean {
  return l.inCounts !== 0 || l.outCounts !== 0 || l.meters.some((n) => n !== 0) || (l.secs ?? []).some((n) => n !== 0) || (l.triacs ?? []).some((n, i) => n > (control?.triacs?.[i] ?? 0));
}

export function measureCoinLines(
  fresh: () => Machine, lines: readonly number[], at: Date | null, w: MeasureWindows = MEASURE_WINDOWS, watch?: CreditWatch,
): CoinMeasurement {
  const first = fresh();
  if (!first.meterTotals) return { refused: 'this board keeps no money counts to measure a coin by' };
  const control = measureOne(first, null, at, w, 1, watch);
  const { sigs: controlSigs, ...controlOut } = control;
  const out: LineMeasurement[] = [];
  for (const l of [...new Set(lines)].sort((a, b) => a - b)) {
    const { sigs, ...one } = measureOne(fresh(), l, at, w, 1, watch);
    if (watch) one.credit = sigs.some((s, i) => i < controlSigs.length && s !== controlSigs[i]);
    if (!one.refused && !ticked(one, control)) {
      const again = measureOne(fresh(), l, at, w, REPEAT_DROPS);
      one.repeat = ticked(again, control) && !again.refused
        ? { drops: REPEAT_DROPS, meters: again.meters, ...(again.secs ? { secs: again.secs } : {}), ...(again.triacs ? { triacs: again.triacs } : {}) }
        : { drops: REPEAT_DROPS, meters: [] };
    }
    out.push(one);
  }
  return { control: controlOut, lines: out };
}
