import type { Schematic } from '../schematic';
import { plot } from './plot';

export const MPU3_SCHEMATIC: Schematic = plot({
  system: 'MPU3',
  title: 'BARCREST MPU3',
  source: 'Barcrest MPU3 - M6808 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
        { id: 'sevenseg' },
        { id: 'meters' },
        { id: 'triacs' },
        { id: 'switches' },
        { id: 'coins' },
        { id: 'alpha' },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'pia3' },
        { id: 'pia4' },
        { id: 'pia5' },
        { id: 'pia6' },
        { id: 'ptm' },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'rom', span: 1.5 },
        { id: 'ram', span: 1.1 },
        { id: 'sound', span: 1.1 },
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
    { from: 'switches', to: 'pia3', kind: 'control' },
    { from: 'coins', to: 'pia3', kind: 'control' },
    { from: 'triacs', to: 'pia3', kind: 'control' },
    { from: 'lamps', to: 'pia4', kind: 'control' },
    { from: 'sevenseg', to: 'pia4', kind: 'control' },
    { from: 'meters', to: 'pia4', kind: 'control' },
    { from: 'alpha', to: 'pia6', kind: 'control' },
    { from: 'pia3', to: 'bus-data', kind: 'data' },
    { from: 'pia4', to: 'bus-data', kind: 'data' },
    { from: 'pia5', to: 'bus-data', kind: 'data' },
    { from: 'pia6', to: 'bus-data', kind: 'data' },
    { from: 'ptm', to: 'bus-data', kind: 'data' },
    { from: 'ptm', to: 'bus-ctrl', kind: 'control' },
    { from: 'sound', to: 'ptm', kind: 'control' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'pia5', to: 'periph-rail', kind: 'control' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
  ],
});
