import type { Schematic } from '../schematic';
import { plot } from './plot';

export const MMM_SCHEMATIC: Schematic = plot({
  system: 'MMM',
  title: 'MAYGAY MMM',
  source: 'Maygay MMM - Z80 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
        { id: 'sevenseg' },
        { id: 'triacs' },
        { id: 'switches' },
        { id: 'coins' },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'ctc' },
        { id: 'sound' },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'rom', span: 1.5 },
        { id: 'ram', span: 1.1 },
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
    { from: 'switches', to: 'bus-data', kind: 'control' },
    { from: 'coins', to: 'switches', kind: 'control' },
    { from: 'lamps', to: 'bus-data', kind: 'control' },
    { from: 'sevenseg', to: 'bus-data', kind: 'control' },
    { from: 'triacs', to: 'sound', kind: 'control' },
    { from: 'ctc', to: 'bus-data', kind: 'data' },
    { from: 'ctc', to: 'bus-ctrl', kind: 'control' },
    { from: 'sound', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'cpu', to: 'periph-rail', kind: 'control' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
  ],
});
