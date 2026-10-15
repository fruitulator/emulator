import {
  flipReelFace, paintBandStrip, paintFlip, reelBandMetrics, reelVisibleSymbols,
  type BandClassic, type BandStrip, type Cabinet, type CabBitmap, type CabLamp, type FlipStrip, type FrameReel, type PrismLamp, type ReelBand, type Rect,
} from './dat';
import { argbToCss } from './vfd';
import { angledExtent, withAngle } from '../src/layout/compangle';
import { SIDE_MARGIN } from './fmllayout';
import { drawOrder } from './draworder';

export interface CabGeometry {
  width: number;
  height: number;
  background: number | null;
  backgroundRect: Cabinet['backgroundRect'];
  backgroundOffset?: Cabinet['backgroundOffset'];
  backgroundColour?: number | null;
  backgroundKey?: number | null;
  backdrop?: number | null;
  reels: (Omit<ReelBand, 'canvas' | 'overlay' | 'mask' | 'mask2' | 'mask3' | 'gradient'
    | 'discMask' | 'discInnerMask' | 'discPunch' | 'discBaseOverlay'>
    & { canvas: number; overlay?: number; mask?: number; mask2?: number; mask3?: number; gradient?: number;
      discMask?: number; discInnerMask?: number; discPunch?: number; discBaseOverlay?: number })[];
  bandReels?: (Omit<BandStrip, 'canvas' | 'overlay' | 'classic'>
    & { canvas: number; overlay?: number;
      classic?: Omit<BandClassic, 'mask'> & { mask?: number } })[];
  flipReels?: (Omit<FlipStrip, 'canvas' | 'overlay' | 'mask1' | 'mask2' | 'mask3'>
    & { canvas: number; overlay?: number; mask1?: number; mask2?: number; mask3?: number })[];
  lamps: (Omit<CabLamp, 'states' | 'offState' | 'rgb'> & {
    states: { n: number; canvas: number; down?: number }[];
    offState?: { nums: number[]; canvas: number; down?: number };
    rgb?: { bits: number[]; faces: (number | null)[] };
  })[];
  vfd: Cabinet['vfd'];
  vfdIsDots: boolean;
  vfdFont: number | null;
  vfdGlyphWidth: number;
  vfdInk?: number | null;
  vfdOffBrightness?: number;
  vfdStripColumns?: number;
  vfdReversed: boolean;
  content: Cabinet['content'];
  column?: Cabinet['column'];
  trimmed?: Cabinet['trimmed'];
  featureReel:
    | (Omit<NonNullable<Cabinet['featureReel']>, 'frames' | 'mask'> & { frames: number[]; mask?: number })
    | null;
  frameReels: (Omit<FrameReel, 'frames' | 'mask'> & { frames: number[]; mask?: number })[];
  vfdColours?: Cabinet['vfdColours'];
  segDisplays?: Cabinet['segDisplays'];
  dotMatrix?: Cabinet['dotMatrix'];
  proconnMatrix?: Cabinet['proconnMatrix'];
  epochDotAlpha?: Cabinet['epochDotAlpha'];
  maygayMatrix?: Cabinet['maygayMatrix'];
  plasmaPanel?: Cabinet['plasmaPanel'];
  bfmLeds?: Cabinet['bfmLeds'];
  epochMatrix?: Cabinet['epochMatrix'];
  videoScreen?: Cabinet['videoScreen'];
  rgbLeds?: Cabinet['rgbLeds'];
  prismLamps?: (Omit<PrismLamp, 'off' | 'image1' | 'image2' | 'mask1' | 'mask2'>
    & { off?: number; image1?: number; image2?: number; mask1?: number; mask2?: number })[];
  bitmaps?: (Omit<CabBitmap, 'image' | 'overlay'> & { image?: number; overlay?: number })[];
}

function pixelsOf(img: unknown): { w: number; h: number; px: Uint8ClampedArray } | null {
  const i = img as { width?: unknown; height?: unknown; data?: unknown };
  if (!(i.data instanceof Uint8ClampedArray)) return null;
  if (typeof i.width !== 'number' || typeof i.height !== 'number') return null;
  return { w: i.width, h: i.height, px: i.data };
}

