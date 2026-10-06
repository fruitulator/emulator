import type { Machine, MachineDisplay, CabinetSwitch, CashLedger, DigitKind } from './machine';
import { newCashLedger, dilSwitchLabel } from './machine';
import { Reel } from '../hw/reel';
import { Z80, type Z80Io } from '../cpu/z80';
import { I8255 } from '../hw/i8255';
import { Ay8910 } from '../hw/ay8910';
import { MuxLamps } from '../hw/muxlamps';
import { Msc1937 } from '../hw/msc1937';
import { Bd1 } from '../hw/bd1';
import { MeterConfirm } from '../hw/meterconfirm';
import type { ReelGeometry } from './layoutreels';
import type { LayoutSwitch } from './layoutswitches';
import type { BoardPart } from './parts';
import type { SlideEffect } from '../layout/fmlconfig';
import { noteRomCut } from './boarddefaults';
import { StrayCounter } from './strayaccess';

const CLOCK = 4_000_000;
const AY_CLOCK = 1_000_000;
const IRQ_PERIOD = 80_000;
const NMI_PERIOD = 0xc00;
const METER_TICK_INSTRUCTIONS = 1000;
const ROM_TOP = 0x8000;
const RAM_SIZE = 0x800;
const LAMP_COUNT = 256;
const DIGIT_COUNT = 16;
const REEL_COUNT = 4;

const REEL_STAND_IN_HALF_STEPS = 240;
const REEL_STAND_IN_STOPS = 24;
const STEP_BIT_MODULUS = 10;

const COIN_HOLD = Math.round(0.1 * CLOCK);
const COIN_GAP = Math.round(0.1 * CLOCK);

interface Sys1Reel {
  pos: number;
  steps: number;
  flip: boolean;
  present: boolean;
}

class Ppi {
  readonly chip: I8255;
  pins = [0, 0, 0];
  changed = [0, 0, 0];
  written = [false, false, false];
  inA = 0xff;
  inB = 0xff;
  inC = 0xff;

  constructor() {
    const out = (i: number) => (v: number) => {
      this.changed[i] |= this.pins[i] ^ v;
      this.pins[i] = v;
      this.written[i] = true;
    };
    this.chip = new I8255({
      outA: out(0), outB: out(1), outC: out(2),
      inA: () => this.inA, inB: () => this.inB, inC: () => this.inC,
    }, { modeSetKeepsLatches: true });
  }

  write(reg: number, v: number): void {
    this.changed[0] = this.changed[1] = this.changed[2] = 0;
    this.written[0] = this.written[1] = this.written[2] = false;
    this.chip.write(reg, v);
  }

  read(reg: number): number {
    return this.chip.read(reg);
  }

  reset(): void {
    this.chip.reset();
    this.pins = [0, 0, 0];
    this.changed = [0, 0, 0];
    this.written = [false, false, false];
  }
}

export class Sys1 implements Machine {
  static readonly snapshotConfig: readonly string[] = ['switches'];

  readonly digitKind: DigitKind = 'impact';
  readonly clockHz = CLOCK;
  readonly reelsByLayoutNumber = true;

  protected readonly cpu: Z80;
  private readonly ay = new Ay8910(AY_CLOCK);
  private readonly ic24 = new Ppi();
  private readonly ic25 = new Ppi();
  private readonly ic37 = new Ppi();

  readonly rom = new Uint8Array(ROM_TOP);
  readonly ram = new Uint8Array(RAM_SIZE);

  readonly lamps = new Uint8Array(LAMP_COUNT);
  private readonly mux = new MuxLamps(this.lamps);
  readonly digits = new Uint16Array(DIGIT_COUNT);
  readonly meters = new Uint32Array(8);
  private readonly meterBank = new MeterConfirm();
  readonly triacPulses = new Uint32Array(8);
  get triacLevels(): number {
    return this.triacs & 0x7f;
  }

  private readonly sreels: Sys1Reel[] = [];
  readonly reels: Reel[] = [];
  readonly vfd = new Msc1937();
  readonly bd1 = Object.assign(new Bd1(), { flashBase: 10_000 });
  alphaRoute: '10937' | 'bd1' | null = null;
  get display(): MachineDisplay | null {
    return this.alphaRoute === '10937' ? this.vfd : this.alphaRoute === 'bd1' ? this.bd1 : null;
  }
  get audioSource(): Ay8910 { return this.ay; }

