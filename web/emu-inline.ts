import { machineFor, type Game } from '../src/machine/registry';
import type { CoinChute, Machine, NamedCoin } from '../src/machine/machine';
import type { Recorder, Recording } from '../src/machine/replay';
import { recordInto } from '../src/machine/replay';
import {
  FrameView, captureFrame, frameLayoutFor, type FrameLayout,
} from '../src/machine/framestate';
import { applyState, captureState, captureStateRaw } from './snapshot';
import {
  CoinPacer, coinLogLine, coinRejected, InputDwell, MAX_CATCHUP_SECONDS, ReelDiagnostics, applyOptionKeyState, applyPanelSwitchState, applyNamedCoins, buildMachineInfo, powerCycleOrThrow,
  rebuildWithBlankMemory, sameFrameLayout,
  calibrateHost, offerNote, readIoCounts, regionStats,
  disableAudioTicks, pumpAudioToPort, runBudget,
} from './emu-core';
import type {
  AutosaveBlob, ClearRamSettings, Emu, EmuBenchStats, EmuLoadOptions,
} from './emu-client';
import type { AutosaveTrigger, CashLedger, DiagEntry, MachineInfo } from './emu-protocol';
import { DiagLog, DiagWatch, audioReportText } from './diaglog';
import { undrawnLayoutNotes } from '../src/layout/undrawn';
import { watchSettingReads, unreadSettingLine } from '../src/layout/unreadsettings';
import type { Snapshot } from './snapshot';

export class InlineEmu implements Emu {
  private machine: Machine | null = null;
  private loadedFrom: { game: Game; wasm?: boolean; noRegions?: boolean } | null = null;
  private settingNotes: string[] = [];
  private layout: FrameLayout | null = null;
  private infoValue: MachineInfo | null = null;
  private gameName = '';
  private benchStep = false;
  private readonly dwell = new InputDwell();
  private readonly coins = new CoinPacer((event, bit) => {
    if (coinRejected(event)) this.onCoinRejected?.(bit);
    this.log.add('coin', coinLogLine(event, this.coinName(bit)));
  });
  private recorder: Recorder | null = null;
  private paused = false;
  private halted = false;
  private lastTickAt = 0;
  private seq = 0;
  private epoch = 0;
  private droppedMsTotal = 0;
  private buf: ArrayBuffer | null = null;
  private view: FrameView | null = null;
  private audioPort: MessagePort | null = null;
  private audioScratch = new Float32Array(8192 * 2);
  private benchSteps = 0;
  private benchStepMs: number[] = [];
  private benchWindowStart = 0;
  private benchMaxGapMs = 0;
  private benchCalibMs = 0;
  private bench: EmuBenchStats | null = null;
  private reelDiag = new ReelDiagnostics();
  private readonly log = new DiagLog();
  private readonly diagWatch = new DiagWatch(this.log);
  private inputLabels: Record<number, string> = {};
  private coinLabels: Record<number, string> = {};
  private systemName = '';
  onHalted?: (message: string) => void;
  onAutosave?: (blob: AutosaveBlob, trigger: AutosaveTrigger) => void;
  onSerial?: (events: { ch: number; bytes: number[] }[]) => void;
  onCoinRejected?: (bit: number) => void;
  onCoins?: (coins: CoinChute[]) => void;

  get info(): MachineInfo | null {
    return this.infoValue;
  }

  load(opts: EmuLoadOptions): Promise<MachineInfo> {
    this.epoch++;
    this.halted = false;
    this.paused = false;
    this.lastTickAt = 0;
    this.seq = 0;
    this.droppedMsTotal = 0;
    this.view = null;
    this.bench = null;
    this.benchStepMs = [];
    this.benchSteps = 0;
    this.benchWindowStart = performance.now();
    this.benchStep = !!opts.benchStep;
    this.benchCalibMs = opts.bench ? calibrateHost() : 0;
    if (opts.noAudio) disableAudioTicks();
    const reads = watchSettingReads(opts.game);
    try {
      const m = machineFor(opts.game);
      this.gameName = opts.game.name;
      applyOptionKeyState(m, opts.optionKeys);
      if (opts.snapshot) applyState(m, opts.snapshot);
      applyPanelSwitchState(m, opts.panelSwitches);
      applyNamedCoins(m, opts.namedCoins);
      if (opts.powerCycle) powerCycleOrThrow(m);
      this.layout = frameLayoutFor(opts.game.system, m, opts.game.layout);
      this.buf = new ArrayBuffer(this.layout.byteLength);
      this.reelDiag.install(m);
      if (opts.noRegions) {
        (m as { cpu?: { setRegionsEnabled?: (on: boolean) => void } }).cpu?.setRegionsEnabled?.(false);
      }
      if (opts.wasm === false) {
        (m as { useInterpreter?: () => void }).useInterpreter?.();
      } else if (opts.wasm === true) {
        (m as { useWasmCore?: () => void }).useWasmCore?.();
      }
      this.dwell.clear();
      this.coins.clear();
      if (this.recorder) { this.recorder.detach(); this.recorder = null; }
      this.machine = m;
      this.loadedFrom = { game: opts.game, wasm: opts.wasm, noRegions: opts.noRegions };
      this.infoValue = buildMachineInfo(opts.game, m, this.layout);
      this.settingNotes = reads.finish().map(unreadSettingLine);
      this.systemName = this.infoValue.system;
      this.inputLabels = {};
      this.coinLabels = {};
      this.log.clear();
      this.diagWatch.install(
        m, this.gameName, this.systemName,
        undrawnLayoutNotes(opts.game.layout), opts.game.layout, this.settingNotes,
      );
      return Promise.resolve(this.infoValue);
    } catch (e) {
      reads.finish();
      this.machine = null;
      return Promise.reject(e as Error);
    }
  }

