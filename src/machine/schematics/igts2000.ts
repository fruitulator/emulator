import type { Schematic } from '../schematic';
import { plot } from './plot';

export const IGTS2000_SCHEMATIC: Schematic = plot({
  system: 'IGTS2000',
  title: 'IGT S2000',
  source: 'IGT S2000 - i960 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
        { id: 'sevenseg' },
        { id: 'switches' },
        { id: 'reels' },
        { id: 'meters' },
        { id: 'hopper' },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'quart1' },
        { id: 'quart2' },
        { id: 'vfdcpu' },
        { id: 'vfd', span: 1.2 },
        { id: 'ay' },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'rom', span: 1.3 },
        { id: 'ram', span: 1.1 },
        { id: 'eeprom' },
        { id: 'rtc' },
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
      cells: [{ id: 'cpu', span: 1.3 }],
    },
  ],
  edges: [
    { from: 'lamps', to: 'bus-data', kind: 'control' },
    { from: 'sevenseg', to: 'bus-data', kind: 'control' },
    { from: 'switches', to: 'quart1', kind: 'control' },
    { from: 'reels', to: 'bus-data', kind: 'control' },
    { from: 'meters', to: 'bus-data', kind: 'control' },
    { from: 'hopper', to: 'bus-data', kind: 'control' },
    { from: 'quart1', to: 'bus-data', kind: 'data' },
    { from: 'quart2', to: 'bus-data', kind: 'data' },
    { from: 'quart2', to: 'vfdcpu', kind: 'data' },
    { from: 'vfdcpu', to: 'vfd', kind: 'data' },
    { from: 'ay', to: 'bus-data', kind: 'control' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'eeprom', to: 'bus-data', kind: 'data' },
    { from: 'rtc', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
  ],
});
