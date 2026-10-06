import { discAngleDeg, discLampWedges } from './discreel';
import { withAngle } from '../src/layout/compangle';
import { LAMP_FULL, type FrameView } from '../src/machine/framestate';
import { glassText } from '../src/machine/layoutdisplay';
import { MATRIX_COLS, MATRIX_MAP, MATRIX_PLANE, MATRIX_ROWS } from '../src/hw/epochmatrix';
import { drawBackdrop } from './cabjson';
import {
  flipReelFace,
  mfmeBoardReelPosition,
  mfmeFlipReelPosition,
  paintFlip, paintReelBorder, paintBandStrip,
  reelEffectivePosition,
  reelVisibleSymbols,
  reelWinLineRow,
  reelWinLines,
  segDigitGeometry,
  segLitMask,
  segPointLit,
  SEG_METRICS,
  treelWinLinePitch,
  type BandStrip,
  type BitmapPass,
  type CabLamp,
  type Cabinet,
  type PrismLamp,
  type ReelBand,
  type ReelBorder,
  type Rect,
  type RgbLed,
  type SegDisplay,
  type WinLines,
} from './dat';
import { mfmeBandIndex } from './dat';
import {
  drumBandSlices, drumRowMap, drumScreenRadius, drumVisibleSymbols, wrapPieces,
} from '../src/layout/reeldrum';
import { argbToCss, drawSegmentText, type SegmentColours } from './vfd';
import {
  ALPHA_DEFAULT_INK, ALPHA_DEFAULT_OFF_BRIGHTNESS, alphaGenerateOff, alphaMaskAndColour,
  atlasGlyph, alphaAtlasIntensity,
} from './alphaatlas';
import { alphaNewGeom, drawAlphaNew, type AlphaNewStyle } from './alphanew';
import { alphaCellRoles, CELL_CUSTOM } from './alphacells';
import {
  BFM_ALPHA_DEFAULT_INK, BFM_ALPHA_DEFAULT_OFF_LEVEL, bfmAlphaCell, bfmAlphaLayers, bfmAlphaOrder,
} from './bfmalpha';
import { dotGlyph } from './dotfont';
import { DOT_ALPHA_INTENSITY, dotAlphaCanvas, dotAlphaDot } from './dotalpha';
import { drawnBounce } from './bouncepref';
import {
  advanceSettleCounters, featureReelContinuous, buildRenderIndex, cabLampLevel, cabLampLit, drawnBandIndex,
  newSettleMemory, parkedForDraw, platformReelOffsetSteps, platformRequiresReversal,
  reelCentreRow, rgbLedFrameColour, type IndexedElement, type IntRect, reelIndex,
} from './render-index';
import { fancyReelPool, type FancyPool } from './reellight';
import { PROCONN_LCD_FONT } from './proconnfont';
import { EPOCH_DOT_FONT } from './epochdotfont';
import { prismBothLitPlan } from './prismplan';

const EPOCH_ALPHA_PANEL_BYTES = 32;

export const DOT_ON = '#5bf3ff';
export const DOT_OFF = 'rgba(90,140,150,0.10)';

export function buildVfdLayers(
  src: ImageBitmap, ink: number, glyphW: number, offBrightness: number,
): { chars: HTMLCanvasElement; ghost: HTMLCanvasElement | null } {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const cx = c.getContext('2d')!;
  cx.drawImage(src, 0, 0);
  const img = cx.getImageData(0, 0, c.width, c.height);
  const off = alphaGenerateOff(
    img, glyphW, offBrightness, (w, h) => new ImageData(w, h),
  );
  alphaMaskAndColour(img, ink);
  cx.putImageData(img, 0, 0);
  let ghost: HTMLCanvasElement | null = null;
  if (off) {
    ghost = document.createElement('canvas');
    ghost.width = off.width;
    ghost.height = off.height;
    ghost.getContext('2d')!.putImageData(off, 0, 0);
  }
  return { chars: c, ghost };
}

export interface BfmAlphaCanvases {
  segW: number;
  columns: number;
  glyphs: HTMLCanvasElement;
  ghost: HTMLCanvasElement;
  segments: HTMLCanvasElement;
}

export function buildBfmAlphaCanvases(
  src: ImageBitmap, ink: number, offLevel: number, columns: number,
): BfmAlphaCanvases | null {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const cx = c.getContext('2d')!;
  cx.drawImage(src, 0, 0);
  const layers = bfmAlphaLayers(
    cx.getImageData(0, 0, c.width, c.height), ink, offLevel, (w, h) => new ImageData(w, h),
  );
  if (!layers) return null;
  const canvasOf = (img: { width: number; height: number; data: Uint8ClampedArray }) => {
    const out = document.createElement('canvas');
    out.width = img.width;
    out.height = img.height;
    out.getContext('2d')!.putImageData(img as ImageData, 0, 0);
    return out;
  };
  return {
    segW: layers.segW, columns,
    glyphs: canvasOf(layers.glyphs), ghost: canvasOf(layers.ghost), segments: canvasOf(layers.segments),
  };
}

export function paintBfmAlpha(
  ctx: CanvasRenderingContext2D, disp: NonNullable<FrameView['display']>, r: Rect,
  bfm: BfmAlphaCanvases, reversed: boolean,
): void {
  const { segW, columns, glyphs, ghost, segments } = bfm;
  const h = glyphs.height;
  const cw = r.width / columns;
  for (let p = 0; p < columns; p++) {
    ctx.drawImage(ghost, 0, 0, segW, h, r.left + p * cw, r.top, cw, r.height);
  }
  const order = bfmAlphaOrder(columns, reversed);
  ctx.save();
  ctx.globalAlpha = alphaAtlasIntensity(disp.duty ?? 31);
  for (let p = 0; p < columns; p++) {
    const i = order[p];
    const c = disp.chars[i] ?? 0;
    const word = disp.cellWords ? (disp.cellWords[i] ?? 0) : (c & 0x7f) | (c & 0x80 ? 0x2e00 : 0);
    const cell = bfmAlphaCell(word);
    const x = r.left + p * cw;
    if (cell.custom) {
      for (let s = 0; s < 16; s++) {
        if (cell.pattern & (1 << s)) ctx.drawImage(segments, s * segW, 0, segW, h, x, r.top, cw, r.height);
      }
      continue;
    }
    if (cell.glyph >= 0) ctx.drawImage(glyphs, cell.glyph * segW, 0, segW, h, x, r.top, cw, r.height);
    if (cell.punct >= 0) ctx.drawImage(glyphs, cell.punct * segW, 0, segW, h, x, r.top, cw, r.height);
  }
  ctx.restore();
}

export interface CabinetPainterOptions {
  inputHeld?: (input: number) => boolean;
  virtualDisplay?: (m: FrameView | null) => void;
  dirtyDisabled?: boolean;
  lampGate?: (m: FrameView, lp: CabLamp) => void;
}

