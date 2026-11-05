import type { CoinMeasurement } from './coinwiring';

function lineTicks(m: Extract<CoinMeasurement, { control: unknown }>, l: Extract<CoinMeasurement, { control: unknown }>['lines'][number]): { ticks: Record<string, number>; drops: number } | null {
  if (l.refused || l.line === null) return null;
  const ticks: Record<string, number> = {};
  const read = (meters: readonly number[], secs: readonly number[] | undefined, triacs: readonly number[] | undefined): void => {
    meters.forEach((n, i) => { const d = n - (m.control.meters[i] ?? 0); if (d > 0) ticks[String(i + 1)] = d; });
    (secs ?? []).forEach((n, i) => { const d = n - (m.control.secs?.[i] ?? 0); if (d > 0) ticks[`s${i + 1}`] = d; });
    (triacs ?? []).forEach((n, i) => { const d = n - (m.control.triacs?.[i] ?? 0); if (d > 0) ticks[`t${i + 1}`] = d; });
  };
  read(l.meters, l.secs, l.triacs);
  if (Object.keys(ticks).length) return { ticks, drops: 1 };
  if (l.repeat?.meters.length || l.repeat?.secs?.length || l.repeat?.triacs?.length) read(l.repeat.meters, l.repeat.secs, l.repeat.triacs);
  return { ticks, drops: Object.keys(ticks).length ? l.repeat!.drops : 1 };
}

export function silentLines(m: CoinMeasurement): number[] {
  if ('refused' in m) return [];
  const out: number[] = [];
  for (const l of m.lines) {
    const r = lineTicks(m, l);
    if (r && l.line !== null && !Object.keys(r.ticks).length && !l.credit && !(l.acceptorPence && l.acceptorPence > 0)) out.push(l.line);
  }
  return out;
}
