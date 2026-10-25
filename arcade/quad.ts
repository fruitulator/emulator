
export interface Pt { x: number; y: number }
export type Quad = [Pt, Pt, Pt, Pt];
export type Homography = number[];

export interface Box { left: number; top: number; width: number; height: number }

export function quadOfRect(r: Box): Quad {
  const R = r.left + r.width;
  const B = r.top + r.height;
  return [{ x: r.left, y: r.top }, { x: R, y: r.top }, { x: R, y: B }, { x: r.left, y: B }];
}

export function boundsOf(q: Quad): Box {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const l = Math.min(...xs);
  const t = Math.min(...ys);
  return { left: l, top: t, width: Math.max(...xs) - l, height: Math.max(...ys) - t };
}

export function isRectQuad(q: Quad, eps = 1e-6): boolean {
  const [a, b, c, d] = q;
  return Math.abs(a.y - b.y) < eps && Math.abs(d.y - c.y) < eps && Math.abs(a.x - d.x) < eps && Math.abs(b.x - c.x) < eps;
}

export function squareUp(q: Quad): Quad {
  const [tl, tr, br, bl] = q;
  const left = (tl.x + bl.x) / 2;
  const right = (tr.x + br.x) / 2;
  const top = (tl.y + tr.y) / 2;
  const bottom = (bl.y + br.y) / 2;
  return quadOfRect({ left, top, width: right - left, height: bottom - top });
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

export function rectifiedSize(q: Quad): { width: number; height: number } {
  const [tl, tr, br, bl] = q;
  return {
    width: Math.max(dist(tl, tr), dist(bl, br)),
    height: Math.max(dist(tl, bl), dist(tr, br)),
  };
}

export function quadAspect(q: Quad): number {
  const s = rectifiedSize(q);
  return s.width / s.height;
}

export const MIN_EDGE = 8;
const MIN_SIN = 0.05;

export function isConvexQuad(q: Quad, minEdge = MIN_EDGE): boolean {
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const e1x = b.x - a.x;
    const e1y = b.y - a.y;
    const e2x = c.x - b.x;
    const e2y = c.y - b.y;
    const l1 = Math.hypot(e1x, e1y);
    const l2 = Math.hypot(e2x, e2y);
    if (!(l1 >= minEdge) || !(l2 >= minEdge)) return false;
    const cross = e1x * e2y - e1y * e2x;
    if (!(cross / (l1 * l2) >= MIN_SIN)) return false;
  }
  return true;
}

export function homography(src: Quad, dst: Quad): Homography | null {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot], a[col]];
    const div = a[col][col];
    for (let k = col; k < 9; k++) a[col][k] /= div;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const f = a[row][col];
      if (f === 0) continue;
      for (let k = col; k < 9; k++) a[row][k] -= f * a[col][k];
    }
  }
  const h = a.map((r) => r[8]);
  h.push(1);
  return h.every(Number.isFinite) ? h : null;
}

export function applyH(h: Homography, x: number, y: number): Pt | null {
  const d = h[6] * x + h[7] * y + h[8];
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  const px = (h[0] * x + h[1] * y + h[2]) / d;
  const py = (h[3] * x + h[4] * y + h[5]) / d;
  return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
}

export const UNIT: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

export function faceToQuad(q: Quad): Homography | null {
  return homography(UNIT, q);
}

export function quadToFace(q: Quad): Homography | null {
  const h = faceToQuad(q);
  return h ? invertH(h) : null;
}

export function invertH(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, i, k] = h;
  const adj = [
    e * k - f * i, c * i - b * k, b * f - c * e,
    f * g - d * k, a * k - c * g, c * d - a * f,
    d * i - e * g, b * g - a * i, a * e - b * d,
  ];
  const det = a * adj[0] + b * adj[3] + c * adj[6];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
  const m = Math.max(...adj.map(Math.abs));
  return adj.map((v) => v / m);
}

export function projectiveUvs(qTex: Quad): number[] | null {
  return projectiveUvsAt([0, 0, 1, 0, 0, 1, 1, 1], qTex);
}