  protected readonly matrix = new Uint8Array(8);
  private dip1 = 0;
  private dip2 = 0;
  private stepMode = 0;
  protected switches: LayoutSwitch[] = [];

  private strobe = 0;
  private strobeFresh = false;
  private pendingA = 0;
  private pendingAHeld = false;
  private pendingB = 0;
  private pendingBHeld = false;
  private lastIc25A = -1;
  private meterLines = 0;
  get meterLevels(): number { return this.meterLines; }
  private triacs = 0;
  private optos = 0;

  private cycles = 0;
  private irqCount = 0;
  private nmiCount = 0;
  private irqPending = false;
  private nmiPending = false;

  constructor(roms: readonly Uint8Array[], nvram?: Uint8Array) {
    let off = 0;
    for (const r of roms) {
      if (off >= ROM_TOP) break;
      this.rom.set(r.subarray(0, ROM_TOP - off), off);
      off += r.length;
    }
    noteRomCut(this, roms.reduce((n, r) => n + r.length, 0), ROM_TOP);
    if (nvram) this.ram.set(nvram.subarray(0, RAM_SIZE));
    for (let i = 0; i < REEL_COUNT; i++) {
      this.sreels.push({ pos: 0, steps: REEL_STAND_IN_HALF_STEPS, flip: false, present: false });
      this.reels.push(new Reel({
        stepsPerRevolution: REEL_STAND_IN_HALF_STEPS, symbols: REEL_STAND_IN_STOPS,
      }));
    }
    const io: Z80Io = {
      in: () => { this.irqPending = false; return 0xff; },
      out: () => { this.irqPending = false; },
    };
    this.cpu = new Z80({ read8: (a) => this.read(a), write8: (a, v) => this.write(a, v) }, io, {
      irqAck: () => { this.irqPending = false; return 0xff; },
    });
  }

  setReelGeometry(geometry: readonly ReelGeometry[]): void {
    for (const g of geometry) {
      if (g.number < 0 || g.number >= REEL_COUNT) continue;
      const r = this.sreels[g.number];
      r.present = true;
      if (g.halfSteps > 0) r.steps = g.halfSteps;
      else this.noteReelStandIn(g.number);
      r.flip = !!g.flip;
      if (!(g.stops > 0)) this.noteReelStandIn(g.number);
      this.reels[g.number] = new Reel({
        stepsPerRevolution: r.steps,
        symbols: g.stops > 0 ? g.stops : REEL_STAND_IN_STOPS,
      });
    }
  }

  readonly reelStandIns: number[] = [];

  private noteReelStandIn(n: number): void {
    if (this.reelStandIns.includes(n)) return;
    this.reelStandIns.push(n);
    this.reelStandIns.sort((a, b) => a - b);
  }

  setReelPosition(i: number, pos: number): void {
    const r = this.sreels[i];
    if (!r) return;
    r.pos = ((pos % r.steps) + r.steps) % r.steps;
    this.reels[i].position = r.pos;
    this.optos = this.opticByte();
  }

  setDips(d1: number, d2: number): void { this.dip1 = d1 & 0xff; this.dip2 = d2 & 0xff; }

  setStepMode(mode: number): void { this.stepMode = mode === 1 ? 1 : 0; }

  setSwitches(sw: LayoutSwitch[]): void {
    this.switches = sw;
    for (const s of sw) if (s.closed) this.layoutInput(s.number, true);
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    if (id < 0 || id >= Sys1.DIL_ID_BASE) return;
    this.layoutInput(id, made);
    if (this.switches.length && !this.switches.some((s) => s.number === id)) {
      this.switches = [...this.switches, { number: id, label, closed: made }];
    }
  }

  get switchPanel(): CabinetSwitch[] {
    const rows: CabinetSwitch[] = this.switches.map((s) => ({
      id: s.number, label: s.label,
      on: ((this.matrix[(s.number >> 3) & 7] >> (s.number & 7)) & 1) === 1,
    }));
    for (let i = 0; i < 16; i++) {
      const bank = i < 8 ? this.dip1 : this.dip2;
      rows.push({
        id: Sys1.DIL_ID_BASE + i,
        label: dilSwitchLabel(`Switch ${(i & 7) + 1} Bank ${i < 8 ? 'A' : 'B'}`, this.dilLabels?.[i]),
        on: (bank & (1 << (i & 7))) !== 0,
        group: 'Option switches',
        bootOnly: true,
        option: true,
      });
    }
    return rows;
  }