export function createCabinetPainter(canvas: HTMLCanvasElement, opts: CabinetPainterOptions = {}) {
  const ctx = canvas.getContext('2d')!;
  const inputHeld = opts.inputHeld ?? ((): boolean => false);
  const virtualDisplay = opts.virtualDisplay ?? ((): void => undefined);
  const dirtyDisabled = opts.dirtyDisabled ?? false;
  const lampGate = opts.lampGate ?? ((): void => undefined);

  let vfdAtlas: HTMLCanvasElement | null = null;

  let vfdGhost: HTMLCanvasElement | null = null;

  let vfdBfm: BfmAlphaCanvases | null = null;

  let vfdSegColours: SegmentColours | undefined;
  let vfdReversed = false;

  let vfdBd1Style: AlphaNewStyle | null = null;
  let vfdSeg16 = true;

  let vfdCharset: number | undefined;

  let vfdDots: { x: number; y: number; spacing: number; digitGap?: number } | null = null;

  const settleMemory = newSettleMemory();
  const frStill = [0, 0, 0, 0, 0, 0];
  const stillFrames = [0, 0, 0, 0, 0, 0];

  function updateReelCounters(m: FrameView, cab: Cabinet): void {
    advanceSettleCounters(m, cab, { stillFrames, frStill }, settleMemory);
  }

  let renderIndex: {
    cab: Cabinet;
    els: IndexedElement[];
    lastKeys: Int32Array | null;
    canvasW: number;
    canvasH: number;
  } | null = null;

  const drawLog: { t: number; rects: 'full' | IntRect[] }[] = [];

  function paint(m: FrameView, cab: Cabinet): boolean {
    if (!lightClusters || lightClusters.cab !== cab) {
      lightClusters = { cab, clusters: computeLightGeometry(cab) };
    }
    if (!renderIndex || renderIndex.cab !== cab) {
      renderIndex = {
        cab,
        els: buildRenderIndex(
          cab,
          lightClusters.clusters.map((c) => ({ bbox: c.bbox, lamps: c.sites.map((s) => s.lamp) })),
          (input) => inputHeld(input),
        ),
        lastKeys: null,
        canvasW: 0,
        canvasH: 0,
      };
    }
    const { els } = renderIndex;
    const counters = { stillFrames, frStill };
    const keys = new Int32Array(els.length);
    for (let i = 0; i < els.length; i++) keys[i] = els[i].key(m, counters);

    const sizeChanged = renderIndex.canvasW !== canvas.width || renderIndex.canvasH !== canvas.height;
    const last = renderIndex.lastKeys;
    let rects: IntRect[] | null = null;
    if (!dirtyDisabled && last && !sizeChanged) {
      rects = [];
      let area = 0;
      for (let i = 0; i < els.length; i++) {
        if (keys[i] !== last[i]) {
          const e = els[i].extent;
          rects.push(e);
          area += (e.right - e.left) * (e.bottom - e.top);
        }
      }
      if (!rects.length) return false;
      if (area > cab.width * cab.height * 0.6) rects = null;
    }
    renderIndex.lastKeys = keys;
    renderIndex.canvasW = canvas.width;
    renderIndex.canvasH = canvas.height;

    drawLog.push({ t: performance.now(), rects: rects ? rects.map((r) => ({ ...r })) : 'full' });
    if (drawLog.length > 40) drawLog.shift();

    ctx.save();
    ctx.beginPath();
    if (rects) {
      for (const r of rects) {
        const left = Math.max(0, r.left - cab.content.left);
        const top = Math.max(0, r.top - cab.content.top);
        const right = Math.min(canvas.width, r.right - cab.content.left);
        const bottom = Math.min(canvas.height, r.bottom - cab.content.top);
        if (right > left && bottom > top) ctx.rect(left, top, right - left, bottom - top);
      }
    } else {
      ctx.rect(0, 0, canvas.width, canvas.height);
    }
    ctx.clip();
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawCabinet(m, cab);
    ctx.restore();
    return true;
  }

  function drawCabinet(m: FrameView, cab: Cabinet): void {
    ctx.save();
    ctx.translate(-cab.content.left, -cab.content.top);
    if (cab.backgroundColour) {
      ctx.fillStyle = argbToCss(cab.backgroundColour);
      ctx.fillRect(0, 0, cab.width, cab.height);
    }
    if (cab.backdrop) drawBackdrop(ctx, cab.backdrop, cab.width, cab.height);
    if (cab.background) {
      const off = cab.backgroundOffset;
      ctx.drawImage(cab.background, off?.x ?? 0, off?.y ?? 0);
    }

    drawBitmaps(m, cab, 'back');

    for (const lp of cab.lamps) if (lp.underReel) drawLamp(lp);

    cab.reels.forEach((reel, idx) => withAngle(ctx, reel, reel.angle, () => {
      const i = reelIndex(m, reel);
      const r = m.reels[i];
      void idx;
      if (!r) return;
      if (reel.disc) {
        drawDiscReel(reel, r.position + drawnBounce(r), r.stepsPerRevolution || 96, m);
        return;
      }
      const parked = parkedForDraw(stillFrames[i]);
      const detentPos = r.position + (parked ? 0 : r.subStep);
      const drawPos = detentPos + drawnBounce(r);
      let sym: number;
      let detentSym: number;
      if (reel.bandOffset !== undefined) {
        const perRev = r.stepsPerRevolution || 96;
        sym = (drawPos * 96) / perRev;
        detentSym = (detentPos * 96) / perRev;
      } else {
        const rowOf = (p: number): number => drawnBandIndex(
          m.layout.system, reel, r.stepsPerRevolution, p, 0,
        ) * (reel.stops || 16) / 96;
        const continuous = rowOf(drawPos);
        const detentRow = rowOf(detentPos);
        const whole = Math.round(detentRow);
        const snapped = parked && Math.abs(detentRow - whole) < 1 / 3;
        sym = snapped ? whole + (continuous - detentRow) : continuous;
        detentSym = snapped ? whole : detentRow;
      }
      const lit = reel.lampNums.map((n) => (n < 0 ? LAMP_FULL : m.layoutLampLevel(n)));
      const stops = reel.stops || 16;
      const strip = reel.bandOffset !== undefined
        ? (m.layout.reelStripOffsets?.[i] ?? 0) * (96 / stops) : 0;
      const platformReversed = platformRequiresReversal(m.layout.system);
      const chain = (p: number): number | undefined => (reel.bandOffset !== undefined
        ? mfmeBandIndex(
          m.layout.system, p, reel.bandOffset + (reel.winlinesOffset ?? 0),
          platformReversed !== reel.reversed,
          stops, reel.literalOffsetSign === true, r.stepsPerRevolution,
        )
        : undefined);
      const mfmeIndex = chain(sym);
      const detentIndex = detentSym === sym ? mfmeIndex : chain(detentSym);
      if (reel.bandOffset === undefined) drawReelBorder(reel.border);
      drawReelWindow(
        reel, sym, parked, lit,
        platformReelOffsetSteps(m.layout.system, reel.reversed) + strip,
        platformReversed, mfmeIndex, (n) => m.layoutLampLevel(n),
        detentSym, detentIndex,
      );
    }));

    for (const strip of cab.bandReels ?? []) {
      const r = m.reels[reelIndex(m, strip)];
      if (!r) continue;
      const perRev = r.stepsPerRevolution || strip.halfSteps;
      const raw = perRev === strip.halfSteps
        ? r.position : (r.position * strip.halfSteps) / perRev;
      const pos = mfmeBoardReelPosition(m.layout.system, raw, strip.halfSteps);
      const level = strip.lampNums.length
        ? Math.max(...strip.lampNums.map((n) => m.layoutLampLevel(n)))
        : LAMP_FULL;
      withAngle(ctx, strip, strip.angle,
        () => drawBandStrip(strip, pos, level,
          (n) => Math.max(0, Math.min(LAMP_FULL, m.layoutLampLevel(n))) / LAMP_FULL));
    }

    for (const f of cab.flipReels ?? []) {
      const r = m.reels[reelIndex(m, f)];
      const perRev = r?.stepsPerRevolution || f.halfSteps;
      const raw = !r ? 0 : perRev === f.halfSteps ? r.position : (r.position * f.halfSteps) / perRev;
      const pos = mfmeFlipReelPosition(m.layout.system, Math.round(raw), f.halfSteps);
      withAngle(ctx, f, f.angle, () =>
        paintFlip(ctx, f, f.canvas, f.canvas.width, f.canvas.height, flipReelFace(f, pos), f.overlay));
    }

    cab.frameReels.forEach((fr) => {
      const i = reelIndex(m, fr);
      const r = m.reels[i];
      if (!r) return;
      const continuous = drawnBandIndex(m.layout.system, fr, r.stepsPerRevolution, r.position)
        * fr.stops / 96;
      const sym = frStill[i] >= 2 ? Math.round(continuous) : continuous;
      const payline = ((sym % fr.stops) + fr.stops) % fr.stops;
      const base = Math.floor(payline);
      const frac = payline - base;
      drawReelBorder(fr.border);
      ctx.save();
      ctx.beginPath();
      ctx.rect(fr.left, fr.top, fr.width, fr.height);
      ctx.clip();
      drawFrameStrip(fr, base + frac);
      drawWinLines(fr, treelWinLinePitch(fr.rheight));
      ctx.restore();
    });

    if (cab.featureReel && m.reels[reelIndex(m, cab.featureReel)]) {
      const fr = cab.featureReel;
      const ri = reelIndex(m, fr);
      const rN = m.reels[ri];
      const continuous = featureReelContinuous(
        m.layout.system, fr, rN.stepsPerRevolution, rN.position,
      );
      const wholeV = Math.round(continuous);
      const v = stillFrames[ri] >= 2 && Math.abs(continuous - wholeV) < 1 / 3 ? wholeV : continuous;
      const base = Math.floor(v);
      const frac = v - base;
      drawReelBorder(fr.border);
      ctx.save();
      ctx.beginPath();
      ctx.rect(fr.left, fr.top, fr.width, fr.height);
      ctx.clip();
      drawFrameStrip(fr, base + frac);
      drawWinLines(fr, treelWinLinePitch(fr.rheight));
      ctx.restore();
    }

    applyReelLight(m, cab);
    drawBitmaps(m, cab, 'reels');

    const vfd = cab.vfd;
    if (vfd && cab.vfdIsDots) {
      withAngle(ctx, vfd, vfd.angle, () => drawDotMatrix(m, vfd, vfdSegColours ?? null, vfdDots));
      virtualDisplay(null);
    } else if (vfd) {
      withAngle(ctx, vfd, vfd.angle, () => drawVfd(m, vfd, cab.vfdGlyphWidth));
      virtualDisplay(null);
    } else {
      virtualDisplay(m);
    }

    function drawLamp(lp: CabLamp): void {
      withAngle(ctx, lp, lp.angle, () => drawLampUpright(lp));
    }
    function drawLampUpright(lp: CabLamp): void {
      lampGate(m, lp);
      const held = lp.button !== undefined && inputHeld(lp.button);
      if (lp.offUnder && lp.offState) {
        ctx.drawImage(held && lp.offState.down ? lp.offState.down : lp.offState.canvas, lp.left, lp.top);
      }
      for (const st of lp.states) {
        const lit = cabLampLevel(m, lp, st.n);
        if (lit) {
          if (lp.blend) ctx.globalCompositeOperation = 'lighter';
          if (lit < LAMP_FULL) ctx.globalAlpha = lit / LAMP_FULL;
          ctx.drawImage(held && st.down ? st.down : st.canvas, lp.left, lp.top);
          if (lit < LAMP_FULL) ctx.globalAlpha = 1;
          if (lp.blend) ctx.globalCompositeOperation = 'source-over';
          if (!lp.multi) break;
        }
      }
      if (lp.offState) {
        if (!lp.offUnder && !lp.offState.nums.some((n) => cabLampLit(m, lp, n))) {
          const face = held && lp.offState.down ? lp.offState.down : lp.offState.canvas;
          ctx.drawImage(face, lp.left, lp.top);
        }
        return;
      }
      if (lp.offDim) {
        if (!lp.offDim.nums.some((n) => cabLampLit(m, lp, n))) {
          ctx.fillStyle = `rgba(0,0,0,${lp.offDim.alpha})`;
          ctx.fillRect(lp.left, lp.top, lp.width, lp.height);
        }
        return;
      }
      if (lp.legend) {
        const lit = lp.legend.lamp >= 0 && m.layoutLamp(lp.legend.lamp);
        const text = (lit ? lp.legend.on ?? lp.legend.off : lp.legend.off ?? lp.legend.on) ?? '';
        const nudge = lp.legend.input !== undefined && inputHeld(lp.legend.input) ? 1 : 0;
        if (lp.legend.fill !== undefined) {
          ctx.fillStyle = argbToCss(lp.legend.fill);
          ctx.fillRect(lp.left, lp.top, lp.width, lp.height);
        }
        if (text) drawLegend(ctx, text, lp.left, lp.top, lp.width, lp.height, lp.legend, nudge);
        return;
      }
      if (lp.button !== undefined && lp.states.length === 0) {
        const litFill = lp.litFill && m.layoutLamp(lp.litFill.n)
          ? argbToCss(lp.litFill.colour) : null;
        ctx.fillStyle = litFill ?? '#2b2b36';
        ctx.strokeStyle = litFill ?? '#6a6a7a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(lp.left + 0.5, lp.top + 0.5, lp.width - 1, lp.height - 1, 4);
        ctx.fill();
        ctx.stroke();
        if (lp.label) {
          ctx.fillStyle = litFill ? '#101014' : '#d8d8e2';
          ctx.font = `${Math.max(10, Math.min(14, lp.height - 10))}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(lp.label, lp.left + lp.width / 2, lp.top + lp.height / 2, lp.width - 6);
        }
      }
    }
    for (const lp of cab.lamps) if (!lp.underReel) drawLamp(lp);
    drawBitmaps(m, cab, 'lamps');
    if (cab.segDisplays?.length) drawSegDisplays(m, cab.segDisplays);
    drawBitmaps(m, cab, 'digits');
    if (cab.rgbLeds?.length) {
      const drawn = new Set((cab.bitmaps ?? []).flatMap((b) => b.ledsBelow ?? []));
      drawRgbLeds(m, cab.rgbLeds, (i) => !drawn.has(i));
    }
    if (cab.prismLamps?.length) drawPrismLamps(m, cab.prismLamps);
    const dm = cab.dotMatrix, pm = cab.proconnMatrix, eda = cab.epochDotAlpha;
    const mm = cab.maygayMatrix, em = cab.epochMatrix, vs = cab.videoScreen;
    if (dm) withAngle(ctx, dm, dm.angle, () => drawDotPanel(m, dm));
    if (pm) withAngle(ctx, pm, pm.angle, () => drawProconnMatrix(m, pm));
    if (eda) withAngle(ctx, eda, eda.angle, () => drawEpochDotAlpha(m, eda));
    if (mm) withAngle(ctx, mm, mm.angle, () => drawMaygayMatrix(m, mm));
    if (em) withAngle(ctx, em, em.angle, () => drawEpochMatrix(m, em));
    if (vs) withAngle(ctx, vs, vs.angle, () => drawVideoScreen(m, vs));
    drawBitmaps(m, cab, 'top');
    drawUnserved(m);
    ctx.restore();
  }

  function drawBitmaps(m: FrameView, cab: Cabinet, pass: BitmapPass): void {
    if (!cab.bitmaps?.length) return;
    for (const b of cab.bitmaps) {
      if (b.pass !== pass) continue;
      if (b.ledsBelow?.length && cab.rgbLeds?.length) {
        const below = b.ledsBelow;
        drawRgbLeds(m, cab.rgbLeds, (i) => below.includes(i));
      }
      withAngle(ctx, b, b.angle, () => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(b.left, b.top, b.width, b.height);
        ctx.clip();
        if (b.image) {
          ctx.imageSmoothingEnabled = b.stretch !== 0;
          ctx.imageSmoothingQuality = b.stretch >= 4 ? 'high' : 'low';
          ctx.drawImage(b.image, b.left, b.top, b.width, b.height);
        }
        if (b.overlay) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(b.overlay, b.left, b.top);
        }
        ctx.restore();
      });
    }
  }

  function drawUnserved(m: FrameView): void {
    const list = m.layout.unserved;
    if (!list.length) return;
    ctx.save();
    for (const u of list) {
      const r = u.rect;
      if (!r || r.width <= 0 || r.height <= 0) continue;
      ctx.fillStyle = 'rgba(12, 6, 8, 0.82)';
      ctx.fillRect(r.left, r.top, r.width, r.height);
      ctx.strokeStyle = 'rgba(255, 138, 128, 0.85)';
      ctx.lineWidth = Math.max(1, Math.min(2, r.height / 24));
      ctx.strokeRect(r.left + 0.5, r.top + 0.5, r.width - 1, r.height - 1);
      ctx.beginPath();
      ctx.moveTo(r.left, r.top);
      ctx.lineTo(r.left + r.width, r.top + r.height);
      ctx.moveTo(r.left + r.width, r.top);
      ctx.lineTo(r.left, r.top + r.height);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDotPanel(m: FrameView, d: NonNullable<Cabinet['dotMatrix']>): void {
    const dots = m.dotsRaw;
    ctx.fillStyle = argbToCss(d.bg);
    ctx.fillRect(d.left, d.top, d.width, d.height);
    if (!dots?.length) return;
    const rows = Math.min(d.rows, Math.floor(dots.length / d.stride));
    const cols = Math.min(d.cols, d.stride * 8);
    const on = argbToCss(d.on);
    const off = argbToCss(d.off);
    for (let r = 0; r < rows; r++) {
      const base = r * d.stride;
      for (let c = 0; c < cols; c++) {
        const lit = (dots[base + (c >> 3)] >> (d.lsbFirst ? c & 7 : 7 - (c & 7))) & 1;
        ctx.fillStyle = lit ? on : off;
        ctx.fillRect(d.left + 2 + c * d.pitch, d.top + 2 + r * d.pitch, d.dot, d.dot);
      }
    }
  }

  function drawProconnMatrix(m: FrameView, p: NonNullable<Cabinet['proconnMatrix']>): void {
    const s = p.size;
    const g = s < 2 ? 0 : s < 4 ? 1 : 2;
    const kx = p.width / (100 * s + 18 * g + 23);
    const ky = p.height / (28 * s + 2 * g + 7);
    const dot = Math.max(1, s - g);
    ctx.fillStyle = argbToCss(p.bg);
    ctx.fillRect(p.left, p.top, p.width, p.height);
    const cells = m.lcdRaw;
    const on = argbToCss(p.on);
    const off = argbToCss(p.off);
    for (let i = 0; i < 80; i++) {
      const x0 = 2 + (i % 20) * (5 * s + g + 1);
      const y0 = 2 + ((i / 20) | 0) * (7 * s + g + 1);
      const c = cells.length > i ? cells[i] : 0x20;
      for (let cx = 0; cx < 5; cx++) {
        const bits = PROCONN_LCD_FONT[c * 5 + cx];
        for (let ry = 0; ry < 7; ry++) {
          ctx.fillStyle = (bits >> ry) & 1 ? on : off;
          ctx.fillRect(p.left + (x0 + cx * s) * kx, p.top + (y0 + ry * s) * ky, dot * kx, dot * ky);
        }
      }
    }
  }

  function drawEpochDotAlpha(m: FrameView, p: NonNullable<Cabinet['epochDotAlpha']>): void {
    const px = p.dotW + p.gap;
    const py = p.dotH + p.gap;
    const cellPitch = px * 6 + p.digitGap;
    const kx = p.width / (cellPitch * 16 + 3);
    const ky = p.height / (py * 7 + 6);
    ctx.fillStyle = argbToCss(p.bg);
    ctx.fillRect(p.left, p.top, p.width, p.height);
    const on = argbToCss(p.on);
    const off = argbToCss(p.off);
    const cells = m.lcdRaw;
    const dot = (x: number, y: number, w: number, h: number, style: string | null) => {
      if (!style) return;
      ctx.fillStyle = style;
      ctx.fillRect(p.left + x * kx, p.top + y * ky, w * kx, h * ky);
    };
    const glyph = (code: number, x0: number, y0: number) => {
      const g = code * 6;
      const flags = EPOCH_DOT_FONT[g + 5];
      const unlit = flags ? null : off;
      for (let c = 0; c < 5; c++) {
        const bits = EPOCH_DOT_FONT[g + c];
        for (let r = 0; r < 7; r++) dot(x0 + c * px, y0 + r * py, p.dotW, p.dotH, (bits >> r) & 1 ? on : unlit);
      }
      const x5 = x0 + 5 * px;
      const yP = y0 + py * 6 + 1;
      dot(x5, yP, p.dotW, p.dotH, flags & 0x40 ? on : unlit);
      const tail = flags & 0x80 ? on : unlit;
      dot(x5 + 1, yP + p.dotH, p.dotW - 1, 1, tail);
      dot(x5, yP + p.dotH + 1, 1, p.dotH - 1, tail);
    };
    for (let i = 0; i < 16; i++) {
      const x0 = 3 + i * cellPitch;
      const attr = cells.length > 16 + i ? cells[16 + i] : 0;
      const code = attr & 0x80 ? 0x20 : cells.length > i ? cells[i] : 0x20;
      glyph(code, x0, 3);
      const punct = attr & 0x7f;
      if (punct === 0x2c) glyph(0x100, x0, 3);
      else if (punct === 0x2e) glyph(0x101, x0, 3);
    }
  }

  const MAYGAY_MATRIX_BANDS = [175, 210, 0, 35, 70, 105, 140];

  function drawMaygayMatrix(m: FrameView, p: NonNullable<Cabinet['maygayMatrix']>): void {
    const s = p.size;
    const kx = p.width / (s * 70 + 1);
    const ky = p.height / (s * 21 + 1);
    ctx.fillStyle = argbToCss(p.bg);
    ctx.fillRect(p.left, p.top, p.width, p.height);
    const on = argbToCss(p.on);
    const off = argbToCss(p.off);
    const frame = m.lcdRaw;
    const rx = ((s - 1) / 2) * kx;
    const ry = ((s - 1) / 2) * ky;
    for (let b = 0; b < 7; b++) {
      const base = MAYGAY_MATRIX_BANDS[b];
      for (let k = 7; k >= 0; k--) {
        if (k === 0 || k === 4) continue;
        let mask = 1 << k;
        if (b < 2) mask >>= 1;
        const right = k >= 5;
        const band = right ? k - 4 : k;
        let row = band === 1 ? b - 2 : band === 2 ? b + 5 : b + 12;
        if (row < 0) { row = b + 19; mask = right ? 0x80 : 0x08; }
        const colBase = right ? 35 : 0;
        for (let col = 0; col < 35; col++) {
          const v = frame.length > base + col ? frame[base + col] : 0;
          ctx.fillStyle = v & mask ? on : off;
          ctx.beginPath();
          ctx.ellipse(p.left + ((colBase + col) * s + s / 2) * kx, p.top + (row * s + s / 2) * ky, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function drawEpochMatrix(m: FrameView, p: NonNullable<Cabinet['epochMatrix']>): void {
    const s = p.size;
    const kx = p.width / (s * MATRIX_COLS + 1);
    const ky = p.height / (s * MATRIX_ROWS + 1);
    ctx.fillStyle = argbToCss(p.bg);
    ctx.fillRect(p.left, p.top, p.width, p.height);
    const palette = [argbToCss(p.off), argbToCss(p.lo), argbToCss(p.med), argbToCss(p.hi)];
    const frame = m.lcdRaw.subarray(EPOCH_ALPHA_PANEL_BYTES);
    const rx = ((s - 1) / 2) * kx;
    const ry = ((s - 1) / 2) * ky;
    for (let i = 0; i < MATRIX_MAP.length; i++) {
      const at = MATRIX_MAP[i];
      const byte = at >> 3;
      const bit = at & 7;
      const p0 = byte < frame.length ? (frame[byte] >> bit) & 1 : 0;
      const p1 = MATRIX_PLANE + byte < frame.length ? (frame[MATRIX_PLANE + byte] >> bit) & 1 : 0;
      ctx.fillStyle = palette[p0 | (p1 << 1)];
      const col = (i / MATRIX_ROWS) | 0;
      const row = MATRIX_ROWS - 1 - (i % MATRIX_ROWS);
      ctx.beginPath();
      ctx.ellipse(p.left + (col * s + s / 2) * kx, p.top + (row * s + s / 2) * ky, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  let videoCanvas: HTMLCanvasElement | null = null;
  let videoImage: ImageData | null = null;
  let videoKey = '';

  function drawVideoScreen(m: FrameView, v: NonNullable<Cabinet['videoScreen']>): void {
    const w = m.layout.videoWidth;
    const h = m.layout.videoHeight;
    if (!w || !h) return;
    if (!videoCanvas || videoCanvas.width !== w || videoCanvas.height !== h) {
      videoCanvas = document.createElement('canvas');
      videoCanvas.width = w;
      videoCanvas.height = h;
      videoImage = new ImageData(w, h);
      videoKey = '';
    }
    const key = `${m.epoch}:${m.videoSerial}`;
    if (key !== videoKey) {
      videoKey = key;
      const src = m.videoRaw;
      const dst = videoImage!.data;
      for (let i = 0; i < dst.length; i += 4) {
        dst[i] = src[i + 2];
        dst[i + 1] = src[i + 1];
        dst[i + 2] = src[i];
        dst[i + 3] = 255;
      }
      videoCanvas.getContext('2d')!.putImageData(videoImage!, 0, 0);
    }
    ctx.drawImage(videoCanvas, v.left, v.top, v.width, v.height);
  }

  function drawLegend(
    ctx: CanvasRenderingContext2D, text: string,
    x: number, y: number, w: number, h: number,
    legend: NonNullable<CabLamp['legend']>,
    nudge = 0,
  ): void {
    const paras = text.split(/\r?\n/);
    if (!paras.some((s) => s.length)) return;
    const clip = { x, y, w, h };
    x += (legend.dx ?? 0) + nudge;
    y += (legend.dy ?? 0) + nudge;
    const family = `"${legend.face}", Tahoma, system-ui, sans-serif`;
    const style = legend.style ?? 0;
    const weight = style & 1 ? 'bold ' : '';
    const slant = style & 2 ? 'italic ' : '';
    const font = (size: number): string => `${slant}${weight}${size}px ${family}`;

    let size: number;
    let lines: string[];
    if (legend.points) {
      const wrap = (px: number): string[] => {
        ctx.font = font(px);
        const out: string[] = [];
        for (const para of paras) {
          const words = para.split(' ').filter((t) => t.length);
          if (!words.length) { out.push(''); continue; }
          let cur = words[0];
          for (const word of words.slice(1)) {
            const cand = `${cur} ${word}`;
            if (ctx.measureText(cand).width <= w) cur = cand;
            else { out.push(cur); cur = word; }
          }
          out.push(cur);
        }
        return out;
      };
      size = (legend.points * 96) / 72;
      lines = wrap(size);
      const overflows = (px: number, ls: string[]): boolean =>
        ls.length * px * 1.1 > h || ls.some((l) => ctx.measureText(l).width > w);
      while (size > 5 && overflows(size, lines)) {
        size = Math.max(5, size * 0.94);
        lines = wrap(size);
      }
      ctx.font = font(size);
    } else {
      lines = paras.filter((s) => s.length);
      size = Math.max(6, Math.min(h / lines.length, h));
      for (; size > 5; size -= 0.5) {
        ctx.font = `bold ${size}px ${family}`;
        if (lines.length * size * 1.1 > h) continue;
        if (lines.every((l) => ctx.measureText(l).width <= w - 2)) break;
      }
      ctx.font = `bold ${size}px ${family}`;
    }
    const argb = legend.colour;
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip();
    ctx.fillStyle = `rgba(${(argb >>> 16) & 0xff},${(argb >>> 8) & 0xff},${argb & 0xff},${((argb >>> 24) & 0xff) / 255})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lineH = size * 1.1;
    const top = y + h / 2 - (lines.length - 1) * lineH / 2;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) ctx.fillText(lines[i], x + w / 2, top + i * lineH);
    }
    ctx.restore();
  }

  function drawRgbLeds(m: FrameView, leds: RgbLed[], only: (i: number) => boolean = () => true): void {
    for (const [i, led] of leds.entries()) {
      if (only(i)) withAngle(ctx, led, led.angle, () => drawRgbLed(m, led));
    }
  }

  function drawRgbLed(m: FrameView, led: RgbLed): void {
    {
      const colour = argbToCss(rgbLedFrameColour(m, led));
      const unit = Math.min(6, Math.max(1, Math.floor(led.width / 17)));
      const pen = Math.max(1, unit >> 1);
      ctx.fillStyle = colour;
      if (led.style === 2) {
        if (!led.noOutline) {
          ctx.fillStyle = '#000000';
          ctx.fillRect(led.left, led.top, led.width, led.height);
          ctx.fillStyle = colour;
        }
        ctx.fillRect(led.left + unit, led.top + unit,
          Math.max(0, led.width - 2 * unit), Math.max(0, led.height - 2 * unit));
        return;
      }
      if (led.style === 1) {
        const x = led.left + unit - 1;
        const y = led.top + unit - 1;
        ctx.fillRect(x, y, Math.max(0, led.width - unit), Math.max(0, led.height - unit));
        return;
      }
      const cx = led.left + led.width / 2;
      const cy = led.top + led.height / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(0, led.width / 2), Math.max(0, led.height / 2), 0, 0, Math.PI * 2);
      ctx.fill();
      if (!led.noOutline) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = pen;
        ctx.stroke();
      }
    }
  }

  interface PrismFrames { off: HTMLCanvasElement; lamp1: HTMLCanvasElement; lamp2: HTMLCanvasElement }
  const prismFrames = new WeakMap<PrismLamp, PrismFrames>();

  function prismSkew(
    p: PrismLamp, src: ImageBitmap | null, forward: boolean,
  ): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = p.width;
    c.height = p.height;
    const cx = c.getContext('2d')!;
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, p.width, p.height);
    if (src) {
      if (p.horizontal) {
        const W = src.width;
        const H = src.height;
        const t = (p.tilt / 4 / 100) * W;
        const step = (t * 2) / H;
        let l = forward ? p.hSpacing - t : p.hSpacing + t;
        let r = forward ? W - p.hSpacing + t : W - p.hSpacing - t;
        const sy = p.height / H;
        for (let i = 0; i < H; i++) {
          cx.drawImage(src, 0, i, W, 1, (l / W) * p.width, i * sy, ((r - l) / W) * p.width, sy);
          if (forward) { l += step; r -= step; } else { l -= step; r += step; }
        }
      } else {
        const W = src.width;
        const H = src.height;
        const t = (p.tilt / 4 / 100) * H;
        const step = (t * 2) / W;
        let tp = forward ? p.vSpacing - t : p.vSpacing + t;
        let bt = forward ? H - p.vSpacing + t : H - p.vSpacing - t;
        const sx = p.width / W;
        for (let i = 0; i < W; i++) {
          cx.drawImage(src, i, 0, 1, H, i * sx, (tp / H) * p.height, sx, ((bt - tp) / H) * p.height);
          if (forward) { tp += step; bt -= step; } else { tp -= step; bt += step; }
        }
      }
    }
    if (p.centerLine) {
      cx.fillStyle = '#000';
      if (p.horizontal) cx.fillRect(0, p.height >> 1, p.width - 1, 1);
      else cx.fillRect(p.width >> 1, 0, 1, p.height);
    }
    return c;
  }

  function prismFramesFor(p: PrismLamp): PrismFrames {
    let f = prismFrames.get(p);
    if (f) return f;
    const off = document.createElement('canvas');
    off.width = p.width;
    off.height = p.height;
    const ox = off.getContext('2d')!;
    ox.fillStyle = '#000';
    ox.fillRect(0, 0, p.width, p.height);
    if (p.off) ox.drawImage(p.off, 0, 0, p.width, p.height);
    if (p.centerLine) {
      if (p.horizontal) ox.fillRect(0, p.height >> 1, p.width - 1, 1);
      else ox.fillRect(p.width >> 1, 0, 1, p.height);
    }
    f = {
      off,
      lamp1: prismSkew(p, p.image1, p.style !== 0),
      lamp2: prismSkew(p, p.image2, p.style === 0),
    };
    prismFrames.set(p, f);
    return f;
  }

  function drawPrismLamps(m: FrameView, lamps: PrismLamp[]): void {
    for (const p of lamps) withAngle(ctx, p, p.angle, () => drawPrismLamp(m, p));
  }

  function drawPrismLamp(m: FrameView, p: PrismLamp): void {
    {
      const f = prismFramesFor(p);
      const l1 = p.lamp1 >= 0 ? m.layoutLampLevel(p.lamp1) : 0;
      const l2 = p.lamp2 >= 0 ? m.layoutLampLevel(p.lamp2) : 0;
      ctx.drawImage(f.off, p.left, p.top);
      const state = (l1 ? 1 : 0) | (l2 ? 2 : 0);
      if (!state) return;
      const W = p.width;
      const H = p.height;
      const hw = W >> 1;
      const hh = H >> 1;
      const half = (img: CanvasImageSource, near: boolean): void => {
        if (p.horizontal) {
          if (near) ctx.drawImage(img, 0, 0, W, hh, p.left, p.top, W, hh);
          else ctx.drawImage(img, 0, hh, W, H - hh, p.left, p.top + hh, W, H - hh);
        } else if (near) ctx.drawImage(img, 0, 0, hw, H, p.left, p.top, hw, H);
        else ctx.drawImage(img, hw, 0, W - hw, H, p.left + hw, p.top, W - hw, H);
      };
      const at = (level: number, draw: () => void): void => {
        if (level <= 0) return;
        ctx.globalAlpha = Math.min(1, level / LAMP_FULL);
        draw();
        ctx.globalAlpha = 1;
      };
      const maskFor1 = p.style !== 0 ? p.mask1 : p.mask2;
      const maskFor2 = p.style !== 0 ? p.mask2 : p.mask1;
      const shade = (draw: () => void): void => {
        ctx.globalCompositeOperation = 'multiply';
        draw();
        ctx.globalCompositeOperation = 'source-over';
      };
      if (state === 1) {
        at(l1, () => ctx.drawImage(f.lamp1, p.left, p.top));
        if (maskFor1) shade(() => ctx.drawImage(maskFor1, p.left, p.top, W, H));
        return;
      }
      if (state === 2) {
        at(l2, () => ctx.drawImage(f.lamp2, p.left, p.top));
        if (maskFor2) shade(() => ctx.drawImage(maskFor2, p.left, p.top, W, H));
        return;
      }
      for (const s of prismBothLitPlan(p.style)) {
        const lv = s.level === 1 ? l1 : l2;
        const face = s.face === 1 ? f.lamp1 : f.lamp2;
        at(s.third ? Math.floor(lv / 3) : lv, () => half(face, s.near));
        const mask = s.face === 1 ? maskFor1 : maskFor2;
        if (s.mask && mask) shade(() => half(mask, s.near));
      }
    }
  }

  function drawSegDisplays(m: FrameView, segs: SegDisplay[]): void {
    for (const s of segs) withAngle(ctx, s, s.angle, () => drawSegDisplay(m, s));
  }

  function drawSegDisplay(m: FrameView, s: SegDisplay): void {
    {
      const word = s.digit !== undefined ? m.layoutDigit?.(s.digit) ?? 0 : -1;
      ctx.fillStyle = argbToCss(s.bg);
      ctx.fillRect(s.left, s.top, s.width, s.height);
      const on = argbToCss(s.on);
      const off = argbToCss(s.off);
      const { segs: polys, dpX, dpY, dpR } = segDigitGeometry(s);
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.left, s.top, s.width, s.height);
      ctx.clip();
      const metrics = s.metrics ?? SEG_METRICS;
      const mask = word >= 0 ? segLitMask(metrics, word) : 0;
      const level = s.digit !== undefined ? m.layoutDigitLevel?.(s.digit) ?? 0xff : 0xff;
      const segLevel = (i: number): number =>
        s.digit !== undefined && i < 8 ? m.layoutDigitSegLevel(s.digit, i) : level;
      for (let i = 0; i < polys.length; i++) {
        const lamp = s.seg[i];
        const lit = word >= 0 ? ((mask >> i) & 1) !== 0 : i < 7 && lamp >= 0 && m.layoutLamp(lamp);
        const lv = metrics.seg16 ? level : segLevel(i);
        const p = polys[i];
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        for (let j = 2; j < p.length; j += 2) ctx.lineTo(p[j], p[j + 1]);
        ctx.closePath();
        if (lit && lv < 0xff) {
          ctx.fillStyle = off;
          ctx.fill();
          ctx.globalAlpha = lv / 255;
          ctx.fillStyle = on;
          ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = lit ? on : off;
          ctx.fill();
        }
      }
      const dp = s.seg[7];
      if (metrics.seg16) {
        if (!metrics.alpha) {
          ctx.fillStyle = s.dpOn || ((mask >> 16) & 1) ? on : off;
          ctx.beginPath();
          ctx.arc(dpX, dpY, dpR, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (word >= 0 || dp !== undefined) {
        let bits7 = 0;
        if (word >= 0) bits7 = word & 0x7f;
        else for (let i = 0; i < 7; i++) if (s.seg[i] >= 0 && m.layoutLamp(s.seg[i])) bits7 |= 1 << i;
        const dpLit = segPointLit(s, bits7, word >= 0 ? (word & 0x80) !== 0 : dp >= 0 && m.layoutLamp(dp));
        const lv = segLevel(7);
        ctx.beginPath();
        ctx.arc(dpX, dpY, dpR, 0, Math.PI * 2);
        if (dpLit && lv < 0xff) {
          ctx.fillStyle = off;
          ctx.fill();
          ctx.globalAlpha = lv / 255;
        }
        ctx.fillStyle = dpLit ? on : off;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  function backlightSlots(reel: ReelBand): number[] {
    if (reel.bandOffset !== undefined && reel.lampNums.some((n) => n >= 0)) return [0, 1, 2];
    const slots: number[] = [];
    reel.lampNums.forEach((n, i) => { if (n >= 0) slots.push(i); });
    return slots;
  }

  function zoneShade(reel: ReelBand, level: number): number {
    const dark = Math.max(0, Math.min(LAMP_FULL, level));
    return (reel.darkness / 255) * (1 - dark / LAMP_FULL);
  }

  function poolPerZone(reel: ReelBand): boolean {
    return !!reel.mask && reel.bandOffset !== undefined;
  }

  interface LightFloor { left: number; top: number; width: number; height: number; rgb: [number, number, number] }
  interface LightSite {
    mask: ImageBitmap; left: number; top: number; lamp: number; zone?: Rect;
    width?: number; height?: number;
  }
  interface LightCluster {
    bbox: { left: number; top: number; width: number; height: number };
    clips: Rect[];
    floors: LightFloor[];
    sites: LightSite[];
    canvas: OffscreenCanvas;
    lastKey: string | null;
  }

  function computeLightGeometry(cab: Cabinet): LightCluster[] {
    interface Pool { floor: LightFloor; sites: LightSite[]; clip: Rect }
    const pools: Pool[] = [];
    const addStatic = (r: Rect & { mask?: ImageBitmap }): void => {
      if (!r.mask) return;
      const left = Math.round(r.left + (r.width - r.mask.width) / 2);
      const top = Math.round(r.top + (r.height - r.mask.height) / 2);
      pools.push({
        floor: { left, top, width: r.mask.width, height: r.mask.height, rgb: [0, 0, 0] },
        sites: [{ mask: r.mask, left, top, lamp: -1 }],
        clip: { left: r.left, top: r.top, width: r.width, height: r.height },
      });
    };
    for (const reel of cab.reels) {
      if (reel.bandOffset !== undefined) continue;
      addStatic(reel);
    }
    cab.frameReels.forEach(addStatic);
    if (cab.featureReel) addStatic(cab.featureReel);

    const parent = pools.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const overlaps = (a: LightFloor, b: LightFloor): boolean =>
      a.left < b.left + b.width && b.left < a.left + a.width
      && a.top < b.top + b.height && b.top < a.top + a.height;
    for (let i = 0; i < pools.length; i++) {
      for (let j = i + 1; j < pools.length; j++) {
        if (overlaps(pools[i].floor, pools[j].floor)) parent[find(i)] = find(j);
      }
    }
    const groups = new Map<number, Pool[]>();
    pools.forEach((p, i) => {
      const root = find(i);
      (groups.get(root) ?? groups.set(root, []).get(root)!).push(p);
    });
    return [...groups.values()].map((group) => {
      const floors = group.map((p) => p.floor);
      const left = Math.min(...floors.map((f) => f.left));
      const top = Math.min(...floors.map((f) => f.top));
      const right = Math.max(...floors.map((f) => f.left + f.width));
      const bottom = Math.max(...floors.map((f) => f.top + f.height));
      return {
        bbox: { left, top, width: right - left, height: bottom - top },
        clips: group.map((p) => p.clip),
        floors,
        sites: group.flatMap((p) => p.sites),
        canvas: new OffscreenCanvas(right - left, bottom - top),
        lastKey: null,
      };
    });
  }

  let lightClusters: { cab: Cabinet; clusters: LightCluster[] } | null = null;

  function applyReelLight(m: FrameView, cab: Cabinet): void {
    if (!lightClusters || lightClusters.cab !== cab) {
      lightClusters = { cab, clusters: computeLightGeometry(cab) };
    }
    for (const cl of lightClusters.clusters) {
      const levels = cl.sites.map((s) => (s.lamp < 0 ? LAMP_FULL : m.layoutLampLevel(s.lamp)));
      const key = levels.join(',');
      if (key !== cl.lastKey) {
        cl.lastKey = key;
        const lx = cl.canvas.getContext('2d')!;
        lx.globalCompositeOperation = 'source-over';
        lx.fillStyle = '#fff';
        lx.fillRect(0, 0, cl.bbox.width, cl.bbox.height);
        for (const f of cl.floors) {
          lx.fillStyle = `rgb(${f.rgb[0]},${f.rgb[1]},${f.rgb[2]})`;
          lx.fillRect(f.left - cl.bbox.left, f.top - cl.bbox.top, f.width, f.height);
        }
        lx.globalCompositeOperation = 'lighten';
        cl.sites.forEach((s, i) => {
          const level = levels[i];
          if (level <= 0) return;
          lx.globalAlpha = level >= LAMP_FULL ? 1 : level / LAMP_FULL;
          if (s.zone) {
            lx.save();
            lx.beginPath();
            lx.rect(s.zone.left - cl.bbox.left, s.zone.top - cl.bbox.top, s.zone.width, s.zone.height);
            lx.clip();
          }
          if (s.width !== undefined && s.height !== undefined) {
            lx.drawImage(s.mask, s.left - cl.bbox.left, s.top - cl.bbox.top, s.width, s.height);
          } else {
            lx.drawImage(s.mask, s.left - cl.bbox.left, s.top - cl.bbox.top);
          }
          if (s.zone) lx.restore();
        });
        lx.globalAlpha = 1;
      }
      ctx.save();
      ctx.beginPath();
      for (const c of cl.clips) ctx.rect(c.left, c.top, c.width, c.height);
      ctx.clip();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(cl.canvas, cl.bbox.left, cl.bbox.top);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  interface FancyLight {
    pool: FancyPool<ImageBitmap>;
    canvas: OffscreenCanvas;
    lastKey: string | null;
  }
  const fancyLights = new WeakMap<ReelBand, FancyLight | null>();

  function drawFancyLight(reel: ReelBand, lampLevel: (n: number) => number): void {
    let fl = fancyLights.get(reel);
    if (fl === undefined) {
      const pool = fancyReelPool(reel);
      fl = pool && {
        pool, canvas: new OffscreenCanvas(pool.floor.width, pool.floor.height), lastKey: null,
      };
      fancyLights.set(reel, fl);
    }
    if (!fl) return;
    const { floor, sites } = fl.pool;
    const levels = sites.map((s) => (s.lamp < 0 ? LAMP_FULL : lampLevel(s.lamp)));
    const key = levels.join(',');
    if (key !== fl.lastKey) {
      fl.lastKey = key;
      const lx = fl.canvas.getContext('2d')!;
      lx.globalCompositeOperation = 'source-over';
      lx.globalAlpha = 1;
      lx.fillStyle = `rgb(${floor.rgb[0]},${floor.rgb[1]},${floor.rgb[2]})`;
      lx.fillRect(0, 0, floor.width, floor.height);
      sites.forEach((s, i) => {
        const level = levels[i];
        if (level <= 0) return;
        lx.globalAlpha = level >= LAMP_FULL ? 1 : level / LAMP_FULL;
        const x = s.left - floor.left, y = s.top - floor.top;
        if (s.mask) {
          lx.drawImage(s.mask, x, y, s.width, s.height);
        } else {
          lx.fillStyle = '#fff';
          lx.fillRect(x, y, s.width, s.height);
        }
      });
      lx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'multiply';
    const alpha = reel.lightAlpha ?? 255;
    if (alpha < 255) ctx.globalAlpha = alpha / 255;
    ctx.drawImage(fl.canvas, floor.left, floor.top);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  interface DiscScratch {
    face: HTMLCanvasElement;
    pool: HTMLCanvasElement;
    wedges: { slot: number; x: number; y: number; canvas: HTMLCanvasElement }[];
  }
  const discScratch = new WeakMap<ReelBand, DiscScratch>();

  function discScratchFor(reel: ReelBand): DiscScratch {
    const have = discScratch.get(reel);
    if (have) return have;
    const { width, height } = reel;
    const mk = (w: number, h: number): HTMLCanvasElement => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
      return c;
    };
    const wedges: DiscScratch['wedges'] = [];
    const lamps = reel.disc?.lamps;
    if (lamps?.enabled) {
      for (const w of discLampWedges(lamps, width, height)) {
        const sprite = w.ring === 'outer' ? reel.discMask : reel.discInnerMask;
        if (!sprite) continue;
        const canvas = mk(w.rect.w, w.rect.h);
        const g = canvas.getContext('2d')!;
        g.translate(-w.rect.x, -w.rect.y);
        g.beginPath();
        g.moveTo(w.cx, w.cy);
        g.arc(w.cx, w.cy, w.rOuter, w.aLo - Math.PI / 2, w.aHi - Math.PI / 2, false);
        g.closePath();
        if (w.rInner > 0) {
          g.moveTo(w.cx + w.rInner, w.cy);
          g.arc(w.cx, w.cy, w.rInner, 0, 2 * Math.PI, true);
        }
        g.clip('evenodd');
        g.drawImage(sprite, w.rect.x, w.rect.y, w.rect.w, w.rect.h);
        wedges.push({ slot: w.slot, x: w.rect.x, y: w.rect.y, canvas });
      }
    }
    const made: DiscScratch = { face: mk(width, height), pool: mk(width, height), wedges };
    discScratch.set(reel, made);
    return made;
  }

  function drawDiscReel(reel: ReelBand, position: number, stepsPerRev: number, m: FrameView): void {
    const { left, top, width, height, canvas: band, disc } = reel;
    if (!disc || width <= 0 || height <= 0) return;
    const deg = discAngleDeg(m.layout.system, position, stepsPerRev, disc.offsetDeg, disc.reversed);
    const s = discScratchFor(reel);
    const fx = s.face.getContext('2d')!;
    fx.save();
    fx.globalCompositeOperation = 'source-over';
    fx.clearRect(0, 0, width, height);
    fx.translate((width - 1) / 2, (height - 1) / 2);
    fx.rotate((deg * Math.PI) / 180);
    fx.drawImage(band, -(width - 1) / 2, -(height - 1) / 2, width, height);
    fx.restore();

    const lamps = disc.lamps;
    if (lamps?.enabled) {
      const floor = lamps.floor;
      const px = s.pool.getContext('2d')!;
      px.save();
      px.globalCompositeOperation = 'source-over';
      px.globalAlpha = 1;
      px.clearRect(0, 0, width, height);
      if (floor) {
        px.fillStyle = `rgb(${floor[0]},${floor[1]},${floor[2]})`;
        px.fillRect(0, 0, width, height);
      }
      for (const w of s.wedges) {
        const n = reel.lampNums[w.slot] ?? -2;
        const level = n === -2 ? 0 : n === -1 ? LAMP_FULL : m.layoutLampLevel(n);
        if (level <= 0) continue;
        px.globalAlpha = Math.min(1, level / LAMP_FULL);
        px.drawImage(w.canvas, w.x, w.y);
      }
      px.globalAlpha = 1;
      px.globalCompositeOperation = 'destination-in';
      px.drawImage(s.face, 0, 0);
      px.restore();
      fx.save();
      fx.globalCompositeOperation = 'multiply';
      fx.drawImage(s.pool, 0, 0);
      fx.restore();
    }
    if (reel.overlay) fx.drawImage(reel.overlay, 0, 0, width, height);
    if (reel.discPunch) {
      fx.save();
      fx.globalCompositeOperation = 'destination-out';
      fx.drawImage(reel.discPunch, 0, 0, width, height);
      fx.restore();
    }
    if (reel.discBaseOverlay) fx.drawImage(reel.discBaseOverlay, 0, 0);
    ctx.drawImage(s.face, left, top);
  }

  function drawBandStrip(
    strip: BandStrip, position: number, level: number,
    lampLit: (n: number) => number,
  ): void {
    const shade = (strip.darkness / 255)
      * (1 - Math.max(0, Math.min(LAMP_FULL, level)) / LAMP_FULL);
    paintBandStrip(ctx, strip, strip.canvas, strip.canvas.width, strip.canvas.height,
      strip.overlay, strip.classic, position, shade, lampLit);
  }

  function drawReelWindow(
    reel: ReelBand, sym: number,
    parked: boolean,
    lit?: number[],
    platformOffsetSteps = 0, platformReversed = false, mfmeIndex?: number,
    lampLevel?: (n: number) => number,
    detentSym = sym, detentIndex = mfmeIndex,
  ): void {
    const { left, top, width, height, canvas: band, stops, rheight } = reel;
    const reversed = platformReversed !== reel.reversed;
    const across = !!reel.stripHorizontal;
    const nativeSymW = across ? band.width / stops : band.width;
    const nativeSymH = across ? band.height : band.height / stops;
    const cell = (s: number): [number, number, number, number] => (across
      ? [s * nativeSymW, 0, nativeSymW, nativeSymH]
      : [0, s * nativeSymH, nativeSymW, nativeSymH]);
    const visible = reelVisibleSymbols(rheight);
    const drawSymH = height / visible;
    const centre = top + height / 2;

    if (reel.bandOffset !== undefined && !across) {
      const lineShift = reel.winlineShift ?? 0;
      const lineShift96 = (lineShift * 96) / stops;
      const effective = mfmeIndex
        ?? reelEffectivePosition(sym, reversed, platformOffsetSteps + lineShift96);
      const detentEffective = detentIndex ?? (detentSym === sym
        ? effective : reelEffectivePosition(detentSym, reversed, platformOffsetSteps + lineShift96));
      const centreRow = reelCentreRow(effective, stops, parked, detentEffective - lineShift96, reel.artCells);

      const horiz = !!reel.horizontal;
      const along = horiz ? stops * nativeSymW : band.height;
      const drum = drumVisibleSymbols(rheight, along, stops);
      const rowAt = drumRowMap(horiz ? width : height, drum, stops);
      const destSymH = height / drum;

      const wd = Math.max(0, Math.min(reel.widthDiff ?? 0, Math.floor((width - 1) / 2)));
      const bandLeft = left + wd;
      const bandWidth = width - 2 * wd;

      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, width, height);
      ctx.clip();
      if (wd > 0) {
        ctx.fillStyle = reel.fillColour ?? '#000';
        ctx.fillRect(left, top, width, height);
      }
      if (horiz) {
        const bandTop = top + wd;
        const bandH = height - 2 * wd;
        const stripLen = stops * nativeSymW;
        const cols = Math.max(8, Math.min(64, Math.ceil(width / 4)));
        for (let i = 0; i < cols; i++) {
          const x0 = Math.round((i * width) / cols);
          const x1 = Math.round(((i + 1) * width) / cols);
          if (x1 <= x0) continue;
          const len = (rowAt(x1) - rowAt(x0)) * nativeSymW;
          if (!(len > 0)) continue;
          const u = ((((centreRow + rowAt(x0)) * nativeSymW) % stripLen) + stripLen) % stripLen;
          for (const p of wrapPieces(x0, x1, u, len, stripLen, nativeSymW)) {
            ctx.drawImage(band, p.s, p.c * nativeSymH, p.sn, nativeSymH, left + p.d, bandTop, p.dn, bandH);
          }
        }
      }
      const slices = horiz ? 0 : Math.max(8, Math.min(64, Math.ceil(height / 4)));
      for (const p of drumBandSlices(height, slices, centreRow, rowAt, stops, nativeSymH)) {
        ctx.drawImage(band, 0, p.sy, band.width, p.sh, bandLeft, top + p.dy, bandWidth, p.dh);
      }
      const zones = backlightSlots(reel);
      if (lit && reel.darkness > 0 && !poolPerZone(reel) && zones.length) {
        const zoneH = height / zones.length;
        zones.forEach((slot, row) => {
          const shade = zoneShade(reel, lit[slot]);
          if (!shade) return;
          ctx.fillStyle = `rgba(0,0,0,${shade})`;
          ctx.fillRect(bandLeft, top + row * zoneH, bandWidth, zoneH);
        });
      }
      if (lampLevel) drawFancyLight(reel, lampLevel);
      drawDrumShading(reel);
      const lineR = lineShift ? drumScreenRadius(height, drum, stops) : Infinity;
      const edgeShift = lineShift && Number.isFinite(lineR)
        ? (e: number): number => lineR * (Math.sin((2 * Math.PI * (e - lineShift)) / stops)
          - Math.sin((2 * Math.PI * e) / stops))
        : undefined;
      if (!horiz) drawWinLines(reel, destSymH, bandLeft, bandWidth, edgeShift);
      drawReelBorder(reel.border);
      if (reel.overlay) ctx.drawImage(reel.overlay, left, top, width, height);
      ctx.restore();
      return;
    }

    let signed: number;
    if (reel.bandOffset !== undefined) {
      const sps = 96 / stops;
      const shift96 = ((reel.winlineShift ?? 0) * 96) / stops;
      const wrapped = ((sym % 96) + 96) % 96;
      const adjusted = reversed && wrapped !== 0 ? 96 - wrapped : wrapped;
      const effective = mfmeIndex ?? (((adjusted + platformOffsetSteps + shift96) % 96) + 96) % 96;
      let row = effective / sps;
      if (parked) {
        const wrappedD = ((detentSym % 96) + 96) % 96;
        const adjustedD = reversed && wrappedD !== 0 ? 96 - wrappedD : wrappedD;
        const detentEff = detentIndex
          ?? (((adjustedD + platformOffsetSteps + shift96) % 96) + 96) % 96;
        row = reelWinLineRow(detentEff - shift96, stops) + shift96 / sps
          + (row - detentEff / sps);
      }
      signed = row;
    } else {
      signed = sym;
    }
    const payline = ((signed % stops) + stops) % stops;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    let linePitch = drawSymH;
    if (visible === 1) {
      const scale = Math.min(width / nativeSymW, height / nativeSymH);
      const symH = nativeSymH * scale;
      linePitch = symH;
      const drawW = nativeSymW * scale;
      const dx = left + (width - drawW) / 2;
      ctx.fillStyle = reel.bg ?? '#000';
      ctx.fillRect(left, top, width, height);
      const cy = top + (height - symH) / 2;
      if (reel.horizontal) {
        const mid = left + width / 2;
        const f = payline - Math.floor(payline);
        const a = Math.max(Math.floor(left), Math.round(mid + (-1.5 - f) * drawW));
        const b = Math.min(Math.ceil(left + width), Math.round(mid + (1.5 - f) * drawW));
        const u = payline + 0.5 + (a - mid) / drawW;
        for (const p of wrapPieces(a, b, u, (b - a) / drawW, stops, 1)) {
          const [cx, cyS, cw, ch] = cell(p.c);
          ctx.drawImage(band, cx + p.s * cw, cyS, p.sn * cw, ch, p.d, cy, p.dn, symH);
        }
      } else {
        const f = payline - Math.floor(payline);
        const a = Math.max(Math.floor(top), Math.round(centre + (-1.5 - f) * symH));
        const b = Math.min(Math.ceil(top + height), Math.round(centre + (1.5 - f) * symH));
        const u = payline + 0.5 + (a - centre) / symH;
        for (const p of wrapPieces(a, b, u, (b - a) / symH, stops, 1)) {
          const [cx, cyS, cw, ch] = cell(p.c);
          ctx.drawImage(band, cx, cyS + p.s * ch, cw, p.sn * ch, dx, p.d, drawW, p.dn);
        }
      }
    } else {
      const a = Math.floor(top); const b = Math.ceil(top + height);
      const u = payline + 0.5 + (a - centre) / drawSymH;
      for (const p of wrapPieces(a, b, u, (b - a) / drawSymH, stops, 1)) {
        const [cx, cyS, cw, ch] = cell(p.c);
        ctx.drawImage(band, cx, cyS + p.s * ch, cw, p.sn * ch, left, p.d, width, p.dn);
      }
    }
    const zones = backlightSlots(reel);
    if (lit && reel.darkness > 0 && !poolPerZone(reel) && zones.length) {
      const zoneH = height / zones.length;
      zones.forEach((slot, row) => {
        const shade = zoneShade(reel, lit[slot]);
        if (!shade) return;
        ctx.fillStyle = `rgba(0,0,0,${shade})`;
        ctx.fillRect(left, top + row * zoneH, width, zoneH);
      });
    }
    drawDrumShading(reel);
    drawWinLines(reel, linePitch);
    if (reel.bandOffset !== undefined) drawReelBorder(reel.border);
    if (reel.overlay) ctx.drawImage(reel.overlay, left, top, width, height);
    ctx.restore();
  }

  function drawFrameStrip(
    fr: Rect & { stops: number; frames: ArrayLike<CanvasImageSource | null | undefined> },
    row: number,
  ): void {
    const a = Math.floor(fr.top); const b = Math.ceil(fr.top + fr.height);
    const u = row + (a - fr.top) / fr.height;
    for (const p of wrapPieces(a, b, u, (b - a) / fr.height, fr.stops, 1)) {
      const img = fr.frames[p.c] as (CanvasImageSource & { width: number; height: number }) | null | undefined;
      if (!img) continue;
      ctx.drawImage(img, 0, p.s * img.height, img.width, p.sn * img.height, fr.left, p.d, fr.width, p.dn);
    }
  }

  function drawReelBorder(b: ReelBorder | undefined): void {
    paintReelBorder(ctx, b);
  }

  function drawWinLines(
    reel: Rect & { winLines?: WinLines }, symPitch: number,
    left = reel.left, width = reel.width,
    edgeShift?: (edge: number) => number,
  ): void {
    const w = reel.winLines;
    if (!w) return;
    const segs = reelWinLines(w, left, reel.top, width, reel.height, symPitch, edgeShift);
    if (!segs.length) return;
    ctx.save();
    ctx.strokeStyle = w.colour;
    ctx.lineWidth = Math.max(1, w.thickness);
    ctx.beginPath();
    for (const s of segs) {
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawDrumShading(reel: ReelBand, left = reel.left, width = reel.width): void {
    if (!reel.gradient) return;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(reel.gradient, left, reel.top, width, reel.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  function displayText(m: FrameView): string {
    return glassText(m.display?.text() ?? '', vfdReversed);
  }

  function drawVfd(m: FrameView, r: Rect, glyphW: number): void {
    let disp = m.display;
    if (!disp) return;
    if (vfdBfm) {
      paintBfmAlpha(ctx, disp, r, vfdBfm, vfdReversed);
      return;
    }
    if (vfdReversed) {
      const chars = new Uint8Array(disp.chars).reverse();
      const cellWords = disp.cellWords ? new Uint32Array(disp.cellWords).reverse() : undefined;
      disp = { chars, cellWords, duty: disp.duty, text: disp.text };
    }
    const level = Math.min(31, disp.duty ?? 31) / 31;
    ctx.fillStyle = vfdSegColours?.bg ?? vfdBd1Style?.bg ?? '#050505';
    ctx.fillRect(r.left, r.top, r.width, r.height);
    if (vfdBd1Style || (vfdAtlas && glyphW > 0)) {
      drawVfdCells(disp, r, glyphW);
      return;
    }
    if (level <= 0) return;
    ctx.save();
    ctx.globalAlpha = level;
    try {
      drawVfdCells(disp, r, glyphW);
    } finally {
      ctx.restore();
    }
  }

  function drawVfdCells(disp: NonNullable<FrameView['display']>, r: Rect, glyphW: number): void {
    const codes = [...disp.chars].map((c) => c & 0x7f);
    const words = disp.cellWords
      ? [...disp.cellWords]
      : [...disp.chars].map((c) => (c & 0x7f) | (c & 0x80 ? 0x2e00 : 0));
    const cellText = codes.map((c) => (c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : ' ')).join('');
    const cw = r.width / 16;
    const drawDots = () => {
      ctx.fillStyle = vfdSegColours?.on ?? '#7ef';
      for (let i = 0; i < 16; i++) {
        if ((words[i] & CELL_CUSTOM) === 0 && (words[i] >> 8) & 0xff) {
          const d = Math.max(2, r.height * 0.12);
          ctx.fillRect(r.left + (i + 1) * cw - d * 1.4, r.top + r.height - d * 1.4, d, d);
        }
      }
    };
    if (vfdBd1Style) {
      const masks = words.map((w) => alphaCellRoles(w, vfdCharset, vfdSeg16));
      drawAlphaNew(ctx, masks, alphaNewGeom(vfdBd1Style, 16, r.width, r.height, vfdSeg16),
        vfdBd1Style, r.left, r.top, disp.duty ?? 31);
      return;
    }
    if (!vfdAtlas || glyphW <= 0) {
      drawSegmentText(ctx, cellText, 16, r.left, r.top, r.width, r.height, vfdSegColours);
      drawDots();
      return;
    }
    ctx.fillStyle = '#050505';
    ctx.fillRect(r.left, r.top, r.width, r.height);
    const gh = vfdAtlas.height;
    if (vfdGhost) {
      for (let i = 0; i < 16; i++) {
        ctx.drawImage(vfdGhost, 0, 0, vfdGhost.width, vfdGhost.height,
          r.left + i * cw, r.top, cw, r.height);
      }
    }
    ctx.save();
    ctx.globalAlpha = alphaAtlasIntensity(disp.duty ?? 31);
    for (let i = 0; i < 16; i++) {
      const g = atlasGlyph(codes[i]);
      if (g >= 0) {
        ctx.drawImage(vfdAtlas, g * glyphW, 0, glyphW, gh, r.left + i * cw, r.top, cw, r.height);
      } else if (cellText[i] !== ' ') {
        drawSegmentText(ctx, cellText[i], 1, r.left + i * cw, r.top, cw, r.height, vfdSegColours);
      }
      const punct = words[i] & CELL_CUSTOM ? 0 : (words[i] >> 8) & 0xff;
      const pg = punct === 0x2e || punct === 0x2c ? atlasGlyph(punct) : -1;
      if (pg >= 0) {
        ctx.drawImage(vfdAtlas, pg * glyphW, 0, glyphW, gh, r.left + i * cw, r.top, cw, r.height);
      }
    }
    ctx.restore();
  }

  function cellColumns(m: FrameView, text: string, cell: number): readonly number[] {
    const chip = vfdReversed ? 15 - cell : cell;
    const own = m.display?.cellGlyph?.(chip);
    const cols = own ? Array.from(own) : [...dotGlyph(text[cell] ?? ' ')];
    const gfx = m.display?.cellGfx?.(chip);
    if (gfx) for (let c = 0; c < 5; c++) if ((gfx[5] >> c) & 1) cols[c] = gfx[c];
    return cols;
  }

  function drawDotMatrix(
    m: FrameView, r: Rect,
    style: { on: string; off: string; bg: string } | null,
    metrics: { x: number; y: number; spacing: number; digitGap?: number } | null,
  ): void {
    if (metrics && metrics.digitGap !== undefined) {
      drawDotAlpha(m, r, style, { ...metrics, digitGap: metrics.digitGap });
      return;
    }
    ctx.fillStyle = style?.bg ?? '#050505';
    ctx.fillRect(r.left, r.top, r.width, r.height);

    const cellW = r.width / 16;
    const pitchX = metrics ? metrics.x + metrics.spacing : cellW / 7;
    const pitchY = metrics ? metrics.y + metrics.spacing : cellW / 7;
    const dotW = metrics ? metrics.x : Math.max(1, (cellW / 7) * 0.72);
    const dotH = metrics ? metrics.y : dotW;
    const gridW = metrics ? 16 * 6 * pitchX : r.width;
    const gridH = pitchY * 6 + dotH;
    const y0 = r.top + (r.height - gridH) / 2;
    const left = metrics ? r.left + (r.width - gridW) / 2 : r.left;
    const x0 = (cell: number) => (metrics
      ? left + cell * 6 * pitchX
      : r.left + cell * cellW + (cellW - pitchX * 4) / 2);

    const on = style?.on ?? DOT_ON;
    const off = style?.off ?? DOT_OFF;
    const text = displayText(m);
    for (let cell = 0; cell < 16; cell++) {
      const cols = cellColumns(m, text, cell);
      for (let c = 0; c < 5; c++) {
        for (let row = 0; row < 7; row++) {
          ctx.fillStyle = (cols[c] >> row) & 1 ? on : off;
          ctx.fillRect(
            x0(cell) + c * pitchX - (metrics ? 0 : dotW / 2),
            y0 + row * pitchY - (metrics ? 0 : dotH / 2),
            dotW, dotH,
          );
        }
      }
    }
  }

  function drawDotAlpha(
    m: FrameView, r: Rect,
    style: { on: string; off: string; bg: string } | null,
    g: { x: number; y: number; spacing: number; digitGap: number },
  ): void {
    const canvas = dotAlphaCanvas(g);
    const kx = r.width / canvas.width;
    const ky = r.height / canvas.height;
    const on = style?.on ?? DOT_ON;
    const off = style?.off ?? DOT_OFF;
    ctx.fillStyle = style?.bg ?? '#000000';
    ctx.fillRect(r.left, r.top, r.width, r.height);
    const text = displayText(m);
    const cells = Array.from({ length: 16 }, (_, cell) => cellColumns(m, text, cell));
    const punct = (cell: number) => m.display?.cellPunct?.(vfdReversed ? 15 - cell : cell) ?? 0;
    const dot = (cell: number, col: number, row: number) => {
      const p = dotAlphaDot(g, cell, col, row);
      ctx.fillRect(r.left + p.x * kx, r.top + p.y * ky, g.x * kx, g.y * ky);
    };
    ctx.fillStyle = off;
    for (let cell = 0; cell < 16; cell++) {
      for (let c = 0; c < 5; c++) for (let row = 0; row < 7; row++) dot(cell, c, row);
      dot(cell, 5, 0);
    }
    const duty = Math.max(0, Math.min(31, m.display?.duty ?? 31));
    const alpha = DOT_ALPHA_INTENSITY[duty] / 255;
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = on;
    for (let cell = 0; cell < 16; cell++) {
      const cols = cells[cell];
      for (let c = 0; c < 5; c++) {
        for (let row = 0; row < 7; row++) if ((cols[c] >> row) & 1) dot(cell, c, row);
      }
      if (punct(cell) & 0x80) dot(cell, 5, 0);
    }
    ctx.restore();
  }

  function drawVfdRect(text: string, r: Rect): void {
    drawSegmentText(ctx, text, 16, r.left, r.top, r.width, r.height);
  }

  function drawFallback(m: FrameView): void {
    drawVfdRect(displayText(m), { left: 40, top: 20, width: canvas.width - 80, height: 44 });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const reels = m.reels.filter((r) => r.travel !== 0);
    const shown = reels.length ? reels : m.reels.slice(0, 4);
    const w = Math.min(120, (canvas.width - 16 * (shown.length + 1)) / shown.length);
    shown.forEach((r, i) => {
      const x = (canvas.width - shown.length * (w + 16)) / 2 + i * (w + 16) + w / 2;
      ctx.fillStyle = '#f4f1e8';
      ctx.fillRect(x - w / 2, 100, w, 180);
      ctx.fillStyle = '#111';
      ctx.font = '56px system-ui, sans-serif';
      ctx.fillText(String(r.symbol()), x, 190);
    });
  }

  function resetDisplay(): void {
    vfdAtlas = null;
    vfdGhost = null;
    vfdBfm = null;
    vfdSegColours = undefined;
    vfdReversed = false;
    vfdBd1Style = null;
    vfdSeg16 = true;
    vfdCharset = undefined;
    vfdDots = null;
  }

  function loadDisplay(cab: Cabinet, virtualReversed: boolean): void {
    vfdBfm = null;
    if (cab.vfdFont && cab.vfdStripColumns) {
      vfdBfm = buildBfmAlphaCanvases(
        cab.vfdFont, cab.vfdInk ?? BFM_ALPHA_DEFAULT_INK,
        cab.vfdOffBrightness ?? BFM_ALPHA_DEFAULT_OFF_LEVEL, cab.vfdStripColumns,
      );
      vfdAtlas = null;
      vfdGhost = null;
    } else if (cab.vfdFont) {
      const layers = buildVfdLayers(
        cab.vfdFont,
        cab.vfdInk ?? ALPHA_DEFAULT_INK,
        cab.vfdGlyphWidth,
        cab.vfdOffBrightness ?? ALPHA_DEFAULT_OFF_BRIGHTNESS,
      );
      vfdAtlas = layers.chars;
      vfdGhost = layers.ghost;
    } else {
      vfdAtlas = null;
      vfdGhost = null;
    }
    vfdSegColours = cab.vfdColours
      ? {
          on: argbToCss(cab.vfdColours.on),
          off: argbToCss(cab.vfdColours.off),
          bg: argbToCss(cab.vfdColours.bg),
        }
      : undefined;
    vfdReversed = cab.vfdReversed ?? !!cab.vfdColours?.reversed;
    if (!cab.vfd) vfdReversed = virtualReversed;
    vfdCharset = cab.vfdColours?.charset;
    vfdSeg16 = cab.vfdColours?.seg16 ?? true;
    vfdBd1Style = cab.vfdColours && cab.vfdColours.charset !== undefined
      ? {
          on: argbToCss(cab.vfdColours.on),
          off: argbToCss(cab.vfdColours.off),
          bg: argbToCss(cab.vfdColours.bg),
          thickness: cab.vfdColours.thickness,
          slant: cab.vfdColours.slant,
          spacing: cab.vfdColours.spacing ?? 0,
          hSpacing: cab.vfdColours.hSpacing ?? 5,
          vSpacing: cab.vfdColours.vSpacing ?? 4,
          centre: cab.vfdColours.centre ?? 48,
          chop: cab.vfdColours.chop ?? 90,
        }
      : null;
    vfdDots = cab.vfdColours?.dot ?? null;
  }

  return {
    canvas,
    advance: updateReelCounters,
    paint,
    drawFallback,
    stillFrames,
    drawLog,
    invalidate(): void { if (renderIndex) renderIndex.lastKeys = null; },
    forget(): void { renderIndex = null; },
    resetDisplay,
    loadDisplay,
    get vfdReversed(): boolean { return vfdReversed; },
    set vfdReversed(on: boolean) { vfdReversed = on; },
    displayText,
    cellColumns,
  };
}

export type CabinetPainter = ReturnType<typeof createCabinetPainter>;
