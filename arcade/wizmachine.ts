import { FrameView, type FrameLayout } from '../src/machine/framestate';
import { configOf, type Game } from '../src/machine/registry';
import type { CashLedger } from '../src/machine/machine';
import {
  cabinetSurfaces, classifyGlassCore, readGlass, type CabinetSurfaces, type CoreReading,
} from '../src/machine/alarmread';
import { attractFired, attractWhy, busyByItself, keepable, LampFlips, videoPlaying, type Second } from '../src/machine/attractwindow';
import { acceptorResolve, acceptorTakesToken, viewFor } from '../web/platform';
import { controlName } from '../web/controlname';
import { hasInput, type CabLamp } from '../web/dat';
import { hasOperatedSwitches, layoutNamedInputs, namedInputId } from '../web/switchids';
import { CONTENT_RULE } from '../web/store';
import { Glass } from './glass';
import { Live } from './live';
import { digest, layoutDigest, TRACE_FPS } from './trace';
import { runTraceJob, type TraceJobRequest, type TraceJobResponse } from './tracejob';
import type { ArcadeMachine } from './machines';
import type { MachineConfig } from './doc';
import type { Snapshot } from '../web/snapshot';
import { ATTRACT_WINDOW_S } from './bootdoor';
import { str } from '../web/i18n';
import { wiredCoinOn } from '../web/coinask';
import { markedChutes } from './coinwiring';

export const WINDOW_S = ATTRACT_WINDOW_S;
export const TRACE_S = 30;
const VK_SPACE = 32;
const VIDEO_KEEP = 50;
const HEADER_BYTES = 24;
const REEL_BYTES = 12;

export { attractBudgetS } from './bootdoor';

export type HostGate = 'all' | 'none' | 'buttons';

export function hostGate(s: { rec: string; testing: boolean; askStart: boolean; askCoin?: boolean; needHost: boolean; putBack?: boolean }): HostGate {
  if (s.testing) return s.askCoin ? 'all' : s.askStart ? 'buttons' : 'none';
  if (s.needHost) return 'all';
  if (s.putBack && (s.rec === 'looking' || s.rec === 'recording')) return 'none';
  return s.rec === 'recording' ? 'none' : 'all';
}

export function alarmsUnseen(reading: CoreReading | null): boolean {
  return reading?.verdict === 'UNREAD'
    && (reading.unread === 'no-forms' || reading.unread === 'no-signal' || reading.unread === 'no-surface');
}

export const PUT_BACK_AFTER_S = 3 * ATTRACT_WINDOW_S;
export const PUT_BACKS_MAX = 2;

export function lookNext(s: {
  lookedS: number; budgetS: number; snapshot: boolean; putBacks: number; hostHolding: boolean; selfBusy: boolean;
}): 'wait' | 'putBack' | 'askHost' | 'busy' {
  if (s.snapshot && !s.hostHolding && s.putBacks < PUT_BACKS_MAX && s.lookedS >= PUT_BACK_AFTER_S) return 'putBack';
  if (s.lookedS < s.budgetS) return 'wait';
  return s.selfBusy ? 'busy' : 'askHost';
}

export function buttonsOnly(lamps: readonly CabLamp[]): Set<CabLamp> {
  return new Set(lamps.filter((lp) => hasInput(lp) && lp.button >= 0 && !lp.acceptor && lp.coinInput === undefined));
}

export type BootFrom =
  | { kind: 'files' }
  | { kind: 'saved' }
  | { kind: 'cycle'; snap: Snapshot | null };

export class WizardMachine {
  readonly live = new Live();
  readonly glass: Glass;
  secs: Second[] = [];
  reading: CoreReading | null = null;
  travel = 0;
  private videoPlay = false;
  private rec: Uint8Array[] | null = null;
  private recVideo = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: FrameView | null = null;
  private prev: Uint8Array | null = null;
  private secReels = false;
  private secGlass = false;
  private serial0 = -1;
  private serial1 = -1;
  private secT0 = 0;
  private ledgerPrev = 'null';
  private lastTravel: number[] = [];
  private surf: CabinetSurfaces | null = null;
  private secBusy = false;
  private readonly flips = new LampFlips();
  onSecond: ((s: Second) => void) | null = null;

  constructor(readonly machine: ArcadeMachine) {
    this.glass = new Glass(machine);
  }

  get board(): string { return this.machine.board; }

  async open(): Promise<void> {
    await this.glass.load();
    if (this.glass.mode === 'failed') throw new Error(this.glass.note || 'the game could not be opened');
    if (!this.glass.cab || !this.glass.game) throw new Error('this game has no layout to draw');
    this.surf = cabinetSurfaces(this.glass.game.layout, this.glass.game.system);
  }

