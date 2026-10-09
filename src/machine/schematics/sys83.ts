import type { Schematic } from '../schematic';
import { plot } from './plot';

export const SYS83_SCHEMATIC: Schematic = plot({
  system: 'SYS83',
  title: 'BFM SYSTEM 83',
  source: 'BFM System 83 - MC6802 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
        { id: 'sevenseg' },
        { id: 'vfd' },
        { id: 'meters' },
        { id: 'triacs' },
        { id: 'switches' },
        { id: 'coins' },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'ptm' },
        { id: 'acia' },
        { id: 'ay' },
        { id: 'speaker' },
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
    { from: 'coins', to: 'bus-data', kind: 'control' },
    { from: 'bus-data', to: 'lamps', kind: 'control' },
    { from: 'bus-data', to: 'sevenseg', kind: 'control' },
    { from: 'bus-data', to: 'vfd', kind: 'control' },
    { from: 'bus-data', to: 'meters', kind: 'control' },
    { from: 'bus-data', to: 'triacs', kind: 'control' },
    { from: 'ptm', to: 'speaker', kind: 'control' },
    { from: 'ptm', to: 'acia', kind: 'control' },
    { from: 'ptm', to: 'bus-data', kind: 'data' },
    { from: 'acia', to: 'bus-data', kind: 'data' },
    { from: 'ay', to: 'bus-data', kind: 'data' },
    { from: 'ptm', to: 'bus-ctrl', kind: 'control' },
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
