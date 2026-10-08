import type { Bus } from '../cpu/bus';
import type { Machine, DigitKind, CabinetSwitch, CoinPortLines, CoinWiringStatus } from './machine';
import { newCashLedger, ledgerOutMults, dilSwitchLabel } from './machine';
import type { SlideEffect, SwitchControl } from '../layout/fmlconfig';
import type { LayoutSwitch } from './layoutswitches';
import type { BoardPart } from './parts';
import { M6809 } from '../cpu/m6809';
import { Pia6821 } from '../hw/pia6821';
import { V20SoftSerial } from '../hw/v20softserial';
import { DataPak } from '../hw/datapak';
import { Ptm6840 } from '../hw/ptm6840';
import { Reel } from '../hw/reel';
import { v20IndexWindow, V20_ARM_MPU4, MODEL_RELATIONS, oursFromMfme, V20_REEL_POWER_UP_POS, resetReelsInPlace } from './v20optic';
import { Characteriser, type CharacteriserTable } from '../hw/characteriser';
import type { BwbCharacteriser } from '../hw/bwbchr';
import { Msc1937 } from '../hw/msc1937';
import { Ay8910, AY_RATE } from '../hw/ay8910';
import { Msm6376, MSM6376_RATE, hasPhraseTable } from '../hw/msm6376';
import { Ym2413 } from '../hw/ym2413';
import { Mixer } from '../hw/mixer';
import { OneBitSpeaker } from '../hw/speaker';
import { BASE_BOARD_BASS_FREQ } from '../hw/blipleak';
import { setBoardLevel } from '../hw/steppedvolume';
import { decodeMfmeSamplePack, MfmeSamplePlayer, type MfmeSample } from '../hw/mfmesamples';
import { Hopper, v20Waveform } from '../hw/hopper';
import { MuxLamps } from '../hw/muxlamps';
import { StrayCounter } from './strayaccess';
import { noteRomCut } from './boarddefaults';
import { linesOf, MeterUnitCheck, meterCheckState, wiringKey, wiringStateFor, type CoinLineTable, type CoinWiring, type MeterCheckState, type SlotCoin } from './coinwiring';
import { readMpu4CoinTable, readMpu4CoinTakes } from './mpu4coins';
import { readMpu4VideoCoinTable, readMpu4VideoCoinTakes } from './mpu4vidcoins';
import { coinRowPattern, type DeclaredCoin } from './layoutcoins';
import type { Mpu4VideoCard } from './mpu4video';

export const MASTER_CLOCK = 6_880_000;
export const E_CLOCK = MASTER_CLOCK / 4;
export const METER_SETTLE_CYCLES = 0x32;

export const METER_TICK_CYCLES = 0x1068;

export const METER_HOLD_TICKS = 5;

export const MPU4_FULL_METER_PAYOUTS: ReadonlySet<number> = new Set([0, 3, 5, 8, 9, 0x0b]);

export interface Mpu4SoundCommand { kind: 'play' | 'stop'; slot: number; }

export function mpu4SampleSlot(entry: number, bank: number, banks: number): number {
  if (bank >= banks) return 0;
  return entry < 0x78 ? bank * 0x78 + entry : 0;
}

export const MPU4_SAMPLE_BANK_MASK = 0;

export const MPU4_SAMPLE_PACK_RATE = 160_000;

export function mpu4OkiLatch(data: number, banks: number): number {
  const d = data & 0xff;
  if (banks < 2) return d & 0x7f;
  return mpu4SampleSlot(d & 0x7f, d > 0x80 ? 1 : 0, banks);
}

export function mpu4SampleBanks(files: readonly Uint8Array[]): number[] {
  const bases: number[] = [];
  let offset = 0;
  for (const f of files.slice(0, 4)) {
    if (hasPhraseTable(f)) {
      if (bases.length < 2) bases.push(offset);
    }
    offset += f.length;
  }
  return bases;
}

const ROM_BASE = 0x1000;
const PAGE_SIZE = 0x10000;

const MAINS_HZ = 50;
const LAMP_ENABLE_CYCLES = 0x3241;

export function mpu4RomImage(chunks: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const c of chunks) size += c.length;
  const image = new Uint8Array(Math.max(size, PAGE_SIZE));
  let addr = size < PAGE_SIZE ? PAGE_SIZE - size : 0;
  for (let i = chunks.length - 1; i >= 0; i--) {
    image.set(chunks[i], addr);
    addr += chunks[i].length;
  }
  return image;
}

const MPU4_SCRAMBLE: readonly (readonly [number, readonly number[]] | null)[] = [
  [0xca, [3, 2, 1, 0, 7, 4, 6, 5]],
  [0xca, [3, 2, 1, 0, 7, 4, 6, 5]],
  [0x30, [3, 0, 4, 6, 1, 5, 7, 2]],
  [0x89, [4, 1, 2, 5, 7, 0, 6, 3]],
  null, null, null, null,
  [0x14, [6, 1, 4, 3, 2, 5, 0, 7]],
  [0x40, [1, 0, 3, 2, 5, 4, 7, 6]],
  [0xcb, [3, 2, 1, 0, 7, 6, 5, 4]],
  [0xc0, [2, 3, 6, 0, 5, 1, 7, 4]],
];

export function mpu4Descramble(image: Uint8Array, extraXor: number): Uint8Array {
  const n = Math.min(image.length, PAGE_SIZE);
  for (let i = 0; i < n; i++) {
    const rule = MPU4_SCRAMBLE[(i & 0x58) >> 3];
    let x = image[i];
    if (rule) {
      const [xor, order] = rule;
      x ^= xor;
      let out = 0;
      for (let b = 0; b < 8; b++) out |= ((x >> order[b]) & 1) << (7 - b);
      x = out;
    }
    image[i] = (x ^ extraXor) & 0xff;
  }
  return image;
}

export const MPU4_ENCRYPTION: Readonly<Record<string, number | null>> = {
  Normal: null,
  Crystal: 0x00,
  'Crystal 2': 0xff,
  None: null,
};

export interface Mpu4Outputs {
  readonly lamps: Uint8Array;
  readonly leds: Uint8Array;
  readonly ledLevels: Uint8Array;
  triacs: number;
  meters: number;
  readonly reels: readonly Reel[];
}

export type Mpu4ReelMux =
  'standard' | 'five5to8' | 'five8to5' | 'five3to6' | 'six1to8' | 'five1to4' | 'seven'
  | 'six5to8';

const REEL_MUX_REELS: Record<Mpu4ReelMux, number> = {
  standard: 4, five5to8: 5, five8to5: 5, five3to6: 5, six1to8: 6, five1to4: 5, seven: 7,
  six5to8: 6,
};

const REEL_MUX_TABLE = [0, 4, 2, 6, 1, 5, 3, 7] as const;

const REEL_MUX_TABLE7 = [3, 1, 5, 6, 4, 2, 0, 7] as const;

const MPU4_OPTIC_WINDOW = v20IndexWindow(V20_ARM_MPU4, 0, MODEL_RELATIONS.MPU4, 96) ?? [1, 3];

export const MPU4_REEL_POWER_UP = oursFromMfme(MODEL_RELATIONS.MPU4, V20_REEL_POWER_UP_POS, 96);

function barcrestReel(): Reel {
  const r = new Reel({
    stepsPerRevolution: 96, symbols: 12, mame: true, mameDrive: 'barcrest',
    indexStart: MPU4_OPTIC_WINDOW[0], indexEnd: MPU4_OPTIC_WINDOW[1], indexPattern: 0, initPhase: 2,
  });
  r.park(MPU4_REEL_POWER_UP);
  return r;
}

type Mpu4SwitchControl = SwitchControl;

export interface Mpu4Inputs {
  readonly switches: Uint8Array;
  aux1: number;
  aux2: number;
  orange1: number;
  orange2: number;
  dil1: number;
  dil2: number;
}

const SEG_LEVEL_STEPS = [
  0x00, 0x80, 0xa0, 0xb4, 0xc8, 0xcd, 0xd2, 0xd7,
  0xdc, 0xe1, 0xe6, 0xeb, 0xf0, 0xf5, 0xfa, 0xff,
];
const segLevel = (frac: number): number => SEG_LEVEL_STEPS[Math.min(255, frac) >> 4];

export class SegColumnBank {
  private readonly data = new Uint8Array(8);
  private readonly time = new Float64Array(8);
  private count = 0;
  private column = -1;
  private period = 0;
  private lastStrobe = 0;
  constructor(
    private readonly cells: Uint8Array,
    private readonly levels: Uint8Array,
    private readonly group: number,
  ) {}

  write(column: number, data: number, enable: boolean, t: number): void {
    if (column !== this.column) {
      this.flush();
      this.column = column;
    }
    if (this.count < 8) {
      this.data[this.count] = enable ? data & 0xff : 0;
      this.time[this.count] = t;
      this.count++;
    }
  }

  strobe(t: number): void {
    const gap = t - this.lastStrobe;
    if (gap > 100) this.period = gap;
    this.lastStrobe = t;
  }

  private flush(): void {
    const n = this.count;
    this.count = 0;
    if (n < 2 || this.column < 0) return;
    const span = this.period !== 0
      ? (this.period > 250 ? this.period - 250 : 0)
      : Math.max(1, this.time[n - 1] - this.time[0]);
    let on = -1, off = -1, digit = 0;
    for (let i = 0; i < n; i++) {
      if (this.data[i] === 0) {
        if (on >= 0 && off < 0) off = this.time[i];
      } else if (on < 0) {
        on = this.time[i];
        digit = this.data[i];
      }
    }
    const cell = this.group * 8 + 7 - (this.column & 7);
    this.cells[cell] = digit;
    this.levels[cell] = digit === 0 || off < 0
      ? 0xff
      : span === 0 ? segLevel(0) : segLevel(Math.floor(((off - on) * 255) / span));
  }

  reset(): void {
    this.count = 0;
    this.column = -1;
    this.period = 0;
    this.lastStrobe = 0;
  }
}

export class Mpu4 implements Bus, Machine {
  static readonly snapshotConfig: readonly string[] = ['nvram', 'wiring', 'coinSlots', 'coinTableCache', 'takeCache'];
  readonly digitKind: DigitKind = 'mpu4led';
  readonly cpu: M6809;
  readonly ram = new Uint8Array(0x0800);

  video: Mpu4VideoCard | null = null;
  private videoRam: Uint8Array | null = null;

  readonly ptm: Ptm6840;
  readonly ic3: Pia6821;
  readonly ic4: Pia6821;
  readonly ic5: Pia6821;

  readonly dataport = new V20SoftSerial(Math.floor(E_CLOCK / 0x4b0));
  readonly dataPak = new DataPak(E_CLOCK);
  private dataPakType = 0;
  private dataPakOut: number[] = [];
  private dataPakWait = 0;
  private dataportLine = true;
  static readonly LED_CELLS = 40;
  private static readonly DATAPAK_TURNAROUND = 50_000;

  fitDataPak(type: number): void {
    this.dataPakType = type;
    if (type === 1) this.ic4.setCB1(this.dataportLine);
  }

  private dataportTx(level: boolean): void {
    if (!this.dataPakType) return;
    this.dataport.sample(level);
    if (this.dataPakType === 2) this.ic4.setCB1(level);
  }