function hashPixels(px: Uint8ClampedArray): number {
  let h = 0x811c9dc5;
  if (px.byteOffset % 4 === 0 && px.byteLength % 4 === 0) {
    const u = new Uint32Array(px.buffer, px.byteOffset, px.byteLength >> 2);
    for (let k = 0; k < u.length; k++) h = Math.imul(h ^ u[k], 0x01000193);
  } else {
    for (let k = 0; k < px.length; k++) h = Math.imul(h ^ px[k], 0x01000193);
  }
  return h >>> 0;
}

function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
}

export function dehydrateCabinet<A>(cab: Cabinet<A>): {
  geo: CabGeometry;
  assets: { id: number; image: A }[];
} {
  const ids = new Map<A, number>();
  const assets: { id: number; image: A }[] = [];
  type Px = { id: number; px: Uint8ClampedArray; hash?: number };
  const bySize = new Map<string, Px[]>();
  const byHash = new Map<string, Px[]>();
  const hashed = (size: string, e: Px): void => {
    if (e.hash !== undefined) return;
    e.hash = hashPixels(e.px);
    const k = `${size}#${e.hash}`;
    const list = byHash.get(k);
    if (list) list.push(e); else byHash.set(k, [e]);
  };
  const idFor = (c: A): number => {
    let id = ids.get(c);
    if (id !== undefined) return id;
    const p = pixelsOf(c);
    if (p) {
      const size = `${p.w}x${p.h}`;
      const same = bySize.get(size);
      if (same) {
        for (const e of same) hashed(size, e);
        const h = hashPixels(p.px);
        const match = byHash.get(`${size}#${h}`)?.find((e) => samePixels(e.px, p.px));
        if (match) {
          ids.set(c, match.id);
          return match.id;
        }
        id = assets.length;
        const e: Px = { id, px: p.px };
        same.push(e);
        e.hash = h;
        const k = `${size}#${h}`;
        const list = byHash.get(k);
        if (list) list.push(e); else byHash.set(k, [e]);
      } else {
        id = assets.length;
        bySize.set(size, [{ id, px: p.px }]);
      }
    } else {
      id = assets.length;
    }
    ids.set(c, id);
    assets.push({ id, image: c });
    return id;
  };

  const geo: CabGeometry = {
    width: cab.width,
    height: cab.height,
    background: cab.background ? idFor(cab.background) : null,
    backgroundRect: { ...cab.backgroundRect },
    backgroundOffset: cab.backgroundOffset ? { ...cab.backgroundOffset } : undefined,
    backgroundColour: cab.backgroundColour ?? null,
    backgroundKey: cab.backgroundKey ?? null,
    backdrop: cab.backdrop ? idFor(cab.backdrop) : null,
    reels: cab.reels.map((r) => ({
      ...r, canvas: idFor(r.canvas),
      overlay: r.overlay ? idFor(r.overlay) : undefined,
      mask: r.mask ? idFor(r.mask) : undefined,
      mask2: r.mask2 ? idFor(r.mask2) : undefined,
      mask3: r.mask3 ? idFor(r.mask3) : undefined,
      gradient: r.gradient ? idFor(r.gradient) : undefined,
      discMask: r.discMask ? idFor(r.discMask) : undefined,
      discInnerMask: r.discInnerMask ? idFor(r.discInnerMask) : undefined,
      discPunch: r.discPunch ? idFor(r.discPunch) : undefined,
      discBaseOverlay: r.discBaseOverlay ? idFor(r.discBaseOverlay) : undefined,
    })),
    bandReels: (cab.bandReels ?? []).map((b) => ({
      ...b, canvas: idFor(b.canvas),
      overlay: b.overlay ? idFor(b.overlay) : undefined,
      classic: b.classic
        ? { ...b.classic, mask: b.classic.mask ? idFor(b.classic.mask) : undefined }
        : undefined,
    })),
    flipReels: (cab.flipReels ?? []).map((f) => ({
      ...f, canvas: idFor(f.canvas),
      overlay: f.overlay ? idFor(f.overlay) : undefined,
      mask1: f.mask1 ? idFor(f.mask1) : undefined,
      mask2: f.mask2 ? idFor(f.mask2) : undefined,
      mask3: f.mask3 ? idFor(f.mask3) : undefined,
    })),
    lamps: cab.lamps.map(({ rgb, ...l }) => ({
      ...l,
      states: l.states.map((s) => ({
        n: s.n, canvas: idFor(s.canvas), ...(s.down ? { down: idFor(s.down) } : {}),
      })),
      offState: l.offState
        ? {
          nums: l.offState.nums,
          canvas: idFor(l.offState.canvas),
          ...(l.offState.down ? { down: idFor(l.offState.down) } : {}),
        }
        : undefined,
      ...(rgb ? { rgb: { bits: rgb.bits, faces: rgb.faces.map((f) => (f ? idFor(f) : null)) } } : {}),
    })),
    vfd: cab.vfd ? { ...cab.vfd } : null,
    vfdIsDots: cab.vfdIsDots,
    vfdFont: cab.vfdFont ? idFor(cab.vfdFont) : null,
    vfdGlyphWidth: cab.vfdGlyphWidth,
    vfdInk: cab.vfdInk ?? null,
    vfdOffBrightness: cab.vfdOffBrightness ?? 80,
    ...(cab.vfdStripColumns ? { vfdStripColumns: cab.vfdStripColumns } : {}),
    vfdReversed: cab.vfdReversed,
    content: { ...cab.content },
    column: cab.column ? { ...cab.column } : undefined,
    trimmed: cab.trimmed ? { ...cab.trimmed } : undefined,
    featureReel: cab.featureReel
      ? {
          ...cab.featureReel, frames: cab.featureReel.frames.map(idFor),
          mask: cab.featureReel.mask ? idFor(cab.featureReel.mask) : undefined,
        }
      : null,
    frameReels: cab.frameReels.map((fr) => ({
      ...fr, frames: fr.frames.map(idFor),
      mask: fr.mask ? idFor(fr.mask) : undefined,
    })),
    vfdColours: cab.vfdColours ?? null,

    segDisplays: cab.segDisplays ?? [],
    dotMatrix: cab.dotMatrix ?? null,
    proconnMatrix: cab.proconnMatrix ?? null,
    epochDotAlpha: cab.epochDotAlpha ?? null,
    maygayMatrix: cab.maygayMatrix ?? null,
    plasmaPanel: cab.plasmaPanel ?? null,
    bfmLeds: cab.bfmLeds ?? [],
    epochMatrix: cab.epochMatrix ?? null,
    videoScreen: cab.videoScreen ?? null,
    rgbLeds: cab.rgbLeds ?? [],
    prismLamps: (cab.prismLamps ?? []).map((p) => ({
      ...p,
      off: p.off ? idFor(p.off) : undefined,
      image1: p.image1 ? idFor(p.image1) : undefined,
      image2: p.image2 ? idFor(p.image2) : undefined,
      mask1: p.mask1 ? idFor(p.mask1) : undefined,
      mask2: p.mask2 ? idFor(p.mask2) : undefined,
    })),
    bitmaps: (cab.bitmaps ?? []).map((b) => ({
      ...b,
      image: b.image ? idFor(b.image) : undefined,
      overlay: b.overlay ? idFor(b.overlay) : undefined,
    })),
  };
  return { geo, assets };
}

