
import type { AudioSource } from '../machine/machine';

const CLOCK_DIVIDER = 256;

const AMPLITUDE = Array.from({ length: 16 }, (_, n) => Math.trunc((n * 32767) / 16));

const ENVELOPE: readonly Uint8Array[] = (() => {
  const up = Array.from({ length: 16 }, (_, i) => i);
  const down = up.map((i) => 15 - i);
  const z16 = new Array<number>(16).fill(0);
  const f16 = new Array<number>(16).fill(15);
  const shapes = [
    [...z16, ...z16, ...z16, ...z16],
    [...f16, ...f16, ...f16, ...f16],
    [...down, ...z16, ...z16, ...z16],
    [...down, ...down, ...down, ...down],
    [...up, ...down, ...z16, ...z16],
    [...up, ...down, ...up, ...down],
    [...up, ...z16, ...z16, ...z16],
    [...up, ...up, ...up, ...up],
  ];
  return shapes.map((s) => Uint8Array.from(s));
})();

const LEFT = 0;
const RIGHT = 1;

interface Channel {
  frequency: number;
  freqEnable: boolean;
  noiseEnable: boolean;
  octave: number;
  amplitude: [number, number];
  envelope: [number, number];
  counter: number;
  level: number;
}

interface Noise {
  counter: number;
  freq: number;
  level: number;
}

const newChannel = (): Channel => ({
  frequency: 0, freqEnable: false, noiseEnable: false, octave: 0,
  amplitude: [0, 0], envelope: [0, 0], counter: 0, level: 0,
});

const chFreq = (c: Channel): number => (511 - c.frequency) << (8 - c.octave);

export class Saa1099 implements AudioSource {
  rate: number;
  readonly nativeRate: number;
  gain = 1;

  readonly channels: Channel[] = Array.from({ length: 6 }, newChannel);
  readonly noise: Noise[] = [
    { counter: 0, freq: 0, level: 0xffffffff },
    { counter: 0, freq: 0, level: 0xffffffff },
  ];
  noiseParams = [0, 0];
  envEnable = [false, false];
  envReverseRight = [false, false];
  envMode = [0, 0];
  envBits = [false, false];
  envClock = [false, false];
  envStep = [0, 0];
  allChEnable = false;
  syncState = false;
  selectedReg = 0;
  writes = 0;

