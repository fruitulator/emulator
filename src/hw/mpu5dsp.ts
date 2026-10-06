import type { AudioSource } from '../machine/machine';

export const DSP_RATE = 48_000;

export const UNITY_RATE = 32_000;

const STEP_SIZE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
];
const INDEX_SHIFT = [-1, -1, -1, -1, 2, 4, 6, 8];
const INITIAL_SIGNAL = -2;

export const SAMP_HEADER = 16;

export interface Samp {
  data: number;
  samples: number;
  rate: number;
}

export function readSamp(peek: (addr: number) => number, data: number): Samp | null {
  const hdr = (data - SAMP_HEADER) >>> 0;
  if (peek(hdr) !== 0x53 || peek(hdr + 1) !== 0x41
    || peek(hdr + 2) !== 0x4d || peek(hdr + 3) !== 0x50) return null;
  const samples = ((peek(hdr + 6) << 24) | (peek(hdr + 7) << 16)
    | (peek(hdr + 8) << 8) | peek(hdr + 9)) >>> 0;
  const rate = (peek(hdr + 10) << 8) | peek(hdr + 11);
  if (!samples || samples > 0x100000) return null;
  return { data, samples, rate };
}

interface Voice {
  playing: boolean;
  data: number;
  samples: number;
  decoded: number;
  signal: number;
  index: number;
  prev: number;
  curr: number;
  srcPos: number;
  step: number;
  level: number;
  balance: number;
}

function blank(): Voice {
  return {
    playing: false, data: 0, samples: 0, decoded: 0,
    signal: INITIAL_SIGNAL, index: 0, prev: 0, curr: 0,
    srcPos: 0, step: 1, level: 0xff, balance: 0x80,
  };
}

export class Mpu5Dsp implements AudioSource {
  readonly rate = DSP_RATE;
  private readonly voices = [blank(), blank(), blank()];

  constructor(private readonly peekRom: (addr: number) => number) {}

  reset(): void {
    for (let i = 0; i < this.voices.length; i++) this.voices[i] = blank();
    this.ringWrite = 0;
    this.ringRead = 0;
    this.cycleRemainder = 0;
    this.pendingCycles = 0;
  }

  start(voice: number, data: number, rate: number): void {
    const v = this.voices[voice];
    if (!v) return;
    const samp = readSamp(this.peekRom, data);
    if (!samp) { v.playing = false; return; }
    v.playing = true;
    v.data = samp.data;
    v.samples = samp.samples;
    v.decoded = 0;
    v.signal = INITIAL_SIGNAL;
    v.index = 0;
    v.prev = 0;
    v.curr = 0;
    v.srcPos = 0;
    v.step = rate / DSP_RATE;
  }

  stop(voice: number): void {
    const v = this.voices[voice];
    if (v) v.playing = false;
  }

  level(voice: number, value: number): void {
    const v = this.voices[voice];
    if (v) v.level = value & 0xff;
  }

  balance(voice: number, value: number): void {
    const v = this.voices[voice];
    if (v) v.balance = value & 0xff;
  }

  active(): boolean {
    return this.voices.some((v) => v.playing);
  }

  private decodeNext(v: Voice): void {
    const i = v.decoded++;
    const byte = this.peekRom(v.data + (i >> 1));
    const nibble = (i & 1) === 0 ? byte >> 4 : byte & 0x0f;
    let diff = (((nibble & 7) * 2 + 1) * STEP_SIZE[v.index]) >> 3;
    if (diff > 32767) diff = 32767;
    v.signal += (nibble & 8) ? -diff : diff;
    if (v.signal > 32767) v.signal = 32767;
    else if (v.signal < -32768) v.signal = -32768;
    v.index += INDEX_SHIFT[nibble & 7];
    if (v.index < 0) v.index = 0;
    else if (v.index > 88) v.index = 88;
    v.prev = v.curr;
    v.curr = v.signal;
  }

  render(out: Float32Array, frames: number): void {
    for (let i = 0; i < frames * 2; i++) out[i] = 0;
    for (const v of this.voices) {
      if (!v.playing) continue;
      const gain = (v.level / 255) / 32768;
      for (let i = 0; i < frames; i++) {
        const at = Math.floor(v.srcPos);
        if (at >= v.samples) { v.playing = false; break; }
        const need = Math.min(at + 2, v.samples);
        while (v.decoded < need) this.decodeNext(v);
        const paired = v.decoded === at + 2;
        const a = paired ? v.prev : v.curr;
        const b = v.curr;
        const f = (a + (b - a) * (v.srcPos - at)) * gain;
        out[i * 2] += f;
        out[i * 2 + 1] += f;
        v.srcPos += v.step;
      }
    }
    for (let i = 0; i < frames * 2; i++) {
      if (out[i] > 1) out[i] = 1;
      else if (out[i] < -1) out[i] = -1;
    }
  }

  private static readonly RING_FRAMES = 1 << 15;
  private readonly ring = new Float32Array(Mpu5Dsp.RING_FRAMES * 2);
  private ringWrite = 0;
  private ringRead = 0;
  private cycleRemainder = 0;
  private pendingCycles = 0;
  private pendingClock = 1;
  private readonly chunk = new Float32Array(512 * 2);

  tick(cycles: number, cpuClock: number): void {
    this.pendingCycles += cycles;
    this.pendingClock = cpuClock;
    if (this.pendingCycles * 1000 >= cpuClock) this.flush();
  }

  private flush(): void {
    const cycles = this.pendingCycles;
    if (cycles === 0) return;
    this.pendingCycles = 0;
    this.cycleRemainder += cycles * DSP_RATE;
    let frames = Math.floor(this.cycleRemainder / this.pendingClock);
    if (frames <= 0) return;
    this.cycleRemainder -= frames * this.pendingClock;
    while (frames > 0) {
      const n = Math.min(frames, 512);
      this.render(this.chunk, n);
      for (let i = 0; i < n * 2; i++) {
        this.ring[this.ringWrite] = this.chunk[i];
        this.ringWrite = (this.ringWrite + 1) % this.ring.length;
      }
      frames -= n;
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
