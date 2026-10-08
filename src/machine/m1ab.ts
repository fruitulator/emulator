import { placeRomFlat } from './pairplacer';
import type { Bus } from '../cpu/bus';
import type { CabinetSwitch, CoinChute, CoinWiringStatus, Machine } from './machine';
import { newCashLedger, dilSwitchLabel } from './machine';
import type { SlideEffect } from '../layout/fmlconfig';
import type { LayoutSwitch } from './layoutswitches';
import type { BoardPart } from './parts';
import { M6809 } from '../cpu/m6809';
import { Mc68681 } from '../hw/mc68681';
import { Pia6821 } from '../hw/pia6821';
import { I8279 } from '../hw/i8279';
import { S16lf01 } from '../hw/s16lf01';
import { Reel } from '../hw/reel';
import { MODEL_RELATIONS, V20_ARM_M1AB, parkAtV20PowerUp, v20IndexWindow } from './v20optic';
import { Ay8910 } from '../hw/ay8910';
import { Hopper } from '../hw/hopper';
import { Ym2413 } from '../hw/ym2413';
import { Msm6376, MSM6376_RATE } from '../hw/msm6376';
import { Upd7759, UPD7759_RATE, upd7759Header } from '../hw/upd7759';
import { M1aOki, M1A_OKI_POLL_INSTRUCTIONS } from '../hw/m1aoki';
import { MaygayDot } from '../hw/maygaydot';
import { DataPak } from '../hw/datapak';
import { MeterConfirm } from '../hw/meterconfirm';
import { Mixer } from '../hw/mixer';
import { LampHistory } from '../hw/lamphistory';
import { noteBoardDefault, noteRomCut } from './boarddefaults';
import { StrayCounter } from './strayaccess';
import { MaygayDongle } from '../hw/m1dongle';
import { COIN_RAW } from './coinraw';
import { SwitchedLamps } from '../hw/switchedlamps';
import { lockoutRefuses, lockoutRefusing, type CoinLockoutWiring } from '../hw/coinlockout';
import { v20LoadRamFile } from './v20ramfile';
import { linesOf, MeterUnitCheck, meterCheckState, wiringKey, wiringStateFor, type CoinLineTable, type CoinWiring, type MeterCheckState, type SlotCoin } from './coinwiring';
import { readM1abCoinTable, type M1abCoinRead, type M1abLineCoin } from './m1abcoins';
import { coinRowPattern, type DeclaredCoin } from './layoutcoins';

export const M1AB_METER_ROLES = [
  'cash-in', 'cash-out', 'token-in', 'token-out', 'refill',
  'unassigned', 'unassigned', 'unassigned',
] as const;

export const MASTER_CLOCK = 8_000_000;
export const CPU_CLOCK = MASTER_CLOCK / 4;
const DUART_CLOCK = 3_686_400;
const METER_TICK_INSTRUCTIONS = 1000;
export const PSG_CLOCK = MASTER_CLOCK / 4;
const SCAN_HZ = 2_000;

const RAM_SIZE = 0x2000;
const ROM_SIZE = 0x10000;

const BANK_TOP = 0xe000;

const M1AB_OPTIC_WINDOW = v20IndexWindow(V20_ARM_M1AB, 0, MODEL_RELATIONS.M1AB, 96) ?? [1, 3];

export function m1abRomImage(chunks: readonly Uint8Array[]): { image: Uint8Array; placed: number; total: number } {
  return placeRomFlat(chunks, { min: ROM_SIZE, max: ROM_SIZE * 2, reverse: true });
}

const LATCH_NMIEN = 2, LATCH_LAMP = 4, LATCH_SRSEL = 6;

export interface M1abInputs {
  readonly switches: Uint8Array;
}

export class M1ab implements Bus, Machine {
  readonly cpu: M6809;
  readonly ram = new Uint8Array(RAM_SIZE);
  private readonly rom = new Uint8Array(ROM_SIZE * 2);
  private bank = 0;

  readonly vfd = new S16lf01();
  readonly duart: Mc68681;
  dot: MaygayDot | null = null;
  readonly pia: Pia6821;
  readonly kbd: I8279;
  readonly kbd2: I8279;

  readonly ay = new Ay8910(PSG_CLOCK, 'ym2149', undefined, { pin26Low: false });
  opll = Object.assign(new Ym2413(MSM6376_RATE), { v20Mix: true });
  readonly oki = new Msm6376();
  readonly okiCtl = new M1aOki(this.oki);
  readonly upd = new Upd7759();
  necFitted = false;
  private necBusy = false;
  private necPlaying = false;
  necBankBlock: [number, number] = [0, 1];
  private mixer: Mixer;

  readonly lampHistory = new LampHistory(0x200 + 8);
  readonly lamps = this.lampHistory.level;

  private readonly opLamps = new SwitchedLamps(6);
  static readonly OP_LAMPS = 0x200;

  private opLampWrite(opr: number, was: number): void {
    if (((opr ^ was) & 0x3f) === 0) return;
    this.opLamps.write(~opr & 0x3f);
    this.lamps.set(this.opLamps.shown, M1ab.OP_LAMPS);
  }

  private readonly pbLamps = new SwitchedLamps(7);
  static readonly PB_LAMPS = 0x100;
  private pbOut = 0;

  private ayDataWrite(v: number): void {
    const r = this.ay.selectedAddress;
    const r7 = this.ay.regs[7], r15 = this.ay.regs[15];
    let change = 0;
    if (r === 7 && (~r7 & v & 0x80)) { change = r15 ^ this.pbOut; this.pbOut = r15; }
    else if (r === 15 && (r7 & 0x80)) { change = (v ^ r15) & 0xff; this.pbOut = v & 0xff; }
    this.ay.write(v);
    if (change & 0x3f) {
      this.pbLamps.write(this.pbOut & 0x7f);
      this.lamps.set(this.pbLamps.shown, M1ab.PB_LAMPS);
    }
  }

