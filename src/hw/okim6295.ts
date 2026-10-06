
import type { AudioSource } from '../machine/machine';

const STEP_SIZE = [
  16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88,
  97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371,
  408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411,
  1552,
];

const INDEX_SHIFT = [-1, -1, -1, -1, 2, 4, 6, 8];

const DIFF_LOOKUP = (() => {
  const t = new Int32Array(49 * 16);
  for (let step = 0; step <= 48; step++) {
    const s = STEP_SIZE[step];
    for (let nib = 0; nib < 16; nib++) {
      const mag = (nib & 4 ? s : 0) + (nib & 2 ? s >> 1 : 0) + (nib & 1 ? s >> 2 : 0) + (s >> 3);
      t[step * 16 + nib] = nib & 8 ? -mag : mag;
    }
  }
  return t;
})();

const VOLUME = [0x20, 0x16, 0x10, 0x0b, 0x08, 0x06, 0x04, 0x03, 0x02, 0, 0, 0, 0, 0, 0, 0].map((v) => v / 0x20);

export function okim6295Rate(clock: number, pin7High: boolean): number {
  return Math.floor(clock / (pin7High ? 132 : 165));
}

class Voice {
  playing = false;
  base = 0;
  sample = 0;
  count = 0;
  volume = 0;
  signal = 0;
  step = 0;

  clock(nibble: number): number {
    this.signal += DIFF_LOOKUP[this.step * 16 + (nibble & 15)];
    if (this.signal > 2047) this.signal = 2047;
    else if (this.signal < -2048) this.signal = -2048;
    this.step += INDEX_SHIFT[nibble & 7];
    if (this.step > 48) this.step = 48;
    else if (this.step < 0) this.step = 0;
    return this.signal;
  }
}

export class Okim6295 implements AudioSource {
  readonly rate: number;
  private rom: Uint8Array = new Uint8Array(0);
  private bankBase = 0;
  private readonly voices = [new Voice(), new Voice(), new Voice(), new Voice()];
  private command = -1;
  gain = 0.5;

  constructor(rate: number) {
    this.rate = rate;
  }

  loadRom(rom: Uint8Array): void {
    this.rom = rom;
  }

  setBank(bank: number): void {
    const base = bank * 0x40000;
    if (base === this.bankBase) return;
    this.flush();
    this.bankBase = base;
  }

  private byte(addr: number): number {
    const n = this.rom.length;
    if (n === 0) return 0;
    return this.rom[(this.bankBase + (addr & 0x3ffff)) % n];
  }

  reset(): void {
    this.flush();
    for (const v of this.voices) v.playing = false;
    this.command = -1;
    this.ringWrite = this.ringRead = 0;
    this.cycleRemainder = 0;
  }

  read(): number {
    this.flush();
    let r = 0xf0;
    for (let i = 0; i < 4; i++) if (this.voices[i].playing) r |= 1 << i;
    return r;
  }

  voicePlaying(n: number): boolean {
    this.flush();
    return this.voices[n & 3].playing;
  }

  write(cmd: number): void {
    cmd &= 0xff;
    if (this.command !== -1) {
      this.flush();
      let mask = cmd >> 4;
      for (let i = 0; i < 4; i++, mask >>= 1) {
        if (!(mask & 1)) continue;
        const v = this.voices[i];
        if (v.playing) continue;
        const base = this.command * 8;
        const start = ((this.byte(base) << 16) | (this.byte(base + 1) << 8) | this.byte(base + 2)) & 0x3ffff;
        const stop = ((this.byte(base + 3) << 16) | (this.byte(base + 4) << 8) | this.byte(base + 5)) & 0x3ffff;
        if (start < stop) {
          v.playing = true;
          v.base = start;
          v.sample = 0;
          v.count = 2 * (stop - start + 1);
          v.signal = 0;
          v.step = 0;
          v.volume = VOLUME[cmd & 0x0f];
        }
      }
      this.command = -1;
    } else if (cmd & 0x80) {
      this.command = cmd & 0x7f;
    } else {
      this.flush();
      let mask = cmd >> 3;
      for (let i = 0; i < 4; i++, mask >>= 1) if (mask & 1) this.voices[i].playing = false;
    }
  }

  private static readonly RING_FRAMES = 1 << 14;
  private readonly ring = new Float32Array(Okim6295.RING_FRAMES * 2);
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
    this.cycleRemainder += cycles * this.rate;
    let frames = Math.floor(this.cycleRemainder / this.pendingClock);
    if (frames <= 0) return;
    this.cycleRemainder -= frames * this.pendingClock;
    while (frames-- > 0) {
      let s = 0;
      for (const v of this.voices) {
        if (!v.playing) continue;
        const nibble = (this.byte(v.base + (v.sample >> 1)) >> (((v.sample & 1) << 2) ^ 4)) & 15;
        s += v.clock(nibble) * v.volume;
        if (++v.sample >= v.count) v.playing = false;
      }
      s = (s / 2048) * this.gain;
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
