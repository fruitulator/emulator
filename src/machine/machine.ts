import type { Reel } from '../hw/reel';
import type { NamedCap } from './buttonnames';
import type { BoardPart } from './parts';
import type { DisplayKind } from './layoutdisplay';
import type { CoinLineTable, CoinWiring, StepState } from './coinwiring';

export type { DisplayKind };

export interface CoinWiringStatus {
  state: StepState;
  step: number | null;
  conflicts: number[];
}

export type NamedCoin = number | 'token';

export interface CoinChute {
  label: string;
  bit: number;
  pence?: number | null;
  token?: boolean;
  note?: number;
}

export interface CoinPortLines {
  readonly compare: number;
  readonly lines: readonly { readonly bit: number; readonly mask: number }[];
}

export type NoteResult = 'stacked' | 'escrow' | 'busy' | 'inhibited' | 'unprogrammed' | 'unfitted';

export interface MachineDisplay {
  readonly kind: DisplayKind;
  text(): string;
  readonly chars: Uint8Array;
  readonly duty?: number;
  cellGlyph?(cell: number): Uint8Array | null;
  readonly cellDots?: Uint8Array;
  readonly cellWords?: Uint32Array;
}

export interface AudioSource {
  readonly rate: number;
  buffered(): number;
  readAudio(out: Float32Array, frames: number): number;
}

export interface OptionKey {
  label: string;
  positions: string[];
  position(): number;
  fit(v: number): void;
}

export interface CabinetSwitch {
  id: number;
  label: string;
  on: boolean;
  group?: string;
  bootOnly?: boolean;
  option?: boolean;
}

export function dilSwitchLabel(numbering: string, stated: string | undefined): string {
  const name = (stated ?? '').trim();
  return name ? `${numbering} - ${name}` : numbering;
}

export interface CashLedger {
  inPence: number;
  outPence: number;
  unpricedOut: number;
  tokenInPence: number;
  tokenOutPence: number;
  unpricedTokenOut: number;
  unpricedTokenIn: number;
}

export function newCashLedger(): CashLedger {
  return {
    inPence: 0,
    outPence: 0,
    unpricedOut: 0,
    tokenInPence: 0,
    tokenOutPence: 0,
    unpricedTokenOut: 0,
    unpricedTokenIn: 0,
  };
}

export function outMultToLedger(mult: number): number {
  return mult > 0 ? mult : 0;
}

export interface MoneyAxis {
  readonly in: readonly number[];
  readonly out: readonly number[];
}

export function ledgerOutMults(...axes: MoneyAxis[]): number[][] {
  const nets = axes.some((a) => a.out.some((x) => x < 0));
  return axes.map((a) => a.out.map((x, i) => (nets && (a.in[i] ?? 0) > 0 ? 0 : outMultToLedger(x))));
}

export interface PaidOut {
  pence: number;
  coins: number;
  tokenPence: number;
  tokenCoins: number;
  any: boolean;
  backwards: boolean;
}

export function paidOutSince(before: CashLedger, after: CashLedger): PaidOut {
  const d = (f: keyof CashLedger) => after[f] - before[f];
  const pence = d('outPence');
  const coins = d('unpricedOut');
  const tokenPence = d('tokenOutPence');
  const tokenCoins = d('unpricedTokenOut');
  const backwards = pence < 0 || coins < 0 || tokenPence < 0 || tokenCoins < 0;
  return {
    pence: Math.max(0, pence),
    coins: Math.max(0, coins),
    tokenPence: Math.max(0, tokenPence),
    tokenCoins: Math.max(0, tokenCoins),
    any: !backwards && (pence > 0 || coins > 0 || tokenPence > 0 || tokenCoins > 0),
    backwards,
  };
}

export type DigitKind = 'none' | 'impact' | 'proconn' | 'words' | 'byte16' | 'byte64' | 'space' | 'mpu4led' | 'mpu5'
  | 'sc4';

export interface Machine {
  readonly digitKind?: DigitKind;
  readonly clockHz: number;
  step(): number;
  run(cycles: number): number;
  reset(): void;
  powerCycle?(): void;
  readonly optionKeys?: readonly OptionKey[];
  readonly switchPanel?: readonly CabinetSwitch[];
  readonly capNames?: ReadonlyMap<number, NamedCap>;
  readonly parts?: readonly BoardPart[];
  readonly reels: readonly Reel[];
  reelBounce?: import('../hw/reelbounce').ReelBounce;
  readonly display: MachineDisplay | null;
  readonly audioSource: AudioSource | null;
  layoutLamp(n: number): boolean;
  layoutLampLevel?(n: number): number;
  layoutDigit?(n: number): number;
  layoutDigitLevel?(n: number): number;
  layoutDigitSegLevel?(n: number, seg: number): number;
  layoutInput(id: number, on: boolean): void;
  boardDefaults?: import('./boarddefaults').BoardDefault[];
  pinHostClock?(at: Date | null): void;
  isOptionLine?(id: number): boolean;
  insertCoin(bit: number): void;
  readonly coinBusy: boolean;
  readonly coinRefusing?: number;
  readonly coinLinesShut?: number;
  readonly coinChutes?: readonly CoinChute[];
  readonly coinPortLines?: CoinPortLines;
  readonly coinLockHarnessRead?: boolean;
  readonly coinsRefused?: number;
  readonly unnamedCoinLines?: readonly number[];
  readonly coinLineTable?: CoinLineTable | null;
  readonly coinLineTableRefusal?: string | null;
  setCoinWiring?(w: CoinWiring): void;
  readonly coinWiringStatus?: CoinWiringStatus;
  nameCoin?(line: number, coin: NamedCoin): void;
  insertNote?(type: number): NoteResult;
  insertParallelNote?(channel: number): NoteResult;
  readonly parallelNoteReaderFitted?: boolean;
  readonly noteReaderFitted?: boolean;
  readonly reelDriftBase?: number;
  readonly cashLedger?: CashLedger;
  readonly meterTotals?: { readonly in: number; readonly out: number };
  drainSerial?(): { ch: number; bytes: number[] }[];

  restoredStateFault?(): string | null;
}
