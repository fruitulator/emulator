import type { Schematic } from '../schematic';
import { plot } from './plot';

export const SYS5_SCHEMATIC: Schematic = plot({
  system: 'SYS5',
  title: 'System 5',
  source: 'JPM System 5 (AWP) - MC68000 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
        { id: 'switches' },
        { id: 'sevenseg' },
        { id: 'meters' },
        { id: 'coins' },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'mux', span: 3 },
        { id: 'reeldrv', span: 2 },
        { id: 'pia', span: 1.5 },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'ram', span: 1.2 },
        { id: 'rom', span: 1.5 },
        { id: 'alpha', span: 1.4 },
        { id: 'upd', span: 1.1 },
        { id: 'saa', span: 1.1 },
      ],
    },
    {
      kind: 'bus',
      rails: [
        { id: 'bus-data', label: 'DATA (16)', rail: 'data' },
        { id: 'bus-addr', label: 'ADDRESS', rail: 'address' },
        { id: 'bus-ctrl', label: 'CONTROL', rail: 'control' },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      height: 60,
      cells: [
        { id: 'cpu', span: 2.4 },
        { id: 'ptm', span: 1.5 },
        { id: 'acia', span: 1.8 },
      ],
    },
    { kind: 'rail', id: 'periph-rail', label: 'CABINET LOOM', rail: 'serial' },
    {
      kind: 'cells',
      band: 'peripheral',
      cells: [
        { id: 'reels' },
        { id: 'coinmech' },
      ],
    },
  ],
  edges: [
    { from: 'lamps', to: 'mux', kind: 'control' },
    { from: 'switches', to: 'mux', kind: 'control' },
    { from: 'sevenseg', to: 'mux', kind: 'control' },
    { from: 'meters', to: 'pia', kind: 'control' },
    { from: 'coins', to: 'pia', kind: 'control' },
    { from: 'mux', to: 'bus-data', kind: 'data' },
    { from: 'reeldrv', to: 'bus-data', kind: 'data' },
    { from: 'pia', to: 'bus-data', kind: 'data' },
    { from: 'pia', to: 'bus-ctrl', kind: 'control' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'alpha', to: 'bus-ctrl', kind: 'control' },
    { from: 'upd', to: 'bus-data', kind: 'data' },
    { from: 'saa', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'ptm', to: 'bus-ctrl', kind: 'control' },
    { from: 'acia', to: 'bus-data', kind: 'data' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
    { from: 'periph-rail', to: 'coinmech', kind: 'control' },
  ],
});
