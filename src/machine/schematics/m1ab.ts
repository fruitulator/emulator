import type { Schematic } from '../schematic';
import { plot } from './plot';

export const M1AB_SCHEMATIC: Schematic = plot({
  system: 'M1AB',
  title: 'Maygay M1A/B',
  source: 'Maygay M1A/B - MC6809 - simplified board diagram',
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
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'kbd', span: 1.4 },
        { id: 'kbd2', span: 1.4 },
        { id: 'mcu', span: 1.2 },
        { id: 'latch', span: 1.8 },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'ram', span: 1.1 },
        { id: 'rom', span: 1.4 },
        { id: 'ay', span: 1 },
        { id: 'opll', span: 1 },
        { id: 'oki', span: 1.1 },
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
        { id: 'pia', span: 1.5 },
        { id: 'psu', span: 1.5 },
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
    { from: 'lamps', to: 'kbd', kind: 'control' },
    { from: 'switches', to: 'kbd', kind: 'control' },
    { from: 'meters', to: 'kbd2', kind: 'control' },
    { from: 'coins', to: 'latch', kind: 'control' },
    { from: 'kbd', to: 'bus-data', kind: 'data' },
    { from: 'kbd2', to: 'bus-data', kind: 'data' },
    { from: 'mcu', to: 'bus-data', kind: 'data' },
    { from: 'latch', to: 'bus-ctrl', kind: 'control' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'ay', to: 'bus-data', kind: 'data' },
    { from: 'opll', to: 'bus-data', kind: 'data' },
    { from: 'oki', to: 'bus-data', kind: 'data' },
    { from: 'alpha', to: 'bus-ctrl', kind: 'control' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'duart', to: 'bus-data', kind: 'data' },
    { from: 'pia', to: 'bus-data', kind: 'data' },
    { from: 'psu', to: 'bus-ctrl', kind: 'control' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
    { from: 'periph-rail', to: 'hopper', kind: 'control' },
    { from: 'periph-rail', to: 'coinmech', kind: 'control' },
  ],
});
