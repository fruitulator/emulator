import type { Machine, MachineDisplay, CabinetSwitch, CashLedger, CoinChute, CoinWiringStatus, DigitKind } from './machine';
import { newCashLedger, ledgerOutMults, dilSwitchLabel } from './machine';
import { linesOf, wiringKey, wiringStateFor, type CoinLineTable, type CoinWiring, type Refusal, type SlotCoin, type StepState } from './coinwiring';
import type { DeclaredCoin } from './layoutcoins';
import { ecoinProgramCoins, locateEcoinCoins, type EcoinCoinCode } from './ecoincoins';
import { Z80, type Z80Io } from '../cpu/z80';
import { Sn76489 } from '../hw/sn76489';
import { MeterConfirm } from '../hw/meterconfirm';
import { Mixer } from '../hw/mixer';
import { Hopper, v20Waveform } from '../hw/hopper';
import { DataPak } from '../hw/datapak';
import { V20Reels } from './v20reels';
import type { ReelGeometry } from './layoutreels';
import type { LayoutSwitch } from './layoutswitches';
import type { BoardPart } from './parts';
import type { SlideEffect } from '../layout/fmlconfig';

import { noteRomCut } from './boarddefaults';
import { StrayCounter } from './strayaccess';

const CLOCK = 4_000_000;
const ROM_TOP = 0x8000;
const RAM_BASE = 0x8000;
const RAM_SIZE = 0x2000;
const IRQ_PERIOD = 0x2000;
const TICK = 2500;
const METER_TICK_TICKS = 3;
const WATCHDOG = 250_000;
const TRIAC_OFF_DELAY = 1000;
const DATAPAK_TURNAROUND = 50_000;
const METER_UNIT_PENCE = 10;

export const STANDARD_METER_GRID = {
  meterIn: [0, 1, 0, 1, 0, 0, 0, 0],
  meterOut: [0, 0, 1, 0, 1, 0, 0, 0],
} as const;
const REEL_COUNT = 4;
export const ELECTROCOIN_REEL_ADJUST = 0;
const SEC_HOLD = 0x960;
const COIN_PRESS = Math.round(0.07 * CLOCK);
const COIN_GAP = Math.round(0.05 * CLOCK);

const DIGIT_STROBE = [0, 1, 2, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0];
const SEG_SWIZZLE = Uint8Array.from({ length: 256 }, (_, i) =>
  (i & 0x88) | ((i & 1) << 6) | ((i & 2) << 4) | ((i & 4) << 2) | ((i & 0x10) >> 2) | ((i & 0x20) >> 4) | ((i & 0x40) >> 6));
export const enum SegType { Type1 = 0, Type2 = 1 }
const NONE = 0xff;

class EcoinUart {
  private state = 0;
  private mode = 0;
  private cmd = 0;
  private changed = 0;
  status = 0;
  private rxData = 0;
  private txData = 0;
  private txTimer = 0;
  private rxTimer = 0;
  private readonly fifo = new Uint8Array(16);
  private head = 0;
  private tail = 0;
  private txEnable = false;
  private rxEnable = false;
  private byteTime = 0;
  private clock = 0;
  txDone = false;
  txOut = 0;

  reset(clock: number): void {
    this.state = 0;
    this.cmd = 0;
    this.txTimer = 0;
    this.rxTimer = 0;
    this.status = 0;
    this.changed = 0;
    this.txDone = false;
    this.head = this.tail = 0;
    this.txEnable = false;
    this.rxEnable = false;
    this.clock = clock;
  }

  write(a0: number, v: number): void {
    if (!a0) {
      if (this.status & 1) { this.txData = v; this.status &= 0xfa; }
    } else {
      switch (this.state) {
        case 0:
          this.mode = v;
          if ((v & 3) === 0) this.state = 1;
          else {
            this.state = 3;
            const factor = [0, 1, 16, 64][v & 3];
            const bits = ((v >> 6) & 1) + (v >> 7) + ((v & 0x10) >> 4) + ((v & 0xc) >> 2) + 6;
            const baud = Math.floor(Math.floor(0x258000 / factor) / 128);
            this.byteTime = Math.floor(this.clock / baud) * bits;
          }
          break;
        case 1: this.state = this.mode & 0x80 ? 3 : 2; break;
        case 2: this.state = 3; break;
        default: {
          this.changed = this.cmd ^ v;
          if (this.changed & 1) this.txEnable = (v & 1) !== 0;
          if (this.changed & 4) this.rxEnable = (v & 4) !== 0;
          if ((this.changed & 0x10) && (v & 0x10)) this.status &= 0xc7;
          this.cmd = v;
          if (v & 0x40) this.reset(this.clock);
          else if (this.txTimer === 0 && (v & 1)) this.status |= 1;
          else if (!(v & 1)) this.status &= 0xfe;
        }
      }
    }
    if ((this.changed & 2) && !(this.cmd & 2)) this.status |= 0x80;
  }

