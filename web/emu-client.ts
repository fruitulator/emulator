import type { Game } from '../src/machine/registry';
import type { CoinChute, CoinWiringStatus, NamedCoin } from '../src/machine/machine';
import type { CoinMeasurement, CoinWiring } from '../src/machine/coinwiring';
import { FrameView } from '../src/machine/framestate';
import type { AutosaveTrigger, CashLedger, DiagEntry, EmuRequest, EmuResponse, MachineInfo } from './emu-protocol';
import type { Snapshot } from './snapshot';
import type { Recording } from '../src/machine/replay';
import type { Check, CheckResult, RelayInput } from './relay';

export interface ClearRamSettings {
  optionKeys?: Record<string, number>;
  panelSwitches?: Record<string, boolean>;
  namedCoins?: Record<string, NamedCoin>;
  coinWiring?: CoinWiring;
}

export interface EmuLoadOptions {
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

export type Keyframe = Check & { data: Uint8Array; cycles: number; ledger: CashLedger | null };

export interface EmuBenchStats {
  stepMs: number;
  p95StepMs: number;
  steps: number;
  droppedMs: number;
  tickHz: number;
  maxGapMs: number;
  autosaveMs: number;
  calibMs: number;
  regionsCompiled: number;
  regionsRefused: number;
}

export interface AutosaveBlob {
  snap: Snapshot;
  cycles: number;
  at: number;
  nvram?: Uint8Array;
}

export interface Emu {
  load(opts: EmuLoadOptions): Promise<MachineInfo>;
  input(id: number, on: boolean): void;
  coin(bit: number): void;
  nameCoin(line: number, coin: NamedCoin): void;
  setCoinWiring(wiring: CoinWiring): void;
  readonly coinWiringStatus: CoinWiringStatus | null;
  note(billType: number, parallel?: boolean): void;
  reset(): void;
  powerCycle(): void;
  fitKey(index: number, position: number): Promise<number[]>;
  pause(): void;
  resume(): void;
  snapshot(): Promise<Snapshot | null>;
  diagRam(addrs: number[]): Promise<number[]>;
  ledger(): Promise<CashLedger | null>;
  clearRam(settings: ClearRamSettings): Promise<string | null>;
  measureCoins(lines: readonly number[]): Promise<{ result: CoinMeasurement; wallMs: number } | null>;
  ioActivity(): Promise<Record<string, number> | null>;
  startRecording(opts: { cold: boolean; setHash?: string; at?: number }): void;
  stopRecording(): Promise<Recording | null>;
  setDiagLog(on: boolean): void;
  clearDiagLog(): void;
  diagLog(): Promise<DiagEntry[]>;
  diagAudio(text: string): void;
  diagSpeed(text: string): void;
  setInputLabels(labels: Record<number, string>, coins?: Record<number, string>): void;
  latestFrame(): FrameView | null;
  readonly info: MachineInfo | null;
  cachedAutosave(): AutosaveBlob | null;
  attachAudioPort(port: MessagePort): void;
  benchStats(): EmuBenchStats | null;
  droppedMs(): number;
  machineS(): number;
  framesReceived(): number;
  onHalted?: (message: string) => void;
  onAutosave?: (blob: AutosaveBlob, trigger: AutosaveTrigger) => void;
  onSerial?: (events: { ch: number; bytes: number[] }[]) => void;
  onCoins?: (coins: CoinChute[]) => void;
  onCoinRejected?: (bit: number) => void;
}

interface PendingLoad {
  epoch: number;
  resolve(info: MachineInfo): void;
  reject(err: Error): void;
}

export class WorkerEmu implements Emu {
  private worker: Worker | null = null;
  private epoch = 0;
  private nextId = 1;
  private pendingLoad: PendingLoad | null = null;
  private pendingKeys: ((positions: number[]) => void)[] = [];
  private pendingSnapshots = new Map<number, (r: { snap?: Snapshot; cycles: number }) => void>();
  private pendingDiags = new Map<number, (values: number[]) => void>();
  private pendingLedgers = new Map<number, (l: CashLedger | null) => void>();
  private pendingClears = new Map<number, (error: string | null) => void>();
  private pendingMeasures = new Map<number, (r: { result: CoinMeasurement; wallMs: number } | null) => void>();
  private pendingActivity = new Map<number, (c: Record<string, number> | null) => void>();
  private pendingDiagLogs = new Map<number, (e: DiagEntry[]) => void>();
  private pendingRecordings = new Map<number, (r: Recording | null) => void>();
  private pendingKeyframes = new Map<number, (k: Keyframe | null) => void>();
  onRelay?: (inputs: RelayInput[], upTo: number) => void;
  onFollowReport?: (r: { result: CheckResult | null; drift?: string; diff?: string[] }) => void;
  followPos: { cycle: number; lag: number } | null = null;
  private current: FrameView | null = null;
  private previous: FrameView | null = null;
  private infoValue: MachineInfo | null = null;
  private wiringStatus: CoinWiringStatus | null = null;
  get coinWiringStatus(): CoinWiringStatus | null { return this.wiringStatus; }
  private autosave: AutosaveBlob | null = null;
  private bench: EmuBenchStats | null = null;
  private audioPort: MessagePort | null = null;
  onHalted?: (message: string) => void;
  onAutosave?: (blob: AutosaveBlob, trigger: AutosaveTrigger) => void;
  onSerial?: (events: { ch: number; bytes: number[] }[]) => void;
  onCoins?: (coins: CoinChute[]) => void;
  onCoinRejected?: (bit: number) => void;

