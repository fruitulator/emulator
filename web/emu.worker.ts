import { machineFor, type Game } from '../src/machine/registry';
import type { Machine } from '../src/machine/machine';
import type { Recorder, Recording } from '../src/machine/replay';
import { recordInto } from '../src/machine/replay';
import type { Schematic } from '../src/machine/schematic';
import {
  captureFrame, frameLayoutFor, type FrameLayout,
} from '../src/machine/framestate';
import { applyState, captureState, captureStateRaw } from './snapshot';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { Follower, diffPaths, followBudget, settleSound, signalsOf, snapshotHash, type Check, type RelayInput } from './relay';
import {
  CoinPacer, coinLogLine, coinRejected, InputDwell, MAX_CATCHUP_SECONDS, ReelDiagnostics, applyOptionKeyState, applyPanelSwitchState, applyNamedCoins, buildMachineInfo, powerCycleOrThrow,
  rebuildWithBlankMemory, sameFrameLayout,
  calibrateHost, offerNote, readIoCounts, regionStats,
  disableAudioTicks, pumpAudioToPort, runBudget,
} from './emu-core';
import type { AutosaveTrigger, EmuRequest, EmuResponse } from './emu-protocol';
import { DiagLog, DiagWatch, audioReportText } from './diaglog';
import { StallWatch } from './stallwatch';
import { undrawnLayoutNotes } from '../src/layout/undrawn';
import { watchSettingReads, unreadSettingLine } from '../src/layout/unreadsettings';
import { str } from './i18n';

const post = (msg: EmuResponse, transfer: Transferable[] = []): void => {
  (self as unknown as {
    postMessage(m: EmuResponse, t: Transferable[]): void;
  }).postMessage(msg, transfer);
};

const TICK_MS = 1000 / 60;
const BENCH_REPORT_MS = 1000;
const FRAME_POOL = 3;

let machine: Machine | null = null;
let epoch = -1;
let layout: FrameLayout | null = null;
let schematic: Schematic | null = null;
let gameName = '';
let benchStep = false;
let paused = false;
let halted = false;
let lastTickAt = 0;
let tickTarget = 0;
let scheduled = false;
let seq = 0;
let droppedMsTotal = 0;
let pool: ArrayBuffer[] = [];

let audioPort: MessagePort | null = null;
const audioScratch = new Float32Array(8192 * 2);

let benchSteps = 0;
let benchStepMs: number[] = [];
let benchWindowStart = 0;
let benchMaxGapMs = 0;
let benchAutosaveMs = 0;
let benchCalibMs = 0;

const reelDiag = new ReelDiagnostics();
const stalls = new StallWatch('machine');

const diagLog = new DiagLog();
const diagWatch = new DiagWatch(diagLog);
let inputLabels: Record<number, string> = {};
let coinLabels: Record<number, string> = {};
let systemName = '';

function inputName(id: number): string {
  const label = inputLabels[id];
  return label ? `${label} (${id})` : `input ${id}`;
}

function coinName(m: Machine, line: number): string {
  const label = m.coinChutes?.find((c) => c.bit === line)?.label ?? coinLabels[line];
  return label ? `${label} (line ${line})` : `line ${line}`;
}

function postFrame(m: Machine, stepMs: number, steps: number): void {
  const buf = pool.pop();
  if (!buf || !layout) return;
  captureFrame(m, layout, buf, {
    epoch, seq: seq++, stepMs, droppedMs: droppedMsTotal, steps, halted, paused,
  });
  post({ type: 'frame', buf }, [buf]);
}

function pushAutosave(now: number, trigger: AutosaveTrigger): void {
  if (!machine) return;
  if (halted) {
    diagLog.add('halt', 'the machine had stopped, so its state was not saved');
    return;
  }
  try {
    const snap = captureStateRaw(machine, gameName);
    post({ type: 'autosave', epoch, snap, cycles: snap.cycles, trigger });
  } catch (e) {
    console.warn('[emu] autosave capture failed', e);
  }
  benchAutosaveMs = Math.max(benchAutosaveMs, performance.now() - now);
}

const dwell = new InputDwell();
const coins = new CoinPacer((event, bit) => {
  if (coinRejected(event)) post({ type: 'coin-rejected', epoch, bit });
  if (!machine) return;
  diagLog.add('coin', coinLogLine(event, coinName(machine, bit)));
});

let recorder: Recorder | null = null;

let relayRec: Recorder | null = null;
let relayOut: RelayInput[] = [];
let relaySeq = 0;
let relaySentAt = 0;
const RELAY_MS = 200;
let follower: Follower | null = null;
let followBuffer = 0;
let followPosAt = 0;
const checkData = new Map<number, Uint8Array>();
let driftSaid = false;