  read(a0: number): number {
    if (a0) return this.status;
    this.status &= 0xfd;
    return this.rxData;
  }

  receive(v: number): void {
    if (!this.rxEnable) return;
    this.fifo[this.head] = v & 0xff;
    this.head = (this.head + 1) & 15;
    if (this.rxTimer === 0) this.rxTimer = this.byteTime;
  }

  tick(c: number): void {
    if (this.txTimer < 1) {
      if (this.txEnable && !(this.status & 1)) {
        this.txTimer = this.byteTime;
        this.txOut = this.txData;
        this.status |= 1;
      }
    } else {
      this.txTimer -= c;
      if (this.txTimer < 1) {
        this.txTimer = 0;
        if (this.cmd & this.status & 1) this.status |= 4;
        this.txDone = true;
      }
    }
    if (this.rxTimer > 0) {
      this.rxTimer -= c;
      if (this.rxTimer < 1) {
        if (this.status & 2) this.status |= 0x10;
        this.status |= 2;
        this.rxData = this.fifo[this.tail];
        this.tail = (this.tail + 1) & 15;
        if (this.tail !== this.head) this.rxTimer += this.byteTime;
        else { this.rxTimer = 0; this.status &= 0x7f; }
      }
    }
  }
}

class EcoinSound {
  readonly cpu: Z80;
  readonly rom = new Uint8Array(0x4000);
  readonly ram = new Uint8Array(0x400);
  readonly latch = new Uint8Array(2);
  readonly sn = [new Sn76489(CLOCK), new Sn76489(CLOCK)];
  loaded = false;
  private irqAcc = 0;
  private pending = false;

  constructor() {
    const io: Z80Io = { in: () => 0xff, out: () => {} };
    this.cpu = new Z80({ read8: (a) => this.read(a), write8: (a, v) => this.write(a, v) }, io, {
      irqAck: () => 0x01,
    });
  }

  load(rom: Uint8Array, host: object): void {
    this.rom.fill(0);
    noteRomCut(host, rom.length, this.rom.length);
    this.rom.set(rom.subarray(0, this.rom.length));
    this.loaded = rom.length > 0;
  }

  reset(): void {
    this.cpu.reset();
    this.ram.fill(0);
    this.latch.fill(0);
    this.irqAcc = 0;
    this.pending = false;
    for (const s of this.sn) s.reset();
  }

  private read(a: number): number {
    switch (a & 0xe000) {
      case 0x0000: case 0x2000: return this.rom[a & 0x3fff];
      case 0x4000: return this.latch[a & 1];
      case 0x6000: return a < 0x6400 ? this.ram[a - 0x6000] : 0;
      default: return 0;
    }
  }

  private write(a: number, v: number): void {
    const r = a & 0xe000;
    if (r === 0x6000) { if (a < 0x6400) this.ram[a - 0x6000] = v; }
    else if (r === 0x8000) this.sn[a & 1].write(v);
  }

  step(): number {
    if (this.irqAcc >= IRQ_PERIOD) { this.pending = true; this.irqAcc -= IRQ_PERIOD; }
    this.cpu.setIRQ(this.pending);
    const c = this.cpu.step();
    this.cpu.setIRQ(false);
    this.pending = false;
    this.irqAcc += c;
    this.sn[0].tick(c, CLOCK);
    this.sn[1].tick(c, CLOCK);
    return c;
  }
}

export class Electrocoin implements Machine {
  static readonly snapshotConfig: readonly string[] = ['switches', 'coinCodeCache', 'coinSlots', 'wiring', 'meterInRaw', 'meterOutRaw'];

  readonly digitKind: DigitKind = 'impact';
  readonly clockHz = CLOCK;
  readonly reelsByLayoutNumber = true;

  protected readonly cpu: Z80;
  readonly uart = new EcoinUart();
  readonly sound = new EcoinSound();
  private readonly mixer = new Mixer(this.sound.sn);
  readonly dataPak = new DataPak(CLOCK);
  private dataPakOut: number[] = [];
  private dataPakWait = 0;
  private protocol = 0;
  static readonly HOPPER_WAVEFORM = v20Waveform((0x9c4 / CLOCK) * 1000, { beam: 100, gap: 0x96 });

  readonly hoppers = [new Hopper(CLOCK, Electrocoin.HOPPER_WAVEFORM), new Hopper(CLOCK, Electrocoin.HOPPER_WAVEFORM)];

