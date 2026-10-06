import {
  EFFECT_GROUP, EFFECT_SAMPLES, SAMPLE, coinSound, effectSampleIndex, effectSearchPaths,
  effectsMask, samplesForStored, type CoinOutcome,
} from '../src/machine/effects';
import { parseEffectPack, type PackedFile } from '../src/machine/effectpack';
import { EFFECT_LINES, type FrameView } from '../src/machine/framestate';
import {
  decodedLayout, effectGrid, readSetting, type EffectGridRow,
} from '../src/layout/fmlconfig';
import type { Game } from '../src/machine/registry';

const VOICES = 16;

const DEFAULT_VOLUME = 127 / 255;

const REEL_STILL_FRAMES = 3;

const MAX_PER_FRAME = 4;

export interface EffectsHost {
  context(): AudioContext | null;
  effectsOutput(): AudioNode | null;
}

interface Baseline {
  epoch: number;
  triacs: Uint32Array;
  meters: Uint32Array;
  hopperCoins: Uint32Array;
  triacLevels: number | null;
  meterLevels: number | null;
}

export class CabinetEffects {
  enabled = true;

  private mask = 0xff;
  private triacRows: EffectGridRow[] = [];
  private meterRows: EffectGridRow[] = [];
  private local = new Map<number, Uint8Array>();
  private localBuffers = new Map<number, AudioBuffer | null>();
  private static defaults = new Map<string, AudioBuffer | null>();
  private static pack: Map<string, PackedFile> | null = null;
  private static packLoading = false;
  private loading = new Set<string>();
  private system = '';
  private cabinetStyle: string | null = null;
  private warmedFor: Game | null = null;
  private game: Game | null = null;

  private live = 0;
  private voices = new Set<AudioBufferSourceNode>();
  private generation = 0;
  private gain: GainNode | null = null;
  private reelVoice: (AudioBufferSourceNode | null)[] = [];
  private reelStill: number[] = [];
  private reelLast: { travel: number; position: number }[] = [];
  private hopperVoice: (AudioBufferSourceNode | null)[] = [null, null];
  private triacSlot: AudioBufferSourceNode[][] = [];
  private meterArmed = 0;
  private base: Baseline | null = null;
  private lastSeq = -1;

  constructor(private readonly host: EffectsHost) {}

  load(game: Game): void {
    this.stopAll();
    this.game = game;
    this.base = null;
    this.lastSeq = -1;
    this.mask = effectsMask(game.gam?.settings);
    this.system = game.system;
    const g = layoutEffects(game);
    this.cabinetStyle = g.cabinetStyle;
    this.triacRows = g.triacRows;
    this.meterRows = g.meterRows;
    this.local.clear();
    this.localBuffers.clear();
    for (const f of game.effectFiles ?? []) {
      const i = effectSampleIndex(f.name);
      if (i >= 0) this.local.set(i, f.bytes);
    }
    this.warmedFor = null;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopAll();
  }

  button(down: boolean): void {
    if (!this.gate(EFFECT_GROUP.buttons)) return;
    this.play(down ? SAMPLE.ButtonDown : SAMPLE.ButtonUp);
  }

  coin(acceptor: { note?: number; effect?: number } | undefined, outcome: CoinOutcome = 'accepted'): void {
    if (!this.gate(EFFECT_GROUP.coins)) return;
    const s = coinSound(acceptor?.note, acceptor?.effect, outcome);
    if (s) this.play(s.first, s.then);
  }

