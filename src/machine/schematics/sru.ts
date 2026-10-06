import type { Schematic } from '../schematic';
import { plot } from './plot';

export const SRU_SCHEMATIC: Schematic = plot({
  system: 'SRU',
  title: 'JPM SRU',
  source: 'JPM Stepper Reel Unit - TMS9980A - simplified board diagram',
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
        { id: 'ports', span: 2 },
        { id: 'inputs', span: 1.4 },
        { id: 'decode', span: 1.2 },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'ram', span: 1.1 },
        { id: 'rom', span: 1.6 },
        { id: 'tone', span: 1.3 },
        { id: 'busext', span: 1.3 },
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
        { id: 'irq', span: 1.4 },
      ],
    },
    { kind: 'rail', id: 'periph-rail', label: 'REEL UNIT LOOM - 3 x 35 WAY', rail: 'serial' },
    {
      kind: 'cells',
      band: 'peripheral',
      cells: [
        { id: 'reels' },
        { id: 'triacs' },
      ],
    },
  ],
  edges: [
    { from: 'lamps', to: 'ports', kind: 'control' },
    { from: 'sevenseg', to: 'ports', kind: 'control' },
    { from: 'meters', to: 'ports', kind: 'control' },
    { from: 'switches', to: 'inputs', kind: 'control' },
    { from: 'coins', to: 'inputs', kind: 'control' },
    { from: 'decode', to: 'ports', kind: 'control' },
    { from: 'decode', to: 'inputs', kind: 'control' },
    { from: 'ports', to: 'bus-cru', kind: 'serial' },
    { from: 'inputs', to: 'bus-cru', kind: 'serial' },
    { from: 'decode', to: 'bus-cru', kind: 'serial' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'tone', to: 'bus-cru', kind: 'serial' },
    { from: 'busext', to: 'bus-cru', kind: 'serial' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'cpu', to: 'bus-cru', kind: 'serial' },
    { from: 'irq', to: 'bus-ctrl', kind: 'control' },
    { from: 'irq', to: 'bus-cru', kind: 'serial' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
    { from: 'periph-rail', to: 'triacs', kind: 'control' },
  ],
});
