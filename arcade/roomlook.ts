import { str } from '../web/i18n';
import type { SurfaceId } from './roomtextures';

export type Panelling = 'wood' | 'planks';
export type UpperWall = 'woodchip' | 'plaster' | 'brick' | 'stock' | 'paintbrick' | 'flock-red' | 'flock-gold'
  | 'panelling' | 'mirror' | 'glazed' | 'laminate' | 'painted';
export type Carpet = 'neon' | 'plush' | 'cord' | 'squares' | 'checker' | 'boards' | 'lino' | 'tile';
export type WindowView = 'harbour' | 'square' | 'oldtown' | 'carpark' | 'blinds' | 'frosted' | 'none';
export type Ceiling = 'tiles' | 'beams' | 'panels' | 'coffered';
export type CeilingFinish = 'cream' | 'wood';
export type NeonMotion = 'still' | 'chase' | 'chase-back' | 'pulse' | 'flicker' | 'cycle';
export type SignStyle = 'neon' | 'marquee' | 'ghost' | 'gilded' | 'brass' | 'lightbox' | 'vinyl' | 'matrix';
export type SignFont = 'relief' | 'bungee' | 'anton' | 'abril' | 'yesteryear' | 'lilita' | 'barlow' | 'dots';
export type SignBoard = 'black' | 'green' | 'maroon';
export type SignLed = 'red' | 'amber' | 'green';

export interface RoomLook {
  lower: Panelling;
  lowerColour: string;
  upper: UpperWall;
  upperColour: string;
  rail: string;
  neon: [string, string, string];
  neonMotion: NeonMotion;
  neonSpeed: number;
  window: WindowView;
  sign: string;
  signOn: boolean;
  signStyle: SignStyle;
  signFont: SignFont;
  signSize: number;
  signHeight: number;
  signPos: number;
  signBackboard: boolean;
  signChase: number;
  signWear: number;
  signBoard: SignBoard;
  signFace: string;
  signLed: SignLed;
  signShowName: boolean;
  signText: string;
  neonOn: boolean;
  carpet: Carpet;
  carpetColour: string;
  carpetGround: string;
  carpetInks: [string, string, string];
  ceiling: Ceiling;
  ceilingColour: string;
  ceilingFinish: CeilingFinish;
  ceilingGlow: number;
  chandelier: boolean;
  ceilingLamps: boolean;
  wallLights: boolean;
  sconceShade: SconceShade;
  sconceMetal: SconceMetal;
  wallLightStrength: WallLightStrength;
}

export const PANELLING: { id: Panelling; label: string; colour: string }[] = [
  { id: 'wood', label: str('arcade.roomlook.wood_panels'), colour: '#9a8a7c' },
  { id: 'planks', label: str('arcade.roomlook.painted_panels'), colour: '#6a625a' },
];

export const UPPER_WALLS: { id: UpperWall; label: string; colour: string }[] = [
  { id: 'woodchip', label: str('arcade.roomlook.woodchip'), colour: '#c08850' },
  { id: 'plaster', label: str('arcade.roomlook.plaster'), colour: '#b07a48' },
  { id: 'brick', label: str('arcade.roomlook.red_brick'), colour: '#ffffff' },
  { id: 'stock', label: str('arcade.roomlook.yellow_stock_brick'), colour: '#ffffff' },
  { id: 'paintbrick', label: str('arcade.roomlook.painted_brick'), colour: '#e4ddd0' },
  { id: 'flock-red', label: str('arcade.roomlook.red_flock'), colour: '#9a1c26' },
  { id: 'flock-gold', label: str('arcade.roomlook.gold_flock'), colour: '#c8a050' },
  { id: 'panelling', label: str('arcade.roomlook.wood_panelling_full'), colour: '#ffffff' },
  { id: 'mirror', label: str('arcade.roomlook.mirror_tiles'), colour: '#ffffff' },
  { id: 'glazed', label: str('arcade.roomlook.glazed_tiles'), colour: '#e8efe8' },
  { id: 'laminate', label: str('arcade.roomlook.laminate'), colour: '#e6e1d6' },
  { id: 'painted', label: str('arcade.roomlook.painted_panels'), colour: '#b8b0a2' },
];

export function wallSurface(u: UpperWall): SurfaceId {
  switch (u) {
    case 'flock-red': case 'flock-gold': return 'flock';
    case 'painted': return 'planks';
    default: return u;
  }
}