function sendRelay(now: number, force: boolean): void {
  if (!relayRec) return;
  if (!force && !relayOut.length && now - relaySentAt < RELAY_MS) return;
  if (!force && now - relaySentAt < RELAY_MS && relayOut.length < 64) return;
  post({ type: 'relay', epoch, inputs: relayOut, upTo: relayRec.cycles });
  relayOut = [];
  relaySentAt = now;
}

function followCheck(m: Machine, k: Check, at: { cycle: number; seq: number }): void {
  settleSound(m);
  const snap = captureState(m, '');
  const mine = { hash: snapshotHash(snap), signals: signalsOf(m), ...at };
  const ok = mine.hash === k.hash && at.cycle === k.cycle && at.seq === k.seq;
  let diff: string[] | undefined;
  const data = checkData.get(k.cycle);
  checkData.delete(k.cycle);
  if (!ok && data) {
    try {
      const theirs = JSON.parse(strFromU8(inflateSync(data))) as { state: unknown };
      diff = diffPaths(snap.state, theirs.state);
    } catch {  }
  }
  post({ type: 'follow-report', epoch, result: { ...k, mine, ok }, diff });
}

function stopRecording(): Recording | null {
  if (!recorder) return null;
  const out = recorder.finish();
  recorder.detach();
  recorder = null;
  return out;
}

function reportBench(now: number): void {
  const dt = now - benchWindowStart;
  if (dt < BENCH_REPORT_MS || !benchStepMs.length) return;
  const sorted = [...benchStepMs].sort((a, b) => a - b);
  const mean = benchStepMs.reduce((a, b) => a + b, 0) / benchStepMs.length;
  const regions = regionStats(machine);
  post({
    type: 'bench',
    epoch,
    stepMs: mean,
    p95StepMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    steps: Math.round(benchSteps / benchStepMs.length),
    droppedMs: droppedMsTotal,
    tickHz: (benchStepMs.length * 1000) / dt,
    maxGapMs: benchMaxGapMs,
    autosaveMs: benchAutosaveMs,
    calibMs: benchCalibMs,
    regionsCompiled: regions.compiled,
    regionsRefused: regions.refused,
  });
  benchSteps = 0;
  benchStepMs = [];
  benchWindowStart = now;
  benchMaxGapMs = 0;
  benchAutosaveMs = 0;
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  const now = performance.now();
  if (!tickTarget) tickTarget = now;
  tickTarget += TICK_MS;
  if (tickTarget < now) tickTarget = now;
  setTimeout(tick, Math.max(0, tickTarget - now));
}

function tick(): void {
  scheduled = false;
  const m = machine;
  if (!m || paused || halted) return;
  const now = performance.now();
  const stall = stalls.beat(now);
  if (stall) { diagLog.add('speed', stall); console.log('[speed]', stall); }
  const real = lastTickAt ? (now - lastTickAt) / 1000 : 0;
  lastTickAt = now;
  const elapsed = Math.min(real, MAX_CATCHUP_SECONDS);
  droppedMsTotal += (real - elapsed) * 1000;
  benchMaxGapMs = Math.max(benchMaxGapMs, real * 1000);
  let budget = Math.floor(elapsed * m.clockHz);
  const t0 = performance.now();
  let steps = 0;
  try {
    if (follower) {
      const f = follower;
      budget = f.advance(m, followBudget(budget, f.lag, followBuffer), (k, at) => followCheck(m, k, at));
      if (f.drift && !driftSaid) {
        driftSaid = true;
        post({ type: 'follow-report', epoch, result: null, drift: f.drift });
      }
      if (now - followPosAt >= 250) {
        followPosAt = now;
        post({ type: 'follow-pos', epoch, cycle: f.cycle, lag: f.lag });
      }
    } else {
      steps = runBudget(m, budget, benchStep);
    }
  } catch (e) {
    halted = true;
    diagLog.add('halt', (e as Error).message || 'machine halted');
    console.error('[emu] machine halted', e);
    post({ type: 'halted', epoch, message: (e as Error).message || str('emu.worker.machine_halted') });
    return;
  }
  dwell.ran(m, budget);
  coins.ran(m, budget);
  sendRelay(now, false);
  m.reelBounce?.tick(m.reels, budget);
  const stepMs = performance.now() - t0;
  benchSteps += steps;
  benchStepMs.push(stepMs);
  reelDiag.tick(m);
  diagWatch.tick(m);
  pumpAudioToPort(m, audioPort, audioScratch);
  postFrame(m, stepMs, steps);
  const serial = m.drainSerial?.();
  if (serial?.length) post({ type: 'serial', epoch, events: serial });
  postCoinsIfChanged(m);
  reportBench(now);
  stalls.charge('running the machine', stepMs);
  stalls.charge('handing the picture and sound to the page', performance.now() - t0 - stepMs);
  schedule();
}

