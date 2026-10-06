import type { Schematic } from '../schematic';
import { plot } from './plot';

export const SYS80_SCHEMATIC: Schematic = plot({
  system: 'SYSTEM80',
  title: 'SYSTEM 80',
  source: 'JPM System 80 - TMS9980A - simplified board diagram',
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
        { id: 'ports', span: 3 },
        { id: 'iocard', span: 2 },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'ram', span: 1.1 },
        { id: 'rom', span: 1.5 },
        { id: 'ay', span: 1.1 },
        { id: 'speaker', span: 1.1 },
      ],
    },
    {
      kind: 'bus',
      rails: [
        { id: 'bus-data', label: 'DATA', rail: 'data' },
        { id: 'bus-addr', label: 'ADDRESS', rail: 'address' },
        { id: 'bus-ctrl', label: 'CONTROL', rail: 'control' },
        { id: 'bus-cru', label: 'CRU SERIAL', rail: 'serial' },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      height: 60,
      cells: [
        { id: 'cpu', span: 2.2 },
        { id: 'uart', span: 1.3 },
      ],
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
    { from: 'lamps', to: 'ports', kind: 'control' },
    { from: 'sevenseg', to: 'ports', kind: 'control' },
    { from: 'meters', to: 'ports', kind: 'control' },
    { from: 'switches', to: 'iocard', kind: 'control' },
    { from: 'coins', to: 'iocard', kind: 'control' },
    { from: 'ports', to: 'bus-cru', kind: 'serial' },
    { from: 'iocard', to: 'bus-cru', kind: 'serial' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'ay', to: 'bus-cru', kind: 'serial' },
    { from: 'speaker', to: 'ports', kind: 'control' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'cpu', to: 'bus-cru', kind: 'serial' },
    { from: 'uart', to: 'bus-cru', kind: 'serial' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
    { from: 'periph-rail', to: 'hopper', kind: 'control' },
  ],
});
