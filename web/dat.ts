import type { DiscLamps } from './discreel';
import { unzlibSync } from 'fflate';
import { isAacsContainer, readAacsContainer } from './fml';
import { fillShape, flatTrim, isFmlLayout, ledFace, parseFmlLayout, sidewaysCrop } from './fmllayout';
import { shortcutKnown } from './shortcuts';
import { PASS } from './draworder';
import { str } from './i18n';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  z?: number;
  angle?: number;
}

export interface BandStrip<A = ImageBitmap> extends Rect {
  machineIndex: number;
  number?: number;
  canvas: A;
  overlay?: A;
  stops: number;
  halfSteps: number;
  view: number;
  spacing: number;
  bandOffset: number;
  reversed: boolean;
  horizontal: boolean;
  lampNums: number[];
  darkness: number;
  border?: ReelBorder;
  classic?: BandClassic<A>;
}

export interface BandClassic<A = ImageBitmap> {
  lamps: boolean;
  slotLamps: number[];
  mask?: A;
  unlit: number;
}

export function mfmeBoardReelPosition(
  system: string, position: number, steps: number,
): number {
  if (!steps) return position;
  const ADJUST = 5;
  if (system === 'SCORPION4' || system === 'SCORPION5' || system === 'ADDER5') {
    return (((steps + ADJUST - position) % steps) + steps) % steps;
  }
  if (system === 'IMPACT') {
    return (((position + IMPACT_DISPLAY_SHIFT) % steps) + steps) % steps;
  }
  if (system === 'SCORPION1') {
    return (((position + SC1_DISPLAY_SHIFT) % steps) + steps) % steps;
  }
  if (system === 'M1AB') {
    return (((position + M1AB_DISPLAY_SHIFT) % steps) + steps) % steps;
  }
  if (system === 'MPS2') {
    const MPS2_ADJUST = 3;
    return (((steps + MPS2_ADJUST - position) % steps) + steps) % steps;
  }
  return position;
}

const IMPACT_ADJUST = 7;

const IMPACT_MODEL_HOME = 9;

const IMPACT_DISPLAY_SHIFT = IMPACT_ADJUST - IMPACT_MODEL_HOME;

const M1AB_ADJUST = 1;

const M1AB_MODEL_HOME = 1;

const M1AB_DISPLAY_SHIFT = M1AB_ADJUST - M1AB_MODEL_HOME;

const SC1_ADJUST = 7;

const SC1_MODEL_HOME = 9;

const SC1_DISPLAY_SHIFT = SC1_ADJUST - SC1_MODEL_HOME;

export function bandStripWindow(
  strip: Pick<BandStrip<unknown>, 'stops' | 'halfSteps' | 'view' | 'spacing'
    | 'bandOffset' | 'reversed' | 'horizontal' | 'classic'>,
  bandWidth: number, bandHeight: number, position: number,
): { pos: number; start: number; along: number; bandLen: number; winLen: number } {
  const { stops, halfSteps, view } = strip;
  let p = position - strip.bandOffset;
  if (strip.reversed) p = halfSteps - p;
  const pos = ((p % halfSteps) + halfSteps) % halfSteps;
  const cell = bandStripCell(stops, bandWidth, bandHeight, 0, !!strip.classic);
  const along = strip.horizontal ? cell[2] : cell[3];
  const bandLen = stops * along;
  const at = (pos * bandLen) / halfSteps;
  return {
    pos,
    start: (strip.classic ? Math.floor(at) : Math.round(at)) - strip.spacing,
    along,
    bandLen,
    winLen: view * along + 2 * strip.spacing,
  };
}

export function bandStripCell(
  stops: number, bandWidth: number, bandHeight: number, k: number,
  down = false,
): [number, number, number, number] {
  if (down) {
    const h = Math.floor(bandHeight / stops);
    return [0, k * h, bandWidth, h];
  }
  if (bandHeight < bandWidth) {
    const w = bandWidth / stops;
    return [k * w, 0, w, bandHeight];
  }
  const h = bandHeight / stops;
  return [0, k * h, bandWidth, h];
}

export interface FlipStrip<A = ImageBitmap> extends Rect {
  machineIndex: number;
  number?: number;
  canvas: A;
  overlay?: A;
  stops: number;
  halfSteps: number;
  offset: number;
  inset: number;
  borderWidth: number;
  borderColour: number;
  lampsEnabled?: boolean;
  lampNums?: number[];
  mask1?: A;
  mask2?: A;
  mask3?: A;
  lightFloor?: [number, number, number];
}

export function flipLight(
  f: Pick<FlipStrip<unknown>, 'lampsEnabled' | 'lampNums' | 'lightFloor'>,
  level: (n: number) => number, full = 255,
): { base: [number, number, number]; mask: 0 | 1 | 2 | null; alpha: number } | null {
  if (!f.lampsEnabled) return null;
  const floor = f.lightFloor ?? [255, 255, 255];
  let out: { base: [number, number, number]; mask: 0 | 1 | 2 | null; alpha: number } =
    { base: floor, mask: null, alpha: 0 };
  for (let i = 0; i < 3; i++) {
    const n = f.lampNums?.[i] ?? -2;
    if (n === -2) continue;
    const l = n === -1 ? full : Math.max(0, Math.min(full, level(n)));
    if (l <= 0) continue;
    out = { base: i === 0 ? floor : [255, 255, 255], mask: i as 0 | 1 | 2, alpha: l / full };
  }
  return out;
}

export function paintFlipLight(
  lx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number, h: number,
  plan: { base: [number, number, number]; mask: 0 | 1 | 2 | null; alpha: number },
  masks: readonly (CanvasImageSource | undefined)[],
): void {
  lx.save();
  lx.globalCompositeOperation = 'source-over';
  lx.globalAlpha = 1;
  lx.fillStyle = `rgb(${plan.base[0]},${plan.base[1]},${plan.base[2]})`;
  lx.fillRect(0, 0, w, h);
  const m = plan.mask === null ? undefined : masks[plan.mask];
  if (m && plan.alpha > 0) {
    lx.globalAlpha = Math.min(1, plan.alpha);
    lx.drawImage(m, 0, 0, w, h);
  }
  lx.restore();
}

export function mfmeFlipReelPosition(system: string, position: number, halfSteps: number): number {
  if (!halfSteps) return position;
  if (system === 'SYS1' || system === 'SCORPION4' || system === 'SCORPION5' || system === 'ADDER5') {
    return (((halfSteps - position) % halfSteps) + halfSteps) % halfSteps;
  }
  return position;
}

const FLIP_NUDGE: Readonly<Record<number, readonly number[]>> = {
  4: [0, -1, 2, 1],
  6: [0, -1, -2, 3, 2, 1],
};

export function flipReelFace(
  strip: Pick<FlipStrip<unknown>, 'stops' | 'halfSteps' | 'offset'>, position: number,
): { stop: number; phase: number; nudge: number } {
  const { stops, halfSteps } = strip;
  if (!stops || !halfSteps) return { stop: 0, phase: 0, nudge: 0 };
  const pos = (((halfSteps * 16 + position - strip.offset) % halfSteps) + halfSteps) % halfSteps;
  const pitch = Math.max(1, Math.trunc(halfSteps / stops));
  const stop = Math.trunc(((pitch >> 1) + pos) % halfSteps / pitch) % stops;
  const phase = pos % pitch;
  return { stop, phase, nudge: FLIP_NUDGE[pitch]?.[phase] ?? 0 };
}

export function paintFlip(
  fx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  f: Rect & Pick<FlipStrip<unknown>, 'stops' | 'inset' | 'borderWidth' | 'borderColour'>,
  flaps: CanvasImageSource, bandW: number, bandH: number,
  face: { stop: number; nudge: number }, overlay?: CanvasImageSource,
  light?: CanvasImageSource,
): void {
  const { left: x, top: y, width: w, height: h, stops, inset: i } = f;
  const cellH = bandH / stops;
  const j = face.nudge;
  fx.save();
  fx.beginPath();
  fx.rect(x, y, w, h);
  fx.clip();
  fx.fillStyle = '#fff';
  fx.fillRect(x, y, w, h);
  const fw = w - 2 * i;
  const fh = h - 3 * i;
  if (fw > 0 && fh > 0) {
    fx.drawImage(flaps, 0, face.stop * cellH, bandW, cellH, x + i, y + i + j, fw, fh);
  }
  if (light && fw > 0 && h - 2 * i > 0) {
    fx.globalCompositeOperation = 'multiply';
    fx.drawImage(light, x + i, y + i, fw, h - 2 * i);
    fx.globalCompositeOperation = 'source-over';
  }
  fx.fillStyle = '#000';
  fx.fillRect(x + i, y + Math.trunc(h / 2) + j, Math.max(0, w - 2 * i + 1), 1);
  const bw = Math.min(f.borderWidth, Math.floor(Math.min(w, h) / 2));
  if (bw > 0) {
    const c = f.borderColour >>> 0;
    fx.fillStyle = `rgba(${(c >>> 16) & 255},${(c >>> 8) & 255},${c & 255},${((c >>> 24) & 255) / 255})`;
    fx.fillRect(x, y, w, bw);
    fx.fillRect(x, y + h - bw, w, bw);
    fx.fillRect(x, y, bw, h);
    fx.fillRect(x + w - bw, y, bw, h);
  }
  fx.restore();
  if (overlay) fx.drawImage(overlay, x, y);
}

export interface BonusReel<A = ImageBitmap> extends Rect {
  machineIndex: number;
  number?: number;
  frames: number;
  radius: number;
  background?: A;
  symbols: (A | undefined)[];
  mask?: A;
  lightFloor?: [number, number, number];
  lampNums: number[];
  overlay?: A;
  windowW: number;
  windowH: number;
}

export function mfmeBonusReelPosition(system: string, position: number, steps: number): number {
  if (system !== 'MPS2' || !steps) return position;
  return (((steps - position) % steps) + steps) % steps;
}

export function bonusReelFrame(b: Pick<BonusReel<unknown>, 'frames'>, handed: number): { frame: number; angle: number } {
  const n = b.frames > 0 ? b.frames : 96;
  const frame = (((16 * n - Math.trunc(handed)) % n) + n) % n;
  return { frame, angle: (2 * Math.PI / n) * frame };
}

function bonusCentre(b: Rect & { radius: number }, angle: number, i: number): [number, number] {
  const a = angle + Math.PI + Math.PI / 2 + Math.PI / 4 + i * (Math.PI / 2);
  return [Math.trunc(b.width / 2) + b.radius * Math.sin(a), Math.trunc(b.height / 2) - b.radius * Math.cos(a)];
}

export function bonusWindows(b: Pick<BonusReel<unknown>, 'width' | 'height' | 'left' | 'top' | 'radius' | 'windowW' | 'windowH'>): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < 4; i++) {
    const [cx, cy] = bonusCentre(b, 0, i);
    const left = Math.trunc(cx - (b.windowW >> 1));
    const top = Math.trunc(cy - (b.windowH >> 1));
    out.push({ left, top, width: b.windowW, height: b.windowH });
  }
  return out;
}

export function paintBonusLight(
  lx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  b: BonusReel<CanvasImageSource>, lit: readonly boolean[],
): void {
  const floor = b.lightFloor;
  if (!floor) return;
  lx.save();
  lx.globalCompositeOperation = 'source-over';
  lx.globalAlpha = 1;
  lx.fillStyle = `rgb(${floor[0]},${floor[1]},${floor[2]})`;
  lx.fillRect(0, 0, b.width, b.height);
  if (b.mask) {
    bonusWindows(b).forEach((r, i) => {
      if (lit[i]) lx.drawImage(b.mask!, r.left, r.top, r.width, r.height);
    });
  }
  lx.restore();
}

export function paintBonusReel(
  fx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  b: BonusReel<CanvasImageSource>, angle: number, light?: CanvasImageSource,
): void {
  const { left: x, top: y, width: w, height: h } = b;
  if (w <= 0 || h <= 0) return;
  fx.save();
  fx.beginPath();
  fx.rect(x, y, w, h);
  fx.clip();
  fx.fillStyle = '#fff';
  fx.fillRect(x, y, w, h);
  if (b.background) fx.drawImage(b.background, x, y, w, h);
  b.symbols.forEach((s, i) => {
    if (!s) return;
    const sw = (s as { width: number }).width, sh = (s as { height: number }).height;
    const [cx, cy] = bonusCentre(b, angle, i);
    fx.drawImage(s, x + Math.trunc(cx - (sw >> 1)), y + Math.trunc(cy - (sh >> 1)));
  });
  if (light) {
    fx.globalCompositeOperation = 'multiply';
    fx.drawImage(light, x, y);
    fx.globalCompositeOperation = 'source-over';
  }
  fx.restore();
  if (b.overlay) fx.drawImage(b.overlay, x, y);
}

export interface ReelBand<A = ImageBitmap> extends Rect {
  machineIndex: number;
  number?: number;
  darkness: number;
  lampNums: number[];
  canvas: A;
  stops: number;
  rheight: number;
  reversed: boolean;
  horizontal?: boolean;
  stripHorizontal?: boolean;
  bandOffset?: number;
  offset?: number;
  winlinesOffset?: number;
  winlineShift?: number;
  artCells?: number;
  literalOffsetSign?: boolean;
  widthDiff?: number;
  fillColour?: string;
  overlay?: A;
  bg?: string;
  mask?: A;
  mask2?: A;
  mask3?: A;
  lampTray?: number[];
  lampsEnabled?: boolean;
  lightFloor?: [number, number, number];
  opaqueKey?: [number, number, number];
  gradient?: A;
  winLines?: WinLines;
  border?: ReelBorder;
  disc?: {
    steps: number; offsetDeg: number;
    reversed?: boolean;
    lamps?: DiscLamps;
    backing?: [number, number, number];
    wholeDegrees?: boolean;
  };
  discMask?: A;
  discInnerMask?: A;
  discPunch?: A;
  discBaseOverlay?: A;
}