  private dilLabels: readonly string[] | null = null;
  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  private static readonly DIL_ID_BASE = 64;

  powerCycle(): void {
    this.reset();
  }

  reset(): void {
    this.cpu.reset();
    this.ic24.reset();
    this.ic25.reset();
    this.ic37.reset();
    this.ay.reset();
    this.vfd.reset();
    this.bd1.reset();
    this.strobe = 0;
    this.strobeFresh = false;
    this.pendingAHeld = this.pendingBHeld = false;
    this.lastIc25A = -1;
    this.meterLines = this.triacs = 0;
    this.meterBank.reset();
    this.irqCount = this.nmiCount = 0;
    this.irqPending = this.nmiPending = false;
    this.lamps.fill(0);
    this.mux.reset();
    this.cycles = 0;
    this.digits.fill(0);
    this.optos = this.opticByte();
    this.coinTimer = 0;
    this.coinInput = -1;
  }

  private read(a: number): number {
    if (a < ROM_TOP) return this.rom[a];
    if (a < 0xa000) return this.ram[a & (RAM_SIZE - 1)];
    if (a < 0xc000) {
      if (!(a & 0x40)) {
        this.ic24.inC = 0xb0 | (this.strobe === 10 ? 0x40 : 0);
        return this.ic24.read(a & 3);
      }
      if (!(a & 0x20)) return this.ic25.read(a & 3);
      if (!(a & 0x10)) {
        this.ic37Inputs(a & 3);
        return this.ic37.read(a & 3);
      }
      if (!(a & 0x200)) return this.ayRead();
      this.strays.hit(a);
      return 0xff;
    }
    if (a >= 0xe000) {
      this.nmiCount = 0;
      this.nmiPending = false;
      return 0xff;
    }
    return 0xff;
  }

  readonly strays = new StrayCounter();

  private write(a: number, v: number): void {
    if (a < ROM_TOP) return;
    if (a < 0xa000) { this.ram[a & (RAM_SIZE - 1)] = v; return; }
    if (a < 0xc000) {
      if (!(a & 0x20)) { this.ic25.write(a & 3, v); this.ic25Written(); return; }
      if (!(a & 0x40)) { this.ic24.write(a & 3, v); this.ic24Written(); return; }
      if (!(a & 0x200)) {
        if (a & 1) this.ay.write(v);
        else this.ay.selectAddress(v);
        return;
      }
      if (!(a & 0x10)) this.ic37.write(a & 3, v);
      else this.strays.hit(a);
      return;
    }
    if (a >= 0xe000) this.nmiCount = 0;
    else this.strays.hit(a);
  }

  private ayRead(): number {
    const r = this.ay.selectedAddress;
    if (r === 0x0e && !(this.ay.regs[7] & 0x40)) return ~this.dip1 & 0xff;
    if (r === 0x0f && !(this.ay.regs[7] & 0x80)) return ~this.dip2 & 0xff;
    return this.ay.read();
  }

  private ic37Inputs(reg: number): void {
    if (reg === 0) {
      this.ic37.inA = ~(this.matrix[0] ^ 0x80) & 0xff;
    } else if (reg === 1) {
      let b = this.strobe >= 1 && this.strobe <= 6 ? ~this.matrix[this.strobe] & 0xff : 0xff;
      if (this.sreels[3].present && this.sreels[3].flip) b = (b & 0x7f) | ((~this.optos & 8) << 4);
      this.ic37.inB = b;
    } else if (reg === 2) {
      let step = 0;
      for (let i = 0; i < REEL_COUNT; i++) if (this.sreels[i].pos % STEP_BIT_MODULUS === 0) step |= 1 << i;
      this.ic37.inC = step | ((this.optos << 4) & 0xf0);
    }
  }