  async boot(config: MachineConfig, from: BootFrom = { kind: 'files' }): Promise<string> {
    this.stopWatch();
    this.machine.config = config;
    await this.live.start(this.glass, from.kind === 'files'
      ? { cold: true, stampPlay: false, saveOnLeave: false }
      : { snapshot: from.kind === 'cycle' ? from.snap ?? undefined : undefined,
        powerCycle: from.kind === 'cycle', stampPlay: false, saveOnLeave: false });
    if (!this.live.running) throw new Error(this.live.error || 'the machine did not start');
    this.secs = [];
    this.travel = 0;
    this.last = null;
    this.prev = null;
    this.lastTravel = [];
    this.ledgerPrev = JSON.stringify(await this.live.emu.ledger().catch(() => null));
    this.secT0 = performance.now();
    this.secReels = false;
    this.secGlass = false;
    this.flips.reset();
    this.serial0 = -1;
    this.serial1 = -1;
    this.watch();
    return this.live.lastStart?.why ?? '';
  }

  snapshot(): Promise<Snapshot | null> {
    return this.live.emu.snapshot().catch(() => null);
  }

  async restore(snap: Snapshot): Promise<void> {
    this.stopWatch();
    await this.live.start(this.glass, { snapshot: snap, stampPlay: false, saveOnLeave: false });
    if (!this.live.running) throw new Error(this.live.error || 'the machine could not be put back');
    this.secs = [];
    this.travel = 0;
    this.last = null;
    this.prev = null;
    this.lastTravel = [];
    this.ledgerPrev = JSON.stringify(await this.live.emu.ledger().catch(() => null));
    this.secT0 = performance.now();
    this.secReels = false;
    this.secGlass = false;
    this.flips.reset();
    this.serial0 = -1;
    this.serial1 = -1;
    this.watch();
  }

  private watch(): void {
    this.stopWatch();
    this.timer = setInterval(() => this.sample(), 1000 / TRACE_FPS);
  }

  stopWatch(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get held(): boolean { return this.live.paused; }

  hold(): void {
    if (!this.live.running || this.live.paused) return;
    this.stopWatch();
    this.live.pause();
  }

  carryOn(): void {
    if (!this.live.paused) return;
    this.live.resume();
    if (!this.live.running) return;
    this.secT0 = performance.now();
    this.secReels = false;
    this.secGlass = false;
    this.watch();
  }

  dropRecording(): void {
    this.rec = null;
    this.recVideo = 0;
  }

  paint(texMax: number): boolean {
    return this.live.frame(texMax);
  }

  get layout(): FrameLayout | null { return this.live.emu.info?.layout ?? null; }

  private sample(): void {
    const v = this.live.emu.latestFrame();
    const fl = this.layout;
    if (v && fl && v !== this.last) {
      this.last = v;
      const f = new Uint8Array(v.buf.slice(0));
      const glassLo = HEADER_BYTES + fl.reelCount * REEL_BYTES;
      const glassHi = fl.byteLength - fl.effectBytes - (fl.partSoundBytes ?? 0) - fl.udfBytes - fl.videoBytes;
      if (this.prev) {
        for (let i = HEADER_BYTES; i < glassLo && !this.secReels; i++) {
          if (((i - HEADER_BYTES) % REEL_BYTES) < 10 && f[i] !== this.prev[i]) this.secReels = true;
        }
        for (let i = glassLo; i < glassHi && !this.secGlass; i++) if (f[i] !== this.prev[i]) this.secGlass = true;
      }
      if (fl.videoBytes && !fl.reelCount) {
        this.serial1 = new DataView(f.buffer).getUint32(fl.byteLength - fl.videoBytes, true);
        if (this.serial0 < 0) this.serial0 = this.serial1;
      }
      this.flips.feed(v);
      v.reels.forEach((r, i) => {
        const was = this.lastTravel[i];
        if (was !== undefined) this.travel += Math.abs(r.travel - was);
        this.lastTravel[i] = r.travel;
      });
      this.prev = f;
      if (this.rec) {
        if (fl.videoBytes && this.recVideo >= VIDEO_KEEP) this.rec.push(f.slice(0, fl.byteLength - fl.videoBytes));
        else { this.rec.push(f); if (fl.videoBytes) this.recVideo++; }
      }
    } else if (this.rec && this.prev) {
      const fl2 = this.layout!;
      this.rec.push(fl2.videoBytes && this.recVideo >= VIDEO_KEEP ? this.prev.slice(0, fl2.byteLength - fl2.videoBytes) : this.prev.slice());
    }
    if (performance.now() - this.secT0 >= 1000 && !this.secBusy) void this.endSecond();
  }

  private async endSecond(): Promise<void> {
    this.secBusy = true;
    this.secT0 += 1000;
    const reels = this.secReels;
    const glass = this.secGlass;
    this.secReels = false;
    this.secGlass = false;
    try {
      const l = JSON.stringify(await this.live.emu.ledger().catch(() => null));
      const ledger = l !== this.ledgerPrev;
      this.ledgerPrev = l;
      const g = this.last && this.glass.game ? readGlass(this.last, this.glass.game.layout, this.surf ?? undefined) : null;
      const reading = g ? classifyGlassCore(this.board, g) : null;
      this.reading = reading;
      const s: Second = {
        t: this.secs.length + 1, reels, ledger, glass, alarm: reading?.verdict === 'ALARM', line: reading?.glass ?? '',
        lamps: this.flips.take(), pics: this.flips.takePictures(),
        ...(this.serial1 >= 0 ? { video: (this.serial1 - this.serial0) >>> 0 } : {}),
      };
      this.serial0 = this.serial1;
      if (videoPlaying(s)) this.videoPlay = true;
      this.secs.push(s);
      this.onSecond?.(s);
    } finally {
      this.secBusy = false;
    }
  }

  glassReadable(): boolean {
    return !!this.surf && (this.surf.hasAlpha || this.surf.hasDigits);
  }

  resetVideoPlay(): void { this.videoPlay = false; }
  videoPlayed(): boolean { return this.videoPlay; }
  attract(): boolean { return attractFired(this.secs, WINDOW_S); }
  selfBusy(): boolean { return busyByItself(this.secs, WINDOW_S); }
  why(): string { return attractWhy(this.secs, WINDOW_S); }

  async until(test: () => boolean, ms: number, abort?: () => boolean): Promise<boolean> {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (test()) return true;
      if (abort?.()) return false;
      await new Promise((r) => setTimeout(r, 200));
    }
    return test();
  }

