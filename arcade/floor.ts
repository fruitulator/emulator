
export const GRID = { cols: 72, rows: 48, step: 4 };

export const GRID_EDGE_M = 0.05;

export function doorway(cols = GRID.cols, step = GRID.step): { from: number; to: number } {
  return { from: cols - 5 * step, to: cols - 2 * step - 1 };
}

export function isDoorway(col: number, row: number, cols = GRID.cols, rows = GRID.rows, step = GRID.step): boolean {
  const d = doorway(cols, step);
  return row >= rows - step && col >= d.from && col <= d.to;
}

export interface GridOptions {
  width: number;
  depth: number;
  seam?: number;
  cols?: number;
  rows?: number;
  step?: number;
}

export function gridGeometry(o: GridOptions): GridGeometry {
  const cols = o.cols ?? GRID.cols;
  const rows = o.rows ?? GRID.rows;
  const step = o.step ?? GRID.step;
  const cell = (o.width + (o.seam ?? FLOOR.seam)) / step;
  const w = cols * cell, d = rows * cell;
  const box = { minX: -w / 2 - GRID_EDGE_M, maxX: w / 2 + GRID_EDGE_M, minZ: -GRID_EDGE_M, maxZ: d + GRID_EDGE_M };
  const dw = doorway(cols, step);
  const doorX = box.minX + GRID_EDGE_M + ((dw.from + dw.to + 1) / 2) * cell;
  const ww = windowWidth(box.maxZ - box.minZ);
  const zc = (box.minZ + box.maxZ) / 2;
  const rowAt = (z: number): number => (z - GRID_EDGE_M) / cell - 0.5;
  return {
    cell, cols, rows, step, box, doorX,
    window: { from: Math.max(0, Math.ceil(rowAt(zc - ww / 2))), to: Math.min(rows - 1, Math.floor(rowAt(zc + ww / 2))) },
  };
}

export interface GridGeometry {
  cell: number; cols: number; rows: number; step: number; box: RoomPlan['box']; doorX: number; window: { from: number; to: number };
}

export function windowWidth(depth: number): number {
  return Math.min(3.2, depth * 0.45);
}

export interface GridCell {
  col: number;
  row: number;
  turn?: 0 | 1 | 2 | 3;
}

export function gridStand(c: GridCell, g: { cell: number; step: number; box: RoomPlan['box'] }): Stand {
  return {
    x: g.box.minX + GRID_EDGE_M + (c.col + g.step / 2) * g.cell,
    z: g.box.minZ + GRID_EDGE_M + (c.row + g.step / 2) * g.cell,
    yaw: yawOf({ face: 1, turn: c.turn ?? 0 }),
  };
}

export function cellRect(c: { col: number; row: number }, g: { cell: number; step: number; box: RoomPlan['box'] }, size = g.step): Rect {
  const x = g.box.minX + GRID_EDGE_M + c.col * g.cell;
  const z = g.box.minZ + GRID_EDGE_M + c.row * g.cell;
  return { minX: x, maxX: x + size * g.cell, minZ: z, maxZ: z + size * g.cell };
}

export function cellOf(x: number, z: number, g: { cell: number; box: RoomPlan['box'] }): { col: number; row: number } {
  return { col: (x - g.box.minX - GRID_EDGE_M) / g.cell, row: (z - g.box.minZ - GRID_EDGE_M) / g.cell };
}

export function cellCentre(c: { col: number; row: number }, g: { cell: number; box: RoomPlan['box'] }): { x: number; z: number } {
  return { x: g.box.minX + GRID_EDGE_M + (c.col + 0.5) * g.cell, z: g.box.minZ + GRID_EDGE_M + (c.row + 0.5) * g.cell };
}

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

export function gridPlan(cells: GridCell[], o: GridOptions): RoomPlan & { doorX: number } {
  const g = gridGeometry(o);
  return { spots: cells.map((c) => gridStand(c, g)), box: g.box, doorX: g.doorX };
}

export interface Spot {
  x: number;
  z: number;
  face: 1 | -1;
  turn: 0 | 1 | 2 | 3;
  aisle: number;
  row: number;
  bank: number;
}