  private tickDataport(cycles: number): void {
    if (this.dataport.active) {
      const b = this.dataport.tick(cycles);
      const reply = b >= 0 ? this.dataPak.receive(b, this.cpu.cycles) : null;
      if (reply && this.dataPakType === 1) {
        if (!this.dataPakOut.length) this.dataPakWait = Mpu4.DATAPAK_TURNAROUND;
        this.dataPakOut.push(...reply);
      }
    }
    if (this.dataPakOut.length) {
      this.dataPakWait -= cycles;
      while (this.dataPakOut.length && this.dataPakWait <= 0) {
        const b = this.dataPakOut.shift()!;
        if (this.dataport.idle) this.dataport.send(b);
        this.dataPakWait += Mpu4.DATAPAK_TURNAROUND;
      }
    }
    if (this.dataPakType === 1 && this.dataport.out !== this.dataportLine) {
      this.dataportLine = this.dataport.out;
      this.ic4.setCB1(this.dataportLine);
    }
  }
  readonly ic6: Pia6821;
  readonly ic7: Pia6821;
  readonly ic8: Pia6821;
  readonly icSound: Pia6821;
  readonly ptmSound: Ptm6840;
  readonly characteriser = new Characteriser();
  bwbCharacteriser: BwbCharacteriser | null = null;

  private readonly reelUnits: Reel[] = [0, 1, 2, 3].map(barcrestReel);
  private reelMux: Mpu4ReelMux = 'standard';
  private reelSelect = 0;
  private meterPortB = 0;
  private meterSettle = 0;

  readonly lamps = new Uint8Array(8 * 16 + 128);
  private readonly lampMux = [0, 64, 128, 192].map((base) => new MuxLamps(this.lamps, base));
  private lampEnable = false;
  private lampEnableCount = 0;

  private readonly ledBuf = new Uint8Array(Mpu4.LED_CELLS * 2);
  readonly outputs: Mpu4Outputs = {
    lamps: this.lamps,
    leds: this.ledBuf.subarray(0, Mpu4.LED_CELLS),
    ledLevels: this.ledBuf.subarray(Mpu4.LED_CELLS).fill(0xff),
    triacs: 0,
    meters: 0,
    reels: this.reelUnits,
  };

  setReelPosition(i: number, pos: number): void {
    this.reelUnits[i]?.park(pos);
  }

  readonly inputs: Mpu4Inputs = {
    switches: new Uint8Array(8),
    aux1: 0,
    aux2: 0,
    orange1: 0,
    orange2: 0,
    dil1: 0,
    dil2: 0,
  };

  private rom: Uint8Array<ArrayBufferLike> = new Uint8Array(PAGE_SIZE);
  private romMask = PAGE_SIZE - 1;
  private bank = 0;
  private pageLatch = 0;
  private romPaging = 0;
  private nvram: Uint8Array | null = null;

  private strobe = 0;
  private readonly segBank0: SegColumnBank;
  private readonly segBank1: SegColumnBank;
  ledType = 0;
  private ic4PortA = 0;
  private ledLatchColumn = 0;
  private ledLatchStart = 0;
  private readonly ledLatchCount = new Uint8Array(5);
  private readonly ledLatchFirst = new Uint8Array(5);
  private readonly ledLatchOn = new Float64Array(5);
  private readonly ledLatchOff = new Float64Array(5).fill(-1);
  private aux2Out = 0;
  lampExtender: 'none' | 'small' | 'large1' | 'large2' | 'large3' | 'crystal' = 'small';
  private lampExtLastB7 = 0;
  private lampExtSense = false;
  private meter8 = false;

  private mainsCycles = 0;
  private mainsState = false;

  constructor() {
    this.cpu = new M6809(this);
    this.segBank0 = new SegColumnBank(this.outputs.leds, this.outputs.ledLevels, 0);
    this.segBank1 = new SegColumnBank(this.outputs.leds, this.outputs.ledLevels, 1);

    this.characteriser.setCheat(() => {
      const x = this.cpu.x & 0xffff;
      if (x >= 0x0800 && x <= 0x0fff) return 0;
      return this.read8(x);
    });

    const irqChanged = () => this.updateIrq();

    this.ptm = new Ptm6840({
      irqChanged,
      output: (n, state) => {
        if (n === 0) this.ptm.setExternalClock(1, state);
        else if (n === 1) this.ptm.setExternalClock(2, state);
        else this.ptm.setExternalClock(0, state);
      },
      pin: (n, level) => { if (n === 2) this.alarm.write(0, level ? 1 : 0); },
    });

    this.ic3 = new Pia6821({
      irqChanged,
      writeA: (v) => this.latchLamps('a', v),
      writeB: (v) => this.latchLamps('b', v),
      writeCA2: (v) => this.vfd.data(v),
      writeCB2: (v) => (this.alphaCableSwapped ? this.vfd.sclk(!v) : this.vfd.por(v)),
    });

    this.ic4 = new Pia6821({
      irqChanged,
      writeA: (v) => {
        this.ic4PortA = v;
        if (this.lampExtender !== 'large2' && (this.ledType === 0 || this.ledType === 5)) {
          this.segBank0.write(this.strobe & 7, v, this.lampEnable, this.cpu.cycles);
        }
      },
      readB: () => this.ic4PortB(),
      writeB: (v) => { this.reelSelect = (v >> 4) & 7; },
      writeCA2: (v) => this.setStrobeBit(1, v),
    });

    this.ic5 = new Pia6821({
      irqChanged,
      writeCA2: (v) => this.dataportTx(v),
      writeCB2: (v) => {
        this.ayCsel = v;
        this.updateAy();
      },
      readA: () => this.aux1In(),
      readB: () => this.aux2In(),
      writeA: (v) => {
        if (this.hopperType === 2) this.hopper1Opto = (v & 0x10) !== 0;
        this.sampleCardWrite(v);
        if (this.reelMux === 'seven') {
          this.reelUnits[1].update(v & 0x0f);
          this.reelUnits[2].update((v >> 4) & 0x0f);
        } else if (this.reelMux === 'six5to8') {
          this.reelUnits[4].update(v & 0x0f);
          this.reelUnits[5].update((v >> 4) & 0x0f);
        }
        if (this.lampExtender === 'small') { if (this.lampEnable) this.lampExtendSmall(v); }
        else if (this.lampExtender === 'crystal') {  }
        else if (this.lampExtender === 'large1') this.lampExtendLarge(v);
        else if (this.lampExtender === 'large2') this.lampExtendLarge2(v);
        else if (this.lampExtender === 'large3') this.lampExtendLargeRead(v);
        else if (this.ledType === 2) this.ledLatchWrite(v & 0x1f, ~this.ic4PortA & 0xff);
        else if (this.ledType !== 1 && this.ledType !== 5) {
          this.segBank1.write(this.strobe & 7, v, this.lampEnable, this.cpu.cycles);
        }
      },
      writeB: (v) => {
        if (this.hopperType === 4) {
          this.hopper1?.motorDrive((v & 0x01) !== 0);
          this.hopper1Opto = (v & 0x08) !== 0;
        }
        this.coinLockouts = v & 0x0f;
        const changed = (this.aux2Out ^ v) & 0xff;
        this.aux2Out = v;
        if (this.payoutType === 0x0b) this.crystalSrlWrite(changed, v);
        if (this.ledType === 1) this.ledLatchWrite(v & 0x07, ~this.ic4PortA & 0xff);
        else if (this.ledType === 4) this.ledLatchWrite(v & 0x07, this.ic4PortA);
        else if (this.ledType === 7) this.ledType7Write(changed, v);
      },
    });

    this.ic6 = new Pia6821({
      irqChanged,
      writeA: (v) => {
        this.ayData = v & 0xff;
        this.updateAy();
      },
      writeB: (v) => {
        const r = this.reelMux === 'seven' ? 3 : 0;
        this.reelUnits[r].update(v & 0x0f);
        this.reelUnits[r + 1].update((v >> 4) & 0x0f);
      },
      readA: () => this.ayRead,
      writeCA2: (v) => {
        this.ayBc1 = v;
        this.updateAy();
      },
      writeCB2: (v) => {
        this.ayBdir = v;
        this.updateAy();
      },
    });

    this.icSound = new Pia6821({
      irqChanged,
      writeA: (v) => {
        this.okiData = mpu4OkiLatch(v, this.sampleBankBases.length);
      },
      writeB: (v) => this.okiPortB(v),
      writeCA2: (level) => this.okiResetLine(level),
      readB: () => (this.oki.nar ? 0x80 : 0) | (this.oki.busy ? 0 : 0x40),
    });
    this.ptmSound = new Ptm6840({ irqChanged });

    this.ic7 = new Pia6821({
      irqChanged,
      writeA: (v) => {
        const r = this.reelMux === 'seven' ? 5 : 2;
        this.reelUnits[r].update(v & 0x0f);
        this.reelUnits[r + 1].update((v >> 4) & 0x0f);
      },
      writeB: (v) => {
        if (this.hopperType === 1 || this.hopperType === 2) {
          this.hopper1?.motorDrive((v & 0x10) !== 0);
        }
        this.meterPortB = v & 0x7f;
        this.meterSettle = METER_SETTLE_CYCLES;
        if (this.ledType === 5) this.segBank1.write(this.strobe & 7, v & 0x7f, this.lampEnable, this.cpu.cycles);
      },
      readB: () => (this.meterWord() !== 0 ? 0x80 : 0),
      writeCA2: (v) => this.setStrobeBit(0, v),
      writeCB2: (v) => {
        this.meter8 = v;
        this.meterSettle = METER_SETTLE_CYCLES;
      },
    });

    this.ic8 = new Pia6821({
      irqChanged,
      readA: () => {
        this.ic5.setCB1((this.inputs.aux2 & 0x80) !== 0);
        const s = this.strobe & 7;
        if (s === 6) return this.inputs.dil1;
        if (s === 7) return this.inputs.dil2;
        if (this.payoutType === 13 && (s === 0 || s === 4)
          && this.hopperSense(this.hopper1, 0x02, this.hopper1Opto) !== 0) {
          return (this.inputs.switches[0] | this.inputs.orange1 | 0x04) & 0xff;
        }
        const bank = s & 3;
        if (s === 2) return (this.inputs.switches[2] ^ this.doorInvert) & 0xff;
        const fixed = bank === 0 ? this.inputs.orange1 : bank === 1 ? this.inputs.orange2 : 0;
        return (this.inputs.switches[bank] | fixed) & 0xff;
      },
      writeB: (v) => this.latchTriacs(v),
      writeCA2: (v) => this.setStrobeBit(2, v),
      writeCB2: (v) => (this.alphaCableSwapped ? this.vfd.por(v) : this.vfd.sclk(!v)),
    });
  }

  get clockHz(): number {
    return E_CLOCK;
  }

  get reels(): readonly Reel[] {
    return this.outputs.reels;
  }

  private readonly vfd = new Msc1937();
  alphaCableSwapped = false;

  get display(): Msc1937 {
    return this.vfd;
  }
  readonly ay = new Ay8910(E_CLOCK, 'ay8910');

  private ayData = 0;
  private ayRead = 0xff;
  private ayBc1 = false;
  private ayBdir = false;
  private ayCsel = false;

  private updateAy(): void {
    if (this.ayCsel) return;
    if (this.ayBdir) {
      if (this.ayBc1) this.ay.selectAddress(this.ayData);
      else this.ay.write(this.ayData);
    } else if (this.ayBc1) {
      this.ayRead = this.ay.read();
    }
  }

  readonly oki = new Msm6376(undefined, MSM6376_RATE);

  setSampleClock(hz: number): void {
    this.powerOnSampleRate = Math.floor(hz / 8);
    this.oki.setRate(this.powerOnSampleRate);
  }

  private clockOkiFromPtm(): void {
    const { latch } = this.ptmSound.debugState();
    const t1 = latch[0], t3 = latch[2];
    const t3h = t3 >> 8, t3l1 = (t3 & 0xff) + 1;
    const q = Math.fround(Math.fround(t3h * t3l1 + 1) / Math.fround(2 * t1 + 2));
    const whole = Math.trunc(q);
    const mul = q - whole > 0.5 ? Math.trunc(Math.fround(q + 0.5)) : whole;
    const pitch = ((Math.floor(E_CLOCK / ((t3h + 1) * t3l1)) * mul) >>> 0) >>> 3;
    this.oki.setRate(pitch > 0 ? pitch : this.powerOnSampleRate);
  }

