
import type { AudioSource } from '../machine/machine';

export const UPD7759_CLOCK = 640_000;
export const UPD7759_RATE = UPD7759_CLOCK / 4;

const BANK_SIZE = 0x20000;

export function upd7759Header(rom: Uint8Array, at: number): boolean {
  return at + 5 <= rom.length
    && rom[at + 1] === 0x5a && rom[at + 2] === 0xa5
    && rom[at + 3] === 0x69 && rom[at + 4] === 0x55;
}

const STATE_IDLE = 0;
const STATE_DROP_DRQ = 1;
const STATE_START = 2;
const STATE_FIRST_REQ = 3;
const STATE_LAST_SAMPLE = 4;
const STATE_DUMMY1 = 5;
const STATE_ADDR_MSB = 6;
const STATE_ADDR_LSB = 7;
const STATE_DUMMY2 = 8;
const STATE_BLOCK_HEADER = 9;
const STATE_NIBBLE_COUNT = 10;
const STATE_NIBBLE_MSN = 11;
const STATE_NIBBLE_LSN = 12;

const FRAC_BITS = 20;
const FRAC_ONE = 1 << FRAC_BITS;

const STEP: readonly (readonly number[])[] = [
  [0, 0, 1, 2, 3, 5, 7, 10, 0, 0, -1, -2, -3, -5, -7, -10],
  [0, 1, 2, 3, 4, 6, 8, 13, 0, -1, -2, -3, -4, -6, -8, -13],
  [0, 1, 2, 4, 5, 7, 10, 15, 0, -1, -2, -4, -5, -7, -10, -15],
  [0, 1, 3, 4, 6, 9, 13, 19, 0, -1, -3, -4, -6, -9, -13, -19],
  [0, 2, 3, 5, 8, 11, 15, 23, 0, -2, -3, -5, -8, -11, -15, -23],
  [0, 2, 4, 7, 10, 14, 19, 29, 0, -2, -4, -7, -10, -14, -19, -29],
  [0, 3, 5, 8, 12, 16, 22, 33, 0, -3, -5, -8, -12, -16, -22, -33],
  [1, 4, 7, 10, 15, 20, 29, 43, -1, -4, -7, -10, -15, -20, -29, -43],
  [1, 4, 8, 13, 18, 25, 35, 53, -1, -4, -8, -13, -18, -25, -35, -53],
  [1, 6, 10, 16, 22, 31, 43, 64, -1, -6, -10, -16, -22, -31, -43, -64],
  [2, 7, 12, 19, 27, 37, 51, 76, -2, -7, -12, -19, -27, -37, -51, -76],
  [2, 9, 16, 24, 34, 46, 64, 96, -2, -9, -16, -24, -34, -46, -64, -96],
  [3, 11, 19, 29, 41, 57, 79, 117, -3, -11, -19, -29, -41, -57, -79, -117],
  [4, 13, 24, 36, 50, 69, 96, 143, -4, -13, -24, -36, -50, -69, -96, -143],
  [4, 16, 29, 44, 62, 85, 118, 175, -4, -16, -29, -44, -62, -85, -118, -175],
  [6, 20, 36, 54, 76, 104, 144, 214, -6, -20, -36, -54, -76, -104, -144, -214],
];

const STATE_TABLE = [-1, -1, 0, 0, 1, 2, 2, 3, -1, -1, 0, 0, 1, 2, 2, 3];

export class Upd7759 implements AudioSource {
  get rate(): number {
    return UPD7759_RATE;
  }

  private rom: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private romBank = 0;

  gain = 1;

  setGain(g: number): void {
    if (g === this.gain) return;
    this.flush();
    this.gain = g;
  }

  private fifoIn = 0;
  private resetLine = true;
  private startLine = true;
  private drq = 0;

