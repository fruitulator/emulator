
import { readSamp, UNITY_RATE } from './mpu5dsp';

const DEFAULT_CMD_ADDR = 0xfffff448;

export interface AsicHooks {
  peekRam?(addr: number): number;
  peekRom?(addr: number): number;
  coinPort?(): number;
  inputPort?(): number;
}

export interface DspVoiceSink {
  start(voice: number, data: number, rate: number): void;
  stop(voice: number): void;
  level(voice: number, value: number): void;
  balance(voice: number, value: number): void;
}

export interface AsicCommand {
  pc: number;
  cmd: number;
  param: number;
}

export interface LedEdge {
  cycles: number;
  led: number;
  on: boolean;
}

const LOG_CAP = 4096;

export class Mpu5Asic {
  commandAddr = DEFAULT_CMD_ADDR;

  readonly regs = new Uint8Array(16);

  readonly lamps = new Uint8Array(16);
  readonly matrixLevel = new Uint8Array(64);
  private readonly matrixHist = new Uint8Array(64);
  private readonly matrixLit = new Uint8Array(64);
  private readonly matrixJustLit = new Uint8Array(64);

  private readonly ledDigits = new Uint8Array(8);
  private highside = 0;
  private lowsidePrev = 0xff;
  private strobeRow = -1;
  private readonly strobeBuf: { data: number; t: number }[] = [];
  private strobePending = false;

  get asicDigits(): Uint8Array {
    return this.ledDigits;
  }

  asicDigit(n: number): number {
    let word = 0;
    for (let s = 0; s < 8; s++) if ((this.ledDigits[s] >> (n & 7)) & 1) word |= 1 << s;
    return word;
  }

  private strobeRecord(row: number, data: number, t: number): void {
    if (this.strobeBuf.length < 8) this.strobeBuf.push({ data, t });
    if (row === -1 || (this.strobeRow !== -1 && row !== this.strobeRow)) {
      const b = this.strobeBuf;
      if (this.strobeRow >= 0 && b.length && b[b.length - 1].t - b[0].t < 28000) this.strobeApply(this.strobeRow);
      this.strobeBuf.length = 0;
    }
    this.strobeRow = row;
  }

  private strobeApply(row: number): void {
    const b = this.strobeBuf;
    const total = Math.max(1, b[b.length - 1].t - b[0].t);
    for (let bit = 0; bit < 8; bit++) {
      const n = row * 8 + bit;
      let on = 0;
      let off = 0;
      for (const e of b) {
        if (e.data & (1 << bit)) { if (on === 0) on = e.t; }
        else if (on !== 0) {
          if (e.t - on > 0x18) { off = e.t; break; }
          on = 0;
        }
      }
      const dur = off - on;
      this.matrixHist[n] = ((this.matrixHist[n] << 1) | (dur !== 0 ? 1 : 0)) & 0xff;
      let level = dur === 0 ? 0 : Math.min(0xff, (dur < 0 ? 0xff : Math.floor((dur * 0xff) / total)));
      const h = this.matrixHist[n] & 0xf;
      const alternating = h === 5 || h === 10;
      if (alternating) level = 0x80;
      this.matrixLevel[n] = level;
      if (dur === 0) {
        if (this.matrixLit[n] && !alternating) { this.matrixLit[n] = 0; this.matrixJustLit[n] = 0; }
      } else {
        if (!this.matrixLit[n]) this.matrixJustLit[n] = 1;
        this.matrixLit[n] = 1;
      }
    }
  }

  lampCurrent(high: number, lowselect: number): boolean {
    if (lowselect < 1 || lowselect > 8) return false;
    let seen = false;
    for (let bit = 0; bit < 8; bit++) {
      const n = (lowselect - 1) * 8 + bit;
      if ((high >> bit) & 1 && this.matrixJustLit[n]) { this.matrixJustLit[n] = 0; seen = true; }
    }
    return seen;
  }

  strobe = 0;
  row = 0;

  statusLeds = 0;

  readonly commands: AsicCommand[] = [];
  readonly ledEdges: LedEdge[] = [];
  dacWrites = 0;