  private powerOnSampleRate = MSM6376_RATE;

  get parts(): BoardPart[] {
    return this.video ? this.videoParts(this.video) : this.boardParts();
  }

  private boardParts(): BoardPart[] {
    return [
      { id: 'lamps', label: 'LAMP MATRIX', part: '8 x 16 + extender',
        device: this.outputs.lamps, signal: 'lamps' },
      { id: 'switches', label: 'SWITCH MATRIX', part: '8 strobes', device: this.inputs.switches },
      { id: 'sevenseg', label: '8 x 7-SEG', part: 'LED bank', signal: 'digits' },
      { id: 'meters', label: '8 METERS', part: 'current sense', device: this.outputs },
      { id: 'triacs', label: 'TRIACS', part: 'slides - lockouts', device: this.outputs },
      { id: 'coins', label: 'COIN INPUTS', part: 'AUX2', signal: 'coin' },

      { id: 'ic3', label: 'PIA IC3', part: 'lamp data', device: this.ic3 },
      { id: 'ic4', label: 'PIA IC4', part: '7-seg - optics', device: this.ic4 },
      { id: 'ic5', label: 'PIA IC5', part: 'AUX1 / AUX2', device: this.ic5 },
      { id: 'ic6', label: 'PIA IC6', part: 'AY bus - reels A/B', device: this.ic6 },
      { id: 'ic7', label: 'PIA IC7', part: 'reels C/D - meters', device: this.ic7 },
      { id: 'ic8', label: 'PIA IC8', part: 'switches - triacs', device: this.ic8 },

      { id: 'ram', label: 'BATTERY RAM', part: '2K', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: 'paged - $1000-$FFFF', device: this.rom },
      { id: 'chr', label: 'CHARACTERISER', part: 'security PAL', device: this.characteriser },
      { id: 'ptm', label: 'PTM IC2', part: 'MC6840 - system tick', device: this.ptm },
      { id: 'ay', label: 'SOUND', part: 'AY8913', device: this.ay },
      { id: 'oki', label: 'SAMPLES', part: 'MSM6376', device: this.oki },
      { id: 'alpha', label: 'VFD', part: 'MSC1937 - 16 char', device: this.vfd, signal: 'display' },

      { id: 'cpu', label: 'CPU', part: 'MC6809 - 1.72 MHz E', device: this.cpu, cpu: true },
      { id: 'ic23', label: 'IC23 STROBE', part: '74LS138 decode', modelled: true,
        note: 'Modelled as the strobe field the PIAs drive, not as a decoder chip.' },
      { id: 'soundpia', label: 'SOUND PIA', part: 'MC6821 - mod4', device: this.icSound },
      { id: 'soundptm', label: 'SOUND PTM', part: 'MC6840 - mod4', device: this.ptmSound },
      { id: 'duart', label: 'DUART', part: 'MC68681 - hopper optos' },

      { id: 'reels', label: 'REEL MECH', part: 'Barcrest 48 step',
        device: this.reels, signal: 'reels' },
      this.hopper1
        ? { id: 'hopper', label: 'HOPPER', part: `payout unit ${this.payoutType}`,
            device: this.hopper1 }
        : { id: 'hopper', label: 'PAYOUT', part: 'tube slides on the triacs',
            device: this.triacPulses },
      { id: 'coinmech', label: 'COIN MECH', part: 'acceptor', signal: 'coin' },
    ];
  }

  private videoParts(v: Mpu4VideoCard): BoardPart[] {
    const keep = new Set(['lamps', 'switches', 'sevenseg', 'meters', 'triacs', 'coins',
      'ic3', 'ic4', 'ic5', 'ic6', 'ic7', 'ic8', 'ram', 'rom', 'ptm', 'ay', 'alpha', 'cpu', 'ic23',
      'coinmech']);
    const base = this.boardParts().filter((p) => keep.has(p.id));
    return [
      ...base,
      { id: 'acia', label: 'LINK ACIA', part: 'MC6850 - to video card', device: v.mpu4Acia },
      { id: 'vacia', label: 'VIDEO ACIA', part: 'MC6850 - to MPU4', device: v.acia },
      { id: 'vptm', label: 'VIDEO PTM', part: 'MC6840 - link clock', device: v.ptm },
      { id: 'crtc', label: 'CRTC', part: 'SCN2674', device: v.scn },
      { id: 'palette', label: 'PALETTE', part: 'EF9369 - 16 colours', device: v.rowArgb },
      { id: 'saa', label: 'SOUND', part: 'SAA1099', device: v.saa },
      { id: 'chr', label: 'CHARACTERISER', part: 'security PAL', device: v.chrTable },
      { id: 'vcpu', label: 'VIDEO CPU', part: 'MC68000 - 10 MHz', device: v.cpu, cpu: true },
      { id: 'vrom', label: 'VIDEO ROM', part: 'program and questions', device: v.rom },
      { id: 'vram', label: 'VIDEO RAM', part: 'main 128K - tiles 128K', device: v.mainRam },
      { id: 'screen', label: 'MONITOR', part: '504 x 296', device: v.frame },
    ];
  }

  private okiData = 0;
  private okiLines = 0x03;
  private okiVolClock = false;
  private okiVolume = 0;
  private okiInReset = false;
  private okiCh2Phrase = -1;
  private okiCh2Rises = 0;
  private okiCh2Atten = 0;

  okiVolumeManual = false;
  volumeApplies = true;

  private okiPortB(v: number): void {
    const clock = (v & 0x20) !== 0;
    if (this.okiVolClock && !clock && !this.okiVolumeManual && this.volumeApplies) {
      const was = this.okiVolume;
      this.okiVolume = v & 0x10 ? Math.min(31, was + 1) : Math.max(0, was - 1);
      if (this.okiVolume !== was) {
        this.setVolumeLevel(Math.floor((this.okiVolume * 0xff) / 0x1f));
      }
    }
    this.okiVolClock = clock;

    const lines = v & 0x03;
    const changed = this.okiLines ^ lines;
    this.okiLines = lines;
    if (this.okiInReset || changed === 0) return;
    const st = (lines & 1) !== 0;
    const ch2 = (lines & 2) !== 0;
    const stChanged = (changed & 1) !== 0;
    const ch2Changed = (changed & 2) !== 0;

    if (ch2 && !ch2Changed && stChanged && !st) {
      if (this.okiData === 0) this.oki.stop();
      else this.oki.play(this.okiData);
    }
    if (!ch2 && ch2Changed) this.okiCh2Rises = 0;
    if (!ch2 && stChanged) {
      if (!st) {
        if (this.okiCh2Rises === 0) this.okiCh2Phrase = this.okiData;
      } else {
        this.okiCh2Rises++;
        this.okiCh2Atten = this.okiCh2Rises === 1 ? 0 : this.okiCh2Atten + 1;
      }
    }
    if (ch2 && ch2Changed && this.okiCh2Phrase >= 0) {
      const n = this.okiCh2Phrase;
      const a = this.okiCh2Atten;
      const att = a === 1 ? 0x32 : a === 2 ? 100 : a;
      if (n === 0) {
        this.oki.stop();
        this.okiCh2Phrase = -1;
      } else {
        if (!this.oki.voicePlaying(1)) this.okiCh2Phrase = -1;
        this.oki.play(n, 1, (0xff - att) / 0xff);
      }
    }
  }

  private volumeLevel = 0xff;

  private setVolumeLevel(level: number): void {
    this.volumeLevel = level;
    setBoardLevel(level, [this.oki, this.samplePlayer, this.ay, this.opll, this.alarm]);
  }

  private okiResetLine(level: boolean): void {
    if (level && this.okiInReset) {
      this.okiCh2Phrase = -1;
      this.okiCh2Rises = 0;
      this.okiCh2Atten = 0;
      this.okiLines = 0x03;
    }
    this.okiInReset = !level;
  }

  get audioSource(): Mixer {
    const primary = this.soundChip;
    this.alarm.setRate(primary.rate);
    if (this.alarmMix?.primary !== primary || this.alarmMix.mixer.rate !== primary.rate) {
      this.alarmMix = { primary, mixer: new Mixer([primary, this.alarm]) };
    }
    return this.alarmMix.mixer;
  }

  readonly alarm = new OneBitSpeaker(E_CLOCK, AY_RATE, { bassFreq: BASE_BOARD_BASS_FREQ });
  private alarmMix: { primary: Msm6376 | Ay8910 | MfmeSamplePlayer | Mixer; mixer: Mixer } | null = null;

  get soundChip(): Msm6376 | Ay8910 | MfmeSamplePlayer | Mixer {
    if (this.yamahaMix) return this.yamahaMix;
    if (this.packSamples.length > 1) return this.samplePlayer;
    const base = this.oki.phraseCount > 0 ? this.oki : this.ay;
    if (this.video) {
      if (this.videoMix?.base !== base) this.videoMix = { base, mixer: new Mixer([base, this.video.saa]) };
      return this.videoMix.mixer;
    }
    return base;
  }
  private videoMix: { base: Msm6376 | Ay8910; mixer: Mixer } | null = null;

  layoutLamp(n: number): boolean {
    return n >= 0 && n < this.outputs.lamps.length && this.outputs.lamps[n] !== 0;
  }

  layoutLampLevel(n: number): number {
    return n >= 0 && n < this.outputs.lamps.length ? this.outputs.lamps[n] : 0;
  }

  layoutDigit(n: number): number {
    return n >= 0 && n < this.outputs.leds.length ? this.outputs.leds[n] : 0;
  }

  layoutDigitLevel(n: number): number {
    return n >= 0 && n < this.outputs.ledLevels.length ? this.outputs.ledLevels[n] : 0xff;
  }

  layoutInput(id: number, on: boolean): void {
    if (id >= Mpu4.DIL_ID_BASE && id < Mpu4.DIL_ID_BASE + 16) {
      const n = id - Mpu4.DIL_ID_BASE;
      const mask = 1 << (n & 7);
      const raise = (v: number): number => (on ? v | mask : v & ~mask & 0xff);
      if (n < 8) this.inputs.dil1 = raise(this.inputs.dil1);
      else this.inputs.dil2 = raise(this.inputs.dil2);
      return;
    }
    if (id >= 64) return;
    const strobe = (id >> 3) & 7;
    if (strobe === 5 && (id & 7) >= 4) {
      if (on) this.insertCoin((id & 7) - 4);
      return;
    }
    if (strobe >= 6) return;
    const mask = 1 << (id & 7);
    if (strobe >= 4) {
      const raise = (v: number): number => (on ? v | mask : v & ~mask & 0xff);
      if (strobe === 4) this.inputs.aux1 = raise(this.inputs.aux1);
      else this.inputs.aux2 = raise(this.inputs.aux2);
      return;
    }
    if (!this.panelIds.has(id) && this.isOptionLine(id)) return;
    const bank = strobe & 3;
    if (on) this.inputs.switches[bank] |= mask;
    else this.inputs.switches[bank] &= ~mask & 0xff;
  }

  setLayoutSwitches(list: readonly LayoutSwitch[]): number[] {
    const skipped: number[] = [];
    this.panel = list.filter((s) => s.number >= 0 && s.number < 64).map((s) => ({ ...s }));
    this.panelIds = new Set(this.panel.map((s) => s.number));
    for (const s of list) {
      if (s.number < 0 || s.number >= 64) continue;
      if (s.number >= 48) {
        if (s.closed) skipped.push(s.number);
        continue;
      }
      if (!s.closed) continue;
      const mask = 1 << (s.number & 7);
      if (s.number >= 40) this.inputs.aux2 |= mask;
      else if (s.number >= 32) this.inputs.aux1 |= mask;
      else this.inputs.switches[s.number >> 3] |= mask;
    }
    return skipped;
  }

