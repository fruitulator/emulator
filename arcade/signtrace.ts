import * as THREE from 'three';

export function traceShapes(alpha: Uint8ClampedArray | Uint8Array, w: number, h: number, k: number, tol = 0.7): THREE.Shape[] {
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && alpha[y * w + x] >= 128;
  const W = w + 1;
  const out = new Map<number, number[]>();
  const edge = (ax: number, ay: number, bx: number, by: number): void => {
    const a = ay * W + ax;
    const list = out.get(a);
    if (list) list.push(by * W + bx); else out.set(a, [by * W + bx]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) edge(x + 1, y, x, y);
      if (!on(x, y + 1)) edge(x, y + 1, x + 1, y + 1);
      if (!on(x - 1, y)) edge(x, y, x, y + 1);
      if (!on(x + 1, y)) edge(x + 1, y + 1, x + 1, y);
    }
  }
  const loops: THREE.Vector2[][] = [];
  for (const [start, nexts] of out) {
    while (nexts.length) {
      const loop: THREE.Vector2[] = [];
      let at = start;
      let next = nexts.pop()!;
      for (let guard = 0; guard < 1e6; guard++) {
        loop.push(new THREE.Vector2(at % W, Math.floor(at / W)));
        at = next;
        if (at === start) break;
        const l = out.get(at);
        if (!l?.length) break;
        next = l.pop()!;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  const polys = loops.map((l) => simplify(chaikin(l), tol).map((p) => new THREE.Vector2(p.x * k, (h - p.y) * k)))
    .filter((p) => p.length >= 3);
  if (!polys.length) return [];
  const area = polys.map((p) => THREE.ShapeUtils.area(p));
  const big = area.reduce((b, a, i) => (Math.abs(a) > Math.abs(area[b]) ? i : b), 0);
  const outerSign = Math.sign(area[big]);
  const outers = polys.map((p, i) => ({ p, i })).filter(({ i }) => Math.sign(area[i]) === outerSign);
  const shapes = new Map<number, THREE.Shape>(outers.map(({ p, i }) => [i, new THREE.Shape(p)]));
  polys.forEach((p, i) => {
    if (Math.sign(area[i]) === outerSign) return;
    let best = -1;
    for (const o of outers) {
      if (inside(p[0], o.p) && (best < 0 || Math.abs(area[o.i]) < Math.abs(area[best]))) best = o.i;
    }
    if (best >= 0) shapes.get(best)!.holes.push(new THREE.Path(p));
  });
  return [...shapes.values()];
}

function chaikin(l: THREE.Vector2[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < l.length; i++) {
    const a = l[i];
    const b = l[(i + 1) % l.length];
    out.push(new THREE.Vector2(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25));
    out.push(new THREE.Vector2(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75));
  }
  return out;
}

function simplify(l: THREE.Vector2[], tol: number): THREE.Vector2[] {
  if (l.length < 8) return l;
  let far = 0;
  for (let i = 1; i < l.length; i++) if (l[i].distanceToSquared(l[0]) > l[far].distanceToSquared(l[0])) far = i;
  const run = (pts: THREE.Vector2[]): THREE.Vector2[] => {
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      let worst = -1;
      let dmax = tol;
      for (let i = a + 1; i < b; i++) {
        const d = segDist(pts[i], pts[a], pts[b]);
        if (d > dmax) { dmax = d; worst = i; }
      }
      if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  const a = run(l.slice(0, far + 1));
  const b = run([...l.slice(far), l[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function segDist(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function inside(p: THREE.Vector2, poly: THREE.Vector2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