  coinsStopped(): boolean {
    return this.live.emu.coinWiringStatus?.state === 'disagrees';
  }

  ledger(): Promise<CashLedger | null> {
    return this.live.emu.ledger().catch(() => null);
  }

  coinSlot(): { line: number; pence: number | null; from: 'layout' | 'machine' } | null {
    const game = this.glass.game;
    const cab = this.glass.cab;
    const info = this.live.emu.info;
    if (!game || !cab || !info) return null;
    const view = viewFor(game.system);
    const chutes: { bit: number; pence: number | null; token: boolean }[] = info.coins
      ? info.coins.map((c) => ({ bit: c.bit, pence: c.pence ?? null, token: !!c.token }))
      : view.coins.map((c) => ({ bit: c.bit, pence: null, token: /token/i.test(c.label) }));
    const wiring = this.live.coinWiring?.() ?? {};
    const priceOf = (line: number): number | null => {
      const w = wiredCoinOn(wiring, line);
      if (typeof w === 'number') return w;
      return chutes.find((c) => c.bit === line)?.pence ?? null;
    };
    const creditsNone = (line: number): boolean => info.coinTable?.lines.find((l) => l.line === line)?.credits === 0;
    const worth = (line: number, pence: number | null): number => (creditsNone(line) ? -2 : pence ?? -1);
    let best: { line: number; pence: number | null; from: 'layout' } | null = null;
    for (const lp of cab.lamps) {
      if (!lp.acceptor) continue;
      const got = acceptorResolve(view, lp, info.coins, info.coinPort);
      if (got.kind === 'note' || got.line < 0) continue;
      if (acceptorTakesToken(view, lp, got.line, info.coins)) continue;
      const pence = priceOf(got.line);
      if (!best || worth(got.line, pence) > worth(best.line, best.pence)) best = { line: got.line, pence, from: 'layout' };
    }
    if (best) return best;
    for (const c of markedChutes(wiring, info)) {
      const coin = wiredCoinOn(wiring, c.bit);
      if (typeof coin !== 'number') continue;
      if (!best || worth(c.bit, coin) > worth(best.line, best.pence)) best = { line: c.bit, pence: coin, from: 'layout' };
    }
    if (best) return best;
    const coins = chutes.filter((c) => !c.token);
    if (!coins.length) return null;
    const top = coins.reduce((a, b) => (worth(b.bit, b.pence) > worth(a.bit, a.pence) ? b : a));
    return { line: top.bit, pence: top.pence, from: 'machine' };
  }

  async coin(line: number): Promise<void> {
    await this.until(() => !this.live.emu.latestFrame()?.coinBusy, 3000);
    this.live.emu.coin(line);
  }