  presetOperatorSwitch(id: number, made: boolean, _label: string): void {
    if (id < 0 || id >= 48) return;
    const mask = 1 << (id & 7);
    const raise = (v: number): number => (made ? v | mask : v & ~mask & 0xff);
    if (id >= 40) this.inputs.aux2 = raise(this.inputs.aux2);
    else if (id >= 32) this.inputs.aux1 = raise(this.inputs.aux1);
    else this.inputs.switches[id >> 3] = raise(this.inputs.switches[id >> 3]);
  }

  private panel: LayoutSwitch[] = [];
  private panelIds = new Set<number>();

  setDils(bank1: string | undefined, bank2: string | undefined): void {
    const bits = (s: string): number => {
      let v = 0;
      for (let i = 0; i < 8; i++) if (s[i] === '1') v |= 1 << i;
      return v;
    };
    if (bank1 !== undefined) this.inputs.dil1 = bits(bank1);
    if (bank2 !== undefined) this.inputs.dil2 = bits(bank2);
  }

  private dilLabels: readonly string[] | null = null;

  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  private static readonly DIL_ID_BASE = 64;

  private switchIds: Partial<Record<Mpu4SwitchControl, number>> = {};

  setSwitchIds(ids: Partial<Record<Mpu4SwitchControl, number>>): void {
    this.switchIds = { ...ids };
  }

  get switchPanel(): CabinetSwitch[] {
    const level = (id: number): boolean => {
      const strobe = (id >> 3) & 7;
      const mask = 1 << (id & 7);
      if (strobe >= 6) return false;
      const byte = strobe === 4 ? this.inputs.aux1
        : strobe === 5 ? this.inputs.aux2
          : this.inputs.switches[strobe & 3];
      return (byte & mask) !== 0;
    };
    const out: CabinetSwitch[] = [];
    for (const [control, line, label] of Mpu4.OPERATOR_SWITCHES) {
      const id = this.switchIds[control] ?? line;
      if (id === null) continue;
      out.push({ id, label, on: level(id) });
    }
    const drawn = this.panel.filter((s) => s.number < 48);
    const repeats = new Map<string, number>();
    for (const s of drawn) if (s.label) repeats.set(s.label, (repeats.get(s.label) ?? 0) + 1);
    const nth = new Map<string, number>();
    for (const s of drawn) {
      const n = (nth.get(s.label) ?? 0) + 1;
      nth.set(s.label, n);
      const label = s.label
        ? (repeats.get(s.label)! > 1 ? `${s.label} ${n}` : s.label).replace(/\s+/g, ' ').trim()
        : `Switch ${s.number}`;
      out.push({ id: s.number, label, on: level(s.number), group: 'Layout switches', bootOnly: true });
    }
    for (let i = 0; i < 16; i++) {
      out.push({
        id: Mpu4.DIL_ID_BASE + i,
        label: dilSwitchLabel(`Sw ${i < 8 ? 1 : 2}.${(i & 7) + 1}`, this.dilLabels?.[i]),
        on: ((i < 8 ? this.inputs.dil1 : this.inputs.dil2) & (1 << (i & 7))) !== 0,
        group: 'DIL switches',
        option: true,
        bootOnly: true,
      });
    }
    return out;
  }

  private static readonly OPERATOR_SWITCHES: readonly (readonly [Mpu4SwitchControl, number | null, string])[] = [
    ['Refill', 2 * 8 + 6, 'Refill key'],
    ['Cash', 2 * 8 + 7, 'Cashbox door'],
    ['Service', null, 'Service door'],
    ['Test', 2 * 8 + 5, 'Test button'],
    ['Test 2', null, 'Test button 2'],
    ['Top Up', null, 'Top-up key'],
  ];

  setAuxInvert(aux1: boolean, aux2: boolean): void {
    this.auxInvert1 = aux1;
    this.auxInvert2 = aux2;
  }

  private auxInvert1 = false;
  private auxInvert2 = false;

  setDoorInvert(mask: number): void {
    this.doorInvert = mask & 0xff;
  }

  private doorInvert = 0;

  isOptionLine(id: number): boolean {
    if (id >= 64) return id < Mpu4.DIL_ID_BASE + 16;
    const strobe = (id >> 3) & 7;
    if (strobe >= 6) return true;
    const bank = strobe & 3;
    const fixed = bank === 0 ? this.inputs.orange1 : bank === 1 ? this.inputs.orange2 : 0;
    return (fixed & (1 << (id & 7))) !== 0;
  }

  private static readonly COIN_DWELL = Math.floor(E_CLOCK / 10);
  private coinCycles = 0;
  private coinMask = 0;
  private coinLockouts = 0;

  private static readonly COIN_LINE_BIT = [4, 5, 6, 7, 3, 2];

  private coinLinePattern: number[] = Mpu4.COIN_LINE_BIT.map((b) => 1 << b);
  private coinLineStated: boolean[] = Mpu4.COIN_LINE_BIT.map(() => false);

  setCabinetCoinSlots(slots: readonly { pence: number | null; token: boolean; mask: number }[]): void {
    for (const s of slots) {
      const line = s.token
        ? Mpu4.TOKEN_COIN_LINE
        : this.coinLinePence.findIndex((p, i) => i !== Mpu4.TOKEN_COIN_LINE && p === s.pence);
      if (line < 0 || line >= this.coinLinePattern.length) continue;
      this.coinLinePattern[line] = s.mask & 0xff;
      this.coinLineStated[line] = true;
    }
  }

  private static readonly TOKEN_COIN_LINE = 4;

  get coinLineRead(): boolean {
    return this.coinLineStated.some(Boolean);
  }

  get coinPortLines(): CoinPortLines {
    return {
      compare: 0xff,
      lines: this.coinLinePattern.map((mask, bit) => ({ bit, mask })),
    };
  }

  static lockoutFor(line: number, ddr: number): number | null {
    const d = ddr & 0x0f;
    if (d === 0x07) return line === 5 ? null : line === 4 ? 0x01 : line === 3 ? 0x04 : 0x02;
    if (d === 0x03) return line === 4 ? 0x01 : 0x02;
    return line < 4 ? 1 << line : null;
  }

  static coinLockTableIn(image: Uint8Array): { form: 'records' | 'masks'; at: number } | null {
    const fields = (p: number): boolean =>
      p + 4 <= image.length && (image[p + 2] & 0xf0) === 0 && image[p + 3] === 0x00;
    const ports: number[] = [];
    for (let i = 0; i + 4 <= image.length; i++) {
      if (image[i] === 0x0c && image[i + 1] === 0x02 && fields(i)) ports.push(i);
    }
    for (let i = 0; i + 2 < ports.length; i++) {
      const stride = ports[i + 1] - ports[i];
      if (stride < 7 || stride > 24) continue;
      if (ports[i + 2] - ports[i + 1] !== stride) continue;
      return { form: 'records', at: ports[i] };
    }
    for (let i = 6; i + 6 <= image.length; i++) {
      let ok = true;
      for (let j = 0; j < 6; j++) {
        const v = image[i + j];
        if (v === 0 || (v & 0xf0) !== 0 || ((~image[i - 6 + j]) & 0xff) !== v) { ok = false; break; }
      }
      if (ok) return { form: 'masks', at: i };
    }
    return null;
  }

  private coinLockStated = false;

  private coinLockAllOrNothing = false;

  private allCoinLocksHeld(): boolean {
    const d = this.ic5.ddrB() & 0x0f;
    return d !== 0 && (this.ic5.outB() & d) === d;
  }

  get coinLockHarnessRead(): boolean {
    return this.coinLockStated;
  }

  coinsRefused = 0;
  coinRefusedReason: 'locked' | 'no-line' | 'still-passing' | 'not-taken' | null = null;

  private static readonly COIN_PENCE = [10, 20, 50, 100, 20, 5];

  private coinLinePence: (number | null)[] = [...Mpu4.COIN_PENCE];

  setCoinLinePence(table: readonly (number | null | undefined)[]): void {
    for (let i = 0; i < table.length && i < this.coinLinePence.length; i++) {
      const p = table[i];
      if (p !== undefined) this.coinLinePence[i] = p;
    }
  }

  readonly cashLedger = newCashLedger();

  insertCoin(line: number): void {
    if (this.coinCycles > 0) { this.coinsRefused++; this.coinRefusedReason = 'still-passing'; return; }
    if (line < 0 || line >= Mpu4.COIN_LINE_BIT.length) return;
    const lock = Mpu4.lockoutFor(line, this.ic5.ddrB());
    if (this.coinLockStated) {
      if (lock === null) { this.coinsRefused++; this.coinRefusedReason = 'no-line'; return; }
      if (this.coinLockouts & lock) { this.coinsRefused++; this.coinRefusedReason = 'locked'; return; }
    } else if (this.coinLockAllOrNothing && this.allCoinLocksHeld()) {
      this.coinsRefused++; this.coinRefusedReason = 'locked'; return;
    }
    this.coinMask = this.coinLinePattern[line];
    this.coinCycles = Mpu4.COIN_DWELL;
    this.coinLine = line;
    this.inputs.aux2 |= this.coinMask;
    this.pendCoin(line);
  }

  private bookTaken(line: number): void {
    if (this.wiring) { this.bookWiredCoin(line); return; }
    const pence = this.coinLinePence[line];
    if (pence === null || pence === undefined) return;
    if (line === 4) this.cashLedger.tokenInPence += pence;
    else this.cashLedger.inPence += pence;
  }

  private coinLine = -1;
  private readonly pendLine = new Array<number>(8).fill(-1);
  private readonly pendWait = new Array<number>(8).fill(0);
  private readonly pendByHandler = new Array<number>(8).fill(0);
  private pendCount = 0;
  private static readonly TAKE_WAIT = Math.round(1.5 * E_CLOCK);

  private takeCache: { rom: Uint8Array; t: Map<number, number[]> } | null = null;
  private coinTakes(): Map<number, number[]> {
    const rom = this.video ? this.video.rom : this.rom;
    if (this.takeCache?.rom !== rom) {
      const bitLine = (mask: number): number | null => {
        const i = Mpu4.COIN_LINE_BIT.indexOf(31 - Math.clz32(mask));
        return i < 0 ? null : i;
      };
      this.takeCache = { rom, t: this.video ? readMpu4VideoCoinTakes(rom, bitLine) : readMpu4CoinTakes(rom, bitLine) };
    }
    return this.takeCache.t;
  }

  private takenByHandler(line: number): boolean {
    if (this.coinLinePattern[line] !== 1 << Mpu4.COIN_LINE_BIT[line]!) return false;
    return (this.coinTakes().get(line)?.length ?? 0) > 0;
  }

  private pendCoin(line: number): void {
    const k = this.pendLine.indexOf(-1);
    if (k < 0) { this.coinsRefused++; this.coinRefusedReason = 'not-taken'; return; }
    this.pendLine[k] = line;
    this.pendWait[k] = Mpu4.TAKE_WAIT;
    this.pendByHandler[k] = this.takenByHandler(line) ? 1 : 0;
    this.pendCount++;
  }

  private oldestPending(line: number, byHandler: number): number {
    let k = -1;
    for (let i = 0; i < this.pendLine.length; i++) {
      if (this.pendLine[i] !== line || this.pendByHandler[i] !== byHandler) continue;
      if (k < 0 || this.pendWait[i]! < this.pendWait[k]!) k = i;
    }
    return k;
  }

