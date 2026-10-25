import type { Room } from './room';
import { glassTotals } from './glass';
import { str } from '../web/i18n';
import { gpuName, quantile, r1, saveFile, tableOf, type TraceSource } from '../web/trace';
import { switchesSaid } from './roomperf';

const PLAN: { label: string; query: string }[] = [
  { label: str('arcade.roombench.as_shipped'), query: '' },
  { label: str('arcade.roombench.env_0_cabinets_unlit'), query: 'env=0' },
  { label: str('arcade.roombench.dpr_2_old'), query: 'dpr=2' },
  { label: str('arcade.roombench.dpr_1'), query: 'dpr=1' },
  { label: str('arcade.roombench.glass_0_attract_still'), query: 'glass=0' },
  { label: str('arcade.roombench.spot_lights_old'), query: 'lights=12&pools=0' },
  { label: str('arcade.roombench.glow_1_glasses_light_their'), query: 'glow=1' },
];
const RUNS = 2;
const WARM_MS = 15_000;
const MEASURE_MS = 20_000;

const LIVE_PLAN: { label: string; set: Parameters<Room['setLiveSwitches']>[0] }[] = [
  { label: str('arcade.roombench.as_shipped'), set: {} },
  { label: str('arcade.roombench.freeze_0_others_play_on'), set: { focusFreeze: false } },
  { label: str('arcade.roombench.glow_1_glasses_light_their'), set: { glow: true } },
  { label: str('arcade.roombench.lamp_0_no_lamp_over'), set: { lamp: false } },
  { label: str('arcade.roombench.dim_0_room_and_other'), set: { dim: false } },
  { label: str('arcade.roombench.dpr_1_1_73_of'), set: { dpr: 1.1 } },
];
const LIVE_WARM_MS = 3_000;
const LIVE_MEASURE_MS = 12_000;
export const LIVE_BENCH_KEY = 'F9';

const KEY = 'fruitulator.arcade.bench';
const SWITCHES = ['lights', 'pools', 'shade', 'tex', 'aniso', 'dpr', 'aa', 'env', 'glass', 'glasstex',
  'glassps', 'glassnear', 'freeze', 'dim', 'glow', 'lamp', 'stats'];

export interface BenchRun {
  label: string;
  query: string;
  frames: number;
  medianMs: number;
  p95Ms: number;
  meanMs: number;
  fps: number;
  gpuMedianMs: number | null;
  gpuP95Ms: number | null;
  gpuDropped: number | null;
  scriptMs: number;
  paintsPerSec: number;
  layoutMs: number;
  copyMs: number;
  draws: number;
  px: string;
  dpr: number;
  patchesPerSec?: number;
  wholesPerSec?: number;
  droppedMs?: number;
  emuFramesPerSec?: number;
  emuGapP95Ms?: number;
  emuGapMaxMs?: number;
  longTasks?: number;
  longTaskMs?: number;
  speedPct?: number;
  stepMeanMs?: number;
  stepP95Ms?: number;
}

interface BenchState {
  step: number;
  order: number[];
  runs: BenchRun[];
  startedAt: number;
}

const load = (): BenchState | null => {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as BenchState | null; } catch { return null; }
};
const save = (s: BenchState | null): void => {
  try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch {  }
};

function addressFor(state: BenchState | null, step: number): string {
  const u = new URL(location.href);
  for (const k of SWITCHES) u.searchParams.delete(k);
  u.searchParams.delete('bench');
  if (!state || step >= state.order.length) {
    u.searchParams.set('bench', 'done');
    return u.href;
  }
  u.searchParams.set('bench', 'run');
  for (const [k, v] of new URLSearchParams(PLAN[state.order[step]].query)) u.searchParams.set(k, v);
  return u.href;
}