  frame(f: FrameView): void {
    if (f.seq === this.lastSeq && this.base?.epoch === f.epoch) return;
    this.lastSeq = f.seq;
    this.warm();
    if (!this.base || this.base.epoch !== f.epoch) {
      this.stopAll();
      this.meterArmed = f.effects.meterLevels ?? 0;
      this.rebase(f);
      return;
    }
    if (!this.enabled || f.paused || f.halted || !this.running()) {
      this.stopAll();
      this.meterPulses(f.effects.meters, this.base.meters, this.meterRows, f.effects.meterLevels ?? null, false);
      this.rebase(f);
      return;
    }
    this.reels(f);
    const e = f.effects;
    if (this.mask & EFFECT_GROUP.triacs) {
      this.triacEdges(e.triacs, this.base.triacs, this.triacRows, e.triacLevels, this.base.triacLevels);
    }
    this.meterPulses(e.meters, this.base.meters, this.meterRows, e.meterLevels ?? null,
      (this.mask & EFFECT_GROUP.meters) !== 0);
    this.hoppers(f);
    this.rebase(f);
  }

  private reels(f: FrameView): void {
    const on = (this.mask & EFFECT_GROUP.reels) !== 0;
    f.reels.forEach((r, i) => {
      const last = this.reelLast[i];
      const moved = !!last && (r.travel !== last.travel || r.position !== last.position);
      this.reelLast[i] = { travel: r.travel, position: r.position };
      if (moved) {
        this.reelStill[i] = 0;
        if (on && !this.reelVoice[i]) this.reelVoice[i] = this.play(SAMPLE.Stepper);
      } else if ((this.reelStill[i] = (this.reelStill[i] ?? 0) + 1) >= REEL_STILL_FRAMES) {
        this.stop(this.reelVoice[i]);
        this.reelVoice[i] = null;
      }
    });
  }

  private meterPulses(now: Uint32Array, then: Uint32Array, rows: EffectGridRow[],
    levels: number | null, sound: boolean): void {
    let armed = 0;
    for (let i = 0; i < EFFECT_LINES; i++) {
      const d = Math.max(0, now[i] - then[i]);
      const bit = 1 << i;
      const wasArmed = (this.meterArmed & bit) !== 0;
      const held = levels !== null && (levels & bit) !== 0;
      const confirmed = d + (wasArmed ? 1 : 0);
      const stillArmed = held && confirmed > 0;
      if (stillArmed) armed |= bit;
      if (!sound || i >= rows.length) continue;
      if (d > 0) {
        const samples = samplesForStored(rows[i].on);
        for (let n = 0; n < Math.min(d, MAX_PER_FRAME); n++) this.playInto(samples);
      }
      if (levels === null) continue;
      const falls = confirmed - (stillArmed ? 1 : 0);
      if (falls <= 0) continue;
      const off = samplesForStored(rows[i].off);
      if (!off.length) continue;
      for (let n = 0; n < Math.min(falls, MAX_PER_FRAME); n++) this.playInto(off);
    }
    this.meterArmed = armed;
  }

  private triacEdges(now: Uint32Array, then: Uint32Array, rows: EffectGridRow[],
    levels: number | null, was: number | null): void {
    for (let i = 0; i < EFFECT_LINES && i < rows.length; i++) {
      const rises = Math.max(0, now[i] - then[i]);
      const on = samplesForStored(rows[i].on);
      if (levels === null || was === null) {
        const shots = on.filter((x) => !EFFECT_SAMPLES[x].loop);
        for (let n = 0; n < Math.min(rises, MAX_PER_FRAME); n++) this.playInto(shots);
        continue;
      }
      const hi = (levels >> i) & 1;
      const lo = (was >> i) & 1;
      const falls = rises + lo - hi;
      if (rises === 0 && falls <= 0) continue;
      const off = samplesForStored(rows[i].off);
      const onLoops = on.some((x) => EFFECT_SAMPLES[x].loop);
      let level = lo;
      let risenHere = false;
      const edges = Math.min(rises + Math.max(0, falls), 2 * MAX_PER_FRAME);
      for (let e = 0; e < edges; e++) {
        if (level === 0) {
          if (on.length) this.triacSlot[i] = this.playInto(on);
          risenHere = true;
          level = 1;
        } else {
          if (off.length) {
            this.stopSlot(i, risenHere);
            this.triacSlot[i] = this.playInto(off);
          } else if (onLoops) {
            this.stopSlot(i, risenHere);
          }
          level = 0;
        }
      }
      if (level !== hi && !hi && (onLoops || off.length)) this.stopSlot(i, false);
    }
    this.holdLoops(rows, levels);
  }