export function hasInput<T extends { button?: number }>(lp: T): lp is T & { button: number } {
  return lp.button !== undefined;
}

export interface CabLamp<A = ImageBitmap> {
  left: number;
  top: number;
  width: number;
  height: number;
  z?: number;
  angle?: number;
  states: { n: number; canvas: A; down?: A }[];
  button?: number;
  acceptor?: { line?: number; token?: boolean; note?: number; effect?: number };
  coinInput?: number;
  label?: string;
  name?: string;
  litFill?: { n: number; colour: number };
  enableLamp?: number;
  enableLatched?: boolean;
  enableLamps?: number[];
  shortcut?: number;
  shortcut2?: number;
  hidden?: boolean;
  cap?: boolean;
  blend?: boolean;
  multi?: boolean;
  led?: boolean;
  rgb?: { bits: number[]; faces: (A | null)[] };
  offUnder?: boolean;
  digitSeg?: { digit: number; seg: number };
  legend?: {
    off?: string;
    on?: string;
    colour: number;
    fill?: number;
    face: string;
    points?: number;
    style?: number;
    dx?: number;
    dy?: number;
    lamp: number;
    litOnly?: true;
    wholeLitOnly?: true;
    align?: 'left' | 'right';
    valign?: 'top' | 'bottom';
    nowrap?: true;
    input?: number;
  };
  offState?: { nums: number[]; canvas: A; down?: A };
  offDim?: { nums: number[]; alpha: number };
}

export interface FeatureReel<A = ImageBitmap> extends Rect {
  stops: number;
  frames: A[];
  darkness: number;
  lamp: number;
  mask?: A;
  machineIndex: number;
  number?: number;
  rheight: number;
  offset: number;
  reversed: boolean;
  horizontal: boolean;
  winLines?: WinLines;
  border?: ReelBorder;
}

export interface Cabinet<A = ImageBitmap> {
  width: number;
  height: number;
  decode?: { clean: number; total: number };
  background: A | null;
  backgroundRect: Rect;
  backgroundOffset?: { x: number; y: number };
  backgroundColour?: number | null;
  backgroundKey?: number | null;
  backdrop?: A | null;
  reels: ReelBand<A>[];
  bandReels?: BandStrip<A>[];
  flipReels?: FlipStrip<A>[];
  bonusReels?: BonusReel<A>[];
  lamps: CabLamp<A>[];
  vfd: Rect | null;
  vfdIsDots: boolean;
  vfdFont: A | null;
  vfdGlyphWidth: number;
  vfdInk?: number | null;
  vfdOffBrightness?: number;
  vfdStripColumns?: number;
  vfdReversed: boolean;
  content: Rect;
  column?: Rect;
  trimmed?: Rect;
  featureReel: FeatureReel<A> | null;
  frameReels: FrameReel<A>[];
  vfdColours?: {
    on: number; off: number; bg: number;
    thickness: number; slant: number; seg16: boolean;
    spacing?: number; hSpacing?: number; vSpacing?: number;
    centre?: number; chop?: number;
    charset?: number;
    reversed?: boolean;
    dot?: { x: number; y: number; spacing: number; digitGap?: number };
  } | null;
  segDisplays?: SegDisplay[];
  dotMatrix?: DotMatrix | null;
  proconnMatrix?: ProconnMatrix | null;
  epochDotAlpha?: EpochDotAlphaPanel | null;
  maygayMatrix?: MaygayMatrixPanel | null;
  epochMatrix?: EpochMatrixPanel | null;
  plasmaPanel?: PlasmaPanel | null;
  astraLed?: AstraLedPanel | null;
  bfmColourLed?: BfmColourLedPanel | null;
  igtVfd?: IgtVfdPanel | null;
  bfmLeds?: BfmLedPanel[];
  dotLcds?: DotLcdPanel[];
  coinmasterVideos?: CoinmasterVideoPanel[];
  videoScreen?: VideoScreen | null;
  rgbLeds?: RgbLed[];
  prismLamps?: PrismLamp<A>[];
  bitmaps?: CabBitmap<A>[];
  lightSources?: LightSource<A>[];
  checkboxes?: CabCheckbox[];
}

export interface CabCheckbox extends Rect {
  id: number;
  checked: boolean;
  legend: NonNullable<CabLamp['legend']>;
}

export interface LightSource<A = ImageBitmap> extends Rect {
  face: A;
}

export interface CabBitmap<A = ImageBitmap> extends Rect {
  image: A | null;
  overlay: A | null;
  stretch: number;
  natural?: boolean;
}

export interface PrismLamp<A = ImageBitmap> extends Rect {
  lamp1: number;
  lamp2: number;
  off: A | null;
  image1: A | null;
  image2: A | null;
  mask1: A | null;
  mask2: A | null;
  style: number;
  horizontal: boolean;
  hSpacing: number;
  vSpacing: number;
  tilt: number;
  centerLine: boolean;
}

export interface SegDisplay extends Rect {
  seg: number[];
  digit?: number;
  on: number;
  off: number;
  bg: number;
  dpRight: boolean;
  dpOn: boolean;
  autoDp?: boolean;
  dpOff?: boolean;
  metrics?: SegMetrics;
  zeroOn?: boolean;
  block?: { left: number; top: number; width: number; height: number };
}

export interface SegMetrics {
  thickness: number;
  space: number;
  hSpace: number;
  vSpace: number;
  chop: number;
  centre: number;
  slant: number;
  digitAngle: number;
  offset: number;
  style: number;
  seg16: boolean;
  alpha?: boolean;
}

export const SEG_METRICS: SegMetrics = {
  thickness: 3, space: 1, hSpace: 10, vSpace: 6,
  chop: 75, centre: 50, slant: 6, offset: 0, style: 0, seg16: false, alpha: false,
  digitAngle: 0,
};

export const MFME_SEG16_ASCII: readonly number[] = [
  0x0000, 0x0002, 0x0080, 0x0400, 0x0800, 0x1000, 0x0004, 0x0100, 0x0200, 0x0040, 0x8000, 0x4000, 0x2000, 0x0008, 0x0020, 0x0010,
  0x0003, 0x0006, 0x000c, 0x0018, 0x0030, 0x0060, 0x00c0, 0x0081, 0x0180, 0x0204, 0x0140, 0x0208, 0x2400, 0x4800, 0x9000, 0x0300,
  0x0000, 0x2800, 0x1800, 0x4bff, 0x4bbb, 0x9011, 0x3573, 0x1002, 0x00e1, 0x001e, 0xff00, 0x4b00, 0x2010, 0x0300, 0x4160, 0x9000,
  0x90ff, 0x000c, 0x0377, 0x033f, 0x038c, 0x03bb, 0x03fb, 0x000f, 0x03ff, 0x038f, 0x0012, 0x001a, 0x3000, 0x0330, 0x8400, 0x0347,
  0x12f7, 0x03cf, 0x4a3f, 0x00f3, 0x483f, 0x03f3, 0x03c3, 0x02fb, 0x03cc, 0x4833, 0x4823, 0x31c0, 0x00f0, 0x14cc, 0x24cc, 0x00ff,
  0x03c7, 0x20ff, 0x23c7, 0x03bb, 0x4803, 0x00fc, 0x90c0, 0xa0cc, 0xb400, 0x5400, 0x9033, 0x00f3, 0x2400, 0x003f, 0x0480, 0x0030,
  0x0401, 0x4971, 0x41e0, 0x00e1, 0x4970, 0x09e1, 0x01c1, 0x49a1, 0x41c0, 0x4800, 0x4820, 0x31c0, 0x00e0, 0x14cc, 0x48c1, 0x48e1,
  0x09c1, 0x4991, 0x00c1, 0x41a1, 0x01e0, 0x48e0, 0x88c0, 0xa0cc, 0xb400, 0x49a0, 0x8821, 0x01f1, 0x4800, 0x4921, 0x1c00, 0xa030,
];

export function segLampLit(s: SegDisplay, i: number, lampOn: (n: number) => boolean): boolean {
  const n = (s.metrics?.seg16 ?? false) && s.seg.length >= 16 ? 16 : 7;
  const lamp = s.seg[i];
  return i < n && lamp !== undefined && lamp >= 0 && lampOn(lamp);
}

export function segPointLit(
  s: { autoDp?: boolean; dpOff?: boolean; dpOn: boolean }, bits7: number, bit7: boolean,
): boolean {
  let lit = bit7;
  if (s.autoDp && (bits7 & 0x22) !== 0) lit = true;
  if (s.dpOff) lit = false;
  if (s.dpOn) lit = true;
  return lit;
}

export function segLitMask(m: SegMetrics, word: number): number {
  if (m.seg16) return m.alpha ? MFME_SEG16_ASCII[word & 0x7f] : word & 0x1ffff;
  if (m.alpha) return 0;
  return word & 0x7f;
}

export interface DotMatrix extends Rect {
  cols: number;
  rows: number;
  pitch: number;
  dot: number;
  stride: number;
  lsbFirst: boolean;
  on: number;
  off: number;
  bg: number;
  flip180: boolean;
  vertical: boolean;
}

export interface EpochDotAlphaPanel extends Rect {
  dotW: number;
  dotH: number;
  gap: number;
  digitGap: number;
  on: number;
  off: number;
  bg: number;
}

export interface MaygayMatrixPanel extends Rect {
  size: number;
  on: number;
  off: number;
  bg: number;
}

export interface PlasmaPanel extends Rect {
  size: number;
  on: number;
  off: number;
  bg: number;
}

export interface AstraLedPanel extends Rect {
  size: number;
  on: number;
  off: number;
  bg: number;
}

export interface IgtVfdPanel extends Rect {
  size: number;
  spacing: number;
  on: number;
  off: number;
  bg: number;
}

export interface BfmColourLedPanel extends Rect {
  size: number;
  spacing: number;
  off: number;
  bg: number;
}

export interface BfmLedPanel extends Rect {
  xSize: number;
  ySize: number;
  digitSpacing: number;
  ledSize: number;
  on: number;
  off: number;
  bg: number;
  classic?: true;
}

export function classicBfmLedDots(p: Pick<BfmLedPanel, 'xSize' | 'ySize' | 'digitSpacing'>):
  { col: number; bit: number; x: number; y: number; w: number; h: number }[] {
  const X = p.xSize, Y = p.ySize, DS = p.digitSpacing;
  const out: { col: number; bit: number; x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < 20; i++) {
    const count = i % 5 === 4 && i !== 19 ? 8 : 7;
    const x0 = (X + 1) * i + Math.floor(i / 5) * DS + 3;
    for (let k = 0; k < count; k++) {
      out.push({ col: i, bit: k, x: k < 7 ? x0 : x0 + X + 1, y: 4 + k * (Y + 1), w: X, h: Y });
    }
  }
  return out;
}

export interface DotLcdPanel extends Rect {
  xSize: number;
  ySize: number;
  digitSpacing: number;
  lineSpacing: number;
  on: number;
  off: number;
  bg: number;
}

export interface CoinmasterVideoPanel extends Rect {
  vertical: boolean;
  quality: number;
}

export interface EpochMatrixPanel extends Rect {
  size: number;
  off: number;
  lo: number;
  med: number;
  hi: number;
  bg: number;
}

export interface ProconnMatrix extends Rect {
  size: number;
  on: number;
  off: number;
  bg: number;
}

export interface VideoScreen extends Rect {
  chip: number;
  stretch?: number;
  vertical?: boolean;
}

export interface RgbLed extends Rect {
  lamps: number[];
  mux?: number;
  colours: number[];
  style: number;
  noOutline: boolean;
  noShadow: boolean;
}

export function rgbLedColour(
  led: RgbLed, lit: (n: number) => boolean, muxColour: (n: number) => number = () => 0,
): number {
  if (led.mux !== undefined && led.mux >= 0) {
    const c = muxColour(led.mux) & 0xffffff;
    return c === 0 ? led.colours[0] ?? 0xff7f0000 : (c | 0xff000000) >>> 0;
  }
  let mask = 0;
  for (let k = 0; k < led.lamps.length && k < 4; k++) {
    const n = led.lamps[k];
    if (n !== undefined && n >= 0 && lit(n)) mask |= 1 << k;
  }
  if (mask === 0) return led.colours[0] ?? 0xff7f0000;
  return ((led.colours[Math.min(mask, 7)] ?? 0) | 0xff000000) >>> 0;
}

export interface SegDigitGeometry {
  bx: number; by: number; bw: number; bh: number;
  thick: number;
  segs: number[][];
  dpX: number; dpY: number; dpR: number;
  bg: number[];
}

