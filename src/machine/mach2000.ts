import { HD6303Y } from '../cpu/m6303';
import type { Bus } from '../cpu/bus';
import { Hd6303yRegs } from '../hw/hd6303yregs';
import { Ay8910 } from '../hw/ay8910';
import { Mixer } from '../hw/mixer';
import { SwitchedLamps } from '../hw/switchedlamps';
import { MeterConfirm } from '../hw/meterconfirm';
import { Reel } from '../hw/reel';
import { placeRomFlat } from './pairplacer';
import { StrayCounter } from './strayaccess';
import { COIN_RAW } from './coinraw';
import type { AudioSource, CabinetSwitch, CashLedger, Machine, NamedCoin } from './machine';
import { newCashLedger } from './machine';
import { CoinBook, SlotCoins, coinOfNote, type BookedCoin } from './coinbook';
import type { SlideEffect } from '../layout/fmlconfig';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import type { ReelGeometry } from './layoutreels';

export const MACH2000_CLOCK = 1_000_000;
const METER_TICK_CALLS = 2000;
const IRQ2_PERIOD = 0xdac;
const REEL_TICK = 0x960;
const NMI_PERIOD = 0x1000;
const REEL_COUNT = 4;
export const MACH2000_REEL_ADJUST = 0;
const OPTIC_POS = 3;
const LAMP_COUNT = 0x80;
const TRIAC_LINES = 4;
export const MACH2000_COIN_ROW = 2;
const COIN_HOLD_ROW = Math.round(0.1 * MACH2000_CLOCK);
const COIN_HOLD_LINE = Math.round(0.07 * MACH2000_CLOCK);
const COIN_GAP = Math.round(0.005 * MACH2000_CLOCK);

interface CtlReel { pos: number; steps: number; remaining: number; dir: number; present: boolean }

export class Mach2000 implements Machine {
  static readonly snapshotConfig: readonly string[] = ['switches', 'nvram', 'meterInRaw', 'meterOutRaw', 'triacInRaw', 'triacOutRaw', 'now'];

  readonly clockHz = MACH2000_CLOCK;
  readonly cpu: HD6303Y;
  readonly slaveCpu: HD6303Y;
  readonly regs: Hd6303yRegs;
  readonly slaveRegs: Hd6303yRegs;
  readonly display = null;

  readonly rom = new Uint8Array(0x10000);
  readonly slaveRom = new Uint8Array(0x10000);
  readonly ram = new Uint8Array(0x800);
  readonly slaveRam = new Uint8Array(0x800);
  private nvram: Uint8Array | null = null;

  readonly ay1 = new Ay8910(MACH2000_CLOCK, 'ay8910');
  readonly ay2 = new Ay8910(MACH2000_CLOCK, 'ay8910');
  private readonly mixer = new Mixer([this.ay1, this.ay2]);
  get audioSource(): AudioSource { return this.mixer; }
  private ayData = 0;

  readonly lampStore = new SwitchedLamps(LAMP_COUNT, 0);
  get lamps(): Uint8Array { return this.lampStore.shown; }

  readonly meters = new MeterConfirm();
  readonly meterCounts = new Uint32Array(8);
  private meterWord = 0;
  private triacWord = 0;
  get triacLevels(): number { return this.triacWord; }
  readonly triacPulses = new Uint32Array(TRIAC_LINES);

  private readonly ctl: CtlReel[] = [];
  readonly reels: Reel[] = [];
  private optos = 0;

  private readonly pia = new Uint8Array(0x18);
  private lampCol = 0;
  private lampLo = 0;
  private lampHi = 0;
  private nmiEnabled = false;
  private nmiAcc = 0;

  readonly matrix = new Uint8Array(8);
  private switches: LayoutSwitch[] = [];
  private dip1 = 0;
  private dip2 = 0;

  private calls = 0;
  private irq2Acc = 0;
  private irq2Flag = false;
  private irq2Count = 0;
  private sense = 0;
  private irq1Mask = 0;
  private mainP6In = 0;
  private slaveP6In = 0;
  private mainP5In = 0;

