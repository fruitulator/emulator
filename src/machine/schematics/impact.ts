import type { Schematic } from '../schematic';
import { plot } from './plot';

export const IMPACT_SCHEMATIC: Schematic = plot({
  system: 'IMPACT',
  title: 'JPM IMPACT',
  source: 'JPM IMPACT System 6 - MC68000 - simplified board diagram',
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
    { kind: 'cells', band: 'io', cells: [{ id: 'mux', span: 6 }, { id: 'optos' }] },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'ram', span: 1.1 },
        { id: 'rom', span: 1.5 },
        { id: 'upd', span: 1.1 },
        { id: 'pot', span: 1.1 },
        { id: 'alpha', span: 1.2 },
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
        { id: 'cpu', span: 2.2 },
        { id: 'duart', span: 1.8 },
        { id: 'ppi', span: 1.6 },
        { id: 'ump', span: 1.4 },
      ],
    },
    { kind: 'rail', id: 'periph-rail', label: 'CABINET LOOM', rail: 'serial' },
    {
      kind: 'cells',
      band: 'peripheral',
      cells: [
        { id: 'reels' },
        { id: 'hopper' },
        { id: 'coinmech' },
      ],
    },
  ],
  edges: [
    { from: 'lamps', to: 'mux', kind: 'control' },
    { from: 'switches', to: 'mux', kind: 'control' },
    { from: 'sevenseg', to: 'mux', kind: 'control' },
    { from: 'meters', to: 'mux', kind: 'control' },
    { from: 'coins', to: 'optos', kind: 'control' },
    { from: 'mux', to: 'bus-data', kind: 'data' },
    { from: 'optos', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'upd', to: 'bus-data', kind: 'data' },
    { from: 'pot', to: 'bus-ctrl', kind: 'control' },
    { from: 'alpha', to: 'bus-ctrl', kind: 'control' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'duart', to: 'bus-data', kind: 'data' },
    { from: 'ppi', to: 'bus-data', kind: 'data' },
    { from: 'ump', to: 'bus-ctrl', kind: 'control' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
    { from: 'periph-rail', to: 'hopper', kind: 'control' },
    { from: 'periph-rail', to: 'coinmech', kind: 'control' },
  ],
});
