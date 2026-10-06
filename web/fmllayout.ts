import { discLampSlotCount, type DiscLamps } from './discreel';
import {
  bmpToImageData, cssArgb, newImageData,
  type BandStrip, type FlipStrip, type BitmapPass, type Cabinet, type CabBitmap, type CabLamp, type DotMatrix, type PrismLamp,
  type ReelBand, type ReelBorder, type Rect,
  type RgbLed,
  SEG_METRICS,
} from './dat';
import type { ProconnMatrix, EpochDotAlphaPanel, MaygayMatrixPanel, EpochMatrixPanel, VideoScreen } from './dat';
import { applyOpaqueBand, reelLightFloor } from './reellight';
import { parseLayout, type ParsedComponent } from './fmlparse';
import { mfmeMajor } from '../src/layout/fmlconfig';
import { drawnAngle } from '../src/layout/compangle';
import { bandArtCells } from '../src/layout/bandcells';
import { acceptorIds } from '../src/machine/coinid';
import { shortcutKnown } from './shortcuts';
import { BFM_ALPHA_DEFAULT_COLUMNS, BFM_ALPHA_DEFAULT_INK, BFM_ALPHA_DEFAULT_OFF_LEVEL } from './bfmalpha';

export const SIDE_MARGIN = 0.06;

export const CLUSTER_GAP = 0.10;

export const EDGE_STEP = 24;
export const EDGE_SHARE = 0.40;

export const FLAT_STEP = 8;
export const FLAT_SHARE = 0.02;
export const SLIVER = 0.10;

function columnSteps(bg: ImageData, x0: number, x1: number, step: number): Int32Array {
  const { width: w, height: h, data } = bg;
  const lo = Math.max(1, Math.floor(x0));
  const hi = Math.min(w, Math.ceil(x1));
  if (hi <= lo || h <= 0) return new Int32Array(0);
  const counts = new Int32Array(hi - lo);
  const lum = (i: number): number =>
    (data[i + 3] ? 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] : 0);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let prev = lum((row + lo - 1) * 4);
    for (let x = lo; x < hi; x++) {
      const v = lum((row + x) * 4);
      if (Math.abs(v - prev) > step) counts[x - lo]++;
      prev = v;
    }
  }
  return counts;
}

export function cabinetEdgeBetween(bg: ImageData, x0: number, x1: number, step = EDGE_STEP): boolean {
  const need = Math.ceil(bg.height * EDGE_SHARE);
  const counts = columnSteps(bg, x0, x1, step);
  for (let i = 0; i < counts.length; i++) if (counts[i] >= need) return true;
  return false;
}

export function bandIsFlat(bg: ImageData, x0: number, x1: number): boolean {
  const counts = columnSteps(bg, x0, x1, FLAT_STEP);
  if (!counts.length) return false;
  const sorted = Int32Array.from(counts).sort();
  return sorted[sorted.length >> 1] <= bg.height * FLAT_SHARE;
}

export interface CropPart { x: number; y: number; width: number; height: number; reel?: boolean }

export function sidewaysCrop(
  width: number, height: number,
  parts: Iterable<CropPart>,
  background?: ImageData | null,
  bgLeft = 0,
): Rect {
  const on: CropPart[] = [];
  for (const p of parts) {
    if (p.width <= 0 || p.height <= 0) continue;
    if (p.x >= width || p.x + p.width <= 0 || p.y >= height || p.y + p.height <= 0) continue;
    on.push(p);
  }
  if (!on.length) return { left: 0, top: 0, width, height };
  on.sort((a, b) => a.x - b.x);
  let x0 = Math.max(0, on[0].x);
  let x1 = 0;
  for (const p of on) x1 = Math.max(x1, Math.min(width, p.x + p.width));
  if (x1 <= x0) return { left: 0, top: 0, width, height };

  if (background) {
    const tol = (x1 - x0) * CLUSTER_GAP;
    const clusters: { l: number; r: number; reel: boolean; area: number }[] = [];
    for (const p of on) {
      const l = Math.max(0, p.x);
      const r = Math.min(width, p.x + p.width);
      const area = (r - l) * Math.min(height, p.y + p.height) - (r - l) * Math.max(0, p.y);
      const c = clusters[clusters.length - 1];
      if (c && l <= c.r + tol) { c.r = Math.max(c.r, r); c.reel ||= !!p.reel; c.area += area; }
      else clusters.push({ l, r, reel: !!p.reel, area });
    }
    if (clusters.length > 1) {
      let main = clusters.findIndex((c) => c.reel);
      if (main < 0) {
        main = 0;
        for (let i = 1; i < clusters.length; i++) {
          if (clusters[i].r - clusters[i].l > clusters[main].r - clusters[main].l) main = i;
        }
      }
      let lo = main;
      let hi = main;
      const sliver = clusters[main].area * SLIVER;
      const inset = (x1 - x0) * SIDE_MARGIN;
      const wall = (far: typeof clusters[0], near: typeof clusters[0], a: number, b: number, rightward: boolean): boolean =>
        cabinetEdgeBetween(background, a - bgLeft, b - bgLeft)
        || (far.area < sliver && (bandIsFlat(background, a - bgLeft, b - bgLeft)
          || cabinetEdgeBetween(background,
            (rightward ? Math.max(near.l, a - inset) : a) - bgLeft,
            (rightward ? b : Math.min(near.r, b + inset)) - bgLeft, FLAT_STEP)));
      while (lo > 0 && !wall(clusters[lo - 1], clusters[lo], clusters[lo - 1].r, clusters[lo].l, false)) lo--;
      while (hi < clusters.length - 1 && !wall(clusters[hi + 1], clusters[hi], clusters[hi].r, clusters[hi + 1].l, true)) hi++;
      x0 = clusters[lo].l;
      x1 = clusters[hi].r;
    }
  }

  const pad = (x1 - x0) * SIDE_MARGIN;
  const left = Math.max(0, Math.floor(x0 - pad));
  const right = Math.min(width, Math.ceil(x1 + pad));
  return { left, top: 0, width: right - left, height };
}

function turn(c: ParsedComponent): { angle?: number } {
  const angle = drawnAngle(c.type, c.angle);
  return angle === undefined ? {} : { angle };
}

function fmlReelBorder(c: ParsedComponent): { border?: ReelBorder } {
  const raw = val(c, 'BorderThickness') ?? 1;
  const bw = Math.max(0, Math.min(raw | 0, Math.floor(Math.min(c.width, c.height) / 2)));
  const argb = (val(c, 'BorderColour') ?? 0xff000000) >>> 0;
  if (!(bw > 0) || (argb & 0xffffff) === 0xc9b1d3) return {};
  return {
    border: {
      rect: { left: c.x, top: c.y, width: c.width, height: c.height },
      width: bw,
      colour: cssArgb((0xff000000 | argb) >>> 0),
    },
  };
}

function bandReelBorder(
  c: ParsedComponent, num: (k: string) => number | undefined,
): { border?: ReelBorder } {
  const bw = Math.max(0, Math.min((num('BorderWidth') ?? 1) | 0,
    Math.floor(Math.min(c.width, c.height) / 2)));
  if (!(bw > 0)) return {};
  return {
    border: {
      rect: { left: c.x, top: c.y, width: c.width, height: c.height },
      width: bw,
      colour: cssArgb((num('BorderColour') ?? 0xff000000) >>> 0),
    },
  };
}

const enum Type {
  Background = 0x01, Reel = 0x03, Lamp = 0x04, Button = 0x05,
  Alpha = 0x07, SevenSeg = 0x0e, BFMAlpha = 0x0c, DotMatrix = 0x0d, DotAlpha = 0x13, AlphaNew = 0x19,
  AlphaStrip = 0x1a, Led = 0x12, Anim = 0x08,
  AceMatrix = 0x10,
  ProconnMatrix = 0x11,
  EpochDotAlpha = 0x16,
  MaygayMatrix = 0x2e,
  EpochMatrix = 0x22,
  Disc = 0x06,
  RgbLed = 0x26,
  BFMVideo = 0x1f,
  BarcrestVideo = 0x0f,
}

const TypeBitmap = 0x0b;

