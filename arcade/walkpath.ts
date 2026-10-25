
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Pt { x: number; z: number }

export class WalkGrid {
  private readonly nx: number;
  private readonly nz: number;
  private readonly open: Uint8Array;

  constructor(
    private readonly box: Rect,
    private readonly blocks: Rect[],
    private readonly body: number,
    private readonly cell = 0.2,
  ) {
    this.nx = Math.max(1, Math.floor((box.maxX - box.minX) / cell));
    this.nz = Math.max(1, Math.floor((box.maxZ - box.minZ) / cell));
    this.open = new Uint8Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const c = this.centre(i, j);
        this.open[j * this.nx + i] = this.free(c.x, c.z) ? 1 : 0;
      }
    }
  }

  free(x: number, z: number): boolean {
    const b = this.box;
    const r = this.body;
    if (x < b.minX + r || x > b.maxX - r || z < b.minZ + r || z > b.maxZ - r) return false;
    for (const k of this.blocks) {
      if (x > k.minX - r && x < k.maxX + r && z > k.minZ - r && z < k.maxZ + r) return false;
    }
    return true;
  }

  clear(a: Pt, b: Pt): boolean {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (this.cell / 3));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (!this.free(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  route(from: Pt, to: Pt): Pt[] | null {
    const goalPt = this.free(to.x, to.z) ? to : null;
    const s = this.nearestOpen(from);
    const g = this.nearestOpen(to);
    if (s < 0 || g < 0) return null;
    const cells = this.search(s, g);
    if (!cells) return null;
    const pts = cells.map((c) => this.centre(c % this.nx, Math.floor(c / this.nx)));
    const end = goalPt ?? pts[pts.length - 1];
    pts[pts.length - 1] = end;
    const out: Pt[] = [];
    let at: Pt = this.free(from.x, from.z) ? from : pts[0];
    if (at !== from) out.push(at);
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.clear(at, pts[j])) j--;
      at = pts[j];
      out.push(at);
      i = j + 1;
    }
    if (out.length && Math.hypot(out[out.length - 1].x - from.x, out[out.length - 1].z - from.z) < 1e-6) return [];
    return out;
  }

  replan(from: Pt, rest: readonly Pt[]): Pt[] {
    if (!rest.length) return [];
    let at = from;
    let clear = true;
    for (const p of rest) {
      if (!this.clear(at, p)) { clear = false; break; }
      at = p;
    }
    if (clear) return rest.slice();
    const end = rest[rest.length - 1];
    if (!this.free(end.x, end.z)) return [];
    return this.route(from, end) ?? [];
  }

  nearestFree(p: Pt): Pt {
    if (this.free(p.x, p.z)) return { x: p.x, z: p.z };
    const c = this.nearestOpen(p);
    return c < 0 ? { x: p.x, z: p.z } : this.centre(c % this.nx, Math.floor(c / this.nx));
  }

  private centre(i: number, j: number): Pt {
    return { x: this.box.minX + (i + 0.5) * this.cell, z: this.box.minZ + (j + 0.5) * this.cell };
  }

  private nearestOpen(p: Pt): number {
    const i0 = Math.min(this.nx - 1, Math.max(0, Math.floor((p.x - this.box.minX) / this.cell)));
    const j0 = Math.min(this.nz - 1, Math.max(0, Math.floor((p.z - this.box.minZ) / this.cell)));
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r < Math.max(this.nx, this.nz); r++) {
      for (let j = j0 - r; j <= j0 + r; j++) {
        for (let i = i0 - r; i <= i0 + r; i++) {
          if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.nz || !this.open[j * this.nx + i]) continue;
          const c = this.centre(i, j);
          const d = Math.hypot(c.x - p.x, c.z - p.z);
          if (d < bestD) { bestD = d; best = j * this.nx + i; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  private search(s: number, g: number): number[] | null {
    const n = this.nx * this.nz;
    const cost = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const gi = g % this.nx;
    const gj = Math.floor(g / this.nx);
    const h = (c: number): number => {
      const dx = Math.abs((c % this.nx) - gi);
      const dz = Math.abs(Math.floor(c / this.nx) - gj);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    const heap: [number, number][] = [];
    const push = (f: number, c: number): void => {
      heap.push([f, c]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = (): number => {
      const top = heap[0][1];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    cost[s] = 0;
    push(h(s), s);
    while (heap.length) {
      const c = pop();
      if (done[c]) continue;
      done[c] = 1;
      if (c === g) break;
      const ci = c % this.nx;
      const cj = Math.floor(c / this.nx);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
          const k = j * this.nx + i;
          if (!this.open[k] || done[k]) continue;
          if (di && dj && (!this.open[cj * this.nx + i] || !this.open[j * this.nx + ci])) continue;
          const w = cost[c] + (di && dj ? Math.SQRT2 : 1);
          if (w < cost[k]) {
            cost[k] = w;
            prev[k] = c;
            push(w + h(k), k);
          }
        }
      }
    }
    if (!done[g]) return null;
    const out: number[] = [];
    for (let c = g; c !== -1; c = prev[c]) out.push(c);
    return out.reverse();
  }
}
