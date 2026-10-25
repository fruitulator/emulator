import { str } from '../web/i18n';

export type PropKind = 'barStool' | 'metalStool' | 'plantTall' | 'plantWide' | 'chalkboard' | 'wetFloor' | 'bin' | 'sofa' | 'cigMachine' | 'poster';

export type PosterArt = 'balloon' | 'cirque' | 'trapeze' | 'showmen' | 'clowns' | 'coneyisland' | 'watercircus' | 'ladyclown' | 'bicycles';
export const POSTERS: { id: PosterArt; label: string; aspect: number }[] = [
  { id: 'cirque', label: str('arcade.proplist.cirque_d_hiver'), aspect: 482 / 768 },
  { id: 'balloon', label: str('arcade.proplist.balloon_cyclist'), aspect: 542 / 768 },
  { id: 'trapeze', label: str('arcade.proplist.balloon_trapeze'), aspect: 629 / 768 },
  { id: 'showmen', label: str('arcade.proplist.showmen'), aspect: 553 / 768 },
  { id: 'clowns', label: str('arcade.proplist.clowns_and_geese'), aspect: 489 / 768 },
  { id: 'coneyisland', label: str('arcade.proplist.water_carnival'), aspect: 567 / 768 },
  { id: 'watercircus', label: str('arcade.proplist.water_circus'), aspect: 559 / 768 },
  { id: 'ladyclown', label: str('arcade.proplist.lady_clown'), aspect: 549 / 768 },
  { id: 'bicycles', label: str('arcade.proplist.bicycles'), aspect: 493 / 768 },
];
export function posterArt(a: PosterArt | undefined): (typeof POSTERS)[number] {
  return POSTERS.find((p) => p.id === a) ?? POSTERS[0];
}

export interface Prop {
  id: string;
  kind: PropKind;
  x: number;
  z: number;
  yaw: number;
  art?: PosterArt;
}

export const CIG_MACHINE_W = 0.76;
export const CIG_MACHINE_H = 0.9;
export const CIG_MACHINE_D = 0.25;
export const CIG_MACHINE_Y0 = 0.95;

export const PROP_KINDS: {
  id: PropKind; label: string; file: string; w: number; d: number;
  fitH?: number;
  skin?: 'powder';
  wall?: boolean;
}[] = [
  { id: 'barStool', label: str('arcade.proplist.bar_stool'), file: 'bar_chair_round_01', w: 0.48, d: 0.49 },
  { id: 'metalStool', label: str('arcade.proplist.metal_stool'), file: 'metal_stool_01', w: 0.35, d: 0.35 },
  { id: 'plantTall', label: str('arcade.proplist.tall_plant'), file: 'potted_plant_01', w: 0.59, d: 0.64 },
  { id: 'plantWide', label: str('arcade.proplist.leafy_plant'), file: 'potted_plant_02', w: 0.70, d: 0.66 },
  { id: 'chalkboard', label: str('arcade.proplist.chalkboard_sign'), file: 'standing_chalkboard_01', w: 0.92, d: 0.76 },
  { id: 'sofa', label: str('arcade.proplist.leather_sofa'), file: 'sofa_02', w: 1.81, d: 0.82 },
  { id: 'wetFloor', label: str('arcade.proplist.wet_floor_sign'), file: 'WetFloorSign_01', w: 0.30, d: 0.36 },
  { id: 'bin', label: str('arcade.proplist.bin'), file: 'trashcan_cylindric', w: 0.38, d: 0.38, fitH: 0.6, skin: 'powder' },
  { id: 'cigMachine', label: str('arcade.proplist.cigarette_machine'), file: '', w: CIG_MACHINE_W, d: CIG_MACHINE_D, wall: true },
  { id: 'poster', label: str('arcade.proplist.poster'), file: '', w: 0, d: 0, wall: true },
];

export const PROPS_MAX = 40;

export const PROP_WALL_GAP = 0.02;

export function propKind(k: PropKind): (typeof PROP_KINDS)[number] {
  return PROP_KINDS.find((p) => p.id === k)!;
}

export function newPropId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function readProps(v: unknown): Prop[] | null {
  if (!Array.isArray(v)) return null;
  const out: Prop[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const p = x as Partial<Prop> | null;
    if (!p || typeof p.id !== 'string' || !p.id || seen.has(p.id)) continue;
    if (!PROP_KINDS.some((k) => k.id === p.kind)) continue;
    if (![p.x, p.z, p.yaw].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    seen.add(p.id);
    const q: Prop = { id: p.id, kind: p.kind as PropKind, x: p.x!, z: p.z!, yaw: p.yaw! };
    if (q.kind === 'poster') q.art = posterArt(p.art).id;
    out.push(q);
    if (out.length >= PROPS_MAX) break;
  }
  return out;
}

export const POSTER_H = 0.9;
export const POSTER_FRAME = 0.035;
export const POSTER_Y = 1.9;

export function wallHalfWidth(p: Prop): number {
  if (p.kind === 'poster') return (POSTER_H * posterArt(p.art).aspect) / 2 + POSTER_FRAME + 0.1;
  return propKind(p.kind).w / 2 + 0.05;
}

export function propOnWall(p: Prop, box: { minX: number; maxX: number; minZ: number; maxZ: number }, centre: { x: number; z: number }): {
  x: number; z: number; yaw: number;  hw: number;
} {
  const wx = centre.x + p.x;
  const wz = centre.z + p.z;
  const hw = wallHalfWidth(p);
  const along = (v: number, lo: number, hi: number): number => Math.min(hi - hw, Math.max(lo + hw, v));
  const walls = [
    { d: Math.abs(wz - box.minZ), x: along(wx, box.minX, box.maxX), z: box.minZ, yaw: 0 },
    { d: Math.abs(box.maxZ - wz), x: along(wx, box.minX, box.maxX), z: box.maxZ, yaw: Math.PI },
    { d: Math.abs(wx - box.minX), x: box.minX, z: along(wz, box.minZ, box.maxZ), yaw: Math.PI / 2 },
    { d: Math.abs(box.maxX - wx), x: box.maxX, z: along(wz, box.minZ, box.maxZ), yaw: -Math.PI / 2 },
  ].sort((u, v) => u.d - v.d)[0];
  return { x: walls.x, z: walls.z, yaw: walls.yaw, hw };
}

export function footprintAt(kind: PropKind, stand: { x: number; z: number; yaw: number }): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  const k = propKind(kind);
  if (!k.w && !k.d) return null;
  let { x, z } = stand;
  if (k.wall) {
    x += Math.sin(stand.yaw) * k.d / 2;
    z += Math.cos(stand.yaw) * k.d / 2;
  }
  const c = Math.abs(Math.cos(stand.yaw));
  const s = Math.abs(Math.sin(stand.yaw));
  const hw = (c * k.w + s * k.d) / 2 + 0.03;
  const hd = (s * k.w + c * k.d) / 2 + 0.03;
  return { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd };
}

export function propFootprint(p: Prop, centre: { x: number; z: number }): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return footprintAt(p.kind, { x: centre.x + p.x, z: centre.z + p.z, yaw: p.yaw })!;
}