const u32 = (d: Uint8Array, o: number): number =>
  (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;

const val = (c: ParsedComponent, key: string): number | undefined =>
  c.values.get(key) ?? c.defaults.get(key);

function winlinesOffsetOf(
  c: ParsedComponent, stops: number,
): { winlinesOffset?: number; winlineShift?: number } {
  const w = (val(c, 'WinlinesOffset') ?? 0) | 0;
  if (!w) return {};
  const halfSteps = val(c, 'HalfSteps') || 96;
  return { winlinesOffset: w, winlineShift: (w * (stops || 16)) / halfSteps };
}

function inputGates(
  c: ParsedComponent, own: readonly number[] = [],
): { shortcut?: number; enableLamp?: number; enableLamps?: number[] } {
  const out: { shortcut?: number; enableLamp?: number; enableLamps?: number[] } = {};
  for (const n of [1, 2]) {
    const vk = val(c, `Shortcut${n}`);
    if (val(c, `Shortcut${n}Enabled`) && vk && shortcutKnown(vk)) {
      out.shortcut = vk;
      break;
    }
  }
  const inhibit = val(c, 'InhibitLamp');
  if (val(c, 'Lockout') && inhibit !== undefined && inhibit >= 0) out.enableLamp = inhibit;
  else if (val(c, 'Lockout') && own.length) out.enableLamps = [...new Set(own)];
  return out;
}

interface ShapeParams { round?: number; vectors?: number }

const shapeParams = (c: ParsedComponent): ShapeParams => ({
  round: val(c, 'Roundness'), vectors: val(c, 'ShapeParameter'),
});

function insideShape(
  kind: number, lx: number, ly: number, rx: number, ry: number, inset: number,
  p: ShapeParams,
): boolean {
  const hx = rx - inset, hy = ry - inset;
  if (hx <= 0 || hy <= 0) return false;
  switch (kind) {
    case 2: case 3: {
      if (Math.abs(lx) > hx || Math.abs(ly) > hy) return false;
      const cr = Math.max(0, Math.round((Math.max(rx, ry) * 2 * (p.round ?? 0)) / 100) / 2 - inset);
      const ex = Math.abs(lx) - (hx - cr), ey = Math.abs(ly) - (hy - cr);
      return ex <= 0 || ey <= 0 || ex * ex + ey * ey <= cr * cr;
    }
    case 4: case 5: {
      const nx = lx / hx, ny = ly / hy;
      return nx * nx + ny * ny <= 1;
    }
    case 6:
      return Math.abs(lx) / hx + Math.abs(ly) / hy <= 1;
    case 7: case 8: {
      const n = Math.max(3, p.vectors ?? 3);
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ai = (i * 2 * Math.PI) / n, aj = (j * 2 * Math.PI) / n;
        const xi = Math.cos(ai) * hx, yi = Math.sin(ai) * hy;
        const xj = Math.cos(aj) * hx, yj = Math.sin(aj) * hy;
        if ((yi > ly) !== (yj > ly) && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    case 9:
      return Math.abs(ly) <= hy && lx <= hx && Math.abs(ly) <= ((lx + hx) / (2 * hx)) * hy;
    case 10:
      return Math.abs(ly) <= hy && lx >= -hx && Math.abs(ly) <= ((hx - lx) / (2 * hx)) * hy;
    case 11:
      return Math.abs(lx) <= hx && ly <= hy && Math.abs(lx) <= ((ly + hy) / (2 * hy)) * hx;
    case 12:
      return Math.abs(lx) <= hx && ly >= -hy && Math.abs(lx) <= ((hy - ly) / (2 * hy)) * hx;
    default:
      return Math.abs(lx) <= hx && Math.abs(ly) <= hy;
  }
}

function ledFace(
  w: number, h: number, colour: number,
  st: { round: boolean; noOutline: boolean; noShadow: boolean },
): ImageData {
  const img = newImageData(w, h);
  const d = img.data;
  const put = (x: number, y: number, argb: number): void => {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    d[o] = (argb >>> 16) & 0xff; d[o + 1] = (argb >>> 8) & 0xff; d[o + 2] = argb & 0xff; d[o + 3] = 0xff;
  };
  const u = Math.min(6, Math.max(1, Math.floor(w / 17)));
  const BLACK = 0xff000000, GREY = 0xff808080, WHITE = 0xffffffff, SILVER = 0xffc0c0c0;
  if (st.round) {
    fillShape(img, 0, 0, w, h, colour, 5, st.noOutline ? undefined : BLACK);
    if (!st.noShadow) {
      const pen = Math.max(1, u >> 1);
      const arc = (x3: number, y3: number, x4: number, y4: number, argb: number): void => {
        const cx = w / 2, cy = h / 2, rx = (w - 8 * u) / 2, ry = (h - 8 * u) / 2;
        if (rx <= 0 || ry <= 0) return;
        const ang = (x: number, y: number): number => Math.atan2(-(y - cy), x - cx);
        let a0 = ang(x3, y3), a1 = ang(x4, y4);
        if (a1 <= a0) a1 += 2 * Math.PI;
        const steps = Math.max(16, Math.ceil((a1 - a0) * Math.max(rx, ry) * 2));
        for (let i = 0; i <= steps; i++) {
          const a = a0 + ((a1 - a0) * i) / steps;
          const px = cx + Math.cos(a) * rx - 0.5, py = cy - Math.sin(a) * ry - 0.5;
          for (let k = 0; k < pen; k++) put(px - Math.cos(a) * k, py + Math.sin(a) * k, argb);
        }
      };
      arc(w - 4 * u, h - 2 * u, w - 4 * u, h - 9 * u, GREY);
      arc(8 * u, 0, 7 * u, 9 * u, WHITE);
      arc(8 * u, 0, 7 * u, 8 * u, SILVER);
    }
    return img;
  }
  fillShape(img, 0, 0, w, h, colour, 0);
  const line = (pts: [number, number][], argb: number): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let k = 0; k < n; k++) put(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, argb);
    }
  };
  line([[u - 1, u - 1], [w - 1, u - 1], [w - 1, h - 1], [u - 1, h - 1], [u - 1, u - 1]], BLACK);
  if (!st.noOutline) {
    const a = 3 * u - 1, r = w - 1 - 2 * u, b = h - 1 - 2 * u;
    line([[a, a], [r, a], [r, b], [a, b], [a, a]], BLACK);
    line([[2 * u - 1, h - u - 1], [2 * u - 1, 2 * u - 1], [w - 2 * u + 1, 2 * u - 1]], SILVER);
    line([[w - u - 1, 3 * u - 1], [w - u - 1, h - u - 1], [2 * u - 1, h - u - 1]], GREY);
  }
  const blip = (x0: number, y0: number, x1: number, y1: number, argb: number): void => {
    for (let y = Math.min(y0, y1); y < Math.max(y0, y1); y++) {
      for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x++) put(x, y, argb);
    }
  };
  blip(w - 6 * u, h - 5 * u, w - 4 * u, h - 4 * u, GREY);
  blip(w - 9 * u, h - 5 * u, w - 7 * u, h - 4 * u, GREY);
  blip(4 * u, 4 * u, 6 * u, 5 * u, WHITE);
  blip(7 * u, 4 * u, 9 * u, 5 * u, SILVER);
  return img;
}

function fillShape(
  dst: ImageData, x: number, y: number, w: number, h: number, argb: number, shape: number,
  border?: number, angle = 0, params: ShapeParams = {},
): void {
  const a = (argb >>> 24) & 0xff, r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff, b = argb & 0xff;
  if (a === 0 || w <= 0 || h <= 0) return;
  const ba = border !== undefined ? (border >>> 24) & 0xff : 0;
  const br = border !== undefined ? (border >>> 16) & 0xff : 0;
  const bg2 = border !== undefined ? (border >>> 8) & 0xff : 0;
  const bb = border !== undefined ? border & 0xff : 0;
  const d = dst.data;
  const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
  const rad = (angle * Math.PI) / 180;
  const cs = Math.cos(rad), sn = Math.sin(rad);
  const half = angle
    ? { w: (Math.abs(w * cs) + Math.abs(h * sn)) / 2, h: (Math.abs(w * sn) + Math.abs(h * cs)) / 2 }
    : { w: rx, h: ry };
  const x0 = Math.max(0, Math.floor(cx - half.w)), y0 = Math.max(0, Math.floor(cy - half.h));
  const x1 = Math.min(dst.width, Math.ceil(cx + half.w));
  const y1 = Math.min(dst.height, Math.ceil(cy + half.h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const dx = px + 0.5 - cx, dy = py + 0.5 - cy;
      const lx = angle ? dx * cs + dy * sn : dx;
      const ly = angle ? -dx * sn + dy * cs : dy;
      if (!insideShape(shape, lx, ly, rx, ry, 0, params)) continue;
      const o = (py * dst.width + px) * 4;
      const edge = border !== undefined && !insideShape(shape, lx, ly, rx, ry, 1, params);
      if (edge) {
        d[o] = br; d[o + 1] = bg2; d[o + 2] = bb; d[o + 3] = ba;
      } else {
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
      }
    }
  }
}

const hasLegend = (c: ParsedComponent): boolean =>
  !!(c.texts.get('Label') ?? c.texts.get('OffText'))?.trim();

const capName = (c: ParsedComponent): { name?: string } => {
  const t = (c.texts.get('OffText') ?? c.texts.get('Label') ?? c.texts.get('On1Text'))
    ?.replace(/\s+/g, ' ').trim();
  return t ? { name: t } : {};
};

const isV19Box = (c: ParsedComponent): boolean =>
  hasLegend(c) && !hasPicture(c)
  && c.width > 0 && c.height > 0;

const isMaskShape = (c: ParsedComponent): boolean =>
  c.images.size > 0 && !hasPicture(c) && c.width > 0 && c.height > 0;

const boxFill = (c: ParsedComponent): number | undefined =>
  c.type === Type.Button ? val(c, 'OffColour') : val(c, 'OffImageColour');

export function backdropShapes(comps: ParsedComponent[]): ParsedComponent[] {
  return comps.filter((c) =>
    (c.type === Type.Lamp && c.number < 0 && !hasPicture(c)
      && boxFill(c) !== undefined && c.width > 0 && c.height > 0)
    || (c.type === Type.Lamp && isV19Box(c) && boxFill(c) !== undefined)
    || (c.type === Type.Button && isV19Box(c) && boxFill(c) !== undefined)
    || (c.type === Type.Lamp && isMaskShape(c) && c.values.has('OffImageColour'))
    || (c.type === Type.Lamp && c.number >= 0 && !hasPicture(c)
      && !c.values.get('Graphic') && c.width > 0 && c.height > 0
      && (hasLegend(c) || c.values.has('OffImageColour') || c.values.has('Sublamp1Colour'))));
}

function composeShapes(
  comps: ParsedComponent[], width: number, height: number, originX: number, originY: number,
): ImageData | null {
  const shapes = backdropShapes(comps);
  if (!shapes.length || width <= 0 || height <= 0) return null;

  const out = newImageData(width, height);
  for (const c of shapes) {
    const v19 = hasLegend(c);
    fillShape(out, c.x - originX, c.y - originY, c.width, c.height,
      boxFill(c)!, val(c, 'ShapeIndex') ?? 0,
      v19 ? 0xff000000 : c.type === Type.Lamp ? shapeOutline(c) : undefined, c.angle, shapeParams(c));
  }
  return out;
}