export function fullHeight(u: UpperWall): boolean {
  return u === 'panelling';
}

export function upperTinted(u: UpperWall): boolean {
  return !['brick', 'stock', 'flock-red', 'flock-gold', 'mirror'].includes(u);
}

export function isBrick(u: UpperWall): boolean {
  return u === 'brick' || u === 'stock' || u === 'paintbrick';
}

export const SIGN_STYLES: { id: SignStyle; label: string }[] = [
  { id: 'neon', label: str('arcade.roomlook.sign_neon') },
  { id: 'marquee', label: str('arcade.roomlook.bulb_marquee') },
  { id: 'ghost', label: str('arcade.roomlook.painted_signwriting') },
  { id: 'gilded', label: str('arcade.roomlook.gilded_fascia') },
  { id: 'brass', label: str('arcade.roomlook.brass_letters') },
  { id: 'lightbox', label: str('arcade.roomlook.lightbox') },
  { id: 'vinyl', label: str('arcade.roomlook.vinyl') },
  { id: 'matrix', label: str('arcade.roomlook.led_scroller') },
];

export const SIGN_FONTS: Record<SignStyle, SignFont[]> = {
  neon: ['relief'],
  marquee: ['relief', 'bungee', 'anton'],
  ghost: ['abril', 'yesteryear', 'anton', 'bungee'],
  gilded: ['abril', 'yesteryear', 'barlow'],
  brass: ['anton', 'abril', 'bungee', 'lilita'],
  lightbox: ['barlow', 'anton', 'lilita', 'bungee'],
  vinyl: ['lilita', 'bungee', 'anton', 'barlow', 'yesteryear'],
  matrix: ['dots'],
};
export const FONT_NAMES: Record<SignFont, string> = {
  relief: 'Relief SingleLine', bungee: 'Bungee', anton: 'Anton', abril: 'Abril Fatface',
  yesteryear: 'Yesteryear', lilita: 'Lilita One', barlow: 'Barlow Condensed', dots: '5×7',
};

export const SIGN_BOARDS: { id: SignBoard; label: string }[] = [
  { id: 'black', label: str('arcade.roomlook.black') },
  { id: 'green', label: str('arcade.roomlook.green') },
  { id: 'maroon', label: str('arcade.roomlook.maroon') },
];
export const SIGN_LEDS: { id: SignLed; label: string }[] = [
  { id: 'red', label: str('arcade.roomlook.red') },
  { id: 'amber', label: str('arcade.roomlook.amber') },
  { id: 'green', label: str('arcade.roomlook.green') },
];
export const SIGN_SIZE = { min: 0.5, max: 2 };
export const SIGN_HEIGHT = { min: 1.5, max: 2.8 };
export const SIGN_CHASE = { max: 3 };
export const SIGN_TEXT_MAX = 60;

export function signBlocked(style: SignStyle, upper: UpperWall): 'brick' | 'flat' | null {
  if (style === 'ghost' && !isBrick(upper)) return 'brick';
  if (style === 'vinyl' && (upper === 'flock-red' || upper === 'flock-gold' || upper === 'mirror')) return 'flat';
  return null;
}

export function signFallback(style: SignStyle, upper: UpperWall): SignStyle {
  if (!signBlocked(style, upper)) return style;
  if (style === 'ghost' && !signBlocked('vinyl', upper)) return 'vinyl';
  return 'neon';
}

export function fitSign(l: RoomLook): RoomLook {
  const style = signFallback(l.signStyle, l.upper);
  const font = SIGN_FONTS[style].includes(l.signFont) ? l.signFont : SIGN_FONTS[style][0];
  return style === l.signStyle && font === l.signFont ? l : { ...l, signStyle: style, signFont: font };
}

export function scrollerMessages(l: RoomLook, name: string | null): string[] {
  const out: string[] = [];
  if (l.signShowName && name) out.push(name);
  if (l.signText.trim()) out.push(l.signText.trim());
  if (!out.length && name) out.push(name);
  return out;
}

