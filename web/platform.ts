import { COINS, NAMED_INPUTS, PLAY_BUTTONS, type CoinButton, type NamedInput, type PlayButton } from './inputs';
import { COIN_NOTES, PARALLEL_NOTE_CHANNELS } from '../src/machine/layoutcoins';
import type { CoinChute, CoinPortLines } from '../src/machine/machine';
import { COIN_RAW } from '../src/machine/coinraw';

export interface PlatformView {
  coins: CoinButton[];
  namedInputs: NamedInput[];
  playButtons: PlayButton[];
  matrix: { strobes: number; bits: number };
  coinBit: number;
  tokenBit: number;
  nonSwitchInputs?: readonly number[];
  acceptorLineIsButton?: boolean;
  acceptorLineIsNote?: boolean;
  coinRegister?: {
    maskRow: number;
    lineOfBit: Readonly<Record<number, readonly (number | null)[]>>;
    tokenNote: number;
    tokenLine: number;
    directRows?: readonly number[];
  };
  acceptorByChute?: boolean;
  acceptorCoinPort?: { row: number };
  acceptorNoteChute?: boolean;
  serialAcceptor?: {
    coinChannel?: readonly (number | null)[];
    note?: boolean;
    parallelNote?: boolean;
  };
  inputNames?: Readonly<Record<number, string>>;
  unread?: boolean;
}

const scorpion4: PlatformView = {
  coins: COINS,
  namedInputs: NAMED_INPUTS,
  playButtons: PLAY_BUTTONS,
  matrix: { strobes: 21, bits: 5 },
  coinBit: 0,
  tokenBit: 0,
  coinRegister: { maskRow: 12, lineOfBit: { 12: [0, 1, 2, 3, null, 5, -1, -1] }, tokenNote: -1, tokenLine: -1 },
  acceptorCoinPort: { row: 12 },
  serialAcceptor: {
    coinChannel: [null, null, null, null, null, null, null, null],
    note: true,
    parallelNote: true,
  },
};

const mpu4: PlatformView = {
  coins: [
    { label: '£1', bit: 3 },
    { label: '50p', bit: 2 },
    { label: '20p', bit: 1 },
    { label: '10p', bit: 0 },
  ],
  namedInputs: [
    { label: 'Refill key', strobe: 2, bit: 6, toggle: true, control: 'Refill' },
    { label: 'Cashbox door', strobe: 2, bit: 7, toggle: true, control: 'Cash' },
    { label: 'Test button', strobe: 2, bit: 5, control: 'Test' },
  ],
  playButtons: [
    { label: 'Cancel', strobe: 3, bit: 0, certain: true },
    { label: 'Hold D', strobe: 3, bit: 1, certain: true },
    { label: 'Hold C', strobe: 3, bit: 2, certain: true },
    { label: 'Hold B', strobe: 3, bit: 3, certain: true },
    { label: 'Hold A', strobe: 3, bit: 4, certain: true },
    { label: 'Start', strobe: 3, bit: 7, certain: true },
  ],
  matrix: { strobes: 8, bits: 8 },
  coinBit: 3,
  tokenBit: 3,
  coinRegister: { maskRow: 5, lineOfBit: { 5: [-1, -1, 5, 4, 0, 1, 2, 3] }, tokenNote: 0x39, tokenLine: 4 },
  acceptorCoinPort: { row: 5 },
  nonSwitchInputs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 44, 45, 46, 47],
  inputNames: {
    0: '20p level sensor', 1: '100p level sensor',
    2: 'Token level 1', 3: 'Token level 2',
  },
};