const MASK_KEYS = [
  'SublampMask1', 'SublampMask2', 'SublampMask3', 'SublampMask4',
  'SublampMask5', 'SublampMask6', 'BrightmaskMain',
];

const LIGHT_MASK_KEYS = [
  'SublampMask1', 'SublampMask2', 'SublampMask3', 'SublampMask4',
  'SublampMask5', 'SublampMask6', 'SublampMask7', 'SublampMask8',
  'SublampMask9', 'SublampMask10', 'SublampMask11', 'SublampMask12',
  'Mask1', 'Mask2',
];

const hasPicture = (c: ParsedComponent): boolean =>
  !isShapeLamp(c) && [...c.images.keys()].some((k) => !LIGHT_MASK_KEYS.includes(k));

const isShapeLamp = (c: ParsedComponent): boolean =>
  c.type === Type.Lamp && !c.values.get('Graphic');

function shapeOutline(c: ParsedComponent): number | undefined {
  if ((val(c, 'NoOutline') ?? 1) === 0 || c.values.get('Transparent')) return undefined;
  return val(c, 'OutlineColour') ?? 0xff000000;
}

function dropShapeLampPictures(comps: ParsedComponent[]): void {
  for (const c of comps) {
    if (!isShapeLamp(c)) continue;
    for (const k of [...c.images.keys()]) if (!LIGHT_MASK_KEYS.includes(k)) c.images.delete(k);
  }
}

function twoFrameFace(img: ImageData | null, w: number, h: number): ImageData | null {
  if (!img || w <= 0 || h <= 0) return img;
  if (img.width !== w * 2 || img.height !== h) return img;
  const out = newImageData(w, h);
  const s = img.data, d = out.data;
  for (let y = 0; y < h; y++) {
    const si = y * img.width * 4, di = y * w * 4;
    d.set(s.subarray(si, si + w * 4), di);
  }
  return out;
}

function pressedFace(img: ImageData | null, w: number, h: number): ImageData | null {
  if (!img || w <= 0 || h <= 0) return null;
  if (img.width !== w * 2 || img.height !== h) return null;
  const out = newImageData(w, h);
  const s = img.data, d = out.data;
  for (let y = 0; y < h; y++) {
    const si = (y * img.width + w) * 4, di = y * w * 4;
    d.set(s.subarray(si, si + w * 4), di);
  }
  return out;
}

function fitToRect(
  img: ImageData | null, w: number, h: number, twoFrame = true,
): ImageData | null {
  if (twoFrame) img = twoFrameFace(img, w, h);
  if (!img || w <= 0 || h <= 0 || (img.width === w && img.height === h)) return img;
  const out = newImageData(w, h);
  const s = img.data, d = out.data;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / w));
      const si = (sy * img.width + sx) * 4, di = (y * w + x) * 4;
      d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = s[si + 3];
    }
  }
  return out;
}

function multiplyBy(dst: ImageData, mask: ImageData): void {
  const d = dst.data, s = mask.data;
  const n = Math.min(d.length, s.length);
  for (let i = 0; i < n; i += 4) {
    const m = (s[i] * 299 + s[i + 1] * 587 + s[i + 2] * 114) / 255000;
    d[i] = Math.round(d[i] * m);
    d[i + 1] = Math.round(d[i + 1] * m);
    d[i + 2] = Math.round(d[i + 2] * m);
  }
}

function alphaByMask(dst: ImageData, mask: ImageData): void {
  const d = dst.data, s = mask.data;
  const n = Math.min(d.length, s.length);
  for (let i = 0; i < n; i += 4) {
    if (d[i + 3] === 0) continue;
    d[i + 3] = (s[i] * 61 + s[i + 1] * 174 + s[i + 2] * 21) >> 8;
  }
}

function multiplyByMask(dst: ImageData, mask: ImageData): void {
  const d = dst.data, s = mask.data;
  const n = Math.min(d.length, s.length);
  for (let i = 0; i < n; i += 4) {
    if (s[i + 3] === 0 || d[i + 3] === 0) continue;
    d[i] = (d[i] * s[i]) >> 8;
    d[i + 1] = (d[i + 1] * s[i + 1]) >> 8;
    d[i + 2] = (d[i + 2] * s[i + 2]) >> 8;
    d[i + 3] = (d[i + 3] * s[i + 3]) >> 8;
  }
}

function tintPool(mask: ImageData | null, argb: number): ImageData | null {
  if (!mask) return null;
  const r = (argb >>> 16) & 0xff, g = (argb >>> 8) & 0xff, b = argb & 0xff;
  const out = newImageData(mask.width, mask.height);
  const s = mask.data, d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const lum = (s[i] * 299 + s[i + 1] * 587 + s[i + 2] * 114) / 1000;
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
    d[i + 3] = Math.round(lum * (s[i + 3] / 255));
  }
  return out;
}

export function keyOutColour(img: ImageData, argb: number): void {
  const r = (argb >>> 16) & 0xff, g = (argb >>> 8) & 0xff, b = argb & 0xff;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] === r && d[i + 1] === g && d[i + 2] === b) d[i + 3] = 0;
  }
}

export function isFmlLayout(payload: Uint8Array): boolean {
  if (payload.length < 16) return false;
  const n = Math.min(payload.length - 4, 8192);
  for (let i = 0; i < n; i++) {
    if (payload[i] === 0x54 && payload[i + 1] === 0x50 && payload[i + 2] === 0x46 && payload[i + 3] === 0x30) {
      return false;
    }
  }
  return true;
}

type LampKey = false | 'alpha' | 'alphaonly';

function image(
  c: ParsedComponent, purpose: string, chroma: boolean | LampKey = false, alpha = false,
): ImageData | null {
  const bin = c.images.get(purpose);
  return bin ? bmpToImageData(c.value, bin.off, bin.len, chroma, alpha) : null;
}

function scanBitmaps(c: ParsedComponent): { off: number; len: number }[] {
  const d = c.value;
  const out: { off: number; len: number }[] = [];
  for (let i = 0; i + 6 < d.length; i++) {
    if (d[i] !== 0x42 || d[i + 1] !== 0x4d) continue;
    const size = u32(d, i + 2);
    if (size >= 26 && i + size <= d.length) { out.push({ off: i, len: size }); i += size - 1; }
  }
  return out;
}

function largestImage(c: ParsedComponent, chroma: boolean | LampKey = false): ImageData | null {
  let best: { off: number; len: number } | null = null;
  for (const b of scanBitmaps(c)) if (!best || b.len > best.len) best = b;
  return best ? bmpToImageData(c.value, best.off, best.len, chroma) : null;
}

function firstImage(c: ParsedComponent, chroma: boolean | LampKey = false): ImageData | null {
  const b = scanBitmaps(c)[0];
  return b ? bmpToImageData(c.value, b.off, b.len, chroma) : null;
}

const i32b = (d: Uint8Array, o: number): number => u32(d, o) | 0;

function passRankOfType(type: number): number {
  switch (type) {
    case Type.Reel: case Type.Disc: case Type.Anim: case 0x2d: return 1;
    case Type.Lamp: case Type.Button: case Type.Led: case 0x09: case 0x0a: case 0x14: return 2;
    case Type.SevenSeg: return 3;
    case 0x07: case 0x0c: case 0x0d: case 0x10: case 0x11: case 0x13: case 0x16: case 0x19:
    case 0x0f: case 0x1a: case 0x1f: case 0x22: case 0x29: case 0x2e: return 4;
    default: return -1;
  }
}
const BITMAP_PASSES: BitmapPass[] = ['back', 'reels', 'lamps', 'digits', 'top'];

export function buildBitmaps(
  comps: ParsedComponent[], backdrop: ParsedComponent | null,
): CabBitmap<ImageData>[] {
  const ledIndex = new Map<ParsedComponent, number>();
  comps.filter((c) => c.type === Type.RgbLed && c.width > 0 && c.height > 0)
    .forEach((c, k) => ledIndex.set(c, k));
  const overlaps = (a: ParsedComponent, b: ParsedComponent): boolean =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const claimed = new Set<number>();
  const rankOf = new Map<ParsedComponent, number>();
  const out: CabBitmap<ImageData>[] = [];
  comps.forEach((c, i) => {
    if (c.type !== TypeBitmap || c === backdrop || c.width <= 0 || c.height <= 0) return;
    const transparent = (val(c, 'Transparent') ?? 0) !== 0;
    const img = image(c, 'Image', false, transparent);
    const overlay = image(c, 'Overlay', false, true);
    if (!img && !overlay) return;
    let rank = 0;
    const leds: number[] = [];
    for (let j = 0; j < i; j++) {
      const o = comps[j];
      if (o.width <= 0 || o.height <= 0 || !overlaps(c, o)) continue;
      const k = ledIndex.get(o);
      if (k !== undefined) { if (!claimed.has(k)) leds.push(k); continue; }
      if (o.type === TypeBitmap) { rank = Math.max(rank, rankOf.get(o) ?? 0); continue; }
      rank = Math.max(rank, passRankOfType(o.type));
    }
    if (leds.length && rank > 0) { rank = BITMAP_PASSES.length - 1; leds.length = 0; }
    for (const k of leds) claimed.add(k);
    rankOf.set(c, rank);
    out.push({
      left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
      image: img, overlay, stretch: val(c, 'StretchMode') ?? 2,
      pass: BITMAP_PASSES[rank],
      ...(leds.length ? { ledsBelow: leds } : {}),
    });
  });
  return out;
}

