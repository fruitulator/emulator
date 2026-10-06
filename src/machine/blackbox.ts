import { placeRomFlat } from './pairplacer';
import { HD6303Y } from '../cpu/m6303';
import type { Bus } from '../cpu/bus';
import { Pia6821 } from '../hw/pia6821';
import { Reel } from '../hw/reel';
import type { AudioSource, CabinetSwitch, Machine, MachineDisplay, DigitKind } from './machine';
import { newCashLedger, ledgerOutMults } from './machine';
import type { SlideEffect } from '../layout/fmlconfig';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import type { ReelGeometry } from './layoutreels';
import { COIN_RAW } from './coinraw';
import { noteRomCut } from './boarddefaults';
import { BbTone, bbTonePeriod, type BbSoundType } from '../hw/bbtone';
import { resetReelsInPlace } from './v20optic';
import { StrayCounter } from './strayaccess';

export const BLACKBOX_CLOCK = 1_000_000;

const NMI_CYCLES = 10_000;
const IRQ_CYCLES = 2_000;
const METER_TICK_SLICES = 1000;
const METER_HOLD_TICKS = 5;
const METER_UNIT_PENCE = 2;

const SEGMENTS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0, 0, 0, 0, 0xb4, 0];

const DIGIT_PAGE: Record<number, number> = { 0x600: 0, 0x580: 1, 0x200: 2, 0x480: 3, 0x500: 4 };
const LAMP_PAGE: Record<number, number> = { 0x200: 0x48, 0x280: 0x40, 0x300: 0x38, 0x380: 0x30, 0x400: 0x28, 0x480: 0x20 };

const OPTIC_TABLE = (() => {
  const t = new Uint8Array(400);
  for (let i = -7; i < 7; i++) t[(i + 400) % 400] |= 2;
  for (let g = 0; g < 8; g++) {
    const base = g * 50;
    for (const c of [0, 17, 34]) for (let i = -5; i < 6; i++) t[(base + c + i + 400) % 400] |= 1;
  }
  return t;
})();

const COIN_HOLD = Math.floor(BLACKBOX_CLOCK * 0.1);
const COIN_TAIL = Math.floor(BLACKBOX_CLOCK * 0.005);

export class BlackBox implements Bus, Machine {
  static readonly snapshotConfig: readonly string[] = ['switches'];

  readonly digitKind: DigitKind = 'byte16';
  readonly clockHz = BLACKBOX_CLOCK;
  readonly cpu: HD6303Y;
  readonly display: MachineDisplay | null = null;
  readonly tone = new BbTone();
  get audioSource(): AudioSource {
    return this.tone;
  }
  private soundType: BbSoundType | null = null;
  setSoundType(t: BbSoundType | null): void {
    this.soundType = t;
  }

  readonly ram = new Uint8Array(0x80);
  readonly rom = new Uint8Array(0x2000);
  readonly nvram = new Uint8Array(64);
  nvramFitted = true;
  row5Shift = 0;

  readonly matrix = new Uint8Array(8);
  readonly lamps = new Uint8Array(0x60);
  readonly digits = new Uint8Array(16);
  readonly meterCounts = new Uint32Array(8);
  readonly cashLedger = newCashLedger();
  private meterInPence: number[] = [];
  private meterOutPence: number[] = [];

  setMeterMoney(inMult: readonly number[], outMult: readonly number[]): void {
    this.meterInPence = inMult.map((x) => x * METER_UNIT_PENCE);
    this.meterOutPence = ledgerOutMults({ in: inMult, out: outMult })[0].map((x) => x * METER_UNIT_PENCE);
  }

  setSlidePence(slides: readonly SlideEffect[]): void {
    for (let i = 0; i < 16; i++) this.slidePence[i] = slides[i] ?? null;
  }

  private readonly pia: Pia6821;
  private ora = 0;
  private orb = 0;
  private nvAddr = 0;
  private readonly latch = new Uint8Array(6);
  private dirLatch = 0;
  private triacWord = 0;
  readonly triacPulses = new Uint32Array(16);
  readonly slideEjects = new Uint32Array(16);
  get triacLevels(): number {
    return this.triacWord & 0xffff;
  }
  private slidePence: SlideEffect[] = new Array(16).fill(null);
  slideOutPence = 0;

  private reelSet: Reel[] = [];
  private optics = 0;

  private nmiAcc = 0;
  private irqAcc = 0;
  private irqRaised = false;
  private slices = 0;
  private readonly meterHold = new Uint8Array(8);
  private meterWord = 0;
  get meterLevels(): number { return this.meterWord & 0xff; }

