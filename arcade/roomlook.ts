import { str } from '../web/i18n';

export type Panelling = 'wood' | 'planks';
export type UpperWall = 'woodchip' | 'plaster';
export type Carpet = 'neon' | 'plush' | 'cord' | 'squares' | 'checker';
export type WindowView = 'harbour' | 'square' | 'oldtown';
export type NeonMotion = 'still' | 'chase' | 'chase-back' | 'pulse' | 'flicker' | 'cycle';

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
  neonOn: boolean;
  carpet: Carpet;
  carpetColour: string;
  carpetGround: string;
  carpetInks: [string, string, string];
}

export const PANELLING: { id: Panelling; label: string; colour: string }[] = [
  { id: 'wood', label: str('arcade.roomlook.wood_panels'), colour: '#9a8a7c' },
  { id: 'planks', label: str('arcade.roomlook.painted_panels'), colour: '#6a625a' },
];

export const UPPER_WALLS: { id: UpperWall; label: string; colour: string }[] = [
  { id: 'woodchip', label: str('arcade.roomlook.woodchip'), colour: '#c08850' },
  { id: 'plaster', label: str('arcade.roomlook.plaster'), colour: '#b07a48' },
];

export const NEON_MOTIONS: { id: NeonMotion; label: string }[] = [
  { id: 'still', label: str('arcade.roomlook.still') },
  { id: 'chase', label: str('arcade.roomlook.chase_right') },
  { id: 'chase-back', label: str('arcade.roomlook.chase_left') },
  { id: 'pulse', label: str('arcade.roomlook.pulse') },
  { id: 'flicker', label: str('arcade.roomlook.flicker') },
  { id: 'cycle', label: str('arcade.roomlook.colour_cycle') },
];
export const WINDOW_VIEWS: { id: WindowView; label: string }[] = [
  { id: 'harbour', label: str('arcade.roomlook.harbour') },
  { id: 'square', label: str('arcade.roomlook.town_square') },
  { id: 'oldtown', label: str('arcade.roomlook.old_town') },
];
export const NEON_SPEED = { min: 0.25, max: 3 };

export const CARPETS: { id: Carpet; label: string; colour: string }[] = [
  { id: 'neon', label: str('arcade.roomlook.arcade_neon'), colour: '#ffffff' },
  { id: 'plush', label: str('arcade.roomlook.plush'), colour: '#7a2028' },
  { id: 'cord', label: str('arcade.roomlook.cord'), colour: '#6a2030' },
  { id: 'squares', label: str('arcade.roomlook.squares'), colour: '#ffffff' },
  { id: 'checker', label: str('arcade.roomlook.chequers'), colour: '#ffffff' },
];

export const HOUSE_LOOK: RoomLook = {
  lower: 'wood', lowerColour: '#9a8a7c', upper: 'woodchip', upperColour: '#c08850', rail: '#6a5240',
  neon: ['#ff2fb0', '#23c8ff', '#23c8ff'], sign: '#ff2fb0', signOn: true, neonOn: true, neonMotion: 'still', neonSpeed: 1, window: 'harbour',
  carpet: 'neon', carpetColour: '#ffffff', carpetGround: '#050407', carpetInks: ['#ff2fb0', '#23c8ff', '#ffe03a'],
};

export const THEMES: { id: string; label: string; look: RoomLook }[] = [
  { id: 'arcade', label: str('arcade.roomlook.seaside_arcade'), look: HOUSE_LOOK },
  {
    id: 'club', label: str('arcade.roomlook.social_club'), look: {
      lower: 'planks', lowerColour: '#5a1e22', upper: 'woodchip', upperColour: '#e0c89a', rail: '#3a2418',
      neon: ['#ff7a3a', '#ff7a3a', '#ff7a3a'], sign: '#ff4a3a', signOn: true, neonOn: true, neonMotion: 'still', neonSpeed: 1, window: 'square',
      carpet: 'plush', carpetColour: '#9a2a34', carpetGround: '#050407', carpetInks: ['#ff2fb0', '#23c8ff', '#ffe03a'],
    },
  },
  {
    id: 'casino', label: str('arcade.roomlook.casino_lounge'), look: {
      lower: 'wood', lowerColour: '#8a6a54', upper: 'plaster', upperColour: '#4a7a5c', rail: '#c8a050',
      neon: ['#ffcc55', '#ffcc55', '#ffcc55'], sign: '#ffcc55', signOn: true, neonOn: true, neonMotion: 'chase', neonSpeed: 0.6, window: 'oldtown',
      carpet: 'cord', carpetColour: '#a03040', carpetGround: '#050407', carpetInks: ['#ff2fb0', '#23c8ff', '#ffe03a'],
    },
  },
  {
    id: 'bingo', label: str('arcade.roomlook.bingo_hall'), look: {
      lower: 'planks', lowerColour: '#2a3a6a', upper: 'plaster', upperColour: '#b8c8e0', rail: '#e0e0e0',
      neon: ['#ff4040', '#40ff80', '#ffd040'], sign: '#40ff80', signOn: true, neonOn: true, neonMotion: 'cycle', neonSpeed: 1, window: 'harbour',
      carpet: 'checker', carpetColour: '#ffffff', carpetGround: '#050407', carpetInks: ['#ff2fb0', '#23c8ff', '#ffe03a'],
    },
  },
  {
    id: 'services', label: str('arcade.roomlook.motorway_services'), look: {
      lower: 'planks', lowerColour: '#7a7a78', upper: 'plaster', upperColour: '#e8dcc4', rail: '#4a4a48',
      neon: ['#f4f4ff', '#40c0e0', '#40c0e0'], sign: '#40c0e0', signOn: true, neonOn: true, neonMotion: 'pulse', neonSpeed: 1, window: 'harbour',
      carpet: 'squares', carpetColour: '#ffffff', carpetGround: '#050407', carpetInks: ['#ff2fb0', '#23c8ff', '#ffe03a'],
    },
  },
  {
    id: 'late', label: str('arcade.roomlook.after_hours'), look: {
      lower: 'wood', lowerColour: '#4a3a40', upper: 'woodchip', upperColour: '#5a3a6a', rail: '#2a2028',
      neon: ['#8a3cff', '#ff2fb0', '#ff2fb0'], sign: '#8a3cff', signOn: true, neonOn: true, neonMotion: 'flicker', neonSpeed: 1, window: 'square',
      carpet: 'neon', carpetColour: '#ffffff', carpetGround: '#08040c', carpetInks: ['#8a3cff', '#ff2fb0', '#23c8ff'],
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

export function readRoomLook(v: unknown): RoomLook | null {
  if (!v || typeof v !== 'object') return null;
  const l = v as Record<string, unknown>;
  const neon = Array.isArray(l.neon) ? l.neon : [];
  const inks = Array.isArray(l.carpetInks) ? l.carpetInks : [];
  return {
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
  };
}

export function lookOf(v: unknown): RoomLook {
  return readRoomLook(v) ?? copyLook(HOUSE_LOOK);
}

export function copyLook(l: RoomLook): RoomLook {
  return { ...l, neon: [...l.neon] as RoomLook['neon'], carpetInks: [...l.carpetInks] as RoomLook['carpetInks'] };
}

export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

export function neonMotionOn(): boolean {
  return !(typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches);
}
