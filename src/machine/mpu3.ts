import { HD6303Y } from '../cpu/m6303';
import type { Bus } from '../cpu/bus';
import { Pia6821 } from '../hw/pia6821';
import { Ptm6840 } from '../hw/ptm6840';
import { Msc1937 } from '../hw/msc1937';
import { MuxLamps } from '../hw/muxlamps';
import { OneBitSpeaker } from '../hw/speaker';
import { AY_RATE } from '../hw/ay8910';
import { BASE_BOARD_BASS_FREQ } from '../hw/blipleak';
import { V20Reels } from './v20reels';
import { SegColumnBank } from './mpu4';
import { placeRomFlat } from './pairplacer';
import { noteRomCut } from './boarddefaults';
import { StrayCounter } from './strayaccess';
import { COIN_RAW } from './coinraw';
import type { AudioSource, CabinetSwitch, CoinChute, CoinWiringStatus, Machine, DigitKind, CashLedger } from './machine';
import { newCashLedger, dilSwitchLabel, ledgerOutMults } from './machine';
import { detectCoins, linesOf, wiringKey, wiringStateFor, type CoinLineTable, type CoinWiring, type Refusal, type SlotCoin, type StepState } from './coinwiring';
import { locateMpu3Coins, mpu3CoinTable, mpu3Coins, mpu3Payouts, type Mpu3Coin, type Mpu3CoinCode } from './mpu3coins';
import type { DeclaredCoin } from './layoutcoins';
import type { SlideEffect } from '../layout/fmlconfig';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import type { ReelGeometry } from './layoutreels';
import type { Reel } from '../hw/reel';

export const MPU3_CLOCK = 1_000_000;

export function mpu3OpticWindow(optoTab: number): [number, number] {
  switch (optoTab) {
    case 1: return [4, 6];
    case 2: return [6, 8];
    case 3: return [8, 10];
    case 4: return [10, 12];
    default: return [4, 8];
  }
}

export const MPU3_REEL_PATTERN = [0x3, 0x9, 0x6, 0xc] as const;

const ZERO_HIGH = 0x708;
const ZERO_LOW = 0x2008;
const ZERO_FIRST = 3000;
const T555_HIGH = 0x500;
const T555_LOW = 0x21c;
const T555_FIRST = 600;
const STROBE_ENABLE_CYCLES = 8000;
const METER_TICK_SLICES = 0x400;
const METER_HOLD_TICKS = 5;

export const MPU3_METER_UNIT_PENCE = 10;

const COIN_PRESS = Math.round(0.07 * MPU3_CLOCK);
const COIN_GAP = Math.round(0.05 * MPU3_CLOCK);

const SEG_DISPLAYS = Uint8Array.from({ length: 256 }, (_, u) =>
  (((u & 1) << 2) + (u & 2) + ((u & 4) >> 2) + (u & 8) + ((u & 0x10) << 2) + (u & 0x20) + ((u & 0x40) >> 2)) & 0xff);
const SEG_BWB = Uint8Array.from({ length: 256 }, (_, u) =>
  (((u & 1) << 2) + ((u & 2) >> 1) + ((u & 4) << 3) + (u & 8) + ((u & 0x10) >> 3) + ((u & 0x20) >> 1) + (u & 0x40)) & 0xff);
const DIP_LOW = (v: number): number =>
  (((v & 1) << 7) | ((v & 2) << 5) | ((v & 4) << 3) | ((v & 8) << 1) | ((v & 0x10) >> 1) | ((v & 0x20) >> 3)) & 0xff;
const DIP_HIGH = (v: number): number => ((v & 0x80) >> 1) | ((v & 0x40) << 1);

export const enum Mpu3DisplayPort { Displays = 0, Meters = 1, Bwb = 2 }

const TRIAC_LAMPS = 0x40;
const METER_LAMPS = 0x50;
const AUX2_LAMPS = 0x58;

export interface PiaWrite {
  changedA: number;
  changedB: number;
  wroteA: boolean;
  wroteB: boolean;
  ca2: boolean;
  cb2: boolean;
  crbManual: boolean;
}

export function v20PiaWrite(p: Pia6821, reg: number, v: number): PiaWrite {
  const cra = p.read(1), crb = p.read(3);
  const outA = p.outA(), outB = p.outB(), ddrA = p.ddrA(), ddrB = p.ddrB();
  const ca2 = p.ca2(), cb2 = p.cb2();
  p.write(reg, v);
  const r: PiaWrite = { changedA: 0, changedB: 0, wroteA: false, wroteB: false, ca2: false, cb2: false, crbManual: false };
  if (reg === 0) {
    if (cra & 4) { r.changedA = (outA ^ v) & ddrA; r.wroteA = true; }
    else { r.changedA = ((~ddrA & v & ~outA) | (~outA & ddrA & ~v)) & 0xff; r.wroteA = r.changedA !== 0; }
  } else if (reg === 2) {
    if (crb & 4) { r.changedB = (outB ^ v) & ddrB; r.wroteB = true; }
    else { r.changedB = ((~ddrB & v & ~outB) | (~outB & ddrB & ~v)) & 0xff; r.wroteB = r.changedB !== 0; }
  } else if (reg === 3) {
    r.crbManual = (v & 0x30) === 0x30;
  }
  r.ca2 = p.ca2() !== ca2;
  r.cb2 = p.cb2() !== cb2;
  return r;
}

