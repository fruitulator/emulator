import { HD6303Y } from '../cpu/m6303';
import type { Bus } from '../cpu/bus';
import { Pia6821 } from '../hw/pia6821';
import { SwitchedLamps } from '../hw/switchedlamps';
import { OneBitSpeaker } from '../hw/speaker';
import { AY_RATE } from '../hw/ay8910';
import { BASE_BOARD_BASS_FREQ } from '../hw/blipleak';
import { V20Reels } from './v20reels';
import { placeRomFlat } from './pairplacer';
import { v20PiaWrite } from './mpu3';
import { StrayCounter } from './strayaccess';
import { COIN_RAW } from './coinraw';
import type { AudioSource, CabinetSwitch, CashLedger, Machine } from './machine';
import { newCashLedger } from './machine';
import type { SlideEffect } from '../layout/fmlconfig';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import type { ReelGeometry } from './layoutreels';
import type { Reel } from '../hw/reel';

export const MPU2_CLOCK = 1_000_000;
const REEL_COUNT = 3;
export const MPU2_REEL_ADJUST = 7;
const mpu2OpticWindow = (): [number, number] => [4, 8];
const REEL_PATTERN = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
const NMI_PERIOD = 10000;
const COIN_WINDOW = 9000;
const COIN_INTEGRATOR_TOP = 15000;
const REEL0_SETTLE = 0x1e;
const TRIAC_CONFIRM_TICKS = 6;
const TRIAC_LINES = 14;
export const MPU2_DEFAULT_RELAY = 3;
const LAMP_COUNT = 0x6c;
const COIN_ROW = 2;
const COIN_HOLD_ROW = Math.round(0.1 * MPU2_CLOCK);
const COIN_HOLD_LINE = Math.round(0.07 * MPU2_CLOCK);
const COIN_GAP = Math.round(0.05 * MPU2_CLOCK);

export const enum Mpu2ReelType { Solenoid = 0, Stepper = 1 }

export class Mpu2 implements Bus, Machine {
  static readonly snapshotConfig: readonly string[] = ['switches', 'slidePence', 'triacInRaw', 'triacOutRaw'];

  readonly clockHz = MPU2_CLOCK;
  readonly cpu: HD6303Y;
  readonly display = null;

  readonly mem = new Uint8Array(0x10000);

  readonly pia: readonly [Pia6821, Pia6821, Pia6821, Pia6821];

  readonly speaker = new OneBitSpeaker(MPU2_CLOCK, AY_RATE, { bassFreq: BASE_BOARD_BASS_FREQ });
  get audioSource(): AudioSource { return this.speaker; }

  readonly lampStore = new SwitchedLamps(LAMP_COUNT);
  get lamps(): Uint8Array { return this.lampStore.shown; }

  private readonly reelBank = new V20Reels(REEL_COUNT, mpu2OpticWindow);
  get reels(): readonly Reel[] { return this.reelBank.reels; }
  reelType: Mpu2ReelType = Mpu2ReelType.Stepper;

  readonly matrix = new Uint8Array(8);
  private switches: LayoutSwitch[] = [];

  relayTriac = MPU2_DEFAULT_RELAY;
  private relay = 0;

  private triacWord = 0;
  private readonly triacCount = new Int32Array(TRIAC_LINES);
  readonly triacPulses = new Uint32Array(TRIAC_LINES);
  get triacLevels(): number { return this.triacWord; }
  private slidePence: SlideEffect[] = new Array(16).fill(null);
  private triacInRaw: number[] = [];
  private triacOutRaw: number[] = [];
  private readonly gridTotals = { in: 0, out: 0 };
  get meterTotals(): { readonly in: number; readonly out: number } { return this.gridTotals; }
  readonly cashLedger: CashLedger = newCashLedger();
  get slidesPriced(): boolean { return this.slidePence.some((p) => p !== null); }

