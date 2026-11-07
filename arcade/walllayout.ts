import { BEAM_D, BEAM_W, beamLayout, cofferLayout, DARK_PANEL_M, PLATE_M, TILE_M, tileGrid, type CeilingRoom } from './ceilinggrid';
import { WALL_FIXTURES, type Ceiling, type WallFixture } from './roomlook';

export interface WallRun {
  x: number; z: number; rotY: number; len: number;
  keepOut: { u0: number; u1: number; only?: WallFixture }[];
}

export interface WallLight { wall: number; u: number; off: number; y: number }

export const WALL_LIGHT_EVERY_M = 3.2;
export const TRACK_OFF_M = 0.4;
export const TRACK_DROP_M = 0.12;
export const SPOT_DROP_M = 0.07;
export const SCONCE_Y = 2.2;

export const SCONCE_OUT_M = 0.165;
export const SHADE_H_M = 0.16;
export const SHADE_R_TOP_M = 0.068;
export const SHADE_R_BOT_M = 0.084;
export const BULB_DY_M = -0.012;
export const BULB_R_M = 0.026;
export const PLATE_R_M = 0.05;
export const PLATE_DY_M = -0.175;

export function wallFixture(ceiling: Ceiling, on: boolean): WallFixture | null {
  return on ? WALL_FIXTURES[ceiling].fixture : null;
}

function spread(cands: number[], len: number): number[] {
  if (!cands.length) return [];
  const want = len / WALL_LIGHT_EVERY_M;
  let m = Math.min(cands.length, Math.max(1, Math.round(want)));
  if (m >= 2 && (cands.length - m) % 2 !== 0) m = m + 1 <= cands.length && m + 1 - want < want - (m - 1) ? m + 1 : m - 1;
  const out: number[] = [];
  for (let k = 0; k < m; k++) {
    const t = ((k + 0.5) * cands.length) / m - 0.5;
    const lo = Math.floor(t + 1e-9), hi = Math.ceil(t - 1e-9);
    const i = lo === hi || Math.abs(t - lo - 0.5) > 1e-9 ? Math.round(t) : Math.abs(cands[lo]) <= Math.abs(cands[hi]) ? lo : hi;
    if (out[out.length - 1] !== cands[i]) out.push(cands[i]);
  }
  return out;
}

export function placeWallLights(fixture: WallFixture | null, r: CeilingRoom, top: number, walls: WallRun[]): WallLight[] {
  if (!fixture) return [];
  const minX = r.cx - r.W / 2, maxX = r.cx + r.W / 2, minZ = r.cz - r.D / 2, maxZ = r.cz + r.D / 2;
  const alongX = (i: number): boolean => i < 2;
  const toU = (i: number, a: number): number => [a - r.cx, r.cx - a, r.cz - a, a - r.cz][i];
  const range = (i: number, pad: number): [number, number] => (alongX(i) ? [minX + pad, maxX - pad] : [minZ + pad, maxZ - pad]);
  const inRange = (i: number, pad: number) => (a: number): boolean => { const [lo, hi] = range(i, pad); return a >= lo - 1e-9 && a <= hi + 1e-9; };

  const out: WallLight[] = [];
  const hang = (i: number, cands: number[] | null, pitch: number, off: number, y: number): void => {
    const w = walls[i];
    const keep = w.keepOut.filter((k) => !k.only || k.only === fixture);
    const [lo, hi] = range(i, 0).map((a) => toU(i, a)).sort((p, q) => p - q);
    const cuts = keep.map((k) => [Math.max(lo, k.u0), Math.min(hi, k.u1)] as const).filter(([a, z]) => z > a).sort((p, q) => p[0] - q[0]);
    const runs: [number, number][] = [];
    let from = lo;
    for (const [a, z] of cuts) { if (a > from) runs.push([from, a]); from = Math.max(from, z); }
    if (hi > from) runs.push([from, hi]);
    const us = cands?.map((a) => toU(i, a)).sort((p, q) => p - q) ?? null;
    for (const [a, z] of runs) {
      if (us) {
        const inRun = us.filter((u) => u >= a - 1e-9 && u <= z + 1e-9);
        for (const u of spread(inRun, inRun.length * pitch)) out.push({ wall: i, u, off, y });
      } else {
        const n = Math.max(1, Math.round((z - a) / WALL_LIGHT_EVERY_M));
        for (let k = 0; k < n; k++) out.push({ wall: i, u: a + ((z - a) * (k + 0.5)) / n, off, y });
      }
    }
  };
  for (let i = 0; i < 4; i++) {
    const len = walls[i].len;
    if (fixture === 'cans') {
      const g = tileGrid(r);
      const n = alongX(i) ? g.nx : g.nz;
      const a0 = alongX(i) ? g.x0 : g.z0;
      const cut = alongX(i) ? g.z0 - minZ : g.x0 - minX;
      const cands = Array.from({ length: Math.max(0, n - 2) }, (_, k) => a0 + (k + 1.5) * TILE_M);
      hang(i, cands, TILE_M, cut + TILE_M / 2, top);
    } else if (fixture === 'spots') {
      const b = beamLayout(r);
      const plateWall = b.acrossX ? !alongX(i) : alongX(i);
      if (plateWall) {
        const bays = b.at.slice(1).map((a, k) => (a + b.at[k]) / 2);
        hang(i, bays, b.at.length > 1 ? b.at[1] - b.at[0] : len, PLATE_M / 2, top - PLATE_M - SPOT_DROP_M);
      } else {
        const first = i === 0 || i === 2;
        const edge = first ? b.at[0] - BEAM_W / 2 - (alongX(i) ? minZ : minX) : (alongX(i) ? maxZ : maxX) - b.at[b.at.length - 1] - BEAM_W / 2;
        hang(i, null, 0, Math.max(PLATE_M / 2, edge + 0.04), top - BEAM_D - SPOT_DROP_M);
      }
    } else if (fixture === 'track') {
      const c = alongX(i) ? r.cx : r.cz;
      const cands: number[] = [];
      for (let k = -Math.ceil(len / DARK_PANEL_M); k <= Math.ceil(len / DARK_PANEL_M); k++) cands.push(c + (k + 0.5) * DARK_PANEL_M);
      hang(i, cands.filter(inRange(i, TRACK_OFF_M + 0.2)), DARK_PANEL_M, TRACK_OFF_M, top - TRACK_DROP_M);
    } else {
      const g = cofferLayout(r);
      const n = alongX(i) ? g.nx : g.nz;
      const p = alongX(i) ? g.px : g.pz;
      const a0 = alongX(i) ? g.ix0 : g.iz0;
      hang(i, Array.from({ length: n }, (_, k) => a0 + (k + 0.5) * p), p, 0, SCONCE_Y);
    }
  }
  return out;
}