  private settle(k: number, taken: boolean): void {
    const line = this.pendLine[k]!;
    this.pendLine[k] = -1;
    this.pendWait[k] = 0;
    this.pendCount--;
    if (taken) this.bookTaken(line);
    else { this.coinsRefused++; this.coinRefusedReason = 'not-taken'; }
  }

  private coinSampled(): void {
    if (this.coinCycles <= 0 || this.coinLine < 0) return;
    const k = this.oldestPending(this.coinLine, 0);
    if (k >= 0) this.settle(k, true);
  }

  private takeStep(cycles: number): void {
    let at = -1;
    for (let k = 0; k < this.pendLine.length; k++) {
      const line = this.pendLine[k]!;
      if (line < 0) continue;
      if (this.pendByHandler[k]) {
        if (at < 0) {
          const pc = this.cpu.pc & 0xffff;
          at = this.video
            ? (pc >= 0x4000 && pc < 0xc000 ? pc - 0x4000 : -2)
            : (this.bank * PAGE_SIZE + pc) & this.romMask;
        }
        if (this.coinTakes().get(line)!.includes(at)) { this.settle(k, true); continue; }
        this.pendWait[k] = this.pendWait[k]! - cycles;
        if (this.pendWait[k]! <= 0) this.settle(k, false);
      } else if (!(this.coinCycles > 0 && this.coinLine === line && this.oldestPending(line, 0) === k)) {
        this.settle(k, false);
      }
    }
  }

  private wiring: {
    coins: Map<number, SlotCoin>;
    conflicts: number[];
    check: MeterUnitCheck;
    unpricedTokens: boolean;
  } | null = null;

  private wiringState: { key: string; now: number; check: MeterCheckState } = Mpu4.freshWiringState('');

  private static freshWiringState(key: string): { key: string; now: number; check: MeterCheckState } {
    return { key, now: 0, check: meterCheckState() };
  }

  private static readonly WIRING_QUIET = Math.round(1.5 * E_CLOCK);

  setCoinWiring(w: CoinWiring): void {
    const { coins, conflicts } = linesOf(w);
    const pulse = Math.max(1, ...(this.meterMapFitted ? this.meterInMult : [1]));
    this.wiringState = wiringStateFor(this.wiringState, this.wiring !== null, wiringKey(w), Mpu4.freshWiringState);
    this.wiring = {
      coins,
      conflicts,
      check: new MeterUnitCheck(Mpu4.METER_UNIT_PENCE, pulse * Mpu4.METER_UNIT_PENCE, Mpu4.WIRING_QUIET, this.wiringState.check),
      unpricedTokens: [...coins.values()].some((c) => typeof c === 'object' && c.token === null),
    };
  }

  get coinWiringStatus(): CoinWiringStatus | undefined {
    const w = this.wiring;
    if (!w) return undefined;
    return { state: w.check.state, step: w.check.step, conflicts: [...w.conflicts] };
  }

  private get booksMoney(): boolean {
    return this.wiring?.check.state !== 'disagrees';
  }

  private bookWiredCoin(line: number): void {
    const w = this.wiring!;
    if (!this.booksMoney || w.conflicts.includes(line)) { w.check.coin(undefined, this.wiringState.now); return; }
    const c = w.coins.get(line);
    if (c === undefined) {
      const pence = this.coinLinePence[line];
      w.check.coin(pence ?? undefined, this.wiringState.now);
      if (pence === null || pence === undefined) return;
      if (line === Mpu4.TOKEN_COIN_LINE) this.cashLedger.tokenInPence += pence;
      else this.cashLedger.inPence += pence;
      return;
    }
    if (typeof c === 'number') { this.cashLedger.inPence += c; w.check.coin(c, this.wiringState.now); return; }
    if (c.token === null) { this.cashLedger.unpricedTokenIn++; w.check.coin(null, this.wiringState.now); return; }
    this.cashLedger.tokenInPence += c.token;
    w.check.coin(c.token, this.wiringState.now);
  }

  private checkMeterIn(i: number): void {
    const w = this.wiring!;
    const n = this.meterMapFitted ? this.meterInMult[i]! : i === 0 || i === 2 ? 1 : 0;
    if (i === 2 && w.unpricedTokens) return;
    w.check.count(n, this.wiringState.now);
  }

  private tickWiring(cycles: number): void {
    const s = this.wiringState;
    s.now += cycles;
    this.wiring!.check.tick(s.now);
  }

  private coinSlots: number[] = [];

  setLayoutCoins(list: readonly DeclaredCoin[]): void {
    const out = new Set<number>();
    for (const c of list) {
      if (c.pence !== null) continue;
      if (c.named?.name.startsWith('ccTalk')) continue;
      let line = -1;
      if (c.line !== null && c.note === null) line = c.line;
      else if (c.note === Mpu4.TOK_MPU4_NOTE) line = Mpu4.TOKEN_COIN_LINE;
      else {
        const mask = coinRowPattern(c, Mpu4.AUX2_COIN_ROW);
        if (mask !== undefined && mask !== 0 && (mask & (mask - 1)) === 0) line = Mpu4.COIN_LINE_BIT.indexOf(31 - Math.clz32(mask));
        else if (mask !== undefined) line = this.coinLinePattern.indexOf(mask);
      }
      if (line >= 0) out.add(line);
    }
    this.coinSlots = [...out].sort((a, b) => a - b);
  }

  private static readonly TOK_MPU4_NOTE = 0x39;
  private static readonly AUX2_COIN_ROW = 5;

  get unnamedCoinLines(): readonly number[] {
    return this.coinSlots;
  }

  private coinTableCache: { rom: Uint8Array; t: CoinLineTable | { refused: string } } | null = null;
  private readCoinTable(): CoinLineTable | { refused: string } {
    const rom = this.video ? this.video.rom : this.rom;
    if (this.coinTableCache?.rom !== rom) {
      const bitLine = (mask: number): number | null => {
        const i = Mpu4.COIN_LINE_BIT.indexOf(31 - Math.clz32(mask));
        return i < 0 ? null : i;
      };
      this.coinTableCache = { rom, t: this.video ? readMpu4VideoCoinTable(rom, bitLine) : readMpu4CoinTable(rom, bitLine) };
    }
    return this.coinTableCache.t;
  }

  get coinLineTable(): CoinLineTable | null {
    const t = this.readCoinTable();
    return 'lines' in t ? t : null;
  }

  get coinLinesShut(): number {
    if (!this.coinLockStated) {
      return this.coinLockAllOrNothing && this.allCoinLocksHeld() ? (1 << Mpu4.COIN_LINE_BIT.length) - 1 : 0;
    }
    const ddr = this.ic5.ddrB();
    let out = 0;
    for (let line = 0; line < Mpu4.COIN_LINE_BIT.length; line++) {
      const lock = Mpu4.lockoutFor(line, ddr);
      if (lock === null || (this.coinLockouts & lock)) out |= 1 << line;
    }
    return out;
  }

  get coinLineTableRefusal(): string | null {
    const t = this.readCoinTable();
    return 'refused' in t ? t.refused : null;
  }

  get coinChutes(): readonly { label: string; bit: number }[] {
    const ddr = this.ic5.ddrB();
    return [
      { label: '£1', bit: 3 }, { label: '50p', bit: 2 }, { label: '20p', bit: 1 }, { label: '10p', bit: 0 },
      ...(Mpu4.lockoutFor(4, ddr) !== null ? [{ label: '20p token', bit: 4 }] : []),
      ...(Mpu4.lockoutFor(5, ddr) !== null ? [{ label: '5p', bit: 5 }] : []),
    ];
  }

  get coinBusy(): boolean {
    return this.coinCycles > 0;
  }

  private tickCoin(cycles: number): void {
    if (this.coinCycles <= 0) return;
    this.coinCycles -= cycles;
    if (this.coinCycles <= 0) {
      this.inputs.aux2 &= ~this.coinMask & 0xff;
      this.coinCycles = 0;
    }
  }

  private triacSlides: SlideEffect[] =
    [null, null, null, null, null, null, null, null];
  readonly triacPulses = new Uint32Array(8);
  get triacLevels(): number {
    return this.outputs.triacs & 0xff & ~this.triacHopperBits();
  }

  private triacHopperBits(): number {
    if (this.hopperType === 5) return 0x07;
    if (this.hopperType === 3) return 0x05;
    if (this.payoutType === 10) return 0x01;
    return 0;
  }

  setTriacSlides(slides: SlideEffect[]): void {
    for (let i = 0; i < 8; i++) this.triacSlides[i] = slides[i] ?? null;
  }

  private latchTriacs(v: number): void {
    let rising = v & ~this.outputs.triacs & 0xff;
    this.outputs.triacs = v;
    if (this.hopperType === 3 || this.hopperType === 5) {
      this.hopper1?.motorDrive((v & 0x01) !== 0);
      this.hopper1Opto = (v & 0x04) === 0;
      if (this.hopperType === 5) {
        this.hopper2?.motorDrive((v & 0x02) !== 0);
        this.hopper2Opto = (v & 0x04) === 0;
        rising &= ~0x07;
      } else {
        rising &= ~0x05;
      }
    } else if (this.payoutType === 10) {
      this.hopper1?.motorDrive((v & 0x01) !== 0);
      rising &= ~0x01;
    }
    for (let i = 0; rising !== 0; i++, rising >>= 1) {
      if (!(rising & 1)) continue;
      this.triacPulses[i]++;
      const slide = this.outMetered ? null : this.triacSlides[i];
      if (!this.booksMoney) {  }
      else if (slide === 'token') this.cashLedger.unpricedTokenOut++;
      else if (slide === 'unpriced') this.cashLedger.unpricedOut++;
      else if (slide !== null) this.cashLedger.outPence += slide;
      if (this.wiring && this.triacInMult[i]) this.wiring.check.count(this.triacInMult[i]!, this.wiringState.now);
      if (this.triacInMult[i] || this.triacOutMult[i]) {
        this.meterTotals.in += this.triacInMult[i];
        this.meterTotals.out += this.triacOutMult[i];
      }
    }
  }

  readonly meterTotals = { in: 0, out: 0 };
  private meterMapFitted = false;
  private readonly meterInMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly meterOutMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly triacInMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly triacOutMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private meterLedgerMult = [0, 0, 0, 0, 0, 0, 0, 0];
  readonly meterCounts = new Uint32Array(8);
  private meterLatch = 0;
  get meterLevels(): number { return this.meterLatch & 0xff; }
  private readonly meterPending = new Uint8Array(8);
  private meterPendingMask = 0;
  private meterTickCycles = 0;

  setMeterMoneyMap(map: {
    meterIn: number[]; meterOut: number[]; triacIn: number[]; triacOut: number[];
  }): void {
    this.meterMapFitted = true;
    for (let i = 0; i < 8; i++) {
      this.meterInMult[i] = map.meterIn[i] ?? 0;
      this.meterOutMult[i] = map.meterOut[i] ?? 0;
      this.triacInMult[i] = map.triacIn[i] ?? 0;
      this.triacOutMult[i] = map.triacOut[i] ?? 0;
    }
    [this.meterLedgerMult] = ledgerOutMults(
      { in: this.meterInMult, out: this.meterOutMult },
      { in: this.triacInMult, out: this.triacOutMult },
    );
  }

  private latchMeters(): void {
    const word = this.meterWord();
    const changed = (word ^ this.meterLatch) & 0xff;
    this.meterLatch = word;
    if (changed === 0) return;
    for (let i = 0, bit = 1; i < 8; i++, bit <<= 1) {
      if (!(changed & bit)) continue;
      if (word & bit) {
        this.meterPending[i] = METER_HOLD_TICKS;
        this.meterPendingMask |= bit;
      } else {
        this.meterPending[i] = 0;
        this.meterPendingMask &= ~bit;
      }
    }
  }