export class Mpu3 implements Bus, Machine {
  static readonly snapshotConfig: readonly string[] = ['switches', 'coinCodeCache', 'coinsCache', 'coinSlots', 'drawnCoins', 'plainInputs', 'wiring', 'meterInRaw', 'meterOutRaw', 'triacInRaw', 'triacOutRaw', 'tokenOutCache'];

  readonly digitKind: DigitKind = 'byte16';
  readonly clockHz = MPU3_CLOCK;
  readonly cpu: HD6303Y;

  readonly ram = new Uint8Array(0x800);
  readonly rom = new Uint8Array(0x10000);

  readonly ptm: Ptm6840;
  readonly ic3: Pia6821;
  readonly ic4: Pia6821;
  readonly ic5: Pia6821;
  readonly ic6: Pia6821;

  readonly display = new Msc1937();

  readonly speaker = new OneBitSpeaker(MPU3_CLOCK, AY_RATE, { bassFreq: BASE_BOARD_BASS_FREQ });
  get audioSource(): AudioSource { return this.speaker; }

  readonly matrix = new Uint8Array(8);
  private dip1 = 0;
  private dip2 = 0;

  readonly lamps = new Uint8Array(0x60);
  private readonly lampMux = new MuxLamps(this.lamps, 0);
  readonly digits = new Uint8Array(16);
  readonly digitLevels = new Uint8Array(16).fill(0xff);
  private readonly segBank = new SegColumnBank(this.digits, this.digitLevels, 0);
  displayPort: Mpu3DisplayPort = Mpu3DisplayPort.Displays;

  private readonly reelBank = new V20Reels(5, mpu3OpticWindow);

  private strobe = 0;
  private strobeEnable = false;
  private strobeEnableCount = 0;

  private zeroLevel = false;
  private zeroCount = ZERO_FIRST;
  private t555Level = false;
  private t555Count = T555_FIRST;
  private slices = 0;

  private aux2In = 0;
  private auxCount = 0;
  private auxShift = 0;

  chrAddr = -1;

  private triacWord = 0;
  readonly triacPulses = new Uint32Array(10);
  get triacLevels(): number { return this.triacWord & 0x3ff; }
  private slidePence: SlideEffect[] = new Array(16).fill(null);
  slideOutPence = 0;

  private meterWord = 0;
  private readonly meterHold = new Uint8Array(8);
  readonly meterCounts = new Uint32Array(8);
  get meterLevels(): number { return this.meterWord & 0xff; }
  readonly cashLedger: CashLedger = newCashLedger();
  private meterInPence: number[] = [];
  private meterOutPence: number[] = [];
  private triacInPence: number[] = [];
  private triacOutPence: number[] = [];
  private outPriced = false;

  private coinRow = 0;
  private coinMask = 0;
  private coinTimer = 0;

  private switches: LayoutSwitch[] = [];
  private dilLabels: readonly string[] | null = null;
  readonly strays = new StrayCounter();

  constructor(prog: readonly Uint8Array[], nvram?: Uint8Array) {
    this.cpu = new HD6303Y(this, 'm6800');
    this.ptm = new Ptm6840({ pin: () => this.updateSound() });
    this.ic3 = new Pia6821({ readA: () => this.ic3PortA() });
    this.ic4 = new Pia6821({ readA: () => (this.strobeEnable ? 0x80 : 0) });
    this.ic5 = new Pia6821({ readB: () => (this.ic5.outB() & 0x80 ? this.reelBank.optos : 0) });
    this.ic6 = new Pia6821({ readA: () => this.matrix[4], readB: () => this.matrix[5] | this.aux2In });
    this.loadRom(prog);
    if (nvram) this.loadNvram(nvram);
  }

  loadRom(files: readonly Uint8Array[]): void {
    const { image, placed, total } = placeRomFlat(files, { max: 0x10000, reverse: true });
    this.rom.set(image);
    noteRomCut(this, Math.max(total, placed), 0x8000);
  }

  batteryRam(): Uint8Array { return this.ram.slice(0, 0x400); }

  loadNvram(data: Uint8Array): void {
    this.ram.set(data.subarray(0, Math.min(0x400, data.length)));
  }

  setDips(d1: number, d2: number): void {
    this.dip1 = d1 & 0xff;
    this.dip2 = d2 & 0xff;
  }

  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  setReelGeometry(geo: readonly ReelGeometry[]): void {
    this.reelBank.setGeometry(geo);
  }