export function segDigitGeometry(s: SegDisplay): SegDigitGeometry {
  const m = s.metrics ?? SEG_METRICS;
  const th = m.thickness;
  const phi = ((m.digitAngle ?? 0) * Math.PI) / 180;
  let rx = 0, ry = 0, rw = s.width, rh = s.height;
  if (phi !== 0 && s.width > 0 && s.height > 0 && !s.block) {
    const beta = Math.atan2(s.height / 2, s.width / 2);
    const k = Math.cos(beta) / Math.cos(beta - Math.abs(phi));
    if (Number.isFinite(k) && k > 0) {
      rw = s.width * k;
      rh = s.height * k;
      rx = (s.width - rw) / 2;
      ry = (s.height - rh) / 2;
    }
  }
  const L = s.left + rx + m.offset + m.hSpace / 2;
  const T = s.top + ry + m.vSpace / 2;
  const R = s.left + rx + rw + m.offset - m.hSpace / 2;
  const B = s.top + ry + rh - m.vSpace / 2;
  const pivot = s.block ?? s;
  const cx = pivot.left + pivot.width / 2;
  const cy = pivot.top + pivot.height / 2;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const spin = (out: number[]): number[] => {
    if (phi === 0) return out;
    for (let i = 0; i < out.length; i += 2) {
      const ux = out[i] - cx, uy = out[i + 1] - cy;
      out[i] = cx + ux * cosP - uy * sinP;
      out[i + 1] = cy + uy * cosP + ux * sinP;
    }
    return out;
  };
  const bg = phi === 0
    ? [s.left, s.top, s.left + s.width, s.top, s.left + s.width, s.top + s.height, s.left, s.top + s.height]
    : spin([s.left + rx, s.top + ry, s.left + rx + rw, s.top + ry, s.left + rx + rw, s.top + ry + rh, s.left + rx, s.top + ry + rh]);
  const sp = m.space / 2;
  const h = th / 2;
  const q = th / 4;
  const chop = (th * m.chop) / 100;
  const c2 = chop / 2;
  const k = m.style === 0 ? h : 0;
  const midY = (B + T) / 2;
  const tan = Math.tan((m.slant * Math.PI) / 180);
  const poly = (...pts: number[]): number[] => {
    const out = new Array<number>(pts.length);
    for (let i = 0; i < pts.length; i += 2) {
      out[i] = pts[i] + (B - pts[i + 1]) * tan;
      out[i + 1] = pts[i + 1];
    }
    return spin(out);
  };
  if (m.seg16) {
    const xC = s.left + ((L - s.left) + (R - s.left)) * m.centre / 100;
    const t2 = 2 * th;
    const segs16 = [
      poly(L + sp + chop, T, L + sp + c2, T + c2, L + th + sp, T + th, xC - h - sp, T + th, xC - sp, T + h, xC - k - sp, T),
      poly(xC + k + sp, T, xC + sp, T + h, xC + h + sp, T + th, R - th - sp, T + th, R - sp - c2, T + c2, R - sp - chop, T),
      poly(R, midY - k - sp, R - h, midY - sp, R - th, midY - h - sp, R - th, T + th + sp, R - c2, T + sp + c2, R, T + sp + chop),
      poly(R, B - sp - chop, R - c2, B - sp - c2, R - th, B - th - sp, R - th, midY + h + sp, R - h, midY + sp, R, midY + k + sp),
      poly(xC + h + sp, B - th, xC + sp, B - h, xC + k + sp, B, R - sp - chop, B, R - sp - c2, B - c2, R - th - sp, B - th),
      poly(L + th + sp, B - th, xC - h - sp, B - th, xC - sp, B - h, xC - k - sp, B, L + sp + chop, B, L + sp + c2, B - c2),
      poly(L, midY + k + sp, L + h, midY + sp, L + th, midY + h + sp, L + th, B - th - sp, L + c2, B - sp - c2, L, B - sp - chop),
      poly(L, T + sp + chop, L + c2, T + sp + c2, L + th, T + th + sp, L + th, midY - h - sp, L + h, midY - sp, L, midY - k - sp),
      poly(L + h + sp, midY, L + th + sp, midY - h, xC - h - sp, midY - h, xC - sp, midY, xC - h - sp, midY + h, L + th + sp, midY + h),
      poly(xC + sp, midY, xC + h + sp, midY - h, R - th - sp, midY - h, R - h - sp, midY, R - th - sp, midY + h, xC + h + sp, midY + h),
      poly(L + th + sp, T + th + sp, L + th + h + sp, T + th + sp, xC - h - sp, midY - t2 - sp, xC - h - sp, midY - h - sp, xC - th - sp, midY - h - sp, L + th + sp, T + t2 + h + sp),
      poly(xC, T + h + sp, xC + h, T + th + sp, xC + h, midY - h - sp, xC, midY - sp, xC - h, midY - h - sp, xC - h, T + th + sp),
      poly(R - th - h - sp, T + th + sp, R - th - sp, T + th + sp, R - th - sp, T + t2 + h + sp, xC + th + sp, midY - h - sp, xC + h + sp, midY - h - sp, xC + h + sp, midY - t2 - sp),
      poly(xC + h + sp, midY + h + sp, xC + th + sp, midY + h + sp, R - th - sp, B - t2 - h - sp, R - th - sp, B - th - sp, R - th - h - sp, B - th - sp, xC + h + sp, midY + t2 + sp),
      poly(xC, midY + sp, xC + h, midY + h + sp, xC + h, B - th - sp, xC, B - h - sp, xC - h, B - th - sp, xC - h, midY + h + sp),
      poly(L + th + sp, B - th - sp, L + th + sp, B - t2 - h - sp, xC - th - sp, midY + h + sp, xC - h - sp, midY + h + sp, xC - h - sp, midY + t2 + sp, L + th + h + sp, B - th - sp),
    ];
    const p16 = spin([s.dpRight ? R + h + q : L - h - q, B - h]);
    return { bx: L, by: T, bw: R - L, bh: B - T, thick: th, segs: segs16, dpX: p16[0], dpY: p16[1], dpR: h, bg };
  }
  const segs = [
    poly(L + sp + chop, T, L + sp + c2, T + c2, L + sp + th, T + th,
      R - sp - th, T + th, R - sp - c2, T + c2, R - sp - chop, T),
    poly(R, midY - k - sp, R - h, midY - sp, R - th, midY - h - sp,
      R - th, T + th + sp, R - c2, T + sp + c2, R, T + sp + chop),
    poly(R, B - sp - chop, R - c2, B - sp - c2, R - th, B - th - sp,
      R - th, midY + h + sp, R - h, midY + sp, R, midY + k + sp),
    poly(L + sp + chop, B, L + sp + c2, B - c2, L + sp + th, B - th,
      R - sp - th, B - th, R - sp - c2, B - c2, R - sp - chop, B),
    poly(L, midY + k + sp, L + h, midY + sp, L + th, midY + h + sp,
      L + th, B - th - sp, L + c2, B - sp - c2, L, B - sp - chop),
    poly(L, T + sp + chop, L + c2, T + sp + c2, L + th, T + th + sp,
      L + th, midY - h - sp, L + h, midY - sp, L, midY - k - sp),
    poly(L + sp + h, midY, L + sp + th, midY - h, R - sp - th, midY - h,
      R - sp - h, midY, R - sp - th, midY + h, L + sp + th, midY + h),
  ];
  const dp = spin([s.dpRight ? R + h + q : L - h - q, B - h]);
  return { bx: L, by: T, bw: R - L, bh: B - T, thick: th, segs, dpX: dp[0], dpY: dp[1], dpR: h, bg };
}

export interface FrameReel<A = ImageBitmap> extends Rect {
  machineIndex: number;
  number?: number;
  stops: number;
  frames: A[];
  darkness: number;
  reversed: boolean;
  offset?: number;
  mask?: A;
  rheight: number;
  winLines?: WinLines;
  border?: ReelBorder;
}

export function usableCabinet<A>(cab: Cabinet<A> | null): Cabinet<A> | null {
  if (!cab) return null;
  const usable = cab.background || cab.reels.length || cab.frameReels.length
    || cab.lamps.length || cab.vfd || cab.featureReel;
  return usable ? cab : null;
}

export function reelEffectivePosition(
  position: number, reversed: boolean, offsetSteps = 0,
): number {
  const wrapped = ((position % 96) + 96) % 96;
  const adjusted = reversed && wrapped !== 0 ? 96 - wrapped : wrapped;
  return (((adjusted + offsetSteps) % 96) + 96) % 96;
}

export const MPU5_V9_MIRROR = true;

export function mfmeBandIndex(
  system: string, position: number, bandOffset: number, reversed: boolean,
  stops = 16, literalOffsetSign = false, halfSteps?: number,
  classic = false,
): number | undefined {
  if (system === 'SYS1') {
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    return reelEffectivePosition(-position, reversed, (bandOffset * 96) / hs);
  }
  if (system === 'PHOENIX' || system === 'PHOENIX2') {
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    return reelEffectivePosition(-position, reversed, (bandOffset * 96) / hs);
  }
  if (system === 'ELECTRO') {
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    return reelEffectivePosition(-position, reversed, (bandOffset * 96) / hs);
  }
  if (system === 'ELECTROCOIN') {
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    return reelEffectivePosition(-position, reversed, (bandOffset * 96) / hs);
  }
  if (system === 'MPU3') {
    const MPU3_ADJUST = 7;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(
      MPU3_ADJUST * scale - position, reversed, bandOffset * scale,
    );
  }
  if (system === 'MPU2') {
    const MPU2_ADJUST = 7;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(
      MPU2_ADJUST * scale - position, reversed, bandOffset * scale,
    );
  }
  if (system === 'SYS83') {
    const SYS83_ADJUST = 7;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(
      SYS83_ADJUST * scale - position, reversed, bandOffset * scale,
    );
  }
  if (system === 'IGTS2000') {
    const IGTS2000_ADJUST = -12;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(
      IGTS2000_ADJUST * scale - position, reversed, bandOffset * scale,
    );
  }
  if (system === 'MACH2000E') {
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(-position, reversed, bandOffset * scale);
  }
  if (system === 'PCLMAXI') {
    const PCLMAXI_ADJUST = 2;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(
      PCLMAXI_ADJUST * scale - position, reversed, bandOffset * scale,
    );
  }
  if (system === 'M1VIDEO') {
    const M1VIDEO_ADJUST = 1;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(
      M1VIDEO_ADJUST * scale - position, reversed, bandOffset * scale,
    );
  }
  if (system === 'MMM') {
    const MMM_ADJUST = 8;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(
      MMM_ADJUST * scale - position, reversed, bandOffset * scale,
    );
  }
  if (system === 'PROCONN') {
    const PROCONN_ADJUST = 1;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(
      PROCONN_ADJUST * scale - position, reversed, bandOffset * scale,
    );
  }
  if (system === 'MPU4' || system === 'MPU4PLASMA') {
    const MPU4_ADJUST = system === 'MPU4PLASMA' ? 0 : -1;
    const MPU4_MODEL_HOME = 3;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(
      (MPU4_ADJUST + MPU4_MODEL_HOME) * scale - position, reversed, bandOffset * scale,
    );
  }
  if (system === 'SCORPION2') {
    const SC2_ADJUST = 5;
    const MODEL_HOME = 9;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    const mfmePosition = (SC2_ADJUST - MODEL_HOME) * scale + position;
    const offset = (literalOffsetSign ? -bandOffset : bandOffset) * scale;
    return reelEffectivePosition(mfmePosition, reversed, offset);
  }
  if (system === 'IMPACT') {
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(
      IMPACT_DISPLAY_SHIFT * scale + position, reversed, bandOffset * scale,
    );
  }
  if (system === 'M1AB') {
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(
      M1AB_DISPLAY_SHIFT * scale + position, reversed, bandOffset * scale,
    );
  }
  if (system === 'SYS85') {
    const SYS85_DISPLAY_SHIFT = 6 - 9;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(
      SYS85_DISPLAY_SHIFT * scale + position, reversed, bandOffset * scale,
    );
  }
  if (system === 'SCORPION1') {
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(
      SC1_DISPLAY_SHIFT * scale + position, reversed, bandOffset * scale,
    );
  }
  if (system === 'SCORPION4' || system === 'SCORPION5' || system === 'ADDER5') {
    const SC4_ADJUST = 5;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(SC4_ADJUST * scale - position, reversed, bandOffset * scale);
  }
  if (system === 'MPU5') {
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const reelpos = classic && MPU5_V9_MIRROR ? -position : position;
    return reelEffectivePosition(reelpos, reversed, (bandOffset * 96) / hs);
  }
  if (system === 'SYS5') {
    const SYS5_ADJUST = 8;
    const SYS5_MODEL_HOME = 5;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    const home = (SYS5_ADJUST - SYS5_MODEL_HOME) * scale;
    return reelEffectivePosition(home - position, reversed, bandOffset * scale);
  }
  if (system === 'MPS2') {
    const MPS2_DETENT = 3;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    const home = MPS2_DETENT * scale;
    return reelEffectivePosition(home - position, reversed, bandOffset * scale);
  }
  if (system === 'SYSTEM80') {
    const SYS80_ADJUST = 7;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(SYS80_ADJUST * scale - position, reversed, bandOffset * scale);
  }
  if (system === 'SRU') {
    const SRU_ADJUST = -5;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(SRU_ADJUST * scale - position, reversed, bandOffset * scale);
  }
  if (system === 'BLACKBOX') {
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    return reelEffectivePosition(-position, reversed, (bandOffset * 96) / hs);
  }
  if (system === 'ASTRASYSA1') {
    const ASTRA_ADJUST = -1;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(ASTRA_ADJUST * scale - position, reversed, bandOffset * scale);
  }
  if (system === 'EPOCH') {
    const EPOCH_ADJUST = 5;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    const scale = 96 / hs;
    return reelEffectivePosition(EPOCH_ADJUST * scale - position, reversed, bandOffset * scale);
  }
  if (system === 'SPACE') {
    const SPACE_ADJUST = 0;
    void stops;
    const hs = halfSteps && halfSteps > 0 ? halfSteps : 96;
    return reelEffectivePosition(SPACE_ADJUST - position, reversed, (bandOffset * 96) / hs);
  }
  return undefined;
}

export const MFME_BAND_SYMBOL_PITCH = 56;

export function reelVisibleSymbols(rheight: number): number {
  return Math.max(1, Math.round(rheight / MFME_BAND_SYMBOL_PITCH));
}

export function reelBandMetrics(
  stops: number, height: number, rheight: number,
): { bandH: number; symH: number } {
  const symH = height / reelVisibleSymbols(rheight);
  return { bandH: symH * stops, symH };
}

export function reelWinLineRow(effective: number, stops: number): number {
  const row = Math.round((effective * stops) / 96);
  return ((row % stops) + stops) % stops;
}

export interface WinLines {
  count: number;
  thickness: number;
  colour: string;
  number: number;
}