export const NEON_MOTIONS: { id: NeonMotion; label: string }[] = [
  { id: 'still', label: str('arcade.roomlook.still') },
  { id: 'chase', label: str('arcade.roomlook.chase_right') },
  { id: 'chase-back', label: str('arcade.roomlook.chase_left') },
  { id: 'pulse', label: str('arcade.roomlook.pulse') },
  { id: 'flicker', label: str('arcade.roomlook.flicker') },
  { id: 'cycle', label: str('arcade.roomlook.colour_cycle') },
];
export const WINDOW_VIEWS: { id: WindowView; label: string }[] = [
  { id: 'square', label: str('arcade.roomlook.town_square') },
  { id: 'harbour', label: str('arcade.roomlook.waterfront') },
  { id: 'carpark', label: str('arcade.roomlook.motorway_car_park_at') },
  { id: 'oldtown', label: str('arcade.roomlook.old_town') },
  { id: 'blinds', label: str('arcade.roomlook.closed_blinds') },
  { id: 'frosted', label: str('arcade.roomlook.frosted') },
  { id: 'none', label: str('arcade.roomlook.no_window') },
];
export const NEON_SPEED = { min: 0.25, max: 3 };

export const CEILINGS: { id: Ceiling; label: string; colour: string }[] = [
  { id: 'tiles', label: str('arcade.roomlook.acoustic_tiles'), colour: '#d8d4cc' },
  { id: 'beams', label: str('arcade.roomlook.timber_beams'), colour: '#ece2cc' },
  { id: 'panels', label: str('arcade.roomlook.dark_panels'), colour: '#2a2830' },
  { id: 'coffered', label: str('arcade.roomlook.coffered'), colour: '#efe2c4' },
];

export type WallFixture = 'cans' | 'spots' | 'track' | 'sconces';
export const WALL_FIXTURES: Record<Ceiling, { fixture: WallFixture; on: boolean }> = {
  tiles: { fixture: 'cans', on: false },
  beams: { fixture: 'spots', on: true },
  panels: { fixture: 'track', on: true },
  coffered: { fixture: 'sconces', on: true },
};

export type SconceShade = 'cream' | 'red' | 'green' | 'gold';
export const SCONCE_SHADES: { id: SconceShade; label: string; glow: string }[] = [
  { id: 'cream', label: str('arcade.roomlook.shade_cream'), glow: '#ffe2b8' },
  { id: 'red', label: str('arcade.roomlook.shade_red'), glow: '#e8483a' },
  { id: 'green', label: str('arcade.roomlook.shade_green'), glow: '#62b878' },
  { id: 'gold', label: str('arcade.roomlook.shade_gold'), glow: '#ffbc4a' },
];
export type SconceMetal = 'brass' | 'chrome' | 'black';
export const SCONCE_METALS: { id: SconceMetal; label: string; shadow: string; lit: string; shine: string; sharp: number; gloss: number }[] = [
  { id: 'brass', label: str('arcade.roomlook.metal_brass'), shadow: '#3a2610', lit: '#a8803c', shine: '#ffe2a8', sharp: 10, gloss: 0.8 },
  { id: 'chrome', label: str('arcade.roomlook.metal_chrome'), shadow: '#1e2024', lit: '#7c8088', shine: '#fff6ea', sharp: 28, gloss: 1 },
  { id: 'black', label: str('arcade.roomlook.metal_black'), shadow: '#070707', lit: '#1c1c1c', shine: '#6a6258', sharp: 14, gloss: 0.45 },
];
export type WallLightStrength = 'low' | 'medium' | 'high';
export const WALL_LIGHT_STRENGTHS: { id: WallLightStrength; label: string; k: number }[] = [
  { id: 'low', label: str('arcade.roomlook.strength_low'), k: 0.6 },
  { id: 'medium', label: str('arcade.roomlook.strength_medium'), k: 1 },
  { id: 'high', label: str('arcade.roomlook.strength_high'), k: 1.4 },
];

export const CEILING_FINISHES: { id: CeilingFinish; label: string; colour: string }[] = [
  { id: 'cream', label: str('arcade.roomlook.cream_and_gold'), colour: '#efe2c4' },
  { id: 'wood', label: str('arcade.roomlook.dark_wood'), colour: '#2e2219' },
];
export const CEILING_GLOW_MAX = 1;

