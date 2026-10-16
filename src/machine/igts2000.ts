import { I960 } from '../cpu/i960';
import { Mcs51 } from '../cpu/mcs51';
import { Quart } from '../hw/quart';
import { Ay8910 } from '../hw/ay8910';
import { Ymz280b } from '../hw/ymz280b';
import { SwitchedLamps } from '../hw/switchedlamps';
import { MeterConfirm } from '../hw/meterconfirm';
import { Hopper, v20Waveform } from '../hw/hopper';
import { OneWireId } from '../hw/onewireid';
import type { Reel } from '../hw/reel';
import { V20Reels } from './v20reels';
import { COIN_RAW } from './coinraw';
import type { AudioSource, CabinetSwitch, CashLedger, DigitKind, Machine, NamedCoin } from './machine';
import { newCashLedger } from './machine';
import { CoinBook, SlotCoins, coinOfNote, type BookedCoin } from './coinbook';
import type { SlideEffect } from '../layout/fmlconfig';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import type { ReelGeometry } from './layoutreels';
import { StrayCounter } from './strayaccess';

export const IGTS2000_CLOCK = 8_000_000;
const VFD_HZ = 2_750_000;
const AY_CLOCK = 3_579_545;
const METER_TICK_CALLS = 10000;
const HOPPER_TICK = 8000;
const COIN_STEP = 8000;
const EEP_BUSY = 400;
const COIN_STEPS = [0, 4, 0xc, 0x1c, 0x18, 0x10];
const REEL_COUNT = 5;
export const IGTS2000_REEL_ADJUST = -12;
const SWAP = [0, 1, 4, 5, 2, 3, 6, 7, 8, 9, 12, 13, 10, 11, 14, 15];
const STRIPE = Uint8Array.from(
  ('11011111111000000011011111111000000011011111111000000011011111111000000011011111111000000011101111'
    + '111100000001101111111100000001101111111100000001101111111100000001101111111100000001101111111101111111')
    .split('').map(Number),
);
const LAMP_COUNT = 0x120;
const COIN_HOLD_LINE = Math.round(0.07 * IGTS2000_CLOCK);
const COIN_GAP = Math.round(0.005 * IGTS2000_CLOCK);
const HOPPER_WAVEFORM = v20Waveform(1, { beam: 0x14 + 1, gap: 0x78, start: 0x50, settle: 1 });

export class IgtS2000 implements Machine {
  readonly system = 'IGTS2000';
  readonly clockHz = IGTS2000_CLOCK;
  readonly cpu: I960;
  readonly vfdCpu: Mcs51;
  readonly display = null;

  private readonly hi = new Uint8Array(0x20000 + 0x80000 + 0x80000 + 0x200000);
  private bootBase = 0x20000;
  readonly game = new Uint8Array(0x200000);
  readonly ram = new Uint8Array(0x100000);
  readonly eeprom = new Uint8Array(0x800);
  private readonly latch = new Uint8Array(0x600);
  private readonly vfdMem = new Uint8Array(0x10000);
  readonly vfdFrame = new Uint8Array(0x180);
  private vfdIndex = 0;
  private vfdP1 = 4;

  readonly quart1: Quart;
  readonly quart2: Quart;
  readonly ay = new Ay8910(AY_CLOCK, 'ay8910');
  readonly ymz = new Ymz280b();
  get audioSource(): AudioSource { return this.ay; }

  readonly lampStore = new SwitchedLamps(LAMP_COUNT, 0);
  get lamps(): Uint8Array { return this.lampStore.shown; }
  readonly digits = new Uint8Array(64);
  readonly digitKind: DigitKind = 'byte64';
  readonly meters = new MeterConfirm();
  readonly meterCounts = new Uint32Array(16);
  readonly hopper = new Hopper(IGTS2000_CLOCK, HOPPER_WAVEFORM);
  readonly hopperEjects = { count: 0 };

  private readonly reelDrive = new V20Reels(REEL_COUNT);
  get reels(): Reel[] { return this.reelDrive.reels; }
  private optic = 0;

