const KEY = 'fruitulator.arcade.realism';

export const REALISM_PARTS = ['shadows', 'reflections', 'halos', 'glow', 'floor', 'sheen'] as const;
export type RealismPart = (typeof REALISM_PARTS)[number];
export type RealismParts = Readonly<Record<RealismPart, boolean>>;

export function allRealism(on: boolean): RealismParts {
  return { shadows: on, reflections: on, halos: on, glow: on, floor: on, sheen: on };
}

export function readRealism(): RealismParts {
  try {
    const on = (localStorage.getItem(KEY) ?? '').split(',');
    return Object.fromEntries(REALISM_PARTS.map((p) => [p, on.includes(p)])) as Record<RealismPart, boolean>;
  } catch { return allRealism(false); }
}

export function writeRealism(parts: RealismParts): void {
  try { localStorage.setItem(KEY, REALISM_PARTS.filter((p) => parts[p]).join(',')); } catch {  }
}