export class GpuTimer {
  readonly ms: number[] = [];
  dropped = 0;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: WebGLQuery[] = [];
  private current: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  }

  get available(): boolean { return !!this.ext; }

  begin(): void {
    if (!this.ext || this.current) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.current = q;
  }

  end(): void {
    if (!this.ext || !this.current) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.current);
    this.current = null;
    this.collect();
  }

  private collect(): void {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext!.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!disjoint) this.ms.push(ns / 1e6);
      else this.dropped++;
      gl.deleteQuery(q);
      this.pending.shift();
    }
  }
}

export function benchMode(search = location.search): 'start' | 'run' | 'done' | null {
  const v = new URLSearchParams(search).get('bench');
  if (v === null) return null;
  return v === 'run' ? 'run' : v === 'done' ? 'done' : 'start';
}

export async function runBench(room: Room, say: (text: string) => void): Promise<void> {
  const mode = benchMode();
  if (mode === 'start') {
    const order: number[] = [];
    for (let r = 0; r < RUNS; r++) for (let i = 0; i < PLAN.length; i++) order.push(i);
    const state: BenchState = { step: 0, order, runs: [], startedAt: Date.now() };
    save(state);
    location.replace(addressFor(state, 0));
    return;
  }
  const state = load();
  if (mode === 'done') {
    showResults(state, say);
    save(null);
    return;
  }
  if (!state) { say(str('arcade.roombench.benchmark_its_progress_was_lost')); return; }
  const cfg = PLAN[state.order[state.step]];
  const n = `${state.step + 1}/${state.order.length}`;
  room.shotView('aisle');
  for (let t = WARM_MS; t > 0; t -= 1000) {
    say(str('arcade.roombench.benchmark_n_n_warming_up', { 0: n, 1: cfg.label, 2: Math.ceil(t / 1000) }));
    await new Promise((r) => setTimeout(r, Math.min(1000, t)));
  }
  room.shotView('aisle');
  const timer = room.startGpuTimer();
  room.perf();
  const script0 = room.frameTimings().length;
  const deltas: number[] = [];
  let last = 0;
  const t0 = performance.now();
  await new Promise<void>((done) => {
    const tick = (now: number): void => {
      if (last) deltas.push(now - last);
      last = now;
      if (now - t0 < MEASURE_MS) {
        if (deltas.length % 30 === 0) say(str('arcade.roombench.benchmark_n_n_measuring_n', { 0: n, 1: cfg.label, 2: Math.ceil((MEASURE_MS - (now - t0)) / 1000) }));
        requestAnimationFrame(tick);
      } else done();
    };
    requestAnimationFrame(tick);
  });
  const secs = (performance.now() - t0) / 1000;
  const p = room.perf();
  room.stopGpuTimer();
  const script = room.frameTimings().slice(script0);
  const mean = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
  state.runs.push({
    label: cfg.label, query: cfg.query, frames: deltas.length,
    medianMs: r1(quantile(deltas, 0.5)), p95Ms: r1(quantile(deltas, 0.95)), meanMs: r1(mean), fps: r1(1000 / mean),
    gpuMedianMs: timer?.available && timer.ms.length ? r1(quantile(timer.ms, 0.5)) : null,
    gpuP95Ms: timer?.available && timer.ms.length ? r1(quantile(timer.ms, 0.95)) : null,
    gpuDropped: timer?.available ? timer.dropped : null,
    scriptMs: r1(script.reduce((a, b) => a + b, 0) / Math.max(1, script.length)),
    paintsPerSec: r1(p.paints / secs), layoutMs: p.layoutMs, copyMs: p.copyMs,
    draws: p.calls, px: p.px, dpr: p.dpr,
  });
  state.step++;
  save(state);
  location.replace(addressFor(state, state.step));
}

let liveBenchRunning = false;

