import type { Schematic } from '../schematic';
import { plot } from './plot';

export const M1VIDEO_SCHEMATIC: Schematic = plot({
  system: 'M1VIDEO',
  title: 'M1 VIDEO',
  source: 'Maygay M1 Video - 68000 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
        { id: 'meters' },
        { id: 'triacs' },
        { id: 'switches' },
        { id: 'reels' },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'video', span: 1.3 },
        { id: 'kbd' },
        { id: 'pia' },
        { id: 'duart' },
        { id: 'slave' },
        { id: 'upd' },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'rom', span: 1.4 },
        { id: 'ram', span: 1.1 },
        { id: 'opll' },
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
    { from: 'kbd', to: 'bus-data', kind: 'data' },
    { from: 'lamps', to: 'kbd', kind: 'control' },
    { from: 'switches', to: 'kbd', kind: 'control' },
    { from: 'pia', to: 'bus-data', kind: 'data' },
    { from: 'meters', to: 'pia', kind: 'control' },
    { from: 'duart', to: 'bus-data', kind: 'data' },
    { from: 'triacs', to: 'duart', kind: 'control' },
    { from: 'slave', to: 'duart', kind: 'data' },
    { from: 'reels', to: 'slave', kind: 'control' },
    { from: 'upd', to: 'slave', kind: 'control' },
    { from: 'video', to: 'bus-data', kind: 'data' },
    { from: 'video', to: 'bus-addr', kind: 'address' },
    { from: 'opll', to: 'bus-data', kind: 'control' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
  ],
});
