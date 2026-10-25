import type { Cabinet } from '../web/dat';

export interface DeckBand {
  top: number;
  bottom: number;
  read: boolean;
}

const ROW_GAP = 0.04;
const ROW_DEPTH = 0.12;
const MARGIN = 0.35;

export const DEFAULT_DECK: DeckBand = { top: 0.864, bottom: 0.957, read: false };

interface Box { left: number; top: number; width: number; height: number }

export function deckBand(cab: Cabinet<unknown>, column?: Box | null): DeckBand {
  const c = cab.content;
  const col = column ?? c;
  const H = c.height;
  if (!(H > 0)) return DEFAULT_DECK;
  const caps: { t: number; b: number; h: number }[] = [];
  for (const lp of cab.lamps) {
    if (lp.button === undefined || lp.acceptor) continue;
    if (!(lp.width > 0 && lp.height > 0)) continue;
    if (lp.left < col.left || lp.left + lp.width > col.left + col.width) continue;
    const t = (lp.top - c.top) / H;
    const b = (lp.top + lp.height - c.top) / H;
    if (t < 0 || b > 1.001) continue;
    caps.push({ t, b, h: lp.height / H });
  }
  if (!caps.length) return DEFAULT_DECK;
  caps.sort((a, b) => b.t - a.t);
  const row = [caps[0]];
  for (let i = 1; i < caps.length; i++) {
    if (row[row.length - 1].t - caps[i].t > ROW_GAP) break;
    if (caps[0].t - caps[i].t > ROW_DEPTH) break;
    row.push(caps[i]);
  }
  const hs = row.map((r) => r.h).sort((a, b) => a - b);
  const m = hs[hs.length >> 1] * MARGIN;
  let top = Math.min(...row.map((r) => r.t)) - m;
  const bottom = Math.min(1, Math.max(...row.map((r) => r.b)) + m);
  let reelFoot = 0;
  for (const r of [...cab.reels, ...cab.frameReels, ...(cab.featureReel ? [cab.featureReel] : [])]) {
    if (r.left + r.width <= col.left || r.left >= col.left + col.width) continue;
    reelFoot = Math.max(reelFoot, (r.top + r.height - c.top) / H);
  }
  if (reelFoot < bottom) top = Math.max(top, reelFoot);
  top = Math.max(0, top);
  if (!(bottom - top > 0.005)) return DEFAULT_DECK;
  return { top, bottom, read: true };
}

export type SplitHow = 'edge' | 'reels' | 'none';
export interface LowerSplit {
  top: number;
  how: SplitHow;
}

const SEARCH = 1.5;
const ABOVE = 0.12;
const CLEAR = 0.15;
const MIN_SPAN = 0.55;
const MIN_STEP = 28;

export function reelRow(cab: Cabinet<unknown>, column?: Box | null): { top: number; bottom: number; height: number } | null {
  const col = column ?? cab.content;
  const reels = [...cab.reels, ...cab.frameReels].filter((r) =>
    r.width > 0 && r.height > 0 && r.left + r.width > col.left && r.left < col.left + col.width);
  if (!reels.length) return null;
  const rows: (typeof reels)[] = [];
  for (const r of [...reels].sort((a, b) => a.top - b.top)) {
    const home = rows.find((g) => Math.min(r.top + r.height, g[0].top + g[0].height) - Math.max(r.top, g[0].top) > Math.min(r.height, g[0].height) / 2);
    if (home) home.push(r); else rows.push([r]);
  }
  const area = (g: typeof reels): number => g.reduce((t, r) => t + r.width * r.height, 0);
  const row = rows.reduce((a, b) => (b.length > a.length || (b.length === a.length && area(b) > area(a)) ? b : a));
  const hs = row.map((r) => r.height).sort((a, b) => a - b);
  return {
    top: Math.min(...row.map((r) => r.top)),
    bottom: Math.max(...row.map((r) => r.top + r.height)),
    height: hs[hs.length >> 1],
  };
}

export function strongestLine(px: Uint8ClampedArray, w: number, h: number): { row: number; span: number } | null {
  for (let y = h - 2; y >= 1; y--) {
    let n = 0;
    const a = (y - 1) * w * 4;
    const b = (y + 1) * w * 4;
    for (let x = 0; x < w; x++) {
      const i = x * 4;
      const d = (Math.abs(px[a + i] - px[b + i]) + Math.abs(px[a + i + 1] - px[b + i + 1]) + Math.abs(px[a + i + 2] - px[b + i + 2])) / 3;
      if (d >= MIN_STEP) n++;
    }
    if (n / w >= MIN_SPAN) return { row: y, span: n / w };
  }
  return null;
}

export function lowerSplit(
  cab: Cabinet<unknown>, column: Box | null | undefined,
  sample: (left: number, top: number, width: number, height: number) => Uint8ClampedArray | null,
): LowerSplit | null {
  const c = cab.content;
  const col = column ?? c;
  const row = reelRow(cab, col);
  if (!row || !(c.height > 0)) return null;
  const frac = (y: number): number => Math.max(0, Math.min(1, (y - c.top) / c.height));
  const t0 = Math.max(c.top, Math.floor(row.top - SEARCH * row.height));
  const t1 = Math.floor(row.top - CLEAR * row.height);
  const l = Math.max(c.left, Math.round(col.left));
  const w = Math.round(Math.min(c.left + c.width, col.left + col.width) - l);
  const h = t1 - t0;
  if (w > 8 && h > 3) {
    const px = sample(l, t0, w, h);
    const line = px ? strongestLine(px, w, h) : null;
    if (line) return { top: frac(clearOfDisplay(cab, col, t0 + line.row)), how: 'edge' };
  }
  return { top: frac(clearOfDisplay(cab, col, row.top - ABOVE * row.height)), how: 'reels' };
}

function clearOfDisplay(cab: Cabinet<unknown>, col: Box, y: number): number {
  const v = cab.vfd;
  if (!v || !(v.width > 0) || !(v.height > 0)) return y;
  if (v.left >= col.left + col.width || v.left + v.width <= col.left) return y;
  return y > v.top && y < v.top + v.height ? v.top : y;
}