  private tickMeterPulses(cycles: number): void {
    this.meterTickCycles += cycles;
    if (this.meterTickCycles < METER_TICK_CYCLES) return;
    const ticks = Math.floor(this.meterTickCycles / METER_TICK_CYCLES);
    this.meterTickCycles -= ticks * METER_TICK_CYCLES;
    for (let t = 0; t < ticks && this.meterPendingMask !== 0; t++) {
      for (let i = 0, bit = 1; i < 8; i++, bit <<= 1) {
        if (!(this.meterPendingMask & bit) || this.meterPending[i] === 0) continue;
        if (--this.meterPending[i] !== 0) continue;
        this.meterPendingMask &= ~bit;
        this.bookMeter(i);
      }
    }
  }

  private bookMeter(i: number): void {
    this.meterCounts[i]++;
    this.meterTotals.in += this.meterInMult[i];
    this.meterTotals.out += this.meterOutMult[i];
    if (this.wiring) {
      this.checkMeterIn(i);
      if (!this.booksMoney) return;
    }
    if (!this.meterMapFitted) {
      if (i === 1) this.cashLedger.outPence += Mpu4.METER_UNIT_PENCE;
      else if (i === 3) this.cashLedger.tokenOutPence += Mpu4.METER_UNIT_PENCE;
    } else if (this.outMetered) {
      const pence = (this.meterLedgerMult[i] ?? 0) * Mpu4.METER_UNIT_PENCE;
      if (i === 3) this.cashLedger.tokenOutPence += pence;
      else this.cashLedger.outPence += pence;
    }
  }

  private static readonly METER_UNIT_PENCE = 10;

  get tokenOutPriced(): boolean {
    if (!this.meterMapFitted || !this.outMetered) return true;
    return (this.meterLedgerMult[3] ?? 0) > 0;
  }

  private get outMetered(): boolean {
    if (!this.meterMapFitted) return true;
    if (!this.meterOutMult.some((x) => x !== 0)) return false;
    return this.hopper1 !== null
      || this.triacSlides.every((s) => s === null)
      || this.meterOutMult[1] !== 0;
  }

  private hopperType = 0;
  private payoutType = 0;
  private hopper1: Hopper | null = null;
  private hopper2: Hopper | null = null;

  static readonly HOPPER_WAVEFORM = v20Waveform(1, { beam: 0x14 + 1, gap: 0x96, start: 0x96, settle: 1 });
  private hopper1Opto = false;
  private duartOp = 0;
  private hopper2Opto = false;
  private hopper1Booked = 0;
  private hopper2Booked = 0;

  private hopperCoinPence: [number | null, number | null] = [null, null];

  static hopperCoinRecordsIn(image: Uint8Array): [number | null, number | null] {
    const out: [number | null, number | null] = [null, null];
    const w = (a: number): number => (a + 1 < image.length ? (image[a] << 8) | image[a + 1] : -1);
    for (let a = 0; a + 8 < image.length; a++) {
      if (image[a] !== 0x86 || image[a + 1] !== 0x1e || image[a + 2] !== 0x3d || image[a + 3] !== 0x8e
        || image[a + 6] !== 0x3a || image[a + 7] !== 0x39) continue;
      let accessor = false;
      for (let k = a + 8; k < Math.min(image.length - 5, a + 0x80); k++) {
        if (image[k] === 0xec && image[k + 1] === 0x09 && image[k + 2] === 0x36 && image[k + 3] === 0x06 && image[k + 4] === 0x39) { accessor = true; break; }
      }
      if (!accessor) continue;
      const table = (a & ~0xffff) + w(a + 4);
      for (let i = 0; i < 4; i++) {
        const r = table + 30 * i;
        if (r + 30 > image.length) break;
        if (w(r + 3) !== 0x08ed || image[r + 2] !== image[r + 5]) continue;
        const mask = image[r + 5];
        if (mask !== 0x10 && mask !== 0x20) continue;
        const h = mask === 0x10 ? 0 : 1;
        const pence = w(r + 9);
        if (out[h] === null && pence > 0 && pence <= 1000) out[h] = pence;
      }
      if (out[0] !== null || out[1] !== null) return out;
    }
    return out;
  }

  setReelMux(mode: Mpu4ReelMux): void {
    this.reelMux = mode;
    while (this.reelUnits.length < REEL_MUX_REELS[mode]) this.reelUnits.push(barcrestReel());
  }

  private updateMeters(): void {
    const data = this.meterPortB | (this.meter8 ? 0x80 : 0);
    if (this.payoutType === 6) {
      this.hopper1?.motorDrive((data & 0x10) !== 0);
      this.hopper2?.motorDrive((data & 0x20) !== 0);
    } else if (this.payoutType === 13) {
      this.hopper1?.motorDrive((data & 0x80) !== 0);
    }
    switch (this.reelMux) {
      case 'standard':
        if (MPU4_FULL_METER_PAYOUTS.has(this.payoutType)) this.outputs.meters = data;
        else if (this.ledType !== 5) this.outputs.meters = data & 0x0f;
        break;
      case 'five5to8':
        this.reelUnits[4].update((data >> 4) & 0x0f);
        this.outputs.meters = data & 0x0f;
        break;
      case 'five8to5':
        this.reelUnits[4].update(((data & 0x01) + ((data & 0x08) >> 2)
          + ((data & 0x20) >> 3) + ((data & 0x80) >> 4)) & 0x0f);
        this.outputs.meters = 0;
        break;
      case 'five3to6':
        this.reelUnits[4].update((data >> 2) & 0x0f);
        this.outputs.meters = 0;
        break;
      case 'six1to8':
        this.reelUnits[4].update(data & 0x0f);
        this.reelUnits[5].update((data >> 4) & 0x0f);
        this.outputs.meters = 0;
        break;
      case 'five1to4':
        this.reelUnits[4].update(data & 0x0f);
        this.outputs.meters = data & 0xf0;
        break;
      case 'six5to8':
        this.outputs.meters = data & 0x0f;
        break;
      case 'seven':
        this.reelUnits[0].update(((data & 0x01) + ((data & 0x08) >> 2)
          + ((data & 0x20) >> 3) + ((data & 0x80) >> 4)) & 0x0f);
        break;
    }
    this.latchMeters();
  }

  private meterWord(): number {
    return this.outputs.meters;
  }

  setPayoutType(index: number): void {
    this.setHopperType(index >= 1 && index <= 5 ? index : 0);
    this.payoutType = index;
    if (index === 6) {
      this.hopper1 = new Hopper(E_CLOCK, Mpu4.HOPPER_WAVEFORM);
      this.hopper2 = new Hopper(E_CLOCK, Mpu4.HOPPER_WAVEFORM);
    } else if (index === 13 || index === 10 || index === 0x0b) {
      this.hopper1 = new Hopper(E_CLOCK, Mpu4.HOPPER_WAVEFORM);
    }
  }

  static readonly BUILT_PAYOUTS: ReadonlySet<number> = new Set([0, 1, 2, 3, 4, 5, 6, 10, 11, 13]);

  setHopperType(t: number): void {
    this.hopperType = t;
    this.payoutType = t;
    if (t >= 1 && t <= 5) this.hopper1 = new Hopper(E_CLOCK, Mpu4.HOPPER_WAVEFORM);
    if (t === 5) this.hopper2 = new Hopper(E_CLOCK, Mpu4.HOPPER_WAVEFORM);
  }

  private srlCmd = 0;
  private srlReply = 0;
  private srlLastCmd = 0;

  private crystalSrlWrite(changed: number, orb: number): void {
    if ((~orb & changed & 0x40) !== 0) {
      this.srlCmd = ((this.srlCmd << 1) | ((orb & 0x10) >> 4)) & 0xff;
      this.srlReply = (this.srlReply << 1) & 0xff;
    }
    if ((changed & 0x20) === 0) return;
    if ((orb & 0x40) === 0) {
      if (((this.srlCmd ^ this.srlLastCmd) & 0x7f) !== 0) this.srlLastCmd = this.srlCmd;
      this.hopper1?.motorDrive((this.srlCmd & 0x80) !== 0 && (orb & 0x01) !== 0);
    } else {
      this.srlReply = (this.hopperSense(this.hopper1, 0x80, this.hopper1Opto)
        | Mpu4.srlSwitchBits(this.inputs.aux2)) & 0xff;
    }
  }

  private static srlSwitchBits(aux2: number): number {
    return ((aux2 & 0x10) >> 4) | ((aux2 & 0x08) >> 2) | (aux2 & 0x04)
      | ((aux2 & 0x02) << 2) | ((aux2 & 0x01) << 4);
  }

  private hopperSense(h: Hopper | null, mask: number, inverted: boolean): number {
    if (!h) return 0;
    return (inverted ? !h.opto : h.opto) ? mask : 0;
  }

  private aux1In(): number {
    let v = this.video ? 0 : (this.auxInvert1 ? ~this.inputs.aux1 & 0xff : this.inputs.aux1) & 0xff;
    if (this.video) {
    } else if (this.lampExtender === 'crystal') {
      v = (v & 0xf7) | (this.sampleCardVoicePlaying ? 0x08 : 0);
    } else if (this.soundCard === 8) {
      v = (v & 0xf7) | (this.sampleCardVoicePlaying ? 0 : 0x08);
    }
    if (this.lampExtender === 'large1' && this.lampExtSense && this.lampEnable) v |= 0x40;
    if (this.hopperType === 4) v |= this.hopperSense(this.hopper1, 0x04, this.hopper1Opto);
    else if (this.payoutType === 6) {
      v |= this.hopperSense(this.hopper1, 0x08, this.hopper1Opto)
        | this.hopperSense(this.hopper2, 0x04, this.hopper2Opto);
    }
    return v & 0xff;
  }

  private aux2In(): number {
    if (this.payoutType === 0x0b) {
      return (this.srlReply & 0x80) | (this.coinCycles > 0 ? this.coinMask & 0xff : 0);
    }
    return ((this.auxInvert2 ? ~this.inputs.aux2 & 0xff : this.inputs.aux2)
      | (this.hopperType === 2 ? this.hopperSense(this.hopper1, 0x08, this.hopper1Opto) : 0))
      & 0xff;
  }

  private soundCard = 0;

  setSoundCard(index: number): void {
    this.soundCard = index;
    if (index === 4 && !this.opll) {
      this.opll = Object.assign(new Ym2413(this.ay.rate), { v20Mix: true });
      this.opll.setGain(this.volumeLevel / 0xff);
      this.yamahaMix = new Mixer([this.ay, this.opll]);
    }
  }

  private opll: Ym2413 | null = null;
  private yamahaMix: Mixer | null = null;

  private encryption = 0;

  setEncryption(index: number): void { this.encryption = index; }

  private get crystalSoundPage(): boolean {
    return this.encryption === 1 || this.encryption === 2;
  }

  private crystalSoundSlot = 0;
  private crystalSoundLatched = false;
  private crystalSoundCtrl = 0;

  private crystalSoundWrite(addr: number, val: number): void {
    if (addr === 0x0880) {
      this.crystalSoundSlot = this.sampleSlot(val & 0x1f, ((val >> 5) & 3) & this.sampleBankMask);
      this.crystalSoundLatched = true;
      return;
    }
    if (addr !== 0x0881) return;
    if ((val & 0x08) === 0) this.pushSoundCommand({ kind: 'stop', slot: -1 });
    else if (this.crystalSoundLatched && (this.crystalSoundCtrl & 1) === 0 && (val & 1) === 1) {
      this.pushSoundCommand({ kind: 'play', slot: this.crystalSoundSlot });
      this.crystalSoundLatched = false;
    }
    this.crystalSoundCtrl = val & 0xff;
  }

