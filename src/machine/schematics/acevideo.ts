import type { Schematic } from '../schematic';
import { plot } from './plot';

export const ACEVIDEO_SCHEMATIC: Schematic = plot({
  system: 'ACEVIDEO',
  title: 'ACE VIDEO',
  source: 'Ace Video - Z80 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
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
        { id: 'video', span: 1.4 },
        { id: 'gfx' },
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
  ],
  edges: [
    { from: 'switches', to: 'bus-data', kind: 'control' },
    { from: 'coins', to: 'switches', kind: 'control' },
    { from: 'lamps', to: 'bus-data', kind: 'control' },
    { from: 'meters', to: 'bus-data', kind: 'control' },
    { from: 'triacs', to: 'bus-data', kind: 'control' },
    { from: 'video', to: 'bus-data', kind: 'data' },
    { from: 'video', to: 'bus-addr', kind: 'address' },
    { from: 'gfx', to: 'video', kind: 'data' },
    { from: 'speaker', to: 'bus-data', kind: 'control' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
  ],
});