  private coinMask = 0;
  private coinTimer = 0;

  private switches: LayoutSwitch[] = [];

  constructor(prog: Uint8Array[], nvram?: Uint8Array) {
    this.cpu = new HD6303Y(this, 'm6800');
    this.pia = new Pia6821({
      writeA: (v) => this.portA(v),
      writeB: (v) => { this.orb = v; },
      readB: () => this.nvramPins(),
    });
    this.loadRom(prog);
    if (nvram) this.loadNvram(nvram);
  }

  loadRom(files: readonly Uint8Array[]): void {
    const { image, placed, total } = placeRomFlat(files, { max: 0x10000, reverse: true });
    this.rom.set(image.subarray(0x10000 - this.rom.length));
    noteRomCut(this, Math.max(total, placed), this.rom.length);
  }

  loadNvram(data: Uint8Array): void {
    for (let i = 0; i < 64 && i < data.length; i++) this.nvram[i] = data[i] & 0x0f;
  }

  setReelGeometry(geo: readonly ReelGeometry[]): void {
    this.standIns.length = 0;
    this.reelSet = geo.map((g) => {
      const steps = g.halfSteps > 0 ? g.halfSteps : BlackBox.REEL_STAND_IN_HALF_STEPS;
      const stops = g.stops > 0 ? g.stops : BlackBox.REEL_STAND_IN_STOPS;
      if (g.halfSteps <= 0 || g.stops <= 0) this.standIns.push(g.number);
      return new Reel({ stepsPerRevolution: steps, symbols: stops });
    });
    this.standIns.sort((a, b) => a - b);
    this.recomputeOptics();
  }

  private static readonly REEL_STAND_IN_HALF_STEPS = 0x60;
  private static readonly REEL_STAND_IN_STOPS = 12;

  get reelStandIns(): readonly number[] { return this.standIns; }
  private readonly standIns: number[] = [];

  get reels(): readonly Reel[] {
    return this.reelSet;
  }

  setReelPosition(i: number, pos: number): void {
    const r = this.reelSet[i];
    if (!r) return;
    r.park(pos);
    this.recomputeOptics();
  }

  setSwitches(sw: LayoutSwitch[]): void {
    this.switches = sw;
    for (const s of sw) if (s.closed) this.layoutInput(s.number, true);
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    this.layoutInput(id, made);
    if (this.switches.length && !this.switches.some((s) => s.number === id)) {
      this.switches = [...this.switches, { number: id, label, closed: made }];
    }
  }

  get switchPanel(): CabinetSwitch[] {
    return this.switches.map((s) => ({
      id: s.number, label: s.label,
      on: ((this.matrix[s.number >> 3] >> (s.number & 7)) & 1) === 1,
    }));
  }

  powerCycle(): void {
    this.reset();
  }

  reset(): void {
    this.ram.fill(0);
    this.pia.reset();
    this.ora = this.orb = 0;
    this.nvAddr = 0;
    this.latch.fill(0);
    this.dirLatch = 0;
    this.triacWord = 0;
    this.lamps.fill(0);
    this.digits.fill(0);
    this.nmiAcc = this.irqAcc = 0;
    this.irqRaised = false;
    this.slices = 0;
    this.meterHold.fill(0);
    this.meterWord = 0;
    this.coinMask = 0;
    this.coinTimer = 0;
    resetReelsInPlace(this.reelSet);
    this.tone.reset();
    this.recomputeOptics();
    this.cpu.reset();
    this.cpu.irq1Enabled = true;
  }