  private crystalSoundRead(): number {
    return !this.sampleCardVoicePlaying && (this.crystalSoundCtrl & 1) !== 0 ? 0x08 : 0;
  }

  get sampleCardVoicePlaying(): boolean {
    return this.packSamples.length > 1 ? this.samplePlayer.playing : this.oki.voicePlaying(0);
  }

  private readonly sampleTable = new Uint8Array(0x800);

  private sampleBankMask = MPU4_SAMPLE_BANK_MASK;

  private sampleBankBases: readonly number[] = [];

  private packSamples: MfmeSample[] = [];

  readonly samplePlayer = new MfmeSamplePlayer(MSM6376_RATE);

  setSampleBanks(bases: readonly number[]): void {
    this.sampleBankBases = bases.slice(0, 2);
    this.oki.setSecondBank(this.sampleBankBases[1]);
    this.packSamples = [];
    this.sampleBankMask = MPU4_SAMPLE_BANK_MASK;
    this.sampleTable.fill(0);
    for (let b = 0; b < this.sampleBankBases.length; b++) {
      for (let e = 0; e < 0x78; e++) {
        this.sampleTable[b * 0x100 + e] = mpu4SampleSlot(e, b, this.sampleBankBases.length) & 0xff;
      }
    }
  }

  setSamplePack(image: Uint8Array, baseRate = MPU4_SAMPLE_PACK_RATE): void {
    const banks = decodeMfmeSamplePack(image, baseRate);
    this.sampleBankBases = [];
    this.oki.setSecondBank(undefined);
    this.sampleTable.fill(0);
    this.packSamples = [undefined as unknown as MfmeSample];
    let id = 1;
    for (let b = 0; b < banks.length && b * 0x100 < this.sampleTable.length; b++) {
      for (let i = 0; i < banks[b].length; i++) {
        this.sampleTable[b * 0x100 + i] = id & 0xff;
        this.packSamples[id] = banks[b][i];
        id += 1;
      }
    }
    this.sampleBankMask = banks.length <= 1 ? 0 : banks.length === 2 ? 1 : 3;
    this.samplePlayer.loaded = this.packSamples.length > 1;
  }

  private sampleSlot(entry: number, bank: number): number {
    return this.sampleTable[(entry & 0xff) + (bank & 7) * 0x100] ?? 0;
  }

  private playSampleSlot(slot: number): void {
    if (slot === 0) { this.stopSamples(); return; }
    if (this.packSamples.length > 1) {
      const s = this.packSamples[slot];
      if (s) this.samplePlayer.start(s);
      return;
    }
    const bank = Math.floor(slot / 0x78);
    const entry = slot % 0x78;
    const base = this.sampleBankBases[bank];
    if (base === undefined || entry >= 0x70) return;
    const p = this.oki.loaderPhrase(base, entry);
    if (p) this.oki.startPhrase(p, 0);
  }

  private stopSamples(): void {
    this.oki.stop();
    this.samplePlayer.stop();
  }

  readonly soundCommands: Mpu4SoundCommand[] = [];

  private crystalClock = 0;
  private crystalBits = 0;
  private crystalAcc = 0;
  private crystalByte = 0;
  private coinworldShift = 0;

  private sampleCardWrite(aux1: number): void {
    if (this.lampExtender === 'crystal') {
      const clock = (aux1 & 0x02) === 0 ? 1 : 0;
      if (clock !== this.crystalClock) {
        this.crystalClock = clock;
        if (clock === 0) {
          this.crystalAcc = ((this.crystalAcc << 1) | (aux1 & 1)) & 0xff;
          if (++this.crystalBits === 8) {
            this.crystalBits = 0;
            this.crystalByte = this.crystalAcc;
          }
        }
      }
      if ((aux1 & 0x04) !== 0) {
        const b = this.crystalByte;
        if ((b & 0x80) === 0) this.pushSoundCommand({ kind: 'stop', slot: -1 });
        else if ((b & 0x40) === 0) {
          this.pushSoundCommand({ kind: 'play', slot: this.sampleSlot(b & 0x1f, (b >> 5) & 1) });
        }
      }
      return;
    }
    if (this.soundCard === 8 && (aux1 & 1) !== 0) {
      if ((aux1 & 0x04) === 0) {
        this.coinworldShift = (this.coinworldShift >>> 1) | ((aux1 & 2) << 0x1d);
      } else {
        const s = this.coinworldShift >>> 0x14;
        this.coinworldShift = s;
        if ((s & 0x100) === 0) this.pushSoundCommand({ kind: 'stop', slot: -1 });
        else if ((s & 0xf00) === 0x100) {
          this.pushSoundCommand({ kind: 'play', slot: this.sampleSlot(s & 0x3f, (s & 0x40) >> 6) });
        }
      }
    }
  }

  private pushSoundCommand(c: Mpu4SoundCommand): void {
    this.soundCommands.push(c);
    if (this.soundCommands.length > 256) this.soundCommands.shift();
    if (c.kind === 'stop') this.stopSamples();
    else this.playSampleSlot(c.slot);
  }

  private readDuart(reg: number): number {
    if (reg !== 0x0d) return 0xff;
    return this.hopperSense(this.hopper1, 0x10, this.hopper1Opto)
      | this.hopperSense(this.hopper2, 0x20, this.hopper2Opto);
  }

  private tickHoppers(cycles: number): void {
    if (!this.hopper1) return;
    const count = !this.outMetered;
    const book = (fresh: number, pence: number | null): void => {
      if (!count || !this.booksMoney) return;
      if (pence === null) this.cashLedger.unpricedOut += fresh;
      else this.cashLedger.outPence += fresh * pence;
    };
    this.hopper1.tick(cycles);
    if (this.hopper1.paid > this.hopper1Booked) {
      book(this.hopper1.paid - this.hopper1Booked, this.hopperCoinPence[0]);
      this.hopper1Booked = this.hopper1.paid;
    }
    if (this.hopper2) {
      this.hopper2.tick(cycles);
      if (this.hopper2.paid > this.hopper2Booked) {
        book(this.hopper2.paid - this.hopper2Booked, this.hopperCoinPence[1]);
        this.hopper2Booked = this.hopper2.paid;
      }
    }
  }

  loadRom(image: Uint8Array): void {
    noteRomCut(this, image.length, 8 * PAGE_SIZE);
    if (image.length < PAGE_SIZE) {
      const page = new Uint8Array(PAGE_SIZE);
      page.set(image, PAGE_SIZE - image.length);
      this.rom = page;
    } else {
      this.rom = image;
    }
    this.romMask = this.rom.length <= PAGE_SIZE ? PAGE_SIZE - 1 : this.rom.length - 1;
    this.bank = this.resetPage();
    this.coinLockStated = this.video
      ? 'lines' in this.readCoinTable()
      : Mpu4.coinLockTableIn(this.rom) !== null;
    this.coinLockAllOrNothing = !!this.video && !this.coinLockStated;
    this.hopperCoinPence = Mpu4.hopperCoinRecordsIn(this.rom);
  }

  setRomPaging(value: number): void {
    this.romPaging = value;
  }

  private resetPage(): number {
    return this.romPaging === 1 || this.romPaging === 2 ? 1 : 0;
  }

