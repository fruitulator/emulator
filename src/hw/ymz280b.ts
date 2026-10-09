
const REG_CONTROL = 0xff;
const REG_IRQ_MASK = 0xfe;
const CTRL_KEYON_ENABLE = 0x80;
const CTRL_EXT_MEM_ENABLE = 0x40;
const CTRL_IRQ_ENABLE = 0x10;

export const YMZ_CLOCK = 16_934_400;
export const YMZ_SAMPLE_RATE = (YMZ_CLOCK / 384) * 2;

const FRAC_BITS = 9;
const FRAC_ONE = 1 << FRAC_BITS;

const DIFF_LOOKUP = new Int16Array(16);
for (let nib = 0; nib < 16; nib++) {
  const value = (nib & 0x07) * 2 + 1;
  DIFF_LOOKUP[nib] = nib & 0x08 ? -value : value;
}
const INDEX_SCALE = [0x0e6, 0x0e6, 0x0e6, 0x0e6, 0x133, 0x199, 0x200, 0x266];

interface Voice {
  fnum: number;
  mode: number;
  looping: boolean;
  keyon: boolean;
  playing: boolean;
  level: number;
  pan: number;
  start: number;
  stop: number;
  loopStart: number;
  loopEnd: number;
  position: number;
  signal: number;
  step: number;
  outputPos: number;
  prev: number;
  curr: number;
  outputStep: number;
  outLeft: number;
  outRight: number;
}

function newVoice(): Voice {
  return {
    fnum: 0, mode: 0, looping: false, keyon: false, playing: false,
    level: 0, pan: 8, start: 0, stop: 0, loopStart: 0, loopEnd: 0,
    position: 0, signal: 0, step: 0x7f, outputPos: FRAC_ONE, prev: 0, curr: 0,
    outputStep: 1, outLeft: 0, outRight: 0,
  };
}

export interface YmzHooks {
  irqChanged?(): void;
}

export class Ymz280b {
  get rate(): number {
    return YMZ_SAMPLE_RATE;
  }

  private rom: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  private currentRegister = 0;
  private keyOnEnable = false;
  private extMemEnable = false;
  private irqEnable = false;
  private irqMask = 0;

  private irqBits = 0;

  get irqLine(): boolean {
    return this.irqBits !== 0;
  }

  private extAddress = 0;
  private extAddressHi = 0;
  private extAddressMid = 0;
  private extLatch = 0;

  private status = 0;
  private readonly voices: Voice[] = Array.from({ length: 8 }, newVoice);

  constructor(private readonly hooks: YmzHooks = {}) {}

  gain = 1;

  setGain(g: number): void {
    if (g === this.gain) return;
    this.flush();
    this.gain = g;
  }

  loadRom(data: Uint8Array): void {
    this.rom = data;
  }

  reset(): void {
    this.flush();
    this.currentRegister = 0;
    this.keyOnEnable = false;
    this.extMemEnable = false;
    this.irqEnable = false;
    this.irqMask = 0;
    this.irqBits = 0;
    this.extAddress = 0;
    this.extAddressHi = 0;
    this.extAddressMid = 0;
    this.extLatch = 0;
    this.status = 0;
    for (let i = 0; i < this.voices.length; i++) this.voices[i] = newVoice();
  }

  irq(): boolean {
    return this.irqEnable && this.status !== 0;
  }

  private romByte(addr: number): number {
    if (this.rom.length === 0) return 0;
    return this.rom[addr % this.rom.length] ?? 0xff;
  }

  read(port: number): number {
    this.flush();
    if ((port & 1) === 0) {
      if (!this.extMemEnable) return 0xff;
      const v = this.extLatch;
      this.extLatch = this.romByte(this.extAddress);
      this.extAddress = (this.extAddress + 1) & 0xffffff;
      return v;
    }
    const v = this.status;
    this.status = 0;
    this.irqBits = 0;
    this.hooks.irqChanged?.();
    return v;
  }

