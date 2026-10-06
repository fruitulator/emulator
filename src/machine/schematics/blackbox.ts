import type { Schematic } from '../schematic';
import { plot } from './plot';

export const BLACKBOX_SCHEMATIC: Schematic = plot({
  system: 'BLACKBOX',
  title: 'BFM BLACK BOX',
  source: 'BFM Black Box - MC6802 - simplified board diagram',
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
        { id: 'pia' },
        { id: 'acia' },
        { id: 'nvram' },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'rom', span: 1.5 },
        { id: 'tone', span: 1.1 },
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
    { from: 'lamps', to: 'pia', kind: 'control' },
    { from: 'sevenseg', to: 'pia', kind: 'control' },
    { from: 'meters', to: 'pia', kind: 'control' },
    { from: 'switches', to: 'bus-data', kind: 'control' },
    { from: 'coins', to: 'bus-data', kind: 'control' },
    { from: 'nvram', to: 'pia', kind: 'data' },
    { from: 'pia', to: 'bus-data', kind: 'data' },
    { from: 'pia', to: 'bus-addr', kind: 'address' },
    { from: 'acia', to: 'bus-data', kind: 'data' },
    { from: 'acia', to: 'bus-addr', kind: 'address' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'tone', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
  ],
});