  batteryRam(): Uint8Array { return this.ram.slice(); }

  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, this.ram.length);
    this.ram.set(this.nvram);
  }

  setCharacteriser(table: CharacteriserTable | null): void {
    this.characteriser.setTable(table);
  }

  powerCycle(): void {
    this.nvram = this.ram.slice();
    this.reset();
  }

  reset(): void {
    if (this.nvram) this.ram.set(this.nvram);
    else this.ram.fill(0);
    this.ptm.reset();
    this.alarm.write(0, 0);
    this.samplePlayer.reset();
    this.opll?.reset();
    for (const pia of this.pias()) pia.reset();
    this.characteriser.reset();
    this.okiVolume = 0;
    this.okiInReset = true;
    this.okiResetLine(true);
    this.okiVolClock = false;
    this.vfd.reset();
    this.dataport.reset();
    this.dataPak.reset();
    this.dataPakOut = [];
    this.dataPakWait = 0;
    this.dataportLine = true;
    if (this.dataPakType === 1) this.ic4.setCB1(true);
    resetReelsInPlace(this.reelUnits);
    for (const mux of this.lampMux) mux.reset();
    this.lamps.fill(0);
    this.lampEnable = false;
    this.lampEnableCount = 0;
    this.outputs.leds.fill(0);
    this.ic4PortA = 0;
    this.ledLatchColumn = 0;
    this.ledLatchStart = 0;
    this.ledLatchCount.fill(0);
    this.ledLatchFirst.fill(0);
    this.ledLatchOff.fill(-1);
    this.outputs.triacs = 0;
    this.outputs.meters = 0;
    if (this.romPaging === 0) this.pageLatch = 0;
    this.bank = this.resetPage();
    this.strobe = 0;
    this.segBank0.reset();
    this.segBank1.reset();
    this.outputs.ledLevels.fill(0xff);
    this.aux2Out = 0;
    this.srlCmd = 0;
    this.srlReply = 0;
    this.srlLastCmd = 0;
    this.meter8 = false;
    this.meterPortB = 0;
    this.meterSettle = 0;
    this.meterLatch = 0;
    this.meterPending.fill(0);
    this.meterPendingMask = 0;
    this.meterTickCycles = 0;
    this.reelSelect = 0;
    this.coinLockouts = 0;
    for (let k = 0; k < this.pendLine.length; k++) if (this.pendLine[k]! >= 0) this.settle(k, false);
    this.mainsCycles = 0;
    this.mainsState = false;
    this.hopper1?.reset();
    this.hopper2?.reset();
    this.hopper1Booked = 0;
    this.hopper2Booked = 0;
    this.hopper1Opto = false;
    this.duartOp = 0;
    this.hopper2Opto = false;
    if (this.video) {
      this.videoRam?.fill(0);
      this.video.reset();
    }
    this.cpu.reset();
  }

  private pias(): Pia6821[] {
    return [this.ic3, this.ic4, this.ic5, this.ic6, this.ic7, this.ic8];
  }

  read8(addr: number): number {
    addr &= 0xffff;
    if (addr < 0x0800) return this.ram[addr];
    if (this.videoRam && addr >= 0x4000 && addr < 0xc000) return this.videoRam[addr - 0x4000];
    if (addr >= ROM_BASE) {
      return this.rom[(this.bank * PAGE_SIZE + addr) & this.romMask] ?? 0xff;
    }
    return this.readIo(addr);
  }

  write8(addr: number, val: number): void {
    addr &= 0xffff;
    if (addr < 0x0800) {
      this.ram[addr] = val;
      return;
    }
    if (this.videoRam && addr >= 0x4000 && addr < 0xc000) {
      this.videoRam[addr - 0x4000] = val;
      return;
    }
    if (addr < ROM_BASE) this.writeIo(addr, val);
  }

  private readIo(addr: number): number {
    if (this.video && addr < 0x0810) return this.video.mpu4Acia.read(addr - 0x0800 === 0 ? 0 : 1);
    if (addr < 0x0840 && this.bwbCharacteriser) return this.bwbCharacteriser.read();
    if (addr < 0x0820) return this.characteriser.read(addr - 0x0800);
    if (addr >= 0x0850 && addr < 0x0860) return this.pageLatch;
    if (addr >= 0x0900 && addr < 0x0a00) return this.ptm.read(addr & 7);
    if (addr >= 0x08e0 && addr < 0x0900
        && (this.hopperType === 1 || this.hopperType === 3 || this.hopperType === 5
          || this.payoutType === 6 || this.payoutType === 10)) {
      return this.readDuart(addr & 15);
    }
    if (addr >= 0x08c0 && addr < 0x0900) return this.ptmSound.read(addr & 7);
    if (addr >= 0x0880 && addr < 0x0890 && this.crystalSoundPage) return this.crystalSoundRead();
    const pia = this.piaAt(addr);
    if (pia === this.ic5 && (addr & 3) === 0 && this.lampExtender === 'large1'
        && (this.ic5.peek(1) & 4)) {
      const v = pia.read(0);
      return this.lampExtSense && this.lampEnable ? v | 0x40 : v & 0xbf;
    }
    if (pia === this.ic5 && (addr & 3) === 2 && this.pendCount > 0 && (this.ic5.peek(3) & 4)) {
      const v = pia.read(2);
      this.coinSampled();
      return v;
    }
    if (pia) return pia.read(addr & 3);
    this.strays.hit(addr);
    return 0xff;
  }

  readonly strays = new StrayCounter();

  private writeIo(addr: number, val: number): void {
    if (this.video && addr < 0x0810) {
      this.video.mpu4AciaWrite(addr & 1, val);
      return;
    }
    if (addr < 0x0840 && this.bwbCharacteriser) {
      this.bwbCharacteriser.write(val);
      return;
    }
    if (addr < 0x0820) {
      this.characteriser.write(addr - 0x0800, val);
      return;
    }
    if (addr >= 0x0850 && addr < 0x0860) {
      if ((this.romPaging & 1) === 0) {
        this.pageLatch = val & 0xff;
        this.bank = (this.bank & 4) | (val & 0x03);
      }
      return;
    }
    if (addr === 0x0878) {
      if ((this.romPaging & 1) === 0) this.bank = (this.bank & 3) | ((val & 1) << 2);
      return;
    }
    if (addr >= 0x0900 && addr < 0x0a00) {
      this.ptm.write(addr & 7, val);
      return;
    }
    if (addr >= 0x08e0 && addr < 0x0900
        && (this.hopperType === 1 || this.payoutType === 6 || this.payoutType === 10)) {
      if ((addr & 0x0f) === 0x0e) this.duartOp |= val;
      else if ((addr & 0x0f) === 0x0f) this.duartOp &= ~val & 0xff;
      if (this.payoutType !== 10) {
        this.hopper1Opto = (this.duartOp & 0x08) !== 0;
        if (this.payoutType === 6) this.hopper2Opto = this.hopper1Opto;
      }
      return;
    }
    if (addr >= 0x08c0 && addr < 0x0900) {
      this.ptmSound.write(addr & 7, val);
      if ((addr & 3) === 3) this.clockOkiFromPtm();
      return;
    }
    if (addr >= 0x0880 && addr < 0x0890 && this.soundCard === 5) {
      this.crystalSoundWrite(addr, val);
      return;
    }
    if (addr >= 0x0880 && addr < 0x0890 && this.opll) {
      if ((addr & 1) === 0) this.opll.writeAddress(val & 0xff);
      else this.opll.writeData(val & 0xff);
      return;
    }
    if (addr >= 0x0880 && addr < 0x0890 && (this.soundCard === 6 || this.soundCard === 7)) return;
    const pia = this.piaAt(addr);
    if (pia) pia.write(addr & 3, val);
    else this.strays.hit(addr);
    if (addr === 0x0883 && this.romPaging === 1 && (val & 0x30) === 0x30) {
      this.bank = (val >> 3) & 1;
    }
  }

  private piaAt(addr: number): Pia6821 | null {
    if (addr >= 0x0880 && addr < 0x08c0) return this.icSound;
    if (addr >= 0x0a00 && addr < 0x0b00) return this.ic3;
    if (addr >= 0x0b00 && addr < 0x0c00) return this.ic4;
    if (addr >= 0x0c00 && addr < 0x0d00) return this.ic5;
    if (addr >= 0x0d00 && addr < 0x0e00) return this.ic6;
    if (addr >= 0x0e00 && addr < 0x0f00) return this.ic7;
    if (addr >= 0x0f00 && addr < 0x1000) return this.ic8;
    return null;
  }

  private updateIrq(): void {
    let irq = this.ptm.irq();
    if (!irq) {
      for (const pia of this.pias()) {
        if (pia.irqA() || pia.irqB()) {
          irq = true;
          break;
        }
      }
    }
    if (this.video) {
      this.cpu.setFIRQ(irq);
      return;
    }
    this.cpu.setIRQ(irq);
  }

  attachVideo(card: Mpu4VideoCard): void {
    this.video = card;
    this.videoRam = new Uint8Array(0x8000);
  }

  private setStrobeBit(bit: number, state: boolean): void {
    const next = state ? this.strobe | (1 << bit) : this.strobe & ~(1 << bit);
    this.strobe = next & 7;
    if (bit === 0 && state) {
      this.lampEnable = true;
      this.lampEnableCount = LAMP_ENABLE_CYCLES;
    }
    const skipExtMux = this.lampExtender === 'small';
    for (let i = 0; i < this.lampMux.length; i++) {
      if (i === 2 && skipExtMux) continue;
      this.lampMux[i].strobe(this.cpu.cycles);
    }
    if (this.lampExtender === 'large2') {
      this.segBank0.strobe(this.cpu.cycles);
      this.segBank1.strobe(this.cpu.cycles);
    }
  }

  private latchLamps(port: 'a' | 'b', data: number): void {
    const mux = this.lampMux[port === 'a' ? 0 : 1];
    mux.write(this.strobe & 7, this.lampEnable ? data : 0, this.cpu.cycles);
  }

  private ledLatchWrite(latch: number, data: number): void {
    const column = this.strobe & 7;
    const t = this.cpu.cycles;
    if (column !== this.ledLatchColumn) {
      const old = this.ledLatchColumn;
      const window = t - this.ledLatchStart - 300;
      for (let g = 0; g < 5; g++) {
        const d = this.ledLatchFirst[g];
        const cell = g * 8 + 7 - old;
        this.outputs.leds[cell] = d;
        let level = 0xff;
        if (d !== 0) {
          if (window <= 0) level = segLevel(0);
          else if (this.ledLatchOff[g] >= 0) {
            level = segLevel(Math.floor(((this.ledLatchOff[g] - this.ledLatchOn[g]) * 255) / window));
          }
        }
        this.outputs.ledLevels[cell] = level;
        this.ledLatchCount[g] = 0;
        this.ledLatchFirst[g] = 0;
        this.ledLatchOff[g] = -1;
      }
      this.ledLatchColumn = column;
      this.ledLatchStart = t;
    }
    const selected = ~latch & 0x1f;
    if (!selected) return;
    for (let g = 0; g < 5; g++) {
      if (!(selected & (1 << g)) || this.ledLatchCount[g] >= 8) continue;
      if (this.ledLatchFirst[g] === 0) {
        if (data !== 0) {
          this.ledLatchFirst[g] = data;
          this.ledLatchOn[g] = t;
        }
      } else if (data === 0) {
        this.ledLatchOff[g] = t;
      }
      this.ledLatchCount[g]++;
    }
  }

  private ledType7Write(changed: number, v: number): void {
    const c = changed & 0x88, n = v & 0x88;
    const data = ~this.ic4PortA & 0xff;
    if ((c === 0x80 && n === 0x88) || (c === 0x88 && n === 0)) {
      this.segBank0.write(this.strobe & 7, data, this.lampEnable, this.cpu.cycles);
    } else if ((c === 0x08 && n === 0x88) || (c === 0x88 && n === 0x88)) {
      this.segBank1.write(this.strobe & 7, data, this.lampEnable, this.cpu.cycles);
    }
  }

  private lampExtendSmall(data: number): void {
    this.lampMux[2].write(data & 7, ((data >> 3) ^ 0x1f) & 0x1f, this.cpu.cycles);
  }

  private lampExtendLarge(data: number): void {
    const bit7 = (data >> 7) & 1;
    this.lampExtSense = false;
    if (bit7 === this.lampExtLastB7) return;
    this.lampExtSense = (data & 0x3f) !== 0;
    this.lampExtLastB7 = bit7;
    this.lampMux[bit7 ? 2 : 3].write(
      this.strobe & 7, this.lampEnable ? data & 0x3f : 0, this.cpu.cycles);
  }

  private lampExtendLargeRead(data: number): boolean {
    const bit7 = (data >> 7) & 1;
    this.lampExtSense = false;
    if (bit7 === this.lampExtLastB7) return false;
    this.lampExtSense = (data & 0x3f) !== 0;
    if (this.lampEnable) {
      this.lampMux[bit7 ? 2 : 3].write(this.strobe & 7, data & 0x3f, this.cpu.cycles);
    }
    this.lampExtLastB7 = bit7;
    return true;
  }

  private lampExtendLarge2(data: number): void {
    if (!this.lampExtendLargeRead(data)) return;
    const bank = this.lampExtLastB7 ? this.segBank1 : this.segBank0;
    bank.write(this.strobe & 7, ~this.ic4PortA & 0xff, this.lampEnable, this.cpu.cycles);
  }

  private ic4PortB(): number {
    let v = 0;
    if (this.reelMux === 'standard') {
      for (let i = 0; i < 4; i++) {
        if (this.reelUnits[i].optic()) v |= 1 << (6 - i);
      }
    } else if (this.reelUnits[(this.reelMux === 'seven' ? REEL_MUX_TABLE7 : REEL_MUX_TABLE)[this.reelSelect]]?.optic()) {
      v |= 0x08;
    }
    if (this.mainsState) v |= 0x04;
    return v | this.lampSense();
  }

  private lampSense(): number {
    if (!this.lampEnable || !this.lampTestPass) return 0;
    return (this.ic3.outA() | this.ic3.outB()) & 0xff ? 0x02 : 0;
  }

  lampTestPass = true;

  private tickLampEnable(cycles: number): void {
    if (this.lampEnableCount <= 0) return;
    this.lampEnableCount -= cycles;
    if (this.lampEnableCount < 1) this.lampEnable = false;
  }

  private tickMains(cycles: number): void {
    const half = Math.floor(E_CLOCK / (MAINS_HZ * 2));
    this.mainsCycles += cycles;
    while (this.mainsCycles >= half) {
      this.mainsCycles -= half;
      this.mainsState = !this.mainsState;
      this.ic4.setCA1(this.mainsState);
    }
  }

  private tickMeterSettle(cycles: number): void {
    if (this.meterSettle <= 0) return;
    this.meterSettle -= cycles;
    if (this.meterSettle <= 0) {
      this.meterSettle = 0;
      this.updateMeters();
    }
  }

  step(): number {
    const cycles = this.cpu.step();
    this.ptm.tick(cycles);
    this.tickMeterSettle(cycles);
    this.tickMeterPulses(cycles);
    this.tickMains(cycles);
    if (this.lampEnableCount > 0) this.tickLampEnable(cycles);
    if (this.pendCount > 0) this.takeStep(cycles);
    this.tickCoin(cycles);
    if (this.wiring) this.tickWiring(cycles);
    this.tickHoppers(cycles);
    if (this.dataPakType && (this.dataport.active || this.dataPakOut.length)) this.tickDataport(cycles);
    this.ptmSound.tick(cycles);
    this.ay.tick(cycles, E_CLOCK);
    this.oki.tick(cycles, E_CLOCK);
    this.samplePlayer.tick(cycles, E_CLOCK);
    this.opll?.tick(cycles, E_CLOCK);
    this.alarm.tick(cycles);
    if (this.video) {
      this.video.advance(cycles, E_CLOCK);
      this.cpu.setIRQ(this.video.mpu4AciaIrq());
    }
    return cycles;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  runFrame(): number {
    return this.run(Math.floor(E_CLOCK / 50));
  }
}