export interface Lobe {
  up: boolean; apexY: number; spread: number; fall: number; k: number;
  d?: number; edge?: number;
  ramp?: number;
}

const D_V = 0.2;
const EDGE_RAD = 0.035;
const TAIL = 0.08;
const FADE_POW = 1.8;
const FADE_END = 1 / (1 - TAIL ** (1 / FADE_POW));

export function lobesOf(kind: WallFixture, l: WallLight, top: number): Lobe[] {
  switch (kind) {
    case 'cans': return [{ up: false, apexY: top - 0.22, spread: 0.95, fall: 1.6, k: 1 }];
    case 'track': return [{ up: false, apexY: top - 0.2, spread: 1.05, fall: 1.5, k: 1 }];
    case 'spots': return [{ up: false, apexY: Math.max(top - 0.3, Math.min(top - 0.15, l.y - 0.06)), spread: 1.15, fall: 1.4, k: 1 }];
    case 'sconces': {
      const bulb = l.y + BULB_DY_M;
      const up = (l.y + SHADE_H_M / 2 - bulb) / SHADE_R_TOP_M;
      const down = (bulb - (l.y - SHADE_H_M / 2)) / SHADE_R_BOT_M;
      const upApex = bulb + SCONCE_OUT_M * up, downApex = bulb - SCONCE_OUT_M * down;
      return [
        { up: true, apexY: upApex, spread: up, fall: Math.max(0.3, top - upApex), k: 0.5, d: SCONCE_OUT_M, edge: SCONCE_EDGE_RAD, ramp: SCONCE_RAMP_M },
        { up: false, apexY: downApex, spread: down, fall: 0.95, k: 0.42, d: SCONCE_OUT_M, edge: SCONCE_EDGE_RAD, ramp: SCONCE_RAMP_M },
      ];
    }
  }
}

const SCONCE_EDGE_RAD = 0.26;
const SCONCE_RAMP_M = 0.22;
const SCONCE_SIDE_M = 0.42;

export const SCONCE_SPILL = 0.95;
const SPILL_R_M = 0.25;
export function sconceSpillAt(dx: number, dy: number): number {
  const q = (dx * dx + dy * dy * (dy > 0 ? 0.5 : 0.75)) / (SPILL_R_M * SPILL_R_M);
  return SCONCE_SPILL / (1 + q) ** 1.5;
}