  private state = STATE_IDLE;
  private clocksLeft = 0;
  private nibblesLeft = 0;
  private repeatCount = 0;
  private postDrqState = STATE_IDLE;
  private postDrqClocks = 0;
  private reqSample = 0;
  private lastSample = 0;
  private blockHeader = 0;
  private sampleRate = 0;
  private firstValidHeader = 0;
  private offset = 0;
  private repeatOffset = 0;
  private adpcmState = 0;
  private adpcmData = 0;
  private sample = 0;
  private pos = 0;

  loadRom(data: Uint8Array): void {
    this.rom = data;
  }

  get romImage(): Uint8Array<ArrayBufferLike> {
    return this.rom;
  }

  setRomBank(bank: number): void {
    this.flush();
    this.romBank = bank & 3;
  }

  private readByte(addr: number): number {
    if (this.rom.length === 0) return 0;
    return this.rom[(this.romBank * BANK_SIZE + (addr & (BANK_SIZE - 1))) % this.rom.length];
  }

  private deviceReset(): void {
    this.pos = 0;
    this.state = STATE_IDLE;
    this.clocksLeft = 0;
    this.nibblesLeft = 0;
    this.repeatCount = 0;
    this.postDrqState = STATE_IDLE;
    this.postDrqClocks = 0;
    this.reqSample = 0;
    this.lastSample = 0;
    this.blockHeader = 0;
    this.sampleRate = 0;
    this.firstValidHeader = 0;
    this.offset = 0;
    this.repeatOffset = 0;
    this.adpcmState = 0;
    this.adpcmData = 0;
    this.sample = 0;
    this.drq = 0;
  }

  reset(): void {
    this.flush();
    this.deviceReset();
    this.fifoIn = 0;
    this.resetLine = true;
    this.startLine = true;
  }

  setResetLine(level: boolean): void {
    this.flush();
    const old = this.resetLine;
    this.resetLine = level;
    if (old && !level) this.deviceReset();
  }

  setStartLine(level: boolean, bank?: number): void {
    this.flush();
    const old = this.startLine;
    this.startLine = level;
    if (this.state === STATE_IDLE && old && !level && this.resetLine) {
      if (bank !== undefined) this.romBank = bank & 3;
      this.state = STATE_START;
    }
  }

  portW(data: number): void {
    this.flush();
    this.fifoIn = data & 0xff;
  }

  busy(): boolean {
    return this.state === STATE_IDLE;
  }

  active(): boolean {
    return this.state !== STATE_IDLE;
  }

  private updateAdpcm(nibble: number): void {
    this.sample += STEP[this.adpcmState][nibble];
    this.adpcmState += STATE_TABLE[nibble];
    if (this.adpcmState < 0) this.adpcmState = 0;
    else if (this.adpcmState > 15) this.adpcmState = 15;
  }

