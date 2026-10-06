import type { AudioSource } from '../machine/machine';

export const ASTRA_STEP_SIZE: readonly number[] = [
  16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88,
  97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371,
  408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411,
  1552,
];
const ADJUST = [-1, -1, -1, -1, 2, 4, 6, 8];

const DIFF = (() => {
  const t = new Int16Array(49 * 16);
  for (let i = 0; i < 49; i++) {
    const s = ASTRA_STEP_SIZE[i];
    for (let n = 0; n < 16; n++) {
      const mag = (s >> 3) + (n & 1 ? s >> 2 : 0) + (n & 2 ? s >> 1 : 0) + (n & 4 ? s : 0);
      t[i * 16 + n] = n & 8 ? -mag : mag;
    }
  }
  return t;
})();

export class AstraAdpcm {
  acc = 0;
  step = 0;

  decode(nibble: number): number {
    const n = nibble & 15;
    let v = this.acc + DIFF[this.step * 16 + n];
    if (v > 0x800) v = 0x800;
    else if (v < -0x800) v = -0x800;
    this.acc = v;
    this.step += ADJUST[n & 7];
    if (this.step < 0) this.step = 0;
    else if (this.step > 0x30) this.step = 0x30;
    return v;
  }

  reset(): void {
    this.acc = 0;
    this.step = 0;
  }
}

export const ASTRA_SOUND_RATE = 32000;
const RING_FRAMES = 1 << 14;
const RAMP_STEP = 5;
const RAMP_CYCLES = 0x2710;

export class AstraSound implements AudioSource {
  readonly rate: number;
  private readonly adpcm = new AstraAdpcm();
  private volume = 0;
  private target = 255;
  private rampAcc = 0;
  private held = 0;
  private frameFrac = 0;
  private readonly ring = new Float32Array(RING_FRAMES * 2);
  private ringWrite = 0;
  private ringRead = 0;

  constructor(rate: number = ASTRA_SOUND_RATE) {
    this.rate = rate;
  }

  nibble(n: number): void {
    const acc = this.adpcm.decode(n);
    this.held = Math.trunc((acc * this.volume * 15) / 255);
  }

  silence(): void {
    this.held = 0;
  }

  setVolumeTarget(v: number): void {
    this.target = Math.max(0, Math.min(255, v | 0));
  }

  get currentVolume(): number {
    return this.volume;
  }

  reset(): void {
    this.adpcm.reset();
    this.volume = 0;
    this.rampAcc = 0;
    this.held = 0;
  }

  tick(cycles: number, cpuHz: number): void {
    this.rampAcc += cycles;
    while (this.rampAcc >= RAMP_CYCLES) {
      this.rampAcc -= RAMP_CYCLES;
      if (this.volume < this.target) this.volume = Math.min(this.target, this.volume + RAMP_STEP);
      else if (this.volume > this.target) this.volume = Math.max(this.target, this.volume - RAMP_STEP);
    }
    this.frameFrac += (cycles / cpuHz) * this.rate;
    const frames = Math.floor(this.frameFrac);
    this.frameFrac -= frames;
    const s = this.held / 32768;
    for (let i = 0; i < frames; i++) {
      this.ring[this.ringWrite] = s;
      this.ring[this.ringWrite + 1] = s;
      this.ringWrite = (this.ringWrite + 2) % this.ring.length;
    }
    const avail = (this.ringWrite - this.ringRead + this.ring.length) % this.ring.length;
    if (avail > this.ring.length - 2048) this.ringRead = (this.ringWrite - 2048 + this.ring.length) % this.ring.length;
  }

  buffered(): number {
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
