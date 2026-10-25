
export interface CabinetQuad { centre: [number, number, number]; w: number; h: number; leanDeg: number }

export type FrontZ = (x: number, y: number) => number | null;

const STEP = 0.005;
const DEPTH = 0.45;

export function findDeck(glass: CabinetQuad, frontZ: FrontZ): CabinetQuad | null {
  const lean = (glass.leanDeg * Math.PI) / 180;
  const footY = glass.centre[1] - (Math.cos(lean) * glass.h) / 2;
  const prof: { y: number; z: number }[] = [];
  for (let y = footY + 0.02; y >= footY - DEPTH; y -= STEP) {
    const zs: number[] = [];
    for (const fx of [-0.25, -0.12, 0, 0.12, 0.25]) {
      const z = frontZ(fx * glass.w * 2, y);
      if (z !== null) zs.push(z);
    }
    if (zs.length >= 3) {
      zs.sort((p, q) => p - q);
      prof.push({ y: +y.toFixed(4), z: +zs[zs.length >> 1].toFixed(4) });
    }
  }
  const i0 = prof.findIndex((p) => p.y <= footY + 0.005);
  if (i0 < 0) return null;
  let best = i0;
  for (let j = i0 + 1; j < prof.length; j++) {
    if (prof[j].z - prof[j - 1].z < -0.008) break;
    if (prof[j].z > prof[best].z + 1e-4) best = j;
    else if (prof[best].y - prof[j].y > 0.03) break;
  }
  const run = prof.slice(i0, best + 1).filter((p) => prof[i0].y - p.y >= 0.015);
  if (run.length < 5) return null;
  const n = run.length;
  const my = run.reduce((t, p) => t + p.y, 0) / n;
  const mz = run.reduce((t, p) => t + p.z, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of run) { sxy += (p.y - my) * (p.z - mz); sxx += (p.y - my) ** 2; }
  const b = sxy / sxx;
  const yTop = prof[i0].y;
  const yBot = prof[best].y;
  const zTop = mz + b * (yTop - my);
  const zBot = mz + b * (yBot - my);
  const dy = yTop - yBot;
  const dz = zBot - zTop;
  const h = Math.hypot(dy, dz);
  const leanDeg = (Math.atan2(dz, dy) * 180) / Math.PI;
  if (!(h > 0.05 && leanDeg > 20)) return null;
  return {
    centre: [0, +((yTop + yBot) / 2).toFixed(4), +((zTop + zBot) / 2).toFixed(4)],
    w: glass.w, h: +h.toFixed(3), leanDeg: +leanDeg.toFixed(1),
  };
}

export function quadAspect(q: CabinetQuad): number {
  return q.w / q.h;
}

const FRONT_Z = 0.15;
const LEAN_TOL = 3;
const PLANE_TOL = 0.006;
const MIN_SHARE = 0.08;

export interface PlanarFace extends CabinetQuad { area: number }

export function planarFaces(tris: ArrayLike<number>): PlanarFace[] {
  interface T { lean: number; d: number; area: number; p: number[] }
  const ts: T[] = [];
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const ux = tris[i + 3] - ax, uy = tris[i + 4] - ay, uz = tris[i + 5] - az;
    const vx = tris[i + 6] - ax, vy = tris[i + 7] - ay, vz = tris[i + 8] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 0)) continue;
    nx /= len; ny /= len; nz /= len;
    if (nz < FRONT_Z || Math.abs(nx) > 0.35) continue;
    const lean = (Math.atan2(ny, nz) * 180) / Math.PI;
    const l = (lean * Math.PI) / 180;
    const d = ay * Math.sin(l) + az * Math.cos(l);
    ts.push({ lean, d, area: len / 2, p: Array.from({ length: 9 }, (_, k) => tris[i + k]) });
  }
  if (!ts.length) return [];
  ts.sort((a, b) => a.lean - b.lean);
  const byLean: T[][] = [];
  for (const t of ts) {
    const g = byLean[byLean.length - 1];
    if (g && t.lean - g[g.length - 1].lean <= LEAN_TOL) g.push(t); else byLean.push([t]);
  }
  const groups: T[][] = [];
  for (const g of byLean) {
    g.sort((a, b) => a.d - b.d);
    let cur: T[] = [];
    for (const t of g) {
      if (cur.length && t.d - cur[cur.length - 1].d > PLANE_TOL) { groups.push(cur); cur = []; }
      cur.push(t);
    }
    if (cur.length) groups.push(cur);
  }
  const areaOf = (g: T[]): number => g.reduce((s, t) => s + t.area, 0);
  const biggest = Math.max(...groups.map(areaOf));
  const faces: PlanarFace[] = [];
  for (const g of groups) {
    const area = areaOf(g);
    if (area < biggest * MIN_SHARE) continue;
    const leanDeg = g.reduce((s, t) => s + t.lean * t.area, 0) / area;
    const l = (leanDeg * Math.PI) / 180;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity, n = -Infinity;
    for (const tr of g) {
      for (let k = 0; k < 9; k += 3) {
        const x = tr.p[k], y = tr.p[k + 1], z = tr.p[k + 2];
        const t = y * Math.cos(l) - z * Math.sin(l);
        s0 = Math.min(s0, x); s1 = Math.max(s1, x);
        t0 = Math.min(t0, t); t1 = Math.max(t1, t);
        n = Math.max(n, y * Math.sin(l) + z * Math.cos(l));
      }
    }
    const sc = (s0 + s1) / 2;
    const tc = (t0 + t1) / 2;
    faces.push({
      centre: [+sc.toFixed(4), +(tc * Math.cos(l) + n * Math.sin(l)).toFixed(4), +(-tc * Math.sin(l) + n * Math.cos(l)).toFixed(4)],
      w: +(s1 - s0).toFixed(4), h: +(t1 - t0).toFixed(4), leanDeg: +leanDeg.toFixed(1), area: +area.toFixed(4),
    });
  }
  return faces.sort((a, b) => b.centre[1] - a.centre[1]);
}

