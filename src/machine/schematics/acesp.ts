import type { Schematic } from '../schematic';
import { plot } from './plot';

export const ACESP_SCHEMATIC: Schematic = plot({
  system: 'SPACE',
  title: 'ACE sp.ACE',
  source: 'ACE sp.ACE - HD6303Y - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
        { id: 'switches' },
        { id: 'dots' },
        { id: 'sevenseg' },
        { id: 'coins' },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'lamplatch', span: 2 },
        { id: 'shift', span: 2.4 },
        { id: 'pia', span: 1.4 },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'intram', span: 1.1 },
        { id: 'ram', span: 1.1 },
        { id: 'rom', span: 1.4 },
        { id: 'watchdog', span: 0.9 },
        { id: 'sndport', span: 1.4 },
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
        { id: 'timers', span: 1.5 },
        { id: 'sci', span: 1.7 },
        { id: 'ports', span: 1.5 },
      ],
    },
    { kind: 'rail', id: 'periph-rail', label: 'CABINET LOOM', rail: 'serial' },
    {
      kind: 'cells',
      band: 'peripheral',
      cells: [
        { id: 'reelctrl' },
        { id: 'reels' },
        { id: 'coinmech' },
        { id: 'oki' },
      ],
    },
  ],
  edges: [
    { from: 'lamps', to: 'lamplatch', kind: 'control' },
    { from: 'switches', to: 'shift', kind: 'control' },
    { from: 'dots', to: 'bus-data', kind: 'data' },
    { from: 'sevenseg', to: 'bus-data', kind: 'data' },
    { from: 'coins', to: 'shift', kind: 'control' },
    { from: 'lamplatch', to: 'bus-data', kind: 'data' },
    { from: 'shift', to: 'bus-data', kind: 'data' },
    { from: 'pia', to: 'bus-data', kind: 'data' },
    { from: 'intram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'watchdog', to: 'bus-ctrl', kind: 'control' },
    { from: 'sndport', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'timers', to: 'bus-ctrl', kind: 'control' },
    { from: 'sci', to: 'bus-data', kind: 'data' },
    { from: 'ports', to: 'bus-data', kind: 'data' },
    { from: 'periph-rail', to: 'reelctrl', kind: 'control' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
    { from: 'periph-rail', to: 'coinmech', kind: 'control' },
    { from: 'periph-rail', to: 'oki', kind: 'control' },
  ],
});