  solenoidDir = 0;
  private reelSelect = 0;
  private reel0Nibble = 0;
  private reel0Settle = 0;

  private nmiCount = 0;
  private triacTick = 0;
  private windowClosed = false;
  private windowCount = 0;
  private coinIntegrator = 0;
  private coinFlag = false;

  private coinRow = 0;
  private coinMask = 0;
  private coinTimer = 0;

  readonly strays = new StrayCounter();

  constructor(prog: readonly Uint8Array[]) {
    this.cpu = new HD6303Y(this, 'm6800');
    this.pia = [
      new Pia6821({ readA: () => this.matrix[1] }),
      new Pia6821({ readA: () => this.piaBPortA() }),
      new Pia6821({ readA: () => (this.matrix[3] << 6) & 0xff }),
      new Pia6821({ readA: () => this.matrix[0] }),
    ];
    this.loadRom(prog);
  }

  static readonly ROM_COUNTS: readonly number[] = [2, 3];

  loadRom(files: readonly Uint8Array[]): void {
    this.mem.fill(0);
    if (files.length === 3) {
      const { image } = placeRomFlat(files, { max: 0x10000, reverse: true });
      this.mem.set(image);
    } else if (files.length === 2) {
      this.mem.set(files[0].subarray(0, 0x800), 0xe800);
      this.mem.set(files[1].subarray(0, 0x800), 0xf000);
      this.mem.set(files[1].subarray(0, 0x800), 0xf800);
    }
  }

  batteryRam(): Uint8Array | null { return null; }

  setReelGeometry(geo: readonly ReelGeometry[]): void { this.reelBank.setGeometry(geo); }
  get reelStandIns(): readonly number[] { return this.reelBank.standIns; }
  setReelPosition(i: number, pos: number): void { this.reelBank.setPosition(i, pos); }

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

  get switchPanel(): CabinetSwitch[] {
    return this.switches.map((s) => ({
      id: s.number, label: s.label,
      on: s.number >> 3 < this.matrix.length && ((this.matrix[s.number >> 3] >> (s.number & 7)) & 1) === 1,
    }));
  }

  setSlidePence(slides: readonly SlideEffect[]): void {
    for (let i = 0; i < 16; i++) this.slidePence[i] = slides[i] ?? null;
  }

  setTriacMoney(inMult: readonly number[], outMult: readonly number[]): void {
    this.triacInRaw = [...inMult];
    this.triacOutRaw = [...outMult];
  }

  layoutInput(id: number, on: boolean): void {
    if (id < 0 || id >= this.matrix.length * 8) return;
    if (on) this.matrix[id >> 3] |= 1 << (id & 7);
    else this.matrix[id >> 3] &= ~(1 << (id & 7));
  }

  layoutLamp(n: number): boolean { return n >= 0 && n < LAMP_COUNT && this.lamps[n] !== 0; }
  layoutLampLevel(n: number): number { return n >= 0 && n < LAMP_COUNT ? this.lamps[n] : 0; }

  powerCycle(): void { this.reset(); }

  reset(): void {
    for (const p of this.pia) p.reset();
    this.pia[2].setCA1(true);
    this.pia[2].setCB1(false);
    this.pia[3].setCA1(false);
    this.pia[3].setCB1(false);
    this.triacWord = 0;
    this.triacCount.fill(0);
    this.relay = 0;
    this.solenoidDir = 0;
    this.reelSelect = 0;
    this.reel0Settle = 0;
    this.triacTick = 0;
    this.windowClosed = false;
    this.windowCount = 0;
    this.coinIntegrator = 0;
    this.coinFlag = false;
    this.coinTimer = 0;
    this.coinMask = 0;
    this.speaker.reset();
    this.lampsAB();
    this.lampsCtl();
    this.lampsC();
    this.lampStore.writeAt(0x48, 16, 0);
    this.cpu.reset();
    this.cpu.irq1Enabled = true;
  }

