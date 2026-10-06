import type {
  ActivitySource, FrameSignal, NodeState, Schematic, SchematicNode,
} from './schematic';

export interface BoardPart {
  id: string;
  label: string;
  part?: string;
  device?: object;
  signal?: FrameSignal;
  cpu?: boolean;
  io?: [lo: number, hi: number][];
  modelled?: boolean;
  note?: string;
}

export function stateOf(p: BoardPart): NodeState {
  if (p.modelled !== undefined) return p.modelled ? 'live' : 'unmodelled';
  return p.device || p.signal || p.cpu ? 'live' : 'unmodelled';
}

export function activityOf(p: BoardPart, counted: boolean): ActivitySource | undefined {
  if (stateOf(p) !== 'live') return undefined;
  if (p.cpu) return { kind: 'cpu' };
  if (p.signal) return { kind: 'frame', signal: p.signal };
  if (p.io && counted) return { kind: 'io', ranges: p.io };
  return undefined;
}

export function applyParts(
  s: Schematic, parts: readonly BoardPart[], counted: boolean,
): void {
  const by = new Map(s.nodes.map((n) => [n.id, n]));
  for (const p of parts) {
    const n = by.get(p.id);
    if (!n) continue;
    n.label = p.label;
    n.state = stateOf(p);
    setOrDelete(n, 'part', p.part);
    setOrDelete(n, 'note', p.note);
    setOrDelete(n, 'activity', activityOf(p, counted));
  }
}

function setOrDelete<K extends 'part' | 'note' | 'activity'>(
  n: SchematicNode, key: K, value: SchematicNode[K] | undefined,
): void {
  if (value === undefined) delete n[key];
  else n[key] = value;
}
