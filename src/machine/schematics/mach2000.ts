import type { Schematic } from '../schematic';
import { plot } from './plot';

export const MACH2000E_SCHEMATIC: Schematic = plot({
  system: 'MACH2000E',
  title: 'MACH 2000',
  source: 'Castle Mach 2000 V1 rev E - two 6303Y - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
        { id: 'switches' },
        { id: 'reels' },
        { id: 'meters' },
        { id: 'triacs' },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'pia' },
        { id: 'dots', span: 1.3 },
        { id: 'ay' },
        { id: 'rtc' },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'rom', span: 1.4 },
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
      cells: [{ id: 'cpu', span: 1.1 }, { id: 'slave', span: 1.1 }],
    },
  ],
  edges: [
    { from: 'lamps', to: 'pia', kind: 'control' },
    { from: 'switches', to: 'pia', kind: 'control' },
    { from: 'reels', to: 'slave', kind: 'control' },
    { from: 'meters', to: 'bus-data', kind: 'control' },
    { from: 'triacs', to: 'bus-data', kind: 'control' },
    { from: 'pia', to: 'bus-data', kind: 'data' },
    { from: 'dots', to: 'bus-data', kind: 'data' },
    { from: 'ay', to: 'bus-data', kind: 'control' },
    { from: 'rtc', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'slave', to: 'bus-data', kind: 'data' },
    { from: 'slave', to: 'cpu', kind: 'control' },
  ],
});
