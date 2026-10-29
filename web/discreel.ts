import { mfmeBandIndex } from './dat';

export interface DiscLamps {
  count: number;
  offsetDeg: number;
  enabled: boolean;
  outerH: number; outerL: number; outerSize: number;
  innerH: number; innerL: number; innerSize: number;
  floor: [number, number, number] | null;
  classic?: { outline: number };
}

export interface DiscWedge {
  slot: number;
  ring: 'outer' | 'inner';
  aLo: number; aHi: number;
  rOuter: number; rInner: number;
  cx: number; cy: number;
  rect: { x: number; y: number; w: number; h: number };
}

export function discAngleDeg(
  system: string, position: number, steps: number, offsetDeg: number,
  reversed = false,
  wholeDegrees = false,
): number {
  const n = steps > 0 ? steps : 96;
  let mfmePos: number;
  if (system === 'SCORPION4' || system === 'SCORPION5' || system === 'ADDER5') {
    mfmePos = (((5 - position) % n) + n) % n;
  } else {
    const p96 = mfmeBandIndex(system, (position * 96) / n, 0, false);
    mfmePos = p96 === undefined ? position : (p96 * n) / 96;
  }
  const index = reversed ? (n - mfmePos) % n : mfmePos;
  if (wholeDegrees) return -(offsetDeg + Math.trunc((Math.round(index) * 360) / n));
  return -(offsetDeg + (index * 360) / n);
}

export function discLampWedges(l: DiscLamps, width: number, height: number): DiscWedge[] {
  const out: DiscWedge[] = [];
  const n = l.count | 0;
  if (n <= 0) return out;
  const classic = !!l.classic;
  const cx = classic ? width >> 1 : (width - 1) >> 1;
  const cy = classic ? height >> 1 : (height - 1) >> 1;
  const pitch = (2 * Math.PI) / n;
  const advance = classic && n >= 2 ? Math.PI / (n >> 1) : pitch;
  const a0 = (l.offsetDeg * Math.PI) / 180 + Math.PI / n;
  const ring = (
    tag: 'outer' | 'inner', rOuter: number, rInner: number, size: number, base: number,
  ): void => {
    if (!rOuter) return;
    const mid = (rOuter + rInner) >> 1;
    for (let i = 0; i < n; i++) {
      const aHi = a0 + i * advance;
      const aLo = aHi - pitch;
      const theta = aHi - Math.PI / n;
      const px = Math.round(mid * Math.sin(theta) + cx);
      const py = Math.round(cy - mid * Math.cos(theta));
      out.push({
        slot: base + i, ring: tag, aLo, aHi, rOuter, rInner, cx, cy,
        rect: classic
          ? { x: px - size, y: py - size, w: 2 * size, h: 2 * size }
          : { x: px - size, y: py - size, w: 2 * size + 1, h: 2 * size + 1 },
      });
    }
  };
  ring('outer', l.outerH, l.outerL, l.outerSize, 0);
  if (l.innerH && (classic || 2 * n <= 32)) ring('inner', l.innerH, l.innerL, l.innerSize, n);
  return out;
}

export function discLampSlotCount(count: number): number {
  return 2 * count > 32 ? count : 2 * count;
}
