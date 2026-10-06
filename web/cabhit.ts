
export const MIN_TOUCH = 44;

export const TOUCH_SLOP = 17;

export const COIN_SLOP = MIN_TOUCH / 2;

export interface HitPart {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly acceptor?: unknown;
  readonly coinInput?: number;
  readonly angle?: number;
}

function ownFrame(part: HitPart, x: number, y: number): { x: number; y: number } {
  const a = part.angle;
  if (!a || !Number.isFinite(a) || a % 360 === 0) return { x, y };
  const rad = (a * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const cx = part.left + part.width / 2, cy = part.top + part.height / 2;
  const dx = x - cx, dy = y - cy;
  return { x: cx + dx * c + dy * s, y: cy - dx * s + dy * c };
}

export function touchSlop(part: HitPart): number {
  return part.acceptor || part.coinInput !== undefined ? COIN_SLOP : TOUCH_SLOP;
}

export function pickControl<T extends HitPart>(
  parts: Iterable<T>, x: number, y: number, scale: number,
  clickable: (part: T) => boolean,
): T | null {
  let exact: T | null = null;
  let exactArea = Infinity;
  for (const lp of parts) {
    if (!clickable(lp)) continue;
    const p = ownFrame(lp, x, y);
    if (p.x < lp.left || p.x >= lp.left + lp.width) continue;
    if (p.y < lp.top || p.y >= lp.top + lp.height) continue;
    const area = lp.width * lp.height;
    if (area < exactArea) {
      exactArea = area;
      exact = lp;
    }
  }
  if (exact) return exact;
  if (!(scale > 0)) return null;
  let best: T | null = null;
  let bestDist = Infinity;
  let bestArea = Infinity;
  for (const lp of parts) {
    if (!clickable(lp)) continue;
    const slop = touchSlop(lp) / scale;
    const p = ownFrame(lp, x, y);
    const dx = Math.max(lp.left - p.x, 0, p.x - (lp.left + lp.width));
    const dy = Math.max(lp.top - p.y, 0, p.y - (lp.top + lp.height));
    if (dx > slop || dy > slop) continue;
    const dist = Math.hypot(dx, dy);
    const area = lp.width * lp.height;
    const closer = dist < bestDist - 0.5;
    const tied = Math.abs(dist - bestDist) <= 0.5 && area < bestArea;
    if (closer || tied) {
      bestDist = dist;
      bestArea = area;
      best = lp;
    }
  }
  return best;
}

export interface CanvasFit {
  readonly rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  readonly canvas: { readonly width: number; readonly height: number };
  readonly content: { readonly left: number; readonly top: number };
}

export function layoutPoint(fit: CanvasFit, clientX: number, clientY: number): { x: number; y: number; scale: number } {
  const scale = Math.min(fit.rect.width / fit.canvas.width, fit.rect.height / fit.canvas.height);
  const offX = fit.rect.left + (fit.rect.width - fit.canvas.width * scale) / 2;
  const offY = fit.rect.top + (fit.rect.height - fit.canvas.height * scale) / 2;
  return {
    x: (clientX - offX) / scale + fit.content.left,
    y: (clientY - offY) / scale + fit.content.top,
    scale,
  };
}