export function assembleCabinet<A>(
  geo: CabGeometry,
  images: Map<number, A>,
): Cabinet<A> {
  const get = (id: number): A => {
    const c = images.get(id);
    if (!c) throw new Error(`cabinet asset ${id} missing from pak`);
    return c;
  };

  return {
    width: geo.width,
    height: geo.height,
    background: geo.background === null ? null : get(geo.background),
    backgroundRect: geo.backgroundRect,
    backgroundOffset: geo.backgroundOffset,
    backgroundColour: geo.backgroundColour ?? null,
    backgroundKey: geo.backgroundKey ?? null,
    backdrop: geo.backdrop == null ? null : get(geo.backdrop),
    reels: geo.reels.map((r) => ({
      ...r, canvas: get(r.canvas),
      overlay: r.overlay === undefined ? undefined : get(r.overlay),
      mask: r.mask === undefined ? undefined : get(r.mask),
      mask2: r.mask2 === undefined ? undefined : get(r.mask2),
      mask3: r.mask3 === undefined ? undefined : get(r.mask3),
      gradient: r.gradient === undefined ? undefined : get(r.gradient),
      discMask: r.discMask === undefined ? undefined : get(r.discMask),
      discInnerMask: r.discInnerMask === undefined ? undefined : get(r.discInnerMask),
      discPunch: r.discPunch === undefined ? undefined : get(r.discPunch),
      discBaseOverlay: r.discBaseOverlay === undefined ? undefined : get(r.discBaseOverlay),
    })),
    bandReels: (geo.bandReels ?? []).map((b) => ({
      ...b, canvas: get(b.canvas),
      overlay: b.overlay === undefined ? undefined : get(b.overlay),
      classic: b.classic === undefined ? undefined
        : { ...b.classic, mask: b.classic.mask === undefined ? undefined : get(b.classic.mask) },
    })),
    flipReels: (geo.flipReels ?? []).map((f) => ({
      ...f, canvas: get(f.canvas),
      overlay: f.overlay === undefined ? undefined : get(f.overlay),
      mask1: f.mask1 === undefined ? undefined : get(f.mask1),
      mask2: f.mask2 === undefined ? undefined : get(f.mask2),
      mask3: f.mask3 === undefined ? undefined : get(f.mask3),
    })),
    lamps: geo.lamps.map(({ rgb, ...l }) => ({
      ...l,
      states: l.states.map((s) => ({
        n: s.n,
        canvas: get(s.canvas),
        ...(s.down === undefined ? {} : { down: get(s.down) }),
      })),
      offState: l.offState
        ? {
          nums: l.offState.nums,
          canvas: get(l.offState.canvas),
          ...(l.offState.down === undefined ? {} : { down: get(l.offState.down) }),
        }
        : undefined,
      ...(rgb ? { rgb: { bits: rgb.bits, faces: rgb.faces.map((f) => (f === null ? null : get(f))) } } : {}),
    })),
    vfd: geo.vfd,
    vfdIsDots: geo.vfdIsDots,
    vfdFont: geo.vfdFont === null ? null : get(geo.vfdFont),
    vfdGlyphWidth: geo.vfdGlyphWidth,
    vfdInk: geo.vfdInk ?? null,
    vfdOffBrightness: geo.vfdOffBrightness ?? 80,
    ...(geo.vfdStripColumns ? { vfdStripColumns: geo.vfdStripColumns } : {}),
    vfdReversed: geo.vfdReversed ?? !!geo.vfdColours?.reversed,
    content: geo.content,
    column: geo.column,
    trimmed: geo.trimmed,
    featureReel: geo.featureReel
      ? {
          ...geo.featureReel, frames: geo.featureReel.frames.map(get),
          mask: geo.featureReel.mask === undefined ? undefined : get(geo.featureReel.mask),
        }
      : null,
    frameReels: geo.frameReels.map((fr) => ({
      ...fr, frames: fr.frames.map(get),
      mask: fr.mask === undefined ? undefined : get(fr.mask),
    })),
    vfdColours: geo.vfdColours ?? null,

    segDisplays: geo.segDisplays ?? [],
    dotMatrix: geo.dotMatrix ?? null,
    proconnMatrix: geo.proconnMatrix ?? null,
    epochDotAlpha: geo.epochDotAlpha ?? null,
    maygayMatrix: geo.maygayMatrix ?? null,
    plasmaPanel: geo.plasmaPanel ?? null,
    bfmLeds: geo.bfmLeds ?? [],
    epochMatrix: geo.epochMatrix ?? null,
    videoScreen: geo.videoScreen ?? null,
    rgbLeds: geo.rgbLeds ?? [],
    prismLamps: (geo.prismLamps ?? []).map((p) => ({
      ...p,
      off: p.off === undefined ? null : get(p.off),
      image1: p.image1 === undefined ? null : get(p.image1),
      image2: p.image2 === undefined ? null : get(p.image2),
      mask1: p.mask1 === undefined ? null : get(p.mask1),
      mask2: p.mask2 === undefined ? null : get(p.mask2),
    })),
    bitmaps: (geo.bitmaps ?? []).map((b) => ({
      ...b,
      image: b.image === undefined ? null : get(b.image),
      overlay: b.overlay === undefined ? null : get(b.overlay),
    })),
  };
}

