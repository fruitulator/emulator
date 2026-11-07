
export interface RevealSpec {
  winW: number;
  sillY: number;
  headY: number;
  depth: number;
  split: number;
  bead: number;
  wallW: number;
  wallH: number;
  wallY0: number;
  segs?: number;
}

export interface RevealData {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
  groups: { interior: [number, number]; head: [number, number]; exterior: [number, number] };
}

export function wallHole(s: RevealSpec): { x: number; w: number; y0: number; y1: number } {
  return { x: 0, w: s.winW + 2 * s.bead, y0: s.sillY, y1: s.headY + s.bead };
}

export function revealGeometry(s: RevealSpec): RevealData {
  const segs = s.segs ?? 4;
  const r = s.bead;
  const half = s.winW / 2;
  const u = (x: number): number => x / s.wallW + 0.5;
  const v = (y: number): number => (y - s.wallY0) / s.wallH;
  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], idx: number[] = [];
  const grid = (ni: number, nj: number, at: (i: number, j: number) => number[]): void => {
    const base = pos.length / 3;
    for (let j = 0; j <= nj; j++) {
      for (let i = 0; i <= ni; i++) {
        const p = at(i, j);
        pos.push(p[0], p[1], p[2]);
        nrm.push(p[3], p[4], p[5]);
        uvs.push(p[6], p[7]);
      }
    }
    const P = (k: number): number[] => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) {
        const a = base + j * (ni + 1) + i, b = a + 1, d = a + ni + 1, c = d + 1;
        const pa = P(a), pb = P(b), pd = P(d);
        const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pd[0] - pa[0], pd[1] - pa[1], pd[2] - pa[2]];
        const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const n = [nrm[a * 3], nrm[a * 3 + 1], nrm[a * 3 + 2]];
        if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] >= 0) idx.push(a, b, d, b, c, d);
        else idx.push(a, d, b, b, d, c);
      }
    }
  };
  const quarter = Math.PI / 2;
  const arc = quarter * r;
  const sFlat = (z: number): number => arc + (-z - r);

  for (const side of [-1, 1]) {
    const edge = side * (half + r);
    const u0 = u(edge);
    const du = -side / s.wallW;
    grid(segs, 1, (i, j) => {
      const phi = (i / segs) * quarter;
      const y = j ? s.headY + r - r * Math.sin(phi) : s.sillY;
      const x = edge - side * r * Math.sin(phi);
      const z = -r + r * Math.cos(phi);
      return [x, y, z, -side * Math.sin(phi), 0, Math.cos(phi), u0 + du * r * phi, v(y)];
    });
    grid(1, 1, (i, j) => {
      const z = i ? -s.split : -r;
      const y = j ? s.headY : s.sillY;
      return [side * half, y, z, -side, 0, 0, u0 + du * sFlat(z), v(y)];
    });
  }
  const v0 = v(s.headY + r);
  const dv = -1 / s.wallH;
  grid(segs, 1, (i, j) => {
    const phi = (i / segs) * quarter;
    const reach = half + r - r * Math.sin(phi);
    const x = j ? reach : -reach;
    return [x, s.headY + r - r * Math.sin(phi), -r + r * Math.cos(phi), 0, -Math.sin(phi), Math.cos(phi), u(x), v0 + dv * r * phi];
  });
  const headAt = idx.length;
  grid(1, 1, (i, j) => {
    const x = i ? half : -half;
    const z = j ? -s.split : -r;
    return [x, s.headY, z, 0, -1, 0, u(x), v0 + dv * sFlat(z)];
  });
  const outAt = idx.length;
  for (const side of [-1, 1]) {
    grid(1, 1, (i, j) => {
      const z = i ? -s.depth : -s.split;
      const y = j ? s.headY : s.sillY;
      return [side * half, y, z, -side, 0, 0, -z, y];
    });
  }
  grid(1, 1, (i, j) => {
    const x = i ? half : -half;
    const z = j ? -s.depth : -s.split;
    return [x, s.headY, z, 0, -1, 0, x, -z];
  });
  grid(1, 1, (i, j) => {
    const x = i ? half : -half;
    const z = j ? -s.depth : -s.split;
    return [x, s.sillY, z, 0, 1, 0, x, -z];
  });
  const end = idx.length;
  return {
    position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uvs), index: new Uint32Array(idx),
    groups: { interior: [0, headAt], head: [headAt, outAt - headAt], exterior: [outAt, end - outAt] },
  };
}

export interface Member { x: number; y: number; w: number; h: number }
export function glazing(o: { w: number; y0: number; h: number; frame: number; bar: number; transomAt: number }): {
  members: Member[]; clear: { x0: number; x1: number; y0: number; y1: number }; panes: { x0: number; x1: number; y0: number; y1: number }[];
} {
  const clear = { x0: -o.w / 2 + o.frame, x1: o.w / 2 - o.frame, y0: o.y0 + o.frame, y1: o.y0 + o.h - o.frame };
  const mx = (clear.x0 + clear.x1) / 2;
  const ty = clear.y0 + (clear.y1 - clear.y0) * o.transomAt;
  const members: Member[] = [
    { x: 0, y: o.y0 + o.h - o.frame / 2, w: o.w, h: o.frame },
    { x: 0, y: o.y0 + o.frame / 2, w: o.w, h: o.frame },
    { x: -o.w / 2 + o.frame / 2, y: o.y0 + o.h / 2, w: o.frame, h: o.h - 2 * o.frame },
    { x: o.w / 2 - o.frame / 2, y: o.y0 + o.h / 2, w: o.frame, h: o.h - 2 * o.frame },
    { x: mx, y: (clear.y0 + clear.y1) / 2, w: o.bar, h: clear.y1 - clear.y0 },
    { x: mx, y: ty, w: clear.x1 - clear.x0, h: o.bar },
  ];
  const b = o.bar / 2;
  const panes = [
    { x0: clear.x0, x1: mx - b, y0: clear.y0, y1: ty - b }, { x0: mx + b, x1: clear.x1, y0: clear.y0, y1: ty - b },
    { x0: clear.x0, x1: mx - b, y0: ty + b, y1: clear.y1 }, { x0: mx + b, x1: clear.x1, y0: ty + b, y1: clear.y1 },
  ];
  return { members, clear, panes };
}