  get reelStandIns(): readonly number[] { return this.reelBank.standIns; }

  get reels(): readonly Reel[] { return this.reelBank.reels; }

  setReelPosition(i: number, pos: number): void {
    this.reelBank.setPosition(i, pos);
  }

  setSwitches(sw: readonly LayoutSwitch[]): void {
    this.switches = [...sw];
    for (const s of sw) if (s.closed) this.layoutInput(s.number, true);
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    this.layoutInput(id, made);
    const drawn = this.switches.find((s) => s.number === id);
    if (!drawn) this.switches = [...this.switches, { number: id, label, closed: made }]
      .sort((a, b) => a.number - b.number);
    else if (drawn.label === '' || drawn.label === String(id)) drawn.label = label;
  }

  private static readonly DIL_ID_BASE = 64;

  get switchPanel(): CabinetSwitch[] {
    const rows: CabinetSwitch[] = this.switches.map((s) => ({
      id: s.number, label: s.label,
      on: s.number >> 3 < this.matrix.length && ((this.matrix[s.number >> 3] >> (s.number & 7)) & 1) === 1,
    }));
    for (let i = 0; i < 16; i++) {
      const bank = i < 8 ? this.dip1 : this.dip2;
      rows.push({
        id: Mpu3.DIL_ID_BASE + i,
        label: dilSwitchLabel(`DIP ${i < 8 ? 1 : 2} switch ${(i & 7) + 1}`, this.dilLabels?.[i]),
        on: (bank & (1 << (i & 7))) !== 0,
        group: 'DIP switches',
        option: true,
      });
    }
    return rows;
  }

  layoutInput(id: number, on: boolean): void {
    if (id >= Mpu3.DIL_ID_BASE && id < Mpu3.DIL_ID_BASE + 16) {
      const mask = 1 << ((id - Mpu3.DIL_ID_BASE) & 7);
      if (id < Mpu3.DIL_ID_BASE + 8) this.dip1 = on ? this.dip1 | mask : this.dip1 & ~mask & 0xff;
      else this.dip2 = on ? this.dip2 | mask : this.dip2 & ~mask & 0xff;
      return;
    }
    if (id < 0 || id >= this.matrix.length * 8) return;
    if (on) this.matrix[id >> 3] |= 1 << (id & 7);
    else this.matrix[id >> 3] &= ~(1 << (id & 7));
  }

  layoutLamp(n: number): boolean {
    return n >= 0 && n < this.lamps.length && this.lamps[n] !== 0;
  }

  layoutLampLevel(n: number): number {
    return n >= 0 && n < this.lamps.length ? this.lamps[n] : 0;
  }

  layoutDigit(n: number): number {
    return n >= 0 && n < this.digits.length ? this.digits[n] : 0;
  }

  layoutDigitLevel(n: number): number {
    return n >= 0 && n < this.digitLevels.length ? this.digitLevels[n] : 0xff;
  }

  setMeterMoneyMap(map: {
    meterIn: readonly number[]; meterOut: readonly number[];
    triacIn: readonly number[]; triacOut: readonly number[];
  }): void {
    const unit = (xs: readonly number[]) => xs.map((x) => Math.max(0, x) * MPU3_METER_UNIT_PENCE);
    const [mOut, tOut] = ledgerOutMults(
      { in: [...map.meterIn], out: [...map.meterOut] },
      { in: [...map.triacIn], out: [...map.triacOut] },
    );
    this.meterInRaw = [...map.meterIn];
    this.meterOutRaw = [...map.meterOut];
    this.triacInRaw = [...map.triacIn];
    this.triacOutRaw = [...map.triacOut];
    this.meterInPence = unit(map.meterIn);
    this.triacInPence = unit(map.triacIn);
    this.meterOutPence = mOut.map((x) => x * MPU3_METER_UNIT_PENCE);
    this.triacOutPence = tOut.map((x) => x * MPU3_METER_UNIT_PENCE);
    this.outPriced = [...this.meterOutPence, ...this.triacOutPence].some((p) => p > 0);
  }

  get moneyPriced(): boolean {
    return [...this.meterInPence, ...this.meterOutPence, ...this.triacInPence, ...this.triacOutPence]
      .some((p) => p > 0);
  }

  setSlidePence(slides: readonly SlideEffect[]): void {
    for (let i = 0; i < 16; i++) this.slidePence[i] = slides[i] ?? null;
    this.tokenOutCache = null;
  }

  private tokenOutCache: number | null = null;
  private tokenOutBits(): number {
    if (this.tokenOutCache !== null) return this.tokenOutCache;
    let bits = 0;
    for (const p of mpu3Payouts(this.rom) ?? []) {
      if (!p.triacs || !p.meterBits) continue;
      let token = true;
      for (let i = 0; i < 8; i++) if (p.triacs & (1 << i) && this.slidePence[i] !== 'token') token = false;
      if (token) bits |= p.meterBits;
    }
    return (this.tokenOutCache = bits);
  }

