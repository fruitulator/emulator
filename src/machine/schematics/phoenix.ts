import type { Schematic } from '../schematic';
import { plot } from './plot';

export const PHOENIX_SCHEMATIC: Schematic = plot({
  system: 'PHOENIX',
  title: 'PHOENIX',
  source: 'Electrocoin Phoenix - HD64180 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
        { id: 'sevenseg' },
        { id: 'meters' },
        { id: 'switches' },
        { id: 'coins' },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'serial', span: 1.4 },
        { id: 'sound', span: 1.4 },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'ram', span: 1.1 },
        { id: 'rom', span: 1.5 },
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
      cells: [{ id: 'cpu', span: 2.2 }],
    },
    { kind: 'rail', id: 'periph-rail', label: 'CABINET LOOM', rail: 'serial' },
    {
      kind: 'cells',
      band: 'peripheral',
      cells: [{ id: 'reels' }],
    },
  ],
  edges: [
    { from: 'lamps', to: 'bus-data', kind: 'control' },
    { from: 'sevenseg', to: 'bus-data', kind: 'control' },
    { from: 'meters', to: 'bus-data', kind: 'control' },
    { from: 'switches', to: 'bus-data', kind: 'control' },
    { from: 'coins', to: 'bus-data', kind: 'control' },
    { from: 'serial', to: 'bus-data', kind: 'data' },
    { from: 'sound', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
  ],
});