export const CARPETS: { id: Carpet; label: string; colour: string }[] = [
  { id: 'neon', label: str('arcade.roomlook.arcade_neon'), colour: '#ffffff' },
  { id: 'plush', label: str('arcade.roomlook.plush'), colour: '#7a2028' },
  { id: 'cord', label: str('arcade.roomlook.cord'), colour: '#6a2030' },
  { id: 'squares', label: str('arcade.roomlook.squares'), colour: '#ffffff' },
  { id: 'checker', label: str('arcade.roomlook.chequers'), colour: '#ffffff' },
  { id: 'boards', label: str('arcade.roomlook.polished_boards'), colour: '#a89888' },
  { id: 'lino', label: str('arcade.roomlook.lino'), colour: '#8a7a6a' },
  { id: 'tile', label: str('arcade.roomlook.tile'), colour: '#848484' },
];

export function isHardFloor(c: Carpet): boolean {
  return c === 'boards' || c === 'lino' || c === 'tile';
}

const SIGN_HOUSE = {
  signFont: 'relief', signSize: 1, signHeight: 2.5, signPos: 0, signBackboard: true, signChase: 1, signWear: 0.4,
  signBoard: 'black', signFace: '#fff6e0', signLed: 'amber', signShowName: true, signText: '',
} as const satisfies Partial<RoomLook>;
type SignFields = Omit<Pick<RoomLook, keyof RoomLook & `sign${string}`>, 'sign' | 'signOn'>;
const sign = (style: SignStyle, more: Partial<SignFields> = {}): SignFields => ({
  ...SIGN_HOUSE, signStyle: style, signFont: SIGN_FONTS[style][0], ...more,
});

export const HOUSE_LOOK: RoomLook = {
  lower: 'wood', lowerColour: '#9a8a7c', upper: 'plaster', upperColour: '#c08850', rail: '#6a5240',
  neon: ['#ff2fb0', '#23c8ff', '#23c8ff'], sign: '#ff2fb0', signOn: true, neonOn: true, neonMotion: 'still', neonSpeed: 1, window: 'harbour',
  carpet: 'neon', carpetColour: '#ffffff', carpetGround: '#050407', carpetInks: ['#ff2fb0', '#23c8ff', '#ffe03a'],
  ceiling: 'panels', ceilingColour: '#2a2830', ceilingFinish: 'cream', ceilingGlow: 0.25, chandelier: false, ceilingLamps: false, wallLights: true,
  sconceShade: 'cream', sconceMetal: 'brass', wallLightStrength: 'medium',
  ...sign('marquee'),
};