  private static readonly VOICES = 3;
  private readonly busyUntil = new Float64Array(Mpu5Asic.VOICES).fill(-1);
  private readonly pitch = new Uint8Array(Mpu5Asic.VOICES);
  clockHz = 16_515_072;
  private voicesLive = false;
  private lastCmd = 0;

  private result = 0x99;

  private cmdWrittenAt: number | null = null;

  dspRunning = false;

  private crc = 0;
  private crcMatches = 0;

  sink: DspVoiceSink | null = null;

  constructor(private readonly hooks: AsicHooks = {}) {}

  reset(): void {
    this.regs.fill(0);
    this.lamps.fill(0);
    this.matrixLevel.fill(0);
    this.matrixHist.fill(0);
    this.matrixLit.fill(0);
    this.matrixJustLit.fill(0);
    this.highside = 0;
    this.lowsidePrev = 0xff;
    this.ledDigits.fill(0);
    this.strobeRow = -1;
    this.strobeBuf.length = 0;
    this.strobePending = false;
    this.strobe = 0;
    this.row = 0;
    this.statusLeds = 0;
    this.commands.length = 0;
    this.ledEdges.length = 0;
    this.dacWrites = 0;
    this.busyUntil.fill(-1);
    this.pitch.fill(0);
    this.voicesLive = false;
    this.lastCmd = 0;
    this.result = 0x99;
    this.cmdWrittenAt = null;
    this.dspRunning = false;
    this.crc = 0;
    this.crcMatches = 0;
  }

  noteCommandWrite(offset: number, cycles: number): void {
    if (offset === 0) this.cmdWrittenAt = cycles;
  }

  private param16(off: number): number {
    const p = this.hooks.peekRam;
    if (!p) return 0;
    const a = this.commandAddr + off;
    return ((p(a) << 8) | p(a + 1)) & 0xffff;
  }

  private param32(off: number): number {
    const p = this.hooks.peekRam;
    if (!p) return 0;
    const a = this.commandAddr + off;
    return (((p(a) << 24) | (p(a + 1) << 16) | (p(a + 2) << 8) | p(a + 3)) >>> 0);
  }

  private voiceCommand(unit: number, cmd: number, cycles: number): void {
    if (unit >= Mpu5Asic.VOICES) return;
    const param = this.hooks.peekRam?.(this.commandAddr + 1) ?? -1;
    switch (cmd) {
      case 7: {
        const d7 = (param >> 4) & 0xf;
        const d5 = param & 0xf;
        if (param >= 0 && d7 <= d5) this.pitch[unit] = param;
        break;
      }
      case 1:
      case 2: {
        if (param !== (1 << unit)) break;
        const cycles2 = this.sampleCycles(unit);
        if (cycles2 <= 0) break;
        this.voicesLive = true;
        this.busyUntil[unit] = cycles + cycles2;
        this.sink?.start(unit, this.param32(2), this.outputRate(unit));
        break;
      }
      case 8:
        this.sink?.level(unit, this.param16(0x0e) >> 7);
        break;
      case 9:
        this.sink?.balance(unit, this.param16(0x10) >> 7);
        break;
      case 5:
        if (this.voicesLive && param === (1 << unit)) {
          this.busyUntil[unit] = -1;
          this.sink?.stop(unit);
        }
        break;
      default:
        break;
    }
  }

  private outputRate(unit: number): number {
    const d7 = ((this.pitch[unit] >> 4) & 0xf) + 1;
    const d5 = (this.pitch[unit] & 0xf) + 1;
    return UNITY_RATE * (d7 / d5);
  }

  private sampleCycles(unit: number): number {
    const base = this.param32(2);
    const rom = this.hooks.peekRom;
    if (!rom || !base) return 0;
    const samp = readSamp(rom, base);
    if (!samp) return 0;
    return Math.round((samp.samples / this.outputRate(unit)) * this.clockHz);
  }