let sentCoins = '';

let loadedFrom: { game: Game; wasm?: boolean; noRegions?: boolean } | null = null;
let settingNotes: string[] = [];

function coinsKey(m: Machine): string {
  return (m.coinChutes ?? []).map((c) => `${c.bit}:${c.label}`).join('|');
}

function postCoinsIfChanged(m: Machine): void {
  if (!m.coinChutes) return;
  const key = coinsKey(m);
  if (key === sentCoins) return;
  sentCoins = key;
  post({ type: 'coins', epoch, coins: m.coinChutes.map((c) => ({ ...c })) });
}

function load(req: Extract<EmuRequest, { type: 'load' }>): void {
  coins.clear();
  epoch = req.epoch;
  machine = null;
  if (recorder) { recorder.detach(); recorder = null; }
  relayRec = null;
  relayOut = [];
  relaySeq = 0;
  follower = null;
  checkData.clear();
  driftSaid = false;
  dwell.clear();
  halted = false;
  paused = false;
  seq = 0;
  droppedMsTotal = 0;
  lastTickAt = 0;
  tickTarget = 0;
  stalls.forget();
  benchStep = !!req.benchStep;
  benchSteps = 0;
  benchStepMs = [];
  benchWindowStart = performance.now();
  benchCalibMs = req.bench ? calibrateHost() : 0;
  if (req.noAudio) disableAudioTicks();
  const reads = watchSettingReads(req.game);
  try {
    const m = machineFor(req.game);
    gameName = req.game.name;
    applyOptionKeyState(m, req.optionKeys);
    if (req.snapshot) applyState(m, req.snapshot);
    applyPanelSwitchState(m, req.panelSwitches);
    applyNamedCoins(m, req.namedCoins);
    if (req.powerCycle) powerCycleOrThrow(m);
    layout = frameLayoutFor(req.game.system, m, req.game.layout);
    pool = Array.from({ length: FRAME_POOL }, () => new ArrayBuffer(layout!.byteLength));
    reelDiag.install(m);
    if (req.noRegions) {
      (m as { cpu?: { setRegionsEnabled?: (on: boolean) => void } }).cpu?.setRegionsEnabled?.(false);
    }
    if (req.wasm === false) {
      (m as { useInterpreter?: () => void }).useInterpreter?.();
    } else {
      if (req.wasm === true) (m as { useWasmCore?: () => void }).useWasmCore?.();
      const wm = m as { usingWasm?: boolean };
      if (wm.usingWasm) console.log('[emu] CPU: WebAssembly core (?wasm=0 opts out)');
    }
    machine = m;
    loadedFrom = { game: req.game, wasm: req.wasm, noRegions: req.noRegions };
    if (req.relay) {
      relayRec = recordInto(m, {
        set: gameName, cold: false, clock: { mode: 'pinned', at: req.relay.at }, maxEvents: 0,
        onEvent: (e) => { relayOut.push({ ...e, seq: relaySeq++ }); },
      });
      relaySentAt = performance.now();
    } else if (req.follow) {
      follower = new Follower(req.follow);
      followBuffer = Math.round((req.follow.bufferMs / 1000) * m.clockHz);
    }
    const info = buildMachineInfo(req.game, m, layout);
    settingNotes = reads.finish().map(unreadSettingLine);
    schematic = info.schematic;
    if (info.codegen === 'wasm') {
      console.log(`[emu] ROM optimiser: WASM core executes ${info.system} — the JS interpreter/dynarec is off`);
    } else if (req.noRegions && info.codegen === 'regions') {
      console.log(`[emu] ROM optimiser: DISABLED by ?regions=0 — predecode/execFast only (${info.system})`);
    } else if (info.codegen === 'regions') {
      console.log(`[emu] ROM optimiser: region compiler active — hot ${info.system} ROM code recompiles to JS as it runs`);
    } else if (info.codegen === 'predecode') {
      console.log(`[emu] ROM optimiser: predecoded dispatch active for ${info.system}`);
    } else {
      console.log(`[emu] ROM optimiser: none for ${info.system} — plain interpreter`);
    }
    sentCoins = coinsKey(m);
    systemName = info.system;
    inputLabels = {};
    coinLabels = {};
    diagLog.clear();
    diagWatch.install(
      m, gameName, systemName, undrawnLayoutNotes(req.game.layout), req.game.layout, settingNotes,
    );
    post({ type: 'loaded', epoch, info });
    schedule();
  } catch (e) {
    reads.finish();
    post({ type: 'load-error', epoch, message: (e as Error).message || str('emu.worker.load_failed') });
  }
}