export const THEMES: { id: string; label: string; look: RoomLook }[] = [
  { id: 'arcade', label: str('arcade.roomlook.seaside_arcade'), look: HOUSE_LOOK },
  {
    id: 'club', label: str('arcade.roomlook.social_club'), look: {
      lower: 'planks', lowerColour: '#5a1e22', upper: 'panelling', upperColour: '#ffffff', rail: '#3a2418',
      neon: ['#ff7a3a', '#ff7a3a', '#ff7a3a'], sign: '#ff4a3a', signOn: true, neonOn: false, neonMotion: 'still', neonSpeed: 1, window: 'square',
      carpet: 'plush', carpetColour: '#9a2a34', carpetGround: '#050407', carpetInks: ['#ff2fb0', '#23c8ff', '#ffe03a'],
      ceiling: 'beams', ceilingColour: '#ece2cc', ceilingFinish: 'cream', ceilingGlow: 0.25, chandelier: false, ceilingLamps: true, wallLights: true,
      sconceShade: 'cream', sconceMetal: 'brass', wallLightStrength: 'medium',
      ...sign('gilded', { signBoard: 'maroon' }),
    },
  },
  {
    id: 'casino', label: str('arcade.roomlook.casino_lounge'), look: {
      lower: 'wood', lowerColour: '#8a6a54', upper: 'flock-red', upperColour: '#9a1c26', rail: '#c8a050',
      neon: ['#ffcc55', '#ffcc55', '#ffcc55'], sign: '#ffcc55', signOn: true, neonOn: false, neonMotion: 'still', neonSpeed: 1, window: 'oldtown',
      carpet: 'cord', carpetColour: '#a03040', carpetGround: '#050407', carpetInks: ['#ff2fb0', '#23c8ff', '#ffe03a'],
      ceiling: 'coffered', ceilingColour: '#efe2c4', ceilingFinish: 'cream', ceilingGlow: 0.55, chandelier: true, ceilingLamps: false, wallLights: true,
      sconceShade: 'cream', sconceMetal: 'brass', wallLightStrength: 'medium',
      ...sign('brass'),
    },
  },
  {
    id: 'bingo', label: str('arcade.roomlook.bingo_hall'), look: {
      lower: 'planks', lowerColour: '#2a3a6a', upper: 'plaster', upperColour: '#b8c8e0', rail: '#e0e0e0',
      neon: ['#ff4040', '#40ff80', '#ffd040'], sign: '#40ff80', signOn: true, neonOn: true, neonMotion: 'cycle', neonSpeed: 1, window: 'harbour',
      carpet: 'checker', carpetColour: '#ffffff', carpetGround: '#050407', carpetInks: ['#ff2fb0', '#23c8ff', '#ffe03a'],
      ceiling: 'tiles', ceilingColour: '#d8d4cc', ceilingFinish: 'cream', ceilingGlow: 0.25, chandelier: false, ceilingLamps: false, wallLights: false,
      sconceShade: 'cream', sconceMetal: 'brass', wallLightStrength: 'medium',
      ...sign('lightbox', { signFace: '#fff6e0' }),
    },
  },
  {
    id: 'services', label: str('arcade.roomlook.motorway_services'), look: {
      lower: 'planks', lowerColour: '#7a7a78', upper: 'laminate', upperColour: '#e6e1d6', rail: '#4a4a48',
      neon: ['#f4f4ff', '#40c0e0', '#40c0e0'], sign: '#40c0e0', signOn: true, neonOn: true, neonMotion: 'pulse', neonSpeed: 1, window: 'carpark',
      carpet: 'squares', carpetColour: '#ffffff', carpetGround: '#050407', carpetInks: ['#ff2fb0', '#23c8ff', '#ffe03a'],
      ceiling: 'tiles', ceilingColour: '#e0e2e4', ceilingFinish: 'cream', ceilingGlow: 0.25, chandelier: false, ceilingLamps: false, wallLights: false,
      sconceShade: 'cream', sconceMetal: 'brass', wallLightStrength: 'medium',
      ...sign('lightbox', { signFace: '#ffffff' }),
    },
  },
  {
    id: 'late', label: str('arcade.roomlook.after_hours'), look: {
      lower: 'wood', lowerColour: '#4a3a40', upper: 'brick', upperColour: '#ffffff', rail: '#2a2028',
      neon: ['#8a3cff', '#ff2fb0', '#ff2fb0'], sign: '#8a3cff', signOn: true, neonOn: true, neonMotion: 'flicker', neonSpeed: 1, window: 'square',
      carpet: 'neon', carpetColour: '#ffffff', carpetGround: '#08040c', carpetInks: ['#8a3cff', '#ff2fb0', '#23c8ff'],
      ceiling: 'panels', ceilingColour: '#1a1620', ceilingFinish: 'cream', ceilingGlow: 0.25, chandelier: false, ceilingLamps: false, wallLights: true,
      sconceShade: 'cream', sconceMetal: 'brass', wallLightStrength: 'medium',
      ...sign('neon'),
    },
  },
];

export function themeOfLook(l: RoomLook): string | null {
  const key = (x: RoomLook): string => JSON.stringify((Object.keys(HOUSE_LOOK) as (keyof RoomLook)[]).map((k) => x[k]));
  const k = key(l);
  return THEMES.find((t) => key(t.look) === k)?.id ?? null;
}

const COLOUR = /^#[0-9a-f]{6}$/i;
const colour = (v: unknown, or: string): string => (typeof v === 'string' && COLOUR.test(v) ? v.toLowerCase() : or);
const oneOf = <T extends string>(v: unknown, list: { id: T }[], or: T): T => list.find((x) => x.id === v)?.id ?? or;
const within = (v: unknown, lo: number, hi: number, or: number): number =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : or);
const bool = (v: unknown, or: boolean): boolean => (typeof v === 'boolean' ? v : or);