  read(off: number, cycles = 0): number {
    switch (off & 0xf) {
      case 0x1:
        return this.result;
      case 0x2: {
        if ((this.lastCmd & 0x0f) === 0) return 0x85;
        if ((this.lastCmd & 0x0f) === 0x0c) return this.lastCmd === 0x0c ? 0x00 : 0x01;
        let busy = 0;
        for (let v = 0; v < Mpu5Asic.VOICES; v++) {
          if (this.busyUntil[v] >= 0 && cycles < this.busyUntil[v]) busy |= 1 << v;
        }
        return busy;
      }
      case 0x7:
        return 0;
      case 0x8:
        return this.crc & 0xff;
      case 0xa:
        return this.crc & 0xff;
      case 0xb:
        return 0x00;
      case 0xf:
        return this.hooks.coinPort?.() ?? 0xff;
      case 0xd:
        return this.hooks.inputPort?.() ?? 0x01;
      default:
        return 0;
    }
  }

  lampBytes(out: Uint8Array, at: number, above = 0): void {
    for (let row = 0; row < 8; row++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) if (this.matrixLevel[row * 8 + bit] > above) b |= 1 << bit;
      out[at + row] = b;
    }
  }

  private static crcStep(crc: number, byte: number): number {
    for (let i = 0; i < 8; i++) {
      crc = (crc ^ byte) & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
      byte >>= 1;
    }
    return crc & 0xffff;
  }

  write(off: number, val: number, pc: number, cycles: number): void {
    const o = off & 0xf;
    const v = val & 0xff;
    this.regs[o] = v;

    switch (o) {
      case 0x1:
        this.lamps[this.strobe] = v;
        if (v !== this.highside) {
          this.highside = v;
          if (this.strobePending) this.strobeRecord(this.row, v, cycles);
        }
        break;
      case 0x3:
        this.strobe = v === 0 ? 0 : (31 - Math.clz32(v) + 1) & 0xf;
        break;
      case 0x5: {
        const low = ~v & 0xff;
        const sel = low !== 0 && (low & (low - 1)) === 0;
        this.row = sel ? (31 - Math.clz32(low)) & 0x7 : 0;
        if (v !== this.lowsidePrev) {
          this.lowsidePrev = v;
          if (!sel) { if (this.strobePending) { this.strobeRecord(-1, this.highside, cycles); this.strobePending = false; } }
          else { this.strobeRecord(this.row, this.highside, cycles); this.strobePending = true; }
          if (sel) this.ledDigits[this.row] = this.regs[0x3];
        }
        break;
      }
      case 0xb: {
        const leds = (v >> 4) & 3;
        for (let i = 0; i < 2; i++) {
          const was = (this.statusLeds >> i) & 1;
          const now = (leds >> i) & 1;
          if (was !== now && this.ledEdges.length < LOG_CAP) {
            this.ledEdges.push({ cycles, led: i, on: now === 1 });
          }
        }
        this.statusLeds = leds;
        if (v & 0x40) {
          this.dspRunning = true;
          const consumed = this.cmdWrittenAt !== null
            && cycles - this.cmdWrittenAt < 200_000;
          this.cmdWrittenAt = null;
          const cmdByte = consumed ? this.hooks.peekRam?.(this.commandAddr) ?? -1 : -1;
          if (consumed && cmdByte !== 0) this.result = 0x00;
          if (consumed && cmdByte >= 0) this.lastCmd = cmdByte;
          if (cmdByte >= 0) this.voiceCommand(cmdByte >> 5, cmdByte & 0x1f, cycles);
          if (this.commands.length < LOG_CAP) {
            this.commands.push({
              pc,
              cmd: cmdByte,
              param: consumed ? this.hooks.peekRam?.(this.commandAddr + 1) ?? -1 : -1,
            });
          }
        }
        break;
      }
      case 0xd: {
        const match = v === (this.crc & 0xff);
        this.crc = Mpu5Asic.crcStep(this.crc, v);
        if (match && ++this.crcMatches >= 2) {
          this.crc = 0;
          this.crcMatches = 0;
        } else if (!match) {
          this.crcMatches = 0;
        }
        break;
      }
      case 0xe:
      case 0xf:
        if (o === 0xe) this.dacWrites++;
        break;
    }
  }

  blinkGroups(gap: number): number[] {
    const groups: number[] = [];
    let count = 0;
    let last = -Infinity;
    for (const e of this.ledEdges) {
      if (!e.on) continue;
      if (e.cycles - last > gap && count > 0) {
        groups.push(count);
        count = 0;
      }
      count++;
      last = e.cycles;
    }
    if (count > 0) groups.push(count);
    return groups;
  }
}