function clearRam(req: Extract<EmuRequest, { type: 'clear-ram' }>): string | null {
  const old = machine;
  if (!old || !loadedFrom) return 'no machine is running';
  if (relayRec || follower) return 'not while this machine is being watched';
  let m: Machine;
  let fresh: FrameLayout;
  try {
    m = rebuildWithBlankMemory(machineFor, loadedFrom.game, old, {
      optionKeys: req.optionKeys, panelSwitches: req.panelSwitches, namedCoins: req.namedCoins,
      wasm: loadedFrom.wasm, noRegions: loadedFrom.noRegions,
    });
    fresh = frameLayoutFor(loadedFrom.game.system, m, loadedFrom.game.layout);
  } catch (e) {
    console.warn('[emu] clear RAM failed', e);
    return (e as Error).message || 'the machine could not be rebuilt';
  }
  if (!sameFrameLayout(layout, fresh)) return 'the rebuilt machine does not match the one on screen';
  if (recorder) { recorder.detach(); recorder = null; }
  dwell.clear();
  coins.clear();
  halted = false;
  lastTickAt = 0;
  tickTarget = 0;
  stalls.forget();
  reelDiag.install(m);
  machine = m;
  sentCoins = coinsKey(m);
  diagWatch.install(
    m, gameName, systemName, undrawnLayoutNotes(loadedFrom.game.layout), loadedFrom.game.layout, settingNotes,
  );
  diagLog.add('reset', 'memory cleared: the machine restarted as new, money totals kept');
  pushAutosave(performance.now(), 'clear-ram');
  if (!paused) schedule();
  return null;
}