const knee = (v: number): number => (v <= 0.75 ? v : 0.75 + 0.25 * (1 - Math.exp(-(v - 0.75) / 0.25)));

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function rawLobe(b: Lobe, dx: number, y: number): number {
  const d = b.d ?? D_V;
  const soft = b.edge ?? EDGE_RAD;
  const lamp = b.up ? b.apexY - d * b.spread : b.apexY + d * b.spread;
  const dy = b.up ? y - lamp : lamp - y;
  if (dy <= 0) return 0;
  const rh = Math.hypot(dx, d);
  const th = Math.atan(1 / b.spread);
  const phi = Math.atan2(rh, dy);
  const half = b.edge ? soft / 2 : 0;
  if (phi >= th + half) return 0;
  const edge = smooth((th + half - phi) / soft);
  const core = 0.35 + 0.65 * (1 - (phi / th) ** 2);
  const past = b.up ? y - b.apexY : b.apexY - y;
  const s = past / (b.fall * FADE_END);
  const ramp = b.ramp ? 0.65 + 0.35 * smooth(past / b.ramp) : 1;
  const side = b.ramp ? 1 / (1 + (dx / SCONCE_SIDE_M) ** 2) : 1;
  return s >= 1 ? 0 : edge * core * ramp * side * (1 - Math.max(0, s)) ** FADE_POW;
}

const peaks = new Map<string, number>();
function peakOf(b: Lobe): number {
  const key = `${b.spread}|${b.fall}|${b.d}|${b.edge}|${b.ramp}`;
  let p = peaks.get(key);
  if (p === undefined) {
    p = 0;
    for (let s = 0; s <= b.fall; s += 0.005) p = Math.max(p, rawLobe({ ...b, up: false }, 0, b.apexY - s));
    peaks.set(key, p);
  }
  return p;
}

export function lobeAt(b: Lobe, dx: number, y: number): number {
  const v = rawLobe(b, dx, y);
  return v > 0 ? (v / peakOf(b)) * b.k : 0;
}

export const PANEL_WASH_TOP = 0.5;
export const PANEL_WASH_M = 1.7;
export function panelWashAt(top: number, y: number): number {
  const t = (top - y) / PANEL_WASH_M;
  return t >= 1 ? 0 : PANEL_WASH_TOP * (1 - t) ** 2;
}

export function paintWall(
  len: number, top: number, pxM: number, kind: WallFixture | null, lights: WallLight[], panelWash: boolean,
  strength = 1,
): { w: number; h: number; level: Float32Array } {
  const w = Math.max(16, Math.round(len * pxM));
  const h = Math.round(top * pxM);
  const level = new Float32Array(w * h);
  if (panelWash) {
    for (let y = 0; y < h; y++) {
      const v = panelWashAt(top, top - (y + 0.5) / pxM);
      if (v > 0) level.fill(v, y * w, (y + 1) * w);
    }
  }
  if (kind) {
    for (const l of lights) {
      const cx = (l.u + len / 2) * pxM;
      if (kind === 'sconces') {
        const bulb = l.y + BULB_DY_M;
        const r = 1.1;
        const x0 = Math.max(0, Math.floor(cx - r * pxM)), x1 = Math.min(w - 1, Math.ceil(cx + r * pxM));
        const r0 = Math.max(0, Math.floor((top - bulb - r) * pxM)), r1 = Math.min(h - 1, Math.ceil((top - bulb + r) * pxM));
        for (let y = r0; y <= r1; y++) {
          const dy = top - (y + 0.5) / pxM - bulb;
          for (let x = x0; x <= x1; x++) level[y * w + x] += sconceSpillAt((x + 0.5) / pxM - l.u - len / 2, dy) * strength;
        }
      }
      for (const b of lobesOf(kind, l, top)) {
        const reach = (b.fall + (b.d ?? D_V) * b.spread) / b.spread + 0.3;
        const x0 = Math.max(0, Math.floor(cx - reach * pxM)), x1 = Math.min(w - 1, Math.ceil(cx + reach * pxM));
        const yTop = b.up ? Math.min(top, b.apexY + b.fall + 0.05) : b.apexY + 0.05;
        const yBot = b.up ? b.apexY - 0.05 : Math.max(0, b.apexY - b.fall * 1.25);
        const r0 = Math.max(0, Math.floor((top - yTop) * pxM)), r1 = Math.min(h - 1, Math.ceil((top - yBot) * pxM));
        for (let y = r0; y <= r1; y++) {
          const wy = top - (y + 0.5) / pxM;
          for (let x = x0; x <= x1; x++) {
            const v = lobeAt(b, (x + 0.5) / pxM - l.u - len / 2, wy);
            if (v > 0) level[y * w + x] += v * strength;
          }
        }
      }
    }
  }
  if (kind === 'sconces') for (let i = 0; i < level.length; i++) level[i] = knee(level[i]);
  for (let i = 0; i < level.length; i++) if (level[i] > 1) level[i] = 1;
  return { w, h, level };
}
