import type { Schematic } from '../schematic';
import { plot } from './plot';

const LINK_HOPS: [string, string][] = [
  ['door', 'coinboard'], ['coinboard', 'reelboard'], ['reelboard', 'hopperboard'],
];

function withLinkHops(s: Schematic): Schematic {
  const at = new Map(s.nodes.map((n) => [n.id, n]));
  for (const [from, to] of LINK_HOPS) {
    const a = at.get(from)!;
    const b = at.get(to)!;
    const y0 = a.y + a.h;
    const dip = y0 + 9;
    const x0 = a.x + a.w - 16;
    const x1 = b.x + 16;
    s.edges.push({ from, to, kind: 'serial', via: [[x0, y0], [x0, dip], [x1, dip], [x1, y0]] });
  }
  return s;
}

export const EPOCH_SCHEMATIC: Schematic = withLinkHops(plot({
  system: 'EPOCH',
  title: 'Maygay Epoch',
  source: 'Maygay Epoch - H8/3002 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps', span: 1 },
        { id: 'sevenseg', span: 1.2 },
        { id: 'switches', span: 1 },
        { id: 'alpha', span: 1.2 },
        { id: 'coinmech', span: 1.1 },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'door', span: 1.2 },
        { id: 'coinboard', span: 1.1 },
        { id: 'reelboard', span: 1.1 },
        { id: 'hopperboard', span: 1.6 },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'asic', span: 1.2 },
        { id: 'keys', span: 1.1 },
        { id: 'reels', span: 1.1 },
        { id: 'hopper', span: 0.6 },
        { id: 'meters', span: 0.6 },
        { id: 'notes', span: 0.9 },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'ram', span: 0.75 },
        { id: 'rom', span: 1.2 },
        { id: 'sndrom', span: 1 },
        { id: 'ymz', span: 1.3 },
      ],
    },
    {
      kind: 'bus',
      rails: [
        { id: 'bus-data', label: 'DATA', rail: 'data' },
        { id: 'bus-addr', label: 'ADDRESS', rail: 'address' },
        { id: 'bus-ctrl', label: 'CONTROL', rail: 'control' },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      height: 60,
      cells: [
        { id: 'cpu', span: 2 },
        { id: 'sci', span: 1.1 },
        { id: 'boot', span: 1.1 },
        { id: 'ports', span: 0.9 },
        { id: 'secmicro', span: 1.3 },
      ],
    },
    { kind: 'rail', id: 'periph-rail', label: 'MAIN MICROPROCESSOR UNIT', rail: 'serial' },
    {
      kind: 'cells',
      band: 'peripheral',
      cells: [
        { id: 'dataport', span: 1.4 },
        { id: 'serial2', span: 1.3 },
        { id: 'matrix', span: 1.3 },
        { id: 'ioport', span: 0.8 },
        { id: 'sound', span: 1.3 },
        { id: 'psu', span: 1.2 },
      ],
    },
    {
      kind: 'cells',
      band: 'peripheral',
      cells: [
        { id: 'options', span: 1.1 },
        { id: 'funcsw', span: 1.25 },
        { id: 'mpuleds', span: 1.3 },
        { id: 'spark', span: 1 },
        { id: 'infrared', span: 0.9 },
        { id: 'pl1', span: 0.9 },
      ],
    },
  ],
  edges: [
    { from: 'lamps', to: 'door', kind: 'control' },
    { from: 'lamps', to: 'coinboard', kind: 'control' },
    { from: 'lamps', to: 'reelboard', kind: 'control' },
    { from: 'sevenseg', to: 'door', kind: 'control' },
    { from: 'switches', to: 'door', kind: 'control' },
    { from: 'switches', to: 'hopperboard', kind: 'control' },
    { from: 'alpha', to: 'door', kind: 'serial' },
    { from: 'coinmech', to: 'coinboard', kind: 'control' },
    { from: 'keys', to: 'coinboard', kind: 'control' },
    { from: 'reels', to: 'reelboard', kind: 'control' },
    { from: 'hopper', to: 'hopperboard', kind: 'control' },
    { from: 'meters', to: 'hopperboard', kind: 'control' },
    { from: 'notes', to: 'hopperboard', kind: 'control' },
    { from: 'asic', to: 'door', kind: 'serial' },
    { from: 'asic', to: 'ram', kind: 'data' },
    { from: 'asic', to: 'bus-data', kind: 'data' },
    { from: 'asic', to: 'bus-ctrl', kind: 'control' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'sndrom', to: 'ymz', kind: 'data' },
    { from: 'ymz', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'sci', to: 'bus-data', kind: 'data' },
    { from: 'ports', to: 'bus-data', kind: 'data' },
    { from: 'boot', to: 'ports', kind: 'control' },
    { from: 'secmicro', to: 'ports', kind: 'control' },
    { from: 'periph-rail', to: 'dataport', kind: 'serial' },
    { from: 'periph-rail', to: 'serial2', kind: 'serial' },
    { from: 'periph-rail', to: 'matrix', kind: 'control' },
    { from: 'periph-rail', to: 'ioport', kind: 'control' },
    { from: 'periph-rail', to: 'sound', kind: 'analog' },
    { from: 'periph-rail', to: 'psu', kind: 'power' },
    { from: 'periph-rail', to: 'options', kind: 'control' },
    { from: 'periph-rail', to: 'funcsw', kind: 'control' },
    { from: 'periph-rail', to: 'mpuleds', kind: 'control' },
    { from: 'periph-rail', to: 'spark', kind: 'control' },
    { from: 'periph-rail', to: 'infrared', kind: 'serial' },
    { from: 'periph-rail', to: 'pl1', kind: 'control' },
  ],
}));
