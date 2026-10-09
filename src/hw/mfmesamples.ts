
import type { AudioSource } from '../machine/machine';

const PACK_MAGIC = 0x5569a55a;

const BLOCK = 0x20000;

export interface MfmeSample {
  readonly pcm: Int16Array;
  readonly rate: number;
}

export function isMfmeSamplePack(image: Uint8Array): boolean {
  if (image.length < 5) return false;
  const magic = ((image[4] << 24) | (image[3] << 16) | (image[2] << 8) | image[1]) >>> 0;
  return magic === (PACK_MAGIC >>> 0);
}

interface AdpcmTables { delta: Int16Array; adjust: Int8Array; }

const DELTA = Int16Array.from([
  0, 0, 1, 2, 3, 5, 7, 10, 0, 0, -1, -2, -3, -5, -7, -10,
  0, 1, 2, 3, 4, 6, 8, 13, 0, -1, -2, -3, -4, -6, -8, -13,
  0, 1, 2, 4, 5, 7, 10, 15, 0, -1, -2, -4, -5, -7, -10, -15,
  0, 1, 3, 4, 6, 9, 13, 19, 0, -1, -3, -4, -6, -9, -13, -19,
  0, 2, 3, 5, 8, 11, 15, 23, 0, -2, -3, -5, -8, -11, -15, -23,
  0, 2, 4, 7, 10, 14, 19, 29, 0, -2, -4, -7, -10, -14, -19, -29,
  0, 3, 5, 8, 12, 16, 22, 33, 0, -3, -5, -8, -12, -16, -22, -33,
  1, 4, 7, 10, 15, 20, 29, 43, -1, -4, -7, -10, -15, -20, -29, -43,
  1, 4, 8, 13, 18, 25, 35, 53, -1, -4, -8, -13, -18, -25, -35, -53,
  1, 6, 10, 16, 22, 31, 43, 64, -1, -6, -10, -16, -22, -31, -43, -64,
  2, 7, 12, 19, 27, 37, 51, 76, -2, -7, -12, -19, -27, -37, -51, -76,
  2, 9, 16, 24, 34, 46, 64, 96, -2, -9, -16, -24, -34, -46, -64, -96,
  3, 11, 19, 29, 41, 57, 79, 117, -3, -11, -19, -29, -41, -57, -79, -117,
  4, 13, 24, 36, 50, 69, 96, 143, -4, -13, -24, -36, -50, -69, -96, -143,
  4, 16, 29, 44, 62, 85, 118, 175, -4, -16, -29, -44, -62, -85, -118, -175,
  6, 20, 36, 54, 76, 104, 144, 214, -6, -20, -36, -54, -76, -104, -144, -214,
]);

const ADJUST = Int8Array.from([-1, -1, 0, 0, 1, 2, 2, 3, -1, -1, 0, 0, 1, 2, 2, 3]);

export const MFME_PACK_TABLES: AdpcmTables = { delta: DELTA, adjust: ADJUST };

interface Adpcm { acc: number; index: number; }

function step(st: Adpcm, nibble: number): number {
  st.acc = (((st.acc + DELTA[st.index * 16 + nibble]) + 0x8000) & 0xffff) - 0x8000;
  st.index += ADJUST[nibble];
  if (st.index < 0) st.index = 0;
  else if (st.index > 15) st.index = 15;
  let out = st.acc * 0x80;
  if (out >= 0x8000) out = 0x7fff;
  else if (out < -0x7fff) out = -0x7fff;
  return out;
}

export function decodeMfmeSamplePack(image: Uint8Array, baseRate: number): MfmeSample[][] {
  const blocks = (image.length + (BLOCK - 1)) >>> 17;
  const out: MfmeSample[][] = [];
  for (let b = 0; b < blocks; b++) {
    const base = b * BLOCK;
    if (base >= image.length) break;
    if (!isMfmeSamplePack(image.subarray(base))) break;
    const count = image[base];
    const bank: MfmeSample[] = [];
    for (let i = 0; i <= count; i++) {
      const w = (image[base + 5 + i * 2] << 8) | image[base + 5 + i * 2 + 1];
      bank.push(decodeSample(image, base, w * 2, baseRate));
    }
    out.push(bank);
  }
  return out;
}

