import type { Schematic } from '../schematic';
import { plot } from './plot';

export const SYS1_SCHEMATIC: Schematic = plot({
  system: 'SYS1',
  title: 'ACE SYSTEM 1',
  source: 'Ace System 1 - Z80 - simplified board diagram',
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
        { id: 'ic24' },
        { id: 'ic25' },
        { id: 'ic37' },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'ram', span: 1.1 },
        { id: 'rom', span: 1.5 },
        { id: 'ay', span: 1.3 },
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
      cells: [
        { id: 'reels' },
        { id: 'hopper' },
      ],
    },
  ],
  edges: [
    { from: 'lamps', to: 'ic24', kind: 'control' },
    { from: 'sevenseg', to: 'ic24', kind: 'control' },
    { from: 'meters', to: 'ic25', kind: 'control' },
    { from: 'switches', to: 'ic37', kind: 'control' },
    { from: 'coins', to: 'ic37', kind: 'control' },
    { from: 'ic24', to: 'bus-data', kind: 'data' },
    { from: 'ic24', to: 'bus-addr', kind: 'address' },
    { from: 'ic25', to: 'bus-data', kind: 'data' },
    { from: 'ic25', to: 'bus-addr', kind: 'address' },
    { from: 'ic37', to: 'bus-data', kind: 'data' },
    { from: 'ic37', to: 'bus-addr', kind: 'address' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'ay', to: 'bus-data', kind: 'data' },
    { from: 'ay', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
    { from: 'periph-rail', to: 'hopper', kind: 'control' },
  ],
});
