import { LAMP_FULL, type FrameView } from '../src/machine/framestate';
import { drawnBounce } from './bouncepref';
import {
  bandStripWindow, flipReelFace, mfmeBandIndex, mfmeBoardReelPosition,
  mfmeFlipReelPosition, reelEffectivePosition, rgbLedColour,
  type BandStrip, type Cabinet, type CabLamp, type FlipStrip, type RgbLed,
} from './dat';
import { discAngleDeg } from './discreel';

export interface Sized {
  width: number;
  height: number;
}

export interface IntRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Counters {
  stillFrames: number[];
  frStill: number[];
}

export interface IndexedElement {
  extent: IntRect;
  key(m: FrameView, c: Counters): number;
}

export interface LightClusterGeom {
  bbox: { left: number; top: number; width: number; height: number };
  lamps: number[];
}

const INFLATE = 2;

function rect(left: number, top: number, width: number, height: number): IntRect {
  return {
    left: Math.floor(left) - INFLATE,
    top: Math.floor(top) - INFLATE,
    right: Math.ceil(left + width) + INFLATE,
    bottom: Math.ceil(top + height) + INFLATE,
  };
}

function union(a: IntRect, b: IntRect): IntRect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

function mix(h: number, v: number): number {
  return ((h * 33) ^ v) | 0;
}

function lampBit(m: FrameView, n: number): number {
  return m.layoutLampLevel(n);
}

export function cabLampLevel(m: FrameView, lp: Pick<CabLamp, 'led' | 'digitSeg'>, n: number): number {
  if (lp.digitSeg) return cabLampLit(m, lp, n) ? LAMP_FULL : 0;
  return lp.led && m.ledServed(n) ? (m.layoutLed(n) ? LAMP_FULL : 0) : m.layoutLampLevel(n);
}

export function cabLampLit(m: FrameView, lp: Pick<CabLamp, 'led' | 'digitSeg'>, n: number): boolean {
  if (lp.digitSeg) return ((m.layoutDigit(lp.digitSeg.digit) >>> lp.digitSeg.seg) & 1) === 1;
  return lp.led && m.ledServed(n) ? m.layoutLed(n) : m.layoutLamp(n);
}

const RGB_DIES = { led: true } as const;

export function rgbLedFrameColour(m: FrameView, led: RgbLed): number {
  return rgbLedColour(led, (n) => cabLampLit(m, RGB_DIES, n), (n) => m.muxLedColour(n));
}

