import type { Schematic } from '../schematic';
import { plot } from './plot';

export const PROCONN_SCHEMATIC: Schematic = plot({
  system: 'PROCONN',
  title: 'PROJECT PROCONN',
  source: 'Project Coin Proconn - Z80 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
        { id: 'sevenseg' },
        { id: 'vfd' },
        { id: 'meters' },
        { id: 'switches' },
        { id: 'coins' },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'pio', span: 1.6 },
        { id: 'ctc' },
        { id: 'sio' },
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
        { id: 'samples' },
      ],
    },
  ],
  edges: [
    { from: 'lamps', to: 'pio', kind: 'control' },
    { from: 'sevenseg', to: 'pio', kind: 'control' },
    { from: 'vfd', to: 'pio', kind: 'control' },
    { from: 'meters', to: 'ay', kind: 'control' },
    { from: 'switches', to: 'pio', kind: 'control' },
    { from: 'coins', to: 'pio', kind: 'control' },
    { from: 'pio', to: 'bus-data', kind: 'data' },
    { from: 'pio', to: 'bus-addr', kind: 'address' },
    { from: 'ctc', to: 'bus-data', kind: 'data' },
    { from: 'ctc', to: 'bus-ctrl', kind: 'control' },
    { from: 'sio', to: 'bus-data', kind: 'data' },
    { from: 'sio', to: 'bus-addr', kind: 'address' },
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
    { from: 'periph-rail', to: 'samples', kind: 'control' },
  ],
});
