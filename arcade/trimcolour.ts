
export const QUANT = 4;
export const BG_NEAR = 48;
export const DARK = 48;
export const LIGHT = 215;
export const GREY = 16;
export const MIN_SHARE = 0.15;
export const MIN_PIXELS = 24;

export interface Pixels { data: ArrayLike<number>; width: number; height: number }
export interface PxBox { left: number; top: number; width: number; height: number }
type RGB = [number, number, number];

const hex = (c: RGB): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

const BINS = 1 << (3 * QUANT);
const SHIFT = 8 - QUANT;
const binN = new Uint32Array(BINS);
const binR = new Float64Array(BINS);
const binG = new Float64Array(BINS);
const binB = new Float64Array(BINS);
const order = new Uint16Array(BINS);
let used = 0;

function histAdd(r: number, g: number, b: number): void {
  const k = ((r >> SHIFT) << (2 * QUANT)) | ((g >> SHIFT) << QUANT) | (b >> SHIFT);
  if (binN[k] === 0) order[used++] = k;
  binN[k]++; binR[k] += r; binG[k] += g; binB[k] += b;
}

function histTake(): RGB | null {
  let best = -1;
  for (let i = 0; i < used; i++) {
    const k = order[i];
    if (best < 0 || binN[k] > binN[best]) best = k;
  }
  const c: RGB | null = best < 0 ? null : [binR[best] / binN[best], binG[best] / binN[best], binB[best] / binN[best]];
  for (let i = 0; i < used; i++) {
    const k = order[i];
    binN[k] = 0; binR[k] = 0; binG[k] = 0; binB[k] = 0;
  }
  used = 0;
  return c;
}

const isBg = (bg: RGB, r: number, g: number, b: number): boolean => Math.hypot(r - bg[0], g - bg[1], b - bg[2]) <= BG_NEAR;

export function backgroundOf(img: Pixels): RGB | null {
  const { width: w, height: h, data } = img;
  if (w < 2 || h < 2) return null;
  const add = (i: number): void => {
    const o = i * 4;
    if (data[o + 3] < 128) return;
    histAdd(data[o], data[o + 1], data[o + 2]);
  };
  for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { add(y * w); add(y * w + w - 1); }
  return histTake();
}

interface Whole { bg: RGB | null; colour: string | null }
const wholeCache = new WeakMap<object, Whole>();
export const trimReads = { whole: 0 };

function wholeOf(img: Pixels): Whole {
  const hit = wholeCache.get(img);
  if (hit) return hit;
  trimReads.whole++;
  const bg = backgroundOf(img);
  const { width: w, height: h, data } = img;
  for (let i = 0, n = w * h; i < n; i++) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const hi = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const lo = r < g ? (r < b ? r : b) : (g < b ? g : b);
    if (hi < DARK || lo > LIGHT || hi - lo < GREY) continue;
    if (bg && isBg(bg, r, g, b)) continue;
    histAdd(r, g, b);
  }
  const c = histTake();
  const whole = { bg, colour: c ? hex(c) : null };
  wholeCache.set(img, whole);
  return whole;
}

export function trimFromArt(img: Pixels, boxes: readonly PxBox[], band: number): string | null {
  const whole = wholeOf(img);
  const bg = whole.bg;
  const { width: w, height: h, data } = img;
  if (boxes.length) {
    let l = Infinity, t = Infinity, r = -Infinity, btm = -Infinity;
    for (const b of boxes) {
      l = Math.min(l, b.left); t = Math.min(t, b.top);
      r = Math.max(r, b.left + b.width); btm = Math.max(btm, b.top + b.height);
    }
    const y0 = Math.max(0, Math.floor(t - band)), y1 = Math.min(h, Math.ceil(btm + band));
    const x0 = Math.max(0, Math.floor(l - band)), x1 = Math.min(w, Math.ceil(r + band));
    let all = 0;
    let kept = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x >= l && x < r && y >= t && y < btm) continue;
        all++;
        const o = (y * w + x) * 4;
        if (data[o + 3] >= 128 && !(bg && isBg(bg, data[o], data[o + 1], data[o + 2]))) kept++;
      }
    }
    if (kept >= MIN_PIXELS && kept >= all * MIN_SHARE) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (x >= l && x < r && y >= t && y < btm) continue;
          const o = (y * w + x) * 4;
          if (data[o + 3] < 128) continue;
          if (bg && isBg(bg, data[o], data[o + 1], data[o + 2])) continue;
          histAdd(data[o], data[o + 1], data[o + 2]);
        }
      }
      const c = histTake();
      if (c) return hex(c);
    }
  }
  return whole.colour;
}