  latestFrame(): FrameView | null {
    const m = this.machine;
    if (!m || !this.layout || !this.buf) return null;
    if (this.paused || this.halted) return this.view;
    const now = performance.now();
    const real = this.lastTickAt ? (now - this.lastTickAt) / 1000 : 0;
    this.lastTickAt = now;
    const elapsed = Math.min(real, MAX_CATCHUP_SECONDS);
    this.droppedMsTotal += (real - elapsed) * 1000;
    this.benchMaxGapMs = Math.max(this.benchMaxGapMs, real * 1000);
    const t0 = performance.now();
    let steps = 0;
    const budget = Math.floor(elapsed * m.clockHz);
    try {
      steps = runBudget(m, budget, this.benchStep);
    } catch (e) {
      this.halted = true;
      console.error('[emu] machine halted', e);
      this.onHalted?.((e as Error).message || 'machine halted');
      return this.view;
    }
    this.dwell.ran(m, budget);
    this.coins.ran(m, budget);
    m.reelBounce?.tick(m.reels, budget);
    const stepMs = performance.now() - t0;
    this.benchSteps += steps;
    this.benchStepMs.push(stepMs);
    this.sampleBench(now);
    this.reelDiag.tick(m);
    this.diagWatch.tick(m);
    pumpAudioToPort(m, this.audioPort, this.audioScratch);
    captureFrame(m, this.layout, this.buf, {
      epoch: this.epoch,
      seq: this.seq++,
      stepMs,
      droppedMs: this.droppedMsTotal,
      steps,
    });
    this.view = new FrameView(this.layout, this.buf);
    const serial = m.drainSerial?.();
    if (serial?.length) this.onSerial?.(serial);
    return this.view;
  }

  private sampleBench(now: number): void {
    const dt = now - this.benchWindowStart;
    if (dt < 1000 || !this.benchStepMs.length) return;
    const sorted = [...this.benchStepMs].sort((a, b) => a - b);
    this.bench = {
      stepMs: this.benchStepMs.reduce((a, b) => a + b, 0) / this.benchStepMs.length,
      p95StepMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
      steps: Math.round(this.benchSteps / this.benchStepMs.length),
      droppedMs: this.droppedMsTotal,
      tickHz: (this.benchStepMs.length * 1000) / dt,
      maxGapMs: this.benchMaxGapMs,
      autosaveMs: 0,
      calibMs: this.benchCalibMs,
      regionsCompiled: regionStats(this.machine).compiled,
      regionsRefused: regionStats(this.machine).refused,
    };
    this.benchSteps = 0;
    this.benchStepMs = [];
    this.benchWindowStart = now;
    this.benchMaxGapMs = 0;
  }

  input(id: number, on: boolean): void {
    const m = this.machine;
    if (!m) return;
    const label = this.inputLabels[id];
    this.log.add('input', `${on ? 'press' : 'release'} ${label ? `${label} (${id})` : `input ${id}`}`);
    if (on) this.diagWatch.pressed();
    if (on) this.dwell.press(m, id);
    else this.dwell.release(m, id);
  }

  coin(bit: number): void {
    const m = this.machine;
    if (!m) return;
    this.coins.offer(m, bit);
  }

  nameCoin(line: number, coin: NamedCoin): void {
    const m = this.machine;
    if (!m?.nameCoin) return;
    m.nameCoin(line, coin);
    if (m.coinChutes && this.infoValue) {
      this.infoValue.coins = m.coinChutes.map((c) => ({ ...c }));
      this.onCoins?.(this.infoValue.coins);
    }
  }

  private coinName(bit: number): string {
    const label = this.machine?.coinChutes?.find((c) => c.bit === bit)?.label ?? this.coinLabels[bit];
    return label ? `${label} (line ${bit})` : `line ${bit}`;
  }

  note(billType: number, parallel = false): void {
    const m = this.machine;
    if (!m) return;
    this.log.add('coin', offerNote(m, billType, parallel));
  }

  reset(): void {
    this.powerCycle();
  }

  powerCycle(): void {
    if (!this.machine) return;
    this.coins.clear();
    try {
      powerCycleOrThrow(this.machine);
      this.log.add('reset', 'machine restarted with its memory kept');
    } catch (e) {
      console.warn(`[emu] ${(e as Error).message}`);
    }
  }

