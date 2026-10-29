import type {
  BandStrip, BonusReel, Cabinet, CabBitmap, CabCheckbox, CabLamp, FeatureReel, FlipStrip, FrameReel, LightSource, PrismLamp,
  Rect, ReelBand, RgbLed, SegDisplay, VideoScreen,
} from './dat';

export type PanelKind =
  | 'dotMatrix' | 'proconnMatrix' | 'epochDotAlpha' | 'maygayMatrix' | 'epochMatrix'
  | 'plasmaPanel' | 'astraLed' | 'bfmColourLed' | 'igtVfd';

export type DrawItem<A> =
  | { kind: 'lamp'; z: number; lamp: CabLamp<A> }
  | { kind: 'reel'; z: number; reel: ReelBand<A> }
  | { kind: 'band'; z: number; strip: BandStrip<A> }
  | { kind: 'flip'; z: number; flip: FlipStrip<A> }
  | { kind: 'bonus'; z: number; bonus: BonusReel<A> }
  | { kind: 'frame'; z: number; frame: FrameReel<A> }
  | { kind: 'feature'; z: number; feature: FeatureReel<A> }
  | { kind: 'reelLight'; z: number }
  | { kind: 'vfd'; z: number; vfd: Rect }
  | { kind: 'bitmap'; z: number; bitmap: CabBitmap<A> }
  | { kind: 'seg'; z: number; seg: SegDisplay }
  | { kind: 'rgbLed'; z: number; led: RgbLed; index: number }
  | { kind: 'prism'; z: number; prism: PrismLamp<A> }
  | { kind: 'panel'; z: number; which: PanelKind; panel: Rect }
  | { kind: 'bfmLed'; z: number; panel: NonNullable<Cabinet<A>['bfmLeds']>[number] }
  | { kind: 'dotLcd'; z: number; panel: NonNullable<Cabinet<A>['dotLcds']>[number] }
  | { kind: 'cmVideo'; z: number; panel: NonNullable<Cabinet<A>['coinmasterVideos']>[number] }
  | { kind: 'video'; z: number; screen: VideoScreen }
  | { kind: 'checkbox'; z: number; checkbox: CabCheckbox }
  | { kind: 'light'; z: number; light: LightSource<A> };

export const PASS = {
  bevel: 1000,
  reel: 2000, band: 2100, flip: 2200, bonus: 2250, frame: 2300, feature: 2400, reelLight: 2500,
  vfd: 2700, lamp: 3000, seg: 4000, image: 4050, rgbLed: 4100, prism: 4200,
  dotMatrix: 4300, proconnMatrix: 4310, epochDotAlpha: 4320, maygayMatrix: 4330,
  epochMatrix: 4340, plasmaPanel: 4350, astraLed: 4355, bfmColourLed: 4357, igtVfd: 4358, bfmLed: 4360, dotLcd: 4365, cmVideo: 4367, video: 4370,
  light: 4380,
} as const;

export function zOf(index: number, slot: 0 | 1 | 2 = 0): number {
  return index * 4 + slot;
}

const cache = new WeakMap<object, DrawItem<unknown>[]>();

export function drawOrder<A>(cab: Cabinet<A>): DrawItem<A>[] {
  const hit = cache.get(cab as object);
  if (hit) return hit as DrawItem<A>[];
  const items: DrawItem<A>[] = [];
  const at = (r: Rect, pass: number): number => r.z ?? pass;
  for (const reel of cab.reels) items.push({ kind: 'reel', z: at(reel, PASS.reel), reel });
  for (const strip of cab.bandReels ?? []) items.push({ kind: 'band', z: at(strip, PASS.band), strip });
  for (const flip of cab.flipReels ?? []) items.push({ kind: 'flip', z: at(flip, PASS.flip), flip });
  for (const bonus of cab.bonusReels ?? []) items.push({ kind: 'bonus', z: at(bonus, PASS.bonus), bonus });
  for (const frame of cab.frameReels) items.push({ kind: 'frame', z: at(frame, PASS.frame), frame });
  if (cab.featureReel) items.push({ kind: 'feature', z: at(cab.featureReel, PASS.feature), feature: cab.featureReel });
  items.push({ kind: 'reelLight', z: PASS.reelLight });
  if (cab.vfd) items.push({ kind: 'vfd', z: at(cab.vfd, PASS.vfd), vfd: cab.vfd });
  for (const lamp of cab.lamps) if (!lamp.hidden) items.push({ kind: 'lamp', z: at(lamp, PASS.lamp), lamp });
  for (const bitmap of cab.bitmaps ?? []) items.push({ kind: 'bitmap', z: at(bitmap, PASS.image), bitmap });
  for (const seg of cab.segDisplays ?? []) items.push({ kind: 'seg', z: at(seg, PASS.seg), seg });
  (cab.rgbLeds ?? []).forEach((led, index) => items.push({ kind: 'rgbLed', z: at(led, PASS.rgbLed), led, index }));
  for (const prism of cab.prismLamps ?? []) items.push({ kind: 'prism', z: at(prism, PASS.prism), prism });
  const panels: [PanelKind, Rect | null | undefined][] = [
    ['dotMatrix', cab.dotMatrix], ['proconnMatrix', cab.proconnMatrix],
    ['epochDotAlpha', cab.epochDotAlpha], ['maygayMatrix', cab.maygayMatrix],
    ['epochMatrix', cab.epochMatrix], ['plasmaPanel', cab.plasmaPanel],
    ['astraLed', cab.astraLed], ['bfmColourLed', cab.bfmColourLed], ['igtVfd', cab.igtVfd],
  ];
  for (const [which, panel] of panels) if (panel) items.push({ kind: 'panel', z: at(panel, PASS[which]), which, panel });
  for (const panel of cab.bfmLeds ?? []) items.push({ kind: 'bfmLed', z: at(panel, PASS.bfmLed), panel });
  for (const panel of cab.dotLcds ?? []) items.push({ kind: 'dotLcd', z: at(panel, PASS.dotLcd), panel });
  for (const panel of cab.coinmasterVideos ?? []) items.push({ kind: 'cmVideo', z: at(panel, PASS.cmVideo), panel });
  if (cab.videoScreen) items.push({ kind: 'video', z: at(cab.videoScreen, PASS.video), screen: cab.videoScreen });
  for (const light of cab.lightSources ?? []) items.push({ kind: 'light', z: at(light, PASS.light), light });
  for (const checkbox of cab.checkboxes ?? []) items.push({ kind: 'checkbox', z: at(checkbox, PASS.lamp), checkbox });
  const order = items.map((it, i) => ({ it, i }))
    .sort((a, b) => a.it.z - b.it.z || a.i - b.i)
    .map(({ it }) => it);
  cache.set(cab as object, order as DrawItem<unknown>[]);
  return order;
}