  private ic24Written(): void {
    const p = this.ic24;
    if (p.changed[2] & 0x0f) {
      this.strobe = p.pins[2] & 0x0f;
      this.strobeFresh = true;
      if (this.strobe >= 1 && this.strobe <= 10) {
        if (this.pendingAHeld) this.writeDigit(this.strobe - 1, this.pendingA);
        if (this.pendingBHeld) this.mux.write(this.strobe - 1, this.pendingB, this.cycles);
        this.pendingAHeld = this.pendingBHeld = false;
      }
      this.mux.strobe(this.cycles);
    }
    if (p.written[0]) {
      if (this.strobe === 0) { this.pendingA = p.pins[0]; this.pendingAHeld = true; }
      else if (this.strobeFresh && this.strobe < 11) this.writeDigit(this.strobe - 1, p.pins[0]);
      this.strobeFresh = false;
    }
    if (p.written[1]) {
      if (this.strobe === 0) { this.pendingB = p.pins[1]; this.pendingBHeld = true; }
      else if (this.strobe < 11) this.mux.write(this.strobe - 1, p.pins[1], this.cycles);
    }
  }

  private ic25Written(): void {
    const p = this.ic25;
    const a = p.pins[0];
    if (a !== this.lastIc25A) {
      this.lastIc25A = a;
      const t = a & 0x7f;
      for (let i = 0; i < 7; i++) {
        if ((t & ~this.triacs) & (1 << i)) {
          this.triacPulses[i]++;
          this.bookSlide(i);
        }
      }
      this.triacs = t;
      for (let i = 0; i < 8; i++) this.lamps[0x60 + i] = (a >> i) & 1 ? 0xff : 0;
    }
    const b = p.pins[1];
    if (p.changed[1] & 0x22) {
      const nb = ~b & 0xff;
      this.vfd.por((nb & 0x20) !== 0);
      this.vfd.data((nb & 0x08) !== 0);
      this.vfd.sclk((nb & 0x02) === 0);
      this.bd1.serial((nb & 0x20) !== 0, (nb & 0x02) !== 0, (b & 0x08) === 0);
    }
    if (p.changed[1] & 0xf5) {
      const m = (b & 0x05) | ((b & 0x10) >> 3) | ((b & 0xe0) >> 2);
      this.meterBank.write(m);
      this.meterLines = m;
    }
    const c = p.pins[2];
    if ((p.changed[1] & 0x0a) && (~b & 0x0a)) {
      const ext = (c & 0x70) >> 4;
      const on = c & 0x80 ? 0xff : 0;
      if (!(b & 0x02)) this.lamps[87 - ext] = on;
      if (!(b & 0x08)) this.lamps[95 - ext] = on;
    }
    const clocks = p.changed[2] & c & 0x0f;
    if (clocks) this.driveReels((c & 0xf0) | clocks);
  }

  private writeDigit(d: number, v: number): void {
    if (d < DIGIT_COUNT) this.digits[d] = v & 0x7f;
  }

  private driveReels(v: number): void {
    for (let i = 0; i < REEL_COUNT; i++) {
      if (!((v >> i) & 1)) continue;
      const r = this.sreels[i];
      if (!r.present) continue;
      const step = r.flip ? 1 : 2 - this.stepMode;
      const d = (v >> (4 + i)) & 1 ? -step : step;
      r.pos = ((r.pos + d + r.steps) % r.steps) & ~(step - 1);
      this.reels[i].position = r.pos;
      this.reels[i].travel += d;
    }
    this.optos = this.opticByte();
  }

  private opticByte(): number {
    let o = 0;
    for (let i = 0; i < REEL_COUNT; i++) {
      const r = this.sreels[i];
      if (r.present && r.pos === (r.flip ? 2 : 0)) o |= 1 << i;
    }
    return o;
  }

