import type {
  ActivitySource, BusKind, NodeBand, NodeState, Schematic, SchematicEdge,
  SchematicNode,
} from '../schematic';

export interface PlotCell {
  id: string;
  label?: string;
  part?: string;
  state?: NodeState;
  activity?: ActivitySource;
  note?: string;
  span?: number;
}

export type PlotRow =
  | {
      kind: 'cells';
      band: NodeBand;
      cells: PlotCell[];
      height?: number;
    }
  | { kind: 'bus'; rails: { id: string; label: string; rail: BusKind }[] }
  | { kind: 'rail'; id: string; label: string; rail?: BusKind };

export interface PlotSpec {
  system: string;
  title: string;
  source: string;
  rows: PlotRow[];
  edges: SchematicEdge[];
}

const WIDTH = 820;
const MARGIN = 6;
const GUTTER = 8;
const TOP = 10;
const ROW_GAP = 24;
const BUS_GAP = 34;
const RAIL_PITCH = 19;
const RAIL_LABEL_ROOM = 14;
const RAIL_STROKE = 3;

const BAND_HEIGHT: Record<NodeBand, number> = {
  edge: 30,
  core: 54,
  peripheral: 42,
  io: 34,
  rail: RAIL_STROKE,
};

export function plot(spec: PlotSpec): Schematic {
  const nodes: SchematicNode[] = [];
  let y = TOP;

  spec.rows.forEach((row, i) => {
    const prev = spec.rows[i - 1];
    if (i > 0) y += gapBetween(prev, row);

    if (row.kind === 'cells') {
      const h = row.height ?? BAND_HEIGHT[row.band];
      for (const c of placeCells(row.cells, y, h, row.band)) nodes.push(c);
      y += h;
      return;
    }
    if (row.kind === 'bus') {
      y += RAIL_LABEL_ROOM;
      row.rails.forEach((r, n) => {
        nodes.push(rail(r.id, r.label, y + n * RAIL_PITCH, r.rail));
      });
      y += (row.rails.length - 1) * RAIL_PITCH + RAIL_STROKE;
      return;
    }
    y += RAIL_LABEL_ROOM;
    nodes.push(rail(row.id, row.label, y, row.rail));
    y += RAIL_STROKE;
  });

  const ids = new Set(nodes.map((n) => n.id));
  const edges = spec.edges.filter((e) => ids.has(e.from) && ids.has(e.to));

  return {
    system: spec.system,
    title: spec.title,
    source: spec.source,
    width: WIDTH,
    height: Math.round(y + TOP),
    nodes,
    edges,
  };
}

function gapBetween(prev: PlotRow, next: PlotRow): number {
  if (prev.kind === 'bus' || next.kind === 'bus') return BUS_GAP;
  if (next.kind === 'rail') return ROW_GAP - 8;
  if (prev.kind === 'rail') return 6;
  return ROW_GAP;
}

function placeCells(
  cells: PlotCell[], y: number, h: number, band: NodeBand,
): SchematicNode[] {
  const total = cells.reduce((a, c) => a + (c.span ?? 1), 0);
  const usable = WIDTH - 2 * MARGIN - GUTTER * (cells.length - 1);
  const out: SchematicNode[] = [];
  let x = MARGIN;
  cells.forEach((c, i) => {
    const w = i === cells.length - 1
      ? WIDTH - MARGIN - x
      : Math.round((usable * (c.span ?? 1)) / total);
    out.push({
      id: c.id,
      label: c.label ?? '',
      ...(c.part ? { part: c.part } : {}),
      x,
      y,
      w,
      h,
      band,
      state: c.state ?? 'live',
      ...(c.activity ? { activity: c.activity } : {}),
      ...(c.note ? { note: c.note } : {}),
    });
    x += w + GUTTER;
  });
  return out;
}

function rail(id: string, label: string, y: number, kind?: BusKind): SchematicNode {
  return {
    id,
    label,
    x: MARGIN + 8,
    y,
    w: WIDTH - 2 * (MARGIN + 8),
    h: RAIL_STROKE,
    band: 'rail',
    state: 'live',
    ...(kind ? { rail: kind } : {}),
  };
}