  readonly rom = new Uint8Array(ROM_TOP);
  readonly ram = new Uint8Array(RAM_SIZE);

  readonly lamps = new Uint8Array(256);
  readonly digits = new Uint16Array(16);
  readonly meters = new Uint32Array(8);
  private readonly meterBank = new MeterConfirm();
  readonly triacPulses = new Uint32Array(4);
  get triacLevels(): number {
    return this.triacs & 0x0f;
  }
  private readonly reelBank = new V20Reels(REEL_COUNT);
  get reels() { return this.reelBank.reels; }
  get display(): MachineDisplay | null { return null; }
  get audioSource(): Mixer | null { return this.sound.loaded ? this.mixer : null; }

  protected readonly matrix = new Uint8Array(8);
  protected switches: LayoutSwitch[] = [];
  private dip1 = 0;
  private segType: SegType = SegType.Type1;
  private hopperMotor = [NONE, NONE];
  private hopperOpto = [NONE, NONE];

  private readonly out = new Uint8Array(0x20);
  private meterLatch = 0;
  get meterLevels(): number { return this.meterLatch & 0xff; }
  private bankSeg = 0;
  private creditSeg = 0;
  private triacNibble = 0;
  private triacTimer = 0;
  private triacs = 0;
  private irqAcc = 0;
  private irqToggle = 0;
  private irqPending = false;
  private tickAcc = 0;
  private watchdog = 0;
  private soundAcc = 0;
  private secState = 0;
  private secCounter = 0;
  private secHold = 0;
  private secBe = 0;
  private secKept = 0;
  private rng = 0x2545f491;
  private cycles = 0;
  watchdogResets = 0;

  constructor(roms: readonly Uint8Array[], nvram?: Uint8Array) {
    let off = 0;
    let mirrored = true;
    for (const r of roms) {
      if (off < ROM_TOP) this.rom.set(r.subarray(0, ROM_TOP - off), off);
      for (let i = Math.max(0, ROM_TOP - off); i < r.length && mirrored; i++) {
        if (r[i] !== this.rom[(off + i) % ROM_TOP]) mirrored = false;
      }
      off += r.length;
    }
    if (!mirrored) noteRomCut(this, off, ROM_TOP);
    if (nvram) this.ram.set(nvram.subarray(0, RAM_SIZE));
    this.hopperCoinPence = Electrocoin.hopperPenceOf(this.rom);
    const io: Z80Io = { in: (p) => this.portIn(p), out: (p, v) => this.portOut(p, v) };
    this.cpu = new Z80({ read8: (a) => this.read(a), write8: (a, v) => this.write(a, v) }, io, {
      irqAck: () => {
        this.irqPending = false;
        return this.irqToggle ? 0xe4 : 0xe0;
      },
    });
  }

  setReelGeometry(geometry: readonly ReelGeometry[]): void { this.reelBank.setGeometry(geometry); }

  get reelStandIns(): readonly number[] { return this.reelBank.standIns; }
  setReelPosition(i: number, pos: number): void { this.reelBank.setPosition(i, pos); }

  loadSound(roms: readonly Uint8Array[]): void {
    const total = roms.reduce((n, r) => n + r.length, 0);
    const all = new Uint8Array(total);
    let o = 0;
    for (const r of roms) { all.set(r, o); o += r.length; }
    this.sound.load(all, this);
  }

  setDips(d1: number): void { this.dip1 = d1 & 0xff; }

  setConfig(c: {
    segType?: number; hopperMotor?: number[]; hopperOpto?: number[]; protocol?: number; secKept?: number;
  }): void {
    if (c.secKept !== undefined) this.secKept = c.secKept & 0xff;
    if (c.segType !== undefined) this.segType = c.segType ? SegType.Type2 : SegType.Type1;
    if (c.hopperMotor) this.hopperMotor = c.hopperMotor.map((n) => n & 0xff);
    if (c.hopperOpto) this.hopperOpto = c.hopperOpto.map((n) => n & 0xff);
    if (c.protocol !== undefined) this.protocol = c.protocol;
  }

  private readonly ledger = newCashLedger();
  private meterInPence: number[] = [];
  private meterOutPence: number[] = [];
  get cashLedger(): CashLedger | undefined {
    return this.meterInPence.length || this.slidePence.some((p) => p !== null)
      ? this.ledger : undefined;
  }
  setMeterMoney(inMult: readonly number[], outMult: readonly number[]): void {
    this.meterInRaw = [...inMult];
    this.meterOutRaw = [...outMult];
    this.meterInPence = inMult.map((x) => x * METER_UNIT_PENCE);
    this.meterOutPence = ledgerOutMults({ in: inMult, out: outMult })[0].map((x) => x * METER_UNIT_PENCE);
  }

