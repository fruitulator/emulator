
export interface RoomSwitches {
  lights: number;
  pools: boolean;
  shade: boolean;
  textures: boolean;
  aniso: number;
  dpr: number | null;
  aa: boolean;
  env: boolean;
  glass: number;
  glassTex: number;
  glassPs: number;
  glassNearMs: number;
  glassPresent: boolean;
  focusFreeze: boolean;
  dim: boolean;
  glow: boolean;
  lamp: boolean;
}

export const WASH_DEFAULT = 0;
export const WASH_MAX = 12;
export const DPR_CAP = 1.5;
export const GLASS_DEFAULT = 2;
export const GLASS_TEX_DEFAULT = 768;
export const GLASS_PS_DEFAULT = 24;
export const GLASS_NEAR_MS_DEFAULT = 50;

const num = (q: URLSearchParams, k: string, lo: number, hi: number): number | null => {
  const v = q.get(k);
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

export const DEFAULT_SWITCHES: Readonly<RoomSwitches> = Object.freeze<RoomSwitches>({
  lights: WASH_DEFAULT, pools: true, shade: true, textures: true, aniso: 8, dpr: null, aa: true, env: true,
  glass: GLASS_DEFAULT, glassTex: GLASS_TEX_DEFAULT, glassPs: GLASS_PS_DEFAULT, glassNearMs: GLASS_NEAR_MS_DEFAULT,
  glassPresent: true, focusFreeze: true, dim: true, glow: false, lamp: true,
});

const defaults = (): RoomSwitches => ({ ...DEFAULT_SWITCHES });

export function roomSwitches(search = location.search): RoomSwitches {
  return import.meta.env.DEV ? parseSwitches(search) : defaults();
}

export function switchesFor(search: string, dev: boolean): RoomSwitches {
  return dev ? parseSwitches(search) : defaults();
}

function parseSwitches(search: string): RoomSwitches {
  const q = new URLSearchParams(search);
  return {
    lights: Math.round(num(q, 'lights', 0, WASH_MAX) ?? WASH_DEFAULT),
    pools: q.get('pools') !== '0',
    shade: q.get('shade') !== '0',
    textures: q.get('tex') !== '0',
    aniso: Math.round(num(q, 'aniso', 1, 16) ?? 8),
    dpr: num(q, 'dpr', 0.5, 2),
    aa: q.get('aa') !== '0',
    env: q.get('env') !== '0',
    glass: Math.round(num(q, 'glass', 0, 4) ?? GLASS_DEFAULT),
    glassTex: Math.round(num(q, 'glasstex', 256, 1024) ?? GLASS_TEX_DEFAULT),
    glassPs: Math.round(num(q, 'glassps', 0, 60) ?? GLASS_PS_DEFAULT),
    glassNearMs: Math.round(num(q, 'glassnear', 0, 1000) ?? GLASS_NEAR_MS_DEFAULT),
    glassPresent: q.get('glasspresent') !== '0',
    focusFreeze: q.get('freeze') !== '0',
    dim: q.get('dim') !== '0',
    glow: q.get('glow') === '1',
    lamp: q.get('lamp') !== '0',
  };
}

export function glassSaid(shown: string): string {
  return `glass shown ${shown}`;
}

export function switchesSaid(s: RoomSwitches): string {
  const on: string[] = [];
  if (s.lights !== WASH_DEFAULT) on.push(`lights=${s.lights}`);
  if (!s.pools) on.push('pools=0');
  if (!s.shade) on.push('shade=0');
  if (!s.textures) on.push('tex=0');
  if (s.aniso !== 8) on.push(`aniso=${s.aniso}`);
  if (s.dpr !== null) on.push(`dpr=${s.dpr}`);
  if (!s.aa) on.push('aa=0');
  if (!s.env) on.push('env=0');
  if (s.glass !== GLASS_DEFAULT) on.push(`glass=${s.glass}`);
  if (s.glassTex !== GLASS_TEX_DEFAULT) on.push(`glasstex=${s.glassTex}`);
  if (s.glassPs !== GLASS_PS_DEFAULT) on.push(`glassps=${s.glassPs}`);
  if (s.glassNearMs !== GLASS_NEAR_MS_DEFAULT) on.push(`glassnear=${s.glassNearMs}`);
  if (!s.glassPresent) on.push('glasspresent=0');
  if (!s.focusFreeze) on.push('freeze=0');
  if (!s.dim) on.push('dim=0');
  if (s.glow) on.push('glow=1');
  if (!s.lamp) on.push('lamp=0');
  return on.length ? on.join(' ') : 'defaults';
}