const scorpion2: PlatformView = {
  coins: [
    { label: '10p', bit: 0 },
    { label: '20p', bit: 1 },
    { label: '50p', bit: 2 },
    { label: '£1', bit: 3 },
    { label: 'Token', bit: 4 },
  ],
  namedInputs: [
    { label: 'Front door', strobe: 3, bit: 1, toggle: true, control: 'Service' },
    { label: 'Cashbox door', strobe: 3, bit: 0, toggle: true, invert: true, control: 'Cash' },
    { label: 'Refill key', strobe: 3, bit: 2, toggle: true, control: 'Refill' },
    { label: 'Test button', strobe: 9, bit: 0, control: 'Test' },
  ],
  playButtons: [
    { label: 'Cancel', strobe: 1, bit: 0 },
    { label: 'Hold 1', strobe: 1, bit: 1 },
    { label: 'Hold 2/Hi', strobe: 1, bit: 2 },
    { label: 'Hold 3/Lo', strobe: 1, bit: 3 },
    { label: 'Stop/Collect', strobe: 1, bit: 4 },
    { label: 'Exchange', strobe: 2, bit: 0 },
    { label: 'Start', strobe: 2, bit: 2 },
  ],
  matrix: { strobes: 12, bits: 5 },
  coinBit: 3,
  tokenBit: 4,
  coinRegister: { maskRow: 10, lineOfBit: { 10: [0, 1, 2, 3, 4, -1, -1, -1] }, tokenNote: -1, tokenLine: -1 },
};

const impact: PlatformView = {
  coins: [
    { label: '£1', bit: 0 },
    { label: '50p', bit: 1 },
    { label: '20p', bit: 2 },
    { label: '10p', bit: 3 },
    { label: '20p token', bit: 4 },
    { label: '5p', bit: 5 },
  ],
  namedInputs: [
    { label: 'Back door', strobe: 4, bit: 0, toggle: true, control: 'Service' },
    { label: 'Hopper dump', strobe: 7, bit: 2, toggle: true },
    { label: 'Refill key', strobe: 7, bit: 3, toggle: true, control: 'Refill' },
    { label: 'Cash/Token', strobe: 7, bit: 4, toggle: true },
    { label: 'Cashbox door', strobe: 7, bit: 5, toggle: true, control: 'Cash' },
    { label: 'Test/Demo', strobe: 19, bit: 0, control: 'Test' },
  ],
  playButtons: [
    { label: 'Start', strobe: 5, bit: 0, lamp: 192 },
    { label: 'Exchange', strobe: 5, bit: 1, lamp: 194 },
    { label: 'Collect', strobe: 5, bit: 2, lamp: 195 },
    { label: 'Nudge 3', strobe: 5, bit: 3, lamp: 208 },
    { label: 'Nudge 2', strobe: 5, bit: 4, lamp: 210 },
    { label: 'Nudge 1', strobe: 5, bit: 5, lamp: 224 },
    { label: 'Cancel', strobe: 5, bit: 6, lamp: 225 },
  ],
  matrix: { strobes: 10, bits: 8 },
  coinBit: 0,
  tokenBit: 4,
  acceptorByChute: true,
  coinRegister: { maskRow: 9, lineOfBit: { 9: [0, 1, 2, 3, 4, 5, -1, -1] }, tokenNote: -1, tokenLine: -1 },
  serialAcceptor: { parallelNote: true },
};

const space: PlatformView = {
  coins: [
    { label: '£1', bit: 3 },
    { label: '50p', bit: 2 },
    { label: '20p', bit: 1 },
    { label: '10p', bit: 0 },
    { label: 'Token', bit: 4 },
  ],
  namedInputs: [],
  playButtons: [
    { label: 'Cancel/Collect', strobe: 1, bit: 6, certain: true },
    { label: 'Hold 1', strobe: 1, bit: 3 },
    { label: 'Hold 2', strobe: 1, bit: 4 },
    { label: 'Hold 3', strobe: 1, bit: 5 },
    { label: 'Start', strobe: 1, bit: 0, certain: true },
  ],
  matrix: { strobes: 8, bits: 8 },
  coinBit: 3,
  tokenBit: 4,
  coinRegister: { maskRow: -1, lineOfBit: { 4: [-1, -1, -1, 4, 0, 1, 2, 3] }, tokenNote: -1, tokenLine: -1 },
};