export function readRoomLook(v: unknown): RoomLook | null {
  if (!v || typeof v !== 'object') return null;
  const l = v as Record<string, unknown>;
  const ceiling = oneOf(l.ceiling, CEILINGS, HOUSE_LOOK.ceiling);
  const neon = Array.isArray(l.neon) ? l.neon : [];
  const inks = Array.isArray(l.carpetInks) ? l.carpetInks : [];
  const h = HOUSE_LOOK;
  return fitSign({
    lower: oneOf(l.lower, PANELLING, HOUSE_LOOK.lower),
    lowerColour: colour(l.lowerColour, HOUSE_LOOK.lowerColour),
    upper: oneOf(l.upper, UPPER_WALLS, HOUSE_LOOK.upper),
    upperColour: colour(l.upperColour, HOUSE_LOOK.upperColour),
    rail: colour(l.rail, HOUSE_LOOK.rail),
    neon: [0, 1, 2].map((i) => colour(neon[i], HOUSE_LOOK.neon[i])) as [string, string, string],
    sign: colour(l.sign, HOUSE_LOOK.sign),
    signOn: typeof l.signOn === 'boolean' ? l.signOn : HOUSE_LOOK.signOn,
    neonOn: typeof l.neonOn === 'boolean' ? l.neonOn : HOUSE_LOOK.neonOn,
    neonMotion: oneOf(l.neonMotion, NEON_MOTIONS, HOUSE_LOOK.neonMotion),
    window: oneOf(l.window, WINDOW_VIEWS, HOUSE_LOOK.window),
    neonSpeed: typeof l.neonSpeed === 'number' && Number.isFinite(l.neonSpeed)
      ? Math.min(NEON_SPEED.max, Math.max(NEON_SPEED.min, l.neonSpeed)) : HOUSE_LOOK.neonSpeed,
    carpet: oneOf(l.carpet, CARPETS, HOUSE_LOOK.carpet),
    carpetColour: colour(l.carpetColour, HOUSE_LOOK.carpetColour),
    carpetGround: colour(l.carpetGround, HOUSE_LOOK.carpetGround),
    carpetInks: [0, 1, 2].map((i) => colour(inks[i], HOUSE_LOOK.carpetInks[i])) as [string, string, string],
    ceiling,
    ceilingColour: colour(l.ceilingColour, HOUSE_LOOK.ceilingColour),
    ceilingFinish: oneOf(l.ceilingFinish, CEILING_FINISHES, HOUSE_LOOK.ceilingFinish),
    ceilingGlow: typeof l.ceilingGlow === 'number' && Number.isFinite(l.ceilingGlow)
      ? Math.min(CEILING_GLOW_MAX, Math.max(0, l.ceilingGlow)) : HOUSE_LOOK.ceilingGlow,
    chandelier: typeof l.chandelier === 'boolean' ? l.chandelier : HOUSE_LOOK.chandelier,
    ceilingLamps: typeof l.ceilingLamps === 'boolean' ? l.ceilingLamps : HOUSE_LOOK.ceilingLamps,
    signStyle: oneOf(l.signStyle, SIGN_STYLES, 'neon'),
    signFont: (Object.keys(FONT_NAMES) as SignFont[]).find((f) => f === l.signFont) ?? h.signFont,
    signSize: within(l.signSize, SIGN_SIZE.min, SIGN_SIZE.max, h.signSize),
    signHeight: within(l.signHeight, SIGN_HEIGHT.min, SIGN_HEIGHT.max, h.signHeight),
    signPos: within(l.signPos, -1, 1, h.signPos),
    signBackboard: bool(l.signBackboard, h.signBackboard),
    signChase: within(l.signChase, 0, SIGN_CHASE.max, h.signChase),
    signWear: within(l.signWear, 0, 1, h.signWear),
    signBoard: oneOf(l.signBoard, SIGN_BOARDS, h.signBoard),
    signFace: colour(l.signFace, h.signFace),
    signLed: oneOf(l.signLed, SIGN_LEDS, h.signLed),
    signShowName: bool(l.signShowName, h.signShowName),
    signText: typeof l.signText === 'string' ? l.signText.slice(0, SIGN_TEXT_MAX) : h.signText,
    wallLights: typeof l.wallLights === 'boolean' ? l.wallLights : WALL_FIXTURES[ceiling].on,
    sconceShade: oneOf(l.sconceShade, SCONCE_SHADES, h.sconceShade),
    sconceMetal: oneOf(l.sconceMetal, SCONCE_METALS, h.sconceMetal),
    wallLightStrength: oneOf(l.wallLightStrength, WALL_LIGHT_STRENGTHS, h.wallLightStrength),
  });
}

export function lookOf(v: unknown): RoomLook {
  return readRoomLook(v) ?? copyLook(HOUSE_LOOK);
}

export function copyLook(l: RoomLook): RoomLook {
  return {
    ...l, neon: [...l.neon] as RoomLook['neon'], carpetInks: [...l.carpetInks] as RoomLook['carpetInks'],
  };
}

export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

export function neonMotionOn(): boolean {
  return !(typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches);
}