  write(port: number, data: number): void {
    this.flush();
    const v = data & 0xff;
    if ((port & 1) === 0) {
      this.currentRegister = v;
      return;
    }
    this.writeRegister(this.currentRegister, v);
  }

  private writeRegister(reg: number, data: number): void {
    if (reg < 0x80) {
      const v = this.voices[(reg >> 2) & 7];
      switch (reg & 0xe3) {
        case 0x00:
          v.fnum = (v.fnum & 0x100) | (data & 0xff);
          this.updateStep(v);
          break;
        case 0x01: {
          v.fnum = (v.fnum & 0xff) | ((data & 0x01) << 8);
          v.looping = (data & 0x10) !== 0;
          if ((data & 0x60) === 0) data &= 0x7f;
          else v.mode = (data & 0x60) >> 5;
          const on = (data & 0x80) !== 0;
          if (!v.keyon && on && this.keyOnEnable) {
            v.playing = true;
            v.position = v.start;
            v.signal = 0;
            v.step = 0x7f;
            v.outputPos = FRAC_ONE;
            v.prev = 0;
            v.curr = 0;
          } else if (v.keyon && !on) {
            v.playing = false;
          }
          v.keyon = on;
          this.updateStep(v);
          break;
        }
        case 0x02:
          v.level = data;
          this.updateVolumes(v);
          break;
        case 0x03:
          v.pan = data & 0x0f;
          this.updateVolumes(v);
          break;
        case 0x20: v.start = (v.start & 0x1fffe) | (data << 17); break;
        case 0x21: v.loopStart = (v.loopStart & 0x1fffe) | (data << 17); break;
        case 0x22: v.loopEnd = (v.loopEnd & 0x1fffe) | (data << 17); break;
        case 0x23: v.stop = (v.stop & 0x1fffe) | (data << 17); break;
        case 0x40: v.start = (v.start & 0x1fe01fe) | (data << 9); break;
        case 0x41: v.loopStart = (v.loopStart & 0x1fe01fe) | (data << 9); break;
        case 0x42: v.loopEnd = (v.loopEnd & 0x1fe01fe) | (data << 9); break;
        case 0x43: v.stop = (v.stop & 0x1fe01fe) | (data << 9); break;
        case 0x60: v.start = (v.start & 0x1fffe00) | (data << 1); break;
        case 0x61: v.loopStart = (v.loopStart & 0x1fffe00) | (data << 1); break;
        case 0x62: v.loopEnd = (v.loopEnd & 0x1fffe00) | (data << 1); break;
        case 0x63: v.stop = (v.stop & 0x1fffe00) | (data << 1); break;
      }
      return;
    }

    switch (reg) {
      case REG_IRQ_MASK:
        this.irqMask = data;
        break;
      case 0x84:
        this.extAddressHi = data << 16;
        break;
      case 0x85:
        this.extAddressMid = data << 8;
        break;
      case 0x86:
        this.extAddress = (this.extAddressHi | this.extAddressMid | data) & 0xffffff;
        if (this.extMemEnable) this.extLatch = this.romByte(this.extAddress);
        break;
      case 0x87:
        this.extAddress = (this.extAddress + 1) & 0xffffff;
        break;
      case REG_CONTROL:
        this.extMemEnable = (data & CTRL_EXT_MEM_ENABLE) !== 0;
        this.irqEnable = (data & CTRL_IRQ_ENABLE) !== 0;
        if (this.keyOnEnable && !(data & CTRL_KEYON_ENABLE)) {
          for (const v of this.voices) { v.playing = false; v.keyon = false; }
        }
        this.keyOnEnable = (data & CTRL_KEYON_ENABLE) !== 0;
        this.hooks.irqChanged?.();
        break;
    }
  }

  private updateStep(v: Voice): void {
    v.outputStep = (v.mode === 1 ? v.fnum & 0xff : v.fnum & 0x1ff) + 1;
  }