  private slidePence: SlideEffect[] = [null, null, null, null];
  setSlidePence(slides: readonly SlideEffect[]): void {
    for (let i = 0; i < 4; i++) this.slidePence[i] = slides[i] ?? null;
  }
  slideOutPence = 0;
  readonly slideEjects = new Uint32Array(4);

  setSwitches(sw: LayoutSwitch[]): void {
    this.switches = sw;
    for (const s of sw) if (s.closed) this.layoutInput(s.number, true);
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    this.layoutInput(id, made);
    const drawn = this.switches.find((s) => s.number === id);
    if (!drawn) this.switches = [...this.switches, { number: id, label, closed: made }]
      .sort((a, b) => a.number - b.number);
    else if (drawn.label === '' || drawn.label === String(id)) drawn.label = label;
  }

  private dilLabels: readonly string[] | null = null;
  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  private static readonly DIL_ID_BASE = 64;

  get switchPanel(): CabinetSwitch[] {
    const rows: CabinetSwitch[] = this.switches.map((s) => ({
      id: s.number, label: s.label,
      on: s.number >> 3 < this.matrix.length && ((this.matrix[s.number >> 3] >> (s.number & 7)) & 1) === 1,
    }));
    for (let i = 0; i < 8; i++) {
      rows.push({
        id: Electrocoin.DIL_ID_BASE + i,
        label: dilSwitchLabel(`DIP switch ${i + 1}`, this.dilLabels?.[i]),
        on: (this.dip1 & (1 << i)) !== 0,
        group: 'DIP switches',
        option: true,
        bootOnly: true,
      });
    }
    return rows;
  }

  batteryRam(): Uint8Array { return this.ram.slice(0, RAM_SIZE); }

  powerCycle(): void {
    this.reset();
  }

  reset(): void {
    this.cpu.reset();
    this.uart.reset(CLOCK);
    this.dataPak.reset();
    this.dataPakOut = [];
    this.dataPakWait = 0;
    this.hoppers[0].reset();
    this.hoppers[1].reset();
    this.hopperBooked[0] = this.hopperBooked[1] = 0;
    this.sound.reset();
    this.reelBank.reset();
    this.out.fill(0);
    this.meterLatch = 0;
    this.meterBank.reset();
    this.triacNibble = 0;
    this.triacTimer = 0;
    this.irqAcc = 0;
    this.irqToggle = 0;
    this.irqPending = false;
    this.tickAcc = 0;
    this.watchdog = 0;
    this.soundAcc = 0;
    this.secState = 0;
    this.secBe = 0;
    this.secHold = 0;
    this.secCounter = this.secKept ? (this.secKept - 1) & 0xff : 0;
    this.lamps.fill(0);
    this.digits.fill(0);
    this.coinTimer = 0;
    this.coinMask = 0;
    this.judgeCount.fill(0);
    this.judgeWait.fill(0);
    this.judging = false;
  }

  private read(a: number): number {
    if (a < ROM_TOP) return this.rom[a];
    if (a < RAM_BASE + RAM_SIZE) return this.ram[a - RAM_BASE];
    if (a < 0xa002) return this.uart.read(a & 1);
    this.strays.hit(a);
    return 0;
  }

  readonly strays = new StrayCounter();

  private write(a: number, v: number): void {
    if (a < ROM_TOP) return;
    if (a < RAM_BASE + RAM_SIZE) { this.ram[a - RAM_BASE] = v; return; }
    if (a < 0xa002) this.uart.write(a & 1, v);
    else this.strays.hit(a);
  }

  private portIn(port: number): number {
    const p = port & 0xff;
    let v: number;
    if (p < 8) {
      v = this.matrix[p];
      const d = this.dip1;
      switch (p) {
        case 1: {
          const o = this.reelBank.optos;
          v = (v & 0xf0) | ((o & 8) >> 2) | (o & 5) | ((o & 2) << 2);
          break;
        }
        case 4: v = (v & 0xfc) | ((d & 0x80) >> 7) | ((d & 0x20) >> 4); break;
        case 5: v = (v & 0xfc) | ((d & 8) >> 2) | ((d & 0x40) >> 6); break;
        case 6: v = (v & 0xfc) | ((d & 4) >> 1) | ((d & 0x10) >> 4); break;
        case 7: v = (v & 0xfc) | ((d & 1) << 1) | ((d & 2) >> 1); break;
      }
    } else v = 0xff;
    for (let h = 0; h < 2; h++) {
      const o = this.hopperOpto[h];
      if (o !== NONE && o >> 3 === (p & 7)) v |= this.hopperRaw(h) << (o & 7);
    }
    return ~v & 0xff;
  }