  startCaps(): { lp: CabLamp; name: string }[] {
    const game = this.glass.game;
    const cab = this.glass.cab;
    const info = this.live.emu.info;
    if (!game || !cab || !info) return [];
    const view = viewFor(game.system);
    const measured: { lp: CabLamp; name: string }[] = [];
    const named: { lp: CabLamp; name: string }[] = [];
    const keyed: { lp: CabLamp; name: string }[] = [];
    const seen = new Set<number>();
    for (const lp of cab.lamps) {
      if (!hasInput(lp) || lp.button < 0 || lp.acceptor || seen.has(lp.button)) continue;
      const name = controlName(lp, view, info.coins ?? view.coins, info.capNames, info.coinPort);
      if (info.capNames?.[lp.button]?.role === 'start') { measured.push({ lp, name }); seen.add(lp.button); continue; }
      if (/\bstart\b/i.test(name)) { named.push({ lp, name }); seen.add(lp.button); continue; }
      if (lp.shortcut === VK_SPACE || lp.shortcut2 === VK_SPACE) keyed.push({ lp, name: 'Start' });
    }
    return [...measured, ...named, ...keyed];
  }

  async tap(lp: CabLamp, ms = 300): Promise<void> {
    this.live.hold(lp, -9001);
    await new Promise((r) => setTimeout(r, ms));
    this.live.release(-9001);
  }

  refillSwitch(): { label: string; set: (on: boolean) => void } | null {
    const info = this.live.emu.info;
    const game = this.glass.game;
    if (!info || !game) return null;
    const emu = this.live.emu;
    const row = info.switchPanel.find((sw) => !sw.option && /refill/i.test(sw.label));
    if (row) return { label: row.label, set: (on) => emu.input(row.id, on) };
    if (hasOperatedSwitches(info)) return null;
    const n = layoutNamedInputs(viewFor(game.system).namedInputs, info.switchIds ?? {}, info.switchPresets)
      .find((x) => x.control === 'Refill' || /refill/i.test(x.label));
    if (!n) return null;
    return { label: n.label, set: (on) => emu.input(namedInputId(n), n.invert ? !on : on) };
  }

  startRecording(): void {
    this.rec = [];
    this.recVideo = 0;
    const game = this.glass.game;
    if (game) void this.roomShape(game).catch(() => undefined);
  }

  private shape: { game: Game; p: Promise<string> } | null = null;
  private roomShape(game: Game): Promise<string> {
    if (this.shape?.game !== game) {
      const p: Promise<string> = traceJob({ id: 0, kind: 'shape', game }).then((r) => {
        if (!r.ok) throw new Error(r.message);
        if (r.kind !== 'shape') throw new Error('the recording worker answered another question');
        return r.digest;
      });
      p.catch(() => { if (this.shape?.p === p) this.shape = null; });
      this.shape = { game, p };
    }
    return this.shape.p;
  }

  async finishRecording(config: MachineConfig): Promise<{ bytes: Uint8Array; frames: number; sameShape: boolean }> {
    const frames = this.rec ?? [];
    this.rec = null;
    const fl = this.layout;
    const game = this.glass.game;
    if (!fl || !game || !frames.length) throw new Error('nothing was recorded');
    const shape = this.roomShape(game);
    const keep = this.prev?.buffer;
    const transfer = [...new Set(frames.map((f) => f.buffer as ArrayBuffer))].filter((b) => b !== keep);
    const r = await traceJob({
      id: 0,
      kind: 'encode',
      job: {
        contentHash: this.machine.contentHash,
        contentRule: CONTENT_RULE,
        configKey: digest(JSON.stringify([configOf(game), config])),
        layout: fl,
        frames,
      },
    }, transfer);
    if (!r.ok) throw new Error(r.message);
    if (r.kind !== 'encode') throw new Error('the recording worker answered another question');
    return { bytes: r.bytes, frames: r.frames, sameShape: (await shape) === layoutDigest(fl) };
  }

  get recording(): boolean { return this.rec !== null; }
  get recorded(): number { return this.rec?.length ?? 0; }

  quietFor(n: number): boolean {
    const w = this.secs.slice(-n);
    return w.length >= n && keepable(w);
  }

  saveNow(): Promise<void> {
    this.stopWatch();
    return this.live.saveNow();
  }
}

function traceJob(req: TraceJobRequest, transfer: Transferable[] = []): Promise<TraceJobResponse> {
  if (typeof Worker === 'undefined') return runTraceJob(req);
  return new Promise((resolve) => {
    const w = new Worker(new URL('./trace.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<TraceJobResponse>) => { w.terminate(); resolve(ev.data); };
    w.onerror = (ev) => {
      w.terminate();
      resolve({ id: req.id, ok: false, message: ev.message || str('arcade.wizmachine.the_recording_worker_failed') });
    };
    w.postMessage(req, transfer);
  });
}