export type FacePick = 'top' | 'bottom' | 'largest';
export function pickFace(faces: PlanarFace[], pick: FacePick = 'largest'): PlanarFace | null {
  if (!faces.length) return null;
  if (pick === 'top') return faces[0];
  if (pick === 'bottom') return faces[faces.length - 1];
  return faces.reduce((a, b) => (b.area > a.area ? b : a));
}

export function insetQuad(q: CabinetQuad, inset: [number, number]): CabinetQuad {
  return { ...q, w: +(q.w * (1 - 2 * inset[0])).toFixed(4), h: +(q.h * (1 - 2 * inset[1])).toFixed(4) };
}

const rad = (d: number): number => (d * Math.PI) / 180;
function ends(q: CabinetQuad): { top: [number, number]; bottom: [number, number] } {
  const l = rad(q.leanDeg);
  const uy = Math.cos(l) * q.h / 2;
  const uz = -Math.sin(l) * q.h / 2;
  return { top: [q.centre[1] + uy, q.centre[2] + uz], bottom: [q.centre[1] - uy, q.centre[2] - uz] };
}

const JOIN_GAP = 0.03;
export function joinSection(lower: CabinetQuad, buttons: CabinetQuad): CabinetQuad | null {
  if (Math.abs(lower.leanDeg - buttons.leanDeg) > LEAN_TOL) return null;
  const a = ends(lower);
  const b = ends(buttons);
  if (Math.hypot(a.bottom[0] - b.top[0], a.bottom[1] - b.top[1]) > JOIN_GAP) return null;
  const l = rad(lower.leanDeg);
  const T = (p: [number, number]): number => p[0] * Math.cos(l) - p[1] * Math.sin(l);
  const N = (p: [number, number]): number => p[0] * Math.sin(l) + p[1] * Math.cos(l);
  const pts = [a.top, a.bottom, b.top, b.bottom];
  const t0 = Math.min(...pts.map(T));
  const t1 = Math.max(...pts.map(T));
  const n = Math.max(...pts.map(N));
  const tc = (t0 + t1) / 2;
  return {
    centre: [lower.centre[0], +(tc * Math.cos(l) + n * Math.sin(l)).toFixed(4), +(-tc * Math.sin(l) + n * Math.cos(l)).toFixed(4)],
    w: Math.max(lower.w, buttons.w), h: +(t1 - t0).toFixed(4), leanDeg: lower.leanDeg,
  };
}

export function splitFoot(q: CabinetQuad, share: number): { above: CabinetQuad; strip: CabinetQuad } {
  const l = rad(q.leanDeg);
  const up = [Math.cos(l), -Math.sin(l)];
  const hs = q.h * share;
  const ha = q.h - hs;
  const at = (off: number): [number, number, number] =>
    [q.centre[0], +(q.centre[1] + up[0] * off).toFixed(4), +(q.centre[2] + up[1] * off).toFixed(4)];
  return {
    above: { centre: at(q.h / 2 - ha / 2), w: q.w, h: +ha.toFixed(4), leanDeg: q.leanDeg },
    strip: { centre: at(-q.h / 2 + hs / 2), w: q.w, h: +hs.toFixed(4), leanDeg: q.leanDeg },
  };
}

export interface ShapedSurface {
  quad: CabinetQuad;
  tris: number[];
  frac: number[];
}

export function shapedSurface(tris: ArrayLike<number>): ShapedSurface | null {
  const kept: number[] = [];
  let sy = 0;
  let sz = 0;
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const ux = tris[i + 3] - ax, uy = tris[i + 4] - ay, uz = tris[i + 5] - az;
    const vx = tris[i + 6] - ax, vy = tris[i + 7] - ay, vz = tris[i + 8] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 0) || nz / len < FRONT_Z) continue;
    sy += ny;
    sz += nz;
    for (let k = 0; k < 9; k++) kept.push(tris[i + k]);
  }
  if (!kept.length) return null;
  const l = Math.atan2(sy, sz);
  const c = Math.cos(l);
  const s = Math.sin(l);
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity, n = -Infinity;
  const st: number[] = [];
  for (let k = 0; k < kept.length; k += 3) {
    const x = kept[k], y = kept[k + 1], z = kept[k + 2];
    const t = y * c - z * s;
    st.push(x, t);
    s0 = Math.min(s0, x); s1 = Math.max(s1, x);
    t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    n = Math.max(n, y * s + z * c);
  }
  const w = s1 - s0;
  const h = t1 - t0;
  if (!(w > 0 && h > 0)) return null;
  const frac: number[] = [];
  for (let k = 0; k < st.length; k += 2) frac.push((st[k] - s0) / w, (t1 - st[k + 1]) / h);
  const sc = (s0 + s1) / 2;
  const tc = (t0 + t1) / 2;
  return {
    quad: {
      centre: [+sc.toFixed(4), +(tc * c + n * s).toFixed(4), +(-tc * s + n * c).toFixed(4)],
      w: +w.toFixed(4), h: +h.toFixed(4), leanDeg: +((l * 180) / Math.PI).toFixed(1),
    },
    tris: kept,
    frac,
  };
}

export function flipTris(tris: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 8 < tris.length; i += 9) {
    for (const k of [0, 6, 3]) out.push(tris[i + k], tris[i + k + 1], tris[i + k + 2]);
  }
  return out;
}
