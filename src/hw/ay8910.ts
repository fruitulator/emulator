
import type { AudioSource } from '../machine/machine';
import { BASE_BOARD_BASS_FREQ, blipHighPassPole } from './blipleak';

export type AyVariant = 'ay8910' | 'ym2149';

export interface AyOptions {
  pin26Low?: boolean;
}

const AY_VOLUME = [
  0.0000, 0.0137, 0.0205, 0.0291, 0.0423, 0.0618, 0.0847, 0.1369,
  0.1691, 0.2647, 0.3527, 0.4499, 0.5704, 0.6873, 0.8482, 1.0000,
];

const YM_VOLUME = [
  0.0000, 0.0000, 0.0048, 0.0075, 0.0106, 0.0132, 0.0170, 0.0212,
  0.0271, 0.0330, 0.0414, 0.0499, 0.0611, 0.0723, 0.0876, 0.1029,
  0.1240, 0.1452, 0.1727, 0.2003, 0.2394, 0.2786, 0.3295, 0.3805,
  0.4471, 0.5137, 0.6021, 0.6905, 0.8043, 0.9181, 1.0000, 1.0000,
];

export const AY_RATE = 48_000;

export class Ay8910 implements AudioSource {
  readonly rate: number = AY_RATE;

  readonly regs = new Uint8Array(16);

  portAOut = 0;

  private readonly variant: AyVariant;
  readonly toneClock: number;

  private address = 0;

  private readonly toneCount = [0, 0, 0];
  private readonly toneOut = [0, 0, 0];

  private noiseCount = 0;
  private noiseLfsr = 1;

  private envCount = 0;
  private envStep = 0;
  private envHolding = false;

  private readonly hpPole: number;
  private hpIn = 0;
  private hpOut = 0;

  dacTap: ((level: number) => void) | null = null;

  constructor(clock: number, variant: AyVariant = 'ay8910', rate: number = AY_RATE, options: AyOptions = {}) {
    this.variant = variant;
    this.toneClock = variant === 'ym2149' && options.pin26Low ? clock / 2 : clock;
    this.rate = rate;
    this.hpPole = blipHighPassPole(BASE_BOARD_BASS_FREQ, rate);
    this.reset();
  }

  reset(): void {
    this.flush();
    this.regs.fill(0);
    this.portAOut = 0;
    this.regs[7] = 0x3f;
    this.address = 0;
    this.toneCount[0] = this.toneCount[1] = this.toneCount[2] = 0;
    this.toneOut[0] = this.toneOut[1] = this.toneOut[2] = 0;
    this.noiseCount = 0;
    this.noiseLfsr = 1;
    this.envCount = 0;
    this.envStep = 0;
    this.envHolding = false;
    this.ringWrite = 0;
    this.ringRead = 0;
    this.cycleRemainder = 0;
    this.noisePrescale = 0;
    this.hpIn = 0;
    this.hpOut = 0;
  }

  selectAddress(v: number): void {
    this.address = v & 0x0f;
  }

  get selectedAddress(): number {
    return this.address;
  }

  read(): number {
    return this.regs[this.address];
  }

  write(v: number): void {
    this.writeReg(this.address, v);
  }

  writeReg(reg: number, v: number): void {
    this.flush();
    const r = reg & 0x0f;
    if (r === 7 && ~this.regs[7] & v & 0x40) this.portAOut = this.regs[14];
    else if (r === 14 && this.regs[7] & 0x40) this.portAOut = v & 0xff;
    this.regs[r] = v & 0xff;
    if (r === 13) {
      this.envStep = 0;
      this.envCount = 0;
      this.envHolding = false;
    }
  }

  private tonePeriod(ch: number): number {
    const p = this.regs[ch * 2] | ((this.regs[ch * 2 + 1] & 0x0f) << 8);
    return p === 0 ? 1 : p;
  }

  private noisePeriod(): number {
    const p = this.regs[6] & 0x1f;
    return p === 0 ? 1 : p;
  }

  private envPeriod(): number {
    return this.regs[11] | (this.regs[12] << 8);
  }