export async function runLiveBench(room: Room, say: (text: string) => void): Promise<boolean> {
  if (liveBenchRunning) return false;
  if (!room.live.running) { say(str('arcade.roombench.live_bench_stand_at_a')); return false; }
  liveBenchRunning = true;
  const sw = room.switches;
  const before = { focusFreeze: sw.focusFreeze, dim: sw.dim, dpr: sw.dpr, glow: sw.glow, lamp: sw.lamp };
  const runs: BenchRun[] = [];
  const startedAt = Date.now();
  try {
    const order: number[] = [];
    for (let r = 0; r < RUNS; r++) for (let i = 0; i < LIVE_PLAN.length; i++) order.push(i);
    for (let step = 0; step < order.length; step++) {
      const cfg = LIVE_PLAN[order[step]];
      const n = `${step + 1}/${order.length}`;
      room.setLiveSwitches({ ...before, ...cfg.set });
      for (let t = LIVE_WARM_MS; t > 0; t -= 1000) {
        say(str('arcade.roombench.live_bench_n_n_keep', { 0: n, 1: cfg.label, 2: Math.ceil(t / 1000) }));
        await new Promise((r) => setTimeout(r, Math.min(1000, t)));
      }
      runs.push(await sampleWindow(room, (left) => say(str('arcade.roombench.live_bench_n_n_measuring', { 0: n, 1: cfg.label, 2: left })), cfg.label, LIVE_MEASURE_MS));
      if (!room.live.running) { say(str('arcade.roombench.live_bench_the_machine_stopped')); break; }
    }
  } finally {
    room.setLiveSwitches(before);
    liveBenchRunning = false;
  }
  showResults({ step: 0, order: [], runs, startedAt }, say, 'arcade-livebench', `${LIVE_WARM_MS / 1000} s warm, ${LIVE_MEASURE_MS / 1000} s measured per setting, playing`);
  return true;
}

async function sampleWindow(room: Room, tick: (secondsLeft: number) => void, label: string, ms: number): Promise<BenchRun> {
  const timer = room.startGpuTimer();
  room.perf();
  const dropped0 = room.live.emu.droppedMs();
  const machine0 = room.live.emu.machineS();
  const frames0 = room.live.emu.framesReceived();
  const deltas: number[] = [];
  const emuGaps: number[] = [];
  const stepMs: number[] = [];
  let lastSeq = room.live.emu.latestFrame()?.seq ?? -1;
  let lastNew = 0;
  let longTasks = 0;
  let longTaskMs = 0;
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) { longTasks++; longTaskMs += e.duration; } });
    observer.observe({ type: 'longtask', buffered: false });
  } catch { observer = null; }
  let last = 0;
  const t0 = performance.now();
  await new Promise<void>((done) => {
    const step = (now: number): void => {
      if (last) deltas.push(now - last);
      last = now;
      const v = room.live.emu.latestFrame();
      const seq = v?.seq ?? -1;
      if (seq !== lastSeq) { if (lastNew) emuGaps.push(now - lastNew); lastNew = now; lastSeq = seq; if (v) stepMs.push(v.stepMs); }
      if (now - t0 < ms) {
        if (deltas.length % 30 === 0) tick(Math.ceil((ms - (now - t0)) / 1000));
        requestAnimationFrame(step);
      } else done();
    };
    requestAnimationFrame(step);
  });
  const secs = (performance.now() - t0) / 1000;
  observer?.disconnect();
  const p = room.perf();
  room.stopGpuTimer();
  const all = room.frameTimings();
  const script = all.slice(-Math.min(all.length, deltas.length));
  const mean = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
  return {
    label, query: '', frames: deltas.length,
    medianMs: r1(quantile(deltas, 0.5)), p95Ms: r1(quantile(deltas, 0.95)), meanMs: r1(mean), fps: r1(1000 / mean),
    gpuMedianMs: timer?.available && timer.ms.length ? r1(quantile(timer.ms, 0.5)) : null,
    gpuP95Ms: timer?.available && timer.ms.length ? r1(quantile(timer.ms, 0.95)) : null,
    gpuDropped: timer?.available ? timer.dropped : null,
    scriptMs: r1(script.reduce((a, b) => a + b, 0) / Math.max(1, script.length)),
    paintsPerSec: r1(p.paints / secs), patchesPerSec: r1(p.patches / secs), wholesPerSec: r1(p.wholes / secs),
    droppedMs: r1(room.live.emu.droppedMs() - dropped0),
    speedPct: Math.round(((room.live.emu.machineS() - machine0) / secs) * 100),
    stepMeanMs: r1(stepMs.reduce((a, b) => a + b, 0) / Math.max(1, stepMs.length)), stepP95Ms: r1(quantile(stepMs, 0.95)),
    emuFramesPerSec: r1((room.live.emu.framesReceived() - frames0) / secs), emuGapP95Ms: r1(quantile(emuGaps, 0.95)), emuGapMaxMs: r1(emuGaps.length ? Math.max(...emuGaps) : 0),
    longTasks: observer ? longTasks : -1, longTaskMs: observer ? r1(longTaskMs) : -1,
    layoutMs: p.layoutMs, copyMs: p.copyMs,
    draws: p.calls, px: p.px, dpr: p.dpr,
  };
}