  private hopperRaw(h: number): number {
    const hp = this.hoppers[h];
    return !hp.running ? 1 : hp.opto ? 1 : 0;
  }

  private portOut(port: number, v: number): void {
    const p = port & 0x1f;
    const ch = this.out[p] ^ v;
    switch (p) {
      case 0: case 1: case 2: case 3:
        this.reelBank.step(p, v & 0xf);
        if (ch & 0xf0) this.bank(p * 8, v & 0xf0);
        break;
      case 4: case 5: case 6: case 7: case 9: case 0x0e:
      case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16: case 0x17:
        this.bank(p * 8, v);
        break;
      case 8: {
        const n = DIGIT_STROBE[v & 0xf];
        if (n) {
          this.digits[n - 1] = this.bankSeg;
          if (this.segType === SegType.Type2) this.digits[n + 3] = this.creditSeg;
        }
        const nib = v >> 4;
        if (nib !== this.triacNibble) {
          this.triacTimer = nib === 0 ? TRIAC_OFF_DELAY : 1;
          this.triacNibble = nib;
        }
        break;
      }
      case 0x0a: this.sound.latch[0] = v; break;
      case 0x0b: this.sound.latch[1] = v; break;
      case 0x0c:
        if (this.segType === SegType.Type1) {
          const n = DIGIT_STROBE[v & 3];
          if (n) this.digits[n + 3] = this.creditSeg;
          if (ch & 0xfc) this.bank(0x60, v & 0xfc);
        } else if (ch & 0xcc) this.bank(0x60, v & 0xcc);
        break;
      case 0x0d: this.creditSeg = SEG_SWIZZLE[v]; break;
      case 0x0f: this.bankSeg = SEG_SWIZZLE[v]; break;
      case 0x10:
        if (v !== this.meterLatch) {
          this.meterPulse(v);
          this.bank(0x80, v);
          this.meterLatch = v;
        }
        break;
      case 0x18: this.watchdog = WATCHDOG; break;
      default: break;
    }
    if ((port & 0xff) >= 0x20) return;
    this.out[p] = v;
    for (let h = 0; h < 2; h++) {
      const m = this.hopperMotor[h];
      if (m !== NONE && m >> 3 === p) this.hoppers[h].motorDrive(((this.out[p] >> (m & 7)) & 1) === 1);
    }
  }

  private bank(base: number, v: number): void {
    for (let i = 0; i < 8; i++) this.lamps[base + i] = (v >> i) & 1 ? 0xff : 0;
  }

  private meterPulse(v: number): void {
    this.meterBank.write(v & 0xff);
  }

  private meterConfirmed(i: number): void {
    this.meters[i]++;
    this.gridTotals.in += this.meterInRaw[i] ?? 0;
    this.gridTotals.out += this.meterOutRaw[i] ?? 0;
    if (!this.wiredIn) this.ledger.inPence += this.meterInPence[i] ?? 0;
    if (this.booksMoney) this.ledger.outPence += this.meterOutPence[i] ?? 0;
  }

  pricesOut(): boolean {
    return this.meterOutPence.some((x) => x > 0);
  }

  private bookSlide(i: number): void {
    this.triacPulses[i]++;
    this.slideEjects[i]++;
    const p = this.slidePence[i];
    if (typeof p === 'number') this.slideOutPence += p;
    if (this.pricesOut() || !this.booksMoney) return;
    if (p === 'token') this.ledger.unpricedTokenOut++;
    else if (p === 'unpriced') this.ledger.unpricedOut++;
    else if (p !== null) this.ledger.outPence += p;
  }

  private readonly hopperBooked = [0, 0];
  private bookHoppers(): void {
    for (let h = 0; h < 2; h++) {
      const paid = this.hoppers[h].paid;
      if (paid <= this.hopperBooked[h]) continue;
      const fresh = paid - this.hopperBooked[h];
      this.hopperEjects[h] += fresh;
      const pence = this.hopperCoinPence?.[h] ?? Electrocoin.HOPPER_PENCE[h];
      this.hopperOutPence += fresh * (pence ?? 0);
      if (!this.pricesOut() && this.booksMoney) {
        if (pence === null) this.ledger.unpricedOut += fresh;
        else this.ledger.outPence += pence * fresh;
      }
      this.hopperBooked[h] = paid;
    }
  }

  private static readonly HOPPER_PENCE: (number | null)[] = [100, null];

  private hopperCoinPence: [number, number] | null = null;
  hopperPriceIsDefault(): boolean {
    return this.hopperCoinPence === null;
  }