export interface ReelBorder {
  rect: Rect;
  width: number;
  colour: string;
}

export function paintBandStrip(
  fx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  strip: Omit<BandStrip<unknown>, 'canvas' | 'overlay' | 'classic'>,
  band: CanvasImageSource, bandW: number, bandH: number,
  overlay: CanvasImageSource | undefined,
  classic: BandClassic<CanvasImageSource> | undefined,
  position: number, shade: number,
  lampLit: (n: number) => number,
): void {
  const { left, top, width, height, stops, halfSteps, view } = strip;
  if (width <= 0 || height <= 0 || !stops || !halfSteps || !view || !bandW || !bandH) return;
  const { start, along, bandLen, winLen }
    = bandStripWindow({ ...strip, classic }, bandW, bandH, position);
  if (winLen <= 0) return;
  const horiz = strip.horizontal;
  const scale = (horiz ? width : height) / winLen;
  fx.save();
  fx.beginPath();
  fx.rect(left, top, width, height);
  fx.clip();
  for (let k = 0; k < stops; k++) {
    for (let wrap = -1; wrap <= 1; wrap++) {
      const rel = k * along + wrap * bandLen - start;
      if (rel + along <= 0 || rel >= winLen) continue;
      const d = rel * scale;
      const dLen = along * scale;
      const [sx, sy, sw, sh] = bandStripCell(stops, bandW, bandH, k, !!classic);
      if (horiz) fx.drawImage(band, sx, sy, sw, sh, left + d, top, dLen, height);
      else fx.drawImage(band, sx, sy, sw, sh, left, top + d, width, dLen);
    }
  }
  fx.restore();
  if (classic) paintBandClassicLamps(fx, strip, classic, lampLit);
  if (shade > 0) {
    fx.save();
    fx.globalAlpha = shade;
    fx.fillStyle = '#000';
    fx.fillRect(left, top, width, height);
    fx.restore();
  }
  paintReelBorder(fx, strip.border);
  if (overlay) fx.drawImage(overlay, left, top, width, height);
}

export function paintBandClassicLamps(
  fx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  r: Rect & { horizontal: boolean },
  cl: BandClassic<CanvasImageSource>,
  lit: (n: number) => number,
): void {
  if (!cl.lamps || r.width <= 0 || r.height <= 0) return;
  const unlit = `#${(cl.unlit & 0xffffff).toString(16).padStart(6, '0')}`;
  fx.save();
  fx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 5; i++) {
    const x = r.horizontal ? r.left + (r.width * i) / 5 : r.left;
    const y = r.horizontal ? r.top : r.top + (r.height * i) / 5;
    const w = r.horizontal ? r.width / 5 : r.width;
    const h = r.horizontal ? r.height : r.height / 5;
    const n = cl.slotLamps[i] ?? -2;
    const on = !cl.mask ? 0 : n === -1 ? 1 : n >= 0 ? Math.max(0, Math.min(1, lit(n))) : 0;
    if (on < 1) {
      fx.globalAlpha = 1 - on;
      fx.fillStyle = unlit;
      fx.fillRect(x, y, w, h);
    }
    if (on > 0 && cl.mask) {
      fx.globalAlpha = on;
      fx.drawImage(cl.mask, x, y, w, h);
    }
  }
  fx.restore();
}

export function paintReelBorder(
  fx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  b: ReelBorder | undefined,
): void {
  if (!b) return;
  const { left: x, top: y, width: w, height: h } = b.rect;
  const bw = Math.min(b.width, Math.floor(Math.min(w, h) / 2));
  if (!(bw > 0)) return;
  fx.fillStyle = b.colour;
  fx.fillRect(x, y, w, bw);
  fx.fillRect(x, y + h - bw, w, bw);
  fx.fillRect(x, y + bw, bw, h - 2 * bw);
  fx.fillRect(x + w - bw, y + bw, bw, h - 2 * bw);
}

export interface WinLineSeg { x1: number; y1: number; x2: number; y2: number }

export function reelWinLines(
  w: WinLines, left: number, top: number, width: number, height: number, symH: number,
  edgeShift?: (edge: number) => number,
): WinLineSeg[] {
  const out: WinLineSeg[] = [];
  if (!(w.count > 0) || !(symH > 0)) return out;
  const centre = top + height / 2;
  const right = left + width;
  const n = w.number;
  const move = edgeShift ?? ((): number => 0);
  const cellTop = (i: number): number => centre + (i - 1) * symH - symH / 2 + move(i - 1.5);
  const cellBot = (i: number): number => centre + (i - 1) * symH + symH / 2 + move(i - 0.5);
  for (let i = 0; i < 3; i++) {
    if (i === 1 || (i === 0 && w.count > 2) || (i === 2 && w.count > 1)) {
      const y = centre + (i - 1) * symH + (move(i - 1.5) + move(i - 0.5)) / 2;
      out.push({ x1: left, y1: y, x2: right, y2: y });
    }
    if (w.count > 3) {
      const DOWN1 = [[0, 0], [2, 2], [1, 1], [0, 3], [2, 5], [1, 4]];
      const DOWN2 = [[0, 4], [1, 5], [2, 6]];
      const UP1 = [[2, 0], [0, 2], [1, 1], [2, 3], [0, 5], [1, 4]];
      const UP2 = [[2, 4], [1, 5], [0, 6]];
      const hit = (t: number[][]): boolean => t.some(([c, num]) => c === i && num === n);
      if (hit(DOWN1) || (w.count > 5 && hit(DOWN2))) {
        out.push({ x1: left, y1: cellTop(i) + 2, x2: right, y2: cellBot(i) - 2 });
      }
      if (hit(UP1) || (w.count > 5 && hit(UP2))) {
        out.push({ x1: left, y1: cellBot(i) - 2, x2: right, y2: cellTop(i) + 2 });
      }
    }
  }
  return out;
}

export function treelWinLinePitch(rheight: number): number {
  return rheight / 4;
}

export function reelBandTopPx(
  effective: number, stops: number, height: number, rheight: number,
): number {
  const { bandH, symH } = reelBandMetrics(stops, height, rheight);
  const raw = (effective * bandH) / 96 - (height - symH) / 2;
  return ((raw % bandH) + bandH) % bandH;
}

export function newImageData(w: number, h: number): ImageData {
  if (typeof ImageData !== 'undefined') return new ImageData(w, h);
  return {
    width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb',
  } as ImageData;
}

export function readLayout(data: Uint8Array): Uint8Array {
  if (isAacsContainer(data)) {
    try {
      const r = readAacsContainer(data);
      console.log(
        '[dat] AACS %s: %d/%d chunks, verified=%s, payload=%d bytes',
        r.encrypted ? 'encrypted (.fml)' : 'plain (.dat)',
        r.readChunks, r.declaredChunks, r.verified, r.payload.length,
      );
      if (r.payload.length > 0) return r.payload;
    } catch (e) {
      console.warn('[dat] structured read failed (%s); falling back to zlib scan', (e as Error).message);
    }
  }
  return reassembleDfm(data);
}

export function reassembleDfm(dat: Uint8Array): Uint8Array {
  const dv = new DataView(dat.buffer, dat.byteOffset, dat.byteLength);
  const chunkSize = dv.getUint32(4, true) || 0x80000;
  console.log('[dat] magic=%s chunkSize=%d datLen=%d', String.fromCharCode(dat[0], dat[1], dat[2], dat[3]), chunkSize, dat.length);

  const cands: { off: number; data: Uint8Array }[] = [];
  for (let i = 0; i < dat.length - 2; i++) {
    if (dat[i] !== 0x78) continue;
    const b1 = dat[i + 1];
    if (b1 !== 0x9c && b1 !== 0x01 && b1 !== 0xda) continue;
    let out: Uint8Array;
    try {
      out = unzlibSync(dat.subarray(i));
    } catch {
      continue;
    }
    if (out.length >= 1024) cands.push({ off: i, data: out });
  }

  const full = cands.filter((c) => c.data.length === chunkSize);
  const lastFullOff = full.length ? full[full.length - 1].off : -1;
  const tail = cands.filter((c) => c.off > lastFullOff && c.data.length < chunkSize).pop();
  const parts = tail ? [...full, tail] : full;
  for (const c of parts) console.log('[dat]  chunk @0x%s -> %d bytes', c.off.toString(16), c.data.length);

  let len = 0;
  for (const p of parts) len += p.data.length;
  const buf = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    buf.set(p.data, o);
    o += p.data.length;
  }
  console.log('[dat] candidates=%d, kept %d chunks, DFM=%d bytes', cands.length, parts.length, buf.length);
  return buf;
}

function convertNwColorBtns(comps: Component[]): Component[] {
  const kept: Component[] = [];
  const converted: Component[] = [];
  for (const c of comps) {
    if (c.cls !== 'TzNWColorBtn') { kept.push(c); continue; }
    const black = c.colour2 === undefined || c.colour2 === 0
      || (typeof c.colour2 === 'string' && c.colour2.toLowerCase() === 'clblack');
    converted.push({
      ...c,
      cls: 'TzcShapeBitColBtn',
      onColor: c.colour1 ?? 0,
      offColor: black ? 'clBtnFace' : c.colour2,
      bins: {},
      btnProps: c.btnProps?.MultipleLines !== undefined ? { MultipleLines: c.btnProps.MultipleLines } : {},
      alignment: undefined,
      wordWrap: undefined,
    });
  }
  return converted.length ? [...kept, ...converted] : comps;
}

interface Component {
  cls: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rheight: number;
  stops: number;
  reversed: boolean;
  horizontal: boolean;
  hint: string;
  button: number;
  tag: number;
  trans: boolean;
  coin: string;
  darkness: number;
  num: number;
  lampNums: number[];
  onColor?: number | string;
  offColor?: number | string;
  color?: number | string;
  dpRight: boolean;
  dpOn: boolean;
  thickness?: number;
  space?: number;
  horzSpace?: number;
  vertSpace?: number;
  programmable: boolean;
  seg14: boolean;
  masks: number[];
  colour?: number | string;
  colour1?: number | string;
  colour2?: number | string;
  offBrightness?: number;
  ledColor?: string;
  ledStyle?: string;
  sizeX?: number;
  sizeY?: number;
  spacing?: number;
  winLine: boolean;
  winLines: number;
  winLineWidth: number;
  borderColor?: number | string;
  borderColour?: number | string;
  borderWidth?: number;
  offset: number;
  totalSteps?: number;
  vertical?: boolean;
  lamps?: boolean;
  size?: number;
  shape?: string;
  style?: string;
  stretch: boolean;
  transparent: boolean;
  caption: string;
  font: DfmFont;
  discProps?: Record<string, number>;
  btnProps?: Record<string, number | string | boolean>;
  alignment?: string;
  textLayout?: string;
  wordWrap?: boolean;
  visible?: boolean;
  bins: Record<string, { off: number; len: number }>;
}

export interface DfmFont {
  name: string;
  height: number;
  color: number | string;
  style: number;
}

const VCL_FONT_FACE = 'MS Sans Serif';
const FORM_FONT: DfmFont = { name: VCL_FONT_FACE, height: -10, color: 'clWindowText', style: 0 };
const TFONT_DEFAULT: DfmFont = { name: VCL_FONT_FACE, height: -11, color: 'clWindowText', style: 0 };

export function reelFromTag(tag: number): number {
  return (tag & 7) | ((tag & 0x10000000) >>> 25);
}