export function projectiveUvsAt(frac: ArrayLike<number>, qTex: Quad): number[] | null {
  const h = faceToQuad(qTex);
  if (!h) return null;
  const out: number[] = [];
  for (let i = 0; i + 1 < frac.length; i += 2) {
    const fx = frac[i];
    const fy = frac[i + 1];
    const X = h[0] * fx + h[1] * fy + h[2];
    const Y = h[3] * fx + h[4] * fy + h[5];
    const W = h[6] * fx + h[7] * fy + h[8];
    out.push(X, W - Y, W);
  }
  return out;
}

export type QuadGrip = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const CORNER: Partial<Record<QuadGrip, number>> = { nw: 0, ne: 1, se: 2, sw: 3 };
const EDGE: Partial<Record<QuadGrip, { i: [number, number]; axis: 'x' | 'y' }>> = {
  n: { i: [0, 1], axis: 'y' }, s: { i: [3, 2], axis: 'y' }, w: { i: [0, 3], axis: 'x' }, e: { i: [1, 2], axis: 'x' },
};

const clampPt = (p: Pt, c: Box): Pt => ({
  x: Math.max(c.left, Math.min(c.left + c.width, p.x)),
  y: Math.max(c.top, Math.min(c.top + c.height, p.y)),
});

export function clampQuad(q: Quad, c: Box): Quad {
  return q.map((p) => clampPt(p, c)) as Quad;
}

function moved(start: Quad, grip: QuadGrip, dx: number, dy: number, c: Box): Quad {
  const q = start.map((p) => ({ ...p })) as Quad;
  const ci = CORNER[grip];
  if (ci !== undefined) {
    q[ci] = clampPt({ x: q[ci].x + dx, y: q[ci].y + dy }, c);
    return q;
  }
  const e = EDGE[grip]!;
  for (const i of e.i) {
    q[i] = clampPt(e.axis === 'x' ? { x: q[i].x + dx, y: q[i].y } : { x: q[i].x, y: q[i].y + dy }, c);
  }
  return q;
}

export function dragQuad(start: Quad, grip: QuadGrip, dx: number, dy: number, content: Box): Quad {
  if (grip === 'move') {
    const b = boundsOf(start);
    const mx = Math.max(content.left - b.left, Math.min(dx, content.left + content.width - (b.left + b.width)));
    const my = Math.max(content.top - b.top, Math.min(dy, content.top + content.height - (b.top + b.height)));
    return start.map((p) => ({ x: p.x + mx, y: p.y + my })) as Quad;
  }
  const full = moved(start, grip, dx, dy, content);
  if (isConvexQuad(full)) return full;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (isConvexQuad(moved(start, grip, dx * mid, dy * mid, content))) lo = mid; else hi = mid;
  }
  return moved(start, grip, dx * lo, dy * lo, content);
}

export function roundQuad(q: Quad): Quad {
  const r = q.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) as Quad;
  return isConvexQuad(r) || !isConvexQuad(q) ? r : q;
}

export function levelEdges(q: Quad, eps = 0.5): [boolean, boolean, boolean, boolean] {
  return [
    Math.abs(q[0].y - q[1].y) < eps,
    Math.abs(q[1].x - q[2].x) < eps,
    Math.abs(q[2].y - q[3].y) < eps,
    Math.abs(q[3].x - q[0].x) < eps,
  ];
}

export function sameQuad(a: Quad | undefined, b: Quad | undefined, eps = 0.5): boolean {
  return !!a && !!b && a.every((p, i) => Math.abs(p.x - b[i].x) < eps && Math.abs(p.y - b[i].y) < eps);
}

export function asQuad(v: unknown): Quad | undefined {
  if (!Array.isArray(v) || v.length !== 4) return undefined;
  const ok = v.every((p) => p && typeof p === 'object' && Number.isFinite((p as Pt).x) && Number.isFinite((p as Pt).y));
  return ok ? (v.map((p: Pt) => ({ x: p.x, y: p.y })) as Quad) : undefined;
}
