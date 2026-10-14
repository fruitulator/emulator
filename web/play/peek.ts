import { drumVisibleSymbols } from '../../src/layout/reeldrum';
import { reelVisibleSymbols, type ReelBand } from '../dat';

export const PEEK_MAX = 0.5;

export const PEEK_RETURN_MS = 160;

export const PEEK_SLOP_PX = 6;

type PeekReel = Pick<ReelBand<{ width: number; height: number }>,
  'left' | 'top' | 'width' | 'height' | 'stops' | 'rheight' | 'canvas'
  | 'bandOffset' | 'horizontal' | 'stripHorizontal' | 'disc' | 'angle'>;

export function reelWindowSymbols(reel: PeekReel): number {
  if (reel.bandOffset !== undefined && !reel.stripHorizontal) {
    return drumVisibleSymbols(reel.rheight, reel.canvas.height, reel.stops);
  }
  return reelVisibleSymbols(reel.rheight);
}

export function peekable(reel: PeekReel): boolean {
  if (reel.disc || reel.horizontal || reel.stripHorizontal) return false;
  if (!(reel.stops > 1)) return false;
  return reelWindowSymbols(reel) >= 1.5;
}

export function reelAt<R extends PeekReel>(
  reels: readonly R[], x: number, y: number,
): { reel: R; pitch: number } | null {
  for (let i = reels.length - 1; i >= 0; i--) {
    const reel = reels[i];
    if (!peekable(reel)) continue;
    const p = unturn(reel, x, y);
    if (p.x < reel.left || p.x >= reel.left + reel.width) continue;
    if (p.y < reel.top || p.y >= reel.top + reel.height) continue;
    return { reel, pitch: reel.height / reelWindowSymbols(reel) };
  }
  return null;
}

function unturn(part: { left: number; top: number; width: number; height: number; angle?: number },
  x: number, y: number): { x: number; y: number } {
  const a = part.angle;
  if (!a || !Number.isFinite(a) || a % 360 === 0) return { x, y };
  const rad = (a * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const cx = part.left + part.width / 2, cy = part.top + part.height / 2;
  const dx = x - cx, dy = y - cy;
  return { x: cx + dx * c + dy * s, y: cy - dx * s + dy * c };
}

export class ReelPeek {
  private rows = 0;
  private base = 0;
  private pitch = 0;
  private angle = 0;
  private from: { x: number; y: number } | null = null;
  private moved = false;
  private released: { at: number; rows: number } | null = null;

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly reducedMotion: () => boolean = () =>
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  ) {}

  begin(x: number, y: number, pitch: number, angle = 0): void {
    this.from = { x, y };
    this.pitch = pitch > 0 ? pitch : 1;
    this.angle = Number.isFinite(angle) ? angle : 0;
    this.moved = false;
    this.rows = this.value();
    this.released = null;
    this.base = this.rows;
  }

  get tracking(): boolean {
    return this.from !== null;
  }

  drag(x: number, y: number): boolean {
    if (!this.from) return false;
    const dx = x - this.from.x, dy = y - this.from.y;
    if (!this.moved && Math.hypot(dx, dy) <= PEEK_SLOP_PX) return false;
    this.moved = true;
    const rad = (this.angle * Math.PI) / 180;
    const along = -dx * Math.sin(rad) + dy * Math.cos(rad);
    this.rows = clamp(this.base + along / this.pitch);
    return true;
  }

  release(): boolean {
    const was = this.moved;
    this.from = null;
    this.moved = false;
    if (this.rows !== 0) {
      if (this.reducedMotion()) this.rows = 0;
      else this.released = { at: this.now(), rows: this.rows };
    }
    return was;
  }

  value(): number {
    const r = this.released;
    if (!r) return this.rows;
    const t = (this.now() - r.at) / PEEK_RETURN_MS;
    if (t >= 1) {
      this.released = null;
      this.rows = 0;
      return 0;
    }
    const k = 1 - t;
    return r.rows * k * k * k;
  }
}

function clamp(v: number): number {
  return Math.max(-PEEK_MAX, Math.min(PEEK_MAX, v));
}