export function parseDfm(b: Uint8Array): Component[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 0;
  const sig = [0x54, 0x50, 0x46, 0x30];
  for (let i = 0; i < b.length - 4; i++) {
    if (b[i] === sig[0] && b[i + 1] === sig[1] && b[i + 2] === sig[2] && b[i + 3] === sig[3]) {
      p = i + 4;
      break;
    }
  }
  const sstr = (): string => {
    const n = b[p++];
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(b[p++]);
    return s;
  };
  const out: Component[] = [];

  const skipVal = (bins: Record<string, { off: number; len: number }>, name: string): number | string | boolean | null => {
    const t = b[p++];
    switch (t) {
      case 0: case 13: return null;
      case 1: { while (b[p] !== 0) skipVal(bins, name); p++; return null; }
      case 2: { const v = dv.getInt8(p); p += 1; return v; }
      case 3: { const v = dv.getInt16(p, true); p += 2; return v; }
      case 4: { const v = dv.getInt32(p, true); p += 4; return v; }
      case 5: p += 10; return null;
      case 6: case 7: return sstr();
      case 8: return false;
      case 9: return true;
      case 10: { const n = dv.getUint32(p, true); p += 4; bins[name] = { off: p, len: n }; p += n; return null; }
      case 11: { const m: string[] = []; while (b[p] !== 0) m.push(sstr()); p++; return `[${m.join(',')}]`; }
      case 12: {
        const n = dv.getUint32(p, true); p += 4;
        let s = '';
        for (let i = 0; i < n; i++) s += String.fromCharCode(b[p + i]);
        p += n;
        return s;
      }
      case 17: { const n = dv.getUint32(p, true); p += 4 + n; return null; }
      case 20: {
        const n = dv.getUint32(p, true); p += 4;
        const s = new TextDecoder('utf-8').decode(b.subarray(p, p + n));
        p += n;
        return s;
      }
      case 18: {
        const n = dv.getUint32(p, true); p += 4;
        let s = '';
        for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint16(p + i * 2, true));
        p += n * 2;
        return s;
      }
      default: throw new Error('DFM value type ' + t);
    }
  };

  const obj = (parentFont: DfmFont = FORM_FONT): void => {
    if ((b[p] & 0xf0) === 0xf0) {
      const f = b[p++] & 0x0f;
      if (f & 2) skipVal({}, '');
    }
    const cls = sstr();
    sstr();
    const bins: Record<string, { off: number; len: number }> = {};
    const geom: Record<string, number> = { Left: 0, Top: 0, Width: 0, Height: 0, RHeight: 0, Stops: 0, Darkness: 0, Number: -1, WinLines: 1, WinLineWidth: 1 };
    if (cls === 'TzLed') { geom.Width = 17; geom.Height = 17; }
    if (cls === 'TzcShapeBitColBtn') { geom.Width = 50; geom.Height = 50; }
    let hint = '';
    let reversed = false;
    let horizontal = false;
    let winLine = true;
    let borderColor: number | string | undefined;
    let borderColour: number | string | undefined;
    let borderWidth: number | undefined;
    let totalSteps: number | undefined;
    let vertical = false;
    let lamps = false;
    let size: number | undefined;
    let stretch = false;
    let transparent = false;
    let trans = false;
    let button = 0;
    let tag = 0;
    let offset = 0;
    let coin = '';
    let onColor: number | string | undefined;
    let offColor: number | string | undefined;
    let color: number | string | undefined;
    let colour: number | string | undefined;
    let colour1: number | string | undefined;
    let colour2: number | string | undefined;
    let offBrightness: number | undefined;
    let ledColor: string | undefined;
    let ledStyle: string | undefined;
    let sizeX: number | undefined;
    let sizeY: number | undefined;
    let spacing: number | undefined;
    let dpRight = true;
    let dpOn = false;
    let thickness: number | undefined;
    let space: number | undefined;
    let horzSpace: number | undefined;
    let vertSpace: number | undefined;
    let shape: string | undefined;
    let style: string | undefined;
    let programmable = false;
    let seg14 = false;
    const masks = new Array<number>(16).fill(0x100);
    const lampNums = [-2, -2, -2, -2, -2];
    let caption = '';
    let ownFont: Partial<DfmFont> | null = null;
    const fontOf = (): Partial<DfmFont> => (ownFont ??= {});
    const discProps: Record<string, number> | undefined = cls === 'TDiscReel' ? {} : undefined;
    const btnProps: Record<string, number | string | boolean> | undefined =
      cls === 'TzcShapeBitColBtn' || cls === 'TzNWColorBtn' ? {} : undefined;
    let alignment: string | undefined;
    let textLayout: string | undefined;
    let wordWrap: boolean | undefined;
    let visible: boolean | undefined;
    while (b[p] !== 0) {
      const pn = sstr();
      const v = skipVal(bins, pn);
      if (discProps && typeof v === 'number') discProps[pn] = v;
      if (btnProps && v !== null && /^(MultipleLines|HorzAlign|HighLightColor|ShadowColor)$/.test(pn)) btnProps[pn] = v;
      if (typeof v === 'number' && pn in geom) geom[pn] = v;
      else if ((typeof v === 'number' || typeof v === 'string') && pn === 'Colour1') colour1 = v;
      else if ((typeof v === 'number' || typeof v === 'string') && pn === 'Colour2') colour2 = v;
      else if (typeof v === 'string' && pn === 'Shape') shape = v;
      else if (typeof v === 'string' && pn === 'Caption') caption = v;
      else if (typeof v === 'string' && pn === 'Font.Name') fontOf().name = v;
      else if (typeof v === 'number' && pn === 'Font.Height') fontOf().height = v;
      else if ((typeof v === 'number' || typeof v === 'string') && pn === 'Font.Color') fontOf().color = v;
      else if (typeof v === 'string' && pn === 'Font.Style') {
        fontOf().style = (/\bfsBold\b/.test(v) ? 1 : 0) | (/\bfsItalic\b/.test(v) ? 2 : 0);
      }
      else if (pn.startsWith('Font.') || (pn === 'ParentFont' && v === false)) fontOf();
      else if (typeof v === 'number' && pn === 'Button') button = v;
      else if (typeof v === 'number' && pn === 'Tag') tag = v >>> 0;
      else if (typeof v === 'number' && pn === 'Offset') offset = v;
      else if (typeof v === 'number' && /^Lamp[1-5]$/.test(pn)) lampNums[+pn[4] - 1] = v;
      else if (typeof v === 'string' && pn === 'Hint') hint = v;
      else if (typeof v === 'boolean' && pn === 'Reversed') reversed = v;
      else if (typeof v === 'boolean' && pn === 'Horizontal') horizontal = v;
      else if (typeof v === 'boolean' && pn === 'Trans') trans = v;
      else if (pn === 'Coin' && v != null && v !== false) coin = String(v);
      else if ((typeof v === 'number' || typeof v === 'string') && pn === 'OnColor') onColor = v;
      else if ((typeof v === 'number' || typeof v === 'string') && pn === 'OffColor') offColor = v;
      else if ((typeof v === 'number' || typeof v === 'string') && pn === 'Color') color = v;
      else if ((typeof v === 'number' || typeof v === 'string') && pn === 'Colour') colour = v;
      else if (typeof v === 'number' && pn === 'OffBrightness') offBrightness = v;
      else if (typeof v === 'string' && pn === 'LEDColor') ledColor = v;
      else if (typeof v === 'string' && pn === 'LedStyle') ledStyle = v;
      else if (typeof v === 'number' && pn === 'SizeX') sizeX = v;
      else if (typeof v === 'number' && pn === 'SizeY') sizeY = v;
      else if (typeof v === 'number' && pn === 'Spacing') spacing = v;
      else if (typeof v === 'boolean' && pn === 'DPRight') dpRight = v;
      else if (typeof v === 'boolean' && pn === 'DPOn') dpOn = v;
      else if (typeof v === 'number' && pn === 'Thickness') thickness = v;
      else if (typeof v === 'number' && pn === 'Space') space = v;
      else if (typeof v === 'number' && pn === 'HorzSpace') horzSpace = v;
      else if (typeof v === 'number' && pn === 'VertSpace') vertSpace = v;
      else if (typeof v === 'boolean' && pn === 'Programmable') programmable = v;
      else if (typeof v === 'boolean' && pn === 'Seg14') seg14 = v;
      else if (typeof v === 'number' && /^Mask(?:[0-9]|1[0-5])$/.test(pn)) masks[+pn.slice(4)] = v;
      else if (typeof v === 'boolean' && pn === 'WinLine') winLine = v;
      else if ((typeof v === 'number' || typeof v === 'string') && pn === 'BorderColor') borderColor = v;
      else if ((typeof v === 'number' || typeof v === 'string') && pn === 'BorderColour') borderColour = v;
      else if (typeof v === 'number' && pn === 'BorderWidth') borderWidth = v;
      else if (typeof v === 'number' && pn === 'TotalSteps') totalSteps = v;
      else if (typeof v === 'boolean' && pn === 'Vertical') vertical = v;
      else if (typeof v === 'boolean' && pn === 'Lamps') lamps = v;
      else if (typeof v === 'number' && pn === 'Size') size = v;
      else if (typeof v === 'string' && pn === 'Style') style = v;
      else if (typeof v === 'boolean' && pn === 'Stretch') stretch = v;
      else if (typeof v === 'boolean' && pn === 'Transparent') transparent = v;
      else if (typeof v === 'string' && pn === 'Alignment') alignment = v;
      else if (typeof v === 'string' && pn === 'Layout') textLayout = v;
      else if (typeof v === 'boolean' && pn === 'WordWrap') wordWrap = v;
      else if (typeof v === 'boolean' && pn === 'Visible') visible = v;
    }
    p++;
    const font: DfmFont = ownFont ? { ...TFONT_DEFAULT, ...(ownFont as Partial<DfmFont>) } : parentFont;
    out.push({
      cls, left: geom.Left, top: geom.Top, width: geom.Width, height: geom.Height,
      rheight: geom.RHeight, stops: geom.Stops, reversed, trans, hint, button, tag, coin,
      darkness: geom.Darkness,
      num: cls === 'TDiscReel' ? reelFromTag(tag) : geom.Number,
      lampNums, onColor, offColor, color,
      colour, colour1, colour2, offBrightness, ledColor, ledStyle, sizeX, sizeY, spacing, dpRight, dpOn, bins, offset, horizontal,
      thickness, space, horzSpace, vertSpace, programmable, seg14, masks,
      winLine, winLines: geom.WinLines, winLineWidth: geom.WinLineWidth, borderColor,
      borderColour, borderWidth, totalSteps, vertical, lamps, shape, style, stretch, transparent,
      caption, font, discProps, btnProps, alignment, textLayout, wordWrap, visible,
      ...(size === undefined ? {} : { size }),
    });
    while (b[p] !== 0) obj(font);
    p++;
  };

  try {
    obj();
  } catch {
  }
  return out;
}

export function bmpToImageData(
  b: Uint8Array, off: number, len: number,
  chromaKey: boolean | 'alpha' | 'alphaonly' = false,
  respectAlpha = false,
): ImageData | null {
  let bm = -1;
  for (let i = 0; i < 16 && i < len; i++) {
    if (b[off + i] === 0x42 && b[off + i + 1] === 0x4d) {
      bm = off + i;
      break;
    }
  }
  if (bm < 0) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dataOff = dv.getUint32(bm + 10, true);
  const headerSize = dv.getUint32(bm + 14, true);
  const w = dv.getInt32(bm + 18, true);
  const h0 = dv.getInt32(bm + 22, true);
  const bpp = dv.getUint16(bm + 28, true);
  if (![4, 8, 16, 24, 32].includes(bpp) || w <= 0 || Math.abs(h0) <= 0) return null;
  const h = Math.abs(h0);
  const bottomUp = h0 > 0;
  const pix = bm + dataOff;
  const rowSize = ((w * bpp + 31) >> 5) << 2;

  const compression = dv.getUint32(bm + 30, true);
  const masks16: [number, number, number] = bpp === 16 && compression === 3
    ? [dv.getUint32(bm + 54, true), dv.getUint32(bm + 58, true), dv.getUint32(bm + 62, true)]
    : [0x7c00, 0x03e0, 0x001f];
  const field = (v: number, mask: number): number => {
    if (!mask) return 0;
    let shift = 0;
    while (!((mask >>> shift) & 1)) shift++;
    let bits = 0;
    while ((mask >>> (shift + bits)) & 1) bits++;
    if (bits >= 8) return ((v & mask) >>> (shift + bits - 8)) & 0xff;
    let x = ((v & mask) >>> shift) << (8 - bits);
    for (let have = bits; have < 8; have += bits) x |= x >>> bits;
    return x & 0xff;
  };

  const palOff = bm + 14 + headerSize;
  const rgbAt = (idx: number): [number, number, number] => {
    const s = palOff + idx * 4;
    return [b[s + 2], b[s + 1], b[s]];
  };
  const pixelRGB = (s: number, xInByte: number): [number, number, number] => {
    if (bpp === 4) {
      const byte = b[s];
      return rgbAt(xInByte & 1 ? byte & 0x0f : byte >> 4);
    }
    if (bpp === 8) return rgbAt(b[s]);
    if (bpp === 16) {
      const v = b[s] | (b[s + 1] << 8);
      return [field(v, masks16[0]), field(v, masks16[1]), field(v, masks16[2])];
    }
    return [b[s + 2], b[s + 1], b[s]];
  };

  let alphaClear = false;
  let alphaSet = false;
  if ((chromaKey === 'alpha' || chromaKey === 'alphaonly') && bpp === 32) {
    for (let y = 0; y < h && !(alphaClear && alphaSet); y++) {
      const row = pix + y * rowSize;
      for (let x = 0; x < w; x++) {
        if (b[row + x * 4 + 3] === 0) alphaClear = true; else alphaSet = true;
        if (alphaClear && alphaSet) break;
      }
    }
  }
  const alphaCut = chromaKey === 'alphaonly' ? alphaClear && alphaSet : alphaClear;
  const useAlpha = (respectAlpha || alphaCut) && bpp === 32;
  const keyRow = pix + (bottomUp ? 0 : (h - 1) * rowSize);
  const [keyR, keyG, keyB] = chromaKey && chromaKey !== 'alphaonly' && !useAlpha
    ? pixelRGB(keyRow, 0) : [-1, -1, -1];

  const img = newImageData(w, h);
  for (let y = 0; y < h; y++) {
    const srcY = bottomUp ? h - 1 - y : y;
    const src = pix + srcY * rowSize;
    const dst = y * w * 4;
    for (let x = 0; x < w; x++) {
      const s = bpp >= 24 ? src + x * (bpp >> 3) : src + ((x * bpp) >> 3);
      const [rd, gr, bl] = pixelRGB(s, x);
      const d = dst + x * 4;
      img.data[d] = rd;
      img.data[d + 1] = gr;
      img.data[d + 2] = bl;
      img.data[d + 3] = useAlpha
        ? b[s + 3]
        : chromaKey && bl === keyB && gr === keyG && rd === keyR ? 0 : 0xff;
    }
  }
  return img;
}

const LAMP_ALIGN_RANGE = 2;
const LAMP_ALIGN_PROOF = 0.6;
const LAMP_ALIGN_MIN_PIXELS = 40;

