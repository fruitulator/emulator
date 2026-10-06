
import type { SwitchControl } from '../src/layout/fmlconfig';
import { str } from './i18n';

export interface CoinButton {
  label: string;
  bit: number;
}

export const COINS: CoinButton[] = [
  { label: '£1', bit: 0 },
  { label: str('inputs.50p'), bit: 1 },
  { label: str('inputs.20p'), bit: 2 },
  { label: str('inputs.10p'), bit: 3 },
  { label: str('inputs.5p'), bit: 5 },
];

export interface NamedInput {
  label: string;
  strobe: number;
  bit: number;
  toggle?: boolean;
  invert?: boolean;
  control?: SwitchControl;
}

export const NAMED_INPUTS: NamedInput[] = [
  { label: str('inputs.main_door'), strobe: 18, bit: 0, toggle: true, control: 'Service' },
  { label: str('inputs.cashbox_door'), strobe: 4, bit: 0, toggle: true, control: 'Cash' },
];

export interface PlayButton {
  label: string;
  strobe: number;
  bit: number;
  certain?: boolean;
  lamp?: number;
}

export const PLAY_BUTTONS: PlayButton[] = [
  { label: str('inputs.cancel'), strobe: 1, bit: 0, lamp: 0 },
  { label: str('inputs.hold_nudge_1'), strobe: 1, bit: 1, lamp: 1 },
  { label: str('inputs.hold_nudge_2'), strobe: 1, bit: 2, lamp: 2 },
  { label: str('inputs.hold_nudge_3'), strobe: 1, bit: 3, lamp: 3 },
  { label: str('inputs.collect'), strobe: 1, bit: 4, lamp: 4 },
  { label: str('inputs.btn_17'), strobe: 2, bit: 1, lamp: 6 },
  { label: str('inputs.start_gamble'), strobe: 2, bit: 2, certain: true, lamp: 7 },
  { label: str('inputs.take_bonus'), strobe: 8, bit: 0 },
  { label: str('inputs.take_cash'), strobe: 8, bit: 1 },
  { label: str('inputs.take_feature'), strobe: 8, bit: 2 },
];