const m1ab: PlatformView = {
  coins: [
    { label: '£1', bit: 3 },
    { label: '50p', bit: 2 },
    { label: '20p', bit: 1 },
    { label: '10p', bit: 0 },
    { label: '20p token', bit: 4 },
  ],
  namedInputs: [
    { label: 'Refill key', strobe: 3, bit: 1, toggle: true, control: 'Refill' },
    { label: 'Cashbox door', strobe: 4, bit: 7, toggle: true, control: 'Cash' },
    { label: 'Test button', strobe: 1, bit: 0, control: 'Test' },
  ],
  playButtons: [
    { label: 'Cancel', strobe: 5, bit: 0, certain: true },
    { label: 'Hold', strobe: 5, bit: 1, certain: true },
    { label: 'Hold Hi', strobe: 5, bit: 2, certain: true },
    { label: 'Hold Lo', strobe: 5, bit: 3, certain: true },
    { label: 'Collect', strobe: 5, bit: 5, certain: true },
    { label: 'Exchange', strobe: 5, bit: 6, certain: true },
    { label: 'Start', strobe: 5, bit: 7, certain: true },
  ],
  matrix: { strobes: 8, bits: 8 },
  coinBit: 3,
  tokenBit: 4,
  coinRegister: { maskRow: 0, lineOfBit: { 0: [0, 1, 2, 3, 4, 5, 6, 7] }, tokenNote: 0x40, tokenLine: 4 },
  acceptorNoteChute: true,
};

const mpu5: PlatformView = {
  coins: [
    { label: '£1', bit: 4 },
    { label: '50p', bit: 3 },
    { label: '20p', bit: 2 },
    { label: '10p', bit: 1 },
    { label: '5p', bit: 0 },
  ],
  namedInputs: [],
  playButtons: [
    { label: 'Cancel', strobe: 4, bit: 7 },
    { label: 'Hold A', strobe: 4, bit: 6 },
    { label: 'Hold B', strobe: 4, bit: 5 },
    { label: 'Hold C', strobe: 4, bit: 4 },
    { label: 'Collect', strobe: 4, bit: 2 },
    { label: 'Exchange', strobe: 4, bit: 1 },
    { label: 'Start/Gamble', strobe: 4, bit: 0 },
    { label: 'Take Nudge', strobe: 5, bit: 6 },
    { label: 'Take Bonus', strobe: 5, bit: 7 },
  ],
  matrix: { strobes: 6, bits: 8 },
  coinBit: 4,
  tokenBit: 4,
  serialAcceptor: { coinChannel: [4, 3, 2, 1, 6, 5, 0, null], note: true },
  acceptorCoinPort: { row: 10 },
};

const scorpion5: PlatformView = {
  coins: [
    { label: '£2', bit: 6 },
    { label: '£1', bit: 1 },
    { label: '50p', bit: 2 },
    { label: '20p', bit: 3 },
    { label: '10p', bit: 4 },
    { label: '5p', bit: 7 },
  ],
  namedInputs: [],
  playButtons: [],
  matrix: { strobes: 32, bits: 5 },
  coinBit: 1,
  tokenBit: 1,
  serialAcceptor: { coinChannel: [1, 2, 3, 4, 5, 6, 7, 8], note: true },
};

const epoch: PlatformView = {
  coins: [
    { label: '£2', bit: 6 },
    { label: '£1', bit: 0 },
    { label: '50p', bit: 1 },
    { label: '20p', bit: 2 },
    { label: '10p', bit: 3 },
    { label: '5p', bit: 4 },
  ],
  namedInputs: [
    { label: 'Main door', strobe: 3, bit: 0, toggle: true, invert: true, control: 'Service' },
    { label: 'Cashbox door', strobe: 4, bit: 7, toggle: true, invert: true, control: 'Cash' },
    { label: 'Refill key', strobe: 4, bit: 5, toggle: true, control: 'Refill' },
    { label: 'Hopper high', strobe: 6, bit: 3, toggle: true },
    { label: 'Hopper low', strobe: 6, bit: 2, toggle: true },
    { label: 'Hopper verify', strobe: 6, bit: 0, toggle: true },
    { label: 'Refloat', strobe: 3, bit: 6, toggle: true, control: 'Top Up' },
    { label: 'Defloat', strobe: 4, bit: 4, toggle: true },
    { label: 'Test', strobe: 3, bit: 7, control: 'Test' },
  ],
  playButtons: [
    { label: 'Hold 1', strobe: 0, bit: 1 },
    { label: 'Hold 2', strobe: 0, bit: 2 },
    { label: 'Hold 3', strobe: 0, bit: 3 },
    { label: 'Collect', strobe: 0, bit: 4 },
    { label: 'Exchange', strobe: 0, bit: 5 },
    { label: 'Start', strobe: 0, bit: 6 },
    { label: 'Nudge sw.', strobe: 1, bit: 0 },
    { label: 'Cash sw.', strobe: 1, bit: 1 },
    { label: 'Knock sw.', strobe: 1, bit: 2 },
    { label: 'Feature sw.', strobe: 1, bit: 3 },
  ],
  matrix: { strobes: 8, bits: 8 },
  acceptorByChute: true,
  coinBit: 0,
  tokenBit: 5,
};

