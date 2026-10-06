
export type ActivitySource =
  | { kind: 'io'; ranges: [lo: number, hi: number][] }
  | { kind: 'frame'; signal: FrameSignal }
  | { kind: 'cpu' };

export type FrameSignal =
  | 'lamps' | 'reels' | 'display' | 'dots' | 'digits' | 'coin';

export type NodeState = 'live' | 'unmodelled' | 'unfitted' | 'unserved';

export interface SchematicNode {
  id: string;
  label: string;
  part?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  band: NodeBand;
  state: NodeState;
  activity?: ActivitySource;
  note?: string;
  rail?: BusKind;
}

export type NodeBand = 'core' | 'io' | 'peripheral' | 'edge' | 'rail';

export type BusKind = 'data' | 'address' | 'control' | 'serial' | 'analog' | 'power';

export interface SchematicEdge {
  from: string;
  to: string;
  kind: BusKind;
  via?: [x: number, y: number][];
}

export interface Schematic {
  system: string;
  title: string;
  source: string;
  width: number;
  height: number;
  nodes: SchematicNode[];
  edges: SchematicEdge[];
}

export const TAILORED_IDS = {
  reels: 'reels',
  hopper: 'hopper',
  hopper2: 'hopper2',
  coinMech: 'coinmech',
  notes: 'notes',
  display: 'alpha',
  digits: 'sevenseg',
  dots: 'dots',
  meters: 'meters',
} as const;

export type ActivityLevel = 0 | 1 | 2;

export function envelope(prev: number, sample: number, release = 0.85): number {
  return Math.max(sample, prev * release);
}

export function frameDuty(hits: number, frames: number): number {
  if (hits <= 0 || frames <= 0) return 0;
  return Math.max(0.25, hits / frames);
}

export function levelFromRatio(ratio: number): ActivityLevel {
  if (ratio > 0.35) return 2;
  return ratio > 0.02 ? 1 : 0;
}

export const MAX_IO_RANGE = 64;

export function everyNth(base: number, count: number, step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) out.push([base + i * step, base + i * step + 1]);
  return out;
}

export function bucketIoCounts(
  schematic: Schematic,
  log: ReadonlyMap<number, { reads: number; writes: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of schematic.nodes) {
    if (n.activity?.kind !== 'io') continue;
    let total = 0;
    for (const [lo, hi] of n.activity.ranges) {
      const end = Math.min(hi, lo + MAX_IO_RANGE);
      for (let addr = lo; addr < end; addr++) {
        const e = log.get(addr);
        if (e) total += e.reads + e.writes;
      }
    }
    out[n.id] = total;
  }
  return out;
}