  static hopperPenceOf(rom: Uint8Array): [number, number] | null {
    const pat = [
      0x11, null, null, 0xdd, 0x7e, null, 0x6f, 0x17, 0x9f, 0x67, 0x29, 0x29, 0x19,
      0x5e, 0x23, 0x56, 0x23, 0x7e, 0x23, 0x66, 0x6f, 0xe5, 0xd5, 0x11, 0x60, 0x00,
      0xed, 0x4b, null, null, 0xdd, 0x7e, null, 0x6f, 0x17, 0x9f, 0x67, 0x29, 0x29,
      0x09, 0x19, 0xcd,
    ];
    for (let a = 0; a + pat.length <= rom.length; a++) {
      let ok = true;
      for (let k = 0; k < pat.length; k++) {
        const b = pat[k];
        if (b !== null && rom[a + k] !== b) { ok = false; break; }
      }
      if (!ok) continue;
      const t = rom[a + 1] | (rom[a + 2] << 8);
      if (t + 8 > rom.length) continue;
      const le32 = (i: number) => (rom[i] | (rom[i + 1] << 8) | (rom[i + 2] << 16) | (rom[i + 3] << 24)) >>> 0;
      const v = [le32(t), le32(t + 4)];
      if (v.some((x) => x === 0 || x % 100 !== 0 || x > 1_000_000)) continue;
      return [v[0] / 100, v[1] / 100];
    }
    return null;
  }
  hopperOutPence = 0;
  readonly hopperEjects = new Uint32Array(2);