  step(): number {
    const c = this.cpu.step();
    if (this.irqRaised) { this.cpu.setIRQ1(false); this.irqRaised = false; }
    this.slices++;
    if (this.slices % METER_TICK_SLICES === 0) this.tickMeters();
    this.tone.tick(c, BLACKBOX_CLOCK);
    this.nmiAcc += c;
    this.irqAcc += c;
    if (this.nmiAcc > NMI_CYCLES) {
      this.nmiAcc -= NMI_CYCLES;
      this.cpu.setNMI(true);
      this.cpu.setNMI(false);
    } else if (this.irqAcc > IRQ_CYCLES) {
      this.irqAcc -= IRQ_CYCLES;
      if (!(this.cpu.cc & 0x10)) { this.cpu.setIRQ1(true); this.irqRaised = true; }
    }
    if (this.coinTimer > 0) {
      this.coinTimer -= c;
      if (this.coinTimer <= COIN_TAIL) this.matrix[0] &= ~this.coinMask;
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
    return c;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  read8(addr: number): number {
    addr &= 0xffff;
    if ((addr & 0xffff) < 0x80) return this.ram[addr];
    switch (addr & 0x7800) {
      case 0x0800: return (addr & 1) === 0 ? 0x02 : 0;
      case 0x1000: return this.pia.read(addr & 3);
      case 0x1800: return this.inputs1800(addr & 7);
      case 0x2000: return this.inputs2000(addr & 7);
      case 0x6000: case 0x6800: case 0x7000: case 0x7800: return this.rom[addr & 0x1fff];
      default: this.strays.hit(addr); return 0;
    }
  }

  readonly strays = new StrayCounter();

  write8(addr: number, v: number): void {
    addr &= 0xffff;
    v &= 0xff;
    if (addr < 0x80) { this.ram[addr] = v; return; }
    const block = addr & 0x7800;
    if (block === 0) { this.outputPage(addr & 0x780); return; }
    switch (block) {
      case 0x0800: return;
      case 0x1000: this.pia.write(addr & 3, v); return;
      case 0x2800:
        this.setLatch(0, 0x10);
        this.triacWrite((this.triacWord & 0xff00) | this.latch[0]);
        return;
      case 0x3000:
        this.setLatch(1, 0x18);
        this.triacWrite((this.triacWord & 0x00ff) | (this.latch[1] << 8));
        return;
      case 0x3800: this.setLatch(2, 0x50); this.meterWrite(this.latch[2]); return;
      case 0x4000: this.setLatch(3, 0x00); return;
      case 0x4800: this.setLatch(4, 0x08); return;
      case 0x5000: {
        this.latch[5] = this.latchBit(this.latch[5]);
        this.lamps[0x58] = this.latch[5] & 0x80 ? 1 : 0;
        this.lamps[0x59] = this.latch[5] & 0x40 ? 1 : 0;
        return;
      }
      case 0x5800: this.strays.hit(addr); return;
      default: return;
    }
  }

  private latchBit(old: number): number {
    const a = (this.orb >> 5) & 7;
    const d = (this.orb >> 4) & 1;
    return (old & ~(1 << a)) | (d << a);
  }

  private setLatch(i: number, lampBase: number): void {
    this.latch[i] = this.latchBit(this.latch[i]);
    for (let b = 0; b < 8; b++) this.lamps[lampBase + b] = (this.latch[i] >> b) & 1;
  }

  private outputPage(page: number): void {
    const a = (this.orb >> 5) & 7;
    const d = (this.orb >> 4) & 1;
    const v = (this.orb >> 4) & 0x0f;
    if (page === 0x100) { this.stepReel(v); return; }
    if (page === 0x180) { this.dirLatch = (this.dirLatch & ~(1 << a)) | (d << a); return; }
    const digit = DIGIT_PAGE[page];
    if (digit !== undefined) this.digits[digit] = SEGMENTS[v];
    const lamp = LAMP_PAGE[page];
    if (lamp !== undefined) this.lamps[lamp + a] = d;
    if (this.soundType !== null) {
      const period = bbTonePeriod(this.soundType, page, v);
      if (period !== null) this.tone.setPeriod(period);
    }
  }

  private portA(v: number): void {
    const changed = this.ora ^ v;
    if (changed & v & 0x40) this.nvAddr = v & 0x3f;
    if (changed & 0x80 && (v & 0xc0) === 0x40 && this.nvramFitted) this.nvram[this.nvAddr] = this.orb & 0x0f;
    this.ora = v;
  }

  private nvramPins(): number {
    return this.ora & 0x40 && this.nvramFitted ? this.nvram[this.nvAddr] & 0x0f : 0x0f;
  }

  private inputs2000(bit: number): number {
    const en = this.latch[5];
    let v = (this.matrix[0] >> bit) & 1;
    if (en & 1) v |= (this.matrix[1] >> bit) & 1;
    if (en & 2) v |= (this.matrix[3] >> bit) & 1;
    return v << 7;
  }

  private inputs1800(bit: number): number {
    const en = this.latch[5];
    let v = 0;
    if (en & 1) v |= (this.matrix[2] >> bit) & 1;
    if (en & 2) v |= (this.matrix[4] >> bit) & 1;
    if (en & 4) v |= (this.optics >> bit) & 1;
    if ((8 << this.row5Shift) & en && bit < 2) v |= (this.matrix[5] >> bit) & 1;
    return v << 7;
  }

  layoutInput(id: number, on: boolean): void {
    if (id < 0 || id >= this.matrix.length * 8) return;
    if (on) this.matrix[id >> 3] |= 1 << (id & 7);
    else this.matrix[id >> 3] &= ~(1 << (id & 7));
  }

  private stepReel(v: number): void {
    if (!(v & 1)) return;
    const r = (v >> 1) & 3;
    const reel = this.reelSet[r];
    if (!reel) return;
    const m = 1 << r;
    const steps = reel.stepsPerRevolution;
    let delta = (m << 4) & this.dirLatch ? -1 : (reel.position & 1 ? -1 : -2);
    if (this.dirLatch & m) delta = -delta;
    reel.position = (((reel.position + delta) % steps) + steps) % steps;
    reel.travel += delta;
    this.recomputeOptics();
  }

  private recomputeOptics(): void {
    let o = 0xff;
    this.reelSet.forEach((reel, r) => {
      const m = 1 << r;
      const steps = reel.stepsPerRevolution;
      const i = ((steps - reel.position) % steps) % OPTIC_TABLE.length;
      if (OPTIC_TABLE[i] & 2) o &= ~(m << 4);
      if (OPTIC_TABLE[i] & 1) o &= ~m;
    });
    this.optics = o & 0xff;
  }

  private triacWrite(word: number): void {
    const rising = word & ~this.triacWord;
    this.triacWord = word;
    if (rising === 0) return;
    const metered = this.meterOutPence.some((p) => p);
    for (let i = 0; i < 16; i++) {
      if (!(rising & (1 << i))) continue;
      this.triacPulses[i]++;
      const p = this.slidePence[i];
      if (p === null) continue;
      this.slideEjects[i]++;
      if (typeof p === 'number') this.slideOutPence += p;
      if (metered) continue;
      if (p === 'token') this.cashLedger.unpricedTokenOut++;
      else if (p === 'unpriced') this.cashLedger.unpricedOut++;
      else this.cashLedger.outPence += p;
    }
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
      this.cashLedger.inPence += this.meterInPence[b] ?? 0;
      this.cashLedger.outPence += this.meterOutPence[b] ?? 0;
    }
  }

  insertCoin(id: number): void {
    if (this.coinTimer > 0 || id < 0 || id >= COIN_RAW.length) return;
    const raw = COIN_RAW[id];
    if (raw & 0x100) return;
    this.coinMask = raw & 0xff;
    this.matrix[0] |= this.coinMask;
    this.coinTimer = COIN_HOLD + COIN_TAIL;
  }

  get coinBusy(): boolean {
    return this.coinTimer > 0;
  }

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: 'LAMPS', part: '6 latches + output page - $5A lamps', device: this.lamps },
      { id: 'sevenseg', label: '7-SEG', part: '5 digits on the output page', device: this.digits },
      { id: 'meters', label: 'METERS', part: 'pulse counts - latch $3800', device: this.meterCounts },
      { id: 'switches', label: 'SWITCHES', part: '6 rows, one bit per address - $1800/$2000', device: this.matrix },
      { id: 'coins', label: 'COIN INPUTS', part: 'row 0', modelled: true,
        note: 'Timed matrix makes (insertCoin) from the CoinNoteId table - not a mech.' },
      { id: 'pia', label: 'PIA', part: 'MC6821 - latch bus, NVRAM', device: this.pia },
      { id: 'acia', label: 'ACIA', part: 'MC6850 - nothing attached' },
      { id: 'nvram', label: 'NVRAM', part: '64 x 4 on port A', device: this.nvram },
      { id: 'rom', label: 'PROGRAM ROM', part: '8K card - $6000-$7FFF', device: this.rom },
      { id: 'cpu', label: 'CPU', part: 'MC6802 - 1 MHz', device: this.cpu, cpu: true },
      { id: 'reels', label: '3 REELS', part: 'stepper, output page $100', device: this.reelSet },
      { id: 'tone', label: 'SOUND', part: this.soundType === null ? 'tone generator - not stated' : ['NE566', 'NE555', 'NE555-2'][this.soundType], device: this.tone },
    ];
  }

  layoutLamp(n: number): boolean {
    return n >= 0 && n < this.lamps.length && this.lamps[n] !== 0;
  }

  layoutDigit(n: number): number {
    return n >= 0 && n < this.digits.length ? this.digits[n] : 0;
  }
}
