import type { Game } from '../src/machine/registry';
import type { Check, CheckResult, RelayInput } from './relay';
import type { FrameLayout } from '../src/machine/framestate';
import type { Schematic } from '../src/machine/schematic';
import type { Snapshot } from './snapshot';
import type { CashLedger, CoinChute, CoinWiringStatus, NamedCoin } from '../src/machine/machine';
import type { CoinLineTable, CoinMeasurement, CoinWiring } from '../src/machine/coinwiring';
import type { DiagEntry } from './diaglog';
import type { Recording } from '../src/machine/replay';
import type { SwitchControl } from '../src/layout/fmlconfig';

export type { CashLedger };

export type { DiagEntry };

export type AutosaveTrigger = 'pause' | 'clear-ram';

export function ledgerPayoutPercent(l: CashLedger): number | null {
  if (l.unpricedOut || l.unpricedTokenOut) return null;
  if (l.unpricedTokenIn) return null;
  const take = l.inPence - l.tokenInPence;
  if (take <= 0) return null;
  return (100 * (l.outPence + l.tokenOutPence)) / take;
}

export interface MachineInfo {
  system: string;
  clockHz: number;
  audioRate: number | null;
  optionKeys: { label: string; positions: string[]; position: number }[];
  switchPanel: {
    id: number; label: string; on: boolean; group?: string; bootOnly?: boolean;
    option?: boolean;
  }[];
  capNames?: Record<number, { role: string; label: string }>;
  switchIds?: Partial<Record<SwitchControl, number>>;
  coins?: CoinChute[];
  coinPort?: { compare: number; lines: { bit: number; mask: number }[] };
  unnamedCoins?: number[];
  namesCoins?: boolean;
  coinTable?: CoinLineTable;
  coinTableRefusal?: string;
  slotlessCoins: number[];
  drawnCoins?: number[];
  layout: FrameLayout;
  schematic: Schematic | null;
  boardDefaults?: { axis: string; text: string; ifWrong: string; node?: string; unbuilt?: string }[];
  codegen: 'regions' | 'predecode' | 'wasm' | null;
}

export type EmuRequest =
  | {
      type: 'load';
      epoch: number;
      game: Game;
      snapshot?: Snapshot;
      optionKeys?: Record<string, number>;
      panelSwitches?: Record<string, boolean>;
      namedCoins?: Record<string, NamedCoin>;
      coinWiring?: CoinWiring;
      powerCycle?: boolean;
      benchStep?: boolean;
      noAudio?: boolean;
      bench?: boolean;
      noRegions?: boolean;
      wasm?: boolean;
      relay?: { at: number };
      follow?: { cycle: number; seq: number; bufferMs: number };
    }
  | { type: 'input'; epoch: number; id: number; on: boolean }
  | { type: 'coin'; epoch: number; bit: number }
  | { type: 'name-coin'; epoch: number; line: number; coin: NamedCoin }
  | { type: 'coin-wiring'; epoch: number; wiring: CoinWiring }
  | { type: 'note'; epoch: number; billType: number; parallel?: boolean }
  | { type: 'reset'; epoch: number }
  | { type: 'power-cycle'; epoch: number }
  | {
      type: 'clear-ram'; epoch: number; id: number;
      optionKeys?: Record<string, number>;
      panelSwitches?: Record<string, boolean>;
      namedCoins?: Record<string, NamedCoin>;
      coinWiring?: CoinWiring;
    }
  | { type: 'measure-coins'; epoch: number; id: number; lines: number[] }
  | {
      type: 'record-start';
      epoch: number;
      cold: boolean;
      setHash?: string;
      at?: number;
    }
  | { type: 'record-stop'; epoch: number; id: number }
  | { type: 'keyframe'; epoch: number; id: number }
  | { type: 'follow-feed'; epoch: number; inputs: RelayInput[]; upTo: number }
  | { type: 'follow-check'; epoch: number; check: Check; data?: Uint8Array }
  | { type: 'fit-key'; epoch: number; index: number; position: number }
  | { type: 'pause'; epoch: number }
  | { type: 'resume'; epoch: number }
  | { type: 'snapshot'; epoch: number; id: number; deflate: boolean }
  | { type: 'audio-port'; port: MessagePort }
  | { type: 'return-buffer'; buf: ArrayBuffer }
  | { type: 'diag-ram'; epoch: number; id: number; addrs: number[] }
  | { type: 'ledger'; epoch: number; id: number }
  | { type: 'io-activity'; epoch: number; id: number }
  | { type: 'diag-log'; epoch: number; on: boolean }
  | { type: 'diag-log-clear'; epoch: number }
  | { type: 'diag-log-read'; epoch: number; id: number }
  | { type: 'diag-audio'; epoch: number; text: string }
  | { type: 'diag-speed'; epoch: number; text: string }
  | {
      type: 'input-labels';
      epoch: number;
      labels: Record<number, string>;
      coins?: Record<number, string>;
    };

export type EmuResponse =
  | { type: 'loaded'; epoch: number; info: MachineInfo }
  | { type: 'load-error'; epoch: number; message: string }
  | { type: 'serial'; epoch: number; events: { ch: number; bytes: number[] }[] }
  | { type: 'coins'; epoch: number; coins: CoinChute[] }
  | { type: 'coin-rejected'; epoch: number; bit: number }
  | { type: 'frame'; buf: ArrayBuffer; machineS?: number }
  | { type: 'halted'; epoch: number; message: string }
  | { type: 'key-fitted'; epoch: number; positions: number[] }
  | {
      type: 'snapshot-result';
      id: number;
      snap?: Snapshot;
      data?: Uint8Array;
      cycles: number;
    }
  | {
      type: 'autosave';
      epoch: number;
      snap: Snapshot;
      cycles: number;
      trigger: AutosaveTrigger;
    }
  | {
      type: 'bench';
      epoch: number;
      stepMs: number;
      p95StepMs: number;
      steps: number;
      droppedMs: number;
      tickHz: number;
      maxGapMs: number;
      autosaveMs: number;
      calibMs: number;
      regionsCompiled?: number;
      regionsRefused?: number;
    }
  | { type: 'diag-result'; id: number; values: number[] }
  | {
      type: 'ledger-result'; id: number; ledger: CashLedger | null;
      wiring?: CoinWiringStatus;
    }
  | { type: 'clear-ram-result'; id: number; error?: string }
  | { type: 'measure-coins-result'; id: number; result: CoinMeasurement | null; wallMs: number }
  | { type: 'io-activity-result'; id: number; counts: Record<string, number> | null }
  | { type: 'diag-log-result'; id: number; entries: DiagEntry[] }
  | { type: 'recording-result'; id: number; recording: Recording | null }
  | { type: 'relay'; epoch: number; inputs: RelayInput[]; upTo: number }
  | { type: 'keyframe-result'; id: number; key: (Check & { data: Uint8Array; cycles: number; ledger: CashLedger | null }) | null }
  | { type: 'follow-report'; epoch: number; result: CheckResult | null; drift?: string; diff?: string[] }
  | { type: 'follow-pos'; epoch: number; cycle: number; lag: number };
