import type { FrameView } from '../../src/machine/framestate';
import type { CabLamp } from '../dat';

export function followGate(m: FrameView, lp: CabLamp, gatedOff: Set<CabLamp>, seenLit: Set<number>): boolean {
  const gate = lp.enableLamp !== undefined ? [lp.enableLamp] : lp.enableLamps;
  if (!gate?.length) return false;
  let lit = false;
  let grew = false;
  for (const n of gate) {
    if (m.layoutLamp(n)) {
      lit = true;
      if (!seenLit.has(n)) { seenLit.add(n); grew = true; }
    }
  }
  if (lit) gatedOff.delete(lp);
  else if (lp.enableLatched || gate.some((n) => seenLit.has(n))) gatedOff.add(lp);
  else gatedOff.delete(lp);
  return grew;
}

export interface CarriesGates { gates?: number[] }

export function gatesOf(snap: unknown): number[] {
  const g = (snap as CarriesGates | null | undefined)?.gates;
  return Array.isArray(g) ? g.filter((n) => Number.isInteger(n) && n >= 0) : [];
}

export function stampGates(snap: object, gates: readonly number[]): void {
  if (gates.length) (snap as CarriesGates).gates = [...gates];
}
