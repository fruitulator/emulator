import type { Schematic } from '../schematic';
import { plot } from './plot';

export const PLUTO5_SCHEMATIC: Schematic = plot({
  system: 'PLUTO5',
  title: 'PLUTO 5',
  source: 'Heber Pluto 5 - MC68340 - simplified board diagram',
  rows: [
    {
      kind: 'cells',
      band: 'edge',
      cells: [
        { id: 'lamps' },
        { id: 'leds' },
        { id: 'alpha' },
        { id: 'switches' },
        { id: 'coins' },
        { id: 'sec' },
      ],
    },
    {
      kind: 'cells',
      band: 'io',
      cells: [
        { id: 'fpga', span: 4.5 },
        { id: 'duarts', span: 1.5 },
      ],
    },
    {
      kind: 'cells',
      band: 'core',
      cells: [
        { id: 'ram', span: 1.2 },
        { id: 'rom', span: 1.6 },
        { id: 'eeprom', span: 1.2 },
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
        { id: 'sim', span: 1.6 },
      ],
    },
    { kind: 'rail', id: 'periph-rail', label: 'CABINET LOOM', rail: 'serial' },
    {
      kind: 'cells',
      band: 'peripheral',
      cells: [
        { id: 'reels' },
        { id: 'hopper' },
        { id: 'datapak' },
        { id: 'sound' },
      ],
    },
  ],
  edges: [
    { from: 'lamps', to: 'fpga', kind: 'control' },
    { from: 'leds', to: 'fpga', kind: 'control' },
    { from: 'alpha', to: 'fpga', kind: 'serial' },
    { from: 'switches', to: 'fpga', kind: 'control' },
    { from: 'coins', to: 'fpga', kind: 'control' },
    { from: 'sec', to: 'fpga', kind: 'serial' },
    { from: 'fpga', to: 'bus-data', kind: 'data' },
    { from: 'fpga', to: 'bus-addr', kind: 'address' },
    { from: 'duarts', to: 'bus-data', kind: 'data' },
    { from: 'duarts', to: 'bus-addr', kind: 'address' },
    { from: 'ram', to: 'bus-data', kind: 'data' },
    { from: 'ram', to: 'bus-addr', kind: 'address' },
    { from: 'rom', to: 'bus-data', kind: 'data' },
    { from: 'rom', to: 'bus-addr', kind: 'address' },
    { from: 'eeprom', to: 'sim', kind: 'serial' },
    { from: 'cpu', to: 'bus-data', kind: 'data' },
    { from: 'cpu', to: 'bus-addr', kind: 'address' },
    { from: 'cpu', to: 'bus-ctrl', kind: 'control' },
    { from: 'sim', to: 'bus-ctrl', kind: 'control' },
    { from: 'periph-rail', to: 'reels', kind: 'control' },
    { from: 'periph-rail', to: 'hopper', kind: 'control' },
    { from: 'sim', to: 'datapak', kind: 'serial' },
    { from: 'sim', to: 'sound', kind: 'data' },
  ],
});
