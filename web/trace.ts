import type { FrameView } from '../src/machine/framestate';
import { str } from './i18n';

export const TRACE_KEY = 'F8';
export const TRACE_SECONDS = 30;
export const PLAIN_PAGE_NOTE = 'plain 2D page';

export const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
export const r1 = (x: number): number => Math.round(x * 10) / 10;

export function gpuName(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return gl ? String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL2';
}

export function tableOf(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]): string => cells.map((c, i) => (i ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ');
  return [line(head), ...rows.map(line)].join('\n');
}

export function saveFile(file: string, at: number, payload: unknown): string {
  const name = `${file}-${new Date(at).toISOString().replace(/[:.]/g, '-')}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  return name;
}

export interface GlassTotals {
  n: number; patches: number; wholes: number; layoutMs: number; copyMs: number; patchPx: number;
  bitmapMs: number;
  parts: number;
}

export interface TraceSource {
  readonly emu: { latestFrame(): FrameView | null; framesReceived(): number; droppedMs(): number; machineS(): number };
  running(): boolean;
  gpuMs(): number[] | null;
  glass(): GlassTotals;
  scriptMs(): number;
  describe(): string;
}

export interface TraceRow {
  ago: number;
  frames: number;
  p95Ms: number;
  maxMs: number;
  scriptMs: number;
  gpuMedMs: number | null;
  gpuMaxMs: number | null;
  paints: number;
  patches: number;
  wholes: number;
  layoutMs: number;
  copyMs: number;
  bitmapMs: number;
  parts: number;
  patchKpx: number;
  emuFrames: number;
  stepMeanMs: number;
  stepMaxMs: number;
  droppedMs: number;
  speedPct: number;
  lampChanges: number;
  longTaskMs: number;
  display: string;
}

export const TRACE_HEAD = ['s ago', 'fps', 'p95 ms', 'max ms', 'script ms', 'GPU med', 'GPU max', 'paints', 'patches', 'wholes',
  'layout ms', 'copy ms', 'bitmap ms', 'parts', 'kpx', 'emu f/s', 'step ms', 'step max', 'dropped', 'speed %', 'lamp chg', 'long ms', 'display'];

export function traceCells(r: TraceRow): string[] {
  return [r.ago, r.frames, r.p95Ms, r.maxMs, r.scriptMs, r.gpuMedMs ?? '-', r.gpuMaxMs ?? '-', r.paints, r.patches, r.wholes,
    r.layoutMs, r.copyMs, r.bitmapMs, r.parts, r.patchKpx, r.emuFrames, r.stepMeanMs, r.stepMaxMs, r.droppedMs, r.speedPct, r.lampChanges, r.longTaskMs, r.display].map(String);
}

export class Recorder {
  private rows: TraceRow[] = [];
  private raf = 0;
  private secStart = 0;
  private last = 0;
  private deltas: number[] = [];
  private steps: number[] = [];
  private gpu: number[] = [];
  private lastSeq = -1;
  private lastLamps: Uint8Array | null = null;
  private lampChanges = 0;
  private glass: GlassTotals = { n: 0, patches: 0, wholes: 0, layoutMs: 0, copyMs: 0, patchPx: 0, bitmapMs: 0, parts: 0 };
  private emu = { frames: 0, dropped: 0, machineS: 0 };
  private script = 0;
  private longTaskMs = 0;
  private observer: PerformanceObserver | null = null;

  constructor(private readonly source: TraceSource, private readonly file: string) {}

  start(): void {
    if (this.raf) return;
    try {
      this.observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) this.longTaskMs += e.duration; });
      this.observer.observe({ type: 'longtask', buffered: false });
    } catch { this.observer = null; }
    this.glass = { ...this.source.glass() };
    const e = this.source.emu;
    this.emu = { frames: e.framesReceived(), dropped: e.droppedMs(), machineS: e.machineS() };
    this.script = this.source.scriptMs();
    this.secStart = performance.now();
    const step = (now: number): void => {
      this.sample(now);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.observer?.disconnect();
  }

  private sample(now: number): void {
    if (this.last) this.deltas.push(now - this.last);
    this.last = now;
    const g = this.source.gpuMs();
    if (g) for (const ms of g) this.gpu.push(ms);
    if (this.source.running()) {
      const v = this.source.emu.latestFrame();
      if (v && v.seq !== this.lastSeq) {
        this.lastSeq = v.seq;
        this.steps.push(v.stepMs);
        const lamps = v.lampsRaw;
        if (this.lastLamps && this.lastLamps.length === lamps.length) {
          for (let i = 0; i < lamps.length; i++) if (lamps[i] !== this.lastLamps[i]) this.lampChanges++;
        }
        this.lastLamps = lamps.slice();
      }
    }
    if (now - this.secStart >= 1000) this.close(now);
  }

  private close(now: number): void {
    const secs = (now - this.secStart) / 1000;
    const g = { ...this.source.glass() };
    const e = this.source.emu;
    const frames = e.framesReceived(), dropped = e.droppedMs(), machineS = e.machineS();
    const script = this.source.scriptMs();
    const v = this.source.running() ? e.latestFrame() : null;
    this.rows.push({
      ago: 0,
      frames: this.deltas.length,
      p95Ms: r1(quantile(this.deltas, 0.95)), maxMs: r1(this.deltas.length ? Math.max(...this.deltas) : 0),
      scriptMs: r1(script - this.script),
      gpuMedMs: this.gpu.length ? r1(quantile(this.gpu, 0.5)) : null, gpuMaxMs: this.gpu.length ? r1(Math.max(...this.gpu)) : null,
      paints: g.n - this.glass.n, patches: g.patches - this.glass.patches, wholes: g.wholes - this.glass.wholes,
      layoutMs: r1(g.layoutMs - this.glass.layoutMs), copyMs: r1(g.copyMs - this.glass.copyMs),
      bitmapMs: r1(g.bitmapMs - this.glass.bitmapMs),
      parts: g.parts - this.glass.parts,
      patchKpx: Math.round((g.patchPx - this.glass.patchPx) / 1000),
      emuFrames: frames - this.emu.frames,
      stepMeanMs: r1(this.steps.reduce((a, b) => a + b, 0) / Math.max(1, this.steps.length)),
      stepMaxMs: r1(this.steps.length ? Math.max(...this.steps) : 0),
      droppedMs: r1(dropped - this.emu.dropped),
      speedPct: Math.round(((machineS - this.emu.machineS) / secs) * 100),
      lampChanges: this.lampChanges,
      longTaskMs: r1(this.longTaskMs),
      display: v?.display?.text().trim() ?? '',
    });
    if (this.rows.length > TRACE_SECONDS) this.rows.splice(0, this.rows.length - TRACE_SECONDS);
    this.glass = g;
    this.emu = { frames, dropped, machineS };
    this.script = script;
    this.deltas = [];
    this.steps = [];
    this.gpu = [];
    this.lampChanges = 0;
    this.longTaskMs = 0;
    this.secStart = now;
  }

  trace(): TraceRow[] {
    const n = this.rows.length;
    return this.rows.map((r, i) => ({ ...r, ago: n - 1 - i }));
  }

  dump(say: (text: string) => void): string | null {
    const rows = this.trace();
    if (!rows.length) { say(str('arcade.roombench.trace_nothing_recorded_yet')); return null; }
    const table = tableOf(TRACE_HEAD, rows.map(traceCells));
    const at = Date.now();
    const how = `the last ${rows.length} s at the machine, a row a second, saved on ${TRACE_KEY}; ${this.source.describe()}`;
    const gpu = gpuName();
    const text = `Trace, ${new Date(at).toISOString()}\n${gpu}\n${navigator.userAgent}\n${how}\n\n${table}\n`;
    say(text);
    return saveFile(this.file, at, { text, gpu, userAgent: navigator.userAgent, how, rows });
  }
}
