
export interface EffectSample {
  readonly file: string;
  readonly loop: boolean;
  readonly through: boolean;
}

const s = (file: string, flags: number): EffectSample =>
  ({ file, loop: (flags & 0xff) !== 0, through: (flags & 0x100) !== 0 });

export const EFFECT_SAMPLES: readonly EffectSample[] = [
  s('MotorOn.wav', 0x001), s('SolenoidOn.wav', 0x000), s('SolenoidOff.wav', 0x000),
  s('Wiper.wav', 0x001), s('10pSlide.wav', 0x100), s('TokenSlide.wav', 0x100),
  s('Buzzer.wav', 0x001), s('BellOn.wav', 0x001), s('BellOff.wav', 0x100),
  s('ButtonDown.wav', 0x000), s('ButtonUp.wav', 0x000), s('Sounder.wav', 0x000),
  s('Meter.wav', 0x100), s('RelayOn.wav', 0x000), s('RelayOff.wav', 0x000),
  s('LockoutOn.wav', 0x000), s('LockoutOff.wav', 0x000), s('20pSlide.wav', 0x100),
  s('50pSlide.wav', 0x100), s('Stepper.wav', 0x001), s('HopperMotor1.wav', 0x001),
  s('HopperCoin1.wav', 0x000), s('CoinIn.wav', 0x000), s('CoinInSwitch.wav', 0x000),
  s('CoinInRejected.wav', 0x000), s('NoteIn.wav', 0x000), s('NoteInStack.wav', 0x000),
  s('S1Locked.wav', 0x000), s('CoinInDrop.wav', 0x000), s('CoinDropReject.wav', 0x000),
  s('NoteInReject.wav', 0x000), s('PoundSlide.wav', 0x100), s('MiscSlide.wav', 0x100),
  s('HopperMotor2.wav', 0x001), s('HopperCoin2.wav', 0x000), s('CoinInS10.wav', 0x000),
  s('CoinInS10Token.wav', 0x000), s('PrizeMotor.wav', 0x001), s('PrizeVend.wav', 0x000),
  s('2pSlide.wav', 0x100), s('CoinInS10Switch.wav', 0x100), s('CoinInS10TokenSwitch.wav', 0x100),
  s('CoinInS10Rejected.wav', 0x000), s('CoinInS10TokenRejected.wav', 0x000), s('TokenIn.wav', 0x000),
  s('TokenInSwitch.wav', 0x000), s('TokenInRejected.wav', 0x000), s('CoinInS1.wav', 0x000),
  s('CoinInS1Token.wav', 0x000), s('CoinInS1Switch.wav', 0x100), s('CoinInS1TokenSwitch.wav', 0x100),
  s('PullHandleSlow.wav', 0x100), s('PullHandleNormal.wav', 0x100), s('PullHandleFast.wav', 0x100),
  s('PullHandleRelease.wav', 0x100),
];

export const SAMPLE = {
  ButtonDown: 9,
  ButtonUp: 10,
  Stepper: 19,
  HopperMotor1: 20,
  HopperCoin1: 21,
  CoinIn: 22,
  NoteIn: 25,
  NoteInStack: 26,
  S1Locked: 27,
  CoinInDrop: 28,
  HopperMotor2: 33,
  HopperCoin2: 34,
  CoinInS10: 35,
  CoinInS10Token: 36,
  TokenIn: 44,
  CoinInS1: 47,
  CoinInS1Token: 48,
} as const;

export const EFFECT_CODES: readonly (readonly number[])[] = [
  [0], [1], [2], [3], [4], [5], [6], [7], [8], [9], [10], [11], [12], [13], [14],
  [15], [16], [17], [18], [1, 3], [2],
  [19], [20], [21], [22], [23], [24], [25], [26], [27], [28], [29], [30], [31],
  [32], [33], [34], [35], [36], [37], [38], [39], [40], [41], [42], [43], [44],
  [45], [46], [47], [48], [49], [50], [51], [52], [53], [54],
];

export function samplesForStored(stored: number): readonly number[] {
  return EFFECT_CODES[stored - 1] ?? [];
}

export const EFFECT_GROUP = {
  reels: 0x01,
  meters: 0x02,
  triacs: 0x04,
  buttons: 0x08,
  coins: 0x10,
} as const;

export const EFFECTS_MASK_DEFAULT = 0xff;

export function effectsMask(settings: ReadonlyMap<string, string> | undefined | null): number {
  const raw = settings?.get('Effects');
  if (raw === undefined) return EFFECTS_MASK_DEFAULT;
  const v = Number.parseInt(raw, 10);
  return Number.isFinite(v) ? v & 0xff : EFFECTS_MASK_DEFAULT;
}

