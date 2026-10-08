import type { Machine } from './machine';
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

function measureOne(m: Machine, line: number | null, at: Date | null, w: MeasureWindows): LineMeasurement {
  if (at) m.pinHostClock?.(at);
  const totals = m.meterTotals!;
  const in0 = totals.in;
  const out0 = totals.out;
  const meters0 = meterPulses(m);
  const refused0 = m.coinsRefused ?? 0;
  const refusing = line !== null && m.coinRefusing !== undefined && line < 16 && (m.coinRefusing & (1 << line)) !== 0;
  if (line !== null) m.insertCoin(line);
  const chunk = Math.max(1, Math.round(m.clockHz * w.chunkS));
  let t = 0;
  let lastChange = 0;
  let moved = false;
  let seen = `${in0},${out0}`;
  let closed: LineMeasurement['closed'] = 'cap';
  while (t < w.capS) {
    m.run(chunk);
    t += w.chunkS;
    const now = `${totals.in},${totals.out}`;
    if (now !== seen) { seen = now; lastChange = t; moved = true; }
    if (moved && t - lastChange >= w.quietS) { closed = 'quiet'; break; }
    if (!moved && t >= w.firstWaitS) { closed = 'nothing'; break; }
  }
  const meters1 = meterPulses(m);
  return {
    line,
    inCounts: totals.in - in0,
    outCounts: totals.out - out0,
    meters: meters1.map((v, i) => v - (meters0[i] ?? 0)),
    refused: refusing || (m.coinsRefused ?? 0) > refused0,
    seconds: t,
    closed,
  };
}

export function measureCoinLines(
  fresh: () => Machine, lines: readonly number[], at: Date | null, w: MeasureWindows = MEASURE_WINDOWS,
): CoinMeasurement {
  const first = fresh();
  if (!first.meterTotals) return { refused: 'this board keeps no money counts to measure a coin by' };
  const control = measureOne(first, null, at, w);
  const out: LineMeasurement[] = [];
  for (const l of [...new Set(lines)].sort((a, b) => a - b)) out.push(measureOne(fresh(), l, at, w));
  return { control, lines: out };
}
