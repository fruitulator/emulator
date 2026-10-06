import type { Reel } from '../hw/reel';

export type OpticArm = (optoTab: number) => readonly [number, number];

export type ModelRelation =
  | { kind: 'shift'; by: number }
  | { kind: 'reflect'; home: number };

export const V20_ARM_DEFAULT: OpticArm = (t) => {
  switch (t) {
    case 1: return [4, 6];
    case 2: return [1, 4];
    case 3: return [0, 4];
    case 4: return [6, 10];
    case 5: return [0, 2];
    case 6: return [0x76, 2];
    case 7: return [2, 4];
    case 8: return [2, 14];
    case 9: return [4, 8];
    case 10: return [0, 7];
    case 11: return [0, 2];
    default: return [6, 8];
  }
};

export const V20_ARM_MPU4: OpticArm = (t) => {
  switch (t) {
    case 1: return [4, 0xc];
    case 2: return [0x5c, 3];
    case 3: return [0x5d, 2];
    case 4: return [0x5f, 1];
    case 5: return [0, 5];
    case 6: return [0x5e, 2];
    default: return [0x5c, 4];
  }
};

export const V20_ARM_IMPACT: OpticArm = (t) => (t === 1 ? [4, 8] : [6, 8]);

export const V20_ARM_M1AB: OpticArm = (t) => {
  switch (t) {
    case 1: return [2, 4];
    case 2: return [4, 6];
    case 3: return [0, 4];
    case 4: return [6, 10];
    default: return [0, 2];
  }
};

export const V20_OPTIC_ARMS: Readonly<Record<string, OpticArm>> = {
  MPU4: V20_ARM_MPU4,
  IMPACT: V20_ARM_IMPACT,
  M1AB: V20_ARM_M1AB,
  SCORPION1: V20_ARM_DEFAULT,
  SCORPION2: V20_ARM_DEFAULT,
  SYS5: V20_ARM_DEFAULT,
  SYS85: V20_ARM_DEFAULT,
  SPACE: V20_ARM_DEFAULT,
};

export const MODEL_RELATIONS: Readonly<Record<string, ModelRelation>> = {
  SCORPION2: { kind: 'reflect', home: 9 },
  SYS5: { kind: 'shift', by: 5 },
  SCORPION1: { kind: 'reflect', home: 9 },
  SYS85: { kind: 'reflect', home: 9 },
  IMPACT: { kind: 'reflect', home: 9 },
  M1AB: { kind: 'reflect', home: 1 },
  MPU4: { kind: 'shift', by: -3 },
  MPU5: { kind: 'shift', by: -1 },
};

export const V20_REEL_POWER_UP_POS = 0;

export const MFME_OWN_SPACE: ModelRelation = { kind: 'shift', by: 0 };

export function oursFromMfme(relation: ModelRelation, mfme: number, steps: number): number {
  const x = relation.kind === 'shift' ? mfme - relation.by : relation.home - mfme;
  return ((x % steps) + steps) % steps;
}

export function parkAtV20PowerUp<T extends readonly Reel[]>(reels: T, relation: ModelRelation): T {
  for (const r of reels) r.park(oursFromMfme(relation, V20_REEL_POWER_UP_POS, r.stepsPerRevolution));
  return reels;
}

export function resetReelsInPlace(reels: Iterable<Reel>): void {
  for (const r of reels) {
    const at = r.position;
    r.reset();
    r.park(at);
  }
}

export function v20OpticPositions(
  arm: OpticArm, optoTab: number, steps: number,
): number[] {
  const [s, e] = arm(optoTab);
  const out: number[] = [];
  for (let p = 0; p < steps; p++) {
    if (s > e ? (p > s || p < e) : (p > s && p < e)) out.push(p);
  }
  return out;
}

export type OpticFitFailure =
  | 'not-a-mame-stepper'
  | 'no-model-relation'
  | 'anchor-mismatch'
  | 'empty-window'
  | 'no-gated-half-step';

export interface OpticFit {
  window?: readonly [number, number];
  failed?: OpticFitFailure;
}

export function v20IndexWindow(
  arm: OpticArm, tab: number, relation: ModelRelation, steps: number,
): readonly [number, number] | null {
  const mod = (x: number) => ((x % steps) + steps) % steps;
  const ours = (mfme: number) => oursFromMfme(relation, mfme, steps);
  const inside = v20OpticPositions(arm, tab, steps);
  if (!inside.length || inside.length >= steps) return null;
  let first = 0;
  for (let i = 0; i < inside.length; i++) {
    if (mod(inside[i] - inside[(i - 1 + inside.length) % inside.length]) !== 1) { first = i; break; }
  }
  const a = inside[first];
  const b = inside[(first + inside.length - 1) % inside.length];
  if (mod(b - a) !== inside.length - 1) return null;
  const lo = relation.kind === 'shift' ? ours(a) : ours(b);
  const hi = relation.kind === 'shift' ? ours(b) : ours(a);
  return [mod(lo - 1), mod(hi + 1)];
}

export function mameIndexForTab(
  reel: Pick<Reel, 'indexWindow' | 'stepsPerRevolution'> & { indexGateResidue?: number | null },
  arm: OpticArm,
  optoTab: number,
  relation: ModelRelation | undefined,
): OpticFit {
  if (!relation) return { failed: 'no-model-relation' };
  const [mStart, mEnd] = reel.indexWindow;
  const steps = reel.stepsPerRevolution;
  const window = (tab: number) => v20IndexWindow(arm, tab, relation, steps);

  const zero = window(0);
  if (!zero || zero[0] !== mStart || zero[1] !== mEnd) return { failed: 'anchor-mismatch' };
  if (optoTab === 0) return { window: [mStart, mEnd] };
  const w = window(optoTab);
  if (!w) return { failed: 'empty-window' };

  const residue = reel.indexGateResidue;
  if (residue !== null && residue !== undefined && steps % 8 === 0) {
    let gated = false;
    for (let p = 0; p < steps && !gated; p++) {
      const inWindow = w[0] > w[1] ? (p > w[0] || p < w[1]) : (p > w[0] && p < w[1]);
      if (inWindow && p % 8 === residue) gated = true;
    }
    if (!gated) return { failed: 'no-gated-half-step' };
  }
  return { window: w };
}