  readonly matrix = new Uint8Array(16);
  private switches: LayoutSwitch[] = [];

  now: () => Date = () => new Date();
  private readonly hostNow = this.now;
  pinHostClock(at: Date | null): void {
    this.now = at ? () => new Date(at.getTime()) : this.hostNow;
  }

  private eepData = 0;
  private eepAddr = 0;
  private eepCtl = 0;
  private eepState = 0;
  private eepRead = 0;
  private eepOut = 0;
  private eepStop = 0;
  private eepRestart = 0;
  private eepTimer = 0;

  private coinStep = 0;
  private coinOut = 0;
  private coinTimer = 0;
  private quart2Bit1 = 0;

  private calls = 0;
  private totalCycles = 0;
  readonly oneWireId = new OneWireId();
  private hopperAcc = 0;
  private vfdDebt = 0;
  private nvram: Uint8Array | null = null;
  private eepImage: Uint8Array | null = null;

  readonly cashLedger: CashLedger = newCashLedger();
  private readonly book = new CoinBook(this.cashLedger, IGTS2000_CLOCK);
  private readonly slots = new SlotCoins();
  private meterInRaw: number[] = [];
  private meterOutRaw: number[] = [];
  private readonly gridTotals = { in: 0, out: 0 };
  get meterTotals(): { readonly in: number; readonly out: number } { return this.gridTotals; }
  private coinRow = 0;
  private coinMask = 0;
  private coinHold = 0;

  readonly strays = new StrayCounter();

  constructor() {
    this.cpu = new I960({
      read8: (a) => this.read8(a >>> 0),
      read16: (a) => this.read16(a >>> 0),
      read32: (a) => this.read32(a >>> 0),
      write8: (a, v) => this.write8(a >>> 0, v),
      write16: (a, v) => this.write16(a >>> 0, v),
      write32: (a, v) => this.write32(a >>> 0, v),
    });
    this.quart1 = new Quart({
      op: (blk, pins, changed) => {
        if (blk === 1 && (changed & 0x40)) this.oneWireId.line(this.totalCycles, (pins & 0x40) !== 0);
      },
    });
    this.quart2 = new Quart({
      tx: (ch, v, nine) => { if (ch === 0) this.vfdCpu.serialRx(v, nine ? 1 : 0); },
      op: (blk, pins, changed) => {
        if (blk !== 0) return;
        if (changed & 2) this.quart2Bit1 = pins & 2;
        if (changed & 0xc0) this.lampStore.writeAt(0x80, 8, (pins & 0xc0) >> 6);
      },
    });
    this.hopper.onCoin = () => { this.hopperEjects.count++; this.cashLedger.unpricedOut++; };
    this.quart1.setClock(IGTS2000_CLOCK);
    this.quart2.setClock(IGTS2000_CLOCK);
    this.vfdCpu = new Mcs51({
      readCode: (a) => this.vfdMem[a & 0xffff],
      readXdata: (a) => (a < 0x8000 ? this.vfdMem[0x8000 + a] : 0xff),
      writeXdata: (a, v) => this.vfdWrite(a, v),
      readPort: (p) => (p === 1 ? 0 : 0xff),
      writePort: (p, v) => {
        if (p !== 1) return;
        if (((this.vfdP1 ^ v) & 0xff) === 4 && (v & 4)) this.vfdIndex = 0;
        this.vfdP1 = v & 0xff;
      },
      serialTx: (v) => this.quart2.receive(0, v),
    }, { ramSize: 256, timer2: true, dualDptr: true, v20Rx: true });
    this.reset();
  }