  private envelopeLevel(): number {
    const shape = this.regs[13] & 0x0f;
    const cont = (shape & 0x08) !== 0;
    const attack = (shape & 0x04) !== 0;
    const alternate = (shape & 0x02) !== 0;

    let step = this.envStep;
    if (this.envHolding) {
      if (!cont) return 0;
      const top = attack !== alternate;
      return top ? 31 : 0;
    }
    const cycle = (step >> 5) & 1;
    step &= 31;
    const rising = alternate && cont ? attack !== (cycle === 1) : attack;
    return rising ? step : 31 - step;
  }

  private stepEnvelope(): void {
    if (this.envHolding) return;
    const shape = this.regs[13] & 0x0f;
    const cont = (shape & 0x08) !== 0;
    const hold = (shape & 0x01) !== 0;
    this.envStep++;
    if ((this.envStep & 31) === 0) {
      if (!cont || hold) this.envHolding = true;
      else this.envStep &= 63;
    }
  }

  private renderSample(steps: number): number {
    for (let i = 0; i < steps; i++) {
      for (let ch = 0; ch < 3; ch++) {
        if (++this.toneCount[ch] >= this.tonePeriod(ch)) {
          this.toneCount[ch] = 0;
          this.toneOut[ch] ^= 1;
        }
      }
      if (++this.noiseCount >= this.noisePeriod()) {
        this.noiseCount = 0;
        this.noisePrescale ^= 1;
        if (!this.noisePrescale) {
          const bit = (this.noiseLfsr ^ (this.noiseLfsr >> 3)) & 1;
          this.noiseLfsr = (this.noiseLfsr >> 1) | (bit << 16);
        }
      }
      if (++this.envCount >= this.envPeriod()) {
        this.envCount = 0;
        this.stepEnvelope();
      }
    }

    const mixer = this.regs[7];
    const noiseBit = this.noiseLfsr & 1;
    const env = this.envelopeLevel();
    let out = 0;
    for (let ch = 0; ch < 3; ch++) {
      const tone = (mixer >> ch) & 1 ? 1 : this.toneOut[ch];
      const noise = (mixer >> (ch + 3)) & 1 ? 1 : noiseBit;
      if (!(tone & noise)) continue;
      const level = this.regs[8 + ch];
      out += (level & 0x10) ? this.envAmplitude(env) : this.fixedAmplitude(level & 0x0f);
    }
    return out / 3;
  }

  private fixedAmplitude(v: number): number {
    return this.variant === 'ym2149' ? YM_VOLUME[v * 2 + 1] : AY_VOLUME[v];
  }

  private envAmplitude(step: number): number {
    return this.variant === 'ym2149' ? YM_VOLUME[step] : AY_VOLUME[step >> 1];
  }

  private static readonly RING_FRAMES = 1 << 14;
  private readonly ring = new Float32Array(Ay8910.RING_FRAMES * 2);
  private ringWrite = 0;
  private ringRead = 0;
  private cycleRemainder = 0;
  private noisePrescale = 0;
  private stepRemainder = 0;

  gain = 1;

  setGain(g: number): void {
    if (g === this.gain) return;
    this.flush();
    this.gain = g;
  }

  private pendingCycles = 0;
  private pendingClock = 1;

  tick(cycles: number, cpuClock: number): void {
    this.pendingCycles += cycles;
    this.pendingClock = cpuClock;
    if (this.pendingCycles * 1000 >= cpuClock) this.flush();
  }

  private flush(): void {
    const cycles = this.pendingCycles;
    if (cycles === 0) return;
    this.pendingCycles = 0;
    this.advance(cycles, this.pendingClock);
  }

  private advance(cycles: number, cpuClock: number): void {
    this.cycleRemainder += cycles * this.rate;
    let frames = Math.floor(this.cycleRemainder / cpuClock);
    if (frames <= 0) return;
    this.cycleRemainder -= frames * cpuClock;

    const effective = this.toneClock;
    const perSample = effective / 8 / this.rate;
    while (frames-- > 0) {
      this.stepRemainder += perSample;
      const steps = Math.floor(this.stepRemainder);
      this.stepRemainder -= steps;
      const x = this.renderSample(steps);
      if (this.dacTap) this.dacTap(x);
      const y = x - this.hpIn + this.hpPole * this.hpOut;
      this.hpIn = x;
      this.hpOut = y;
      const s = y * this.gain;
      this.ring[this.ringWrite] = s;
      this.ring[this.ringWrite + 1] = s;
      this.ringWrite = (this.ringWrite + 2) % this.ring.length;
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
}