function alignLampArt(lamps: CabLamp<ImageData>[], bg: ImageData): void {
  const identity = (img: ImageData, lp: CabLamp<ImageData>, dx: number, dy: number): number => {
    let same = 0, n = 0;
    for (let y = 0; y < img.height; y++) {
      const by = lp.top + y + dy;
      if (by < 0 || by >= bg.height) continue;
      for (let x = 0; x < img.width; x++) {
        const s = (y * img.width + x) * 4;
        if (img.data[s + 3] <= 128) continue;
        const bx = lp.left + x + dx;
        if (bx < 0 || bx >= bg.width) continue;
        const d = (by * bg.width + bx) * 4;
        n++;
        if (bg.data[d] === img.data[s] && bg.data[d + 1] === img.data[s + 1]
            && bg.data[d + 2] === img.data[s + 2]) same++;
      }
    }
    return n >= LAMP_ALIGN_MIN_PIXELS ? same / n : 0;
  };

  let moved = 0;
  for (const lp of lamps) {
    const img = lp.states[0]?.canvas ?? lp.offState?.canvas;
    if (!img) continue;
    const declared = identity(img, lp, 0, 0);
    if (declared > 0.95) continue;
    let best = { dx: 0, dy: 0, f: declared };
    for (let dy = -LAMP_ALIGN_RANGE; dy <= LAMP_ALIGN_RANGE; dy++) {
      for (let dx = -LAMP_ALIGN_RANGE; dx <= LAMP_ALIGN_RANGE; dx++) {
        if (!dx && !dy) continue;
        const f = identity(img, lp, dx, dy);
        if (f > best.f) best = { dx, dy, f };
      }
    }
    if (best.f < LAMP_ALIGN_PROOF || (!best.dx && !best.dy)) continue;
    lp.left += best.dx;
    lp.top += best.dy;
    moved++;
  }
  if (moved) console.log('[dat] lamp art realigned to the background: %d of %d', moved, lamps.length);
}

export async function extractCabinet(dat: Uint8Array, system?: string): Promise<Cabinet<ImageData>> {
  return extractCabinetFromPayload(readLayout(dat), system);
}

function winLinesOf(c: Component): WinLines {
  return {
    count: c.winLine ? c.winLines : 0,
    thickness: c.winLineWidth,
    colour: cssArgb(delphiColour(c.borderColor ?? c.borderColour, 0xff000000)),
    number: c.num < 0 ? 0 : c.num,
  };
}

function classicBorder(c: Component): { window: Rect; border?: ReelBorder } {
  const raw = c.borderWidth ?? 1;
  const bw = Math.max(0, Math.min(raw, Math.floor((Math.min(c.width, c.height) - 1) / 2)));
  const rect: Rect = { left: c.left, top: c.top, width: c.width, height: c.height };
  if (!(bw > 0)) return { window: rect };
  return {
    window: { left: c.left + bw, top: c.top + bw, width: c.width - 2 * bw, height: c.height - 2 * bw },
    border: {
      rect,
      width: bw,
      colour: cssArgb(delphiColour(c.cls === 'TReel' ? c.borderColor : c.borderColour, 0xff000000)),
    },
  };
}

function cropTopLeft(img: ImageData, w: number, h: number): ImageData {
  if (img.width <= w && img.height <= h) return img;
  const cw = Math.min(w, img.width);
  const ch = Math.min(h, img.height);
  const out = newImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    out.data.set(img.data.subarray(y * img.width * 4, (y * img.width + cw) * 4), y * cw * 4);
  }
  return out;
}

function fitTopLeft(img: ImageData, w: number, h: number): ImageData {
  if (img.width === w && img.height === h) return img;
  const out = newImageData(Math.max(1, w), Math.max(1, h));
  const cw = Math.min(w, img.width);
  for (let y = 0; y < Math.min(h, img.height); y++) {
    out.data.set(img.data.subarray(y * img.width * 4, (y * img.width + cw) * 4), y * out.width * 4);
  }
  return out;
}

export function bevelBitmaps(comps: readonly Component[]): CabBitmap<ImageData>[] {
  const SHAPES = ['bsBox', 'bsFrame', 'bsTopLine', 'bsBottomLine', 'bsLeftLine', 'bsRightLine', 'bsSpacer'];
  const frames = comps.filter((c) => c.cls === 'TFrame2' && c.width > 0 && c.height > 0);
  const out: CabBitmap<ImageData>[] = [];
  frames.forEach((c, i) => {
    const img = bevelImage(c.width, c.height, Math.max(0, SHAPES.indexOf(c.shape ?? 'bsBox')),
      c.style === 'bsRaised', false);
    if (!img) return;
    out.push({
      left: c.left, top: c.top, width: c.width, height: c.height,
      z: PASS.bevel + (frames.length - 1 - i),
      image: img, overlay: null, stretch: 0, natural: true,
    });
  });
  return out;
}

export function bevelImage(
  W: number, H: number, shape: number, raised: boolean, v20Lines: boolean,
): ImageData | null {
  const SHADOW = 0xffa0a0a0, HIGHLIGHT = 0xffffffff;
  if (shape < 0 || shape > 5 || W <= 0 || H <= 0) return null;
  const c1 = raised ? HIGHLIGHT : SHADOW, c2 = raised ? SHADOW : HIGHLIGHT;
  const img = newImageData(W, H);
  const d = img.data;
  const px = (x: number, y: number, argb: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = (y * W + x) * 4;
    d[k] = (argb >>> 16) & 255; d[k + 1] = (argb >>> 8) & 255; d[k + 2] = argb & 255; d[k + 3] = 255;
  };
  const line = (argb: number, x1: number, y1: number, x2: number, y2: number): void => {
    const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    const sx = Math.sign(x2 - x1), sy = Math.sign(y2 - y1);
    for (let s = 0; s < n; s++) px(x1 + s * sx, y1 + s * sy, argb);
  };
  const rect = (l: number, t: number, r: number, b: number, a1: number, a2: number): void => {
    line(a1, l, b, l, t); line(a1, l, t, r, t);
    line(a2, r, t, r, b); line(a2, r, b, l, b);
  };
  const xe = v20Lines ? W - 1 : W, ye = v20Lines ? H - 1 : H;
  switch (shape) {
    case 0: rect(0, 0, W - 1, H - 1, c1, c2); break;
    case 1: rect(1, 1, W - 1, H - 1, c2, c2); rect(0, 0, W - 2, H - 2, c1, c1); break;
    case 2: line(c1, 0, 0, xe, 0); line(c2, 0, 1, xe, 1); break;
    case 3: line(c1, 0, H - 2, xe, H - 2); line(c2, 0, H - 1, xe, H - 1); break;
    case 4: line(c1, 0, 0, 0, ye); line(c2, 1, 0, 1, ye); break;
    default: line(c1, W - 2, 0, W - 2, ye); line(c2, W - 1, 0, W - 1, ye); break;
  }
  return img;
}

function classicDiscReel(dfm: Uint8Array, c: Component, machineIndex: number): ReelBand<ImageData> | null {
  const srcBin = c.bins['Source.Data'];
  const face = srcBin ? bmpToImageData(dfm, srcBin.off, srcBin.len) : null;
  if (!face || !face.width || !face.height) return null;
  const keyTopLeft = (img: ImageData): ImageData => {
    const d = img.data;
    const r = d[0], g = d[1], b = d[2];
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === r && d[i + 1] === g && d[i + 2] === b) d[i + 3] = 0;
    }
    return img;
  };
  keyTopLeft(face);
  const ovBin = c.bins['Overlay.Data'];
  const ovRaw = ovBin ? bmpToImageData(dfm, ovBin.off, ovBin.len) : null;
  const overlay = ovRaw && ovRaw.width && ovRaw.height
    ? fitTopLeft(keyTopLeft(ovRaw), face.width, face.height) : undefined;

  const props = c.discProps ?? {};
  const stops = props.Stops ?? 12;
  const steps = props.Steps ?? 96;
  const k = (255 * Math.max(0, Math.min(255, props.Darkness ?? 0xb0))) >> 8;
  const pool = (f: number): number => Math.round(255 + ((f * 255) / 256 - 255) * k / 256);
  const f0 = pool(0);
  const maskBin = c.bins['LampMask.Data'];
  const maskRaw = maskBin ? bmpToImageData(dfm, maskBin.off, maskBin.len) : null;
  let mask: ImageData | undefined;
  if (maskRaw && maskRaw.width && maskRaw.height) {
    const d = maskRaw.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = pool(d[i]); d[i + 1] = pool(d[i + 1]); d[i + 2] = pool(d[i + 2]); d[i + 3] = 255;
    }
    mask = maskRaw;
  }
  const lampSize = props.Lampsize ?? 0;
  const lamps: DiscLamps = {
    count: stops,
    offsetDeg: props.LampOffset ?? 0,
    enabled: true,
    outerH: props.OuterH ?? 0, outerL: props.OuterL ?? 0, outerSize: lampSize,
    innerH: props.InnerH ?? 0, innerL: props.InnerL ?? 0, innerSize: lampSize,
    floor: [f0, f0, f0],
    classic: { outline: props.Outline ?? 0 },
  };
  const lampNums = Array.from({ length: 24 }, (_, i) => {
    const n = props[`mask${i + 1}`] ?? 0x100;
    return n >= 0 && n < 0x140 ? n : -2;
  });
  return {
    left: c.left, top: c.top, width: c.width, height: c.height, canvas: face,
    stops, rheight: c.height, reversed: false, offset: 0,
    darkness: 0, lampNums, machineIndex, number: Math.max(0, c.num),
    overlay,
    disc: {
      steps, offsetDeg: c.offset, reversed: false, lamps,
      backing: [255, 255, 255], wholeDegrees: true,
    },
    discMask: mask,
    discInnerMask: mask,
  };
}