  private pktActive = false;
  private pktNibbles = 0;
  private pktLeft = 0;
  private readonly pkt = new Uint8Array(0x14);
  private pktPtr = 0;
  private readonly reply = new Uint8Array(0x10);
  private replyPtr = 0;
  private replyLeft = 0;
  private reelAcc = 0;

  now: () => Date = () => new Date();
  private readonly hostNow = this.now;

  pinHostClock(at: Date | null): void {
    this.now = at ? () => new Date(at.getTime()) : this.hostNow;
  }
  private rtcCmd = 0;
  rtcInt = 0;
  private rtcLastSec = -1;

  readonly cashLedger: CashLedger = newCashLedger();
  private readonly book = new CoinBook(this.cashLedger, MACH2000_CLOCK);
  private readonly slots = new SlotCoins();
  private meterInRaw: number[] = [];
  private meterOutRaw: number[] = [];
  private triacInRaw: number[] = [];
  private triacOutRaw: number[] = [];
  private readonly gridTotals = { in: 0, out: 0 };
  get meterTotals(): { readonly in: number; readonly out: number } { return this.gridTotals; }

  private coinRow = 0;
  private coinMask = 0;
  private coinTimer = 0;
  private slaveDebt = 0;

  readonly strays = new StrayCounter();

  constructor() {
    const mainBus: Bus = { read8: (a) => this.mainRead(a), write8: (a, v) => this.mainWrite(a, v) };
    const slaveBus: Bus = { read8: (a) => this.slaveRead(a), write8: (a, v) => this.slaveWrite(a, v) };
    this.cpu = new HD6303Y(mainBus);
    this.slaveCpu = new HD6303Y(slaveBus);
    this.regs = new Hd6303yRegs({
      portRead: (p) => (p === 2 ? this.regs.port2 : p === 5 ? (this.regs.port5 | this.mainP5In) : this.mainP6In),
      portWrite: (p, v, changed) => this.mainPortWrite(p, v, changed),
    });
    this.slaveRegs = new Hd6303yRegs({
      portRead: (p) => (p === 2 ? this.switchColumn() : p === 5 ? (this.slaveRegs.port5 | 0xc0) : this.slaveP6In),
      portWrite: (p, v, changed) => this.slavePortWrite(p, v, changed),
      tdrWrite: (v) => { if (this.pktActive) this.reelCommand(v); },
      rdrRead: () => this.replyNibble(),
    });
    for (let i = 0; i < REEL_COUNT; i++) {
      this.ctl.push({ pos: 0, steps: 400, remaining: 0, dir: 1, present: false });
      this.reels.push(new Reel({ stepsPerRevolution: 400, symbols: 20 }));
    }
    this.reset();
  }