export function toOffscreen(img: ImageData | ImageBitmap): OffscreenCanvas {
  const c = new OffscreenCanvas(img.width, img.height);
  const cx = c.getContext('2d')!;
  if ((img as ImageData).data !== undefined) cx.putImageData(img as ImageData, 0, 0);
  else cx.drawImage(img as ImageBitmap, 0, 0);
  return c;
}

export async function encodePng(img: ImageData | ImageBitmap | OffscreenCanvas): Promise<Uint8Array> {
  const c = img instanceof OffscreenCanvas ? img : toOffscreen(img);
  const blob = await c.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

export const THUMB_QUALITY = 0.85;

export async function encodeThumb(
  img: ImageData | ImageBitmap | OffscreenCanvas,
): Promise<Uint8Array> {
  const c = img instanceof OffscreenCanvas ? img : toOffscreen(img);
  const blob = await c.convertToBlob({ type: 'image/webp', quality: THUMB_QUALITY });
  if (blob.type === 'image/webp') return new Uint8Array(await blob.arrayBuffer());
  return encodePng(c);
}

export function imageMime(bytes: Uint8Array): string {
  return bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/webp';
}

export function closeCabinet(cab: Cabinet): void {
  for (const { image } of dehydrateCabinet(cab).assets) image.close();
}

export const THUMB_MAX_W = 512;

export function downscaleCanvas(src: HTMLCanvasElement, maxW: number): HTMLCanvasElement {
  let cur = src;
  while (cur.width > maxW * 2) {
    const half = document.createElement('canvas');
    half.width = Math.max(1, Math.round(cur.width / 2));
    half.height = Math.max(1, Math.round(cur.height / 2));
    const hx = half.getContext('2d')!;
    hx.imageSmoothingQuality = 'high';
    hx.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  if (cur.width <= maxW) return cur;
  const out = document.createElement('canvas');
  out.width = maxW;
  out.height = Math.max(1, Math.round(cur.height * (maxW / cur.width)));
  const ox = out.getContext('2d')!;
  ox.imageSmoothingQuality = 'high';
  ox.drawImage(cur, 0, 0, out.width, out.height);
  return out;
}

export function downscaleOffscreen(src: OffscreenCanvas, maxW: number): OffscreenCanvas {
  let cur = src;
  while (cur.width > maxW * 2) {
    const half = new OffscreenCanvas(
      Math.max(1, Math.round(cur.width / 2)),
      Math.max(1, Math.round(cur.height / 2)),
    );
    const hx = half.getContext('2d')!;
    hx.imageSmoothingQuality = 'high';
    hx.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  if (cur.width <= maxW) return cur;
  const out = new OffscreenCanvas(
    maxW,
    Math.max(1, Math.round(cur.height * (maxW / cur.width))),
  );
  const ox = out.getContext('2d')!;
  ox.imageSmoothingQuality = 'high';
  ox.drawImage(cur, 0, 0, out.width, out.height);
  return out;
}

export function componentBounds(
  cab: Cabinet<ImageData> | Cabinet<ImageBitmap>,
): Rect | null {
  if (cab.column) return cab.column;
  const left0 = cab.content.left;
  const top0 = cab.content.top;
  const right0 = left0 + cab.content.width;
  const bottom0 = top0 + cab.content.height;
  let minX = Infinity;
  let maxX = -Infinity;
  const span = (left: number, top: number, width: number, height: number): void => {
    if (width <= 0 || height <= 0) return;
    const l = Math.max(left, left0);
    const r = Math.min(left + width, right0);
    const t = Math.max(top, top0);
    const b = Math.min(top + height, bottom0);
    if (r <= l || b <= t) return;
    minX = Math.min(minX, l);
    maxX = Math.max(maxX, r);
  };
  const spanR = (p: Rect): void => {
    const e = angledExtent(p, p.angle);
    span(e.left, e.top, e.width, e.height);
  };
  for (const lp of cab.lamps) spanR(lp);
  for (const r of cab.reels) spanR(r);
  for (const r of cab.frameReels) spanR(r);
  if (cab.featureReel) {
    spanR(cab.featureReel);
  }
  if (cab.vfd) spanR(cab.vfd);
  for (const d of cab.segDisplays ?? []) spanR(d);
  for (const d of cab.rgbLeds ?? []) spanR(d);
  for (const d of cab.prismLamps ?? []) spanR(d);
  if (cab.dotMatrix) {
    const d = cab.dotMatrix;
    spanR(d);
  }
  if (cab.proconnMatrix) {
    const d = cab.proconnMatrix;
    spanR(d);
  }
  for (const d of [cab.epochDotAlpha, cab.maygayMatrix, cab.epochMatrix, cab.plasmaPanel]) {
    if (d) spanR(d);
  }
  for (const d of cab.bfmLeds ?? []) spanR(d);
  if (cab.videoScreen) {
    const d = cab.videoScreen;
    spanR(d);
  }
  if (!Number.isFinite(minX) || maxX <= minX || cab.content.height <= 0) return null;
  const pad = (maxX - minX) * SIDE_MARGIN;
  const left = Math.max(left0, minX - pad);
  const right = Math.min(right0, maxX + pad);
  return { left, top: top0, width: right - left, height: cab.content.height };
}

export { SIDE_MARGIN };

export async function makeThumb(
  cab: Cabinet<ImageData> | Cabinet<ImageBitmap>,
  maxW = THUMB_MAX_W,
): Promise<Uint8Array | null> {
  if (!cab.background && !cab.backgroundColour && !cab.reels.length
    && !cab.frameReels.length && !cab.featureReel && !cab.lamps.length) {
    return null;
  }
  const src = componentBounds(cab)
    ?? (cab.content.width > 0 && cab.content.height > 0
      ? cab.content
      : { left: 0, top: 0, width: cab.width, height: cab.height });
  if (src.width <= 0 || src.height <= 0) return null;
  const full = new OffscreenCanvas(src.width, src.height);
  const fx = full.getContext('2d')!;
  fx.translate(-src.left, -src.top);
  drawCabinetStill(fx, cab, { keyedBlack: true });
  return encodeThumb(downscaleOffscreen(full, maxW));
}

export const THUMB_RULE = 6;

type Ctx = OffscreenCanvasRenderingContext2D;
type AnyImage = ImageData | ImageBitmap;

function drawable(img: AnyImage): CanvasImageSource {
  return (img as ImageData).data !== undefined
    ? toOffscreen(img as ImageData)
    : (img as ImageBitmap);
}

export function drawBackdrop(
  fx: Ctx | CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number,
): void {
  const iw = (img as { width: number }).width, ih = (img as { height: number }).height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  fx.drawImage(img, (w - iw * scale) / 2, (h - ih * scale) / 2, iw * scale, ih * scale);
}

function stillReel(fx: Ctx, reel: ReelBand<AnyImage>): void {
  const { left, top, width, height, stops, rheight } = reel;
  if (width <= 0 || height <= 0 || stops <= 0) return;
  if (reel.disc) {
    fx.save();
    fx.beginPath();
    fx.rect(left, top, width, height);
    fx.clip();
    fx.translate(left + (width - 1) / 2, top + (height - 1) / 2);
    fx.rotate((-reel.disc.offsetDeg * Math.PI) / 180);
    fx.drawImage(drawable(reel.canvas), -(width - 1) / 2, -(height - 1) / 2, width, height);
    fx.restore();
    const floor = reel.disc.lamps?.enabled ? (reel.disc.lamps.floor ?? null) : null;
    if (floor) {
      fx.save();
      fx.globalCompositeOperation = 'multiply';
      fx.fillStyle = `rgb(${floor[0]},${floor[1]},${floor[2]})`;
      fx.fillRect(left, top, width, height);
      fx.restore();
    }
    if (reel.overlay) fx.drawImage(drawable(reel.overlay), left, top, width, height);
    if (reel.discPunch) {
      fx.save();
      fx.globalCompositeOperation = 'destination-out';
      fx.drawImage(drawable(reel.discPunch), left, top, width, height);
      fx.restore();
    }
    if (reel.discBaseOverlay) fx.drawImage(drawable(reel.discBaseOverlay), left, top);
    return;
  }
  const band = drawable(reel.canvas);
  const bandW = (band as { width: number }).width;
  const bandH = (band as { height: number }).height;
  if (!bandW || !bandH) return;
  const across = !!reel.stripHorizontal;
  const symW = across ? bandW / stops : bandW;
  const symH = across ? bandH : bandH / stops;
  const cell = (s: number): [number, number, number, number] => (across
    ? [s * symW, 0, symW, symH]
    : [0, s * symH, symW, symH]);

  fx.save();
  fx.beginPath();
  fx.rect(left, top, width, height);
  fx.clip();
  const visible = reelVisibleSymbols(rheight);
  if (visible === 1) {
    const scale = Math.min(width / symW, height / symH);
    const drawW = symW * scale;
    const drawH = symH * scale;
    fx.fillStyle = reel.bg ?? '#000';
    fx.fillRect(left, top, width, height);
    fx.drawImage(band, ...cell(0), left + (width - drawW) / 2, top + (height - drawH) / 2,
      drawW, drawH);
  } else {
    const dest = reelBandMetrics(stops, height, rheight).symH;
    const centre = top + height / 2;
    const span = Math.ceil(visible / 2) + 2;
    for (let k = -span; k <= span; k++) {
      const s = (((k % stops) + stops) % stops);
      fx.drawImage(band, ...cell(s), left, centre + k * dest - dest / 2, width, dest);
    }
  }
  if (reel.gradient) {
    fx.globalCompositeOperation = 'multiply';
    fx.drawImage(drawable(reel.gradient), left, top, width, height);
    fx.globalCompositeOperation = 'source-over';
  }
  if (reel.overlay) fx.drawImage(drawable(reel.overlay), left, top, width, height);
  fx.restore();
}

function stillBand(fx: Ctx, strip: BandStrip<AnyImage>): void {
  const bandW = (strip.canvas as ImageData).width ?? (strip.canvas as ImageBitmap).width;
  const bandH = (strip.canvas as ImageData).height ?? (strip.canvas as ImageBitmap).height;
  const cl = strip.classic;
  paintBandStrip(fx, strip, drawable(strip.canvas), bandW, bandH,
    strip.overlay ? drawable(strip.overlay) : undefined,
    cl ? { ...cl, mask: cl.mask ? drawable(cl.mask) : undefined } : undefined,
    0, 0, () => 1);
}

function stillFlip(fx: Ctx, f: FlipStrip<AnyImage>): void {
  const { width, height, stops } = f;
  if (width <= 0 || height <= 0 || !stops) return;
  const bandW = (f.canvas as ImageData).width ?? (f.canvas as ImageBitmap).width;
  const bandH = (f.canvas as ImageData).height ?? (f.canvas as ImageBitmap).height;
  if (!bandW || !bandH) return;
  paintFlip(fx, f, drawable(f.canvas), bandW, bandH, flipReelFace(f, 0),
    f.overlay ? drawable(f.overlay) : undefined);
}

function stillFrames(fx: Ctx, r: FrameReel<AnyImage> | (Rect & { frames: AnyImage[] })): void {
  const img = r.frames[0];
  if (!img || r.width <= 0 || r.height <= 0) return;
  fx.drawImage(drawable(img), r.left, r.top, r.width, r.height);
}

function stillLamp(fx: Ctx, lp: CabLamp<AnyImage>): void {
  if (lp.offState) {
    fx.drawImage(drawable(lp.offState.canvas), lp.left, lp.top);
    return;
  }
  if (lp.offDim && lp.width > 0 && lp.height > 0) {
    fx.fillStyle = `rgba(0,0,0,${lp.offDim.alpha})`;
    fx.fillRect(lp.left, lp.top, lp.width, lp.height);
  }
}

export function drawCabinetStill(
  fx: Ctx, cab: Cabinet<ImageData> | Cabinet<ImageBitmap>,
  opts: { keyedBlack?: boolean } = {},
): void {
  if (cab.backgroundColour) {
    fx.fillStyle = argbToCss(cab.backgroundColour);
    fx.fillRect(0, 0, cab.width, cab.height);
  }
  if (opts.keyedBlack && cab.background && cab.backgroundKey != null) {
    const bw = (cab.background as { width: number }).width;
    const bh = (cab.background as { height: number }).height;
    fx.fillStyle = '#000';
    fx.fillRect(cab.backgroundOffset?.x ?? 0, cab.backgroundOffset?.y ?? 0, bw, bh);
  }
  if (cab.backdrop) drawBackdrop(fx, drawable(cab.backdrop), cab.width, cab.height);
  if (cab.background) {
    fx.drawImage(drawable(cab.background),
      cab.backgroundOffset?.x ?? 0, cab.backgroundOffset?.y ?? 0);
  }
  for (const it of drawOrder(cab as Cabinet<AnyImage>)) {
    switch (it.kind) {
      case 'lamp': { const lp = it.lamp; withAngle(fx, lp, lp.angle, () => stillLamp(fx, lp)); break; }
      case 'reel': { const r = it.reel; withAngle(fx, r, r.angle, () => stillReel(fx, r)); break; }
      case 'band': { const b = it.strip; withAngle(fx, b, b.angle, () => stillBand(fx, b)); break; }
      case 'flip': { const f = it.flip; withAngle(fx, f, f.angle, () => stillFlip(fx, f)); break; }
      case 'frame': stillFrames(fx, it.frame); break;
      case 'feature': stillFrames(fx, it.feature); break;
      case 'bitmap': stillBitmap(fx, it.bitmap); break;
      case 'vfd':
        stillFace(fx, it.vfd, cab.vfdColours?.bg, '#050505'); break;
      case 'seg': stillFace(fx, it.seg, it.seg.bg); break;
      case 'panel': stillFace(fx, it.panel, (it.panel as { bg?: number | null }).bg); break;
      case 'bfmLed': stillFace(fx, it.panel, it.panel.bg); break;
      case 'video': stillFace(fx, it.screen, null); break;
      case 'rgbLed': case 'prism': case 'reelLight': break;
    }
  }
}

function stillBitmap(fx: Ctx, b: CabBitmap<AnyImage>): void {
  if (!(b.width > 0) || !(b.height > 0) || (!b.image && !b.overlay)) return;
  withAngle(fx, b, b.angle, () => {
    fx.save();
    fx.beginPath();
    fx.rect(b.left, b.top, b.width, b.height);
    fx.clip();
    if (b.image) {
      fx.imageSmoothingEnabled = b.stretch !== 0;
      fx.drawImage(drawable(b.image), b.left, b.top, b.width, b.height);
    }
    if (b.overlay) {
      fx.imageSmoothingEnabled = false;
      fx.drawImage(drawable(b.overlay), b.left, b.top);
    }
    fx.restore();
  });
}

export function artImage(
  cab: Cabinet<ImageBitmap>,
): { image: CanvasImageSource & { width: number; height: number }; x: number; y: number } | null {
  if (cab.background) {
    return { image: cab.background, x: cab.backgroundOffset?.x ?? 0, y: cab.backgroundOffset?.y ?? 0 };
  }
  const hit = artCache.get(cab);
  if (hit !== undefined) return hit;
  let out: ReturnType<typeof artImage> = null;
  const statics = cab.lamps.filter((l) => !l.states.length && l.offState && !l.offState.nums.length);
  if (statics.length && cab.width > 0 && cab.height > 0) {
    const cv = new OffscreenCanvas(cab.width, cab.height);
    const fx = cv.getContext('2d')!;
    for (const it of drawOrder(cab)) {
      if (it.kind !== 'lamp' || !statics.includes(it.lamp)) continue;
      const lp = it.lamp;
      withAngle(fx, lp, lp.angle, () => stillLamp(fx, lp));
    }
    out = { image: cv, x: 0, y: 0 };
  }
  artCache.set(cab, out);
  return out;
}
const artCache = new WeakMap<object, ReturnType<typeof artImage>>();

function stillFace(fx: Ctx, r: Rect, bg: number | null | undefined, fallback = '#000'): void {
  if (!(r.width > 0) || !(r.height > 0)) return;
  withAngle(fx, r, r.angle, () => {
    fx.fillStyle = bg != null ? argbToCss(bg) : fallback;
    fx.fillRect(r.left, r.top, r.width, r.height);
  });
}
