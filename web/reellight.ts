import { drumScreenRadius, drumVisibleSymbols } from '../src/layout/reeldrum';
import type { Rect, ReelBand } from './dat';

export type Rgb = [number, number, number];

interface Pixels { width: number; height: number; data: ArrayLike<number> }

export function reelLightFloor(
  id: number, offLevel: number, masks: readonly (Pixels | null | undefined)[],
): Rgb {
  if (id >= 0 && id <= 2) {
    const m = masks[id];
    if (!m || !m.width || !m.height) return [255, 255, 255];
    return [m.data[0], m.data[1], m.data[2]];
  }
  const v = offLevel & 0xff;
  return [v, v, v];
}

export function applyOpaqueBand(
  band: { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
  floor: Rgb,
): number {
  const { width, height, data } = band;
  if (!width || !height) return 255;
  const o = ((height - 1) * width + (width - 1)) * 4;
  const kr = data[o], kg = data[o + 1], kb = data[o + 2];
  const mr = (kr * floor[0]) >> 8, mg = (kg * floor[1]) >> 8, mb = (kb * floor[2]) >> 8;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === kr && data[i + 1] === kg && data[i + 2] === kb) {
      data[i] = mr; data[i + 1] = mg; data[i + 2] = mb;
    }
    data[i + 3] = 255;
  }
  return mb;
}

export interface FancySite<A> extends Rect { mask: A | null; lamp: number }

export interface FancyPool<A> {
  floor: Rect & { rgb: Rgb };
  sites: FancySite<A>[];
  clip: Rect;
}

export function fancyReelPool<A extends { width: number; height: number }>(
  reel: ReelBand<A>,
): FancyPool<A> | null {
  if (!reel.lampsEnabled || !reel.lightFloor) return null;
  const masks = [reel.mask ?? null, reel.mask2 ?? null, reel.mask3 ?? null];
  const white = reel.lightFloor.every((v) => v >= 255);
  if (white && masks.every((m) => !m)) return null;

  const horiz = !!reel.horizontal;
  const across = horiz ? reel.height : reel.width;
  const wd = Math.max(0, Math.min(reel.widthDiff ?? 0, Math.floor((across - 1) / 2)));
  const rect: Rect = horiz
    ? { left: reel.left, top: reel.top + wd, width: reel.width, height: reel.height - 2 * wd }
    : { left: reel.left + wd, top: reel.top, width: reel.width - 2 * wd, height: reel.height };

  const along = horiz ? reel.width : reel.height;
  const visible = drumVisibleSymbols(reel.rheight, reel.canvas.height, reel.stops);
  const radius = drumScreenRadius(along, visible, reel.stops);
  const at = (d: number): number => {
    const raw = Number.isFinite(radius)
      ? along / 2 + radius * Math.sin((2 * Math.PI * d) / reel.stops)
      : along / 2 + (d * along) / Math.max(visible, 1e-6);
    return Math.max(0, Math.min(along, raw));
  };
  const shift = reel.winlineShift ?? 0;
  const tray = reel.lampTray ?? [-2, ...reel.lampNums, -2];
  const sites: FancySite<A>[] = [];
  for (let i = 0; i < 15; i++) {
    const lamp = tray[i] ?? -2;
    if (lamp === -2) continue;
    const k = i % 5;
    const a0 = Math.round(at(k - 2.5 - shift));
    const a1 = Math.round(at(k - 1.5 - shift));
    if (a1 <= a0) continue;
    const mask = masks[Math.floor(i / 5)];
    sites.push(horiz
      ? { mask, lamp, left: rect.left + a0, top: rect.top, width: a1 - a0, height: rect.height }
      : { mask, lamp, left: rect.left, top: rect.top + a0, width: rect.width, height: a1 - a0 });
  }
  return { floor: { ...rect, rgb: reel.lightFloor }, sites, clip: rect };
}