  constructor(readonly clock: number, outRate: number) {
    this.nativeRate = clock / CLOCK_DIVIDER;
    this.rate = outRate;
    const frames = 2 ** Math.ceil(Math.log2(Math.max(1 << 14, outRate * 0.25)));
    this.ring = new Float32Array(frames * 2);
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0 || rate === this.rate) return;
    this.flush();
    this.rate = rate;
    this.cycleRemainder = 0;
    const frames = 2 ** Math.ceil(Math.log2(Math.max(1 << 14, rate * 0.25)));
    if (frames * 2 > this.ring.length) {
      this.ring = new Float32Array(frames * 2);
      this.ringRead = this.ringWrite = 0;
    }
  }

  reset(): void {
    this.flush();
    for (let i = 0; i < 6; i++) this.channels[i] = newChannel();
    for (const n of this.noise) { n.counter = 0; n.freq = 0; n.level = 0xffffffff; }
    this.noiseParams = [0, 0];
    this.envEnable = [false, false];
    this.envReverseRight = [false, false];
    this.envMode = [0, 0];
    this.envBits = [false, false];
    this.envClock = [false, false];
    this.envStep = [0, 0];
    this.allChEnable = false;
    this.syncState = false;
    this.selectedReg = 0;
    this.held = 0;
  }

  write(offset: number, data: number): void {
    if (offset & 1) this.controlW(data);
    else this.dataW(data);
  }

  controlW(data: number): void {
    this.flush();
    this.selectedReg = data & 0x1f;
    if (this.selectedReg === 0x18 || this.selectedReg === 0x19) {
      if (this.envClock[0]) this.envelopeW(0);
      if (this.envClock[1]) this.envelopeW(1);
    }
  }

  dataW(data: number): void {
    this.flush();
    this.writes++;
    const reg = this.selectedReg;
    const d = data & 0xff;
    switch (reg) {
      case 0x00: case 0x01: case 0x02: case 0x03: case 0x04: case 0x05: {
        const c = this.channels[reg & 7];
        c.amplitude[LEFT] = AMPLITUDE[d & 0x0f];
        c.amplitude[RIGHT] = AMPLITUDE[(d >> 4) & 0x0f];
        break;
      }
      case 0x08: case 0x09: case 0x0a: case 0x0b: case 0x0c: case 0x0d:
        this.channels[reg & 7].frequency = d;
        break;
      case 0x10: case 0x11: case 0x12: {
        const ch = (reg - 0x10) << 1;
        this.channels[ch].octave = d & 0x07;
        this.channels[ch + 1].octave = (d >> 4) & 0x07;
        break;
      }
      case 0x14:
        for (let ch = 0; ch < 6; ch++) this.channels[ch].freqEnable = ((d >> ch) & 1) !== 0;
        break;
      case 0x15:
        for (let ch = 0; ch < 6; ch++) this.channels[ch].noiseEnable = ((d >> ch) & 1) !== 0;
        break;
      case 0x16:
        this.noiseParams[0] = d & 0x03;
        this.noiseParams[1] = (d >> 4) & 0x03;
        break;
      case 0x18: case 0x19: {
        const ch = reg - 0x18;
        this.envReverseRight[ch] = (d & 1) !== 0;
        this.envMode[ch] = (d >> 1) & 0x07;
        this.envBits[ch] = ((d >> 4) & 1) !== 0;
        this.envClock[ch] = ((d >> 5) & 1) !== 0;
        this.envEnable[ch] = ((d >> 7) & 1) !== 0;
        this.envStep[ch] = 0;
        break;
      }
      case 0x1c:
        this.allChEnable = (d & 1) !== 0;
        this.syncState = (d & 2) !== 0;
        if (d & 2) {
          for (const c of this.channels) { c.level = 0; c.counter = chFreq(c); }
        }
        break;
      default:
        break;
    }
  }

  private envelopeW(ch: number): void {
    const trio = [this.channels[ch * 3], this.channels[ch * 3 + 1], this.channels[ch * 3 + 2]];
    if (this.envEnable[ch]) {
      const mode = this.envMode[ch];
      const step = this.envStep[ch] = ((this.envStep[ch] + 1) & 0x3f) | (this.envStep[ch] & 0x20);
      let mask = 15;
      if (this.envBits[ch]) mask &= ~1;
      const e = ENVELOPE[mode][step];
      for (const c of trio) {
        c.envelope[LEFT] = e & mask;
        c.envelope[RIGHT] = (this.envReverseRight[ch] ? 15 - e : e) & mask;
      }
    } else {
      for (const c of trio) { c.envelope[LEFT] = 16; c.envelope[RIGHT] = 16; }
    }
  }

  renderNative(out: [number, number]): void {
    out[0] = 0; out[1] = 0;
    if (!this.allChEnable) return;
    for (let ch = 0; ch < 2; ch++) {
      const p = this.noiseParams[ch];
      this.noise[ch].freq = p < 3 ? 256 << p : chFreq(this.channels[ch * 3]);
    }
    let outL = 0;
    let outR = 0;
    for (let ch = 0; ch < 6; ch++) {
      const c = this.channels[ch];
      while (c.counter <= 0) {
        c.counter += chFreq(c);
        c.level ^= 1;
        if (ch === 1 && !this.envClock[0]) this.envelopeW(0);
        if (ch === 4 && !this.envClock[1]) this.envelopeW(1);
      }
      c.counter -= CLOCK_DIVIDER;

      let level = 0;
      const noiseOut = this.noise[(ch / 3) | 0].level & 1;
      const toneOut = c.level & 1;
      if (c.noiseEnable) {
        if (c.freqEnable) level = noiseOut ? toneOut << 1 : toneOut;
        else level = noiseOut;
      } else if (c.freqEnable) {
        level = toneOut;
      }
      if (level > 0) {
        outL += Math.trunc(Math.trunc((c.amplitude[LEFT] * c.envelope[LEFT]) / 16) / level);
        outR += Math.trunc(Math.trunc((c.amplitude[RIGHT] * c.envelope[RIGHT]) / 16) / level);
      }
    }
    for (let ch = 0; ch < 2; ch++) {
      const n = this.noise[ch];
      while (n.counter <= 0) {
        n.counter += n.freq;
        if (((n.level & 0x20000) === 0) !== ((n.level & 0x0400) === 0)) n.level = ((n.level << 1) | 1) >>> 0;
        else n.level = (n.level << 1) >>> 0;
      }
      n.counter -= CLOCK_DIVIDER;
    }
    out[0] = outL;
    out[1] = outR;
  }

  private ring: Float32Array;
  private ringWrite = 0;
  private ringRead = 0;
  private cycleRemainder = 0;
  private phase = 1;
  private held = 0;
  private readonly lr: [number, number] = [0, 0];
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
    const step = this.nativeRate / this.rate;
    const full = 32768 * 6;
    while (frames-- > 0) {
      this.phase += step;
      while (this.phase >= 1) {
        this.renderNative(this.lr);
        this.held = ((this.lr[0] + this.lr[1]) / 2 / full) * this.gain;
        this.phase -= 1;
      }
      this.ring[this.ringWrite] = this.held;
      this.ring[this.ringWrite + 1] = this.held;
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