  private updateVolumes(v: Voice): void {
    if (v.pan === 8) {
      v.outLeft = v.level;
      v.outRight = v.level;
    } else if (v.pan < 8) {
      v.outLeft = v.level;
      v.outRight = v.pan === 0 ? 0 : (v.level * (v.pan - 1)) / 7;
    } else {
      v.outLeft = (v.level * (15 - v.pan)) / 7;
      v.outRight = v.level;
    }
  }

  private finishVoice(v: Voice, index: number): void {
    v.playing = false;
    this.status |= 1 << index;
    if (this.irqEnable && (this.irqMask >> index) & 1) this.irqBits |= 1 << index;
    this.hooks.irqChanged?.();
  }

  private nextSample(v: Voice, index: number): number | null {
    if (v.mode === 1) {
      const byte = this.romByte(v.position >> 1);
      const nib = (byte >> (((~v.position & 1) << 2))) & 0x0f;
      v.signal += (v.step * DIFF_LOOKUP[nib]) / 8;
      if (v.signal > 32767) v.signal = 32767;
      else if (v.signal < -32768) v.signal = -32768;
      v.step = (v.step * INDEX_SCALE[nib & 7]) >> 8;
      if (v.step > 0x6000) v.step = 0x6000;
      else if (v.step < 0x7f) v.step = 0x7f;
      v.position++;
    } else if (v.mode === 2) {
      v.signal = ((this.romByte(v.position >> 1) ^ 0x80) - 0x80) << 8;
      v.position += 2;
    } else {
      const p = v.position >> 1;
      v.signal = (((this.romByte(p) << 8) | this.romByte(p + 1)) << 16) >> 16;
      v.position += 4;
    }
    if (v.looping && v.loopEnd > v.loopStart && v.position >= v.loopEnd) {
      v.position = v.loopStart;
    } else if (v.position >= v.stop) {
      this.finishVoice(v, index);
      return null;
    }
    if (this.rom.length === 0) return 0;
    return v.signal | 0;
  }

  render(out: Float32Array, frames: number): void {
    for (let i = 0; i < frames * 2; i++) out[i] = 0;
    for (let index = 0; index < this.voices.length; index++) {
      const v = this.voices[index];
      if (!v.playing || v.mode === 0) continue;
      const lvol = (v.outLeft / 255) * this.gain, rvol = (v.outRight / 255) * this.gain;
      for (let i = 0; i < frames; i++) {
        while (v.outputPos >= FRAC_ONE) {
          const s = this.nextSample(v, index);
          if (s === null) { v.outputPos = FRAC_ONE; break; }
          v.prev = v.curr;
          v.curr = s;
          v.outputPos -= FRAC_ONE;
        }
        if (!v.playing) break;
        const interp = (v.prev * (FRAC_ONE - v.outputPos) + v.curr * v.outputPos) / FRAC_ONE;
        const s = interp / 32768 / 2;
        out[i * 2] += s * lvol;
        out[i * 2 + 1] += s * rvol;
        v.outputPos += v.outputStep;
      }
    }
    for (let i = 0; i < frames * 2; i++) {
      if (out[i] > 1) out[i] = 1;
      else if (out[i] < -1) out[i] = -1;
    }
  }

  active(): boolean {
    return this.voices.some((v) => v.playing);
  }

  private static readonly RING_FRAMES = 1 << 15;
  private readonly ring = new Float32Array(Ymz280b.RING_FRAMES * 2);
  private ringWrite = 0;
  private ringRead = 0;
  private cycleRemainder = 0;
  private readonly chunk = new Float32Array(512 * 2);

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
    this.cycleRemainder += cycles * YMZ_SAMPLE_RATE;
    let frames = Math.floor(this.cycleRemainder / cpuClock);
    if (frames <= 0) return;
    this.cycleRemainder -= frames * cpuClock;
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
