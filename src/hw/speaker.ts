import type { AudioSource } from '../machine/machine';
import { AY_RATE } from './ay8910';
import { blipHighPassPole } from './blipleak';

const STEP = [0x4000, 0x8000];
const FULL_SCALE = 1 / 0x8000;

export class OneBitSpeaker implements AudioSource {
  rate: number;
  private readonly clockHz: number;
  private cyclesPerSample: number;
  private hpPole: number;
  gain = 1;

  private readonly lines = [0, 0];
  private level = 0;

  private pending = 0;
  private acc = 0;
  private accCycles = 0;
  private hpIn = 0;
  private hpOut = 0;

  private readonly ring = new Float32Array(16384 * 2);
  private ringWrite = 0;
  private ringRead = 0;

  private readonly bassFreq: number;
  private readonly steps: readonly number[];
  private readonly fullScale: number;

  constructor(clockHz: number, rate: number = AY_RATE,
    opts: { bassFreq: number; steps?: readonly [number, number]; fullScale?: number }) {
    this.clockHz = clockHz;
    this.rate = rate;
    this.bassFreq = opts.bassFreq;
    this.steps = opts.steps ?? STEP;
    this.fullScale = opts.fullScale ?? FULL_SCALE;
    this.cyclesPerSample = clockHz / rate;
    this.hpPole = this.poleAt(rate);
  }

  private poleAt(rate: number): number {
    return blipHighPassPole(this.bassFreq, rate);
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0 || rate === this.rate) return;
    this.flush();
    this.rate = rate;
    this.cyclesPerSample = this.clockHz / rate;
    this.hpPole = this.poleAt(rate);
    this.acc = this.accCycles = 0;
  }

  setGain(g: number): void {
    if (g === this.gain) return;
    this.flush();
    this.gain = g;
  }

  reset(): void {
    this.lines[0] = this.lines[1] = 0;
    this.level = 0;
    this.pending = 0;
    this.acc = this.accCycles = 0;
    this.hpIn = this.hpOut = 0;
    this.ringWrite = this.ringRead = 0;
  }

  write(ch: number, bit: number): void {
    ch &= 1;
    bit = bit ? 1 : 0;
    if (this.lines[ch] === bit) return;
    this.flush();
    this.lines[ch] = bit;
    this.level = (this.lines[0] * this.steps[0] + this.lines[1] * this.steps[1]) * this.fullScale;
  }

  tick(cycles: number): void {
    this.pending += cycles;
    if (this.pending >= this.cyclesPerSample * 64) this.flush();
  }

  private flush(): void {
    let cycles = this.pending;
    if (cycles <= 0) return;
    this.pending = 0;
    while (cycles > 0) {
      const take = Math.min(cycles, this.cyclesPerSample - this.accCycles);
      this.acc += this.level * take;
      this.accCycles += take;
      cycles -= take;
      if (this.accCycles >= this.cyclesPerSample - 1e-9) {
        const x = this.acc / this.cyclesPerSample;
        const y = x - this.hpIn + this.hpPole * this.hpOut;
        this.hpIn = x;
        this.hpOut = y;
        this.ring[this.ringWrite] = y * this.gain;
        this.ring[this.ringWrite + 1] = y * this.gain;
        this.ringWrite = (this.ringWrite + 2) % this.ring.length;
        this.acc = 0;
        this.accCycles = 0;
      }
    }
    const avail = (this.ringWrite - this.ringRead + this.ring.length) % this.ring.length;
    if (avail > this.ring.length - 2048) {
      this.ringRead = (this.ringWrite - 2048 + this.ring.length) % this.ring.length;
    }
  }

  buffered(): number {
    this.flush();
    return ((this.ringWrite - this.ringRead + this.ring.length) % this.ring.length) >> 1;
  }

  readAudio(out: Float32Array, frames: number): number {
    const have = Math.min(frames, this.buffered());
    for (let i = 0; i < have * 2; i++) {
      out[i] = this.ring[this.ringRead];
      this.ringRead = (this.ringRead + 1) % this.ring.length;
    }
    for (let i = have * 2; i < frames * 2; i++) out[i] = 0;
    return have;
  }

  get clock(): number { return this.clockHz; }
}