const SAMPLE_BY_NAME = new Map(EFFECT_SAMPLES.map((e, i) => [e.file.toLowerCase(), i]));

export function effectSampleIndex(name: string): number {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  return SAMPLE_BY_NAME.get(base.toLowerCase()) ?? -1;
}

export const EFFECT_TECHS: readonly string[] = [
  'Unknown', 'MPU3', 'MPU4', 'IMPACT', 'M1AB', 'MPS2', 'SYS1', 'SCORPION2', 'DOTMATRIX',
  'SYSTEM80', 'SYS5', 'MPU4VIDEO', 'SCORPION1', 'SYS85', 'spACE', 'PROCONN', 'SCORPION4',
  'MACH2000E', 'MPU5', 'SRU', 'EPOCH', 'MACH2000S', 'MACH2000A', 'MMM', 'MPU2', 'IGTS+',
  'SCORPION5', 'ADDER5', 'SYS83', 'IGTS2000', 'IGTVFD', 'ACEVIDEO', 'MPU4PLASMA',
  'ELECTROCOIN', 'ECOINSOUND', 'COINMASTER', 'ASTRASYSA1', 'PLUTO5', 'PHOENIX', 'BLACKBOX',
  'ELECTRO', 'M1VIDEO', 'M1REEL', 'INDER', 'PCLMAXI', 'MAYGAYDOTMATRIX', 'PHOENIX2',
];

export function effectSearchPaths(file: string, system: string, cabinetStyle: string | null): string[] {
  const tech = EFFECT_TECHS.find((t, i) => i > 0 && t.toUpperCase() === system.toUpperCase());
  if (!tech) return [file];
  const style = cabinetStyle && cabinetStyle !== 'Default' ? `${cabinetStyle}/` : '';
  return [`Custom/${tech}/${style}${file}`, file];
}

export function isEffectSample(name: string): boolean {
  return effectSampleIndex(name) >= 0;
}

export const COIN_NOTE_TYPES: readonly number[] = [
  1, 1, 1, 2, 1, 1, 1,
  1, 1, 1, 1, 1, 1,
  1, 1,
  1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 2, 1, 1, 1,
  7, 7, 7,
  1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1,
  7, 7, 7, 7,
  4, 1, 1, 4, 3, 3,
  2, 2,
  7, 7, 7,
  2, 2, 2, 2, 2, 2,
  1, 2, 0, 0,
  1, 1, 1, 1,
];

export function isNoteId(id: number): boolean {
  return (id >= 0x1e && id <= 0x20) || (id >= 0x2f && id <= 0x32) || (id >= 0x3b && id <= 0x3d);
}

export interface CoinSound {
  first: number;
  then: number | null;
}

export type CoinOutcome = 'accepted' | 'locked' | 'refused';

export function coinSound(
  coinNoteId: number | undefined, effectId: number | undefined, outcome: CoinOutcome = 'accepted',
): CoinSound | null {
  if (coinNoteId !== undefined && isNoteId(coinNoteId)) {
    return outcome === 'locked' ? null : { first: SAMPLE.NoteIn, then: SAMPLE.NoteInStack };
  }
  const raw = effectId ?? 0;
  const type = raw || (coinNoteId !== undefined ? COIN_NOTE_TYPES[coinNoteId] ?? 0 : 1);
  if (outcome === 'locked' && (type === 5 || type === 8)) return { first: SAMPLE.S1Locked, then: null };
  const first = ({
    1: SAMPLE.CoinIn, 2: SAMPLE.TokenIn, 3: SAMPLE.CoinInS10, 4: SAMPLE.CoinInS10Token,
    5: SAMPLE.CoinInS1, 6: SAMPLE.CoinInDrop, 8: SAMPLE.CoinInS1Token,
  } as Record<number, number>)[type];
  if (first === undefined) return null;
  const follow = (code: number): CoinSound => ({ first, then: EFFECT_CODES[code]?.[0] ?? null });
  if (outcome === 'locked') {
    return follow(({ 3: 0x2c, 4: 0x2d, 6: 0x1f } as Record<number, number>)[raw] ?? 0x1a);
  }
  if (raw === 6) return { first, then: null };
  if (outcome === 'refused') {
    return follow(({ 2: 0x30, 3: 0x2c, 4: 0x2d } as Record<number, number>)[raw] ?? 0x1a);
  }
  return follow(({ 2: 0x2f, 3: 0x2a, 4: 0x2b, 5: 0x33, 8: 0x34 } as Record<number, number>)[raw] ?? 0x19);
}