  loadRoms(roms: readonly Uint8Array[], slaves: readonly Uint8Array[]): void {
    this.hi.fill(0);
    this.game.fill(0);
    if (roms[0]) this.hi.set(roms[0].subarray(0, 0x80000), 0x20000);
    if (roms[1]) this.hi.set(roms[1].subarray(0, 0x200000), 0x120000);
    if (roms[2]) this.vfdMem.set(roms[2].subarray(0, 0x8000), 0);
    if (roms[3]) this.hi.set(roms[3].subarray(0, 0x80000), 0xa0000);
    for (let s = 0; s < 2; s++) {
      const r = slaves[s];
      if (!r) continue;
      for (let i = 0; i < r.length && i * 2 + s < this.game.length; i++) this.game[i * 2 + s] = r[i];
    }
    if (slaves[2]) this.hi.set(slaves[2].subarray(0, 0x20000), 0);
  }

  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, 0x100000);
    this.ram.fill(0);
    this.ram.set(this.nvram);
  }

  loadEeprom(data: Uint8Array): void {
    this.eepImage = data.slice(0, 0x800);
    this.eeprom.fill(0);
    this.eeprom.set(this.eepImage);
  }

  batteryRam(): Uint8Array { return this.ram.slice(); }

  setReelGeometry(geo: readonly ReelGeometry[]): void { this.reelDrive.setGeometry(geo); }
  setReelPosition(i: number, pos: number): void {
    this.reelDrive.setPosition(i, pos);
    this.updateOptic(i);
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
  setCoinSlots(lines: Iterable<readonly [number, BookedCoin]>): void { this.slots.setLines(lines); }
  get unnamedCoinLines(): readonly number[] { return this.slots.unnamed; }
  nameCoin(line: number, coin: NamedCoin): void { this.slots.name(line, coin); }
  setMeterMoney(map: {
    meterIn: readonly number[]; meterOut: readonly number[];
    triacIn: readonly number[]; triacOut: readonly number[];
  }): void {
    this.meterInRaw = [...map.meterIn];
    this.meterOutRaw = [...map.meterOut];
  }

  layoutInput(id: number, on: boolean): void {
    if (id < 0 || id >= this.matrix.length * 8) return;
    if (on) this.matrix[id >> 3] |= 1 << (id & 7);
    else this.matrix[id >> 3] &= ~(1 << (id & 7));
  }

  layoutLamp(n: number): boolean { return n >= 0 && n < LAMP_COUNT && this.lamps[n] !== 0; }
  layoutLampLevel(n: number): number { return n >= 0 && n < LAMP_COUNT ? this.lamps[n] : 0; }
  layoutDigit(n: number): number { return n >= 0 && n < this.digits.length ? this.digits[n] : 0; }

  get outputs(): { vfd: Uint8Array } { return { vfd: this.vfdFrame }; }

  powerCycle(): void {
    this.nvram = this.batteryRam();
    this.eepImage = this.eeprom.slice();
    this.reset();
  }

  reset(): void {
    if (this.nvram) { this.ram.fill(0); this.ram.set(this.nvram); }
    if (this.eepImage) { this.eeprom.fill(0); this.eeprom.set(this.eepImage); }
    this.bootBase = 0x20000;
    this.calls = 0;
    this.hopperAcc = 0;
    this.meters.reset();
    this.hopper.reset();
    this.ay.reset();
    this.ymz.reset();
    this.quart1.reset();
    this.quart2.reset();
    this.quart2Bit1 = 0;
    this.eepTimer = 0; this.eepCtl = 0; this.eepAddr = 0; this.eepState = 0; this.eepRead = 0;
    this.eepRestart = 0; this.eepStop = 0; this.eepOut = 0;
    this.coinOut = 0; this.coinTimer = 0; this.coinStep = 0;
    this.reelDrive.reset();
    this.oneWireId.reset();
    this.totalCycles = 0;
    this.cpu.reset();
    this.vfdCpu.reset();
    this.vfdFrame.fill(0xff);
    this.vfdIndex = 0;
    this.vfdP1 = 4;
    this.vfdDebt = 0;
    this.coinHold = 0;
    this.book.reset();
  }

  step(): number {
    const c = this.mainStep();
    this.totalCycles += c;
    this.vfdDebt += c * VFD_HZ;
    while (this.vfdDebt > 0) this.vfdDebt -= this.vfdCpu.step() * IGTS2000_CLOCK;
    this.book.elapse(c);
    if (this.coinHold > 0) {
      this.coinHold -= c;
      if (this.coinHold <= COIN_GAP) this.matrix[this.coinRow] &= ~this.coinMask;
      if (this.coinHold < 0) this.coinHold = 0;
    }
    return c;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  private mainStep(): number {
    if (this.calls > METER_TICK_CALLS) {
      this.confirmMeters(this.meters.tick());
      this.calls -= METER_TICK_CALLS;
    }
    if (this.hopperAcc >= HOPPER_TICK) {
      this.hopper.tick(HOPPER_TICK);
      this.hopperAcc -= HOPPER_TICK;
    }
    const c = this.cpu.step();
    this.hopperAcc += c;
    this.quart1.tick(c);
    this.quart2.tick(c);
    this.ay.tick(c, IGTS2000_CLOCK);
    this.ymz.tick(c, IGTS2000_CLOCK);
    if (this.matrix[14] & 1) {
      if ((this.latch[0x6a] & 4) && this.coinStep === 0) this.coinTimer = 1;
    } else if (this.coinStep === 6) this.coinStep = 0;
    if (this.coinTimer !== 0) {
      this.coinTimer -= c;
      if (this.coinTimer <= 0) {
        this.coinTimer = 0;
        this.coinStep++;
        if (this.coinStep < 6) this.coinTimer = COIN_STEP;
        this.coinOut = COIN_STEPS[this.coinStep] ?? 0;
      }
    }
    this.eepTick(c);
    this.calls++;
    if (this.quart1.irq()) this.cpu.setIRQ(3, 1);
    if (this.quart2.irq()) this.cpu.setIRQ(0, 1);
    return c;
  }

  private eepTick(c: number): void {
    if (this.eepTimer === 0) return;
    this.eepTimer -= c;
    if (this.eepTimer > 0) return;
    this.eepTimer = 0;
    this.eepCtl &= 0xfe;
    switch (this.eepState) {
      case 0:
        this.eepState = this.eepRead ? 2 : 1;
        break;
      case 1:
        this.eepAddr = (this.eepAddr & 0x700) | this.eepData;
        if (this.eepRestart) { this.eepState = 0; this.eepRestart = 0; this.eepCtl &= 0xfb; }
        else this.eepState = 3;
        break;
      case 2:
        if (this.eepStop) this.eepState = 0;
        this.eepOut = this.eeprom[this.eepAddr];
        this.eepAddr = (this.eepAddr + 1) & 0x7ff;
        break;
      case 3:
        if (this.eepStop) this.eepState = 0;
        this.eeprom[this.eepAddr] = this.eepData;
        this.eepAddr = (this.eepAddr + 1) & 0x7ff;
        break;
      default: break;
    }
  }

  private eepControl(v: number): void {
    this.eepCtl = v;
    if ((v & 0xf) === 0) this.eepState = 0;
    if (v & 4) this.eepRestart = 1;
    if (v & 1) {
      this.eepTimer = EEP_BUSY;
      this.eepStop = v & 2;
      if (this.eepState === 0 && (this.eepData & 0xf0) === 0xa0) {
        this.eepAddr = (this.eepAddr & 0xff) | ((this.eepData & 0xe) << 7);
        this.eepRead = this.eepData & 1;
      }
    }
  }

  private bootByte(off: number): number {
    const i = this.bootBase + off;
    return i < this.hi.length ? this.hi[i] : 0;
  }

  private read8(a: number): number {
    switch (a >>> 27) {
      case 0: {
        const sel = (a >>> 21) & 3;
        if (sel === 0) return this.bootByte(a & 0x1fffff);
        if (sel === 1) return this.rtc((a & 0xff) >> 1);
        return 0xff;
      }
      case 1: {
        const sel = (a >>> 21) & 3;
        if (sel === 0) return this.game[a & 0x1fffff];
        if (sel === 1) {
          const i = (a & 0x1fffff) >> 1;
          return a & 1 ? this.hi[0x120000 + i] ?? 0 : this.hi[i] ?? 0;
        }
        this.strays.hit(a);
        return 0xff;
      }
      case 2: return this.ram[a & 0xfffff];
      case 3: return this.optic | 0x20;
      case 5: return this.ioRead(a);
      default: this.strays.hit(a); return 0xff;
    }
  }

  private read16(a: number): number {
    switch (a >>> 27) {
      case 0: if (!(a & 0x600000)) return this.bootByte(a & 0x1fffff) | (this.bootByte((a & 0x1fffff) + 1) << 8); return 0xffff;
      case 1: if (!(a & 0x600000)) { const i = a & 0x1fffff; return this.game[i] | ((this.game[i + 1] ?? 0) << 8); } return 0xffff;
      case 2: { const i = a & 0xfffff; return this.ram[i] | ((this.ram[i + 1] ?? 0) << 8); }
      default: return 0xffff;
    }
  }

  private read32(a: number): number {
    switch (a >>> 27) {
      case 0: if (!(a & 0x600000)) { const i = a & 0x1fffff; return (this.bootByte(i) | (this.bootByte(i + 1) << 8) | (this.bootByte(i + 2) << 16) | (this.bootByte(i + 3) << 24)) >>> 0; } return 0xffffffff;
      case 1: if (!(a & 0x600000)) { const i = a & 0x1fffff; const g = this.game; return (g[i] | (g[i + 1] << 8) | (g[i + 2] << 16) | (g[i + 3] << 24)) >>> 0; } return 0xffffffff;
      case 2: { const i = a & 0xfffff; const r = this.ram; return (r[i] | (r[i + 1] << 8) | (r[i + 2] << 16) | (r[i + 3] << 24)) >>> 0; }
      default: return 0xffffffff;
    }
  }

  private write8(a: number, val: number): void {
    const v = val & 0xff;
    switch (a >>> 27) {
      case 2: this.ram[a & 0xfffff] = v; return;
      case 3: this.reelWrite(a & 7, val); return;
      case 5: this.ioWrite(a, v); return;
      default: this.strays.hit(a); return;
    }
  }

  private write16(a: number, v: number): void {
    if (a >>> 27 === 2) { const i = a & 0xfffff; this.ram[i] = v & 0xff; if (i + 1 < this.ram.length) this.ram[i + 1] = (v >>> 8) & 0xff; }
  }

  private write32(a: number, v: number): void {
    if (a >>> 27 === 2) {
      const i = a & 0xfffff;
      for (let k = 0; k < 4 && i + k < this.ram.length; k++) this.ram[i + k] = (v >>> (k * 8)) & 0xff;
    }
  }

  private ioRead(a: number): number {
    switch ((a >>> 16) & 0xf) {
      case 0:
        if (a === 0x28000000) return this.ymz.read(0);
        if (a === 0x28000002) return this.ymz.read(1);
        return 0xff;
      case 1: {
        this.quart1.ip[0] = this.matrix[0] | 0xc;
        this.quart1.ip[1] = this.matrix[1] | this.oneWire();
        return this.quart1.read((a & 0xff) >> 1);
      }
      case 2: return this.ioBlockRead(a & 0xffff);
      case 4:
        this.quart2.ip[0] = this.matrix[2];
        this.quart2.ip[1] = ((this.matrix[3] ^ 0x30) | (this.quart2Bit1 ? 0xf : 0) | 0xc0) & 0xff;
        return this.quart2.read((a & 0xff) >> 1);
      default: this.strays.hit(a); return 0xff;
    }
  }

  private oneWire(): number { return this.oneWireId.read(7); }

  private ioBlockRead(x: number): number {
    if (x >= 0x20 && x <= 0x34 && !(x & 1)) {
      const row = this.matrix[4 + ((x - 0x20) >> 1)];
      if (x === 0x2a) return ~(row | this.coinOut) & 0xff;
      if (x === 0x30) return ~((this.hopper.opto ? 0 : 0x20) | row) & 0xff;
      return ~row & 0xff;
    }
    switch (x) {
      case 0x1fa: return this.eepOut;
      case 0x1fc: return this.eepCtl;
      case 0x60: case 0x64: case 0x68: case 0x6a: case 0x6c: case 0x6e: case 0x70: case 0x72:
      case 0x280: case 0x282: case 0x284: case 0x286: case 0x288: case 0x28a: case 0x28c: case 0x28e:
        return this.latch[x];
      default: this.strays.hit(0x28020000 + x); return 0xff;
    }
  }

  private ioWrite(a: number, v: number): void {
    switch ((a >>> 16) & 0xf) {
      case 0:
        if (a === 0x28000000) this.ymz.write(0, v);
        else if (a === 0x28000002) this.ymz.write(1, v);
        return;
      case 1: this.quart1.write((a & 0xff) >> 1, v); return;
      case 2: this.ioBlockWrite(a & 0xffff, v); return;
      case 4: this.quart2.write((a & 0xff) >> 1, v); return;
      case 5:
        if (a & 2) this.ay.write(v);
        else this.ay.selectAddress(v);
        return;
      case 7: return;
      default: this.strays.hit(a); return;
    }
  }

  private ioBlockWrite(x: number, v: number): void {
    if (x < this.latch.length) this.latch[x] = v;
    if (x === 0x70) this.hopper.motorDrive((v & 1) !== 0);
    if (x === 0x72) this.meters.write(v & 0x2f);
    if (x >= 0x60 && x <= 0x72 && !(x & 1)) { this.lampStore.writeAt((x - 0x60) * 4, 8, v); return; }
    if (x === 0x360 || x === 0x362) { this.lampStore.writeAt((x - 0x360) * 4 + 0x70, 8, v); return; }
    if (x === 0x1fa) { this.eepData = v; return; }
    if (x === 0x1fc) { this.eepControl(v); return; }
    if (x >= 0x280 && x <= 0x28e && !(x & 1)) { this.rgbLamps(v, (x - 0x280) >> 1); return; }
    if (x & 1) return;
    let d = -1;
    if (x >= 0x200 && x <= 0x21e) d = (0x21e - x) >> 1;
    else if (x >= 0x220 && x <= 0x22e) d = ((0x22e - x) >> 1) + 0x10;
    else if (x >= 0x230 && x <= 0x23e) d = ((0x23e - x) >> 1) + 0x18;
    else if (x >= 0x3c0 && x <= 0x3ce) d = ((0x3ce - x) >> 1) + 0x20;
    else if (x >= 0x3d0 && x <= 0x3de) d = ((0x3de - x) >> 1) + 0x28;
    else if (x >= 0x3e0 && x <= 0x3ee) d = ((0x3ee - x) >> 1) + 0x30;
    if (d >= 0) this.digits[d] = v;
  }

  private rgbLamps(v: number, n: number): void {
    const q = Math.floor(n / 3) * 2;
    const hi = ((v >> 4) & 7) * 36;
    const lo = (v & 7) * 36;
    const set = (lamp: number, level: number) => { this.lampStore.shown[0x100 + lamp] = level; };
    switch (n % 3) {
      case 0: set(q, hi); set(q + 8, lo); break;
      case 1: set(q + 16, lo); set(q + 9, hi); break;
      default: set(q + 1, lo); set(q + 17, hi); break;
    }
  }

  private rtc(reg: number): number {
    const d = this.now();
    switch (reg) {
      case 0: return d.getSeconds() % 10;
      case 1: return Math.floor(d.getSeconds() / 10);
      case 2: return d.getMinutes() % 10;
      case 3: return Math.floor(d.getMinutes() / 10);
      case 4: return d.getHours() % 10;
      case 5: return Math.floor(d.getHours() / 10);
      case 6: return d.getDate() % 10;
      case 7: return Math.floor(d.getDate() / 10);
      case 8: return (d.getMonth() + 1) % 10;
      case 9: return Math.floor((d.getMonth() + 1) / 10);
      case 10: return d.getFullYear() % 10;
      case 11: return Math.trunc((d.getFullYear() - 2000) / 10) & 0xff;
      case 12: return d.getDay();
      default: return 0;
    }
  }

  private reelWrite(i: number, v: number): void {
    this.reelDrive.step(i, SWAP[v & 0xf]);
    this.updateOptic(i);
  }

  private updateOptic(i: number): void {
    const r = this.reelDrive.state[i];
    if (!r) return;
    const bit = 1 << i;
    const idx = 0xc7 - (r.pos >> 1);
    const lit = idx >= 0 && idx < STRIPE.length && STRIPE[idx] === 0;
    this.optic = lit ? this.optic | bit : this.optic & ~bit;
  }

  private vfdWrite(a: number, v: number): void {
    if (a < 0x8000) { this.vfdMem[0x8000 + a] = v; return; }
    if (a === 0x8000) {
      if (this.vfdIndex >= 0x180) this.vfdIndex = 0;
      this.vfdFrame[this.vfdIndex++] = v;
    }
  }

  private confirmMeters(confirmed: number): void {
    if (!confirmed) return;
    for (let i = 0; i < 16; i++) {
      if (!(confirmed & (1 << i))) continue;
      this.meterCounts[i]++;
      this.gridTotals.in += this.meterInRaw[i] ?? 0;
      this.gridTotals.out += this.meterOutRaw[i] ?? 0;
    }
  }

  insertCoin(id: number): void {
    if (this.coinHold > 0) return;
    const raw = id >= 0x100 && id < 0x180 ? id : COIN_RAW[id];
    if (raw === undefined || !(raw & 0x100)) return;
    const row = (raw & 0x78) >> 3;
    if (row >= this.matrix.length) return;
    this.coinRow = row;
    this.coinMask = 1 << (raw & 7);
    this.coinHold = COIN_HOLD_LINE + COIN_GAP;
    this.matrix[this.coinRow] |= this.coinMask;
    this.book.coin(id >= 0x100 ? this.slots.coinOn(id) : coinOfNote(id), COIN_HOLD_LINE);
  }

  get coinBusy(): boolean { return this.coinHold > 0; }

  get parts(): BoardPart[] {
    return [
      { id: 'cpu', label: 'CPU', part: 'i960 - 8 MHz', device: this.cpu, cpu: true },
      { id: 'vfdcpu', label: 'DISPLAY CPU', part: '8051 - VFD', device: this.vfdCpu, cpu: true },
      { id: 'rom', label: 'PROGRAM ROMS', part: 'boot and game', device: this.game },
      { id: 'ram', label: 'RAM', part: '1 MB, battery backed', device: this.ram },
      { id: 'eeprom', label: 'EEPROM', part: '2K serial', device: this.eeprom },
      { id: 'rtc', label: 'CLOCK', part: 'BCD clock at $00200000', device: this.ram },
      { id: 'quart1', label: 'UART 1', part: 'quad UART - inputs', device: this.quart1 },
      { id: 'quart2', label: 'UART 2', part: 'quad UART - display link', device: this.quart2 },
      { id: 'ay', label: 'SOUND', part: 'AY-3-8910 and YMZ280B', device: this.ay },
      { id: 'lamps', label: 'LAMPS', part: 'switched and levelled', device: this.lamps },
      { id: 'sevenseg', label: '7-SEG', part: '56 digits', device: this.digits },
      { id: 'meters', label: 'METERS', part: '6 lines', device: this.meterCounts },
      { id: 'hopper', label: 'HOPPER', part: 'one', device: this.hopper },
      { id: 'switches', label: 'SWITCHES', part: 'rows 0-15', device: this.matrix },
      { id: 'reels', label: 'REELS', part: 'coded-disc optics', device: this.reels },
      { id: 'vfd', label: 'VFD', part: '192 x 16', device: this.vfdFrame },
    ];
  }
}