  step(): number {
    if (this.tickAcc >= TICK) {
      this.tickAcc -= TICK;
      const confirmed = this.meterBank.advance(1, METER_TICK_TICKS);
      if (confirmed) for (let i = 0; i < 8; i++) if (confirmed & (1 << i)) this.meterConfirmed(i);
      if (this.secHold > 0 && --this.secHold === 0) {
        this.secKept = this.secCounter;
        this.secCounter = (this.secCounter - 1) & 0xff;
      }
    }
    if (this.irqAcc >= IRQ_PERIOD) {
      this.irqToggle ^= 1;
      this.irqPending = true;
      this.irqAcc -= IRQ_PERIOD;
    }
    this.cpu.setIRQ(this.irqPending);
    const c = this.cpu.step();
    this.cycles += c;
    this.tickAcc += c;
    if (this.judging) this.judgeCoinStep(c);
    this.hoppers[0].tick(c);
    this.hoppers[1].tick(c);
    if (this.hoppers[0].paid !== this.hopperBooked[0] || this.hoppers[1].paid !== this.hopperBooked[1]) this.bookHoppers();
    if (this.triacTimer > 0) {
      this.triacTimer -= c;
      if (this.triacTimer < 1) {
        this.triacTimer = 0;
        const t = this.triacNibble;
        if (t !== this.triacs) {
          const rise = t & ~this.triacs;
          for (let i = 0; i < 4; i++) if (rise & (1 << i)) this.bookSlide(i);
          this.triacs = t;
          this.bank(0x40, t << 4);
        }
      }
    }
    this.uart.tick(c);
    if (this.dataPakOut.length) {
      this.dataPakWait -= c;
      while (this.dataPakOut.length && this.dataPakWait <= 0) {
        this.uart.receive(this.dataPakOut.shift()!);
        this.dataPakWait += DATAPAK_TURNAROUND;
      }
    }
    if (this.uart.txDone) {
      this.uart.txDone = false;
      this.serialOut(this.uart.txOut);
    }
    if (this.watchdog > 0) {
      this.watchdog -= c;
      if (this.watchdog < 1) {
        this.watchdogResets++;
        this.reset();
        return c;
      }
    }
    this.irqAcc += c;
    if (this.sound.loaded) {
      this.soundAcc += c;
      while (this.soundAcc > 0) this.soundAcc -= this.sound.step();
    }
    if (this.coinTimer > 0) {
      const was = this.coinTimer;
      this.coinTimer -= c;
      if (was > COIN_GAP && this.coinTimer <= COIN_GAP) this.matrix[this.coinRow] &= ~this.coinMask;
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
    return c;
  }

  private serialOut(b: number): void {
    if (!(this.uart.status & 0x80)) {
      if (this.secState === 0) { if (b === 0x7e) this.secState = 1; }
      else if (this.secState === 1) { if (b === 0x01) this.secState = 2; }
      else if (this.secState === 2) {
        if (b === 0x7f) {
          this.secState = 0;
          this.secCounter = (this.secCounter + 1) & 0xff;
          if (this.secCounter === 0) this.secCounter = 1;
          this.secHold = SEC_HOLD;
          if (this.secCounter === 6 || this.secCounter === 15) this.secCounter++;
          this.uart.receive(this.secCounter);
        }
      } else this.secState = 0;
      const reply = this.dataPak.receive(b, this.cycles);
      if (reply && this.protocol === 1) {
        if (!this.dataPakOut.length) this.dataPakWait = DATAPAK_TURNAROUND;
        this.dataPakOut.push(...reply);
      }
      return;
    }
    if (b === 0x3a || b === 0x81) this.uart.receive(this.random());
    else if (b === 0xbe) {
      this.uart.receive(this.secBe < 2 ? 0x3f : 0);
      if (++this.secBe > 0x20) this.secBe = 0;
    } else if (b === 0xe7) { this.uart.receive(1); this.secBe = 0; }
    else if ((b & 0xf0) === 0x10) { this.uart.receive(3); this.uart.receive(3); }
  }

  private random(): number {
    let x = this.rng;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng & 0xff;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: 'LAMPS', part: '192 outputs, ports 0-7/9/E/11-17', device: this.lamps },
      { id: 'sevenseg', label: '7-SEG', part: '4 bank + 2 credit digits', device: this.digits },
      { id: 'meters', label: 'METERS', part: 'pulse counts - port $10', device: this.meters },
      { id: 'switches', label: 'SWITCHES', part: '8 input bytes + DIP 1', device: this.matrix },
      { id: 'coins', label: 'COIN INPUTS', part: 'matrix lines', modelled: true,
        note: 'layout acceptors name one input line each (CoinNoteId 0x47).' },
      { id: 'uart', label: 'UART', part: '8251 - PIC security + DataPak', device: this.uart },
      { id: 'ram', label: 'BATTERY RAM', part: '8K at $8000', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: '32K from $0000', device: this.rom },
      { id: 'cpu', label: 'CPU', part: 'Z80 - 4 MHz', device: this.cpu, cpu: true },
      { id: 'reels', label: 'REELS', part: 'steppers, ports 0-3', device: this.reelBank.state },
      { id: 'hopper', label: 'HOPPERS', part: 'layout-wired motor/opto', device: this.hoppers },
      { id: 'sound', label: 'SOUND BOARD', part: 'Z80 + 2x SN76489', device: this.sound.cpu },
    ];
  }

  layoutLamp(n: number): boolean { return n >= 0 && n < 256 && this.lamps[n] !== 0; }
  layoutLampLevel(n: number): number { return n >= 0 && n < 256 ? this.lamps[n] : 0; }
  layoutDigit(n: number): number { return n >= 0 ? this.digits[n & 15] : 0; }

  layoutInput(id: number, on: boolean): void {
    if (id >= Electrocoin.DIL_ID_BASE && id < Electrocoin.DIL_ID_BASE + 8) {
      const mask = 1 << (id - Electrocoin.DIL_ID_BASE);
      this.dip1 = on ? this.dip1 | mask : this.dip1 & ~mask & 0xff;
      return;
    }
    const row = id >> 3;
    if (id < 0 || row >= this.matrix.length) return;
    if (on) this.matrix[row] |= 1 << (id & 7);
    else this.matrix[row] &= ~(1 << (id & 7));
  }

  insertCoin(bit: number): void {
    if (this.coinTimer > 0) return;
    const line = bit & 0xff;
    if (line >= 64) return;
    const code = this.coinCode();
    if (code && !code.reads.has(line)) { this.coinsRefused++; return; }
    this.coinRow = line >> 3;
    this.coinMask = 1 << (line & 7);
    this.coinTimer = COIN_PRESS + COIN_GAP;
    this.matrix[this.coinRow] |= this.coinMask;
    if (this.wiring && code) {
      this.judgeCount[line] = this.judgeCount[line]! + 1;
      this.judgeWait[line] = Electrocoin.JUDGE_WAIT;
      this.judging = true;
    }
  }
  private coinTimer = 0;
  private coinRow = 0;
  private coinMask = 0;
  get coinBusy(): boolean { return this.coinTimer > 0; }

  private coinCodeCache: { key: string; c: EcoinCoinCode | Refusal } | null = null;
  private coinCodeFound(): EcoinCoinCode | Refusal {
    const keyOf = (keys: readonly number[]): string => keys.map((a) => this.ram[a - RAM_BASE] ?? 0).join(',');
    const cached = this.coinCodeCache;
    if (cached && ('refused' in cached.c || cached.key === keyOf(cached.c.keys))) return cached.c;
    const c = locateEcoinCoins(this.rom, this.ram);
    this.coinCodeCache = { key: 'refused' in c ? '' : keyOf(c.keys), c };
    return c;
  }
  private coinCode(): EcoinCoinCode | null {
    const c = this.coinCodeFound();
    return 'refused' in c ? null : c;
  }

  private drawnLine(tableLine: number): number {
    const code = this.coinCode();
    if (!code) return tableLine;
    for (const s of this.coinSlots) if (code.aliases.get(s) === tableLine) return s;
    return tableLine;
  }

  get coinLineTable(): CoinLineTable | null {
    const code = this.coinCode();
    if (!code) return null;
    const t = code.table;
    return { ...t, lines: t.lines.map((l) => ({ ...l, line: this.drawnLine(l.line) })).sort((a, b) => a.line - b.line) };
  }

  get coinLineTableRefusal(): string | null {
    const c = this.coinCodeFound();
    return 'refused' in c ? c.refused : null;
  }

  private priced(): Map<number, SlotCoin> | null {
    const t = this.coinLineTable;
    return t ? ecoinProgramCoins(t) : null;
  }

  private programCoin(line: number): SlotCoin | null {
    const code = this.coinCode();
    const t = code?.aliases.get(line);
    if (t === undefined) return null;
    return this.priced()?.get(this.drawnLine(t)) ?? null;
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

  private static readonly JUDGE_WAIT = Math.round(1.5 * CLOCK);
  private judging = false;
  private readonly judgeCount = new Array<number>(64).fill(0);
  private readonly judgeWait = new Array<number>(64).fill(0);

  private judgeCoinStep(cycles: number): void {
    const code = this.coinCode();
    if (!code || !this.wiring) { this.judgeCount.fill(0); this.judgeWait.fill(0); this.judging = false; return; }
    const pc = this.cpu.pc;
    const take = code.take;
    if (take.pcs.includes(pc)) {
      let lines: readonly number[] = [];
      if (take.kind === 'record') {
        const l = take.recordLine.get((((this.cpu.d << 8) | this.cpu.e) - 2) & 0xffff);
        if (l !== undefined) lines = [l];
      } else {
        lines = take.indexLines.get(this.read((this.cpu.ix + take.ixOff) & 0xffff)) ?? [];
      }
      const line = lines.find((l) => this.judgeCount[l]! > 0);
      if (line !== undefined) {
        this.judgeCount[line] = this.judgeCount[line]! - 1;
        this.bookTaken(line);
      }
    }
    let any = false;
    for (let b = 0; b < 64; b++) {
      if (this.judgeCount[b]! <= 0) continue;
      this.judgeWait[b] = this.judgeWait[b]! - cycles;
      if (this.judgeWait[b]! <= 0) {
        this.coinsRefused += this.judgeCount[b]!;
        this.judgeCount[b] = 0;
        this.judgeWait[b] = 0;
        continue;
      }
      any = true;
    }
    this.judging = any;
  }

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
    return !!this.wiring && (!this.booksMoney || this.coinCode() !== null);
  }

  private bookTaken(line: number): void {
    const w = this.wiring!;
    if (!this.booksMoney || w.conflicts.includes(line)) return;
    const taken = this.programCoin(line);
    const c = w.coins.get(line);
    if (c === undefined) {
      if (taken) this.bookCoin(taken);
      return;
    }
    if (taken) {
      const agrees = typeof c === 'number'
        ? typeof taken === 'number' && taken === c
        : typeof taken === 'object' && (c.token === null || taken.token === null || c.token === taken.token);
      this.wiringState.state = agrees ? 'calibrated' : 'disagrees';
      if (!agrees) return;
    }
    this.bookCoin(c);
  }

  private bookCoin(c: SlotCoin): void {
    if (typeof c === 'number') this.ledger.inPence += c;
    else if (c.token === null) this.ledger.unpricedTokenIn++;
    else this.ledger.tokenInPence += c.token;
  }

  private coinSlots: number[] = [];

  setLayoutCoins(list: readonly DeclaredCoin[]): void {
    const slots = new Set<number>();
    for (const c of list) {
      if (c.named?.name.startsWith('ccTalk') || c.named?.name.startsWith('NV')) continue;
      if (c.pence !== null) continue;
      const line = ecoinSlotLine(c);
      if (line >= 0 && line < 64) slots.add(line);
    }
    this.coinSlots = [...slots].sort((a, b) => a - b);
  }

  get unnamedCoinLines(): readonly number[] {
    return this.coinSlots;
  }

  private meterInRaw: number[] = [];
  private meterOutRaw: number[] = [];
  private readonly gridTotals = { in: 0, out: 0 };

  get meterTotals(): { in: number; out: number } {
    return { in: this.gridTotals.in, out: this.gridTotals.out };
  }
}

export function ecoinSlotLine(c: Pick<DeclaredCoin, 'line' | 'button' | 'token'>): number {
  if (c.line !== null) return c.line;
  if (c.button !== null && c.button >= 0) return c.button;
  return c.token ? 3 : 4;
}