  private readonly latchLamp = new SwitchedLamps(1);
  static readonly LATCH_LAMP = 0x206;

  static readonly snapshotConfig: readonly string[] = ['necFitted', 'necBankBlock', 'mixer', 'wiring', 'coinSlots', 'coinTableCache', 'lockoutCache'];

  readonly latch = new Uint8Array(8);

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: '256 LAMPS', part: '2 x 16 strobes',
        device: this.lamps, signal: 'lamps' },
      { id: 'switches', label: 'SWITCH MATRIX', part: 'i8279 return lines',
        device: this.inputs.switches },
      { id: 'meters', label: '6 METERS', part: 'YM2149 port A', device: this.ay },
      { id: 'coins', label: 'COIN INPUTS', part: 'lockouts on port B', signal: 'coin' },

      { id: 'kbd', label: 'i8279 #1', part: 'lamps - switch matrix', device: this.kbd },
      { id: 'kbd2', label: 'i8279 #2', part: 'more lamps', device: this.kbd2 },
      { id: 'mcu', label: '80C51 MCU', part: 'M1A only' },
      { id: 'latch', label: '74HC259 LATCH', part: 'Srsel - NMIEN - watchdog',
        device: this.latch },

      { id: 'ram', label: 'BATTERY RAM', part: '8K', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: 'banked - Srsel', device: this.rom },
      { id: 'ay', label: 'PSG', part: 'YM2149', device: this.ay },
      { id: 'opll', label: 'FM', part: 'YM2413', device: this.opll },
      this.necFitted
        ? { id: 'upd', label: 'SAMPLES', part: 'uPD7759', device: this.upd }
        : { id: 'oki', label: 'SAMPLES', part: 'MSM6376', device: this.oki },
      { id: 'alpha', label: 'VFD', part: 'S16LF01 - 16 char',
        device: this.vfd, signal: 'display' },

      { id: 'cpu', label: 'CPU', part: 'MC6809 - 2 MHz E', device: this.cpu, cpu: true },
      { id: 'duart', label: 'DUART', part: 'MC68681 - reel optics', device: this.duart },
      { id: 'pia', label: 'PIA', part: 'MC6821 - VFD clock', device: this.pia },
      { id: 'psu', label: 'PSU RELAY', part: 'mains fail - NMI' },

      { id: 'reels', label: 'REEL MECH', part: 'Starpoint x6',
        device: this.reels, signal: 'reels' },
      ...(this.hopperFitted()
        ? [{ id: 'hopper', label: 'HOPPER', part: 'motor AY PA6',
             device: this.hopper } satisfies BoardPart]
        : [{ id: 'hopper', label: 'HOPPER', part: 'not fitted' } satisfies BoardPart]),
      { id: 'coinmech', label: 'COIN MECH', part: 'acceptor', signal: 'coin' },
    ];
  }
  meters = 0;
  fittedMeters = 0x3f;
  lockouts = 0;

  get lockoutWiring(): CoinLockoutWiring {
    const t = this.readCoinTable();
    if (this.lockoutCache?.t !== t) {
      const masks = 'refused' in t ? [] : t.lockouts.map((m, line) => (line === M1ab.TOKEN_LINE ? null : m));
      this.lockoutCache = { t, w: { openSense: 1, mask: 0x3f, bits: [], masks } };
    }
    return this.lockoutCache.w;
  }
  private lockoutCache: { t: object; w: CoinLockoutWiring } | null = null;

  coinsRefused = 0;

  get coinRefusing(): number {
    let none = 0;
    for (let line = 0; line < 8; line++) if (this.programCoinOn(line) === 'none') none |= 1 << line;
    return lockoutRefusing(this.lockoutWiring, this.lockouts, 8, (n) => 1 << n) | none;
  }

  private hoppersWord = 0x50;

  setHoppers(word: number): void {
    this.hoppersWord = word & 0xff;
    this.priceHopper();
  }

  private hopperFitted(): boolean {
    return (this.hoppersWord & 0x50) !== 0x50;
  }

  static readonly HOPPER_WAVEFORM = { obscuredMs: 40, clearMs: 150 } as const;

  readonly hopper = new Hopper(CPU_CLOCK, M1ab.HOPPER_WAVEFORM);

  private hopperCoinPence: number | null = null;

  static hopperCoinUnitsIn(image: Uint8Array, senseSwitches: readonly number[]): number | null {
    for (let a = 0; a + 13 <= image.length; a++) {
      if (image[a] !== 0x81 || image[a + 1] !== 0x03 || image[a + 2] !== 0x26
        || image[a + 4] !== 0xfc || image[a + 7] !== 0xc3 || image[a + 10] !== 0xfd
        || image[a + 5] !== image[a + 11] || image[a + 6] !== image[a + 12]) continue;
      let reads = false;
      for (let k = Math.max(0, a - 0x100); k + 2 < a && !reads; k++) {
        reads = image[k] === 0x86 && senseSwitches.includes(image[k + 1]) && image[k + 2] === 0xbd;
      }
      if (!reads) continue;
      const units = (image[a + 8] << 8) | image[a + 9];
      if (units > 0 && units <= 100) return units;
    }
    return null;
  }

  private hopperSenseSwitches(): number[] {
    if (!this.hopperFitted()) return [];
    return (this.hoppersWord & 0x50) === 0x40 ? [0x17] : [0x12, 0x14];
  }

  private priceHopper(): void {
    const units = M1ab.hopperCoinUnitsIn(this.rom, this.hopperSenseSwitches());
    this.hopperCoinPence = units === null ? null : units * 10;
  }
  private hopperPaidBooked = 0;

  readonly meterCount = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly meterBank = new MeterConfirm();

  private meterConfirmed(i: number): void {
    this.meterCount[i]++;
    this.meterTotals.in += this.meterInMult[i];
    this.meterTotals.out += this.meterOutMult[i];
    if (this.wiring && i === M1ab.CASH_IN_METER) this.wiring.check.count(1, this.wiringState.now);
  }
  get meterLevels(): number { return this.meters & (this.hopperFitted() ? 0x3b : 0x7f); }
  private readonly meterInMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly meterOutMult = [0, 0, 0, 0, 0, 0, 0, 0];

  setMeterMap(inMult: number[], outMult: number[]): void {
    for (let i = 0; i < 8; i++) {
      this.meterInMult[i] = inMult[i] ?? 0;
      this.meterOutMult[i] = outMult[i] ?? 0;
    }
  }

  readonly meterTotals = { in: 0, out: 0 };

  private triacs = 0;
  private readonly slidePence: SlideEffect[] = [];
  readonly slideCoins = [0, 0, 0, 0, 0, 0, 0, 0];
  get triacLevels(): number {
    return this.triacs & 0x3f;
  }

  setSlidePence(pence: SlideEffect[]): void {
    this.slidePence.length = 0;
    this.slidePence.push(...pence);
  }

  get tokenCoins(): number {
    let n = 0;
    for (let i = 0; i < this.slideCoins.length; i++) {
      if (this.slidePence[i] === 'token') n += this.slideCoins[i];
    }
    return n;
  }

  private driveTriacs(v: number): void {
    const rising = v & ~this.triacs & 0x3f;
    this.triacs = v & 0xff;
    if (!rising) return;
    for (let i = 0; i < 6; i++) {
      if (!((rising >> i) & 1)) continue;
      this.slideCoins[i]++;
      const price = this.slidePence[i];
      if (!this.booksMoney) {  }
      else if (typeof price === 'number') this.cashLedger.outPence += price;
      else if (price === 'token') this.cashLedger.tokenOutPence += this.tokenPence;
      else if (price === 'unpriced') this.cashLedger.unpricedOut++;
    }
  }

  readonly cashLedger = newCashLedger();

  private static readonly COIN_PENCE = [10, 20, 50, 100, 20, 0, 0, 0];

  private coinLinePence: (number | null)[] = [...M1ab.COIN_PENCE];

  setCoinLinePence(table: readonly (number | null | undefined)[]): void {
    for (let i = 0; i < table.length && i < this.coinLinePence.length; i++) {
      const p = table[i];
      if (p !== undefined) this.coinLinePence[i] = p;
    }
  }

  private static readonly TOKEN_LINE = 4;
  private get tokenPence(): number {
    return this.coinLinePence[M1ab.TOKEN_LINE] ?? 0;
  }

  readonly inputs: M1abInputs = { switches: new Uint8Array(8) };

  private okiControl = 1;
  private okiPollCount = 0;

  private lampStrobe = 0;
  private scanCycles = 0;
  powerFail = false;

  private static readonly MAINS_HZ = 100;
  private static readonly MAINS_PERIOD = Math.floor(CPU_CLOCK / M1ab.MAINS_HZ);
  private mainsCycles = 0;
  private duartFrac = 0;

  constructor() {
    this.cpu = new M6809(this);
    this.duart = new Mc68681({
      irqChanged: () => { this.cpu.setIRQ(this.duart.irq()); },
      txByte: (ch, v) => {
        if (ch === 1) this.dot?.receive(v);
        else this.onDataPakTx(v);
      },
      outputPort: (opr, was) => this.opLampWrite(opr, was),
    });
    this.pia = new Pia6821({
      writeA: (v) => {
        this.vfd.por((v & 0x40) !== 0);
        this.vfd.data((v & 0x10) !== 0);
        this.vfd.sclk((v & 0x20) !== 0);
      },
      writeB: (v) => { this.driveTriacs(v); },
    });
    this.kbd = new I8279({
      scanLine: (v) => { this.lampStrobe = v; },
      readReturn: () => this.sensorRow(this.lampStrobe & 7),
    });
    this.kbd2 = new I8279();
    this.mixer = new Mixer([this.oki, this.opll]);
    parkAtV20PowerUp(this.reelUnits, MODEL_RELATIONS.M1AB);
    this.reset();
  }

  private writeLamps(strobe: number, data: number, base: number): void {
    const row = (strobe << 3) & 0x78;
    for (let i = 0; i < 8; i++) {
      this.lampHistory.write(base + row + i, (data >> (i ^ 4)) & 1);
    }
  }

  get clockHz(): number { return CPU_CLOCK; }

  loadRom(chips: Uint8Array | readonly Uint8Array[]): void {
    const { image, placed, total } = m1abRomImage(chips instanceof Uint8Array ? [chips] : chips);
    this.rom.set(image);
    this.priceHopper();
    noteRomCut(this, total, placed);
  }

  loadSoundRom(data: Uint8Array, files = 1, sampledSound?: number): void {
    this.necFitted = upd7759Header(data, 0);
    if (!this.necFitted) {
      this.oki.loadRom(data);
      return;
    }
    this.upd.loadRom(data);
    const blocks = (data.length + 0x1ffff) >>> 17;
    const stride = sampledSound !== 2 && blocks === 2 && files === 2 ? 4 : 1;
    this.necBankBlock = [0, stride === 1 && blocks > 1 ? 1 : -1];
    this.opll = Object.assign(new Ym2413(UPD7759_RATE), { v20Mix: true });
    this.mixer = new Mixer([this.upd, this.opll]);
  }

  private necStart(bank: number, n: number): void {
    this.necBusy = true;
    const rom = this.upd.romImage;
    const block = this.necBankBlock[bank];
    const base = block * 0x20000;
    if (block >= 0 && upd7759Header(rom, base) && n <= rom[base]) {
      this.upd.setRomBank(block);
      this.upd.portW(n);
      this.upd.setStartLine(false);
      this.upd.setStartLine(true);
      this.necPlaying = true;
    } else {
      this.necSilence();
      this.necPlaying = false;
    }
  }

  private necSilence(): void {
    this.upd.setResetLine(false);
    this.upd.setResetLine(true);
  }

  loadNvram(data: Uint8Array): void {
    this.ram.set(this.rom.subarray(0, RAM_SIZE));
    v20LoadRamFile(this.ram, data);
  }

  read8(addr: number): number {
    const a = addr & 0xffff;
    if (a < RAM_SIZE) return this.ram[a];
    if (a >= 0x2800) {
      if (this.bank && a < BANK_TOP) return this.rom[a + ROM_SIZE];
      return this.rom[a];
    }
    return this.readIo(a);
  }

  write8(addr: number, val: number): void {
    const a = addr & 0xffff;
    const v = val & 0xff;
    if (a < RAM_SIZE) { this.ram[a] = v; return; }
    if (a < 0x2800) { this.writeIo(a, v); return; }
  }

  private readIo(a: number): number {
    switch (a & 0xfff0) {
      case 0x2030:
        this.foldHopperSense();
        return (a & 1) ? 0 : this.kbd.read(0);
      case 0x2040: return (a & 1) ? 0 : this.kbd2.read(0);
      case 0x2070: return this.duart.read(a & 0x0f);
      case 0x20a0: return this.pia.read(a & 3);
      case 0x20b0: return this.meterStatus();
    }
    switch (a) {
      case 0x2404:
        this.okiControl &= ~1;
        this.okiCtl.control(this.okiControl);
        return 0;
      case 0x2406:
        this.okiControl |= 1;
        this.okiCtl.control(this.okiControl);
        return 0;
      case 0x2408:
        if (this.necFitted) {
          this.necPlaying = false;
          this.necBusy = false;
          this.necSilence();
        }
        return 0;
      case 0x240c:
        if (this.necFitted) this.cpu.setFIRQ(false);
        return 0;
      case 0x240e:
        if (this.necFitted && !this.necBusy) this.cpu.setFIRQ(true);
        return 0;
      case 0x2410:
        this.cpu.setFIRQ(false);
        return 0;
      case 0x2412:
        if (this.okiCtl.nar) this.cpu.setFIRQ(true);
        return 0;
      default:
        if (a !== 0x2400 && a !== 0x240a) this.strays.hit(a);
        return 0;
    }
  }

  readonly strays = new StrayCounter();

  private i8279Write(chip: I8279, a0: number, v: number, base: number): void {
    if (a0 & 1) {
      chip.write(1, v);
      if ((v & 0xff) === 0xc1) {
        for (let col = 0; col < 16; col++) this.writeLamps(col, 0, base);
      }
      return;
    }
    const col = chip.displayPointer;
    chip.write(0, v);
    this.writeLamps(col, v & 0xff, base);
  }

  private writeIo(a: number, v: number): void {
    if (a >= 0x2030 && a <= 0x2031) { this.i8279Write(this.kbd, a & 1, v, 0); return; }
    if (a >= 0x2040 && a <= 0x2041) { this.i8279Write(this.kbd2, a & 1, v, 128); return; }
    if (a >= 0x2070 && a <= 0x207f) {
      if ((a & 0x0f) === 0x0e) {
        if (v & 0x04) this.powerFail = true;
        if (v & 0x08) this.powerFail = false;
        this.updateNmi();
      }
      this.duart.write(a & 0x0f, v);
      return;
    }
    if (a >= 0x20a0 && a <= 0x20a3) { this.pia.write(a & 3, v); return; }
    if (a >= 0x20c0 && a <= 0x20c7) { this.writeLatch(a & 7, v & 1); return; }
    switch (a) {
      case 0x2000: this.driveReels(0, v); return;
      case 0x2010: this.driveReels(2, v); return;
      case 0x2020: this.driveReels(4, v); return;
      case 0x2090: {
        this.ayDataWrite(v);
        const pa = this.ay.regs[14];
        if (pa !== this.meters) {
          const meterMask = this.hopperFitted() ? 0x3b : 0x7f;
          this.meterBank.write(pa & meterMask);
          if (this.hopperFitted()) {
            this.hopper.motorDrive((pa & 0x40) !== 0);
          }
          this.meters = pa;
        }
        this.lockouts = this.ay.regs[15];
        return;
      }
      case 0x2091: this.ay.selectAddress(v); return;
      case 0x2400: this.opll.writeAddress(v); return;
      case 0x2401: this.opll.writeData(v); return;
      case 0x2404: if (this.necFitted) this.necStart(0, v); return;
      case 0x2406: if (this.necFitted) this.necStart(1, v); return;
      case 0x2420: case 0x2421:
        this.okiCtl.writeLatch(v);
        this.okiControl = (this.okiControl & 1) | ((v & 0x80) >> 6);
        this.okiCtl.control(this.okiControl);
        return;
      default: this.strays.hit(a); return;
    }
  }

  private pollOki(): void {
    if (++this.okiPollCount < M1A_OKI_POLL_INSTRUCTIONS) return;
    this.okiPollCount = 0;
    if (this.necFitted) { this.pollNec(); return; }
    if (this.okiCtl.poll()) this.cpu.setFIRQ(true);
  }

  private pollNec(): void {
    if (this.necPlaying) {
      if (!this.upd.active()) {
        this.necPlaying = false;
        this.necBusy = false;
        this.cpu.setFIRQ(true);
      }
    } else {
      this.necBusy = false;
    }
  }

  private writeLatch(bit: number, state: number): void {
    if (bit === LATCH_LAMP && state !== this.latch[bit]) {
      this.latchLamp.write(state);
      this.lamps[M1ab.LATCH_LAMP] = this.latchLamp.shown[0];
    }
    this.latch[bit] = state;
    if (bit === LATCH_SRSEL) this.bank = state;
    if (bit === LATCH_NMIEN) this.updateNmi();
  }

  private updateNmi(): void {
    this.cpu.setNMI(this.powerFail && this.latch[LATCH_NMIEN] !== 0);
  }

  private driveReels(first: number, v: number): void {
    this.reelUnits[first].update(v & 0x0f);
    this.reelUnits[first + 1].update((v >> 4) & 0x0f);
    this.updateOptics();
  }

  private meterStatus(): number {
    return this.fittedMeters & ~this.meters & 0xff;
  }

  private updateOptics(): void {
    for (let i = 0; i < 6; i++) {
      const optic = this.reelUnits[i].optic() !== this.reelOpticInverted[i];
      this.duart.setIP(i, optic ? 0 : 1);
    }
  }

  setReelOpticInverted(reel: number, inverted: boolean): void {
    if (reel >= 0 && reel < this.reelOpticInverted.length) this.reelOpticInverted[reel] = inverted;
    this.updateOptics();
  }

  private readonly reelOpticInverted = [false, false, false, false, false, false];

  private readonly reelUnits = [0, 1, 2, 3, 4, 5].map(
    () => new Reel({
      stepsPerRevolution: 96, symbols: 16, mame: true, mameDrive: 'starpoint',
      indexStart: M1AB_OPTIC_WINDOW[0], indexEnd: M1AB_OPTIC_WINDOW[1], indexPattern: 0, initPhase: 4,
    }),
  );

  get reels(): readonly Reel[] { return this.reelUnits; }

  setReelPosition(i: number, pos: number): void {
    this.reelUnits[i]?.park(pos);
    this.updateOptics();
  }
  get display(): S16lf01 { return this.vfd; }
  get audioSource(): Mixer { return this.mixer; }

  layoutLamp(n: number): boolean {
    return n >= 0 && n < this.lamps.length && this.lamps[n] !== 0;
  }

  layoutLampLevel(n: number): number {
    return n >= 0 && n < this.lamps.length ? this.lamps[n] : 0;
  }

  setOptions(dip1: number, dip2: number, percentIndex: number): void {
    this.dip1 = dip1 & 0xff;
    this.dip2 = dip2 & 0xff;
    this.percentKey = percentIndex & 0x0f;
  }

  private dip1 = 0;
  private dip2 = 0;
  private percentKey = 0;

  setKeys(stakeIndex: number, jackpotIndex: number): void {
    this.stakeWire = M1ab.STAKE_WIRE[stakeIndex] ?? 0;
    this.jackpotWire = M1ab.JACKPOT_WIRE[jackpotIndex] ?? 0;
  }

  private stakeWire = 0;
  private jackpotWire = 0;

  private static readonly STAKE_WIRE = [0, 0, 1, 2, 3, 4, 5, 6];
  private static readonly JACKPOT_WIRE = [0, 8, 6, 5, 7, 9, 10, 12, 13, 1, 2, 3, 4, 11, 14];
  private static readonly REV = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];

  private foldHopperSense(): void {
    if (!this.hopperFitted()) return;
    const bits = (this.hoppersWord & 0x50) === 0x40 ? 0x80 : 0x14;
    const row = M1ab.MATRIX_TO_ROW[3];
    if (this.hopper.opto) this.inputs.switches[row] |= bits;
    else this.inputs.switches[row] &= ~bits & 0xff;
  }

  private sensorRow(strobe: number): number {
    const matrix = this.inputs.switches[strobe ^ 4];
    switch (strobe) {
      case 0: return this.dip1;
      case 3:
        return ((this.jackpotWire << 1) | matrix | ((M1ab.REV[this.stakeWire & 0x0f] & 0x0c) << 3)) & 0xff;
      case 4: return this.dip2;
      case 5: {
        const pct = (this.percentKey & 3) | ((this.percentKey & 0x0c) << 4);
        return pct | matrix;
      }
      default: return matrix;
    }
  }

  layoutInput(id: number, on: boolean): void {
    if (id >= M1ab.DIL_ID_BASE && id < M1ab.DIL_ID_BASE + 16) {
      const n = id - M1ab.DIL_ID_BASE;
      const mask = 1 << (n & 7);
      const raise = (v: number): number => (on ? v | mask : v & ~mask & 0xff);
      if (n < 8) this.dip1 = raise(this.dip1);
      else this.dip2 = raise(this.dip2);
      return;
    }
    if (id >= 0 && id < 8) {
      if (on) this.insertCoin(id);
      return;
    }
    const row = id >= 0 && id < 64 ? M1ab.MATRIX_TO_ROW[id >> 3] : -1;
    if (row < 0) return;
    const mask = 1 << (id & 7);
    if (on) this.inputs.switches[row] |= mask;
    else this.inputs.switches[row] &= ~mask & 0xff;
  }

  private static readonly MATRIX_TO_ROW = [3, 7, 1, 5, 2, 6, -1, -1];

  setLayoutSwitches(switches: LayoutSwitch[]): void {
    this.panel = switches
      .filter((s) => s.number >= 8 && s.number < 64 && M1ab.MATRIX_TO_ROW[s.number >> 3] >= 0)
      .map((s) => ({ number: s.number, label: s.label || `Switch ${s.number}` }));
    for (const s of switches) {
      const row = M1ab.MATRIX_TO_ROW[(s.number >> 3) & 7];
      if (row < 0) continue;
      const mask = 1 << (s.number & 7);
      if (s.closed) this.inputs.switches[row] |= mask;
      else this.inputs.switches[row] &= ~mask & 0xff;
    }
  }

  presetOperatorSwitch(number: number, made: boolean, label: string): void {
    if (number < 0 || number >= 64) return;
    const row = M1ab.MATRIX_TO_ROW[number >> 3];
    if (row < 0) return;
    const mask = 1 << (number & 7);
    if (made) this.inputs.switches[row] |= mask;
    else this.inputs.switches[row] &= ~mask & 0xff;
    this.declareSwitch(number, label);
  }

  declareSwitch(number: number | null, label: string): void {
    if (number === null || number < 8 || number >= 64) return;
    if (M1ab.MATRIX_TO_ROW[number >> 3] < 0) return;
    const drawn = this.panel.find((s) => s.number === number);
    if (!drawn) this.panel.push({ number, label });
    else if (drawn.label === String(number) || drawn.label === `Switch ${number}`) drawn.label = label;
  }

  private panel: { number: number; label: string }[] = [];

  get switchPanel(): CabinetSwitch[] {
    const rows: CabinetSwitch[] = this.panel.map((s) => {
      const row = M1ab.MATRIX_TO_ROW[s.number >> 3];
      return { id: s.number, label: s.label, on: (this.inputs.switches[row] & (1 << (s.number & 7))) !== 0 };
    });
    for (let i = 0; i < 16; i++) {
      const bank = i < 8 ? this.dip1 : this.dip2;
      rows.push({
        id: M1ab.DIL_ID_BASE + i,
        label: dilSwitchLabel(`DIL ${(i & 7) + 1} Bank ${i < 8 ? 1 : 2}`, this.dilLabels?.[i]),
        on: (bank & (1 << (i & 7))) !== 0,
        group: 'DIL switches',
        option: true,
        bootOnly: true,
      });
    }
    return rows;
  }

  private dilLabels: readonly string[] | null = null;
  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  private static readonly DIL_ID_BASE = 64;

  insertCoin(bit: number): void {
    if (this.coinCycles > 0) return;
    if (bit >= M1ab.NOTE_LINE && bit < M1ab.NOTE_LINE + 0x100) {
      this.insertCoinNote(bit - M1ab.NOTE_LINE);
      return;
    }
    if (lockoutRefuses(this.lockoutWiring, this.lockouts, 1 << (bit & 7))) { this.coinsRefused++; return; }
    const taken = this.programCoinOn(bit & 7);
    if (taken === 'none') { this.coinsRefused++; return; }
    this.coinMask = 1 << (bit & 7);
    this.coinCycles = M1ab.COIN_DWELL;
    this.inputs.switches[3] |= this.coinMask;
    this.bookCoinLine(bit & 7, taken);
  }

  private programCoinOn(line: number): M1abLineCoin {
    const t = this.readCoinTable();
    return 'refused' in t ? null : t.coins[line] ?? 'none';
  }

  private bookCoinLine(line: number, taken: M1abLineCoin): void {
    if (this.wiring) { this.bookWiredCoin(line, taken); return; }
    this.bookProgramCoin(line, taken);
  }

  private bookProgramCoin(line: number, taken: M1abLineCoin): void {
    if (taken === 'none') return;
    if (taken === null) {
      noteBoardDefault(this, {
        axis: 'coin',
        text: 'the program\'s coin descriptors were not read - a coin books the board\'s price for its line',
        ifWrong: 'A coin the program values differently, or does not take, books the wrong money.',
      });
      const pence = this.coinLinePence[line];
      if (pence === null || pence === undefined) return;
      if (line === M1ab.TOKEN_LINE) this.cashLedger.tokenInPence += pence;
      else this.cashLedger.inPence += pence;
      return;
    }
    if (taken.token) this.cashLedger.tokenInPence += taken.pence;
    else this.cashLedger.inPence += taken.pence;
  }
  get coinBusy(): boolean { return this.coinCycles > 0; }

  private wiring: {
    coins: Map<number, SlotCoin>;
    conflicts: number[];
    check: MeterUnitCheck;
    checked: Set<number> | null;
  } | null = null;

  private wiringState: { key: string; now: number; check: MeterCheckState } = M1ab.freshWiringState('');

  private static freshWiringState(key: string): { key: string; now: number; check: MeterCheckState } {
    return { key, now: 0, check: meterCheckState() };
  }

  private static readonly CASH_IN_METER = 0;
  private static readonly METER_UNIT_PENCE = 10;
  private static readonly WIRING_SLACK = 5;
  private static bankedLines(t: M1abCoinRead): number[] {
    const out: number[] = [];
    t.coins.forEach((c, line) => { if (c && c !== 'none' && !c.token && c.pence % M1ab.METER_UNIT_PENCE !== 0) out.push(line); });
    return out;
  }
  private static readonly WIRING_QUIET = 2 * CPU_CLOCK;

  setCoinWiring(w: CoinWiring): void {
    const { coins, conflicts } = linesOf(w);
    const t = this.readCoinTable();
    this.wiringState = wiringStateFor(this.wiringState, this.wiring !== null, wiringKey(w), M1ab.freshWiringState);
    this.wiring = {
      coins,
      conflicts,
      check: new MeterUnitCheck(M1ab.METER_UNIT_PENCE, M1ab.WIRING_SLACK, M1ab.WIRING_QUIET, this.wiringState.check),
      checked: 'refused' in t ? null : new Set([...t.cashMetered, ...M1ab.bankedLines(t)]),
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

  private checks(line: number, pence: number | null): boolean {
    const set = this.wiring!.checked;
    if (set) return set.has(line);
    return line !== M1ab.TOKEN_LINE && (pence === null || pence >= M1ab.METER_UNIT_PENCE);
  }

  private bookWiredCoin(line: number, taken: M1abLineCoin): void {
    const w = this.wiring!;
    const tell = (pence: number | null): void => {
      if (this.checks(line, pence)) w.check.coin(pence, this.wiringState.now);
    };
    if (!this.booksMoney || w.conflicts.includes(line)) { tell(null); return; }
    const c = w.coins.get(line);
    if (c === undefined) {
      this.bookProgramCoin(line, taken);
      tell(taken === null ? this.coinLinePence[line] ?? null : taken === 'none' ? null : taken.pence);
      return;
    }
    if (typeof c === 'number') { this.cashLedger.inPence += c; tell(c); return; }
    if (c.token === null) { this.cashLedger.unpricedTokenIn++; tell(null); return; }
    this.cashLedger.tokenInPence += c.token;
    tell(c.token);
  }

  private tickWiring(cycles: number): void {
    const s = this.wiringState;
    s.now += cycles;
    this.wiring!.check.tick(s.now);
  }

  private coinSlots: { line: number; token: boolean }[] = [];

  setLayoutCoins(list: readonly DeclaredCoin[]): void {
    const out = new Map<number, boolean>();
    for (const c of list) {
      if (c.pence !== null) continue;
      if (c.named?.name.startsWith('ccTalk')) continue;
      if (c.note !== null && c.note < 7) continue;
      const mask = coinRowPattern(c, M1ab.COIN_ROW);
      if (mask === undefined || mask === 0 || (mask & (mask - 1)) !== 0) continue;
      const line = 31 - Math.clz32(mask);
      out.set(line, (out.get(line) ?? false) || c.token);
    }
    this.coinSlots = [...out].sort((a, b) => a[0] - b[0]).map(([line, token]) => ({ line, token }));
  }

  private static readonly COIN_ROW = 0;

  get unnamedCoinLines(): readonly number[] {
    return this.coinSlots.map((s) => s.line);
  }

  private coinTableCache: { rom: Uint8Array; t: M1abCoinRead | { refused: string } } | null = null;
  private readCoinTable(): M1abCoinRead | { refused: string } {
    if (this.coinTableCache?.rom !== this.rom) this.coinTableCache = { rom: this.rom, t: readM1abCoinTable(this.rom) };
    return this.coinTableCache.t;
  }

  get coinLineTable(): CoinLineTable | null {
    const t = this.readCoinTable();
    if ('refused' in t) return null;
    const tokens = new Set(this.coinSlots.filter((s) => s.token).map((s) => s.line));
    return { ...t.table, lines: t.table.lines.map((l) => (tokens.has(l.line) ? { ...l, token: true } : l)) };
  }

  get coinLineTableRefusal(): string | null {
    const t = this.readCoinTable();
    return 'refused' in t ? t.refused : null;
  }

  static readonly NOTE_LINE = 0x200;

  static coinTransform(raw: number, binary: boolean): number {
    return (binary ? 0x40 : 0)
      | ((raw & 8) >> 3) | ((raw & 4) >> 1) | ((raw & 2) << 1) | ((raw & 1) << 3)
      | (raw & 0x10);
  }

  private binaryMech = false;

  setCoinMech(mech: string | null): void {
    this.binaryMech = mech === 'Binary';
  }

  coinNotePattern(note: number): number | undefined {
    const raw = COIN_RAW[note];
    if (raw === undefined) return undefined;
    if (raw & 0x100) return ((raw & 0x78) >> 3) === 0 ? 1 << (raw & 7) : undefined;
    const v = note < 7 ? M1ab.coinTransform(raw, this.binaryMech) : raw & 0xff;
    return v || undefined;
  }

  private cabinetNotes = new Map<number, { label: string; pence: number | null; token: boolean }>();

  setCabinetCoinNotes(notes: readonly { note: number; label: string; pence: number | null; token: boolean }[]): void {
    for (const n of notes) {
      if (n.note === 0x47 || (n.note >= 0x0f && n.note <= 0x16) || n.note === 0x40) continue;
      if (this.coinNotePattern(n.note) === undefined) continue;
      this.cabinetNotes.set(n.note, { label: n.label, pence: n.pence, token: n.token });
    }
  }

  get hasTransformedCoinSlot(): boolean {
    for (const note of this.cabinetNotes.keys()) if (note < 7) return true;
    return false;
  }

  private insertCoinNote(note: number): void {
    const pattern = this.coinNotePattern(note);
    if (pattern === undefined) return;
    if (lockoutRefuses(this.lockoutWiring, this.lockouts, pattern & 0x1f)) { this.coinsRefused++; return; }
    const single = pattern & 0x1f;
    const taken = single !== 0 && (single & (single - 1)) === 0 ? this.programCoinOn(31 - Math.clz32(single)) : null;
    if (taken === 'none') { this.coinsRefused++; return; }
    this.coinMask = pattern;
    this.coinCycles = M1ab.COIN_DWELL;
    this.inputs.switches[3] |= pattern;
    const lines = pattern & 0x1f;
    if (lines !== 0 && (lines & (lines - 1)) === 0) {
      this.bookCoinLine(31 - Math.clz32(lines), taken);
      return;
    }
    const slot = this.cabinetNotes.get(note);
    if (this.wiring) {
      this.wiring.check.coin(slot && !slot.token && slot.pence !== null && this.booksMoney ? slot.pence : undefined, this.wiringState.now);
      if (!this.booksMoney) return;
    }
    if (!slot || slot.pence === null) return;
    if (slot.token) this.cashLedger.tokenInPence += slot.pence;
    else this.cashLedger.inPence += slot.pence;
  }

  get coinChutes(): readonly CoinChute[] | undefined {
    if (this.cabinetNotes.size === 0) return undefined;
    const lineLabel = ['10p', '20p', '50p', '£1', '20p token'];
    const out: CoinChute[] = lineLabel.map((label, bit) => ({
      label, bit, pence: this.coinLinePence[bit], token: bit === M1ab.TOKEN_LINE,
    }));
    for (const [note, s] of this.cabinetNotes) {
      out.push({ label: s.label, bit: M1ab.NOTE_LINE + note, pence: s.pence, token: s.token, note });
    }
    return out;
  }

  private static readonly COIN_DWELL = Math.floor(CPU_CLOCK * 0.1);
  private coinCycles = 0;
  private coinMask = 0;

  readonly dataPak = new DataPak(CPU_CLOCK);
  private dataPakType = 0;
  private dataPakOut: number[] = [];
  private dataPakWait = 0;
  private dataPakIn: { wait: number; b: number }[] = [];
  private static readonly DATAPAK_TURNAROUND = 50_000;

  fitDataPak(type: number): void {
    this.dataPakType = type;
  }

  private dongle: MaygayDongle | null = null;

  fitDongle(key: number): void {
    this.dongle = new MaygayDongle(key & 0xff);
  }

  private onDataPakTx(b: number): void {
    if (this.dongle) {
      const answer = this.dongle.transmit(b, this.cpu.cycles);
      if (answer !== null) {
        const charCycles = Math.ceil(this.duart.characterTicks(0) * CPU_CLOCK / DUART_CLOCK);
        this.dataPakIn.push({ wait: charCycles, b: answer });
        b = answer;
      }
    }
    if (this.dataPakType === 0) return;
    const reply = this.dataPak.receive(b, this.cpu.cycles);
    if (!reply || this.dataPakType !== 1) return;
    if (this.dataPakOut.length === 0) this.dataPakWait = M1ab.DATAPAK_TURNAROUND;
    this.dataPakOut.push(...reply);
  }

  private tickDataPak(cycles: number): void {
    if (!this.dataPakOut.length && !this.dataPakIn.length) return;
    let span = cycles;
    while (this.dataPakIn.length) {
      const head = this.dataPakIn[0];
      head.wait -= span;
      span = 0;
      if (head.wait > 0 || this.duart.rxSpace(0) === 0) break;
      this.duart.receive(0, head.b);
      this.dataPakIn.shift();
      if (this.dataPakIn.length) this.dataPakIn[0].wait += head.wait;
    }
    if (this.dataPakOut.length) {
      this.dataPakWait -= cycles;
      while (this.dataPakOut.length && this.dataPakWait <= 0) {
        const charCycles = Math.ceil(this.duart.characterTicks(0) * CPU_CLOCK / DUART_CLOCK);
        this.dataPakIn.push({ wait: charCycles + this.dataPakWait, b: this.dataPakOut.shift()! });
        this.dataPakWait += M1ab.DATAPAK_TURNAROUND;
      }
    }
  }

  fitDotMatrix(roms: Uint8Array | readonly Uint8Array[]): void {
    const dot = new MaygayDot();
    dot.loadRom(roms instanceof Uint8Array ? [roms] : roms);
    dot.onTransmit = (v) => this.duart.receive(1, v);
    dot.reset();
    this.dot = dot;
  }

  panelBytes(): Uint8Array | undefined {
    return this.dot?.frame;
  }

  restoredStateFault(): string | null {
    const pc = this.cpu.pc & 0xffff;
    if (pc >= RAM_SIZE && pc < 0x2800) {
      return 'the saved state was taken from a machine that had already stopped'
        + ` (its processor was reading the peripherals at $${pc.toString(16).padStart(4, '0')},`
        + ' which is not program)';
    }
    return null;
  }

  powerCycle(): void {
    this.reset();
  }

  reset(): void {
    this.bank = 0;
    this.powerFail = false;
    this.scanCycles = 0;
    this.lampStrobe = 0;
    this.lampHistory.reset();
    this.opLamps.reset();
    this.lamps.set(this.opLamps.shown, M1ab.OP_LAMPS);
    this.pbLamps.reset();
    this.lamps.set(this.pbLamps.shown, M1ab.PB_LAMPS);
    this.pbOut = 0;
    this.latchLamp.reset();
    this.lamps[M1ab.LATCH_LAMP] = this.latchLamp.shown[0];
    this.latch.fill(0);
    this.meters = 0;
    this.meterBank.reset();
    this.lockouts = 0;
    this.okiControl = 1;
    this.okiPollCount = 0;
    this.coinCycles = 0;
    this.coinMask = 0;
    this.hopper.reset();
    this.hopperPaidBooked = 0;
    this.mainsCycles = 0;
    this.duartFrac = 0;
    this.triacs = 0;
    this.vfd.reset();
    this.duart.reset();
    this.dot?.reset();
    this.dataPak.reset();
    this.dataPakOut = [];
    this.dataPakWait = 0;
    this.dataPakIn = [];
    this.pia.reset();
    this.kbd.reset();
    this.kbd2.reset();
    this.ay.reset();
    this.opll.reset();
    this.oki.reset();
    this.okiCtl.reset();
    this.upd.reset();
    this.necBusy = false;
    this.updateOptics();
    this.cpu.reset();
  }

  step(): number {
    const cycles = this.cpu.step();

    const confirmed = this.meterBank.advance(1, METER_TICK_INSTRUCTIONS);
    if (confirmed) for (let i = 0; i < 8; i++) if (confirmed & (1 << i)) this.meterConfirmed(i);

    this.scanCycles += cycles;
    const scanPeriod = Math.floor(CPU_CLOCK / SCAN_HZ);
    while (this.scanCycles >= scanPeriod) {
      this.scanCycles -= scanPeriod;
      this.kbd.scan();
      this.kbd2.scan();
    }

    if (this.coinCycles > 0 && (this.coinCycles -= cycles) <= 0) {
      this.inputs.switches[3] &= ~this.coinMask & 0xff;
      this.coinCycles = 0;
    }
    if (this.wiring) this.tickWiring(cycles);

    this.mainsCycles += cycles;
    if (this.mainsCycles >= M1ab.MAINS_PERIOD) {
      this.mainsCycles %= M1ab.MAINS_PERIOD;
      if (this.latch[LATCH_NMIEN] !== 0) {
        this.cpu.setNMI(true);
        this.cpu.setNMI(false);
      }
    }

    this.hopper.tick(cycles);
    if (this.hopper.paid > this.hopperPaidBooked) {
      const fresh = this.hopper.paid - this.hopperPaidBooked;
      if (!this.booksMoney) {  }
      else if (this.hopperCoinPence === null) this.cashLedger.unpricedOut += fresh;
      else this.cashLedger.outPence += fresh * this.hopperCoinPence;
      this.hopperPaidBooked = this.hopper.paid;
    }

    this.duartFrac += cycles * DUART_CLOCK;
    const x1 = Math.floor(this.duartFrac / CPU_CLOCK);
    this.duartFrac -= x1 * CPU_CLOCK;
    this.duart.tick(x1);
    this.dot?.run(cycles, CPU_CLOCK);
    this.tickDataPak(cycles);
    this.ay.tick(cycles, CPU_CLOCK);
    this.opll.tick(cycles, CPU_CLOCK);
    if (this.necFitted) this.upd.tick(cycles, CPU_CLOCK);
    else this.oki.tick(cycles, CPU_CLOCK);
    this.pollOki();
    return cycles;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }
}