  get info(): MachineInfo | null {
    return this.infoValue;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./emu.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<EmuResponse>) => this.dispatch(ev.data);
      this.worker.onerror = (ev) => {
        const msg = ev.message || 'emulation worker failed';
        this.pendingLoad?.reject(new Error(msg));
        this.pendingLoad = null;
        this.worker?.terminate();
        this.worker = null;
        this.onHalted?.(msg);
      };
    }
    return this.worker;
  }

  private post(req: EmuRequest, transfer: Transferable[] = []): void {
    this.ensureWorker().postMessage(req, transfer);
  }

  private dispatch(msg: EmuResponse): void {
    switch (msg.type) {
      case 'loaded':
        if (msg.epoch === this.epoch && this.pendingLoad?.epoch === msg.epoch) {
          this.infoValue = msg.info;
          this.pendingLoad.resolve(msg.info);
          this.pendingLoad = null;
        }
        break;
      case 'load-error':
        if (msg.epoch === this.epoch && this.pendingLoad?.epoch === msg.epoch) {
          this.pendingLoad.reject(new Error(msg.message));
          this.pendingLoad = null;
        }
        break;
      case 'frame': {
        if (!this.infoValue) break;
        const view = new FrameView(this.infoValue.layout, msg.buf);
        if (view.epoch !== this.epoch) {
          break;
        }
        if (this.previous) {
          this.post({ type: 'return-buffer', buf: this.previous.buf }, [this.previous.buf]);
        }
        this.previous = this.current;
        this.current = view;
        this.dropped = view.droppedMs;
        if (msg.machineS !== undefined) this.machineSeconds = msg.machineS;
        this.received++;
        break;
      }
      case 'halted':
        if (msg.epoch === this.epoch) this.onHalted?.(msg.message);
        break;
      case 'serial':
        if (msg.epoch === this.epoch) this.onSerial?.(msg.events);
        break;
      case 'coins':
        if (msg.epoch === this.epoch && this.infoValue) {
          this.infoValue.coins = msg.coins;
          this.onCoins?.(msg.coins);
        }
        break;
      case 'coin-rejected':
        if (msg.epoch === this.epoch) this.onCoinRejected?.(msg.bit);
        break;
      case 'key-fitted':
        if (msg.epoch === this.epoch) this.pendingKeys.shift()?.(msg.positions);
        break;
      case 'snapshot-result': {
        const resolve = this.pendingSnapshots.get(msg.id);
        this.pendingSnapshots.delete(msg.id);
        resolve?.({ snap: msg.snap, cycles: msg.cycles });
        break;
      }
      case 'autosave':
        if (msg.epoch === this.epoch) {
          this.autosave = { snap: msg.snap, cycles: msg.cycles, at: Date.now(), nvram: msg.nvram };
          this.onAutosave?.(this.autosave, msg.trigger);
        }
        break;
      case 'bench':
        if (msg.epoch === this.epoch) {
          this.bench = {
            stepMs: msg.stepMs,
            p95StepMs: msg.p95StepMs,
            steps: msg.steps,
            droppedMs: msg.droppedMs,
            tickHz: msg.tickHz,
            maxGapMs: msg.maxGapMs,
            autosaveMs: msg.autosaveMs,
            calibMs: msg.calibMs,
            regionsCompiled: msg.regionsCompiled ?? 0,
            regionsRefused: msg.regionsRefused ?? 0,
          };
        }
        break;
      case 'diag-result': {
        const resolve = this.pendingDiags.get(msg.id);
        this.pendingDiags.delete(msg.id);
        resolve?.(msg.values);
        break;
      }
      case 'ledger-result': {
        const resolve = this.pendingLedgers.get(msg.id);
        this.pendingLedgers.delete(msg.id);
        this.wiringStatus = msg.wiring ?? null;
        resolve?.(msg.ledger);
        break;
      }
      case 'clear-ram-result': {
        const resolve = this.pendingClears.get(msg.id);
        this.pendingClears.delete(msg.id);
        resolve?.(msg.error ?? null);
        break;
      }
      case 'measure-coins-result': {
        const resolve = this.pendingMeasures.get(msg.id);
        this.pendingMeasures.delete(msg.id);
        resolve?.(msg.result ? { result: msg.result, wallMs: msg.wallMs } : null);
        break;
      }
      case 'io-activity-result': {
        const resolve = this.pendingActivity.get(msg.id);
        this.pendingActivity.delete(msg.id);
        resolve?.(msg.counts);
        break;
      }
      case 'diag-log-result': {
        const resolve = this.pendingDiagLogs.get(msg.id);
        this.pendingDiagLogs.delete(msg.id);
        resolve?.(msg.entries);
        break;
      }
      case 'recording-result': {
        const resolve = this.pendingRecordings.get(msg.id);
        this.pendingRecordings.delete(msg.id);
        resolve?.(msg.recording);
        break;
      }
      case 'relay':
        if (msg.epoch === this.epoch) this.onRelay?.(msg.inputs, msg.upTo);
        break;
      case 'keyframe-result': {
        const resolve = this.pendingKeyframes.get(msg.id);
        this.pendingKeyframes.delete(msg.id);
        resolve?.(msg.key);
        break;
      }
      case 'follow-report':
        if (msg.epoch === this.epoch) this.onFollowReport?.(msg);
        break;
      case 'follow-pos':
        if (msg.epoch === this.epoch) this.followPos = { cycle: msg.cycle, lag: msg.lag };
        break;
    }
  }

  load(opts: EmuLoadOptions): Promise<MachineInfo> {
    this.epoch++;
    this.wiringStatus = null;
    this.current = null;
    this.previous = null;
    this.autosave = null;
    this.bench = null;
    this.followPos = null;
    this.pendingLoad?.reject(new Error('superseded by a newer load'));
    return new Promise<MachineInfo>((resolve, reject) => {
      this.pendingLoad = { epoch: this.epoch, resolve, reject };
      this.post({
        type: 'load',
        epoch: this.epoch,
        game: opts.game,
        snapshot: opts.snapshot,
        optionKeys: opts.optionKeys,
        panelSwitches: opts.panelSwitches,
        namedCoins: opts.namedCoins,
        coinWiring: opts.coinWiring,
        powerCycle: opts.powerCycle,
        benchStep: opts.benchStep,
        noAudio: opts.noAudio,
        bench: opts.bench,
        noRegions: opts.noRegions,
        wasm: opts.wasm,
        relay: opts.relay,
        follow: opts.follow,
      });
      if (this.audioPort) this.post({ type: 'audio-port', port: this.audioPort }, [this.audioPort]);
      this.audioPort = null;
    });
  }

  input(id: number, on: boolean): void {
    this.post({ type: 'input', epoch: this.epoch, id, on });
  }

  coin(bit: number): void {
    this.post({ type: 'coin', epoch: this.epoch, bit });
  }

  nameCoin(line: number, coin: NamedCoin): void {
    this.post({ type: 'name-coin', epoch: this.epoch, line, coin });
  }

  setCoinWiring(wiring: CoinWiring): void {
    this.post({ type: 'coin-wiring', epoch: this.epoch, wiring });
  }

  note(billType: number, parallel = false): void {
    this.post({ type: 'note', epoch: this.epoch, billType, parallel });
  }

  reset(): void {
    this.post({ type: 'reset', epoch: this.epoch });
  }

  powerCycle(): void {
    this.post({ type: 'power-cycle', epoch: this.epoch });
  }

  fitKey(index: number, position: number): Promise<number[]> {
    return new Promise((resolve) => {
      this.pendingKeys.push(resolve);
      this.post({ type: 'fit-key', epoch: this.epoch, index, position });
    });
  }

  pause(): void {
    this.post({ type: 'pause', epoch: this.epoch });
  }

  resume(): void {
    this.post({ type: 'resume', epoch: this.epoch });
  }

  snapshot(): Promise<Snapshot | null> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pendingSnapshots.set(id, (r) => resolve(r.snap ?? null));
      this.post({ type: 'snapshot', epoch: this.epoch, id, deflate: false });
    });
  }

  diagRam(addrs: number[]): Promise<number[]> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pendingDiags.set(id, resolve);
      this.post({ type: 'diag-ram', epoch: this.epoch, id, addrs });
    });
  }

  ledger(): Promise<CashLedger | null> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pendingLedgers.set(id, resolve);
      this.post({ type: 'ledger', epoch: this.epoch, id });
    });
  }

  clearRam(settings: ClearRamSettings): Promise<string | null> {
    if (!this.infoValue) return Promise.resolve('no machine is running');
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pendingClears.set(id, resolve);
      this.post({ type: 'clear-ram', epoch: this.epoch, id, ...settings });
    });
  }

  measureCoins(lines: readonly number[]): Promise<{ result: CoinMeasurement; wallMs: number } | null> {
    if (!this.infoValue) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pendingMeasures.set(id, resolve);
      this.post({ type: 'measure-coins', epoch: this.epoch, id, lines: [...lines] });
    });
  }

  startRecording(opts: { cold: boolean; setHash?: string; at?: number }): void {
    this.post({ type: 'record-start', epoch: this.epoch, ...opts });
  }

  stopRecording(): Promise<Recording | null> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pendingRecordings.set(id, resolve);
      this.post({ type: 'record-stop', epoch: this.epoch, id });
    });
  }

  keyframe(): Promise<Keyframe | null> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pendingKeyframes.set(id, resolve);
      this.post({ type: 'keyframe', epoch: this.epoch, id });
    });
  }

  followFeed(inputs: RelayInput[], upTo: number): void {
    this.post({ type: 'follow-feed', epoch: this.epoch, inputs, upTo });
  }

  followCheck(check: Check, data?: Uint8Array): void {
    this.post({ type: 'follow-check', epoch: this.epoch, check, data });
  }

  setDiagLog(on: boolean): void {
    this.post({ type: 'diag-log', epoch: this.epoch, on });
  }

  clearDiagLog(): void {
    this.post({ type: 'diag-log-clear', epoch: this.epoch });
  }

  diagAudio(text: string): void {
    this.post({ type: 'diag-audio', epoch: this.epoch, text });
  }

  diagSpeed(text: string): void {
    this.post({ type: 'diag-speed', epoch: this.epoch, text });
  }

  diagLog(): Promise<DiagEntry[]> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pendingDiagLogs.set(id, resolve);
      this.post({ type: 'diag-log-read', epoch: this.epoch, id });
    });
  }

  setInputLabels(labels: Record<number, string>, coins?: Record<number, string>): void {
    this.post({ type: 'input-labels', epoch: this.epoch, labels, coins });
  }

  ioActivity(): Promise<Record<string, number> | null> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pendingActivity.set(id, resolve);
      this.post({ type: 'io-activity', epoch: this.epoch, id });
    });
  }

  latestFrame(): FrameView | null {
    return this.current;
  }

  cachedAutosave(): AutosaveBlob | null {
    return this.autosave;
  }

  attachAudioPort(port: MessagePort): void {
    if (this.worker) this.post({ type: 'audio-port', port }, [port]);
    else this.audioPort = port;
  }

  droppedMs(): number { return this.dropped; }
  private dropped = 0;
  machineS(): number { return this.machineSeconds; }
  private machineSeconds = 0;
  framesReceived(): number { return this.received; }
  private received = 0;

  benchStats(): EmuBenchStats | null {
    return this.bench;
  }
}