export async function extractCabinetFromPayload(
  dfm: Uint8Array,
  system?: string,
): Promise<Cabinet<ImageData>> {
  if (isFmlLayout(dfm)) {
    const cab = parseFmlLayout(dfm, system);
    if (cab) {
      console.log(
        '[dat] v9 layout: bg=%s canvas=%s reels=%d lamps=%d vfd=%o',
        !!cab.background,
        cab.backgroundColour === null || cab.backgroundColour === undefined
          ? 'none' : `#${(cab.backgroundColour >>> 0).toString(16)}`,
        cab.reels.length, cab.lamps.length, !!cab.vfd,
      );
      return cab;
    }
  }
  const comps = convertNwColorBtns(parseDfm(dfm));
  const tally: Record<string, number> = {};
  for (const c of comps) tally[c.cls] = (tally[c.cls] ?? 0) + 1;
  console.log('[dat] components=%d', comps.length, tally);

  const panel = comps.find((c) => c.cls === 'TCanvasPanel');
  const backgroundColour = delphiColour(panel?.color, BTN_FACE);
  const bgBin = panel?.bins['Background.Data'];
  const background = bgBin ? bmpToImageData(dfm, bgBin.off, bgBin.len) : null;
  const backgroundRect: Rect = panel
    ? { left: panel.left, top: panel.top, width: panel.width, height: panel.height }
    : { left: 0, top: 0, width: background?.width ?? 0, height: background?.height ?? 0 };

  const reelNums = comps
    .filter((c) => /^(TFancyReel|TReel|TBandReel|TDiscReel)$/.test(c.cls))
    .map((c) => Math.max(0, c.num))
    .sort((a, b) => a - b);
  const reelRank = (c: Component): number => Math.max(0, reelNums.indexOf(Math.max(0, c.num)));

  const reelMask = (c: Component): ImageData | undefined => {
    const bin = c.bins['Mask.Data'] ?? c.bins['LampMask.Data'];
    const img = bin ? bmpToImageData(dfm, bin.off, bin.len) : null;
    if (!img) return undefined;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i] < 250) return img;
    }
    return undefined;
  };

  const fancyOverlay = (c: Component): ImageData | undefined => {
    const bin = c.bins['Overlay.Data'];
    const img = bin ? bmpToImageData(dfm, bin.off, bin.len) : null;
    if (!img) return undefined;
    const d = img.data;
    const k = ((img.height >> 1) * img.width + (img.width >> 1)) * 4;
    const r = d[k], g = d[k + 1], b = d[k + 2];
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === r && d[i + 1] === g && d[i + 2] === b) d[i + 3] = 0;
    }
    return img;
  };

  const reels: ReelBand<ImageData>[] = [];
  for (const c of comps) {
    if (c.cls !== 'TFancyReel') continue;
    const bin = c.bins['Band.Data'];
    if (!bin) continue;
    const canvas = bmpToImageData(dfm, bin.off, bin.len);
    if (canvas) {
      const machineIndex = reelRank(c);
      const { window: win, border } = classicBorder(c);
      const overlay = fancyOverlay(c);
      reels.push({
        ...win, canvas, ...(border ? { border } : {}),
        stops: c.stops || 16, rheight: c.rheight || c.height, reversed: c.reversed,
        offset: c.offset,
        darkness: c.darkness, lampNums: c.lampNums, machineIndex, number: Math.max(0, c.num),
        mask: reelMask(c),
        overlay: overlay && cropTopLeft(overlay, win.width, win.height),
        winLines: winLinesOf(c),
      });
    }
  }
  for (const c of comps) {
    if (c.cls !== 'TDiscReel') continue;
    const disc = classicDiscReel(dfm, c, reelRank(c));
    if (disc) reels.push(disc);
  }
  reels.sort((a, b) => a.left - b.left);

  const bandReels: BandStrip<ImageData>[] = [];
  for (const c of comps) {
    if (c.cls !== 'TBandReel') continue;
    const bin = c.bins['Band.Data'];
    const canvas = bin ? bmpToImageData(dfm, bin.off, bin.len) : null;
    if (!canvas || !canvas.width || !canvas.height) continue;
    const { window: win, border } = classicBorder(c);
    const overlay = fancyOverlay(c);
    const maskBin = c.bins['LampMask.Data'];
    const mask = maskBin ? bmpToImageData(dfm, maskBin.off, maskBin.len) ?? undefined : undefined;
    const unlit = mask && mask.width && mask.height
      ? (mask.data[0] << 16) | (mask.data[1] << 8) | mask.data[2] : 0;
    bandReels.push({
      ...win, ...(border ? { border } : {}),
      machineIndex: reelRank(c), number: Math.max(0, c.num),
      canvas,
      overlay: overlay && fitTopLeft(overlay, win.width, win.height),
      stops: c.stops || 16,
      halfSteps: c.totalSteps || 320,
      view: 5,
      spacing: 0,
      bandOffset: c.offset,
      reversed: c.reversed,
      horizontal: !c.vertical,
      lampNums: [],
      darkness: 0,
      classic: {
        lamps: !!c.lamps,
        slotLamps: c.lampNums.slice(0, 5),
        ...(mask && mask.width && mask.height ? { mask } : {}),
        unlit,
      },
    });
  }

  const shortcutOf = (tag: number): number | undefined => {
    const vk = ((tag >>> 0) & 0x0ff00000) >>> 20;
    return vk && shortcutKnown(vk) ? vk : undefined;
  };

  const lamps: CabLamp<ImageData>[] = [];
  for (const c of comps) {
    if (c.cls !== 'TLamp2') continue;
    const ltag = c.tag >>> 0;
    const coin = (ltag & 0x80000000) !== 0;
    const isControl = (ltag & 0x40000000) !== 0 && !coin;
    const button = isControl && c.button === 0 ? ((ltag & 0xff00) >>> 8) & 0x7f : c.button;
    const nums = c.hint.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    if (coin && !nums.length && (ltag & 0x20000)) {
      nums.push((ltag & 0xff) | ((ltag & 0x10000000) >>> 20));
    }
    if (!nums.length) continue;
    const keyed = c.trans;
    const on1 = c.bins['OnImage1.Data'];
    const on2 = c.bins['OnImage2.Data'];
    const img1 = on1 ? bmpToImageData(dfm, on1.off, on1.len, keyed) : null;
    const img2 = on2 ? bmpToImageData(dfm, on2.off, on2.len, keyed) : null;
    if (!img1) continue;
    const states = nums.map((n, i) => ({ n, canvas: i === 1 && img2 ? img2 : img1 }));
    const off = c.bins['OffImage.Data'];
    const offImg = off ? bmpToImageData(dfm, off.off, off.len, keyed) : null;
    lamps.push({
      left: c.left, top: c.top, width: c.width, height: c.height,
      states,
      ...(isControl ? { button } : {}),
      ...(coin ? { acceptor: {} } : {}),
      ...(shortcutOf(c.tag) ? { shortcut: shortcutOf(c.tag) } : {}),
      ...(isControl ? { cap: true } : {}),
      offState: offImg ? { nums, canvas: offImg } : undefined,
    });
  }
  if (background) alignLampArt(lamps, background);

  const HAS_LAMP = 0x20000;
  const LOCK = 0x80000;
  const OLD_COIN = 0x40000;
  const NEW_COIN = 0x80000000;
  for (const c of comps) {
    if (c.cls !== 'TzcShapeBitColBtn') continue;
    const hint = c.hint.trim();
    const tag = c.tag >>> 0;
    const coin = (tag & NEW_COIN) !== 0 || (tag & OLD_COIN) !== 0 || /^coin\b/i.test(hint);
    let button: number | undefined;
    if (!coin) {
      button = ((tag & 0xff00) >> 8) & 0x7f;
      if (button === 0 && /^\d+$/.test(hint)) button = parseInt(hint, 10);
    }
    const lamp = (tag & HAS_LAMP) ? ((tag & 0xff) | ((tag & 0x10000000) >>> 20)) : -1;
    const onBin = c.bins['OnBitmap.Data'];
    const offBin = c.bins['OffBitmap.Data'];
    const onImg = lamp >= 0 && onBin ? bmpToImageData(dfm, onBin.off, onBin.len) : null;
    const offImg = onImg && offBin ? bmpToImageData(dfm, offBin.off, offBin.len) : null;
    const painted = !onBin && !offBin ? shapeBtnFaces(c, lamp) : null;
    lamps.push({
      left: c.left, top: c.top, width: c.width, height: c.height,
      states: onImg ? [{ n: lamp, canvas: onImg }] : painted ? painted.states : [],
      ...(offImg ? { offState: { nums: [lamp], canvas: offImg } } : {}),
      ...(painted ? { offState: painted.offState, offUnder: true } : {}),
      ...(button !== undefined ? { button } : {}),
      ...(coin ? { acceptor: {} } : {}),
      ...(lamp >= 0 && (tag & LOCK) ? { enableLamp: lamp, enableLatched: true } : {}),
      ...(shortcutOf(tag) ? { shortcut: shortcutOf(tag) } : {}),
      label: coin ? str('dat.coin') : hint,
    });
    const caption = painted ? shapeBtnCaption(c, button) : null;
    if (caption) lamps.push(caption);
  }

  const TZLED_COLOURS = ['lctRed', 'lctBlue', 'lctGreen', 'lctyellow', 'lctMangenta', 'lctGrey', 'lctCyan', 'lctWhite', 'lctUser'];
  const TZLED_ON = [0xffff0000, 0xff0000ff, 0xff00ff00, 0xffffff00, 0xffff00ff, 0xffc0c0c0, 0xff00ffff, 0xffffffff, 0xffff0000];
  const TZLED_OFF = [0xff800000, 0xff000080, 0xff008000, 0xff808000, 0xff800080, 0xff000000, 0xff008080, 0xff808080, 0xff800000];
  const TZLED_STYLES = ['lstRound', 'lstSquare', 'lstSimpleRound'];
  const ledSlot = new Map<number, number>();
  for (const c of comps) {
    if (c.cls !== 'TzLed' || c.width <= 0 || c.height <= 0) continue;
    const ci = Math.max(0, TZLED_COLOURS.indexOf(c.ledColor ?? 'lctRed'));
    const si = Math.max(0, TZLED_STYLES.indexOf(c.ledStyle ?? 'lstRound'));
    const style = { round: si !== 1, bezel: si === 0, noOutline: false, noShadow: false };
    const on = ledFace(c.width, c.height, TZLED_ON[ci], style);
    const off = ledFace(c.width, c.height, TZLED_OFF[ci], style);
    const box = { left: c.left, top: c.top, width: c.width, height: c.height };
    const tag = c.tag >>> 0;
    if (tag & 0x1000) {
      const n = (tag & 0xff) | ((tag & 0x10000000) >>> 20);
      lamps.push({ ...box, states: [{ n, canvas: on }], offState: { nums: [n], canvas: off }, offUnder: true });
      continue;
    }
    const digit = (tag & 0xff0) >>> 4, seg = tag & 0xf;
    const slot = digit < 24 ? digit * 9 + seg : -1;
    const lit = slot >= 0 && slot % 9 !== 8;
    const prev = lit ? ledSlot.get(slot) : undefined;
    if (prev !== undefined) {
      const p = lamps[prev];
      lamps[prev] = { ...p, states: [], offState: { nums: [], canvas: p.offState!.canvas }, offUnder: undefined, digitSeg: undefined };
    }
    if (!lit) {
      lamps.push({ ...box, states: [], offState: { nums: [], canvas: off } });
      continue;
    }
    ledSlot.set(slot, lamps.length);
    lamps.push({
      ...box, states: [{ n: -1, canvas: on }], offState: { nums: [-1], canvas: off }, offUnder: true,
      digitSeg: { digit: Math.floor(slot / 9), seg: slot % 9 },
    });
  }
  for (const c of comps) {
    if (c.cls === 'TLamp') lamps.push(...classicLamp(c));
  }

  const readFrames = (c: Component, stops: number): ImageData[] => {
    const frames: ImageData[] = [];
    for (let i = 1; i <= stops; i++) {
      const bin = c.bins[`reel${i}.Data`];
      const img = bin ? bmpToImageData(dfm, bin.off, bin.len) : null;
      if (img) frames.push(img);
    }
    return frames;
  };

  let featureReel: Cabinet<ImageData>['featureReel'] = null;
  const treel = comps.find((c) => c.cls === 'TReel' && c.stops > 0);
  if (treel) {
    const frames = readFrames(treel, treel.stops);
    if (frames.length === treel.stops) {
      const { window: win, border } = classicBorder(treel);
      featureReel = {
        ...win, ...(border ? { border } : {}),
        stops: treel.stops, frames,
        darkness: treel.darkness, lamp: treel.lampNums[1], mask: reelMask(treel),
        machineIndex: reelRank(treel),
        rheight: treel.rheight || treel.height,
        offset: treel.offset,
        reversed: treel.reversed,
        horizontal: treel.horizontal,
        winLines: winLinesOf(treel),
      };
    }
  }

  const frameReels: FrameReel<ImageData>[] = [];
  for (const c of comps) {
    if (c.cls !== 'TReel' || c.stops > 0) continue;
    const stops = 16;
    const frames = readFrames(c, stops);
    if (frames.length !== stops) continue;
    const { window: win, border } = classicBorder(c);
    frameReels.push({
      ...win, ...(border ? { border } : {}),
      machineIndex: reelRank(c),
      stops, frames, darkness: c.darkness, reversed: c.reversed, mask: reelMask(c),
      offset: c.offset,
      rheight: c.rheight || c.height,
      winLines: winLinesOf(c),
    });
  }
  frameReels.sort((a, b) => a.left - b.left);

  const segDisplays: SegDisplay[] = [];
  for (const c of comps) {
    if (c.cls !== 'TSevenSegment') continue;
    const tag = c.tag | 0;
    if (!c.programmable && tag < 0) continue;
    const lampDriven = c.programmable;
    segDisplays.push({
      left: c.left, top: c.top, width: c.width, height: c.height,
      ...(lampDriven
        ? { seg: c.masks.slice(0, c.seg14 ? 16 : 8) }
        : { seg: [], digit: tag % 40 }),
      on: delphiColour(c.onColor, 0xffff2020),
      off: delphiColour(c.offColor, 0xff303030),
      bg: delphiColour(c.color, 0xff000000),
      dpRight: c.dpRight, dpOn: c.dpOn && !c.seg14,
      metrics: {
        ...SEG_METRICS,
        thickness: c.thickness ?? SEG_METRICS.thickness,
        space: c.space ?? SEG_METRICS.space,
        hSpace: c.horzSpace ?? SEG_METRICS.hSpace,
        vSpace: c.vertSpace ?? SEG_METRICS.vSpace,
        seg16: c.seg14,
      },
    });
  }

  const bitmaps = datPictures(dfm, comps);

  const alpha = comps.find((c) => c.cls === 'TAlpha');
  let vfd: Rect | null = alpha
    ? { left: alpha.left, top: alpha.top, width: alpha.width, height: alpha.height }
    : null;
  let vfdIsDots = false;
  if (!vfd) {
    const dot = comps.find((c) => c.cls === 'TDotAlpha');
    if (dot) {
      vfd = { left: dot.left, top: dot.top, width: dot.width, height: dot.height };
      vfdIsDots = true;
    }
  }
  const fontBin = alpha?.bins['Bitmap.Data'];
  const vfdFont = fontBin ? bmpToImageData(dfm, fontBin.off, fontBin.len) : null;
  const vfdGlyphWidth = vfdFont ? Math.round(vfdFont.width / 64) : 0;
  const vfdInk = vfdFont ? delphiColour(alpha?.colour, 0xff00ff00) : null;
  const vfdOffBrightness = alpha?.offBrightness ?? 80;
  const vfdReversed = alpha ? !!alpha.reversed : comps.some((c) => c.cls === 'TDotAlpha');

  const dotMatrix = datDotMatrix(comps);
  const bfmLedComp = comps.filter((c) => c.cls === 'TBFMLED').pop();
  const bfmLeds: BfmLedPanel[] = [];
  if (bfmLedComp) {
    const X = Math.max(1, bfmLedComp.sizeX ?? 4);
    const Y = Math.max(1, bfmLedComp.sizeY ?? 4);
    const DS = Math.max(0, bfmLedComp.spacing ?? 4);
    bfmLeds.push({
      left: bfmLedComp.left, top: bfmLedComp.top,
      width: (X * 5 + DS) * 4 + 23, height: Y * 8 + 14,
      xSize: X, ySize: Y, digitSpacing: DS, ledSize: X,
      on: delphiColour(bfmLedComp.colour, 0xffff0000),
      off: 0xff000000, bg: 0xff000000, classic: true,
    });
  }

  const width = background?.width || backgroundRect.width || 0;
  const height = background?.height || backgroundRect.height || 0;

  for (const c of comps) {
    if (c.cls !== 'TLabel') continue;
    const lp = datLabel(c, panel, Math.max(width, backgroundRect.width), Math.max(height, backgroundRect.height));
    if (lp) lamps.push(lp);
  }

  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  const grow = (r: Rect) => {
    x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top);
    x1 = Math.max(x1, r.left + r.width); y1 = Math.max(y1, r.top + r.height);
  };
  for (const r of reels) grow(r);
  for (const r of frameReels) grow(r);
  for (const l of lamps) grow(l);
  if (vfd) grow(vfd);
  if (featureReel) grow(featureReel);
  for (const s of segDisplays) grow(s);
  if (dotMatrix) grow(dotMatrix);
  for (const b of bfmLeds) grow(b);
  const pad = 12;
  const parts: Rect = x1 > x0
    ? {
        left: Math.max(0, x0 - pad), top: Math.max(0, y0 - pad),
        width: x1 + pad - Math.max(0, x0 - pad),
        height: y1 + pad - Math.max(0, y0 - pad),
      }
    : { left: 0, top: 0, width, height };
  const cl = Math.min(0, parts.left), ct = Math.min(0, parts.top);
  const content: Rect = {
    left: cl, top: ct,
    width: Math.max(width, parts.left + parts.width) - cl,
    height: Math.max(height, parts.top + parts.height) - ct,
  };

  console.log('[dat] cabinet %dx%d content %o reels=%d frameReels=%d lamps=%d vfd=%o font=%o nreel=%o', width, height, content, reels.length, frameReels.length, lamps.length, !!vfd, !!vfdFont, !!featureReel);
  const asPart = (r: Rect, reel = false) => ({ x: r.left, y: r.top, width: r.width, height: r.height, reel });
  const crop = sidewaysCrop(width, height, [
    ...reels.map((r) => asPart(r, true)),
    ...frameReels.map((r) => asPart(r, true)),
    ...(featureReel ? [asPart(featureReel, true)] : []),
    ...lamps.map((l) => asPart(l)),
    ...(vfd ? [asPart(vfd)] : []),
    ...segDisplays.map((s) => asPart(s)),
    ...(dotMatrix ? [asPart(dotMatrix)] : []),
    ...bfmLeds.map((b) => asPart(b)),
  ], background, backgroundRect.left);
  const colLeft = Math.max(parts.left, crop.left);
  const colRight = Math.min(parts.left + parts.width, crop.left + crop.width);
  const column: Rect = colRight > colLeft
    ? { left: colLeft, top: parts.top, width: colRight - colLeft, height: parts.height }
    : parts;
  const trimmed = flatTrim(content, column, background, backgroundRect.left, backgroundRect.top);
  bitmaps.unshift(...bevelBitmaps(comps));
  return { width, height, background, backgroundRect, backgroundColour, reels, ...(bandReels.length ? { bandReels } : {}), ...(bitmaps.length ? { bitmaps } : {}), lamps, vfd, vfdIsDots, vfdFont, vfdGlyphWidth, vfdInk, vfdOffBrightness, vfdReversed, content, column, trimmed, featureReel, frameReels, segDisplays, ...(dotMatrix ? { dotMatrix } : {}), ...(bfmLeds.length ? { bfmLeds } : {}) };
}