  loadRoms(main: readonly Uint8Array[], slave: readonly Uint8Array[]): void {
    this.rom.set(placeRomFlat(main, { max: 0x10000, reverse: true }).image);
    this.slaveRom.set(placeRomFlat(slave, { max: 0x10000, reverse: true }).image);
  }

  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, 0x940);
    this.applyNvram();
  }

  private applyNvram(): void {
    if (!this.nvram) return;
    this.regs.ram.fill(0);
    this.ram.fill(0);
    this.regs.ram.set(this.nvram.subarray(0, 0x140));
    this.ram.set(this.nvram.subarray(0x140, 0x940));
  }

  batteryRam(): Uint8Array {
    const out = new Uint8Array(0x940);
    out.set(this.regs.ram, 0);
    out.set(this.ram, 0x140);
    return out;
  }

  setDips(d1: number, d2: number): void { this.dip1 = d1 & 0xff; this.dip2 = d2 & 0xff; }

  setReelGeometry(geo: readonly ReelGeometry[]): void {
    for (const g of geo) {
      if (g.number < 0 || g.number >= REEL_COUNT) continue;
      const r = this.ctl[g.number];
      r.present = true;
      if (g.halfSteps > 0) r.steps = g.halfSteps;
      this.reels[g.number] = new Reel({ stepsPerRevolution: r.steps, symbols: g.stops > 0 ? g.stops : 20 });
      this.reels[g.number].position = r.pos;
    }
  }

  setReelPosition(i: number, pos: number): void {
    const r = this.ctl[i];
    if (!r) return;
    r.pos = ((pos % r.steps) + r.steps) % r.steps;
    this.reels[i].position = r.pos;
    this.updateOptos();
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

  get switchPanel(): CabinetSwitch[] {
    return this.switches.map((s) => ({
      id: s.number, label: s.label,
      on: s.number >> 3 < this.matrix.length && ((this.matrix[s.number >> 3] >> (s.number & 7)) & 1) === 1,
    }));
  }

  setSlides(slides: readonly SlideEffect[] | null): void { this.book.setSlides(slides); }
  get tokenPayoutLines(): readonly number[] { return this.book.tokenSlides; }
  namePayout(line: number, pence: number): void { this.book.payouts.name(line, pence); }
  setCoinSlots(lines: Iterable<readonly [number, BookedCoin]>): void { this.slots.setLines(lines); }
  get unnamedCoinLines(): readonly number[] { return this.slots.unnamed; }
  nameCoin(line: number, coin: NamedCoin): void { this.slots.name(line, coin); }
  setMeterMoney(map: {
    meterIn: readonly number[]; meterOut: readonly number[];
    triacIn: readonly number[]; triacOut: readonly number[];
  }): void {
    this.meterInRaw = [...map.meterIn];
    this.meterOutRaw = [...map.meterOut];
    this.triacInRaw = [...map.triacIn];
    this.triacOutRaw = [...map.triacOut];
  }

  layoutInput(id: number, on: boolean): void {
    if (id < 0 || id >= this.matrix.length * 8) return;
    if (on) this.matrix[id >> 3] |= 1 << (id & 7);
    else this.matrix[id >> 3] &= ~(1 << (id & 7));
  }

  layoutLamp(n: number): boolean { return n >= 0 && n < LAMP_COUNT && this.lamps[n] !== 0; }
  layoutLampLevel(n: number): number { return n >= 0 && n < LAMP_COUNT ? this.lamps[n] : 0; }

  private readonly dots = new Uint8Array(0xc0);
  get outputs(): { dots: Uint8Array } {
    const f = this.slaveRam.subarray(0x700, 0x800);
    this.dots.fill(0);
    for (let r = 0; r < 21; r++) {
      let idx = f[0xd4 - r];
      if (idx > 0x1e) idx = 0x14;
      if ((f[0xe0 + r] ^ 0xff) === 0) continue;
      for (let b = 0; b < 8; b++) this.dots[r * 8 + b] = b === 7 ? f[idx * 8 + b] & 0x0f : f[idx * 8 + b];
    }
    return { dots: this.dots };
  }

  powerCycle(): void {
    this.nvram = this.batteryRam();
    this.reset();
  }

  reset(): void {
    this.applyNvram();
    this.regs.reset();
    this.slaveRegs.reset();
    this.cpu.reset();
    this.slaveCpu.reset();
    this.calls = 0;
    this.ay1.reset();
    this.ay2.reset();
    this.meters.reset();
    this.irq2Acc = 0;
    this.irq2Flag = false;
    this.irq2Count = 0;
    this.sense = 0;
    this.irq1Mask = 0;
    this.meterWord = 0;
    this.pia.fill(0);
    this.nmiAcc = 0;
    this.nmiEnabled = false;
    this.pktActive = false;
    this.pktNibbles = 0;
    this.pktPtr = 0;
    this.replyLeft = 0;
    this.reelAcc = 0;
    this.slaveDebt = 0;
    this.coinTimer = 0;
    this.coinMask = 0;
    this.book.reset();
  }

  step(): number {
    let c = this.mainStep();
    this.slaveDebt += c;
    while (this.slaveDebt > 0) this.slaveDebt -= this.slaveStep();
    this.book.elapse(c);
    this.ay1.tick(c, MACH2000_CLOCK);
    this.ay2.tick(c, MACH2000_CLOCK);
    if (this.coinTimer > 0) {
      this.coinTimer -= c;
      if (this.coinTimer <= COIN_GAP) this.matrix[this.coinRow] &= ~this.coinMask;
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
    return c;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  private mainStep(): number {
    if (++this.calls % METER_TICK_CALLS === 0) this.confirmMeters(this.meters.tick());
    const c = this.cpu.step();
    this.regs.tick(c);
    this.irq2Acc += c;
    if (this.irq2Acc > IRQ2_PERIOD) {
      this.irq2Acc -= IRQ2_PERIOD;
      this.irq2Flag = true;
      this.irq2Count = (this.irq2Count + 1) & 0xff;
      if (this.irq2Count === 4 && (this.regs.port2 & 2)) { this.sense = 4; this.irq2Count = 0; }
      else this.sense = 0;
    }
    if ((this.matrix[4] ^ this.irq1Mask) & 0xf) this.regs.port5 &= ~1;
    else this.regs.port5 |= 1;
    let extra = 0;
    if (!this.cpu.irqMasked) {
      const r = this.regs;
      let vec = -1;
      if (!(r.port5 & 1) && (r.rp5cr & 1)) vec = 0xfff8;
      else if (r.oci) vec = 0xfff4;
      else if (r.cmi) vec = 0xffec;
      else if (r.toi) vec = 0xfff2;
      else if (this.irq2Flag && (r.rp5cr & 2)) { vec = 0xffea; this.irq2Flag = false; }
      else if (r.sci) vec = 0xfff0;
      if (vec >= 0) extra = this.cpu.takeInterrupt(vec);
    }
    return c + extra;
  }

  private slaveStep(): number {
    if (this.reelAcc > REEL_TICK) {
      this.reelAcc -= REEL_TICK;
      this.reelTick();
    }
    const c = this.slaveCpu.step();
    this.slaveRegs.tick(c);
    this.reelAcc += c;
    let extra = 0;
    let nmi = false;
    if (this.nmiEnabled) {
      this.nmiAcc += c;
      if (this.nmiAcc > NMI_PERIOD) { this.nmiAcc -= NMI_PERIOD; nmi = true; }
    }
    if (nmi) extra = this.slaveCpu.takeInterrupt(0xfffc);
    else if (!this.slaveCpu.irqMasked) {
      const r = this.slaveRegs;
      let vec = -1;
      if ((r.p6csr & 0xc0) === 0xc0) vec = 0xfff8;
      else if (r.oci) vec = 0xfff4;
      else if (r.cmi) vec = 0xffec;
      if (vec >= 0) extra = this.slaveCpu.takeInterrupt(vec);
    }
    return c + extra;
  }

  private mainRead(addr: number): number {
    addr &= 0xffff;
    if (this.regs.owns(addr)) return this.regs.read(addr);
    if (addr >= 0x30 && addr < 0x38) {
      switch (addr & 7) {
        case 0: return (this.sense | 0x80 | (this.meters.word === 0 ? 2 : 0) | 8) & 0xff;
        case 6: this.strays.hit(addr); return (this.matrix[4] | 0x80) & 0xff;
        case 7: this.strays.hit(addr); return 0;
        default: return 0;
      }
    }
    if (addr >= 0x200 && addr < 0x212) return this.rtcRead(addr - 0x200);
    if (addr >= 0x2000 && addr < 0x2800) return this.ram[addr - 0x2000];
    if (addr >= 0x8000) return this.rom[addr];
    return 0;
  }

  private mainWrite(addr: number, val: number): void {
    addr &= 0xffff;
    const v = val & 0xff;
    if (this.regs.owns(addr)) { this.regs.write(addr, v); return; }
    if (addr >= 0x30 && addr < 0x38) {
      switch (addr & 7) {
        case 1: this.setTriacs(v & 0xf); return;
        case 2:
          if ((v & 0xb) === 0xb || (v & 0xb) === 9) this.ayBus(this.ay1, (v & 2) !== 0);
          if ((v & 7) === 7 || (v & 7) === 5) this.ayBus(this.ay2, (v & 2) !== 0);
          return;
        case 3: this.ayData = v; return;
        case 5:
          if (v !== this.meterWord) { this.meterWord = v; this.meters.write(v); }
          return;
        case 7: this.irq1Mask = v & 0xf; return;
        default: return;
      }
    }
    if (addr >= 0x200 && addr < 0x212) {
      if (addr === 0x210) this.rtcInt = v;
      else if (addr === 0x211) this.rtcCmd = v;
      return;
    }
    if (addr >= 0x2000 && addr < 0x2800) this.ram[addr - 0x2000] = v;
  }

  private ayBus(ay: Ay8910, bc1: boolean): void {
    if (bc1) ay.selectAddress(this.ayData & 0xf);
    else ay.write(this.ayData);
  }

  private mainPortWrite(p: 2 | 5 | 6, v: number, changed: number): void {
    if (p === 2) {
      if ((changed & 2) && !(v & 2)) this.irq2Flag = false;
      if (v & changed & 1) { this.ay1.reset(); this.ay2.reset(); }
    } else if (p === 6) {
      this.slaveP6In = v;
      if ((this.regs.p6csr & 0x30) === 0x30 && (this.slaveRegs.p6csr & 8)) this.slaveRegs.p6csr |= 0x80;
    }
  }

  private rtcRead(reg: number): number {
    const d = this.now();
    switch (reg) {
      case 0: return Math.trunc(d.getMilliseconds() / 10);
      case 1: {
        const h = d.getHours();
        return this.rtcCmd & 4 ? h : (h % 12) | (h > 11 ? 0x80 : 0);
      }
      case 2: return d.getMinutes();
      case 3: return d.getSeconds();
      case 4: return d.getMonth() + 1;
      case 5: return d.getDate();
      case 6: return d.getFullYear() % 100;
      case 7: return (d.getDay() + 1 + 5) & 7;
      case 0x10: {
        if (d.getSeconds() !== this.rtcLastSec) { this.rtcLastSec = d.getSeconds(); return 8; }
        return 0;
      }
      default: return 0;
    }
  }

  private slaveRead(addr: number): number {
    addr &= 0xffff;
    if (this.slaveRegs.owns(addr)) return this.slaveRegs.read(addr);
    if (addr >= 0x30 && addr < 0x34) {
      this.pia[5] = this.optos;
      return this.piaRead(addr & 3);
    }
    if (addr >= 0x4000 && addr < 0x4800) return this.slaveRam[addr - 0x4000];
    if (addr >= 0x8000) return this.slaveRom[addr];
    return 0;
  }

  private slaveWrite(addr: number, val: number): void {
    addr &= 0xffff;
    const v = val & 0xff;
    if (this.slaveRegs.owns(addr)) { this.slaveRegs.write(addr, v); return; }
    if (addr >= 0x30 && addr < 0x34) { this.piaWrite(addr & 3, v); return; }
    if (addr >= 0x4000 && addr < 0x4800) this.slaveRam[addr - 0x4000] = v;
  }

  private switchColumn(): number {
    const c = this.lampCol;
    return (((this.matrix[2] >> c) & 1) << 7) | (((this.matrix[1] >> c) & 1) << 6)
      | (((this.matrix[0] >> c) & 1) << 5) | (((this.dip1 >> c) & 1) << 1) | ((this.dip2 >> c) & 1);
  }

  private slavePortWrite(p: 2 | 5 | 6, v: number, changed: number): void {
    if (p === 5) {
      if (changed & v & 4) this.lampHi = this.pia[2];
      if (changed & 0x20) {
        if (v & 0x20) this.mainP5In = 0x10;
        else { this.mainP5In = 0; this.regs.p6csr |= 0x80; }
      }
      if ((changed & 2) && !(v & 2)) {
        this.pktActive = true;
        this.pktNibbles = 0;
        this.pktPtr = 0;
        this.pktLeft = 0;
      }
    } else if (p === 6) this.mainP6In = v;
  }

  private piaRead(reg: number): number {
    const p = this.pia;
    switch (reg) {
      case 0: return p[0] & 4 ? ((p[2] & p[8]) | (~p[8] & p[4])) & 0xff : p[8];
      case 1: return p[0];
      case 2: return p[1] & 4 ? ((p[3] & p[9]) | (~p[9] & p[5])) & 0xff : p[9];
      default: return p[1];
    }
  }

  private piaWrite(reg: number, v: number): void {
    const p = this.pia;
    let chgB = 0;
    let ca2Changed = false;
    let cb2Changed = false;
    switch (reg) {
      case 0:
        if (p[0] & 4) p[2] = v; else p[8] = v;
        break;
      case 1:
        p[0] = (p[0] & 0xc0) | (v & 0x3f);
        if (!(v & 0x20)) {
          if (p[0xb] !== p[0xe]) ca2Changed = true;
          p[0xb] = p[0xe];
        } else if (v & 0x10) {
          const lvl = p[0] & 8 ? 1 : 0;
          if (p[0xb] !== lvl) ca2Changed = true;
          p[0xb] = lvl;
        }
        break;
      case 2:
        if (p[1] & 4) { chgB = (p[3] ^ v) & p[9]; p[3] = v; }
        else { chgB = (~p[9] & v & ~p[3]) | (~p[3] & p[9] & ~v); p[9] = v; }
        break;
      default:
        p[1] = (p[1] & 0xc0) | (v & 0x3f);
        if ((v & 0x20) && (v & 0x10)) {
          const lvl = p[1] & 8 ? 1 : 0;
          if (p[0xd] !== lvl) cb2Changed = true;
          p[0xd] = lvl;
        }
        break;
    }
    if (chgB & 0xff) {
      this.lampCol = (p[3] >> 4) & 7;
      if (chgB & p[3] & 0x80) this.lampLo = p[2];
    }
    if (ca2Changed && p[0xb] === 0) this.lampStore.writeAt(this.lampCol * 16, 16, (this.lampHi << 8) | this.lampLo);
    if (cb2Changed && p[0xd] === 0) this.nmiEnabled = true;
  }

  private updateOptos(): void {
    let o = 0;
    this.ctl.forEach((r, i) => { if (r.pos === OPTIC_POS) o |= 1 << i; });
    this.optos = o;
  }

  private reelTick(): void {
    this.ctl.forEach((r, i) => {
      if (r.remaining === 0) return;
      r.remaining--;
      r.pos = (r.pos + r.dir + r.steps) % r.steps;
      this.reels[i].position = r.pos;
      this.reels[i].travel += r.dir;
    });
    this.updateOptos();
  }

  private move(i: number, count: number, dir: number): void {
    const r = this.ctl[i];
    if (!r.present) return;
    r.remaining = count;
    r.dir = dir;
  }

  private reelCommand(b: number): void {
    if (this.pktNibbles & 1) {
      this.pkt[this.pktPtr] = (this.pkt[this.pktPtr] & 0x0f) | (b & 0xf0);
      this.pktPtr = Math.min(this.pktPtr + 1, this.pkt.length - 1);
      this.pktLeft--;
    } else {
      this.pkt[this.pktPtr] = b >> 4;
      if (this.pktNibbles === 0) this.pktLeft = (b >> 4) + 2;
    }
    this.pktNibbles++;
    if (this.pktLeft !== 0) return;
    this.pktActive = false;
    const n = this.pktNibbles >> 1;
    let sum = 0;
    for (let i = 0; i < n - 1; i++) sum = (sum + this.pkt[i]) & 0xff;
    if (sum === 0) sum = 0xff;
    if (sum !== this.pkt[n - 1]) return;
    const cmd = this.pkt[0];
    this.reply.fill(0);
    this.reply[0] = sum;
    this.reply[1] = (cmd & 0xf0) + 1;
    this.reply[3] = this.reply[1];
    this.replyPtr = 0;
    this.replyLeft = 8;
    this.pktNibbles = 0;
    switch (cmd >> 4) {
      case 1:
        for (let i = 0; i < 4; i++) {
          const a = this.pkt[1 + i];
          const count = ((a & 0xf) << 8) + this.pkt[5 + i];
          this.move(i, count * 2, a & 0x80 ? -1 : 1);
        }
        break;
      case 4:
        for (let i = 0; i < 4; i++) this.reply[2 + i] = ((this.ctl[i].pos >> 1) + 3) & 0xff;
        this.replyLeft = 0xe;
        break;
      case 8:
        for (let i = 0; i < 4; i++) {
          const a = this.pkt[1 + i];
          const target = ((a << 8) + this.pkt[5 + i]) >>> 0;
          const here = (this.ctl[i].pos >> 1) + 3;
          if (a & 0x80) this.move(i, (((here - target + 200) >>> 0) % 200) * 2, -1);
          else this.move(i, (((200 - here + target) >>> 0) % 200) * 2, 1);
        }
        break;
      case 9:
        for (let i = 0; i < 4; i++) if (this.ctl[i].remaining !== 0) this.reply[2] |= 1 << i;
        break;
      case 0xf:
        if (cmd === 0xf1 && this.pkt[1] === 0) this.reply[2] = 0x10;
        break;
      default: break;
    }
    this.reply[1] = ((cmd & 0xf0) + ((this.replyLeft - 6) >> 1)) & 0xff;
    let t = 0;
    let k = 1;
    for (; k < (this.replyLeft - 2) >> 1; k++) t = (t + this.reply[k]) & 0xff;
    this.reply[k] = t;
  }

  private replyNibble(): number {
    if (this.replyLeft === 0) return 0;
    let v: number;
    if (this.replyLeft & 1) {
      v = this.reply[this.replyPtr] & 0xf0;
      this.replyPtr++;
    } else v = (this.reply[this.replyPtr] & 0x0f) << 4;
    this.replyLeft--;
    return v;
  }

  private confirmMeters(confirmed: number): void {
    if (!confirmed) return;
    for (let i = 0; i < 8; i++) {
      if (!(confirmed & (1 << i))) continue;
      this.meterCounts[i]++;
      this.gridTotals.in += this.meterInRaw[i] ?? 0;
      this.gridTotals.out += this.meterOutRaw[i] ?? 0;
    }
  }

  private setTriacs(w: number): void {
    const rising = w & ~this.triacWord;
    this.triacWord = w;
    for (let i = 0; i < TRIAC_LINES; i++) {
      if (!(rising & (1 << i))) continue;
      this.triacPulses[i]++;
      this.gridTotals.in += this.triacInRaw[i] ?? 0;
      this.gridTotals.out += this.triacOutRaw[i] ?? 0;
      this.book.slide(i);
    }
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
      this.coinRow = MACH2000_COIN_ROW;
      this.coinMask = raw & 0xff;
      if (!this.coinMask) return;
      this.coinTimer = COIN_HOLD_ROW + COIN_GAP;
    }
    this.matrix[this.coinRow] |= this.coinMask;
    this.book.coin(id >= 0x100 ? this.slots.coinOn(id) : coinOfNote(id), this.coinTimer - COIN_GAP);
  }

  get coinBusy(): boolean { return this.coinTimer > 0; }

  get parts(): BoardPart[] {
    return [
      { id: 'cpu', label: 'MAIN CPU', part: 'HD6303Y - 1 MHz', device: this.cpu, cpu: true },
      { id: 'slave', label: 'SLAVE CPU', part: 'HD6303Y - 1 MHz', device: this.slaveCpu, cpu: true },
      { id: 'rom', label: 'PROGRAM ROMS', part: 'main and slave', device: this.rom },
      { id: 'ram', label: 'RAM', part: '2K + 2K, main battery backed', device: this.ram },
      { id: 'rtc', label: 'CLOCK', part: 'ICM7170', device: this.ram },
      { id: 'ay', label: 'SOUND', part: '2 x AY-3-8912', device: this.ay1 },
      { id: 'pia', label: 'PIA', part: 'HD6321 - lamps, switch columns', device: this.pia },
      { id: 'dots', label: 'DOT MATRIX', part: '60 x 21', device: this.slaveRam },
      { id: 'lamps', label: 'LAMPS', part: '8 columns of 16', device: this.lamps },
      { id: 'meters', label: 'METERS', part: '8 lines', device: this.meterCounts },
      { id: 'triacs', label: 'TRIACS', part: '4 lines', device: this.triacPulses },
      { id: 'switches', label: 'SWITCHES', part: '3 rows by column, and row 4', device: this.matrix },
      { id: 'reels', label: 'REELS', part: 'reel controller', device: this.reels },
    ];
  }
}