  private holdLoops(rows: EffectGridRow[], levels: number | null): void {
    if (levels === null) return;
    for (let i = 0; i < EFFECT_LINES && i < rows.length; i++) {
      if (!((levels >> i) & 1)) continue;
      const loops = samplesForStored(rows[i].on).filter((x) => EFFECT_SAMPLES[x].loop);
      if (!loops.length) continue;
      const slot = this.triacSlot[i] ?? [];
      if (slot.some((v) => v.loop && this.voices.has(v))) continue;
      this.triacSlot[i] = [...slot, ...this.playInto(loops)];
    }
  }

  private stopSlot(i: number, loopsOnly: boolean): void {
    const held = this.triacSlot[i] ?? [];
    const keep: AudioBufferSourceNode[] = [];
    for (const v of held) {
      if (loopsOnly && !v.loop) keep.push(v);
      else this.stop(v);
    }
    this.triacSlot[i] = keep;
  }

  private playInto(samples: readonly number[]): AudioBufferSourceNode[] {
    const tracked: AudioBufferSourceNode[] = [];
    for (const x of samples) {
      const v = this.play(x);
      if (v && (!EFFECT_SAMPLES[x].through || EFFECT_SAMPLES[x].loop)) tracked.push(v);
    }
    return tracked;
  }

  private hoppers(f: FrameView): void {
    const on = (this.mask & EFFECT_GROUP.coins) !== 0;
    const motor = [SAMPLE.HopperMotor1, SAMPLE.HopperMotor2];
    const coin = [SAMPLE.HopperCoin1, SAMPLE.HopperCoin2];
    for (let h = 0; h < 2; h++) {
      const running = (f.effects.hopperMotors >> h) & 1;
      if (running && on && !this.hopperVoice[h]) this.hopperVoice[h] = this.play(motor[h]);
      if (!running) {
        this.stop(this.hopperVoice[h]);
        this.hopperVoice[h] = null;
      }
      const d = f.effects.hopperCoins[h] - this.base!.hopperCoins[h];
      if (on) for (let n = 0; n < Math.min(Math.max(d, 0), MAX_PER_FRAME); n++) this.play(coin[h]);
    }
  }

  private gate(group: number): boolean {
    return this.enabled && (this.mask & group) !== 0 && this.running();
  }

  private running(): boolean {
    return this.host.context()?.state === 'running';
  }

  private output(): AudioNode | null {
    const ctx = this.host.context();
    const out = this.host.effectsOutput();
    if (!ctx || !out) return null;
    if (!this.gain) {
      this.gain = ctx.createGain();
      this.gain.gain.value = DEFAULT_VOLUME;
      this.gain.connect(out);
    }
    return this.gain;
  }

  private play(i: number, then: number | null = null): AudioBufferSourceNode | null {
    const ctx = this.host.context();
    const out = this.output();
    const buf = this.buffer(i);
    if (!ctx || !out || !buf || this.live >= VOICES) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = EFFECT_SAMPLES[i].loop;
    src.connect(out);
    this.live++;
    this.voices.add(src);
    const generation = this.generation;
    src.onended = () => {
      this.live--;
      this.voices.delete(src);
      src.disconnect();
      if (then !== null && this.enabled && generation === this.generation) this.play(then);
    };
    src.start();
    return src;
  }

  private stop(src: AudioBufferSourceNode | null | undefined): void {
    if (!src) return;
    src.onended = () => { this.live--; this.voices.delete(src); src.disconnect(); };
    try { src.stop(); } catch {  }
  }

  silence(): void {
    this.generation++;
    this.stopAll();
    for (const src of [...this.voices]) this.stop(src);
  }

