
import type { AudioSource } from '../machine/machine';

const STEP_SIZE = [
  16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88,
  97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371,
  408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411,
  1552,
];

const INDEX_SHIFT = [-1, -1, -1, -1, 2, 4, 6, 8];

export const MSM6376_CLOCK = 128_000;

export const MSM6376_RATE = MSM6376_CLOCK / 8;

export interface Phrase {
  start: number;
  end: number;
  divisor?: number;
}

export function phraseDivisor(rom: Uint8Array, slot: number, base = 0): number {
  const sel = (rom[base + slot * 4] >> 6) & 3;
  return sel === 1 ? 10 : sel === 2 ? 16 : 8;
}

export interface Msm6376Options {
  phraseRates?: boolean;
}

export const PHRASE_SLOTS = 0x70;

export function hasPhraseTable(rom: Uint8Array, base = 0): boolean {
  const be = (i: number) => (((rom[base + i] ?? 0) << 24) | ((rom[base + i + 1] ?? 0) << 16)
    | ((rom[base + i + 2] ?? 0) << 8) | (rom[base + i + 3] ?? 0)) >>> 0;
  return be(0) === 0 && ((be(4) & 0x1fffff) === 0x22000 || (be(8) & 0x1fffff) === 0x22000);
}

export function readPhraseTable(rom: Uint8Array): (Phrase | undefined)[] {
  if (!hasPhraseTable(rom)) return [];
  const addr = (i: number): number => {
    const a = ((rom[i * 4] & 0x3f) << 16) | (rom[i * 4 + 1] << 8) | rom[i * 4 + 2];
    return a === 0 || a >= rom.length ? 0 : a;
  };
  const phrases: (Phrase | undefined)[] = [];
  for (let i = 1; i < PHRASE_SLOTS; i++) {
    const start = addr(i);
    if (!start) { phrases.push(undefined); continue; }
    const next = i + 1 < PHRASE_SLOTS ? addr(i + 1) : 0;
    phrases.push({ start, end: next > start ? next : rom.length });
  }
  while (phrases.length && phrases[phrases.length - 1] === undefined) phrases.pop();
  return phrases;
}

class Voice {
  private pos = 0;
  private endPos = 0;
  private signal = 0;
  private step = 0;
  private blockLeft = 0;
  playing = false;
  gain = 1;
  rateStep = 1;
  private acc = 0;
  private last = 0;

  start(phrase: Phrase): void {
    this.pos = phrase.start * 2;
    this.endPos = phrase.end * 2;
    this.signal = -2;
    this.step = 0;
    this.blockLeft = 0;
    this.rateStep = phrase.divisor ? 8 / phrase.divisor : 1;
    this.acc = 0;
    this.last = 0;
    this.playing = true;
  }

  sample(rom: Uint8Array): number {
    if (!this.playing) return 0;
    this.acc += this.rateStep;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.last = this.next(rom);
    }
    return this.last;
  }

  stop(): void {
    this.playing = false;
  }

  next(rom: Uint8Array): number {
    if (!this.playing) return 0;
    if (this.blockLeft === 0) {
      if (this.pos >= this.endPos) {
        this.playing = false;
        return 0;
      }
      const count = ((rom[this.pos >> 1] ?? 0) & 0x7f) << 1;
      if (count === 0) {
        this.playing = false;
        return 0;
      }
      this.pos += 2;
      this.blockLeft = count;
    }
    this.blockLeft--;
    const byte = rom[this.pos >> 1] ?? 0;
    const nibble = (this.pos & 1) === 0 ? byte >> 4 : byte & 0x0f;
    this.pos++;

    const size = STEP_SIZE[this.step];
    let diff = size >> 3;
    if (nibble & 4) diff += size;
    if (nibble & 2) diff += size >> 1;
    if (nibble & 1) diff += size >> 2;
    this.signal += (nibble & 8) ? -diff : diff;
    if (this.signal > 2047) this.signal = 2047;
    else if (this.signal < -2048) this.signal = -2048;

    this.step += INDEX_SHIFT[nibble & 7];
    if (this.step < 0) this.step = 0;
    else if (this.step > 48) this.step = 48;
    return this.signal;
  }
}

export class Msm6376 implements AudioSource {
  rate: number;

  private rom: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private phrases: (Phrase | undefined)[] = [];

  private readonly voices = [new Voice(), new Voice()];

  gain = 1;