function bandByShape(c: ParsedComponent): { off: number; len: number } | null {
  let best: { off: number; len: number; h: number } | null = null;
  for (const b of scanBitmaps(c)) {
    const w = i32b(c.value, b.off + 18);
    const h = Math.abs(i32b(c.value, b.off + 22));
    if (w <= 0 || h <= 0) continue;
    const widthOk = c.width === 0 || (w >= c.width * 0.6 && w <= c.width * 1.6);
    const tall = h >= Math.max(c.height * 2, w * 2);
    if (widthOk && tall && (!best || h > best.h)) best = { ...b, h };
  }
  return best;
}

function rotateCw(src: ImageData): ImageData {
  const { width: w, height: h } = src;
  const out = newImageData(h, w);
  const s = src.data;
  const d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = (x * h + (h - 1 - y)) * 4;
      d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = s[si + 3];
    }
  }
  return out;
}

function bandOrient(canvas: ImageData, horizontal: boolean):
{ canvas: ImageData; stripHorizontal: boolean } {
  const wide = canvas.width > canvas.height;
  if (wide && !horizontal) return { canvas: rotateCw(canvas), stripHorizontal: false };
  return { canvas, stripHorizontal: wide && horizontal };
}

function reelBand(c: ParsedComponent, horizontal: boolean):
{ canvas: ImageData; stops: number; bg?: string; stripHorizontal: boolean; artCells?: number } | null {
  const best = c.images.get('Band') ?? bandByShape(c);
  if (!best) return null;
  const raw = bmpToImageData(c.value, best.off, best.len);
  if (!raw) return null;
  const stops = val(c, 'Stops') || 16;
  const { canvas, stripHorizontal } = bandOrient(raw, horizontal);
  const cellW = stripHorizontal ? canvas.width / stops : canvas.width;
  const cellH = stripHorizontal ? canvas.height : canvas.height / stops;
  const midX = Math.floor(cellW / 2);
  const midY = Math.floor(cellH / 2);
  const boundX = Math.min(canvas.width - 1, Math.round(cellW));
  const boundY = Math.min(canvas.height - 1, Math.round(cellH));
  const p = canvas.data;
  const points: number[][] = stripHorizontal
    ? [[midX, 1], [midX, canvas.height - 2],
      [boundX, 1], [boundX, canvas.height - 2], [boundX, Math.floor(canvas.height / 2)]]
    : [[1, midY], [canvas.width - 2, midY],
      [1, boundY], [canvas.width - 2, boundY], [Math.floor(canvas.width / 2), boundY]];
  const samples = points.map(([x, y]) => {
    const o = (y * canvas.width + x) * 4;
    return [p[o], p[o + 1], p[o + 2]];
  });
  samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const m = samples[2];
  const artCells = stripHorizontal ? undefined : bandArtCells(canvas, stops);
  return {
    canvas, stops, bg: `rgb(${m[0]},${m[1]},${m[2]})`, stripHorizontal,
    ...(artCells !== undefined ? { artCells } : {}),
  };
}

const FLIP_REEL = 0x2d;

export function reelIndexMap(comps: readonly ParsedComponent[]): Map<number, number> {
  const map = new Map<number, number>();
  const nums = comps
    .filter((c) => c.type === Type.Reel || c.type === Type.Disc || c.type === Type.Anim
      || c.type === FLIP_REEL)
    .map((c) => c.number)
    .sort((a, b) => a - b);
  nums.forEach((n, i) => { if (!map.has(n)) map.set(n, i); });
  return map;
}

function usefulMask(img: ImageData | null): ImageData | undefined {
  if (!img) return undefined;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i] < 250) return img;
  }
  return undefined;
}

function inputId(c: ParsedComponent): number | undefined {
  return c.values.get('ButtonNumber');
}

function sublampSlots(c: ParsedComponent): { slot: number; n: number }[] {
  const out: { slot: number; n: number }[] = [];
  (c.subs ?? []).forEach((n, i) => { if (n >= 0) out.push({ slot: i + 1, n }); });
  if (!out.length && c.number >= 0) out.push({ slot: 1, n: c.number });
  return out;
}

const LIT_DEFAULT = 0xffffff00;

function sublampStates(
  c: ParsedComponent, slots: { slot: number; n: number }[], fallback: ImageData,
  keyed: LampKey, maskOnly: boolean, echoed: Set<number>,
  fallbackDown: ImageData | null = null,
): { n: number; canvas: ImageData; down?: ImageData }[] {
  const states: { n: number; canvas: ImageData; down?: ImageData }[] = [];
  const downOf = (img: ImageData | null): ImageData | null =>
    pressedFace(img, c.width, c.height);
  const withDown = (
    canvas: ImageData, down: ImageData | null,
  ): { canvas: ImageData; down?: ImageData } => (down ? { canvas, down } : { canvas });
  const fit = (img: ImageData | null): ImageData | null => fitToRect(img, c.width, c.height);
  const fitMask = (img: ImageData | null): ImageData | null =>
    fitToRect(img, c.width, c.height, false);
  const maskFor = (slot: number): ImageData | null =>
    (maskOnly ? null : fitMask(image(c, `SublampMask${slot}`, false)));
  const blend = !!val(c, 'Blend');
  const masked = (face: ImageData | null, mask: ImageData | null): ImageData | null => {
    if (!face || !mask) return face;
    if (face.width !== mask.width || face.height !== mask.height) return face;
    const out = newImageData(face.width, face.height);
    out.data.set(face.data);
    if (blend) alphaByMask(out, mask); else multiplyByMask(out, mask);
    return out;
  };
  const additive = blend;
  let lastPictured: ImageData | null = null;
  let lastDown: ImageData | null = null;
  for (const { slot, n } of slots) {
    const raw = states.length === 0 || maskOnly ? null : image(c, `Sublamp${slot}`, keyed);
    const own = states.length === 0 ? fallback
      : maskOnly
        ? tintPool(image(c, `SublampMask${slot}`, false) ?? firstImage(c, false),
          val(c, `Sublamp${slot}Colour`) ?? LIT_DEFAULT)
        : fit(raw);
    const canvas = own ?? (additive || !echoed.has(n) ? lastPictured : null);
    if (!own && !additive && echoed.has(n)) {
      console.warn(`[layout] component ${c.number} at (${c.x},${c.y}): sublamp`
        + ` slot ${slot} has no picture and its lamp ${n} already lights one on`
        + ` another component, so the slot stays dark. If this cabinet really`
        + ` wires that output to two bulbs, give the slot its own picture.`);
    }
    const ownDown = states.length === 0 ? fallbackDown : downOf(raw);
    const down = ownDown ?? (own ? null : lastDown);
    if (own) { lastPictured = own; lastDown = ownDown; }
    if (canvas) {
      const mask = maskFor(slot);
      states.push({ n, ...withDown(masked(canvas, mask)!, masked(down, mask)) });
    }
  }
  return states.length ? states
    : [{ n: slots[0]?.n ?? c.number, ...withDown(fallback, fallbackDown) }];
}

function tokenAcceptor(c: ParsedComponent): boolean | undefined {
  const effect = c.values.get('EffectId') ?? acceptorIds(c.values).effect;
  if (effect === undefined) return undefined;
  return effect === 0x2 || effect === 0x4 || effect === 0x8;
}

function acceptorEffect(c: ParsedComponent): { effect?: number } {
  const { effect } = acceptorIds(c.values);
  return effect ? { effect } : {};
}