const scorpion1: PlatformView = {
  coins: [
    { label: '10p', bit: 0 },
    { label: '20p', bit: 1 },
    { label: '50p', bit: 2 },
    { label: '£1', bit: 3 },
    { label: 'Token', bit: 4 },
  ],
  namedInputs: [
    { label: 'Cashbox door', strobe: 2, bit: 2, toggle: true, invert: true },
    { label: 'Refill key', strobe: 2, bit: 3, toggle: true },
    { label: 'Front door', strobe: 2, bit: 4, toggle: true },
    { label: 'Test button', strobe: 0, bit: 5, control: 'Test' },
  ],
  playButtons: [
    { label: 'Cancel', strobe: 1, bit: 0 },
    { label: 'Hold 1', strobe: 1, bit: 1 },
    { label: 'Hold 2', strobe: 1, bit: 2 },
    { label: 'Hold 3', strobe: 1, bit: 3 },
    { label: 'Hold 4', strobe: 1, bit: 4 },
    { label: 'Exchange', strobe: 1, bit: 5 },
    { label: 'Start', strobe: 2, bit: 1 },
    { label: 'Green Test', strobe: 0, bit: 5 },
  ],
  matrix: { strobes: 8, bits: 8 },
  coinBit: 3,
  tokenBit: 4,
  coinRegister: {
    maskRow: 0,
    lineOfBit: { 0: [0, 1, 2, 3, 4, -1, -1, -1], 8: [8, 9, 10, 11, 12, 13, 14, 15] },
    tokenNote: -1,
    tokenLine: -1,
    directRows: [8],
  },
};

const sys5: PlatformView = {
  coins: [
    { label: '10p', bit: 10 },
    { label: '20p', bit: 11 },
    { label: '50p', bit: 12 },
    { label: '£1', bit: 13 },
    { label: '20p TOKEN', bit: 14 },
  ],
  namedInputs: [],
  playButtons: [],
  matrix: { strobes: 5, bits: 16 },
  coinBit: 13,
  tokenBit: 14,
  coinRegister: { maskRow: 7, lineOfBit: { 7: [-1, -1, 10, 11, 12, 13, 14, -1] }, tokenNote: -1, tokenLine: -1 },
};

const sys85: PlatformView = {
  coins: [
    { label: '10p', bit: 0 },
    { label: '20p', bit: 1 },
    { label: '50p', bit: 2 },
    { label: '£1', bit: 3 },
    { label: 'Token', bit: 4 },
  ],
  namedInputs: [
    { label: 'Test button', strobe: 0, bit: 5, control: 'Test' },
  ],
  playButtons: [],
  matrix: { strobes: 8, bits: 8 },
  coinBit: 3,
  tokenBit: 4,
  coinRegister: { maskRow: 0, lineOfBit: { 0: [0, 1, 2, 3, 4, -1, -1, -1] }, tokenNote: -1, tokenLine: -1 },
};