function turned(
  e: IntRect, r: { left: number; top: number; width: number; height: number; angle?: number },
): IntRect {
  if (!r.angle) return e;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const rad = (r.angle * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
  let l = Infinity, t = Infinity, rt = -Infinity, b = -Infinity;
  for (const [x, y] of [[e.left, e.top], [e.right, e.top], [e.left, e.bottom], [e.right, e.bottom]]) {
    const dx = x - cx, dy = y - cy;
    const X = cx + dx * cs - dy * sn, Y = cy + dx * sn + dy * cs;
    l = Math.min(l, X); rt = Math.max(rt, X); t = Math.min(t, Y); b = Math.max(b, Y);
  }
  return { left: Math.floor(l) - INFLATE, top: Math.floor(t) - INFLATE, right: Math.ceil(rt) + INFLATE, bottom: Math.ceil(b) + INFLATE };
}

function lampExtent(lp: CabLamp<Sized>): IntRect {
  let e = rect(lp.left, lp.top, lp.width, lp.height);
  for (const st of lp.states) {
    e = union(e, rect(lp.left, lp.top, st.canvas.width, st.canvas.height));
  }
  if (lp.offState) {
    e = union(e, rect(lp.left, lp.top, lp.offState.canvas.width, lp.offState.canvas.height));
  }
  if (lp.legend) {
    const lines = (t: string | undefined): number =>
      t ? t.split(/\r?\n/).filter((s) => s.length).length : 0;
    const maxLines = Math.max(lines(lp.legend.on), lines(lp.legend.off), 1);
    const block = maxLines * 5.5 * 1.1 + 6;
    if (block > lp.height) {
      const cy = lp.top + lp.height / 2;
      e = union(e, rect(lp.left, cy - block / 2, lp.width, block));
    }
  }
  return turned(e, lp);
}

export function reelIndex(m: FrameView, w: { machineIndex: number; number?: number }): number {
  const byNumber = m.layout.reelsByLayoutNumber
    ?? (m.layout.system === 'SCORPION4' || m.layout.system === 'SCORPION5' || m.layout.system === 'ADDER5'
      || m.layout.system === 'MPS2');
  return byNumber && w.number !== undefined ? w.number : w.machineIndex;
}

export interface SettleMemory {
  travel: number[];
  pose: number[];
  frTravel: number[];
  frPose: number[];
}

export function newSettleMemory(): SettleMemory {
  return { travel: [], pose: [], frTravel: [], frPose: [] };
}

export function advanceSettleCounters(
  m: FrameView, cab: Cabinet<Sized>, c: Counters, mem: SettleMemory,
): void {
  const step = (
    arr: number[], travelMem: number[], poseMem: number[], i: number,
    travel: number, position: number, subStep: number,
  ): void => {
    const pose = position + subStep;
    const moved = travel !== travelMem[i] || pose !== poseMem[i];
    travelMem[i] = travel;
    poseMem[i] = pose;
    arr[i] = moved ? 0 : (arr[i] ?? 0) + 1;
  };
  for (const reel of cab.reels) {
    const i = reelIndex(m, reel);
    const r = m.reels[i];
    if (r) step(c.stillFrames, mem.travel, mem.pose, i, r.travel, r.position, r.subStep ?? 0);
  }
  for (const fr of cab.frameReels) {
    const i = reelIndex(m, fr);
    const r = m.reels[i];
    if (r) step(c.frStill, mem.frTravel, mem.frPose, i, r.travel, r.position, r.subStep ?? 0);
  }
  if (cab.featureReel) {
    const i = reelIndex(m, cab.featureReel);
    const r = m.reels[i];
    if (r) step(c.stillFrames, mem.travel, mem.pose, i, r.travel, r.position, r.subStep ?? 0);
  }
}

export function parkedForDraw(still: number | undefined): boolean {
  return (still ?? 0) >= 2;
}

export function reelKey(r: { travel: number; position: number; subStep?: number; bounce?: number }, still: number | undefined): number {
  const parked = parkedForDraw(still);
  const sub = parked ? 0 : Math.round((r.subStep ?? 0) * 255) + 256;
  return mix(mix(mix(mix(mix(0, r.travel | 0), r.position | 0), bounceKey(r)), parked ? 1 : 0), sub);
}

export function reelCentreRow(
  effective: number, stops: number, parked: boolean,
  snapFrom = effective,
  artCells?: number,
): number {
  const centreRow = (effective * stops) / 96 + 0.5;
  if (!parked) return centreRow;
  if (artCells && artCells > 0 && artCells !== stops) {
    const art = (snapFrom * artCells) / 96 + artCells / (2 * stops);
    return centreRow + ((Math.round(art - 0.5) + 0.5 - art) * stops) / artCells;
  }
  const detent = (snapFrom * stops) / 96 + 0.5;
  return centreRow + (Math.round(detent - 0.5) + 0.5 - detent);
}

function bounceKey(r: { bounce?: number }): number {
  return Math.round(drawnBounce(r) * 1000) | 0;
}

export function buildRenderIndex(
  cab: Cabinet<Sized>, clusters: LightClusterGeom[],
  heldInput: (input: number) => boolean = () => false,
): IndexedElement[] {
  const els: IndexedElement[] = [];

  cab.reels.forEach((reel) => {
    const zoneLamps = (reel.lampTray ?? reel.lampNums).filter((n) => n >= 0);
    els.push({
      extent: turned(rect(reel.left, reel.top, reel.width, reel.height), reel),
      key: (m, c) => {
        const i = reelIndex(m, reel);
        const r = m.reels[i];
        if (!r) return 0;
        let h = reelKey(r, c.stillFrames[i]);
        for (const n of zoneLamps) h = mix(h, lampBit(m, n));
        return h;
      },
    });
  });

  for (const strip of cab.bandReels ?? []) {
    els.push({
      extent: turned(rect(strip.left, strip.top, strip.width, strip.height), strip),
      key: (m) => {
        const r = m.reels[reelIndex(m, strip)];
        if (!r) return 0;
        let h = mix(mix(mix(0, r.travel | 0), r.position | 0), bounceKey(r));
        for (const n of strip.lampNums) h = mix(h, lampBit(m, n));
        if (strip.classic?.lamps) for (const n of strip.classic.slotLamps) if (n >= 0) h = mix(h, lampBit(m, n));
        return h;
      },
    });
  }

  for (const f of cab.flipReels ?? []) {
    els.push({
      extent: turned(rect(f.left, f.top, f.width, f.height), f),
      key: (m) => {
        const r = m.reels[reelIndex(m, f)];
        return r ? mix(mix(mix(0, r.travel | 0), r.position | 0), bounceKey(r)) : 0;
      },
    });
  }

  cab.frameReels.forEach((fr) => {
    els.push({
      extent: rect(fr.left, fr.top, fr.width, fr.height),
      key: (m, c) => {
        const i = reelIndex(m, fr);
        const r = m.reels[i];
        return r ? reelKey(r, c.frStill[i]) : 0;
      },
    });
  });

  if (cab.featureReel) {
    const fr = cab.featureReel;
    els.push({
      extent: rect(fr.left, fr.top, fr.width, fr.height),
      key: (m, c) => {
        const i = reelIndex(m, fr);
        const r = m.reels[i];
        return r ? reelKey(r, c.stillFrames[i]) : 0;
      },
    });
  }

  for (const cl of clusters) {
    const lamps = cl.lamps.filter((n) => n >= 0);
    els.push({
      extent: rect(cl.bbox.left, cl.bbox.top, cl.bbox.width, cl.bbox.height),
      key: (m) => {
        let h = 0;
        for (const n of lamps) h = mix(h, lampBit(m, n));
        return h;
      },
    });
  }

  const displayKey = (m: FrameView): number => {
    const disp = m.display;
    if (!disp) return 0;
    let h = mix(0, disp.duty ?? 31);
    for (let i = 0; i < 16; i++) {
      h = mix(h, (disp.chars[i] ?? 0) ^ ((disp.cellWords?.[i] ?? 0) * 31));
    }
    return h;
  };
  if (cab.vfd) {
    const r = cab.vfd;
    els.push({ extent: turned(rect(r.left, r.top, r.width, r.height), r), key: displayKey });
  } else {
    els.push({
      extent: rect(
        cab.content.left + 8, cab.content.top + 8,
        cab.content.width - 16, Math.max(24, cab.content.height * 0.04),
      ),
      key: displayKey,
    });
  }

  for (const lp of cab.lamps) {
    const extent = lampExtent(lp);
    els.push({
      extent,
      key: (m) => {
        let h = 0;
        for (const st of lp.states) h = mix(h, cabLampLevel(m, lp, st.n));
        if (lp.offState) h = mix(h, lp.offState.nums.some((n) => cabLampLit(m, lp, n)) ? 1 : 0);
        if (lp.offDim) h = mix(h, lp.offDim.nums.some((n) => cabLampLit(m, lp, n)) ? 1 : 0);
        if (lp.legend && lp.legend.lamp >= 0) h = mix(h, lampBit(m, lp.legend.lamp));
        if (lp.legend?.input !== undefined) h = mix(h, heldInput(lp.legend.input) ? 1 : 0);
        if (lp.litFill) h = mix(h, lampBit(m, lp.litFill.n));
        if (lp.button !== undefined
          && (lp.states.some((st) => st.down) || lp.offState?.down)) {
          h = mix(h, heldInput(lp.button) ? 1 : 0);
        }
        return h;
      },
    });
  }

  for (const led of cab.rgbLeds ?? []) {
    els.push({
      extent: turned(rect(led.left, led.top, led.width, led.height), led),
      key: (m) => mix(0, rgbLedFrameColour(m, led) | 0),
    });
  }

  for (const p of cab.prismLamps ?? []) {
    els.push({
      extent: turned(rect(p.left, p.top, p.width, p.height), p),
      key: (m) => mix(
        mix(0, p.lamp1 >= 0 ? lampBit(m, p.lamp1) : 0),
        p.lamp2 >= 0 ? lampBit(m, p.lamp2) : 0,
      ),
    });
  }

  for (const s of cab.segDisplays ?? []) {
    els.push({
      extent: turned(rect(s.left, s.top, s.width, s.height), s),
      key: (m) => {
        if (s.digit !== undefined) {
          let h = mix(mix(0, m.layoutDigit(s.digit)), m.layoutDigitLevel?.(s.digit) ?? 0xff);
          for (let seg = 0; seg < 8; seg++) h = mix(h, m.layoutDigitSegLevel(s.digit, seg));
          return h;
        }
        let h = 0;
        for (const lamp of s.seg) h = mix(h, lamp >= 0 && m.layoutLamp(lamp) ? 1 : 0);
        return h;
      },
    });
  }

  for (const d of [cab.dotMatrix, cab.plasmaPanel]) {
    if (!d) continue;
    els.push({
      extent: turned(rect(d.left, d.top, d.width, d.height), d),
      key: (m) => {
        let h = 0;
        for (let i = 0; i < m.dotsRaw.length; i++) h = mix(h, m.dotsRaw[i]);
        return h;
      },
    });
  }
  for (const d of [cab.epochDotAlpha, cab.maygayMatrix, cab.epochMatrix]) {
    if (!d) continue;
    els.push({
      extent: turned(rect(d.left, d.top, d.width, d.height), d),
      key: (m) => {
        let h = 0;
        for (let i = 0; i < m.lcdRaw.length; i++) h = mix(h, m.lcdRaw[i]);
        return h;
      },
    });
  }
  if (cab.proconnMatrix) {
    const d = cab.proconnMatrix;
    els.push({
      extent: turned(rect(d.left, d.top, d.width, d.height), d),
      key: (m) => {
        let h = 0;
        for (let i = 0; i < m.lcdRaw.length; i++) h = mix(h, m.lcdRaw[i]);
        return h;
      },
    });
  }
  if (cab.videoScreen) {
    const d = cab.videoScreen;
    els.push({
      extent: turned(rect(d.left, d.top, d.width, d.height), d),
      key: (m) => mix(m.epoch, m.videoSerial),
    });
  }

  return els;
}

export function platformReelOffsetSteps(system: string, reelReversed: boolean): number {
  void system;
  const park = 0;
  return reelReversed ? 0 - park : park;
}

export function platformRequiresReversal(system: string): boolean {
  void system;
  return false;
}

export interface DrawnReelSpec {
  stops?: number;
  reversed: boolean;
  bandOffset?: number;
  offset?: number;
  literalOffsetSign?: boolean;
  winlinesOffset?: number;
  artCells?: number;
}

export function winlinesOffset96(
  reel: Pick<DrawnReelSpec, 'winlinesOffset'>, stepsPerRevolution: number,
): number {
  const w = reel.winlinesOffset ?? 0;
  return w ? (w * 96) / (stepsPerRevolution || 96) : 0;
}

export function drawnBandIndex(
  system: string, reel: DrawnReelSpec, stepsPerRevolution: number, pos: number,
  stripOffsetSteps = 0,
): number {
  const stops = reel.stops || 16;
  const perRev = stepsPerRevolution || 96;
  const sym = (pos * 96) / perRev;
  const reversed = platformRequiresReversal(system) !== reel.reversed;
  const offset = (reel.bandOffset ?? reel.offset ?? 0) + (reel.winlinesOffset ?? 0);
  const mfmeIndex = mfmeBandIndex(
    system, sym, offset, reversed, stops,
    reel.literalOffsetSign === true, stepsPerRevolution,
    reel.bandOffset === undefined,
  );
  return mfmeIndex ?? reelEffectivePosition(
    sym, reversed, platformReelOffsetSteps(system, reel.reversed) + stripOffsetSteps
      + winlinesOffset96(reel, stepsPerRevolution),
  );
}

export function unsnappedWinLineRow(
  system: string, reel: DrawnReelSpec, stepsPerRevolution: number, pos: number,
  stripOffsetSteps = 0,
): number {
  const stops = reel.stops || 16;
  const effective = drawnBandIndex(system, reel, stepsPerRevolution, pos, stripOffsetSteps)
    - winlinesOffset96(reel, stepsPerRevolution);
  const row = reelCentreRow(effective, stops, false) - 0.5;
  const cells = reel.artCells;
  return cells && cells > 0 && cells !== stops ? ((row + 0.5) * cells) / stops - 0.5 : row;
}

export function winLineErrorHalfSteps(
  system: string, reel: DrawnReelSpec, stepsPerRevolution: number, pos: number,
  stripOffsetSteps = 0,
): number {
  const row = unsnappedWinLineRow(system, reel, stepsPerRevolution, pos, stripOffsetSteps);
  const stops = reel.artCells || reel.stops || 16;
  const perSymbol = (stepsPerRevolution || 96) / stops;
  return (row - Math.round(row)) * perSymbol;
}

export const WIN_LINE_TOLERANCE_HALF_STEPS = 0.5;

export function declaredOffsetResidueHalfSteps(
  reel: Pick<DrawnReelSpec, 'stops' | 'bandOffset' | 'offset' | 'artCells'>, stepsPerRevolution: number,
): number {
  const perSymbol = (stepsPerRevolution || 96) / (reel.artCells || reel.stops || 16);
  const offset = reel.bandOffset ?? reel.offset ?? 0;
  const residue = offset - Math.round(offset / perSymbol) * perSymbol;
  return Math.abs(residue) < 1e-9 ? 0 : residue;
}

export function winLineErrorBeyondDeclaredOffset(
  system: string, reel: DrawnReelSpec, stepsPerRevolution: number, pos: number,
  stripOffsetSteps = 0,
): number {
  const residue = declaredOffsetResidueHalfSteps(reel, stepsPerRevolution);
  if (residue === 0) return winLineErrorHalfSteps(system, reel, stepsPerRevolution, pos, stripOffsetSteps);
  const whole: DrawnReelSpec = reel.bandOffset !== undefined
    ? { ...reel, bandOffset: reel.bandOffset - residue }
    : { ...reel, offset: (reel.offset ?? 0) - residue };
  return winLineErrorHalfSteps(system, whole, stepsPerRevolution, pos, stripOffsetSteps);
}

export function restIsDeclaredOffset(
  errorHalfSteps: number, beyondDeclaredHalfSteps: number, mfmeSavedErrorHalfSteps?: number,
): boolean {
  const tol = WIN_LINE_TOLERANCE_HALF_STEPS;
  return Math.abs(errorHalfSteps) > tol
    && Math.abs(beyondDeclaredHalfSteps) <= tol
    && (mfmeSavedErrorHalfSteps === undefined || Math.abs(mfmeSavedErrorHalfSteps - errorHalfSteps) <= tol);
}

export type ReelKind = 'band' | 'frame' | 'spinner' | 'disc' | 'flip' | 'feature';

export const REEL_KIND_LAWS: Readonly<Record<ReelKind, string>> = {
  band: 'a whole symbol centred on the win line (TGRFancyReel / .fml Reel 0x03)',
  frame: 'a whole window frame on the line (classic .dat TReel main reel; since B-211 the SAME chain as a band)',
  spinner: 'whole cells in the window, no half-cell (TGRBandReel / .fml 0x08)',
  disc: 'the disc pointing at a whole stop (TGRDiscReel / .fml 0x06)',
  flip: 'the flap resting ON its detent, unnudged (TGRFlipReel / .fml 0x2D)',
  feature: 'a whole frame in the window (classic .dat TReel with Stops > 0)',
};

const offWhole = (value: number, unitHalfSteps: number): number =>
  (value - Math.round(value)) * unitHalfSteps;

export function spinnerRestErrorHalfSteps(
  system: string,
  strip: Pick<BandStrip<unknown>, 'stops' | 'halfSteps' | 'view' | 'spacing'
    | 'bandOffset' | 'reversed' | 'horizontal'>,
  stepsPerRevolution: number, position: number,
): number {
  const perRev = stepsPerRevolution || strip.halfSteps;
  const raw = perRev === strip.halfSteps ? position : (position * strip.halfSteps) / perRev;
  const pos = mfmeBoardReelPosition(system, raw, strip.halfSteps);
  const w = bandStripWindow(strip, 1, 1, pos);
  const stops = strip.stops || 16;
  const cells = (w.pos * stops) / (strip.halfSteps || 1);
  return offWhole(cells, (strip.halfSteps / stops) * (perRev / (strip.halfSteps || 1)));
}

export function discRestErrorHalfSteps(
  system: string, disc: { stops: number; steps: number; offsetDeg: number; reversed: boolean },
  stepsPerRevolution: number, position: number,
): number {
  const steps = stepsPerRevolution || disc.steps || 96;
  const stops = disc.stops || 12;
  const deg = discAngleDeg(system, position, steps, disc.offsetDeg, disc.reversed);
  return offWhole((deg * stops) / 360, steps / stops);
}

export function discOffsetStops(
  disc: { stops: number; offsetDeg: number },
): number {
  const stops = disc.stops || 12;
  return (-disc.offsetDeg * stops) / 360;
}

export function flipRestErrorHalfSteps(
  system: string, flip: Pick<FlipStrip<unknown>, 'stops' | 'halfSteps' | 'offset'>,
  stepsPerRevolution: number, position: number,
): number {
  const halfSteps = flip.halfSteps || 0;
  if (!halfSteps || !flip.stops) return 0;
  const perRev = stepsPerRevolution || halfSteps;
  const raw = perRev === halfSteps ? position : (position * halfSteps) / perRev;
  const pos = mfmeFlipReelPosition(system, Math.round(raw), halfSteps);
  const pitch = Math.max(1, Math.trunc(halfSteps / flip.stops));
  const phase = ((pos % pitch) + pitch) % pitch;
  const signed = phase > pitch / 2 ? phase - pitch : phase;
  return signed * (perRev / halfSteps);
}

export function flipRestFace(
  system: string, flip: Pick<FlipStrip<unknown>, 'stops' | 'halfSteps' | 'offset'>,
  stepsPerRevolution: number, position: number,
): { stop: number; phase: number; nudge: number } {
  const halfSteps = flip.halfSteps || 0;
  if (!halfSteps) return { stop: 0, phase: 0, nudge: 0 };
  const perRev = stepsPerRevolution || halfSteps;
  const raw = perRev === halfSteps ? position : (position * halfSteps) / perRev;
  return flipReelFace(flip, mfmeFlipReelPosition(system, Math.round(raw), halfSteps));
}

export interface FeatureReelSpec {
  stops: number;
  offset?: number;
  reversed?: boolean;
  horizontal?: boolean;
}

export function featureReelContinuous(
  system: string, reel: FeatureReelSpec, stepsPerRevolution: number, position: number,
): number {
  const stops = reel.stops || 12;
  const band = drawnBandIndex(system, {
    stops,
    offset: reel.offset ?? 0,
    reversed: (reel.reversed ?? false) !== (reel.horizontal ?? false),
  }, stepsPerRevolution, position);
  return (band * stops) / 96;
}

export function featureRestErrorHalfSteps(
  system: string, reel: FeatureReelSpec, stepsPerRevolution: number, position: number,
): number {
  const value = featureReelContinuous(system, reel, stepsPerRevolution, position);
  return offWhole(value, stepsPerRevolution / (reel.stops || 12));
}