export function parseFmlLayout(payload: Uint8Array): Cabinet<ImageData> | null {
  const comps = parseLayout(payload);
  if (!comps.length) return null;
  dropShapeLampPictures(comps);
  const literalOffsetSign = (mfmeMajor(payload) ?? Infinity) < 6;

  let background: ImageData | null = null;
  let backgroundRect: Rect = { left: 0, top: 0, width: 0, height: 0 };
  let backgroundColour: number | null = null;
  let backgroundKey: number | null = null;
  let backgroundOffset = { x: 0, y: 0 };
  let backdrop: ImageData | null = null;
  const bg = comps.find((c) => c.type === Type.Background);
  if (bg) {
    const useAlpha = !!bg.values.get('TransparencyUseAlpha');
    background = image(bg, 'Background', false, useAlpha) ?? largestImage(bg);
    const useColour = !!bg.values.get('TransparencyUseColour');
    const key = bg.values.get('TransparentColour');
    if (background && useColour && key != null) {
      keyOutColour(background, key);
      backgroundKey = key;
    }
    backdrop = image(bg, 'Tile');
    backgroundRect = { left: bg.x, top: bg.y, width: bg.width, height: bg.height };
    backgroundColour = val(bg, 'Colour') ?? null;
    if (useColour || useAlpha) backgroundColour = (val(bg, 'BorderColour') ?? 0xff000000) >>> 0;
    backgroundOffset = {
      x: bg.values.get('OffsetX') ?? 0,
      y: bg.values.get('OffsetY') ?? 0,
    };
  }
  let backdropBitmap: ParsedComponent | null = null;
  if (!background) {
    let bestArea = 0;
    for (const c of comps) {
      if (c.type !== TypeBitmap || c.width < 400 || c.height < 400) continue;
      if (c.width * c.height <= bestArea) continue;
      const img = image(c, 'Image') ?? largestImage(c);
      if (img) {
        background = img;
        backgroundRect = { left: c.x, top: c.y, width: c.width, height: c.height };
        backdropBitmap = c;
        bestArea = c.width * c.height;
      }
    }
  }

  const legends: CabLamp<ImageData>[] = [];
  for (const c of comps) {
    const isLabelComp = c.type === 0x0a;
    if (c.type !== Type.Lamp && c.type !== Type.Button && !isLabelComp) continue;
    const off = (c.texts.get('OffText') ?? c.texts.get('Label'))?.trim();
    const on = c.texts.get('On1Text')?.trim();
    const fill = isLabelComp && !val(c, 'Transparent') ? val(c, 'BackgroundColour') : undefined;
    if (!off && !on && fill === undefined) continue;
    if (c.width <= 0 || c.height <= 0) continue;
    const colour = c.values.get('FontColour') ?? 0xff000000;
    legends.push({
      left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
      states: [],
      legend: {
        off: off || undefined,
        on: on || undefined,
        colour,
        ...(fill !== undefined ? { fill } : {}),
        face: c.texts.get('FontFace') ?? 'sans-serif',
        dx: val(c, 'XOffset') || undefined,
        dy: val(c, 'YOffset') || undefined,
        points: c.values.get('FontSize'),
        style: c.values.get('FontStyle'),
        lamp: c.number,
        ...(inputId(c) !== undefined ? { input: inputId(c) } : {}),
      },
    });
  }

  const photographed = !!background;
  if (!background) {
    const composed = composeShapes(
      comps, backgroundRect.width, backgroundRect.height, backgroundRect.left, backgroundRect.top,
    );
    if (composed) background = composed;
  }

  const reels: ReelBand<ImageData>[] = [];
  const reelIndex = reelIndexMap(comps);
  for (const c of comps) {
    if (c.type !== Type.Reel) continue;
    const horizontal = c.orientation === 1;
    const band = reelBand(c, horizontal);
    if (!band) continue;
    const reelHeight = c.values.get('ReelHeight') || c.height;
    const lampNums = [1, 2, 3].map((i) => c.subs?.[i] ?? -2);
    const masksRaw = [image(c, 'LampMasks1'), image(c, 'LampMasks2'), image(c, 'LampMasks3')];
    const mask = usefulMask(masksRaw[0]);
    const lightFloor = reelLightFloor(
      c.values.get('SelectedOffColourId') ?? c.defaults.get('SelectedOffColourId') ?? 0,
      c.values.get('OffLevel') ?? c.defaults.get('OffLevel') ?? 0x40,
      masksRaw,
    );
    const opaqueBand = !!c.values.get('OpaqueBand');
    const lightAlpha = opaqueBand ? applyOpaqueBand(band.canvas, lightFloor) : undefined;
    reels.push({
      left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c), canvas: band.canvas,
      stops: band.stops, rheight: reelHeight, reversed: !!c.values.get('Reversed'),
      horizontal,
      stripHorizontal: band.stripHorizontal,
      darkness: 0, lampNums, machineIndex: reelIndex.get(c.number) ?? 0, number: c.number,
      lampTray: Array.from({ length: 15 }, (_, i) => c.subs?.[i] ?? -2),
      lampsEnabled: !!(c.values.get('LampsEnabled') ?? c.defaults.get('LampsEnabled')),
      lightFloor,
      ...(lightAlpha !== undefined ? { lightAlpha } : {}),
      mask2: usefulMask(masksRaw[1]),
      mask3: usefulMask(masksRaw[2]),
      bandOffset: val(c, 'BandOffset') ?? 0,
      ...winlinesOffsetOf(c, band.stops),
      ...(band.artCells !== undefined ? { artCells: band.artCells } : {}),
      literalOffsetSign,
      widthDiff: Math.max(0, c.values.get('WidthDiff') ?? 0),
      fillColour: cssArgb(c.values.get('BackgroundFillColour') ?? 0xff000000),
      winLines: {
        count: c.values.get('NumberOfWinlines') ?? c.defaults.get('NumberOfWinlines') ?? 1,
        thickness: c.values.get('WinlinesThickness') ?? c.defaults.get('WinlinesThickness') ?? 1,
        colour: cssArgb(c.values.get('WinlinesColour') ?? 0xff000000),
        number: c.number,
      },
      ...fmlReelBorder(c),
      overlay: image(c, 'Overlay', false, true) ?? undefined,
      bg: band.bg,
      mask,
      gradient: usefulMask(image(c, 'Gradient')),
    });
  }

  for (const c of comps) {
    if (c.type !== Type.Disc) continue;
    const face = image(c, 'Band', false, true);
    if (!face) continue;
    const num = (k: string): number | undefined => c.values.get(k) ?? c.defaults.get(k);
    const lampCount = num('NumberOfLamps') ?? num('Stops') ?? 12;
    const outerMask = image(c, 'OuterMask1', false, false);
    const innerMask = image(c, 'InnerMask1', false, false);
    const floor: [number, number, number] | null = outerMask
      ? [outerMask.data[0], outerMask.data[1], outerMask.data[2]] : null;
    const lamps: DiscLamps = {
      count: lampCount,
      offsetDeg: num('LampPositionsOffset') ?? 0,
      enabled: (num('LampsEnabled') ?? 1) !== 0,
      outerH: num('OuterH') ?? 0, outerL: num('OuterL') ?? 0,
      outerSize: num('OuterLampSize') ?? 0x35,
      innerH: num('InnerH') ?? 0, innerL: num('InnerL') ?? 0,
      innerSize: num('InnerLampSize') ?? 0x35,
      floor,
    };
    const lampNums = Array.from(
      { length: discLampSlotCount(lampCount) }, (_, i) => c.subs?.[i] ?? -2,
    );
    const overlayRaw = image(c, 'DiscOverlay', false, true) ?? undefined;
    let punch: ImageData | undefined;
    if (overlayRaw) {
      const d = overlayRaw.data;
      let any = false;
      const pd = new Uint8ClampedArray(d.length);
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 255 && d[i] === 0xc9 && d[i + 1] === 0xb1 && d[i + 2] === 0xd3) {
          pd[i] = 0xc9; pd[i + 1] = 0xb1; pd[i + 2] = 0xd3; pd[i + 3] = 255;
          d[i + 3] = 0;
          any = true;
        }
      }
      if (any) { punch = newImageData(overlayRaw.width, overlayRaw.height); punch.data.set(pd); }
    }
    reels.push({
      left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c), canvas: face,
      stops: num('Stops') ?? 12,
      rheight: c.height,
      reversed: false,
      darkness: 0, lampNums, machineIndex: reelIndex.get(c.number) ?? 0, number: c.number,
      overlay: overlayRaw,
      disc: {
        steps: num('HalfSteps') ?? 96, offsetDeg: num('BandOffset') ?? 0,
        reversed: !!c.values.get('Reversed'), lamps,
      },
      discMask: outerMask ?? undefined,
      discInnerMask: innerMask ?? undefined,
      discPunch: punch,
      discBaseOverlay: image(c, 'Overlay', false, true) ?? undefined,
    });
  }
  reels.sort((a, b) => a.left - b.left);

  const lamps: CabLamp<ImageData>[] = [];
  const coinLamps = comps.filter((c) => c.type === Type.Lamp && c.values.get('CoinSelected'));
  coinLamps.sort((a, b) => (b.values.get('CoinId') ?? 0) - (a.values.get('CoinId') ?? 0));
  const picturedOwners = new Map<number, ParsedComponent[]>();
  const backdropShapeSet = new Set(backdropShapes(comps));
  const isUnwiredBox = (c: ParsedComponent): boolean =>
    photographed && c.type === Type.Lamp && !sublampSlots(c).length && c.images.size === 0
      && isShapeLamp(c) && c.values.has('OffImageColour') && backdropShapeSet.has(c);
  for (const c of comps) {
    if (c.type !== Type.Lamp) continue;
    const slots = sublampSlots(c);
    for (const { slot, n } of slots) {
      if (c.images.has(`Sublamp${slot}`)
        || (slot === slots[0].slot && hasPicture(c))) {
        const owners = picturedOwners.get(n) ?? [];
        owners.push(c);
        picturedOwners.set(n, owners);
      }
    }
  }
  const reelWindows = comps.map((c, i) => ({ c, i }))
    .filter(({ c }) => c.type === Type.Reel || c.type === Type.Disc || c.type === Type.Anim);
  const streamIndex = new Map(comps.map((c, i) => [c, i] as const));
  const behindAReel = (c: ParsedComponent): boolean => {
    const ci = streamIndex.get(c) ?? -1;
    return reelWindows.some(({ c: r, i }) => ci < i
      && c.x < r.x + r.width && r.x < c.x + c.width && c.y < r.y + r.height && r.y < c.y + c.height);
  };
  for (const c of comps) {
    if (c.type !== Type.Lamp) continue;
    if (!sublampSlots(c).length && !c.values.get('CoinSelected') && !isUnwiredBox(c)) continue;
    const keyed: LampKey = c.values.get('Transparent') ? 'alpha'
      : c.values.get('Graphic') ? 'alphaonly' : false;
    const offRaw = image(c, 'OffImage', keyed);
    const off = fitToRect(offRaw, c.width, c.height);
    const maskOnly = !c.images.has('Sublamp1') && MASK_KEYS.some((k) => c.images.has(k));
    const lightMaskOnly = c.images.size > 0 && !hasPicture(c);
    const slots = sublampSlots(c);
    const nums = slots.map((s) => s.n);
    const pool = maskOnly && !lightMaskOnly
      ? tintPool(firstImage(c, false),
        val(c, `Sublamp${slots[0]?.slot ?? 1}Colour`) ?? LIT_DEFAULT) : null;
    const onRaw = pool ? null
      : image(c, 'Sublamp1', keyed)
        ?? (off || maskOnly || isShapeLamp(c) ? null : firstImage(c, keyed));
    const on = pool ?? fitToRect(onRaw, c.width, c.height);
    const btn = inputId(c);
    const acceptor = c.values.get('CoinSelected')
      ? {
        ...(coinLine(c) !== undefined ? { line: coinLine(c) } : {}),
        ...(coinNote(c) !== undefined ? { note: coinNote(c) } : {}),
        ...((tokenAcceptor(c) ?? (coinLine(c) === undefined && c !== coinLamps[0])) ? { token: true } : {}),
        ...acceptorEffect(c),
      }
      : undefined;
    const brightRaw = !off && nums.length > 0 ? image(c, 'BrightmaskMain', keyed) : null;
    const brightOff = fitToRect(brightRaw, c.width, c.height);
    const pressable = !!c.values.get('#17');
    const onDown = pressable ? pressedFace(onRaw, c.width, c.height) : null;
    const offDown = pressable ? pressedFace(offRaw, c.width, c.height) : null;
    const brightOffDown = pressable ? pressedFace(brightRaw, c.width, c.height) : null;
    const bareGraphic = !on && !off && !brightOff && !c.values.has('Sublamp1Colour')
      && nums.length > 0 && !!c.values.get('Graphic');

    const colourFace = !on && !off && !brightOff && nums.length > 0
      && (c.values.has('Sublamp1Colour')
        || (c.images.size === 0 && !hasLegend(c) && !c.values.get('Graphic')
          && c.values.has('OffImageColour')))
      && c.width > 0 && c.height > 0;
    let colourStates: { n: number; canvas: ImageData }[] = [];
    if (colourFace) {
      const shape = val(c, 'ShapeIndex') ?? 0;
      for (const { slot, n } of (slots.length ? slots : nums.map((n2) => ({ slot: 1, n: n2 })))) {
        const argb = c.values.get(`Sublamp${slot}Colour`)
          ?? c.values.get('Sublamp1Colour') ?? val(c, `Sublamp${slot}Colour`);
        if (argb === undefined) continue;
        const face = newImageData(c.width, c.height);
        fillShape(face, 0, 0, c.width, c.height, argb, shape, shapeOutline(c), 0, shapeParams(c));
        colourStates.push({ n, canvas: face });
      }
    }
    const unwiredBox = isUnwiredBox(c);
    const darkFace = (colourFace || unwiredBox) && photographed && backdropShapeSet.has(c)
      ? (() => {
        const face = newImageData(c.width, c.height);
        fillShape(face, 0, 0, c.width, c.height, boxFill(c)!, val(c, 'ShapeIndex') ?? 0,
          shapeOutline(c), 0, shapeParams(c));
        return face;
      })()
      : null;

    if (!on && !off && !brightOff && btn === undefined && !acceptor && !bareGraphic
      && !colourFace && !unwiredBox) continue;
    const echoes = new Set(slots.filter(({ n }) =>
      (picturedOwners.get(n) ?? []).some((o) => o !== c)).map(({ n }) => n));
    lamps.push({
      left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
      states: on
        ? sublampStates(c, slots, on, keyed, maskOnly, echoes, onDown)
        : colourStates,
      ...(btn !== undefined ? { button: btn } : {}),
      ...(acceptor ? { acceptor } : {}),
      ...(behindAReel(c) ? { underReel: true } : {}),
      offState: off ? { nums, canvas: off, ...(offDown ? { down: offDown } : {}) }
        : brightOff
          ? { nums, canvas: brightOff, ...(brightOffDown ? { down: brightOffDown } : {}) }
          : darkFace ? { nums, canvas: darkFace } : undefined,
      ...(c.values.get('LED') ? { led: true } : {}),
      offDim: bareGraphic ? { nums, alpha: 0.5 } : undefined,
      blend: pool ? true : undefined,
      multi: val(c, 'Blend') ? true : undefined,
      ...inputGates(c, acceptor ? nums.filter((n) => n >= 0) : []),
      ...(btn ? { cap: true, ...capName(c) } : {}),
    });
  }

  for (const c of comps) {
    if (c.type !== Type.Lamp || c.number >= 0) continue;
    if ((c.subs ?? []).some((n) => n >= 0) || !hasPicture(c) || c.width <= 0 || c.height <= 0) continue;
    const keyed: LampKey = c.values.get('Transparent') ? 'alpha' : false;
    const art = fitToRect(
      image(c, 'OffImage', keyed) ?? image(c, 'BrightmaskMain', keyed) ?? image(c, 'Sublamp1', keyed),
      c.width, c.height,
    );
    if (!art) continue;
    lamps.push({
      left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
      states: [],
      offState: { nums: [], canvas: art },
    });
  }

  const zOrder = backdropShapes(comps);
  for (const c of comps) {
    if (c.type !== Type.Lamp || hasPicture(c)) continue;
    if (!hasLegend(c) && !isMaskShape(c)) continue;
    const slots = sublampSlots(c);
    if (!slots.length || c.width <= 0 || c.height <= 0) continue;
    const shape = c.values.get('ShapeIndex') ?? 0;
    const cookie = (slot: number): ImageData | null =>
      fitToRect(image(c, `SublampMask${slot}`) ?? image(c, 'SublampMask1'),
        c.width, c.height, false);
    const zi = zOrder.indexOf(c);
    const over = zi < 0 ? [] : zOrder.slice(zi + 1).filter((o) =>
      o.x < c.x + c.width && c.x < o.x + o.width && o.y < c.y + c.height && c.y < o.y + o.height);
    const litOutline = (val(c, 'NoOutline') ?? 1) === 0
      ? undefined : val(c, 'OutlineColour') ?? 0xff000000;
    const fills = new Map<string, ImageData>();
    const states: { n: number; canvas: ImageData }[] = [];
    for (const { slot, n } of slots) {
      const litColour = val(c, `Sublamp${slot}Colour`);
      if (litColour === undefined) continue;
      const mask = cookie(slot);
      const key = `${litColour}|${mask ? slot : ''}`;
      let lit = fills.get(key);
      if (!lit) {
        lit = newImageData(c.width, c.height);
        fillShape(lit, 0, 0, c.width, c.height, litColour, shape, litOutline, 0, shapeParams(c));
        if (mask) multiplyBy(lit, mask);
        for (const o of over) {
          const ca = turn(c).angle ?? 0;
          let ox = o.x - c.x, oy = o.y - c.y;
          if (ca) {
            const r = (ca * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
            const dx = o.x + o.width / 2 - (c.x + c.width / 2);
            const dy = o.y + o.height / 2 - (c.y + c.height / 2);
            ox = c.width / 2 + dx * cs + dy * sn - o.width / 2;
            oy = c.height / 2 - dx * sn + dy * cs - o.height / 2;
          }
          fillShape(lit, ox, oy, o.width, o.height, boxFill(o)!,
            val(o, 'ShapeIndex') ?? 0,
            hasLegend(o) ? val(o, 'OutlineColour') ?? 0xff000000 : undefined, o.angle - ca,
            shapeParams(o));
        }
        fills.set(key, lit);
      }
      states.push({ n, canvas: lit });
    }
    if (!states.length) continue;
    lamps.push({
      left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
      states,
    });
  }

  const bandReels: BandStrip<ImageData>[] = [];
  for (const c of comps) {
    if (c.type !== Type.Anim) continue;
    const strip = image(c, 'Band');
    if (strip && strip.width > 0 && strip.height > 0) {
      const num = (k: string): number | undefined => c.values.get(k) ?? c.defaults.get(k);
      const lampNums = (c.subs ?? []).filter((n) => n >= 0);
      bandReels.push({
        left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
        machineIndex: reelIndex.get(c.number) ?? 0, number: c.number,
        canvas: strip,
        overlay: image(c, 'Overlay', 'alpha') ?? undefined,
        stops: num('Stops') || 16,
        halfSteps: num('HalfSteps') || 320,
        view: num('View') || 5,
        spacing: num('Spacing') ?? 0,
        bandOffset: num('BandOffset') ?? 0,
        reversed: !!c.values.get('Reversed'),
        horizontal: (num('Orientation') ?? 1) !== 0,
        lampNums,
        darkness: lampNums.length ? 100 : 0,
        ...bandReelBorder(c, num),
      });
      continue;
    }
    const frames = ['Overlay'].map((k) => image(c, k, true));
    const states: { n: number; canvas: ImageData }[] = [];
    const subs = (c.subs ?? []).filter((_, i) => i % 2 === 0);
    for (let i = 0; i < subs.length; i++) {
      const img = frames[i];
      if (subs[i] >= 0 && img) states.push({ n: subs[i], canvas: img });
    }
    const resting = frames[0];
    lamps.push({
      left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
      states,
      offState: resting ? { nums: states.map((s) => s.n), canvas: resting } : undefined,
    });
  }

  const flipReels: FlipStrip<ImageData>[] = [];
  for (const c of comps) {
    if (c.type !== FLIP_REEL) continue;
    const flaps = image(c, 'Band');
    if (!flaps || flaps.width <= 0 || flaps.height <= 0) continue;
    const num = (k: string): number | undefined => c.values.get(k) ?? c.defaults.get(k);
    flipReels.push({
      left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
      machineIndex: reelIndex.get(c.number) ?? 0, number: c.number,
      canvas: flaps,
      overlay: image(c, 'Overlay', 'alpha') ?? undefined,
      stops: num('Stops') || 72,
      halfSteps: num('HalfSteps') || 432,
      offset: num('BandOffset') ?? 0,
      inset: num('FaceInset') ?? 4,
      borderWidth: num('BorderWidth') ?? 4,
      borderColour: num('BorderColour') ?? 0xff000000,
    });
  }

  for (const c of comps) {
    if (c.type !== Type.Button) continue;
    const btn = inputId(c) ?? (c.number > 0 ? c.number : undefined);
    const coin = c.values.get('CoinNoteId');
    if (btn === undefined && coin === undefined) continue;
    let on = fitToRect(
      image(c, 'Lamp1', true) ?? (hasPicture(c) ? firstImage(c, true) : null),
      c.width, c.height,
    );
    let onLamp = on && (c.subs?.[0] ?? -1) >= 0 ? c.subs![0] : -1;
    const lamp2 = on && (c.subs?.[1] ?? -1) >= 0
      ? fitToRect(image(c, 'Lamp2', true), c.width, c.height) : null;
    const offPic = on && hasPicture(c) ? fitToRect(image(c, 'Off', true), c.width, c.height) : null;
    if (!on && c.texts.has('Label')) {
      const lit = val(c, 'Lamp1Colour') ?? val(c, 'Lamp2Colour');
      const lampNo = c.subs?.find((n) => n >= 0) ?? -1;
      if (lit !== undefined && lampNo >= 0 && c.width > 0 && c.height > 0) {
        const img = newImageData(c.width, c.height);
        fillShape(img, 0, 0, c.width, c.height, lit, 0, 0xff000000);
        on = img;
        onLamp = lampNo;
      }
    }
    lamps.push({
      left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
      states: [
        ...(on ? [{ n: onLamp, canvas: on }] : []),
        ...(lamp2 ? [{ n: c.subs![1], canvas: lamp2 }] : []),
      ],
      ...(lamp2 ? { multi: true } : {}),
      ...(offPic ? { offState: { nums: [onLamp, ...(lamp2 ? [c.subs![1]] : [])].filter((n) => n >= 0), canvas: offPic } } : {}),
      ...(btn !== undefined ? { button: btn } : {}),
      ...inputGates(c, coin !== undefined && coin >= 0 ? (c.subs ?? []).filter((n) => n >= 0) : []),
      cap: true,
      ...capName(c),
      ...(coin !== undefined && coin >= 0
        ? {
          acceptor: {
            ...(coinLine(c) !== undefined ? { line: coinLine(c) } : {}),
            ...(coinNote(c) !== undefined ? { note: coinNote(c) } : {}),
            ...(tokenAcceptor(c) ? { token: true } : {}),
            ...acceptorEffect(c),
          },
        }
        : {}),
    });
  }

  const ledW = (background ? background.width + backgroundOffset.x : 0) || backgroundRect.width || 0;
  const ledH = (background ? background.height + backgroundOffset.y : 0) || backgroundRect.height || 0;
  for (const c of comps) {
    if (c.type !== Type.Led || c.width <= 0 || c.height <= 0) continue;
    if (c.x >= ledW || c.y >= ledH || c.x + c.width <= 0 || c.y + c.height <= 0) continue;
    const seg = (val(c, 'SelectedSegmentIndex') ?? -1) | 0;
    const lampNo = (val(c, '#39') ?? -2) | 0;
    const viaLed = !!c.values.get('Led');
    const style = { round: (val(c, 'SelectedStyleIndex') ?? 0) === 0,
      noOutline: !!c.values.get('NoOutline'), noShadow: !!c.values.get('NoShadow') };
    const onColour = (val(c, 'OnColour') ?? 0xffff0000) >>> 0;
    const offColour = (val(c, 'OffColour') ?? 0xff800000) >>> 0;
    const n = seg >= 0 ? -1 : lampNo;
    if (seg < 0 && lampNo < 0) {
      lamps.push({
        left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
        states: [], offState: { nums: [], canvas: ledFace(c.width, c.height, offColour, style) },
      });
      continue;
    }
    lamps.push({
      left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
      states: [{ n, canvas: ledFace(c.width, c.height, onColour, style) }],
      offState: { nums: [n], canvas: ledFace(c.width, c.height, offColour, style) },
      offUnder: true,
      ...(seg >= 0 ? { digitSeg: { digit: c.number, seg } } : viaLed ? { led: true } : {}),
    });
  }

  const signed32 = (v: number): number => v | 0;
  const segDisplays = comps
    .filter((c) => c.type === Type.SevenSeg && c.width > 0 && c.height > 0)
    .map((c) => {
      const seg = (c.subs ?? []).slice(0, 8);
      return {
        left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
        seg,
        digit: seg.some((n) => n >= 0) || c.number < 0 ? undefined : c.number,
        on: val(c, 'OnColour') ?? 0xffff0000,
        off: val(c, 'OffColour') ?? 0xff303030,
        bg: val(c, 'BgColour') ?? 0xff000000,
        dpRight: (val(c, 'DPRight') ?? 1) !== 0,
        dpOn: (val(c, 'DPOn') ?? 0) !== 0,
        ...((val(c, 'AutoDP') ?? 0) !== 0 ? { autoDp: true } : {}),
        ...((val(c, 'DPOff') ?? 0) !== 0 ? { dpOff: true } : {}),
        metrics: {
          thickness: val(c, 'Thickness') ?? SEG_METRICS.thickness,
          space: val(c, 'Spacing') ?? SEG_METRICS.space,
          hSpace: val(c, 'HSpacing') ?? SEG_METRICS.hSpace,
          vSpace: val(c, 'VSpacing') ?? SEG_METRICS.vSpace,
          chop: val(c, 'Chop') ?? SEG_METRICS.chop,
          centre: val(c, 'Centre') ?? SEG_METRICS.centre,
          slant: signed32(val(c, 'Slant') ?? SEG_METRICS.slant),
          offset: signed32(val(c, 'Offset') ?? SEG_METRICS.offset),
          digitAngle: signed32(val(c, 'DigitAngle') ?? SEG_METRICS.digitAngle),
          style: val(c, 'StyleId') ?? SEG_METRICS.style,
          seg16: (val(c, 'Segment16') ?? 0) !== 0,
          alpha: (val(c, 'Alpha') ?? 0) !== 0,
        },
      };
    });

  const matrix = comps.find((c) => c.type === Type.AceMatrix && c.width > 0 && c.height > 0);
  let dotMatrix: DotMatrix | null = null;
  if (matrix) {
    const pitch = Math.max(1, val(matrix, 'Size') ?? 7);
    dotMatrix = {
      left: matrix.x, top: matrix.y, width: matrix.width, height: matrix.height, ...turn(matrix),
      cols: Math.max(0, Math.round((matrix.width - 2) / pitch)),
      rows: Math.max(0, Math.round((matrix.height - 2) / pitch)),
      pitch,
      dot: Math.max(1, pitch - (pitch < 5 ? 1 : 2)),
      stride: 8,
      lsbFirst: true,
      on: val(matrix, 'OnColour') ?? 0xffff0000,
      off: val(matrix, 'OffColour') ?? 0xff000000,
      bg: val(matrix, 'BackgroundColour') ?? 0xff000000,
      flip180: !!val(matrix, 'Flip180'),
      vertical: !!val(matrix, 'Vertical'),
    };
  }

  const pmx = comps.find((c) => c.type === Type.ProconnMatrix && c.width > 0 && c.height > 0);
  const proconnMatrix: ProconnMatrix | null = pmx
    ? {
        left: pmx.x, top: pmx.y, width: pmx.width, height: pmx.height, ...turn(pmx),
        size: Math.max(1, val(pmx, 'Size') ?? 3),
        on: val(pmx, 'OnColour') ?? 0xff00ff00,
        off: val(pmx, 'OffColour') ?? 0xff000000,
        bg: val(pmx, 'BackgroundColour') ?? 0xff000000,
      }
    : null;

  const eda = comps.find((c) => c.type === Type.EpochDotAlpha && c.width > 0 && c.height > 0);
  const epochDotAlpha: EpochDotAlphaPanel | null = eda
    ? {
        left: eda.x, top: eda.y, width: eda.width, height: eda.height, ...turn(eda),
        dotW: Math.max(1, val(eda, 'XSize') ?? 2),
        dotH: Math.max(1, val(eda, 'YSize') ?? 2),
        gap: Math.max(0, val(eda, 'DotSpacing') ?? 1),
        digitGap: Math.max(0, val(eda, 'DigitSpacing') ?? 2),
        on: val(eda, 'OnColour') ?? 0xffffff00,
        off: val(eda, 'OffColour') ?? 0xff2c2c00,
        bg: val(eda, 'BackgroundColour') ?? 0xff000000,
      }
    : null;
  const mmx = comps.find((c) => c.type === Type.MaygayMatrix && c.width > 0 && c.height > 0);
  const maygayMatrix: MaygayMatrixPanel | null = mmx
    ? {
        left: mmx.x, top: mmx.y, width: mmx.width, height: mmx.height, ...turn(mmx),
        size: Math.max(2, val(mmx, 'Size') ?? 5),
        on: val(mmx, 'OnColour') ?? 0xffff0000,
        off: val(mmx, 'OffColour') ?? 0xff200000,
        bg: val(mmx, 'BackgroundColour') ?? 0xff000000,
      }
    : null;

  const emx = comps.find((c) => c.type === Type.EpochMatrix && c.width > 0 && c.height > 0);
  const epochMatrix: EpochMatrixPanel | null = emx
    ? {
        left: emx.x, top: emx.y, width: emx.width, height: emx.height, ...turn(emx),
        size: Math.max(2, val(emx, 'Size') ?? 7),
        hi: val(emx, 'OnColourHi') ?? 0xffff0000,
        med: val(emx, 'OnColourMed') ?? 0xffaa0000,
        lo: val(emx, 'OnColourLo') ?? 0xff770000,
        off: val(emx, 'OffColour') ?? 0xff000000,
        bg: val(emx, 'BackgroundColour') ?? 0xff000000,
      }
    : null;

  const bfmv = comps.find((c) => c.type === Type.BFMVideo && c.number === 0 && c.width > 0 && c.height > 0)
    ?? comps.find((c) => c.type === Type.BarcrestVideo && c.width > 0 && c.height > 0);
  const videoScreen: VideoScreen | null = bfmv
    ? { left: bfmv.x, top: bfmv.y, width: bfmv.width, height: bfmv.height, ...turn(bfmv), chip: 0 }
    : null;

  const alphaish = comps.filter((c) =>
    c.type === Type.AlphaNew || c.type === Type.Alpha || c.type === Type.BFMAlpha
    || c.type === Type.AlphaStrip);
  const disp = alphaish.find((c) => c.type === Type.AlphaNew) ?? alphaish[0];
  const dmd = comps.find((c) => c.type === Type.DotMatrix && c.width > 0 && c.height > 0);
  if (!dotMatrix && dmd) {
    const pitch = Math.max(1, val(dmd, 'Size') ?? 7);
    dotMatrix = {
      left: dmd.x, top: dmd.y, width: dmd.width, height: dmd.height, ...turn(dmd),
      cols: Math.max(0, Math.round((dmd.width - 2) / pitch)),
      rows: Math.max(0, Math.round((dmd.height - 2) / pitch)),
      pitch,
      dot: Math.max(1, pitch - (pitch < 5 ? 1 : 2)),
      stride: 9,
      lsbFirst: false,
      on: val(dmd, 'OnColour') ?? 0xffff0000,
      off: val(dmd, 'OffColour') ?? 0xff000000,
      bg: val(dmd, 'BackgroundColour') ?? 0xff000000,
      flip180: false,
      vertical: false,
    };
  }

  const dots = comps.find((c) => c.type === Type.DotAlpha);
  let vfd: Rect | null = null;
  let vfdIsDots = false;
  let vfdColours: Cabinet<ImageData>['vfdColours'] = null;
  let vfdFont: ImageData | null = null;
  let vfdGlyphWidth = 0;
  let vfdInk: number | null = null;
  let vfdOffLevel: number | null = null;
  let vfdStripColumns: number | undefined;
  if (disp) {
    vfd = { left: disp.x, top: disp.y, width: disp.width, height: disp.height, ...turn(disp) };
    if (disp.type === Type.AlphaStrip) vfdIsDots = true;
    const on = val(disp, 'OnColour') ?? val(disp, 'Colour');
    const off = val(disp, 'OffColour');
    const bg = val(disp, 'BackgroundColour');
    if (on !== undefined) {
      vfdColours = {
        on, off: off ?? 0, bg: bg ?? 0xff000000,
        thickness: val(disp, 'Thickness') ?? 1,
        slant: val(disp, 'Slant') ?? 0,
        spacing: val(disp, 'Spacing') ?? 0,
        hSpacing: val(disp, 'HorizontalSpacing') ?? 5,
        vSpacing: val(disp, 'VerticalSpacing') ?? 4,
        centre: val(disp, 'Centre') ?? 48,
        chop: val(disp, 'Chop') ?? 90,
        seg16: !!val(disp, 'Segment16'),
        charset: val(disp, 'Charset'),
        reversed: disp.type === Type.AlphaStrip
          || (disp.type === Type.BFMAlpha && !disp.values.has('Reversed'))
          || !!(val(disp, 'Reversed') || val(disp, 'ReversedLegacy')),
        dot: disp.type === Type.AlphaStrip
          ? {
              x: val(disp, 'XSize') ?? 2,
              y: val(disp, 'YSize') ?? 2,
              spacing: val(disp, 'DotSpacing') ?? 1,
            }
          : undefined,
      };
    }
    const atlas = disp.type === Type.Alpha ? image(disp, 'CharBitmap') : null;
    if (atlas && atlas.width >= 64) {
      vfdFont = atlas;
      vfdGlyphWidth = val(disp, 'DigitWidth') ?? Math.round(atlas.width / 64);
      vfdInk = val(disp, 'Colour') ?? 0xff00ff00;
    }
    const strip = disp.type === Type.BFMAlpha ? image(disp, 'CharacterImage') : null;
    if (strip && strip.width >= 16) {
      vfdFont = strip;
      vfdGlyphWidth = strip.width >> 4;
      vfdInk = val(disp, 'Colour') ?? BFM_ALPHA_DEFAULT_INK;
      vfdOffLevel = val(disp, 'OffLevel') ?? BFM_ALPHA_DEFAULT_OFF_LEVEL;
      vfdStripColumns = Math.max(1, val(disp, 'Columns') ?? BFM_ALPHA_DEFAULT_COLUMNS);
    }
  } else if (dots) {
    vfd = { left: dots.x, top: dots.y, width: dots.width, height: dots.height, ...turn(dots) };
    vfdIsDots = true;
    vfdColours = {
      on: val(dots, 'OnColour') ?? 0xff00ffff,
      off: val(dots, 'OffColour') ?? 0xff002c2c,
      bg: val(dots, 'BackgroundColour') ?? 0x00000000,
      thickness: 1, slant: 0, spacing: val(dots, 'DigitSpacing') ?? 2,
      hSpacing: 5, vSpacing: 4, centre: 48, chop: 90,
      seg16: false, charset: undefined,
      reversed: true,
      dot: {
        x: val(dots, 'XSize') ?? 2,
        y: val(dots, 'YSize') ?? 2,
        spacing: val(dots, 'DotSpacing') ?? 1,
        digitGap: Math.max(0, val(dots, 'DigitSpacing') ?? 2),
      },
    };
  }

  const dotAlphaReversed = !!dots && dots.type === Type.DotAlpha;

  const artWidth = (background ? background.width + backgroundOffset.x : 0)
    || backgroundRect.width || 0;
  const width = videoScreen
    ? Math.max(artWidth, Math.min(videoScreen.left + videoScreen.width, backgroundRect.width || Infinity))
    : artWidth;
  const height = (background ? background.height + backgroundOffset.y : 0)
    || backgroundRect.height || 0;
  if (!background && !reels.length && !lamps.length && !vfd) return null;

  const rgbLeds: RgbLed[] = comps
    .filter((c) => c.type === Type.RgbLed && c.width > 0 && c.height > 0)
    .map((c) => ({
      left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
      lamps: (val(c, 'MaxLED') ?? 1) !== 0 ? [] : (c.subs ?? []).slice(0, 4),
      mux: (val(c, 'MaxLED') ?? 1) !== 0 ? c.number : -1,
      colours: [
        val(c, 'AdjustedOff') ?? 0xff7f0000,
        val(c, 'AdjustedRed') ?? 0xff000000,
        val(c, 'AdjustedGreen') ?? 0xff000000,
        val(c, 'AdjustedRedGreen') ?? 0xff000000,
        val(c, 'AdjustedBlue') ?? 0xff000000,
        val(c, 'AdjustedRedBlue') ?? 0xff000000,
        val(c, 'AdjustedRedGreen2') ?? 0xff000000,
        val(c, 'AdjustedRedGreenBlue') ?? 0xff000000,
      ],
      style: val(c, 'SelectedStyle') ?? 0,
      noOutline: (val(c, 'NoOutline') ?? 0) !== 0,
      noShadow: (val(c, 'NoShadow') ?? 0) !== 0,
    }));

  const prismLamps: PrismLamp<ImageData>[] = comps
    .filter((c) => c.type === 0x29 && c.width > 0 && c.height > 0)
    .map((c) => {
      const subs = (c.subs ?? []);
      return {
        left: c.x, top: c.y, width: c.width, height: c.height, ...turn(c),
        lamp1: subs[0] ?? -1,
        lamp2: subs[1] ?? -1,
        off: image(c, 'Off'),
        image1: image(c, 'Lamp1'),
        image2: image(c, 'Lamp2'),
        mask1: image(c, 'Lamp1Mask', 'alphaonly'),
        mask2: image(c, 'Lamp2Mask', 'alphaonly'),
        style: val(c, 'Style') ?? 0,
        horizontal: (val(c, 'IsHorizontal') ?? c.values.get('#08') ?? 1) !== 0,
        hSpacing: val(c, 'HorizontalSpacing') ?? 2,
        vSpacing: val(c, 'VerticalSpacing') ?? 2,
        tilt: val(c, 'Tilt') ?? 0x28,
        centerLine: (val(c, 'CenterLine') ?? 1) !== 0,
      };
    });

  const bitmaps = buildBitmaps(comps, backdropBitmap);

  const content: Rect = { left: 0, top: 0, width, height };
  const asPart = (r: Rect, reel = false) => ({ x: r.left, y: r.top, width: r.width, height: r.height, reel });
  const column = sidewaysCrop(width, height, [
    ...reels.map((r) => asPart(r, true)),
    ...[...lamps, ...legends, ...segDisplays, ...rgbLeds, ...prismLamps,
    ...(vfd ? [vfd] : []), ...(dotMatrix ? [dotMatrix] : []),
    ...(proconnMatrix ? [proconnMatrix] : []),
    ...(epochDotAlpha ? [epochDotAlpha] : []),
    ...(maygayMatrix ? [maygayMatrix] : []),
    ...(epochMatrix ? [epochMatrix] : []),
    ...(videoScreen ? [videoScreen] : []),
    ].map((r) => asPart(r)),
  ], background, backgroundOffset.x);

  return {
    width, height, background, backgroundRect, backgroundOffset, backgroundColour,
    backgroundKey, backdrop,
    reels, bandReels, flipReels, lamps: [...lamps, ...legends], vfd, vfdIsDots, vfdFont, vfdGlyphWidth,
    vfdInk,
    vfdOffBrightness: vfdOffLevel ?? 80,
    ...(vfdStripColumns ? { vfdStripColumns } : {}),
    content, column, featureReel: null, frameReels: [], vfdColours,
    vfdReversed: !!vfdColours?.reversed || dotAlphaReversed, segDisplays, dotMatrix,
    proconnMatrix,
    epochDotAlpha,
    maygayMatrix,
    epochMatrix,
    videoScreen,
    rgbLeds,
    prismLamps,
    bitmaps,
    decode: { clean: comps.filter((c) => c.clean).length, total: comps.length },
  };
}

function coinNote(c: ParsedComponent): number | undefined {
  return acceptorIds(c.values).note;
}

function coinLine(c: ParsedComponent): number | undefined {
  const id = c.values.get('CoinId');
  if (id === undefined || id < 0x0f || id > 0x16) return undefined;
  return id - 0x0f;
}