const mps2: PlatformView = {
  coins: [
    { label: '£1', bit: 20 },
    { label: '50p', bit: 21 },
    { label: '20p', bit: 22 },
    { label: '10p', bit: 23 },
    { label: '20p token', bit: 19 },
  ],
  namedInputs: [
    { label: 'Refill key', strobe: 2, bit: 2, toggle: true },
    { label: 'Cash door', strobe: 2, bit: 1, toggle: true },
    { label: 'Backdoor', strobe: 0, bit: 0, toggle: true },
  ],
  playButtons: [
    { label: 'Start / Take', strobe: 0, bit: 3, certain: true },
    { label: 'Hold 1', strobe: 0, bit: 4 },
    { label: 'Hold 2', strobe: 0, bit: 5 },
    { label: 'Hold 3', strobe: 0, bit: 6 },
    { label: 'Nudge up', strobe: 1, bit: 0 },
    { label: 'Feature stop', strobe: 1, bit: 1 },
    { label: 'Gamble', strobe: 1, bit: 2 },
    { label: 'Cancel', strobe: 1, bit: 3 },
    { label: 'Nudgematic', strobe: 1, bit: 4 },
  ],
  matrix: { strobes: 4, bits: 8 },
  coinBit: 20,
  tokenBit: 19,
  acceptorLineIsButton: true,
  coinRegister: { maskRow: 2, lineOfBit: { 2: [-1, null, null, 19, 20, 21, 22, 23] }, tokenNote: -1, tokenLine: -1 },
  nonSwitchInputs: [0, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
  inputNames: {
    0: 'BACKDOOR', 3: 'START/TAKE', 4: 'HOLD 1', 5: 'HOLD 2', 6: 'HOLD 3',
    8: 'NUDGE UP', 9: 'FEATURE STOP', 10: 'GAMBLE', 11: 'CANCEL',
    12: 'NUDGEMATIC', 17: 'CASH DOOR', 18: 'REFILL KEY',
    19: '20P TOKEN IN', 20: '£1 IN', 21: '50P IN', 22: '20P IN', 23: '10P IN',
    24: '10P LEVEL', 25: '50P LEVEL', 26: '20P TOKEN LEVEL',
  },
};

const sys80: PlatformView = {
  coins: [
    { label: '50p', bit: 22 },
    { label: '20p', bit: 21 },
    { label: '20p (right)', bit: 19 },
    { label: '10p', bit: 20 },
  ],
  namedInputs: [
    { label: 'Refill key', strobe: 3, bit: 0, toggle: true, control: 'Refill' },
    { label: 'Back door', strobe: 3, bit: 1, toggle: true, control: 'Service' },
    { label: 'Test', strobe: 2, bit: 0, toggle: true, control: 'Test' },
  ],
  playButtons: [],
  matrix: { strobes: 4, bits: 8 },
  coinBit: 22,
  tokenBit: -1,
  acceptorLineIsButton: true,
  nonSwitchInputs: [0, 1, 2, 3, 5, 16, 19, 20, 21, 22, 23, 24, 25],
  inputNames: {
    0: 'REEL 1 OPTO', 1: 'REEL 2 OPTO', 2: 'REEL 3 OPTO', 3: 'REEL 4 OPTO',
    16: 'TEST', 19: '20P IN (RIGHT)', 20: '10P IN', 21: '20P IN', 22: '50P IN',
    23: '10P LEVEL', 24: 'REFILL KEY', 25: 'BACK DOOR',
  },
};

const astra: PlatformView = {
  coins: [
    { label: 'Coin id 5 (layout)', bit: 5 },
    { label: 'Coin id 0', bit: 0 },
    { label: 'Coin id 1', bit: 1 },
    { label: 'Coin id 2', bit: 2 },
    { label: 'Coin id 3', bit: 3 },
    { label: 'Coin id 4', bit: 4 },
    { label: 'Coin id 6', bit: 6 },
  ],
  namedInputs: [
    { label: 'Test button', strobe: 2, bit: 5, control: 'Test' },
  ],
  playButtons: [],
  matrix: { strobes: 16, bits: 8 },
  coinBit: 5,
  tokenBit: -1,
  acceptorLineIsNote: true,
};

const sru: PlatformView = {
  coins: [
    { label: 'Coin line 4', bit: 20 },
    { label: 'Coin line 5', bit: 21 },
    { label: 'Coin line 6', bit: 22 },
    { label: 'Coin line 7', bit: 23 },
  ],
  namedInputs: [
    { label: 'Refill key', strobe: 2, bit: 3, toggle: true, control: 'Refill' },
    { label: 'Self test', strobe: 2, bit: 2, toggle: true, control: 'Test' },
  ],
  playButtons: [],
  matrix: { strobes: 5, bits: 8 },
  coinBit: 23,
  tokenBit: -1,
  acceptorLineIsButton: true,
  coinRegister: { maskRow: 2, lineOfBit: { 2: [-1, -1, null, null, 20, 21, 22, 23] }, tokenNote: -1, tokenLine: -1 },
  nonSwitchInputs: [0, 1, 2, 3, 18, 19, 20, 21, 22, 23],
  inputNames: {
    0: 'REEL 1 OPTO', 1: 'REEL 2 OPTO', 2: 'REEL 3 OPTO', 3: 'REEL 4 OPTO',
    18: 'SELF TEST', 19: 'REFILL KEY', 20: 'COIN LINE 4', 21: 'COIN LINE 5',
    22: 'COIN LINE 6', 23: 'COIN LINE 7',
  },
};

const blackbox: PlatformView = {
  coins: [
    { label: 'Coin id 53', bit: 53 },
    { label: 'Coin id 54', bit: 54 },
    { label: 'Coin id 55', bit: 55 },
  ],
  namedInputs: [],
  playButtons: [],
  matrix: { strobes: 8, bits: 8 },
  coinBit: 53,
  tokenBit: -1,
  acceptorLineIsNote: true,
  nonSwitchInputs: [0, 1, 2],
  inputNames: { 0: 'COIN LINE 0', 1: 'COIN LINE 1', 2: 'COIN LINE 2' },
};

const sys1: PlatformView = {
  coins: [
    { label: '£1', bit: 4 },
    { label: '50p', bit: 3 },
    { label: '20p', bit: 0 },
    { label: '10p', bit: 1 },
    { label: 'Line 2 (token?)', bit: 2 },
  ],
  namedInputs: [],
  playButtons: [],
  matrix: { strobes: 7, bits: 8 },
  coinBit: 4,
  tokenBit: 2,
  acceptorLineIsButton: true,
  nonSwitchInputs: [0, 1, 2, 3, 4, 5],
  inputNames: {
    0: '20P IN', 1: '10P IN', 2: 'COIN LINE 2', 3: '50P IN', 4: '£1 IN', 5: 'DOOR',
  },
};

const proconn: PlatformView = {
  coins: [
    { label: '£1', bit: 37 },
    { label: '£2', bit: 38 },
    { label: '50p', bit: 36 },
    { label: '20p', bit: 35 },
    { label: '10p', bit: 34 },
    { label: '5p', bit: 33 },
    { label: 'Line 55 (bit7)', bit: 22 },
    { label: 'Line 54 (bit6)', bit: 21 },
    { label: 'Line 53 (bit5)', bit: 20 },
    { label: 'Line 52 (bit4)', bit: 19 },
  ],
  namedInputs: [
    { label: 'Test button', strobe: 4, bit: 7, control: 'Test' },
  ],
  playButtons: [],
  matrix: { strobes: 13, bits: 8 },
  coinBit: 37,
  tokenBit: -1,
  acceptorLineIsNote: true,
  nonSwitchInputs: [37],
  inputNames: { 37: 'METER SENSE' },
};

const electrocoin: PlatformView = {
  coins: [
    { label: '£1', bit: 4 },
    { label: '50p', bit: 5 },
    { label: '20p', bit: 6 },
    { label: '10p', bit: 7 },
    { label: 'Token', bit: 3 },
  ],
  namedInputs: [
    { label: 'Refill key', strobe: 1, bit: 7, toggle: true, control: 'Refill' },
    { label: 'Cashbox door', strobe: 1, bit: 5, toggle: true, control: 'Cash' },
    { label: 'Back door', strobe: 2, bit: 4, toggle: true, control: 'Service' },
    { label: 'Test button', strobe: 1, bit: 6, control: 'Test' },
  ],
  playButtons: [
    { label: 'Start', strobe: 1, bit: 4, certain: true },
    { label: 'Collect', strobe: 3, bit: 5 },
  ],
  matrix: { strobes: 8, bits: 8 },
  coinBit: 4,
  tokenBit: 3,
  acceptorLineIsButton: true,
  nonSwitchInputs: [3, 4, 5, 6, 7],
  inputNames: { 3: 'TOKEN IN', 4: '£1 IN', 5: '50P IN', 6: '20P IN', 7: '10P IN' },
};

const phoenix: PlatformView = {
  coins: [
    { label: '£1', bit: 0x104 },
    { label: '50p', bit: 0x103 },
    { label: '20p', bit: 0x102 },
    { label: '10p', bit: 0x101 },
    { label: 'Token (line 0)', bit: 0x100 },
  ],
  namedInputs: [],
  playButtons: [],
  matrix: { strobes: 8, bits: 8 },
  coinBit: 0x104,
  tokenBit: 0x100,
  acceptorLineIsNote: true,
  nonSwitchInputs: [0, 1, 2, 3, 4],
};

const mpu3: PlatformView = {
  coins: [],
  namedInputs: [],
  playButtons: [],
  matrix: { strobes: 6, bits: 8 },
  coinBit: -1,
  tokenBit: -1,
  acceptorLineIsNote: true,
};

const mpu4video: PlatformView = { ...mpu4, playButtons: [] };

const VIEWS: Record<string, PlatformView> = {
  ELECTROCOIN: electrocoin,
  PHOENIX: phoenix,
  PHOENIX2: phoenix,
  PROCONN: proconn,
  SYS1: sys1,
  ASTRASYSA1: astra,
  MPS2: mps2,
  SYSTEM80: sys80,
  SRU: sru,
  BLACKBOX: blackbox,
  SYS85: sys85,
  SCORPION1: scorpion1,
  SYS5: sys5,
  SCORPION4: scorpion4,
  SCORPION2: scorpion2,
  MPU4: mpu4,
  IMPACT: impact,
  SPACE: space,
  M1AB: m1ab,
  MPU5: mpu5,
  SCORPION5: scorpion5,
  ADDER5: scorpion5,
  EPOCH: epoch,
  MPU3: mpu3,
  MPU4VIDEO: mpu4video,
};

const unreadBoard: PlatformView = {
  coins: [],
  namedInputs: [],
  playButtons: [],
  matrix: { strobes: 16, bits: 8 },
  coinBit: -1,
  tokenBit: -1,
  unread: true,
};

export function hasView(system: string): boolean {
  return Object.prototype.hasOwnProperty.call(VIEWS, system.toUpperCase());
}

export function viewFor(system: string): PlatformView {
  return VIEWS[system.toUpperCase()] ?? unreadBoard;
}

export function acceptorBit(
  view: AcceptorView,
  lp: { button?: number; acceptor?: { line?: number; token?: boolean; note?: number } },
  chutes?: readonly CoinChute[],
  port?: CoinPortLines,
): number {
  return acceptorResolve(view, lp, chutes, port).line;
}

export type AcceptorView = Pick<PlatformView,
  'coinBit' | 'tokenBit' | 'acceptorLineIsButton' | 'acceptorLineIsNote' |
  'coinRegister' | 'acceptorByChute' | 'serialAcceptor' | 'acceptorCoinPort' | 'acceptorNoteChute'>;

function coinRowMask(note: number, button: number, row: number): number | undefined {
  const direct = (v: number): number | undefined =>
    ((v & 0x78) >> 3) === row ? 1 << (v & 7) : undefined;
  if (note === 0x47) return button >= 0 && button < 128 ? direct(button) : undefined;
  const raw = COIN_RAW[note];
  if (raw === undefined) return undefined;
  return raw & 0x100 ? direct(raw) : raw & 0xff;
}

const CC_NOTE_CHANNEL = new Map<number, number>([[0x1e, 1], [0x1f, 2], [0x20, 3], [0x32, 4]]);
const ccCoinChannel = (note: number): number | undefined =>
  note >= 0x27 && note <= 0x2e ? note - 0x26 : undefined;

const parallelNoteChannel = (note: number): number | undefined => PARALLEL_NOTE_CHANNELS.get(note);

export function acceptorResolve(
  view: AcceptorView,
  lp: { button?: number; acceptor?: { line?: number; token?: boolean; note?: number } },
  chutes?: readonly CoinChute[],
  port?: CoinPortLines,
): { line: number; fromCabinet: boolean; kind?: 'note'; parallel?: boolean } {
  const a = lp.acceptor ?? {};
  const btn = lp.button ?? -1;
  if (a.line !== undefined) return { line: a.line, fromCabinet: true };
  if (a.note !== undefined) {
    const noteChannel = CC_NOTE_CHANNEL.get(a.note);
    const vendChannel = parallelNoteChannel(a.note);
    if (noteChannel !== undefined || vendChannel !== undefined) {
      const parallel = noteChannel === undefined;
      const served = !parallel && view.serialAcceptor?.note ? noteChannel
        : parallel && view.serialAcceptor?.parallelNote ? vendChannel
          : undefined;
      return served !== undefined
        ? { line: served, fromCabinet: true, kind: 'note', parallel }
        : { line: -1, fromCabinet: false, kind: 'note', parallel };
    }
    const coinChannel = ccCoinChannel(a.note);
    if (coinChannel !== undefined) {
      const line = view.serialAcceptor?.coinChannel?.[coinChannel - 1];
      if (line === null) return { line: -1, fromCabinet: true };
      if (line !== undefined && line >= 0) return { line, fromCabinet: true };
      return { line: view.coinBit, fromCabinet: false };
    }
  }
  if (view.acceptorLineIsNote && a.note !== undefined) {
    if (a.note !== 0x47) return { line: a.note, fromCabinet: true };
    if (btn >= 0) return { line: 0x100 | (btn & 0x7f), fromCabinet: true };
  }
  if (view.acceptorLineIsButton && btn >= 0) return { line: btn, fromCabinet: true };
  const reg = view.coinRegister;
  if (reg && a.note !== undefined) {
    const at = (row: number, bit: number): { line: number; fromCabinet: boolean } | undefined => {
      const line = reg.lineOfBit[row]?.[bit];
      if (line === undefined || (line !== null && line < 0)) return undefined;
      return { line: line ?? -1, fromCabinet: true };
    };
    if (a.note >= 0x0f && a.note <= 0x16) {
      if (reg.maskRow < 0) return { line: -1, fromCabinet: true };
      const hit = at(reg.maskRow, a.note - 0x0f);
      if (hit) return hit;
    } else if (a.note === reg.tokenNote && reg.tokenLine >= 0) {
      return { line: reg.tokenLine, fromCabinet: true };
    } else if (a.note === 0x47 && btn >= 0 && btn < 128) {
      const hit = at((btn >> 3) & 15, btn & 7);
      if (hit) return hit;
    }
  }
  if (view.acceptorNoteChute && chutes && a.note !== undefined) {
    const exact = chutes.find((c) => c.note === a.note);
    if (exact) return { line: exact.bit, fromCabinet: true };
  }
  if (view.acceptorCoinPort && port && a.note !== undefined) {
    const mask = coinRowMask(a.note, btn, view.acceptorCoinPort.row);
    if (mask !== undefined) {
      const hit = port.lines.find((l) => (l.mask & port.compare) === (mask & port.compare));
      return hit ? { line: hit.bit, fromCabinet: true } : { line: -1, fromCabinet: true };
    }
  }
  if (view.acceptorByChute && chutes && a.note !== undefined) {
    const exact = chutes.find((c) => c.note === a.note);
    if (exact) return { line: exact.bit, fromCabinet: true };
    const n = COIN_NOTES.get(a.note);
    const hit = n?.token
      ? chutes.find((c) => c.token)
      : n && n.pence !== null ? chutes.find((c) => !c.token && c.pence === n.pence) : undefined;
    if (hit) return { line: hit.bit, fromCabinet: true };
  }
  return { line: a.token ? view.tokenBit : view.coinBit, fromCabinet: false };
}

export function acceptorTakesToken(
  view: Pick<PlatformView, 'coins'>,
  lp: { acceptor?: { token?: boolean; effect?: number } },
  line: number,
  chutes?: readonly CoinChute[],
): boolean {
  const a = lp.acceptor;
  if (!a) return false;
  if (a.token) return true;
  if (a.effect !== undefined) return false;
  const list: readonly { bit: number; label: string; token?: boolean }[] = chutes?.length ? chutes : view.coins;
  const c = list.find((x) => x.bit === line);
  return !!c && (c.token ?? /\btoken\b/i.test(c.label));
}

export function coinInputLine(
  view: Pick<PlatformView, 'coinRegister' | 'coins' | 'tokenBit'>,
  button: number,
  coins: readonly { bit: number }[] = view.coins,
): number {
  const reg = view.coinRegister;
  if (!reg || !Number.isInteger(button) || button < 0 || button >= 128) return -1;
  const line = reg.lineOfBit[(button >> 3) & 15]?.[button & 7];
  if (line === undefined || line === null || line < 0) return -1;
  if (reg.directRows?.includes((button >> 3) & 15)) return line;
  return coins.some((c) => c.bit === line) || line === view.tokenBit ? line : -1;
}