  step(): number {
    if (this.irqCount >= IRQ_PERIOD) { this.irqCount -= IRQ_PERIOD; this.irqPending = true; }
    if (this.nmiCount >= NMI_PERIOD) { this.nmiCount -= NMI_PERIOD; this.nmiPending = true; }
    if (this.nmiPending) {
      this.nmiPending = false;
      this.cpu.setNMI(true);
      this.cpu.setNMI(false);
    }
    this.cpu.setIRQ(this.irqPending);
    const c = this.cpu.step();
    this.cycles += c;
    const confirmed = this.meterBank.advance(1, METER_TICK_INSTRUCTIONS);
    if (confirmed) for (let i = 0; i < 8; i++) if (confirmed & (1 << i)) this.meters[i]++;
    this.bd1.tick(c);
    this.irqCount += c;
    this.nmiCount += c;
    this.ay.tick(c, CLOCK);
    if (this.coinTimer > 0) {
      const was = this.coinTimer;
      this.coinTimer -= c;
      if (was > COIN_GAP && this.coinTimer <= COIN_GAP && this.coinInput >= 0) {
        this.layoutInput(this.coinInput, false);
        this.coinInput = -1;
      }
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
    return c;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: 'LAMPS', part: '80 multiplexed + 16 extender + 8', device: this.lamps },
      { id: 'sevenseg', label: '7-SEG', part: '10 digits, strobed', device: this.digits },
      { id: 'meters', label: 'METERS', part: 'pulse counts - IC25 port B', device: this.meters },
      { id: 'switches', label: 'SWITCHES', part: '6 strobed rows + coins/door', device: this.matrix },
      { id: 'coins', label: 'COIN INPUTS', part: 'IC37 port A', modelled: true,
        note: 'Modelled as timed matrix pulses (insertCoin), not as a mech.' },
      { id: 'ic24', label: 'IC24', part: '8255 - lamps, 7-seg, strobe', device: this.ic24 },
      { id: 'ic25', label: 'IC25', part: '8255 - triacs, meters, reels', device: this.ic25 },
      { id: 'ic37', label: 'IC37', part: '8255 - inputs, reel optos', device: this.ic37 },
      { id: 'ram', label: 'BATTERY RAM', part: '2K at $8000', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: '32K from $0000', device: this.rom },
      { id: 'ay', label: 'SOUND', part: 'AY-3-8910 - DIP banks on its ports', device: this.ay },
      { id: 'cpu', label: 'CPU', part: 'Z80 - 4 MHz', device: this.cpu, cpu: true },
      { id: 'reels', label: '4 REELS', part: 'stepper, IC25 port C', device: this.sreels },
      { id: 'hopper', label: 'HOPPER', part: 'not modelled' },
      { id: 'alpha', label: 'ALPHA', part: '16 char, bit-serial - IC25 port B',
        device: this.display ?? this.vfd, signal: 'display' },
    ];
  }

  layoutLamp(n: number): boolean {
    return n >= 0 && n < LAMP_COUNT && this.lamps[n] !== 0;
  }

  layoutLampLevel(n: number): number {
    return n >= 0 && n < LAMP_COUNT ? this.lamps[n] : 0;
  }

  layoutDigit(n: number): number {
    return n >= 0 ? this.digits[n & 15] : 0;
  }

  layoutInput(id: number, on: boolean): void {
    if (id >= Sys1.DIL_ID_BASE && id < Sys1.DIL_ID_BASE + 16) {
      const n = id - Sys1.DIL_ID_BASE;
      const mask = 1 << (n & 7);
      const raise = (v: number): number => (on ? v | mask : v & ~mask & 0xff);
      if (n < 8) this.dip1 = raise(this.dip1);
      else this.dip2 = raise(this.dip2);
      return;
    }
    if (id < 0 || id > 63) return;
    const row = id >> 3;
    const b = id & 7;
    if (on) this.matrix[row] |= 1 << b;
    else this.matrix[row] &= ~(1 << b);
  }

  readonly cashLedger: CashLedger = newCashLedger();

  private readonly slidePence: SlideEffect[] = new Array(7).fill(null);
  readonly slideEjects = new Uint32Array(7);

  setSlidePence(slides: readonly SlideEffect[]): void {
    for (let i = 0; i < 7; i++) this.slidePence[i] = slides[i] ?? null;
  }

  private bookSlide(i: number): void {
    const p = this.slidePence[i];
    if (p === null || p === undefined) return;
    this.slideEjects[i]++;
    if (typeof p === 'number') this.cashLedger.outPence += p;
    else if (p === 'token') this.cashLedger.unpricedTokenOut++;
    else this.cashLedger.unpricedOut++;
  }

  private static readonly COIN_PENCE: (number | null)[] = [20, 10, null, 50, 100];

  insertCoin(bit: number): void {
    if (this.coinTimer > 0 || bit < 0 || bit > 63) return;
    this.coinInput = bit;
    this.layoutInput(bit, true);
    this.coinTimer = COIN_HOLD + COIN_GAP;
    const p = Sys1.COIN_PENCE[bit];
    if (typeof p === 'number') this.cashLedger.inPence += p;
  }
  private coinTimer = 0;
  private coinInput = -1;
  get coinBusy(): boolean { return this.coinTimer > 0; }
}
