import type { Schematic } from '../schematic';
import { plot } from './plot';

export const EPOCH_SCHEMATIC: Schematic = plot({
  system: 'EPOCH',
  title: 'Maygay Epoch',
  source: 'Maygay Epoch - H8/3002 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [{ id: 'lamps' }, { id: 'leds' }, { id: 'switches' }, { id: 'coins' }],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [{ id: 'mux', span: 5 }, { id: 'psu' }],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'ram', span: 1.3 },
        { id: 'rom', span: 1.5 },
        { id: 'pic', span: 1.3 },
        { id: 'ymz', span: 1.2 },
        { id: 'alpha', span: 1.3 },
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
        { id: 'cpu', span: 2.4 },
        { id: 'asic', span: 2 },
        { id: 'sci', span: 1.4 },
        { id: 'ports', span: 1.4 },
      ],
    },
    { kind: 'rail', id: 'periph-rail', label: 'CABINET LOOM', rail: 'serial' },
    {
      kind: 'cells',
      band: 'peripheral',
      cells: [{ id: 'reels' }, { id: 'hopper' }, { id: 'coinmech' }],
    },
  ],
  edges: [
    { from: 'lamps', to: 'mux', kind: 'control' },
    { from: 'leds', to: 'mux', kind: 'control' },
    { from: 'switches', to: 'mux', kind: 'control' },
    { from: 'coins', to: 'mux', kind: 'control' },
    { from: 'mux', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'pic', to: 'bus-ctrl', kind: 'control' },
    { from: 'ymz', to: 'bus-data', kind: 'data' },
    { from: 'alpha', to: 'bus-ctrl', kind: 'control' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'asic', to: 'bus-data', kind: 'data' },
    { from: 'asic', to: 'bus-ctrl', kind: 'control' },
    { from: 'sci', to: 'bus-data', kind: 'data' },
    { from: 'ports', to: 'bus-data', kind: 'data' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
    { from: 'periph-rail', to: 'hopper', kind: 'control' },
    { from: 'periph-rail', to: 'coinmech', kind: 'control' },
  ],
});