  private stopAll(): void {
    this.reelVoice.forEach((v) => this.stop(v));
    this.hopperVoice.forEach((v) => this.stop(v));
    this.triacSlot.forEach((slot) => slot.forEach((v) => this.stop(v)));
    this.triacSlot = [];
    this.reelVoice = [];
    this.hopperVoice = [null, null];
    this.reelStill = [];
  }

  private rebase(f: FrameView): void {
    this.base = {
      epoch: f.epoch,
      triacs: f.effects.triacs.slice(),
      meters: f.effects.meters.slice(),
      hopperCoins: f.effects.hopperCoins.slice(),
      triacLevels: f.effects.triacLevels ?? null,
      meterLevels: f.effects.meterLevels ?? null,
    };
    if (!this.reelLast.length || f.reels.length !== this.reelLast.length) {
      this.reelLast = f.reels.map((r) => ({ travel: r.travel, position: r.position }));
    }
  }

  private buffer(i: number): AudioBuffer | null {
    if (this.local.has(i)) {
      const b = this.localBuffers.get(i);
      if (b === undefined) this.loadLocal(i);
      return b ?? null;
    }
    const pack = CabinetEffects.pack;
    if (!pack) {
      CabinetEffects.loadPack();
      return null;
    }
    const file = effectSearchPaths(EFFECT_SAMPLES[i].file, this.system, this.cabinetStyle)
      .map((p) => pack.get(p.toLowerCase()))
      .find((f) => f !== undefined);
    if (file === undefined) return null;
    const b = CabinetEffects.defaults.get(file.path);
    if (b === undefined) this.loadDefault(file);
    return b ?? null;
  }

  private warm(): void {
    if (this.warmedFor === this.game || !this.host.context()) return;
    if (!CabinetEffects.pack) {
      CabinetEffects.loadPack();
      return;
    }
    this.warmedFor = this.game;
    for (let i = 0; i < EFFECT_SAMPLES.length; i++) this.buffer(i);
  }

  private static loadPack(): void {
    if (CabinetEffects.packLoading) return;
    CabinetEffects.packLoading = true;
    fetch(new URL('sounds.pack', document.baseURI))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null)
      .then((a) => {
        CabinetEffects.pack = (a && parseEffectPack(new Uint8Array(a))) || new Map();
      });
  }

  private loadLocal(i: number): void {
    const ctx = this.host.context();
    const bytes = this.local.get(i);
    const key = `L${i}`;
    if (!ctx || !bytes || this.loading.has(key)) return;
    this.loading.add(key);
    const game = this.game;
    ctx.decodeAudioData(bytes.slice().buffer)
      .catch(() => null)
      .then((b) => {
        this.loading.delete(key);
        if (this.game === game) this.localBuffers.set(i, b);
      });
  }

  private loadDefault(file: PackedFile): void {
    const ctx = this.host.context();
    const key = `D${file.path}`;
    if (!ctx || this.loading.has(key)) return;
    this.loading.add(key);
    ctx.decodeAudioData(file.bytes.slice().buffer)
      .catch(() => null)
      .then((b) => {
        this.loading.delete(key);
        CabinetEffects.defaults.set(file.path, b);
      });
  }
}

const layoutEffectsKept = new WeakMap<Uint8Array, {
  system: string; cabinetStyle: string | null; triacRows: EffectGridRow[]; meterRows: EffectGridRow[];
}>();

function layoutEffects(game: Game): { cabinetStyle: string | null; triacRows: EffectGridRow[]; meterRows: EffectGridRow[] } {
  const kept = game.layout ? layoutEffectsKept.get(game.layout) : undefined;
  if (kept && kept.system === game.system) return kept;
  const payload = decodedLayout(game.layout);
  const got = {
    system: game.system,
    cabinetStyle: payload ? readSetting(payload, game.system, 'Cabinet Style') : null,
    triacRows: (payload && effectGrid(payload, game.system, 'Triac Effects')) || [],
    meterRows: (payload && effectGrid(payload, game.system, 'Meter Effects')) || [],
  };
  if (game.layout) layoutEffectsKept.set(game.layout, got);
  return got;
}