function datDotMatrix(comps: readonly Component[]): DotMatrix | null {
  const c = comps.find((k) => k.cls === 'TDotmatrix');
  if (!c) return null;
  const pitch = Math.max(1, c.size ?? 7);
  const resized = c.size !== undefined && c.size !== 7;
  const width = resized || c.width <= 0 ? pitch * 65 + 2 : c.width;
  const height = resized || c.height <= 0 ? pitch * 21 + 2 : c.height;
  return {
    left: c.left, top: c.top, width, height,
    cols: 65, rows: 21, pitch,
    dot: Math.max(1, pitch - (pitch < 5 ? 1 : 2)),
    stride: 9, lsbFirst: false,
    on: 0xffff0000, off: 0xff000000, bg: 0xff000000,
    flip180: false, vertical: false,
  };
}

const TIMAGE_PICTURE = 0x10000;

function datPictures(dfm: Uint8Array, comps: Component[]): CabBitmap<ImageData>[] {
  const out: CabBitmap<ImageData>[] = [];
  for (const c of comps) {
    if (c.cls !== 'TImage' || c.tag !== TIMAGE_PICTURE || c.width <= 0 || c.height <= 0) continue;
    const bin = c.bins['Picture.Data'];
    if (!bin || bin.len < 9) continue;
    const n = dfm[bin.off];
    let cls = '';
    for (let i = 0; i < n && i < 32; i++) cls += String.fromCharCode(dfm[bin.off + 1 + i]);
    if (cls !== 'TBitmap') continue;
    const image = bmpToImageData(dfm, bin.off + 1 + n, bin.len - 1 - n, c.transparent);
    if (!image) continue;
    out.push({
      left: c.left, top: c.top, width: c.width, height: c.height,
      image, overlay: null, stretch: 0,
      ...(c.stretch ? {} : { natural: true }),
    });
  }
  return out;
}

export function datLabel(
  c: Component, panel: Component | undefined, panelW: number, panelH: number,
): CabLamp<ImageData> | null {
  if (c.width <= 0 || c.height <= 0) return null;
  if (c.left >= panelW || c.top >= panelH || c.left + c.width <= 0 || c.top + c.height <= 0) return null;
  const lamp = c.tag & 0x20000 ? ((c.tag & 0xff) | ((c.tag & 0x10000000) >>> 20)) : -1;
  const visible = c.visible ?? true;
  if (!visible && lamp < 0) return null;
  const text = stripAccel(c.caption);
  const fill = c.transparent ? undefined : sysColour(c.color ?? panel?.color, SYSTEM_COLOURS.clbtnface);
  if (!text.trim() && fill === undefined) return null;
  const align = c.alignment === 'taRightJustify' ? 'right' : c.alignment === 'taCenter' ? undefined : 'left';
  const valign = c.textLayout === 'tlBottom' ? 'bottom' : c.textLayout === 'tlCenter' ? undefined : 'top';
  return {
    left: c.left, top: c.top, width: c.width, height: c.height,
    states: [],
    legend: {
      ...(text.trim() ? { off: text } : {}),
      colour: sysColour(c.font.color, SYSTEM_COLOURS.clwindowtext),
      ...(fill !== undefined ? { fill } : {}),
      face: c.font.name,
      points: (Math.abs(c.font.height) * 72) / 96,
      style: c.font.style,
      lamp,
      ...(lamp >= 0 ? { litOnly: true as const, wholeLitOnly: true as const } : {}),
      ...(align ? { align } : {}),
      ...(valign ? { valign } : {}),
      ...(c.wordWrap ? {} : { nowrap: true as const }),
    },
  };
}

export function stripAccel(s: string): string {
  return s.replace(/&(.)/gs, '$1').replace(/&$/, '');
}

const SYSTEM_COLOURS: Record<string, number> = {
  clbtnface: 0xfff0f0f0, clwindowtext: 0xff000000, clbtntext: 0xff000000, clwindow: 0xffffffff,
  clbtnshadow: 0xffa0a0a0, clbtnhighlight: 0xffffffff,
};

function sysColour(v: number | string | undefined, fallback: number): number {
  if (typeof v === 'string' && SYSTEM_COLOURS[v.toLowerCase()] !== undefined) return SYSTEM_COLOURS[v.toLowerCase()] >>> 0;
  return delphiColour(v, fallback);
}

const DELPHI_COLOURS: Record<string, number> = {
  clblack: 0x000000, clmaroon: 0x800000, clgreen: 0x008000, clolive: 0x808000,
  clnavy: 0x000080, clpurple: 0x800080, clteal: 0x008080, clgray: 0x808080,
  clsilver: 0xc0c0c0, clred: 0xff0000, cllime: 0x00ff00, clyellow: 0xffff00,
  clblue: 0x0000ff, clfuchsia: 0xff00ff, claqua: 0x00ffff, clwhite: 0xffffff,
};

export function cssArgb(argb: number): string {
  const a = ((argb >>> 24) & 0xff) / 255;
  return `rgba(${(argb >>> 16) & 0xff},${(argb >>> 8) & 0xff},${argb & 0xff},${a})`;
}

function shapeBtnFaces(c: Component, lamp: number):
  { states: { n: number; canvas: ImageData; down: ImageData }[]; offState: { nums: number[]; canvas: ImageData; down: ImageData } } {
  const p = c.btnProps ?? {};
  const hi = btnColour(p.HighLightColor, SYSTEM_COLOURS.clbtnhighlight);
  const sh = btnColour(p.ShadowColor, SYSTEM_COLOURS.clbtnshadow);
  const on = btnColour(c.onColor, SYSTEM_COLOURS.clbtnface);
  const off = btnColour(c.offColor, SYSTEM_COLOURS.clbtnface);
  const face = (fill: number, down: boolean): ImageData => shapeBtnFace(c.width, c.height, fill, hi, sh, down);
  const lamp2 = c.lampNums[1] > 0 ? c.lampNums[1] - 1 : -1;
  const nums = [lamp, lamp2].filter((n) => n >= 0);
  const onFace = nums.length ? face(on, false) : null;
  const onDown = nums.length ? face(on, true) : null;
  return {
    states: nums.map((n) => ({ n, canvas: onFace!, down: onDown! })),
    offState: { nums, canvas: face(off, false), down: face(off, true) },
  };
}

export function shapeBtnFace(w: number, h: number, fill: number, hi: number, sh: number, down: boolean): ImageData {
  const img = newImageData(Math.max(0, w), Math.max(0, h));
  const d = img.data;
  const put = (x: number, y: number, argb: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    d[i] = (argb >>> 16) & 0xff; d[i + 1] = (argb >>> 8) & 0xff; d[i + 2] = argb & 0xff; d[i + 3] = 0xff;
  };
  const col = (x: number, y0: number, y1: number, argb: number): void => { for (let y = y0; y <= y1; y++) put(x, y, argb); };
  const row = (y: number, x0: number, x1: number, argb: number): void => { for (let x = x0; x <= x1; x++) put(x, y, argb); };
  for (let y = 0; y < h - 2; y++) row(y, 0, w - 3, fill);
  const black = 0xff000000;
  col(0, 1, h - 1, sh); row(0, 0, w - 2, sh);
  col(w - 2, 1, h - 3, sh); row(h - 2, 2, w - 2, sh);
  col(1, 2, h - 2, down ? black : hi); row(1, 1, w - 3, down ? black : hi);
  col(w - 1, 0, h - 2, down ? hi : black); row(h - 1, 1, w - 1, down ? hi : black);
  return img;
}

function shapeBtnCaption(c: Component, button: number | undefined): CabLamp<ImageData> | null {
  const w = c.width - 11;
  const h = c.height - 11;
  if (w <= 0 || h <= 0) return null;
  const p = c.btnProps ?? {};
  const multi = p.MultipleLines === true;
  let text = stripAccel(c.caption);
  if (!multi) text = text.replace(/[\r\n]/g, '');
  if (!text.trim()) return null;
  const align = c.alignment === 'taLeftJustify' ? 'left' : c.alignment === 'taRightJustify' ? 'right' : undefined;
  const valign = multi ? 'top' : p.HorzAlign === 'zbha_Top' ? 'top' : p.HorzAlign === 'zbha_Bottom' ? 'bottom' : undefined;
  return {
    left: c.left + 5, top: c.top + 5, width: w, height: h,
    states: [],
    legend: {
      off: text,
      colour: sysColour(c.font.color, SYSTEM_COLOURS.clwindowtext),
      face: c.font.name,
      points: (Math.abs(c.font.height) * 72) / 96,
      style: c.font.style,
      lamp: -1,
      ...(align ? { align } : {}),
      ...(valign ? { valign } : {}),
      ...(multi && c.wordWrap ? {} : { nowrap: true as const }),
      ...(button !== undefined ? { input: button } : {}),
    },
  };
}

function btnColour(v: number | string | boolean | undefined, fallback: number): number {
  if (typeof v === 'number' && v < 0) {
    const sys = SYSTEM_BY_INDEX[v & 0xff];
    return sys === undefined ? fallback : SYSTEM_COLOURS[sys] >>> 0;
  }
  return typeof v === 'boolean' ? fallback : sysColour(v, fallback);
}

const SYSTEM_BY_INDEX: Record<number, string> = {
  5: 'clwindow', 8: 'clwindowtext', 15: 'clbtnface', 16: 'clbtnshadow', 18: 'clbtntext', 20: 'clbtnhighlight',
};

const VCL_SHAPES = ['stRectangle', 'stSquare', 'stRoundRect', 'stRoundSquare', 'stEllipse', 'stCircle'];
const BTN_FACE = 0xfff0f0f0;

function classicLamp(c: Component): CabLamp<ImageData>[] {
  if (c.width <= 0 || c.height <= 0) return [];
  const tag = c.tag >>> 0;
  const coin = (tag & 0x80000000) !== 0;
  const control = (tag & 0x40000000) !== 0 && !coin;
  const lamp1 = (tag & 0xff) | ((tag & 0x10000000) >>> 20);
  const lamp2 = (tag & 0x10000) ? ((tag & 0xff00) >>> 8) | ((tag & 0x20000000) >>> 21) : -1;
  const shape = Math.max(0, VCL_SHAPES.indexOf(c.shape ?? 'stRectangle'));
  const outline = (tag & 0x40000) ? undefined : 0xff000000;
  const face = (argb: number): ImageData => {
    const img = newImageData(c.width, c.height);
    fillShape(img, 0, 0, c.width, c.height, argb, shape, outline, 0, { round: 5, vectors: 4 });
    return img;
  };
  const nums = lamp2 >= 0 ? [lamp1, lamp2] : [lamp1];
  const states = [{ n: lamp1, canvas: face(delphiColour(c.colour1, 0xff000000)) }];
  if (lamp2 >= 0) states.push({ n: lamp2, canvas: face(delphiColour(c.colour2, 0xff000000)) });
  const vk = (tag & 0x0ff00000) >>> 20;
  const rect = { left: c.left, top: c.top, width: c.width, height: c.height };
  const out: CabLamp<ImageData>[] = [{
    ...rect,
    states,
    offState: { nums, canvas: face(BTN_FACE) },
    ...(control ? { button: (tag >>> 8) & 0x7f, cap: true } : {}),
    ...(control && c.caption.trim() ? { name: c.caption.replace(/\s+/g, ' ').trim() } : {}),
    ...(coin ? { acceptor: {} } : {}),
    ...(vk && shortcutKnown(vk) ? { shortcut: vk } : {}),
  }];
  if (c.caption) {
    out.push({
      ...rect,
      states: [],
      legend: {
        off: c.caption,
        on: c.caption,
        colour: delphiColour(c.font.color, 0xff000000),
        face: c.font.name,
        points: (Math.abs(c.font.height) * 72) / 96,
        style: c.font.style,
        lamp: -1,
      },
    });
  }
  return out;
}

function delphiColour(v: number | string | undefined, fallback: number): number {
  if (typeof v === 'string') {
    if (v.toLowerCase() === 'clbtnface') return BTN_FACE;
    const rgb = DELPHI_COLOURS[v.toLowerCase()];
    return rgb === undefined ? fallback : (0xff000000 | rgb) >>> 0;
  }
  if (typeof v === 'number' && (v >>> 0) === 0x8000000f) return BTN_FACE;
  if (typeof v === 'number' && v >= 0) {
    const r = v & 0xff;
    const g = (v >> 8) & 0xff;
    const bl = (v >> 16) & 0xff;
    return (0xff000000 | (r << 16) | (g << 8) | bl) >>> 0;
  }
  return fallback;
}
