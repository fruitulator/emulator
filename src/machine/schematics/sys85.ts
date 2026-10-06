import type { Schematic } from '../schematic';
import { plot } from './plot';

export const SYS85_SCHEMATIC: Schematic = plot({
  system: 'SYS85',
  title: 'System 85',
  source: 'Bell-Fruit System 85 - MC6809 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
        { id: 'switches' },
        { id: 'meters' },
        { id: 'coins' },
      ],
    },
    { kind: 'cells', band: 'io', cells: [{ id: 'mux', span: 6 }, { id: 'watchdog' }] },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'ram', span: 1.2 },
        { id: 'rom', span: 1.6 },
        { id: 'ay', span: 1.1 },
        { id: 'alpha', span: 1.5 },
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
      cells: [
        { id: 'cpu', span: 2.6 },
        { id: 'timer', span: 1.6 },
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
    { from: 'meters', to: 'mux', kind: 'control' },
    { from: 'coins', to: 'mux', kind: 'control' },
    { from: 'mux', to: 'bus-data', kind: 'data' },
    { from: 'watchdog', to: 'bus-ctrl', kind: 'control' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'ay', to: 'bus-data', kind: 'data' },
    { from: 'alpha', to: 'bus-ctrl', kind: 'control' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'timer', to: 'bus-ctrl', kind: 'control' },
    { from: 'acia', to: 'bus-data', kind: 'data' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
    { from: 'periph-rail', to: 'coinmech', kind: 'control' },
  ],
});