export interface FloorPlan {
  spots: Spot[];
  aisles: { z: number; minX: number; maxX: number }[];
  rows: number[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface FloorOptions {
  width: number;
  depth: number;
  bank?: number;
  banksPerRow?: number;
  gap?: number;
  cross?: number;
  aisle?: number;
  backToBack?: number;
  seam?: number;
}

export const FLOOR = {
  bank: 4,
  banksPerRow: 2,
  gap: 0.3,
  cross: 1.6,
  aisle: 3.6,
  backToBack: 0.05,
  seam: 0.02,
};

export function planFloor(n: number, o: FloorOptions): FloorPlan {
  const bank = o.bank ?? FLOOR.bank;
  const bpr = o.banksPerRow ?? FLOOR.banksPerRow;
  const gap = o.gap ?? FLOOR.gap;
  const cross = o.cross ?? FLOOR.cross;
  const aisleW = o.aisle ?? FLOOR.aisle;
  const b2b = o.backToBack ?? FLOOR.backToBack;
  const perRowMax = bank * bpr;
  const nRows = Math.max(1, Math.ceil(n / perRowMax));
  const rowCounts: number[] = [];
  for (let r = 0; r < nRows; r++) rowCounts.push(Math.floor(n / nRows) + (r < n % nRows ? 1 : 0));

  const rows: number[] = [];
  let z = 0;
  for (let r = 0; r < nRows; r++) {
    if (r > 0) z += r % 2 === 1 ? aisleW : o.depth + b2b;
    rows.push(z);
  }

  const spots: Spot[] = [];
  const pitch = o.width + gap;
  for (let r = 0; r < nRows; r++) {
    const count = rowCounts[r];
    const banks = Math.max(1, Math.ceil(count / bank));
    const sizes: number[] = [];
    for (let b = 0; b < banks; b++) sizes.push(Math.floor(count / banks) + (b < count % banks ? 1 : 0));
    const lengths = sizes.map((s) => s * o.width + (s - 1) * gap);
    const total = lengths.reduce((a, b) => a + b, 0) + (banks - 1) * cross;
    let x0 = -total / 2 + o.width / 2;
    const face: 1 | -1 = r % 2 === 0 ? 1 : -1;
    const aisle = Math.floor(r / 2);
    for (let b = 0; b < banks; b++) {
      for (let i = 0; i < sizes[b]; i++) {
        spots.push({ x: x0 + i * pitch, z: rows[r], face, turn: 0, aisle, row: r, bank: b });
      }
      x0 += lengths[b] + cross;
    }
  }

  const aisles: FloorPlan['aisles'] = [];
  for (let a = 0; a * 2 < nRows; a++) {
    const near = rows[a * 2];
    const far = rows[a * 2 + 1];
    const zc = far !== undefined ? (near + far) / 2 : near + aisleW / 2;
    const xs = spots.filter((s) => s.aisle === a).map((s) => s.x);
    aisles.push({ z: zc, minX: Math.min(...xs), maxX: Math.max(...xs) });
  }
  const xs = spots.map((s) => s.x);
  return {
    spots,
    aisles,
    rows,
    bounds: {
      minX: Math.min(...xs) - o.width / 2,
      maxX: Math.max(...xs) + o.width / 2,
      minZ: rows[0] - o.depth / 2,
      maxZ: rows[rows.length - 1] + o.depth / 2,
    },
  };
}

export interface FloorCell {
  aisle: number;
  at: number;
  turn?: 0 | 1 | 2 | 3;
}

export function planPlaced(cells: FloorCell[], o: FloorOptions & { divs: number; cabDivs: number }): FloorPlan {
  if (!cells.length) return planFloor(0, o);
  const aisleW = o.aisle ?? FLOOR.aisle;
  const b2b = o.backToBack ?? FLOOR.backToBack;
  const nRows = Math.max(...cells.map((c) => c.aisle)) + 1;
  const rows: number[] = [];
  let z = 0;
  for (let r = 0; r < nRows; r++) {
    if (r > 0) z += r % 2 === 1 ? aisleW : o.depth + b2b;
    rows.push(z);
  }
  const div = (o.width + (o.seam ?? FLOOR.seam)) / o.cabDivs;
  const total = o.divs * div;
  const spots: Spot[] = cells.map((c) => ({
    x: -total / 2 + (c.at + o.cabDivs / 2) * div, z: rows[c.aisle], face: c.aisle % 2 === 0 ? 1 : -1, turn: c.turn ?? 0,
    aisle: Math.floor(c.aisle / 2), row: c.aisle, bank: 0,
  }));
  const aisles: FloorPlan['aisles'] = [];
  for (let a = 0; a * 2 < nRows; a++) {
    const near = rows[a * 2];
    const far = rows[a * 2 + 1];
    const zc = far !== undefined ? (near + far) / 2 : near + aisleW / 2;
    aisles.push({ z: zc, minX: -total / 2 + o.width / 2, maxX: total / 2 - o.width / 2 });
  }
  return {
    spots,
    aisles,
    rows,
    bounds: { minX: -total / 2, maxX: total / 2, minZ: rows[0] - o.depth / 2, maxZ: rows[rows.length - 1] + o.depth / 2 },
  };
}

export function startSpot(spots: Spot[]): { aisle: number; face: 1 | -1; x: number } | null {
  if (!spots.length) return null;
  const row0 = Math.min(...spots.map((s) => s.row));
  const first = spots.filter((s) => s.row === row0).sort((a, b) => a.x - b.x);
  return { aisle: first[0].aisle, face: first[0].face, x: first[Math.min(1, first.length - 1)].x };
}

export function yawOf(s: { face: 1 | -1; turn: number }): number {
  const y = (s.face === 1 ? 0 : Math.PI) - s.turn * (Math.PI / 2);
  return Math.atan2(Math.sin(y), Math.cos(y));
}

export interface Stand {
  x: number;
  z: number;
  yaw: number;
}

export interface RoomPlan {
  spots: Stand[];
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function walled(p: FloorPlan, margin: { side: number; back: number; front: number }): RoomPlan {
  const b = p.bounds;
  return {
    spots: p.spots.map((s) => ({ x: s.x, z: s.z, yaw: yawOf(s) })),
    box: { minX: b.minX - margin.side, maxX: b.maxX + margin.side, minZ: b.minZ - margin.back, maxZ: b.maxZ + margin.front },
  };
}

export function banksPlan(n: number, o: FloorOptions, margin: { side: number; back: number; front: number }): RoomPlan {
  return walled(planFloor(n, o), margin);
}

export function placedPlan(
  cells: FloorCell[], o: FloorOptions & { divs: number; cabDivs: number }, margin: { side: number; back: number; front: number },
): RoomPlan {
  return walled(planPlaced(cells, o), margin);
}
