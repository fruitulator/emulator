const SN_RATE = 48_000;

const VOL_TABLE = ((): number[] => {
  const t: number[] = [];
  for (let i = 0; i < 15; i++) t.push(Math.pow(10, (-2 * i) / 20));
  t.push(0);
  return t;
})();

export class Sn76489 {
  readonly rate = SN_RATE;
  gain = 1;

  private readonly tonePeriod = [1, 1, 1];
  private readonly toneCount = [0, 0, 0];
  private readonly toneOut = [1, 1, 1];
  private readonly vol = [0, 0, 0, 0];
  private latched = 0;
  private noiseCtrl = 0;
  private noiseShift = 1 << 14;
  private noiseCount = 0;
  private noiseOut = 0;

  constructor(private readonly clock = 1_500_000) {}

  reset(): void {
    this.tonePeriod.fill(1);
    this.toneCount.fill(0);
    this.toneOut.fill(1);
    this.vol.fill(15);
    this.latched = 0;
    this.noiseCtrl = 0;
    this.noiseShift = 1 << 14;
    this.pendingCycles = 0;
  }

  write(data: number): void {
    this.flush();
    data &= 0xff;
    if (data & 0x80) {
      const reg = (data >> 4) & 0x07;
      this.latched = reg;
      const chan = reg >> 1;
      if (reg & 1) {
        this.vol[chan] = data & 0x0f;
      } else if (reg === 6) {
        this.noiseCtrl = data & 0x0f;
        this.noiseShift = 1 << 14;
      } else {
        this.tonePeriod[chan] = (this.tonePeriod[chan] & 0x3f0) | (data & 0x0f);
      }
    } else {
      const reg = this.latched;
      const chan = reg >> 1;
      if (reg === 6) {
        this.noiseCtrl = data & 0x0f;
        this.noiseShift = 1 << 14;
      } else if ((reg & 1) === 0) {
        this.tonePeriod[chan] = (this.tonePeriod[chan] & 0x0f) | ((data & 0x3f) << 4);
      } else {
        this.vol[chan] = data & 0x0f;
      }
    }
  }

  private static readonly RING_FRAMES = 1 << 14;
  private readonly ring = new Float32Array(Sn76489.RING_FRAMES * 2);
  private ringWrite = 0;
  private ringRead = 0;
  private cycleRemainder = 0;
  private stepRemainder = 0;
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
    this.cycleRemainder += cycles * this.rate;
    let frames = Math.floor(this.cycleRemainder / this.pendingClock);
    if (frames <= 0) return;
    this.cycleRemainder -= frames * this.pendingClock;
    const perSample = this.clock / 16 / this.rate;
    while (frames-- > 0) {
      this.stepRemainder += perSample;
      let steps = Math.floor(this.stepRemainder);
      this.stepRemainder -= steps;
      while (steps-- > 0) this.advanceStep();
      let s = 0;
      for (let c = 0; c < 3; c++) s += this.toneOut[c] * VOL_TABLE[this.vol[c]];
      s += this.noiseOut * VOL_TABLE[this.vol[3]];
      s = (s / 4) * this.gain;
      this.ring[this.ringWrite] = s;
      this.ring[this.ringWrite + 1] = s;
      this.ringWrite = (this.ringWrite + 2) % this.ring.length;
    }
  }

  private advanceStep(): void {
    for (let c = 0; c < 3; c++) {
      if (--this.toneCount[c] <= 0) {
        this.toneCount[c] = this.tonePeriod[c] || 1;
        this.toneOut[c] = this.tonePeriod[c] <= 1 ? 1 : -this.toneOut[c];
      }
    }
    const rate = this.noiseCtrl & 3;
    const period = rate === 3 ? (this.tonePeriod[2] || 1) : 16 << rate;
    if (--this.noiseCount <= 0) {
      this.noiseCount = period;
      const white = (this.noiseCtrl & 4) !== 0;
      const bit = white
        ? ((this.noiseShift ^ (this.noiseShift >> 3)) & 1)
        : (this.noiseShift & 1);
      this.noiseShift = (this.noiseShift >> 1) | (bit << 14);
      this.noiseOut = (this.noiseShift & 1) ? 1 : -1;
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