function handle(req: EmuRequest): void {
  switch (req.type) {
    case 'load':
      load(req);
      return;
    case 'audio-port':
      audioPort?.close();
      audioPort = req.port;
      audioPort.onmessage = (e: MessageEvent) => {
        const text = audioReportText(e.data);
        if (text) { diagLog.add('audio', text); console.log('[audio]', text); }
      };
      return;
    case 'return-buffer':
      if (layout && req.buf.byteLength === layout.byteLength && pool.length < FRAME_POOL) {
        pool.push(req.buf);
      }
      return;
    default:
      break;
  }
  if (req.epoch !== epoch || !machine) return;
  const m = machine;
  if (follower && (req.type === 'input' || req.type === 'coin' || req.type === 'note' || req.type === 'name-coin'
    || req.type === 'reset' || req.type === 'power-cycle' || req.type === 'fit-key' || req.type === 'record-start')) return;
  switch (req.type) {
    case 'input':
      diagLog.add('input', `${req.on ? 'press' : 'release'} ${inputName(req.id)}`);
      if (req.on) diagWatch.pressed();
      if (req.on) dwell.press(m, req.id);
      else dwell.release(m, req.id);
      break;
    case 'coin':
      coins.offer(m, req.bit);
      break;
    case 'name-coin':
      m.nameCoin?.(req.line, req.coin);
      break;
    case 'note':
      diagLog.add('coin', offerNote(m, req.billType, req.parallel === true));
      break;
    case 'record-start': {
      if (recorder) recorder.detach();
      recorder = recordInto(m, {
        set: gameName,
        setHash: req.setHash,
        cold: req.cold,
        clock: { mode: 'pinned', at: req.at ?? Date.now() },
      });
      diagLog.add('input', `recording armed (${req.cold ? 'cold' : 'from battery'})`);
      break;
    }
    case 'keyframe': {
      if (!relayRec) { post({ type: 'keyframe-result', id: req.id, key: null }); break; }
      try {
        sendRelay(performance.now(), true);
        settleSound(m);
        const snap = captureState(m, gameName);
        const data = deflateSync(strToU8(JSON.stringify(snap)));
        post({
          type: 'keyframe-result', id: req.id,
          key: {
            cycle: relayRec.cycles, seq: relaySeq, hash: snapshotHash(snap), signals: signalsOf(m), data, cycles: snap.cycles,
            ledger: m.cashLedger ? { ...m.cashLedger } : null,
          },
        }, [data.buffer]);
      } catch (e) {
        console.warn('[emu] keyframe capture failed', e);
        post({ type: 'keyframe-result', id: req.id, key: null });
      }
      break;
    }
    case 'follow-feed':
      follower?.feed(req.inputs, req.upTo);
      break;
    case 'follow-check':
      if (!follower) break;
      if (req.data) {
        checkData.set(req.check.cycle, req.data);
        for (const c of [...checkData.keys()].sort((a, b) => a - b).slice(0, -4)) checkData.delete(c);
      }
      follower.expect(req.check);
      break;
    case 'record-stop': {
      const out = stopRecording();
      diagLog.add('input', out ? `recording closed: ${out.events.length} inputs` : 'no recording was armed');
      post({ type: 'recording-result', id: req.id, recording: out });
      break;
    }
    case 'reset':
    case 'power-cycle':
      coins.clear();
      try {
        powerCycleOrThrow(m);
        diagLog.add('reset', 'machine restarted with its memory kept');
      } catch (e) {
        console.warn(`[emu] ${(e as Error).message}`);
      }
      break;
    case 'clear-ram':
      post({ type: 'clear-ram-result', id: req.id, error: clearRam(req) ?? undefined });
      break;
    case 'fit-key': {
      const keys = m.optionKeys ?? [];
      keys[req.index]?.fit(req.position);
      post({ type: 'key-fitted', epoch, positions: keys.map((k) => k.position()) });
      coins.clear();
      try {
        powerCycleOrThrow(m);
      } catch (e) {
        console.warn(`[emu] ${(e as Error).message}`);
      }
      break;
    }
    case 'pause':
      sendRelay(performance.now(), true);
      paused = true;
      lastTickAt = 0;
      tickTarget = 0;
      stalls.forget();
      pushAutosave(performance.now(), 'pause');
      break;
    case 'resume':
      paused = false;
      lastTickAt = 0;
      tickTarget = 0;
      stalls.forget();
      if (!halted) schedule();
      break;
    case 'snapshot':
      try {
        const snap = captureState(m, gameName);
        if (diagLog.enabled) snap.diag = [...diagLog.entries()];
        if (req.deflate) {
          const data = deflateSync(strToU8(JSON.stringify(snap)));
          post({ type: 'snapshot-result', id: req.id, data, cycles: snap.cycles }, [data.buffer]);
        } else {
          post({ type: 'snapshot-result', id: req.id, snap, cycles: snap.cycles });
        }
      } catch (e) {
        console.warn('[emu] snapshot capture failed', e);
        post({ type: 'snapshot-result', id: req.id, cycles: 0 });
      }
      break;
    case 'diag-ram': {
      const mm = m as unknown as { ram?: Uint8Array; diagPeek?: (a: number) => number };
      const ram = mm.ram;
      post({
        type: 'diag-result',
        id: req.id,
        values: req.addrs.map((a) => (mm.diagPeek ? mm.diagPeek(a)
          : ram && a < ram.length ? ram[a] : -1)),
      });
      break;
    }
    case 'ledger': {
      const l = m.cashLedger;
      post({ type: 'ledger-result', id: req.id, ledger: l ? { ...l } : null });
      break;
    }
    case 'io-activity':
      post({ type: 'io-activity-result', id: req.id, counts: readIoCounts(m, schematic) });
      break;
    case 'diag-log': {
      const was = diagLog.enabled;
      diagLog.setEnabled(req.on);
      if (req.on && !was) diagWatch.announce(m, gameName, systemName);
      break;
    }
    case 'diag-log-clear':
      diagLog.clear();
      if (diagLog.enabled) diagWatch.announce(m, gameName, systemName);
      break;
    case 'diag-log-read':
      post({ type: 'diag-log-result', id: req.id, entries: [...diagLog.entries()] });
      break;
    case 'diag-audio':
      diagLog.add('audio', req.text);
      break;
    case 'diag-speed':
      diagLog.add('speed', req.text);
      break;
    case 'input-labels':
      inputLabels = req.labels;
      coinLabels = req.coins ?? {};
      break;
  }
}

function stallPart(type: EmuRequest['type']): string | null {
  switch (type) {
    case 'load': return null;
    case 'pause': case 'snapshot': return 'saving the game';
    case 'io-activity': return 'the board diagram';
    default: return 'answering the page';
  }
}

self.addEventListener('message', (ev: MessageEvent<EmuRequest>) => {
  const t0 = performance.now();
  handle(ev.data);
  const part = stallPart(ev.data.type);
  if (part) stalls.charge(part, performance.now() - t0);
});