  fitKey(index: number, position: number): Promise<number[]> {
    const m = this.machine;
    if (!m) return Promise.resolve([]);
    const keys = m.optionKeys ?? [];
    keys[index]?.fit(position);
    const positions = keys.map((k) => k.position());
    this.powerCycle();
    return Promise.resolve(positions);
  }

  pause(): void {
    this.paused = true;
    this.lastTickAt = 0;
  }

  resume(): void {
    this.paused = false;
    this.lastTickAt = 0;
  }

  snapshot(): Promise<Snapshot | null> {
    const m = this.machine;
    if (!m) return Promise.resolve(null);
    const snap = captureState(m, this.gameName);
    if (this.log.enabled) snap.diag = [...this.log.entries()];
    return Promise.resolve(snap);
  }

  startRecording(opts: { cold: boolean; setHash?: string; at?: number }): void {
    const m = this.machine;
    if (!m) return;
    if (this.recorder) this.recorder.detach();
    this.recorder = recordInto(m, {
      set: this.gameName,
      setHash: opts.setHash,
      cold: opts.cold,
      clock: { mode: 'pinned', at: opts.at ?? Date.now() },
    });
    this.log.add('input', `recording armed (${opts.cold ? 'cold' : 'from battery'})`);
  }

  stopRecording(): Promise<Recording | null> {
    if (!this.recorder) {
      this.log.add('input', 'no recording was armed');
      return Promise.resolve(null);
    }
    const out = this.recorder.finish();
    this.recorder.detach();
    this.recorder = null;
    this.log.add('input', `recording closed: ${out.events.length} inputs`);
    return Promise.resolve(out);
  }

  clearDiagLog(): void {
    this.log.clear();
    const m = this.machine;
    if (this.log.enabled && m) {
      this.diagWatch.announce(m, this.gameName, this.systemName);
    }
  }

  setDiagLog(on: boolean): void {
    const was = this.log.enabled;
    this.log.setEnabled(on);
    const m = this.machine;
    if (on && !was && m) {
      this.diagWatch.announce(m, this.gameName, this.systemName);
    }
  }

  diagLog(): Promise<DiagEntry[]> {
    return Promise.resolve([...this.log.entries()]);
  }

  diagAudio(text: string): void {
    this.log.add('audio', text);
  }

  diagSpeed(text: string): void {
    this.log.add('speed', text);
  }

  setInputLabels(labels: Record<number, string>, coins: Record<number, string> = {}): void {
    this.inputLabels = labels;
    this.coinLabels = coins;
  }

  diagRam(addrs: number[]): Promise<number[]> {
    const m = this.machine as unknown as
      { ram?: Uint8Array; diagPeek?: (a: number) => number } | null;
    const ram = m?.ram;
    return Promise.resolve(addrs.map((a) => (m?.diagPeek ? m.diagPeek(a)
      : ram && a < ram.length ? ram[a] : -1)));
  }

  ledger(): Promise<CashLedger | null> {
    const l = this.machine?.cashLedger;
    return Promise.resolve(l ? { ...l } : null);
  }

  clearRam(settings: ClearRamSettings): Promise<string | null> {
    const old = this.machine;
    const from = this.loadedFrom;
    if (!old || !from) return Promise.resolve('no machine is running');
    let m: Machine;
    try {
      m = rebuildWithBlankMemory(machineFor, from.game, old, {
        ...settings, wasm: from.wasm, noRegions: from.noRegions,
      });
      if (!sameFrameLayout(this.layout, frameLayoutFor(from.game.system, m, from.game.layout))) {
        return Promise.resolve('the rebuilt machine does not match the one on screen');
      }
    } catch (e) {
      console.warn('[emu] clear RAM failed', e);
      return Promise.resolve((e as Error).message || 'the machine could not be rebuilt');
    }
    if (this.recorder) { this.recorder.detach(); this.recorder = null; }
    this.dwell.clear();
    this.coins.clear();
    this.halted = false;
    this.lastTickAt = 0;
    this.reelDiag.install(m);
    this.machine = m;
    this.diagWatch.install(
      m, this.gameName, this.systemName,
      undrawnLayoutNotes(from.game.layout), from.game.layout, this.settingNotes,
    );
    this.log.add('reset', 'memory cleared: the machine restarted as new, money totals kept');
    const blob = this.cachedAutosave();
    if (blob) this.onAutosave?.(blob, 'clear-ram');
    return Promise.resolve(null);
  }

  ioActivity(): Promise<Record<string, number> | null> {
    return Promise.resolve(readIoCounts(this.machine, this.infoValue?.schematic ?? null));
  }

  cachedAutosave(): AutosaveBlob | null {
    const m = this.machine;
    if (!m) return null;
    try {
      const snap = captureStateRaw(m, this.gameName);
      return { snap, cycles: snap.cycles, at: Date.now() };
    } catch (e) {
      console.warn('[emu] inline autosave capture failed', e);
      return null;
    }
  }

  attachAudioPort(port: MessagePort): void {
    this.audioPort = port;
    port.onmessage = (e: MessageEvent) => {
      const text = audioReportText(e.data);
      if (text) { this.log.add('audio', text); console.log('[audio]', text); }
    };
  }

  benchStats(): EmuBenchStats | null {
    return this.bench;
  }
}