  powerCycle(): void {
    this.reset();
  }

  reset(): void {
    this.ptm.reset();
    this.ic3.reset();
    this.ic4.reset();
    this.ic5.reset();
    this.ic6.reset();
    this.display.reset();
    this.reelBank.reset();
    this.lampMux.reset();
    this.segBank.reset();
    this.speaker.reset();
    this.strobe = 0;
    this.strobeEnable = false;
    this.strobeEnableCount = 0;
    this.zeroLevel = false;
    this.zeroCount = ZERO_FIRST;
    this.t555Level = false;
    this.t555Count = T555_FIRST;
    this.slices = 0;
    this.aux2In = 0;
    this.auxCount = 0;
    this.auxShift = 0;
    this.triacWord = 0;
    this.meterWord = 0;
    this.meterHold.fill(0);
    this.coinTimer = 0;
    this.coinMask = 0;
    this.lamps.fill(0);
    this.cpu.reset();
    this.cpu.irq1Enabled = true;
  }

  step(): number {
    if (this.wiring) this.takeStep();
    const c = this.cpu.step();
    if (this.judging) this.judgeStep(c);
    if (++this.slices % METER_TICK_SLICES === 0) this.tickMeters();
    this.speaker.tick(c);
    this.ptm.tick(c);
    if (this.strobeEnableCount > 0) {
      this.strobeEnableCount -= c;
      if (this.strobeEnableCount < 1) this.strobeEnable = false;
    }
    this.zeroCount -= c;
    if (this.zeroCount < 1) {
      this.zeroLevel = !this.zeroLevel;
      if (!this.zeroLevel) {
        this.ptm.setExternalClock(0, false);
        this.ic3.setCB1(false);
        this.zeroCount += ZERO_LOW;
      } else {
        this.ptm.setExternalClock(0, true);
        this.ic3.setCB1(true);
        this.zeroCount += ZERO_HIGH;
      }
    }
    this.t555Count -= c;
    if (this.t555Count < 1) {
      this.t555Level = !this.t555Level;
      if (!this.t555Level) {
        this.ptm.setExternalClock(1, false);
        this.ic4.setCA1(false);
        this.t555Count += T555_LOW;
      } else {
        this.ptm.setExternalClock(1, true);
        this.ic4.setCA1(true);
        this.t555Count += T555_HIGH;
      }
    }
    if (this.coinTimer > 0) {
      this.coinTimer -= c;
      if (this.coinTimer <= COIN_GAP) this.matrix[this.coinRow] &= ~this.coinMask;
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
    this.cpu.setIRQ1(this.ptm.irq() || this.ic3.irqB() || this.ic4.irqA() || this.ic6.irqA() || this.ic6.irqB());
    return c;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  read8(addr: number): number {
    addr &= 0xffff;
    switch (addr >> 11) {
      case 0x00: case 0x10: return this.ram[addr & 0x7ff];
      case 0x11: return this.ptm.read((addr >> 2) & 7);
      case 0x12: return this.ic3.read(addr & 3);
      case 0x13: return this.ic4.read(addr & 3);
      case 0x14: return this.ic5.read(addr & 3);
      case 0x15: return this.ic6.read(addr & 3);
      case 0x06: case 0x18:
        if (addr === this.chrAddr) return this.rom[(0x8001 + (this.cpu.x & 0x7fff)) & 0xffff];
        return this.rom[0x8000 + (addr & 0x7fff)];
      default: return this.rom[0x8000 + (addr & 0x7fff)];
    }
  }

  write8(addr: number, v: number): void {
    addr &= 0xffff;
    v &= 0xff;
    switch (addr >> 11) {
      case 0x00: case 0x10: this.ram[addr & 0x7ff] = v; return;
      case 0x11:
        this.ptm.write((addr >> 2) & 7, v);
        this.updateSound();
        return;
      case 0x12: this.writeIc3(addr & 3, v); return;
      case 0x13: this.writeIc4(addr & 3, v); return;
      case 0x14: this.writeIc5(addr & 3, v); return;
      case 0x15: this.writeIc6(addr & 3, v); return;
      case 0x06: case 0x18: if (addr === this.chrAddr) return; this.strays.hit(addr); return;
      default: this.strays.hit(addr); return;
    }
  }

  private piaWrite(p: Pia6821, reg: number, v: number): PiaWrite {
    return v20PiaWrite(p, reg, v);
  }

  private writeIc3(reg: number, v: number): void {
    const w = this.piaWrite(this.ic3, reg, v);
    if (w.changedB) this.triacWrite();
    if (w.ca2) this.setStrobeBit(0, this.ic3.ca2());
    if (w.cb2) this.updateSound();
  }

  private writeIc4(reg: number, v: number): void {
    const w = this.piaWrite(this.ic4, reg, v);
    const t = this.cpu.cycles;
    if (this.displayPort === Mpu3DisplayPort.Meters) {
      if (w.changedA) {
        const inv = ~this.ic4.outA() & 0x7f;
        const word = inv & 0x40 ? 0 : inv & 0x3f;
        this.meterWrite(word);
        this.setLampBits(METER_LAMPS, word, 6);
        this.meterSenseWrite(word);
      }
    } else if (w.wroteA) {
      const table = this.displayPort === Mpu3DisplayPort.Bwb ? SEG_BWB : SEG_DISPLAYS;
      this.segBank.write(this.strobe, table[this.ic4.outA()], this.strobeEnable, t);
    }
    if (w.wroteB) this.lampMux.write(this.strobe, this.strobeEnable ? this.ic4.outB() : 0, t);
    if (w.ca2) this.setStrobeBit(1, this.ic4.ca2());
    if (w.cb2) this.triacWrite();
  }

  private writeIc5(reg: number, v: number): void {
    const w = this.piaWrite(this.ic5, reg, v);
    if (w.changedA) {
      let d = this.ic5.outA();
      for (let i = 0; i < 4; i++, d >>= 2) this.reelBank.step(i, MPU3_REEL_PATTERN[d & 3]);
    }
    if (w.ca2) this.setStrobeBit(2, this.ic5.ca2());
    if (w.cb2) this.triacWrite();
  }

  private writeIc6(reg: number, v: number): void {
    const w = this.piaWrite(this.ic6, reg, v);
    if (w.changedA) {
      const a = this.ic6.outA();
      this.display.por((a & 8) !== 0);
      this.display.data((a & 0x20) !== 0);
      this.display.sclk((a & 0x10) === 0);
    }
    if (w.crbManual) this.aux2In = this.ic6.cb2() ? this.aux2In & 0x7f : this.aux2In | 0x80;
    if (w.changedB) {
      const b = this.ic6.outB();
      this.setLampBits(AUX2_LAMPS, ~b, 8);
      if (w.changedB & b & 0x20) {
        this.auxCount++;
        this.auxShift >>= 1;
        this.aux2In = (this.aux2In & 0x80) | ((this.auxShift & 1) << 6);
      }
      if (w.changedB & b & 0x10) {
        this.auxCount = 0;
        this.auxShift = 0x50;
        this.aux2In &= 0x80;
      }
    }
  }

  private setStrobeBit(bit: number, level: boolean): void {
    if (level) this.strobe |= 1 << bit;
    else this.strobe &= ~(1 << bit) & 7;
    if (bit === 0 && level) {
      this.strobeEnable = true;
      this.strobeEnableCount = STROBE_ENABLE_CYCLES;
    }
    this.lampMux.strobe(this.cpu.cycles);
  }

  private ic3PortA(): number {
    const v = this.strobe < 4 ? (this.matrix[this.strobe] << 2) & 0xff : this.dilRow(this.strobe);
    return v | (this.zeroLevel ? 2 : 0);
  }

  private dilRow(strobe: number): number {
    switch (strobe) {
      case 4: return DIP_LOW(this.dip1);
      case 5: return DIP_HIGH(this.dip1);
      case 6: return DIP_LOW(this.dip2);
      default: return DIP_HIGH(this.dip2);
    }
  }

  private setLampBits(base: number, word: number, n: number): void {
    for (let i = 0; i < n; i++) this.lamps[base + i] = (word >> i) & 1 ? 0xff : 0;
  }

  private triacWrite(): void {
    const word = (this.ic3.outB() | (this.ic4.cb2() ? 0x100 : 0) | (this.ic5.cb2() ? 0x200 : 0)) & 0x3ff;
    const rising = word & ~this.triacWord;
    this.triacWord = word;
    this.setLampBits(TRIAC_LAMPS, word, 10);
    if (!rising) return;
    for (let i = 0; i < 10; i++) {
      if (!(rising & (1 << i))) continue;
      this.triacPulses[i]++;
      this.gridTotals.in += this.triacInRaw[i] ?? 0;
      this.gridTotals.out += this.triacOutRaw[i] ?? 0;
      if (this.booksMoney && !this.wiredIn) this.cashLedger.inPence += this.triacInPence[i] ?? 0;
      if (this.booksMoney) this.cashLedger.outPence += this.triacOutPence[i] ?? 0;
      const p = this.slidePence[i];
      if (p === null) continue;
      if (typeof p === 'number') this.slideOutPence += p;
      if (this.outPriced || !this.booksMoney) continue;
      if (p === 'token') this.cashLedger.unpricedTokenOut++;
      else if (p === 'unpriced') this.cashLedger.unpricedOut++;
      else this.cashLedger.outPence += p;
    }
  }

  meterSenseLine = 0x13;
  meterSenseMask = 0x3f;

  private meterSenseWrite(word: number): void {
    if (this.meterSenseLine < 0) return;
    this.layoutInput(this.meterSenseLine, word !== 0 && (word & this.meterSenseMask) !== 0);
  }

  private meterWrite(word: number): void {
    const rising = word & ~this.meterWord;
    for (let b = 0; b < 8; b++) {
      const bit = 1 << b;
      if (rising & bit) this.meterHold[b] = METER_HOLD_TICKS;
      else if (this.meterWord & bit && !(word & bit)) this.meterHold[b] = 0;
    }
    this.meterWord = word;
  }

  private tickMeters(): void {
    for (let b = 0; b < 8; b++) {
      if (!(this.meterWord & (1 << b)) || this.meterHold[b] === 0) continue;
      if (--this.meterHold[b] !== 0) continue;
      this.meterCounts[b]++;
      this.gridTotals.in += this.meterInRaw[b] ?? 0;
      this.gridTotals.out += this.meterOutRaw[b] ?? 0;
      if (this.booksMoney && !this.wiredIn) this.cashLedger.inPence += this.meterInPence[b] ?? 0;
      if (!this.booksMoney) continue;
      if (this.tokenOutBits() & (1 << b)) this.cashLedger.tokenOutPence += this.meterOutPence[b] ?? 0;
      else this.cashLedger.outPence += this.meterOutPence[b] ?? 0;
    }
  }

  private soundLevel = 0;
  private updateSound(): void {
    const l = (this.ic3.cb2() ? 1 : 0) ^ (this.ptm.pinLevel(0) ? 1 : 0)
      ^ (this.ptm.pinLevel(1) ? 1 : 0) ^ (this.ptm.pinLevel(2) ? 1 : 0);
    if (l === this.soundLevel) return;
    this.soundLevel = l;
    this.speaker.write(0, l);
  }

  insertCoin(id: number): void {
    if (this.coinTimer > 0) return;
    const raw = id >= 0x100 && id < 0x180 ? id : COIN_RAW[id];
    if (raw === undefined || !(raw & 0x100)) return;
    const row = (raw & 0x78) >> 3;
    if (row >= this.matrix.length) return;
    const line = 0x100 | (raw & 0x7f);
    const coins = this.programCoins();
    if (coins && !coins.some((c) => c.id === line)) { this.coinsRefused++; return; }
    if (this.wiring && coins) this.pend(this.keyOf(line));
    this.coinRow = row;
    this.coinMask = 1 << (raw & 7);
    this.coinTimer = COIN_PRESS + COIN_GAP;
    this.matrix[this.coinRow] |= this.coinMask;
  }

  get coinBusy(): boolean { return this.coinTimer > 0; }

  private coinCodeCache: Mpu3CoinCode | Refusal | null = null;
  private coinCodeFound(): Mpu3CoinCode | Refusal {
    return (this.coinCodeCache ??= locateMpu3Coins(this.rom));
  }
  private coinCode(): Mpu3CoinCode | null {
    const c = this.coinCodeFound();
    return 'refused' in c ? null : c;
  }

  private coinsCache: { dips: number; coins: Mpu3Coin[] | null } | null = null;
  private programCoins(): Mpu3Coin[] | null {
    const code = this.coinCode();
    if (!code) return null;
    const dips = (this.dip1 << 8) | this.dip2;
    if (this.coinsCache?.dips !== dips) this.coinsCache = { dips, coins: mpu3Coins(code, this.rom, (s) => this.dilRow(s)) };
    return this.coinsCache.coins;
  }

  get coinLineTable(): CoinLineTable | null {
    const code = this.coinCode();
    const coins = this.programCoins();
    if (!code || !coins) return null;
    const t = mpu3CoinTable(code, coins);
    return { ...t, lines: t.lines.map((l) => ({ ...l, line: this.keyOf(l.line) })) };
  }

  private static lineOf(id: number): number | null {
    const raw = id >= 0x100 && id < 0x180 ? id : COIN_RAW[id];
    if (raw === undefined || !(raw & 0x100) || ((raw & 0x78) >> 3) >= 6) return null;
    return 0x100 | (raw & 0x7f);
  }

  private keyOf(line: number): number {
    return this.drawnCoins.find((d) => d !== line && Mpu3.lineOf(d) === line) ?? line;
  }

  get coinLineTableRefusal(): string | null {
    const c = this.coinCodeFound();
    if ('refused' in c) return c.refused;
    return this.programCoins() ? null : 'the program\'s change for a coin does not balance at these DIL settings';
  }

  private priced(): Map<number, SlotCoin> | null {
    const t = this.coinLineTable;
    if (!t) return null;
    const c = detectCoins(t);
    return c instanceof Map ? c : null;
  }

  get coinChutes(): readonly CoinChute[] | undefined {
    const coins = this.priced();
    if (!coins) return undefined;
    const label = (p: number): string => (p >= 100 ? `£${p % 100 ? (p / 100).toFixed(2) : p / 100}` : `${p}p`);
    return [...coins].map(([bit, coin]): CoinChute => (typeof coin === 'number'
      ? { label: label(coin), bit, pence: coin }
      : { label: coin.token === null ? 'Token' : `${label(coin.token)} token`, bit, pence: coin.token, token: true }))
      .sort((a, b) => (b.pence ?? -1) - (a.pence ?? -1) || a.bit - b.bit);
  }

  coinsRefused = 0;

  private wiring: { coins: Map<number, SlotCoin>; conflicts: number[] } | null = null;
  private wiringState: { key: string; state: StepState } = { key: '', state: 'waiting' };

  setCoinWiring(w: CoinWiring): void {
    const { coins, conflicts } = linesOf(w);
    this.wiringState = wiringStateFor(this.wiringState, this.wiring !== null, wiringKey(w), (key) => ({ key, state: 'waiting' }));
    this.wiring = { coins, conflicts };
  }

  get coinWiringStatus(): CoinWiringStatus | undefined {
    const w = this.wiring;
    if (!w) return undefined;
    const st = this.wiringState.state;
    return { state: st, step: st === 'calibrated' ? 1 : null, conflicts: [...w.conflicts] };
  }

  private get booksMoney(): boolean {
    return !this.wiring || this.wiringState.state !== 'disagrees';
  }

  private get wiredIn(): boolean {
    return !!this.wiring && this.programCoins() !== null;
  }

  private takeId = -1;
  private takeEnd = -1;
  private takeLeft = 0;
  private static readonly TAKE_WINDOW = 400;

  private takeStep(): void {
    const code = this.coinCode();
    if (!code) return;
    const pc = this.cpu.pc & 0x7fff;
    if (this.takeId >= 0) {
      if (pc === code.credit && (code.creditX === undefined || this.cpu.x === code.creditX)) {
        const id = this.takeId;
        this.takeId = -1;
        this.unpend(id);
        this.bookTaken(id);
        return;
      }
      const ended = code.shape === 'strobed' ? pc === this.takeEnd : this.recordPtr(code) !== this.takeEnd;
      if (ended || --this.takeLeft <= 0) { this.unpend(this.takeId); this.takeId = -1; }
    }
    if (pc !== code.take) return;
    let line: number | null = null;
    if (code.shape === 'strobed') {
      const st = this.ram[code.strobeVar!]!;
      if (st < 4) line = st * 8 + 5;
      const sp = this.cpu.s;
      this.takeEnd = ((this.read8((sp + 1) & 0xffff) << 8) | this.read8((sp + 2) & 0xffff)) & 0x7fff;
    } else {
      this.takeEnd = this.recordPtr(code);
      line = code.lineOfIndex![this.takeEnd - code.table!] ?? null;
    }
    if (line === null) return;
    this.takeId = this.keyOf(0x100 | line);
    this.takeLeft = Mpu3.TAKE_WINDOW;
  }

  private recordPtr(code: Mpu3CoinCode): number {
    return (this.ram[code.ptrVar!]! << 8) | this.ram[code.ptrVar! + 1]!;
  }

  private static readonly JUDGE_WAIT = Math.round(1.5 * MPU3_CLOCK);
  private readonly judgeId = new Array<number>(4).fill(-1);
  private readonly judgeWait = new Array<number>(4).fill(0);
  private judging = false;

  private pend(id: number): void {
    const k = this.judgeId.indexOf(-1);
    if (k < 0) { this.coinsRefused++; return; }
    this.judgeId[k] = id;
    this.judgeWait[k] = Mpu3.JUDGE_WAIT;
    this.judging = true;
  }

  private unpend(id: number): void {
    let k = -1;
    for (let i = 0; i < this.judgeId.length; i++) {
      if (this.judgeId[i] !== id) continue;
      if (k < 0 || this.judgeWait[i]! < this.judgeWait[k]!) k = i;
    }
    if (k < 0) return;
    this.judgeId[k] = -1;
    this.judgeWait[k] = 0;
  }

  private judgeStep(cycles: number): void {
    let any = false;
    for (let k = 0; k < this.judgeId.length; k++) {
      if (this.judgeId[k]! < 0) continue;
      this.judgeWait[k] = this.judgeWait[k]! - cycles;
      if (this.judgeWait[k]! <= 0) {
        this.coinsRefused++;
        this.judgeId[k] = -1;
        this.judgeWait[k] = 0;
        continue;
      }
      any = true;
    }
    this.judging = any;
  }

  private bookTaken(id: number): void {
    const w = this.wiring;
    if (!w || !this.booksMoney || w.conflicts.includes(id)) return;
    const taken = this.priced()?.get(id) ?? null;
    const c = w.coins.get(id);
    if (c === undefined) {
      if (taken !== null) this.bookCoin(id, taken);
      return;
    }
    if (taken !== null) {
      const agrees = typeof c === 'number'
        ? typeof taken === 'number' && taken === c
        : typeof taken === 'object' && (c.token === null || taken.token === null || c.token === taken.token);
      this.wiringState.state = agrees ? 'calibrated' : 'disagrees';
      if (!agrees) return;
    }
    this.bookCoin(id, c);
  }

  private bookCoin(id: number, c: SlotCoin): void {
    if (typeof c === 'number') this.cashLedger.inPence += c;
    else if (c.token === null) this.cashLedger.unpricedTokenIn++;
    else this.cashLedger.tokenInPence += c.token;
    this.cashLedger.outPence += this.changeFor(id);
  }

  private changeFor(id: number): number {
    const t = this.coinLineTable;
    const l = t?.lines.find((x) => x.line === id);
    if (!t || !l || !l.change.length) return 0;
    const alt = l.change[0]!;
    return alt.reduce((s, x) => s + x.count * (x.pence ?? 0), 0);
  }

  private coinSlots: number[] = [];
  private drawnCoins: number[] = [];
  private plainInputs: number[] = [];

  setLayoutCoins(list: readonly DeclaredCoin[], plain: readonly number[] = []): void {
    const slots = new Set<number>();
    const drawn = new Set<number>();
    for (const c of list) {
      if (c.named?.name.startsWith('ccTalk') || c.named?.name.startsWith('NV')) continue;
      const id = mpu3SlotId(c);
      if (id === null) continue;
      drawn.add(id);
      if (c.pence === null) slots.add(id);
    }
    this.coinSlots = [...slots].sort((a, b) => a - b);
    this.drawnCoins = [...drawn].sort((a, b) => a - b);
    this.plainInputs = [...new Set(plain.filter((b) => Number.isInteger(b) && b >= 0 && b < 0x80))].sort((a, b) => a - b);
  }

  get unnamedCoinLines(): readonly number[] {
    const coins = this.programCoins() ?? [];
    const plain = this.plainInputs.map((b) => 0x100 | b).filter((id) => coins.some((c) => c.id === id)).map((id) => this.keyOf(id));
    return [...new Set([...this.coinSlots, ...plain])].sort((a, b) => a - b);
  }

  private meterInRaw: number[] = [];
  private meterOutRaw: number[] = [];
  private triacInRaw: number[] = [];
  private triacOutRaw: number[] = [];
  private readonly gridTotals = { in: 0, out: 0 };

  get meterTotals(): { in: number; out: number } {
    return { in: this.gridTotals.in, out: this.gridTotals.out };
  }

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: 'LAMPS', part: '8 x 8 strobed - IC4 port B', device: this.lamps },
      { id: 'sevenseg', label: '7-SEG', part: 'IC4 port A under the strobe', device: this.digits },
      { id: 'meters', label: 'METERS', part: 'IC4 port A, by the layout', device: this.meterCounts },
      { id: 'triacs', label: 'TRIACS', part: 'IC3 port B + IC4/IC5 CB2', device: this.triacPulses },
      { id: 'switches', label: 'SWITCHES', part: '4 strobes on IC3 port A, AUX1/AUX2', device: this.matrix },
      { id: 'coins', label: 'COIN INPUTS', part: 'matrix lines', modelled: true,
        note: 'Timed matrix makes (insertCoin) on the line the acceptor names - not a mech.' },
      { id: 'pia3', label: 'PIA IC3', part: 'MC6821 - switches, triacs', device: this.ic3 },
      { id: 'pia4', label: 'PIA IC4', part: 'MC6821 - lamps, digits/meters', device: this.ic4 },
      { id: 'pia5', label: 'PIA IC5', part: 'MC6821 - reels, optics', device: this.ic5 },
      { id: 'pia6', label: 'PIA IC6', part: 'MC6821 - AUX1/alpha, AUX2', device: this.ic6 },
      { id: 'ptm', label: 'PTM IC2', part: 'MC6840 - timers, sound', device: this.ptm },
      { id: 'alpha', label: 'ALPHA', part: 'MSC1937 on IC6 port A', device: this.display },
      { id: 'ram', label: 'RAM', part: '2K - battery', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: 'game card', device: this.rom },
      { id: 'cpu', label: 'CPU', part: 'M6808 - 1 MHz', device: this.cpu, cpu: true },
      { id: 'reels', label: '4 REELS', part: 'stepper, IC5 port A', device: this.reelBank.reels },
      { id: 'sound', label: 'SOUND', part: 'IC3 CB2 and the PTM', device: this.speaker },
    ];
  }
}

export function mpu3SlotId(c: Pick<DeclaredCoin, 'line' | 'button' | 'note'>): number | null {
  if (c.line !== null) return c.line;
  if (c.note !== null && c.note !== 0x47) return c.note;
  if (c.note === 0x47 && c.button !== null && c.button >= 0) return 0x100 | (c.button & 0x7f);
  return null;
}
