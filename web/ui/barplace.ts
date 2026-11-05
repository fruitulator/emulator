
export const BAR_PLACED_FROM_PX = 600;

export interface ScreenBox { left: number; top: number; right: number; bottom: number }

export interface CabinetBox extends ScreenBox {
  outline?: readonly ScreenPoint[];
}

export interface ScreenPoint { x: number; y: number }

const BAR_TOP_MIN = 24;
const BAR_TOP_SHARE = 0.06;
const BAR_TOP_MAX = 96;
const WINDOW_GAP = 16;

export function placeBar(
  win: { width: number; height: number },
  glass: ScreenBox,
  bar: { width: number; height: number },
): { left: number; top: number } {
  const centred = (glass.left + glass.right - bar.width) / 2;
  const left = Math.max(WINDOW_GAP, Math.min(centred, win.width - bar.width - WINDOW_GAP));
  const top = Math.min(BAR_TOP_MAX, Math.max(BAR_TOP_MIN, win.height * BAR_TOP_SHARE));
  return { left: Math.round(left), top: Math.round(top) };
}

export function barClearance(barBottom: number): number {
  return Math.max(0, Math.round(barBottom - 64));
}

export function convexOutline(points: readonly ScreenPoint[]): ScreenPoint[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const turn = (o: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (from: ScreenPoint[]): ScreenPoint[] => {
    const h: ScreenPoint[] = [];
    for (const q of from) {
      while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half(p.reverse())];
}
