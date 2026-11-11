export interface HopperWaveform {
  obscuredMs: number;
  clearMs: number;
  startMs?: number;
  settleMs?: number;
  restart?: HopperRestart;
}

export type HopperRestart = 'resume' | 'rearm' | 'rephase' | 'clear';

export function v20Waveform(
  tickMs: number,
  ticks: { beam: number; gap: number; start?: number; settle?: number; restart?: HopperRestart },
): HopperWaveform {
  return {
    obscuredMs: ticks.beam * tickMs,
    clearMs: ticks.gap * tickMs,
    startMs: (ticks.start ?? ticks.gap) * tickMs,
    settleMs: (ticks.settle ?? 0) * tickMs,
    restart: ticks.restart ?? 'resume',
  };
}

export class HopperJitter {
  seed = 0;

  next(): number {
    this.seed = (Math.imul(this.seed, 0x08088405) + 1) >>> 0;
    const r = Math.floor((this.seed * 100) / 0x1_0000_0000);
    return r >= 98 ? 4 : r >= 95 ? 3 : r >= 90 ? 2 : 1;
  }
}

export class Hopper {
  static readonly COINS_PER_SECOND = 10;
  private static readonly OBSCURED_SHARE = 5 / 30;

  private beam = false;
  private motor = false;
  private optoDrive = false;
  private timer = 0;
  paid = 0;
  onCoin?: () => void;

  private readonly obscuredCycles: number;
  private readonly clearCycles: number;
  private readonly startCycles: number;
  private readonly settleCycles: number;
  readonly jitter = new HopperJitter();
  private readonly restart: HopperRestart;
  private raiseNext = false;

  static readonly snapshotConfig = ['obscuredCycles', 'clearCycles', 'startCycles', 'settleCycles', 'restart'];

  constructor(clockHz: number, timing: number | HopperWaveform = Hopper.COINS_PER_SECOND) {
    if (typeof timing === 'number') {
      const period = clockHz / timing;
      this.obscuredCycles = Math.round(period * Hopper.OBSCURED_SHARE);
      this.clearCycles = Math.round(period) - this.obscuredCycles;
      this.startCycles = this.clearCycles;
      this.settleCycles = 0;
      this.restart = 'resume';
    } else {
      const cyc = (ms: number) => Math.round((clockHz * ms) / 1000);
      this.obscuredCycles = cyc(timing.obscuredMs);
      this.clearCycles = cyc(timing.clearMs);
      this.startCycles = cyc(timing.startMs ?? timing.clearMs);
      this.settleCycles = cyc(timing.settleMs ?? 0);
      this.restart = timing.restart ?? 'resume';
    }
  }

  motorDrive(on: boolean): void {
    if (on === this.motor) return;
    this.motor = on;
    if (this.restart === 'rephase') {
      if (on) {
        this.timer = this.startCycles * this.jitter.next();
        this.raiseNext = true;
      }
      return;
    }
    if (this.restart === 'clear') {
      this.beam = false;
      this.raiseNext = false;
      this.timer = on ? this.startCycles * this.jitter.next() : 0;
      return;
    }
    if (this.restart === 'rearm') {
      if (!on) {
        if (!this.beam) this.timer = 0;
      } else {
        this.timer = this.startCycles * this.jitter.next();
      }
      return;
    }
    if (on && this.timer === 0) this.timer = this.startCycles * this.jitter.next();
  }

  optoDriveLine(on: boolean): void {
    this.optoDrive = on;
  }

  tick(cycles: number): void {
    if (this.timer <= 0) return;
    this.timer -= cycles;
    while (this.timer <= 0) {
      if (this.beam && !this.raiseNext) {
        this.beam = false;
        this.timer = this.motor ? this.timer + this.settleCycles + this.clearCycles * this.jitter.next() : 0;
        if (this.timer === 0) return;
      } else if (!this.motor) {
        this.timer = 0;
        return;
      } else {
        if (!this.beam) {
          this.beam = true;
          this.paid++;
          this.onCoin?.();
        }
        this.raiseNext = false;
        this.timer += this.obscuredCycles;
      }
    }
  }

  get opto(): boolean {
    return this.beam;
  }

  get running(): boolean {
    return this.motor;
  }

  senseBit(): number {
    if (!this.motor && !this.optoDrive) return 0;
    return this.beam ? 0 : 1;
  }

  countPin(invert = false): number {
    if (!this.motor && !this.optoDrive) return 1;
    return (this.beam ? 1 : 0) ^ (invert ? 1 : 0);
  }

  runPin(): number {
    if (this.optoDrive) return 0;
    if (!this.motor) return 0;
    return this.beam ? 1 : 0;
  }

  reset(): void {
    this.beam = false;
    this.motor = false;
    this.optoDrive = false;
    this.timer = 0;
    this.raiseNext = false;
    this.paid = 0;
  }
}