  step(): number {
    const c = this.cpu.step();
    this.speaker.tick(c);
    this.slice(c);
    const [a, b] = this.pia;
    this.cpu.setIRQ1(a.irqA() || a.irqB() || b.irqA() || b.irqB());
    return c;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  private slice(c: number): void {
    this.triacTick += c;
    if (this.triacTick > 9999) {
      this.triacTick -= NMI_PERIOD;
      if (this.tickTriacs()) this.lampStore.writeAt(0x48, 16, this.triacWord);
    }
    const coins = this.matrix[COIN_ROW] & 0xf;
    if (coins === 0) {
      if (this.coinIntegrator < COIN_INTEGRATOR_TOP) {
        this.coinIntegrator += c;
        if (this.coinIntegrator >= COIN_INTEGRATOR_TOP) {
          this.coinIntegrator = COIN_INTEGRATOR_TOP;
          this.coinFlag = false;
          this.pia[0].setCA1(false);
          this.pia[0].setCB1(false);
          this.pia[1].setCA1(false);
          this.pia[1].setCB1(false);
        }
      }
    } else if (!this.windowClosed) {
      this.coinIntegrator -= 3 * c;
      if (this.coinIntegrator < 1) {
        this.coinIntegrator = 0;
        if (!this.coinFlag) {
          this.coinFlag = true;
          if (coins & 1) this.pia[0].setCA1(true);
          if (coins & 2) this.pia[0].setCB1(true);
          if (coins & 4) this.pia[1].setCA1(true);
          if (coins & 8) this.pia[1].setCB1(true);
        }
      }
    } else {
      this.coinIntegrator += c;
    }
    if (this.reel0Settle !== 0) {
      this.reel0Settle = (this.reel0Settle - c) & 0xff;
      if (this.reel0Settle === 0) {
        if (this.reelType === Mpu2ReelType.Stepper) {
          this.reelBank.step(0, REEL_PATTERN[this.reel0Nibble & 0xf]);
        } else {
          this.lampStore.writeAt(0x68, 4, this.reel0Nibble);
        }
      }
    }
    if (this.windowCount > 0) {
      this.windowCount -= c;
      if (this.windowCount < 1) {
        this.windowClosed = true;
        this.windowCount = 0;
      }
    }
    this.nmiCount -= c;
    if (this.nmiCount < 1) {
      this.cpu.setNMI(true);
      this.cpu.setNMI(false);
      this.nmiCount += NMI_PERIOD;
      this.windowClosed = false;
      this.windowCount = COIN_WINDOW;
    }
    if (this.coinTimer > 0) {
      this.coinTimer -= c;
      if (this.coinTimer <= COIN_GAP) this.matrix[this.coinRow] &= ~this.coinMask;
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
  }

  read8(addr: number): number {
    addr &= 0xffff;
    switch (addr & 0x7800) {
      case 0x0000: return this.mem[addr & 0x7ff];
      case 0x0800: case 0x2800: case 0x4800: return this.mem[0xe800 + (addr & 0x7ff)];
      case 0x1000: case 0x3000: case 0x7000: return this.mem[0xf000 + (addr & 0x7ff)];
      case 0x1800: case 0x3800: case 0x7800: return this.mem[0xf800 + (addr & 0x7ff)];
      case 0x2000: return this.pia[addr & 4 ? 1 : 0].read(addr & 3);
      case 0x4000: return this.pia[addr & 8 ? 3 : 2].read(addr & 3);
      default: return 0;
    }
  }

  write8(addr: number, v: number): void {
    addr &= 0xffff;
    v &= 0xff;
    if (addr < 0x80) { this.mem[addr] = v; return; }
    switch (addr & 0xe000) {
      case 0x2000: if (addr & 4) this.writeB(addr & 3, v); else this.writeA(addr & 3, v); return;
      case 0x4000: if (addr & 8) this.writeD(addr & 3, v); else this.writeC(addr & 3, v); return;
      default: this.strays.hit(addr); return;
    }
  }

  private piaBPortA(): number {
    let low = 0;
    if (this.reelType === Mpu2ReelType.Stepper) low = this.reelBank.optos;
    else if (this.reelSelect > 0 && this.reelSelect <= REEL_COUNT) {
      const r = this.reelBank.state[this.reelSelect - 1];
      const reel = this.reelBank.reels[this.reelSelect - 1];
      if (r && reel) {
        const per = Math.floor(r.steps / Math.max(1, reel.symbols));
        low = Math.floor(((r.steps - r.pos) % r.steps) / Math.max(1, per)) + 1;
      }
    }
    return (low & 0x1f) | (this.coinFlag ? 0 : 0x80);
  }

  private writeA(reg: number, v: number): void {
    const p = this.pia[0];
    const w = v20PiaWrite(p, reg, v);
    if (w.changedB) {
      const b = p.outB();
      const word = b & 0x80 ? (b & 0x7f) << 7 : b & 0x7f;
      this.setTriacs(word);
    }
    if (w.ca2) this.speaker.write(0, p.ca2() ? 1 : 0);
    if (w.ca2 || w.cb2) this.lampsCtl();
  }

  private writeB(reg: number, v: number): void {
    const p = this.pia[1];
    const w = v20PiaWrite(p, reg, v);
    if (w.changedA & 0x60) this.reelSelect = (p.outA() & 0x60) >> 5;
    if (w.changedB) this.lampsAB();
    if (w.ca2 || w.cb2) this.lampsCtl();
  }

  private writeC(reg: number, v: number): void {
    const p = this.pia[2];
    const w = v20PiaWrite(p, reg, v);
    if (w.changedA) this.lampStore.writeAt(0x58, 8, p.outA());
    if (w.changedB) this.lampsC();
    if (w.ca2 || w.cb2) this.reel0Changed();
  }

  private writeD(reg: number, v: number): void {
    const p = this.pia[3];
    const w = v20PiaWrite(p, reg, v);
    if (w.changedB) {
      const b = p.outB();
      if (this.reelType === Mpu2ReelType.Stepper) {
        this.reelBank.step(1, REEL_PATTERN[b & 0xf]);
        this.reelBank.step(2, REEL_PATTERN[b >> 4]);
      } else {
        this.lampStore.writeAt(0x60, 8, b);
      }
    }
    if (w.ca2 || w.cb2) this.reel0Changed();
  }

  private reel0Changed(): void {
    const [, , c, d] = this.pia;
    this.reel0Nibble = (c.cb2() ? 2 : 0) | (c.ca2() ? 1 : 0) | (d.ca2() ? 4 : 0) | (d.cb2() ? 8 : 0);
    this.reel0Settle = REEL0_SETTLE;
  }

  private relayed(bits: number, n: number, first: number, off: number, on: number): void {
    this.lampStore.writeAt(first, n, bits);
    this.lampStore.writeAt(off, n, this.relay ? 0 : bits);
    this.lampStore.writeAt(on, n, this.relay ? bits : 0);
  }

  private lampsAB(): void { this.relayed(this.pia[1].outB(), 8, 0x00, 0x18, 0x30); }

  private lampsCtl(): void {
    const [a, b] = this.pia;
    const n = (a.cb2() ? 2 : 0) | (a.ca2() ? 1 : 0) | (b.ca2() ? 4 : 0) | (b.cb2() ? 8 : 0);
    this.relayed(n, 4, 0x08, 0x20, 0x38);
  }

  private lampsC(): void { this.relayed(this.pia[2].outB(), 8, 0x10, 0x28, 0x40); }

  private setTriacs(word: number): void {
    const changed = word ^ this.triacWord;
    if (!changed) return;
    if (word & changed & 1) this.solenoidDir = -1;
    else if (word & changed & 0x20) this.solenoidDir = 1;
    const rising = word & changed;
    this.triacWord = word;
    for (let i = 0; i < TRIAC_LINES; i++) {
      if (!(changed & (1 << i))) continue;
      this.triacCount[i] = this.triacCount[i] === 0 ? TRIAC_CONFIRM_TICKS : 0;
      if (rising & (1 << i)) {
        this.gridTotals.in += this.triacInRaw[i] ?? 0;
        this.gridTotals.out += this.triacOutRaw[i] ?? 0;
      }
    }
    const r = this.relayTriac;
    if (r > 0 && r <= TRIAC_LINES && changed & (1 << (r - 1))) {
      this.relay = word & (1 << (r - 1)) ? 1 : 0;
      this.lampsAB();
      this.lampsCtl();
      this.lampsC();
    }
  }

  private tickTriacs(): boolean {
    let fired = false;
    for (let i = 0; i < TRIAC_LINES; i++) {
      if (this.triacCount[i] === 0) continue;
      if (--this.triacCount[i] !== 0) continue;
      fired = true;
      if (!(this.triacWord & (1 << i))) continue;
      this.triacPulses[i]++;
      const p = this.slidePence[i];
      if (p === null || p === undefined) continue;
      if (typeof p === 'number') this.cashLedger.outPence += p;
      else if (p === 'token') this.cashLedger.unpricedTokenOut++;
      else this.cashLedger.unpricedOut++;
    }
    return fired;
  }

  insertCoin(id: number): void {
    if (this.coinTimer > 0) return;
    const raw = id >= 0x100 && id < 0x180 ? id : COIN_RAW[id];
    if (raw === undefined) return;
    if (raw & 0x100) {
      const row = (raw & 0x78) >> 3;
      if (row >= this.matrix.length) return;
      this.coinRow = row;
      this.coinMask = 1 << (raw & 7);
      this.coinTimer = COIN_HOLD_LINE + COIN_GAP;
    } else {
      this.coinRow = COIN_ROW;
      this.coinMask = raw & 0xff;
      if (!this.coinMask) return;
      this.coinTimer = COIN_HOLD_ROW + COIN_GAP;
    }
    this.matrix[this.coinRow] |= this.coinMask;
  }

  get coinBusy(): boolean { return this.coinTimer > 0; }

  get parts(): BoardPart[] {
    return [
      { id: 'cpu', label: 'CPU', part: 'MC6800 - 1 MHz', device: this.cpu, cpu: true },
      { id: 'ram', label: 'RAM', part: '128 bytes', device: this.mem },
      { id: 'rom', label: 'PROGRAM ROM', part: 'three 2K banks', device: this.mem },
      { id: 'pia1', label: 'PIA 1', part: 'MC6821 - buttons, triacs, sound', device: this.pia[0] },
      { id: 'pia2', label: 'PIA 2', part: 'MC6821 - optics, lamps', device: this.pia[1] },
      { id: 'pia3', label: 'PIA 3', part: 'MC6821 - lamps, reel 1', device: this.pia[2] },
      { id: 'pia4', label: 'PIA 4', part: 'MC6821 - buttons, reels 2 and 3', device: this.pia[3] },
      { id: 'lamps', label: 'LAMPS', part: 'direct, with a relay', device: this.lamps },
      { id: 'triacs', label: 'TRIACS', part: '14 lines', device: this.triacPulses },
      { id: 'switches', label: 'SWITCHES', part: '4 rows', device: this.matrix },
      { id: 'coins', label: 'COIN INPUTS', part: 'four PIA lines', modelled: true,
        note: 'Timed matrix makes on the line the acceptor names - not a mech.' },
      { id: 'reels', label: 'REELS', part: 'three steppers', device: this.reelBank.reels },
      { id: 'sound', label: 'SOUND', part: 'one-bit speaker', device: this.speaker },
    ];
  }
}