  setGain(g: number): void {
    if (g === this.gain) return;
    this.flush();
    this.gain = g;
  }

  private readonly phraseRates: boolean;

  constructor(rom?: Uint8Array, rate = MSM6376_RATE, options: Msm6376Options = {}) {
    this.rate = rate;
    this.phraseRates = options.phraseRates ?? true;
    if (rom) this.loadRom(rom);
    this.voices[1].gain = 0.5;
  }

  loadRom(rom: Uint8Array): void {
    this.rom = rom;
    this.secondBank = undefined;
    this.phrases = readPhraseTable(rom);
    if (this.phraseRates) {
      this.phrases.forEach((p, i) => { if (p) p.divisor = phraseDivisor(rom, i + 1); });
    }
  }

  setRate(hz: number): void {
    if (!Number.isFinite(hz) || hz <= 0 || hz === this.rate) return;
    this.flush();
    this.rate = hz;
    this.cycleRemainder = 0;
  }

  voicePlaying(ch: number): boolean {
    return this.voices[ch & 1].playing;
  }

  get phraseCount(): number {
    let n = 0;
    for (const p of this.phrases) if (p) n++;
    return n;
  }

  phrase(n: number): Phrase | undefined {
    if (n >= 0x78 && this.secondBank !== undefined) {
      const e = n - 0x78;
      return e > 0 && e < PHRASE_SLOTS ? this.loaderPhrase(this.secondBank, e) : undefined;
    }
    return this.phrases[n - 1];
  }

  setSecondBank(base: number | undefined): void {
    this.secondBank = base;
  }

  private secondBank: number | undefined;

  reset(): void {
    this.flush();
    for (const v of this.voices) v.stop();
    this.narTimer = 0;
    this.ringWrite = 0;
    this.ringRead = 0;
    this.cycleRemainder = 0;
  }

  play(n: number, voice = 0, gain?: number): void {
    this.flush();
    const ch = voice & 1;
    if (ch === 0) {
      if (this.narTimer > 0) return;
      this.narTimer = 4;
    }
    const p = this.phrase(n);
    if (!p) return;
    const v = this.voices[ch];
    if (v.playing) {
      this.staged[ch] = n;
      this.stagedGain[ch] = gain ?? -1;
      return;
    }
    if (gain !== undefined) v.gain = gain;
    v.start(p);
  }

  private readonly stagedGain = [-1, -1];

  startNow(n: number, ch: number, gain = 1): void {
    this.flush();
    if (n === 0) {
      for (const v of this.voices) v.stop();
      this.staged.fill(0);
      return;
    }
    const p = this.phrase(n);
    if (!p) return;
    this.startPhrase(p, ch, gain);
  }

  startPhrase(p: Phrase, ch = 0, gain = 1): void {
    this.flush();
    const v = this.voices[ch & 1];
    this.staged[ch & 1] = 0;
    v.gain = gain;
    v.start(p);
  }

  loaderPhrase(base: number, slot: number): Phrase | undefined {
    const i = base + slot * 4;
    if (i < 0 || i + 3 >= this.rom.length) return undefined;
    const addr = ((this.rom[i] & 0x3f) << 16) | (this.rom[i + 1] << 8) | this.rom[i + 2];
    if (addr === 0 || addr >= this.rom.length) return undefined;
    return {
      start: base + addr,
      end: this.rom.length,
      divisor: this.phraseRates ? phraseDivisor(this.rom, slot, base) : undefined,
    };
  }

  private readonly staged = [0, 0];

  stop(voice?: number): void {
    this.flush();
    if (voice === undefined) for (const v of this.voices) v.stop();
    else this.voices[voice & 1].stop();
  }

  get busy(): boolean {
    return this.voices.some((v) => v.playing);
  }

  get nar(): boolean {
    return this.narTimer === 0;
  }
  private narTimer = 0;

  private static readonly RING_FRAMES = 1 << 14;
  private readonly ring = new Float32Array(Msm6376.RING_FRAMES * 2);
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
      if (this.narTimer > 0) this.narTimer--;
      let s = 0;
      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        s += v.sample(this.rom) * v.gain;
        if (!v.playing && this.staged[i] !== 0) {
          const p = this.phrase(this.staged[i]);
          this.staged[i] = 0;
          if (this.stagedGain[i] >= 0) v.gain = this.stagedGain[i];
          if (p) v.start(p);
        }
      }
      s = (s / 2048) * this.gain * 0.667;
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