function decodeSample(image: Uint8Array, base: number, offset: number, baseRate: number): MfmeSample {
  let p = base + offset + 1;
  const st: Adpcm = { acc: 0, index: 0 };
  const pcm: number[] = [];
  let rate = 0;
  let repeat = 0;
  let saved = 0;
  let count = 0;
  let byte = 0;
  let ended = false;
  while (!ended && p < image.length) {
    if (repeat !== 0) { repeat -= 1; p = saved; }
    if (repeat === 0) {
      const t = image[p++];
      const top = t & 0xc0;
      if (top === 0x00) {
        st.index = 0;
        if (t === 0) ended = true;
        else for (let k = 0; k < t * 4 + 4; k++) pcm.push(0);
        count = 0;
      } else if (top === 0x40) {
        rate = Math.trunc(baseRate / ((t & 0x3f) + 1));
        count = 0x100;
      } else if (top === 0x80) {
        rate = Math.trunc(baseRate / ((t & 0x3f) + 1));
        count = image[p++] + 1;
      } else {
        repeat = (t & 7) + 1;
        rate = Math.trunc(baseRate / ((image[p++] & 0x3f) + 1));
        count = image[p++] + 1;
        saved = p;
      }
    }
    for (let k = 0; k < count; k++) {
      if ((k & 1) === 0) byte = image[p++] ?? 0;
      pcm.push(step(st, (k & 1) === 0 ? byte >> 4 : byte & 0x0f));
    }
    count = 0;
  }
  if (pcm.length === 0) for (let k = 0; k < 0x80; k++) pcm.push(0);
  return { pcm: Int16Array.from(pcm), rate: rate || 16000 };
}

export class MfmeSamplePlayer implements AudioSource {
  readonly rate: number;
  gain = 1;

  setGain(g: number): void {
    if (g === this.gain) return;
    this.flush();
    this.gain = g;
  }

  private readonly voices = [0, 1].map(() => ({
    cur: null as MfmeSample | null, pos: 0, stepPerFrame: 1, gain: 1,
  }));

  constructor(rate: number) { this.rate = rate; }

  get playing(): boolean { return this.voicePlaying(0); }

  voicePlaying(ch: number): boolean {
    this.flush();
    return this.voices[ch & 1].cur !== null;
  }

  get busy(): boolean { return this.voicePlaying(0) || this.voicePlaying(1); }

  loaded = false;

  start(s: MfmeSample, ch = 0, gain = 1): void {
    this.flush();
    const v = this.voices[ch & 1];
    v.cur = s;
    v.pos = 0;
    v.stepPerFrame = s.rate / this.rate;
    v.gain = gain;
  }

  stop(ch?: number): void {
    this.flush();
    for (let i = 0; i < 2; i++) {
      if (ch !== undefined && (ch & 1) !== i) continue;
      this.voices[i].cur = null;
      this.voices[i].pos = 0;
    }
  }

  reset(): void {
    for (const v of this.voices) { v.cur = null; v.pos = 0; }
    this.ringWrite = 0;
    this.ringRead = 0;
    this.pendingCycles = 0;
    this.cycleRemainder = 0;
  }

  private static readonly RING_FRAMES = 1 << 14;
  private readonly ring = new Float32Array(MfmeSamplePlayer.RING_FRAMES * 2);
  private ringWrite = 0;
  private ringRead = 0;
  private cycleRemainder = 0;
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
    while (frames-- > 0) {
      let s = 0;
      for (const v of this.voices) {
        const cur = v.cur;
        if (!cur) continue;
        const i = Math.floor(v.pos);
        if (i >= cur.pcm.length) { v.cur = null; v.pos = 0; } else {
          s += (cur.pcm[i] / 32768) * this.gain * v.gain;
          v.pos += v.stepPerFrame;
        }
      }
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