  private advanceState(): void {
    switch (this.state) {
      case STATE_IDLE:
        this.clocksLeft = 4;
        break;

      case STATE_DROP_DRQ:
        this.drq = 0;
        this.clocksLeft = this.postDrqClocks;
        this.state = this.postDrqState;
        break;

      case STATE_START:
        this.reqSample = this.fifoIn;
        this.clocksLeft = 70;
        this.state = STATE_FIRST_REQ;
        break;

      case STATE_FIRST_REQ:
        this.drq = 1;
        this.clocksLeft = 44;
        this.state = STATE_LAST_SAMPLE;
        break;

      case STATE_LAST_SAMPLE:
        this.lastSample = this.readByte(0);
        this.drq = 1;
        this.clocksLeft = 28;
        this.state = this.reqSample > this.lastSample ? STATE_IDLE : STATE_DUMMY1;
        break;

      case STATE_DUMMY1:
        this.drq = 1;
        this.clocksLeft = 32;
        this.state = STATE_ADDR_MSB;
        break;

      case STATE_ADDR_MSB:
        this.offset = this.readByte(this.reqSample * 2 + 5) << 9;
        this.drq = 1;
        this.clocksLeft = 44;
        this.state = STATE_ADDR_LSB;
        break;

      case STATE_ADDR_LSB:
        this.offset |= this.readByte(this.reqSample * 2 + 6) << 1;
        this.drq = 1;
        this.clocksLeft = 36;
        this.state = STATE_DUMMY2;
        break;

      case STATE_DUMMY2:
        this.offset++;
        this.firstValidHeader = 0;
        this.drq = 1;
        this.clocksLeft = 36;
        this.state = STATE_BLOCK_HEADER;
        break;

      case STATE_BLOCK_HEADER:
        if (this.repeatCount) {
          this.repeatCount--;
          this.offset = this.repeatOffset;
        }
        this.blockHeader = this.readByte(this.offset++);
        this.drq = 1;
        switch (this.blockHeader & 0xc0) {
          case 0x00:
            this.clocksLeft = 1024 * ((this.blockHeader & 0x3f) + 1);
            this.state =
              this.blockHeader === 0 && this.firstValidHeader ? STATE_IDLE : STATE_BLOCK_HEADER;
            this.sample = 0;
            this.adpcmState = 0;
            break;
          case 0x40:
            this.sampleRate = (this.blockHeader & 0x3f) + 1;
            this.nibblesLeft = 256;
            this.clocksLeft = 36;
            this.state = STATE_NIBBLE_MSN;
            break;
          case 0x80:
            this.sampleRate = (this.blockHeader & 0x3f) + 1;
            this.clocksLeft = 36;
            this.state = STATE_NIBBLE_COUNT;
            break;
          case 0xc0:
            this.repeatCount = (this.blockHeader & 7) + 1;
            this.repeatOffset = this.offset;
            this.clocksLeft = 36;
            this.state = STATE_BLOCK_HEADER;
            break;
        }
        if (this.blockHeader !== 0) this.firstValidHeader = 1;
        break;

      case STATE_NIBBLE_COUNT:
        this.nibblesLeft = this.readByte(this.offset++) + 1;
        this.drq = 1;
        this.clocksLeft = 36;
        this.state = STATE_NIBBLE_MSN;
        break;

      case STATE_NIBBLE_MSN:
        this.adpcmData = this.readByte(this.offset++);
        this.updateAdpcm(this.adpcmData >> 4);
        this.drq = 1;
        this.clocksLeft = this.sampleRate * 4;
        this.state = --this.nibblesLeft === 0 ? STATE_BLOCK_HEADER : STATE_NIBBLE_LSN;
        break;

      case STATE_NIBBLE_LSN:
        this.updateAdpcm(this.adpcmData & 15);
        this.clocksLeft = this.sampleRate * 4;
        this.state = --this.nibblesLeft === 0 ? STATE_BLOCK_HEADER : STATE_NIBBLE_MSN;
        break;
    }

    if (this.drq) {
      this.postDrqState = this.state;
      this.postDrqClocks = this.clocksLeft - 21;
      this.state = STATE_DROP_DRQ;
      this.clocksLeft = 21;
    }
  }

  private static readonly RING_FRAMES = 1 << 15;
  private readonly ring = new Float32Array(Upd7759.RING_FRAMES * 2);
  private ringWrite = 0;
  private ringRead = 0;
  private cycleRemainder = 0;

  private renderFrame(): number {
    const out = this.state !== STATE_IDLE ? this.sample * (128 / 32768) : 0;
    if (this.state !== STATE_IDLE) {
      this.pos += 4 * FRAC_ONE;
      while (this.pos >= FRAC_ONE) {
        let clocks = this.pos >>> FRAC_BITS;
        if (clocks > this.clocksLeft) clocks = this.clocksLeft;
        this.pos -= clocks * FRAC_ONE;
        this.clocksLeft -= clocks;
        if (this.clocksLeft === 0) {
          this.advanceState();
          if (this.state === STATE_IDLE) break;
        }
      }
    }
    return out;
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
    this.cycleRemainder += cycles * UPD7759_RATE;
    let frames = Math.floor(this.cycleRemainder / cpuClock);
    if (frames <= 0) return;
    this.cycleRemainder -= frames * cpuClock;
    while (frames-- > 0) {
      const s = this.renderFrame() * this.gain;
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