export function roomTraceSource(room: Room): TraceSource {
  let mine: GpuTimer | null = null;
  return {
    emu: room.live.emu,
    running: () => room.live.running,
    gpuMs: () => {
      const t = room.currentGpuTimer();
      if (t === null && !liveBenchRunning) mine = room.startGpuTimer();
      else if (t !== mine) mine = null;
      return mine?.available ? mine.ms.splice(0) : null;
    },
    glass: () => glassTotals,
    scriptMs: () => room.frameScriptTotalMs(),
    describe: () => `${room.canvasSaid()}, ${switchesSaid(room.switches)}, ${room.playedGlassSaid}`,
  };
}

function showResults(state: BenchState | null, say: (text: string) => void, file = 'arcade-bench', how = `warm-up ${WARM_MS / 1000} s, measured ${MEASURE_MS / 1000} s per run`): void {
  if (!state || !state.runs.length) { say(str('arcade.roombench.benchmark_no_results_here_start')); return; }
  const gpu = gpuName();
  const live = state.runs.some((r) => r.patchesPerSec !== undefined);
  const liveCols = ['speed %', 'step ms', 'step p95', 'patches/s', 'wholes/s', 'dropped ms', 'emu f/s', 'emu gap p95', 'emu gap max', 'long tasks', 'long ms'];
  const head = ['setting', 'fps', 'median ms', 'p95 ms', 'GPU med ms', 'GPU p95 ms', 'GPU dropped', 'script ms', 'paints/s', ...(live ? liveCols : []), 'layout ms', 'copy ms', 'draws', 'canvas'];
  const rows = state.runs.map((r) => [r.label, r.fps, r.medianMs, r.p95Ms, r.gpuMedianMs ?? '-', r.gpuP95Ms ?? '-', r.gpuDropped ?? '-', r.scriptMs,
    r.paintsPerSec, ...(live ? [r.speedPct ?? '-', r.stepMeanMs ?? '-', r.stepP95Ms ?? '-', r.patchesPerSec ?? '-', r.wholesPerSec ?? '-', r.droppedMs ?? '-', r.emuFramesPerSec ?? '-', r.emuGapP95Ms ?? '-', r.emuGapMaxMs ?? '-', r.longTasks ?? '-', r.longTaskMs ?? '-'] : []), r.layoutMs, r.copyMs, r.draws, `${r.px}@${r.dpr}`].map(String));
  const table = tableOf(head, rows);
  const text = `Arcade room benchmark, ${new Date(state.startedAt).toISOString()}\n${gpu}\n${navigator.userAgent}\n`
    + `${how}\n\n${table}\n`;
  say(text);
  saveFile(file, state.startedAt, { text, gpu, userAgent: navigator.userAgent, how, runs: state.runs });
}
