import type { Schematic } from '../schematic';
import { plot } from './plot';

export const MPU2_SCHEMATIC: Schematic = plot({
  system: 'MPU2',
  title: 'BARCREST MPU2',
  source: 'Barcrest MPU2 - MC6800 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
        { id: 'triacs' },
        { id: 'switches' },
        { id: 'coins' },
        { id: 'sound' },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'pia1' },
        { id: 'pia2' },
        { id: 'pia3' },
        { id: 'pia4' },
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
    { from: 'switches', to: 'pia1', kind: 'control' },
    { from: 'switches', to: 'pia4', kind: 'control' },
    { from: 'coins', to: 'pia1', kind: 'control' },
    { from: 'coins', to: 'pia2', kind: 'control' },
    { from: 'pia1', to: 'triacs', kind: 'control' },
    { from: 'pia1', to: 'sound', kind: 'control' },
    { from: 'pia2', to: 'lamps', kind: 'control' },
    { from: 'pia3', to: 'lamps', kind: 'control' },
    { from: 'pia1', to: 'bus-data', kind: 'data' },
    { from: 'pia2', to: 'bus-data', kind: 'data' },
    { from: 'pia3', to: 'bus-data', kind: 'data' },
    { from: 'pia4', to: 'bus-data', kind: 'data' },
    { from: 'pia1', to: 'bus-ctrl', kind: 'control' },
    { from: 'pia2', to: 'bus-ctrl', kind: 'control' },
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
