
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
  tint: boolean;
  lamp: boolean;
  realism: boolean | null;
  rShadow: boolean;
  rEnv: boolean;
  rHalo: boolean;
  rGlow: boolean;
  rFloor: boolean;
  rGlass: boolean;
  winEnv: boolean;
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
  glassPresent: true, focusFreeze: true, dim: true, glow: false, tint: true, lamp: true,
  realism: null, rShadow: true, rEnv: true, rHalo: true, rGlow: true, rFloor: true, rGlass: true, winEnv: true,
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
    tint: q.get('tint') !== '0',
    lamp: q.get('lamp') !== '0',
    realism: q.get('realism') === '1' ? true : q.get('realism') === '0' ? false : null,
    rShadow: q.get('rshadow') !== '0',
    rEnv: q.get('renv') !== '0',
    rHalo: q.get('rhalo') !== '0',
    rGlow: q.get('rglow') !== '0',
    rFloor: q.get('rfloor') !== '0',
    rGlass: q.get('rglass') !== '0',
    winEnv: q.get('wenv') !== '0',
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
  if (!s.tint) on.push('tint=0');
  if (!s.lamp) on.push('lamp=0');
  if (s.realism !== null) on.push(`realism=${s.realism ? 1 : 0}`);
  if (!s.rShadow) on.push('rshadow=0');
  if (!s.rEnv) on.push('renv=0');
  if (!s.rHalo) on.push('rhalo=0');
  if (!s.rGlow) on.push('rglow=0');
  if (!s.rFloor) on.push('rfloor=0');
  if (!s.rGlass) on.push('rglass=0');
  if (!s.winEnv) on.push('wenv=0');
  return on.length ? on.join(' ') : 'defaults';
}
