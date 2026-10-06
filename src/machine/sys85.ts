import { ROM_UNPLACED } from './pairplacer';
import type { Bus } from '../cpu/bus';
import type { CabinetSwitch, Machine } from './machine';
import { newCashLedger, dilSwitchLabel } from './machine';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import { StatedLines } from './statedlines';
import { M6809 } from '../cpu/m6809';
import type { SlideEffect } from '../layout/fmlconfig';
import { Msc1937 } from '../hw/msc1937';
import { Bd1 } from '../hw/bd1';
import { Reel } from '../hw/reel';
import { MODEL_RELATIONS, parkAtV20PowerUp, resetReelsInPlace } from './v20optic';
import { Ay8910 } from '../hw/ay8910';
import { LampHistory } from '../hw/lamphistory';
import { DataPak } from '../hw/datapak';
import { MeterConfirm } from '../hw/meterconfirm';
import { fitReelBank, type ReelFit } from './reelfit';
import { noteRomCut } from './boarddefaults';
import { StrayCounter } from './strayaccess';

export const MASTER_CLOCK = 4_000_000;
export const CPU_CLOCK = MASTER_CLOCK / 4;

const SYS85_INDEX_TRAIL = 2;

const RAM_SIZE = 0x2000;
const METER_TICK_INSTRUCTIONS = 1000;
const ROM_SIZE = 0x10000;

const ADDRESS_DECODE = [
  0x0800, 0x1000, 0x0001, 0x0004, 0x0008, 0x0020, 0x0080, 0x0200,
  0x0100, 0x0040, 0x0002, 0x0010, 0x0400, 0x2000, 0x4000, 0x8000,
];
const DATA_DECODE = [0x02, 0x08, 0x20, 0x40, 0x10, 0x04, 0x01, 0x80];

export interface IoAccess {
  addr: number;
  reads: number;
  writes: number;
}

export class Sys85 implements Bus, Machine {
  static readonly snapshotConfig: readonly string[] = ['nvram'];
  readonly cpu: M6809;
  readonly ram = new Uint8Array(RAM_SIZE);
  readonly rom = new Uint8Array(ROM_SIZE);

  readonly vfd = new Msc1937();
  readonly bd1 = Object.assign(new Bd1(), { flashBase: 10_000 });
  bd1Drawn = false;

  readonly reels = parkAtV20PowerUp([0, 1, 2, 3, 4, 5].map(
    () => new Reel({
      stepsPerRevolution: 96, symbols: 16, mame: true,
      indexStart: 1, indexEnd: 3, indexPattern: 0, initPhase: 4,
      indexTrail: SYS85_INDEX_TRAIL,
    }),
  ), MODEL_RELATIONS.SYS85);

  setReelPosition(i: number, pos: number): void {
    this.reels[i]?.park(pos);
  }

  reelFit: ReelFit = { mask: 0x3f, channels: 6, beyond: [] };

  setFittedReels(channels: readonly number[]): ReelFit {
    this.reelFit = fitReelBank(this.reels, channels);
    return this.reelFit;
  }

  reelStripOffsets: number[] = [0, 0, 0, 0, 0, 0];

  readonly lampHistory = new LampHistory(128);
  get lamps(): Uint8Array {
    return this.lampHistory.level;
  }

  readonly inputRegs = new Uint8Array(8);
  private readonly idleInputs = new Uint8Array(8);

  readonly #stated = new StatedLines(8);

  postRestore(): void {
    this.#stated.reassert(this.idleInputs, this.inputRegs);
  }

  private readonly doorSwitches: { number: number; label: string }[] = [];

  private muxInputStrobe = 0;
  private muxInputAuto = false;
  private muxOutputLatch = 0;
  private muxOutputAuto = false;
  private muxModeInput = true;
  private readonly muxOutputs = new Uint8Array(16);

  private timerCycles = 0;
  private firqArmed = false;
  private timerFlag = false;
  private static readonly TIMER_CYCLES = 0x400;

  private aciaAssertingIrq(): boolean {
    return false;
  }

  private updateIrq(): void {
    this.cpu.setIRQ(this.timerFlag || this.aciaAssertingIrq());
  }

  private static readonly WATCHDOG_CYCLES = Math.floor(CPU_CLOCK * 0.1);
  private watchdogCycles = 0;
  watchdogResets = 0;

  readonly ay = new Ay8910(MASTER_CLOCK / 4, 'ay8910');

  meterLatch = 0;
  get meterLevels(): number { return this.meterLatch & 0xff; }
  readonly meterCounts = new Uint32Array(8);
  private readonly meterBank = new MeterConfirm();

  triacLatch = 0;

  readonly slideEjects = new Uint32Array(8);
  get triacLevels(): number {
    return this.triacLatch & 0xff;
  }

  readonly slidePence: SlideEffect[] = [null, null, null, null, null, null, null, null];

  setSlidePence(slides: readonly SlideEffect[]): void {
    for (let i = 0; i < 8; i++) this.slidePence[i] = slides[i] ?? null;
  }

  private bookSlide(i: number): void {
    const price = this.slidePence[i];
    if (typeof price === 'number') this.cashLedger.outPence += price;
    else if (price === 'token') this.cashLedger.tokenOutPence += Sys85.COIN_PENCE[Sys85.TOKEN_LINE] ?? 0;
    else this.cashLedger.unpricedOut++;
  }

  coinInhibits = 0;

  private static readonly COIN_DWELL = Math.floor(CPU_CLOCK * 0.06);
  private coinCycles = 0;
  private coinMask = 0;
  private static readonly COIN_PENCE = [10, 20, 50, 100, 20];
  private static readonly TOKEN_LINE = 4;
  readonly cashLedger = newCashLedger();

  private dataportFitted = false;

  private readonly dataPak = new DataPak(CPU_CLOCK);

  private nvram: Uint8Array | null = null;

  private readonly ioLog = new Map<number, IoAccess>();
  readonly io = new Uint8Array(0x4000);

  constructor() {
    this.cpu = new M6809(this);
    this.inputRegs.set(this.idleInputs);
  }

  get clockHz(): number {
    return CPU_CLOCK;
  }

  get display(): Msc1937 | Bd1 {
    return this.bd1Drawn ? this.bd1 : this.vfd;
  }

  get audioSource(): Ay8910 {
    return this.ay;
  }

  layoutLamp(n: number): boolean {
    return n >= 0 && n < this.lamps.length && this.lamps[n] !== 0;
  }

  layoutLampLevel(n: number): number {
    return n >= 0 && n < this.lamps.length ? this.lamps[n] : 0;
  }

  layoutInput(id: number, on: boolean): void {
    if (this.isPanelSwitch(id)) {
      const mask = 1 << (id & 7);
      if (on) this.idleInputs[id >> 3] |= mask;
      else this.idleInputs[id >> 3] &= ~mask & 0xff;
    }
    this.setInput(id >> 3, id & 7, on);
  }

  private isPanelSwitch(id: number): boolean {
    if (this.panel.some((s) => s.number === id)) return true;
    if (this.doorSwitches.some((d) => d.number === id)) return true;
    return id >= 48;
  }

  setInput(strobe: number, bit: number, on: boolean): void {
    if (strobe >= 8) return;
    const mask = 1 << bit;
    if (on) this.inputRegs[strobe] |= mask;
    else this.inputRegs[strobe] &= ~mask & 0xff;
  }

  private panel: LayoutSwitch[] = [];

  setLayoutSwitches(list: readonly LayoutSwitch[]): void {
    const wanted = list.filter((s) => s.number >= 0 && s.number < 64);
    if (!wanted.length) return;
    this.panel = wanted.map((s) => ({ ...s }));
    for (const s of wanted) this.idleInputs[s.number >> 3] &= ~(1 << (s.number & 7)) & 0xff;
    for (const s of wanted) {
      if (s.closed) this.idleInputs[s.number >> 3] |= 1 << (s.number & 7);
      this.#stated.stateLine(s.number, s.closed);
    }
    this.inputRegs.set(this.idleInputs);
  }

  private static readonly DOOR_SERVICE = 0x1d;
  private static readonly DOOR_CASH = 0x1e;
  private static readonly REFILL_KEY = 0x1c;

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    if (id < 0 || id >= 64) return;
    const mask = 1 << (id & 7);
    if (made) { this.idleInputs[id >> 3] |= mask; this.inputRegs[id >> 3] |= mask; }
    else { this.idleInputs[id >> 3] &= ~mask & 0xff; this.inputRegs[id >> 3] &= ~mask & 0xff; }
    this.#stated.stateLine(id, made);
    if (!this.doorSwitches.some((d) => d.number === id)) this.doorSwitches.push({ number: id, label });
  }

  static get serviceDoorDefault(): number { return Sys85.DOOR_SERVICE; }
  static get cashDoorDefault(): number { return Sys85.DOOR_CASH; }
  static get refillKeyDefault(): number { return Sys85.REFILL_KEY; }

  setDils(bank1: string | undefined, bank2: string | undefined): void {
    const bits = (s: string | undefined, strobe: number): void => {
      if (!s) return;
      for (let i = 0; i < 8; i++) {
        const mask = 1 << i;
        if (s[i] === '1') this.idleInputs[strobe] |= mask;
        else this.idleInputs[strobe] &= ~mask & 0xff;
      }
      this.#stated.state(strobe, 0xff, this.idleInputs[strobe]);
    };
    bits(bank1, 6);
    bits(bank2, 7);
    this.inputRegs.set(this.idleInputs);
  }

  private dilLabels: readonly string[] | null = null;

  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  get switchPanel(): CabinetSwitch[] {
    const state = (n: number): boolean => (this.inputRegs[n >> 3] & (1 << (n & 7))) !== 0;
    const repeats = new Map<string, number>();
    for (const s of this.panel) repeats.set(s.label, (repeats.get(s.label) ?? 0) + 1);
    const nth = new Map<string, number>();
    const out: CabinetSwitch[] = this.panel.map((s) => {
      const n = (nth.get(s.label) ?? 0) + 1;
      nth.set(s.label, n);
      const label = s.label
        ? (repeats.get(s.label)! > 1 ? `${s.label} ${n}` : s.label)
        : `Switch ${s.number}`;
      return { id: s.number, label, on: state(s.number) };
    });
    for (const d of this.doorSwitches) {
      if (!out.some((s) => s.id === d.number)) {
        out.push({ id: d.number, label: d.label, on: state(d.number) });
      }
    }
    for (let i = 0; i < 16; i++) {
      const id = 48 + i;
      out.push({
        id,
        label: dilSwitchLabel(`DIL${String(i + 1).padStart(2, '0')}`, this.dilLabels?.[i]),
        on: state(id),
        group: 'DIL switches',
        option: true,
        bootOnly: true,
      });
    }
    return out;
  }

  fitDataport(): void {
    this.dataportFitted = true;
  }

  private ackReady(): boolean {
    return false;
  }

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: '128 LAMPS', part: 'MUX - 16 latches x 8', device: this.lamps, signal: 'lamps' },
      { id: 'switches', label: 'SWITCH MUX', part: '8 strobes x 8', device: this.inputRegs },
      { id: 'meters', label: '8 METERS', part: 'electromechanical', device: this.meterCounts },
      { id: 'coins', label: 'COIN INPUTS', part: 'STROBE 0', signal: 'coin' },
      { id: 'mux', label: 'LAMP/INPUT MUX', part: '$2A00 data, $2A01 control', device: this.io },
      { id: 'ram', label: 'BATTERY RAM', part: '8K', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: '48K window', device: this.rom },
      { id: 'watchdog', label: 'WATCHDOG', part: '555', modelled: true,
        note: 'Modelled as a cycle counter and its kick, not as a device.' },
      { id: 'timer', label: 'TIMER IRQ', part: '1 kHz tick', modelled: true,
        note: 'Modelled as a cycle accumulator on this board, not as a timer chip.' },
      { id: 'alpha', label: 'VFD', part: 'MSC1937 - 16 char, bit-serial', device: this.vfd,
        signal: 'display' },
      { id: 'ay', label: 'SOUND', part: 'AY8912', device: this.ay },
      { id: 'acia', label: 'DATAPORT', part: 'MC6850 + protocol unit',
        ...(this.dataportFitted ? { modelled: true } : {}) },
      { id: 'cpu', label: 'CPU', part: 'MC6809 - 1 MHz E', device: this.cpu, cpu: true },
      { id: 'reels', label: `${this.reels.length} REELS`, part: 'Starpoint 96 half-step',
        device: this.reels, signal: 'reels' },
      { id: 'coinmech', label: 'COIN MECH', part: 'acceptor', signal: 'coin' },
    ];
  }

  insertCoin(line: number): void {
    if (this.coinCycles > 0) return;
    const bit = line & 7;
    this.coinMask = 1 << bit;
    this.inputRegs[0] |= this.coinMask;
    this.coinCycles = Sys85.COIN_DWELL;
    if (bit === Sys85.TOKEN_LINE) this.cashLedger.tokenInPence += Sys85.COIN_PENCE[bit] ?? 0;
    else this.cashLedger.inPence += Sys85.COIN_PENCE[bit] ?? 0;
  }

  get coinBusy(): boolean {
    return this.coinCycles > 0;
  }

  loadRom(files: Uint8Array[], decode = true): void {
    const raw = new Uint8Array(ROM_SIZE).fill(ROM_UNPLACED);
    for (const f of files) {
      if (f.length === 0x8000) raw.set(f, 0x8000);
      else if (f.length === 0x2000) raw.set(f, 0x6000);
      else if (f.length === 0x4000) raw.set(f, 0xc000);
      else {
        noteRomCut(this, f.length, 0x8000);
        raw.set(f.subarray(0, 0x8000), 0x8000);
      }
    }
    if (!decode) {
      this.rom.set(raw);
      return;
    }
    const codec = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      let out = 0;
      for (let b = 0; b < 8; b++) if (v & (1 << b)) out |= DATA_DECODE[b];
      codec[v] = out;
    }
    for (let a = 0; a < ROM_SIZE; a++) {
      let na = 0;
      for (let b = 0; b < 16; b++) if (a & (1 << b)) na |= ADDRESS_DECODE[b];
      this.rom[na] = codec[raw[a]];
    }
  }

  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, RAM_SIZE);
    this.ram.set(this.nvram);
  }

  powerCycle(): void {
    this.nvram = this.ram.slice();
    this.reset();
  }

  reset(): void {
    if (this.nvram) this.ram.set(this.nvram);
    else this.ram.fill(0);
    this.inputRegs.set(this.idleInputs);
    this.warmReset();
  }

  private warmReset(): void {
    this.vfd.reset();
    this.bd1.reset();
    resetReelsInPlace(this.reels);
    this.lampHistory.reset();
    this.muxOutputs.fill(0);
    this.io.fill(0);
    this.muxInputStrobe = 0;
    this.muxInputAuto = false;
    this.muxOutputLatch = 0;
    this.muxOutputAuto = false;
    this.muxModeInput = true;
    this.timerCycles = 0;
    this.firqArmed = false;
    this.timerFlag = false;
    this.watchdogCycles = 0;
    this.meterLatch = 0;
    this.meterBank.reset();
    this.triacLatch = 0;
    this.coinInhibits = 0;
    this.ay.reset();
    this.dataPak.reset();
    this.cpu.reset();
  }

  private noteIo(addr: number, isWrite: boolean): void {
    let e = this.ioLog.get(addr);
    if (!e) {
      e = { addr, reads: 0, writes: 0 };
      this.ioLog.set(addr, e);
    }
    if (isWrite) e.writes++;
    else e.reads++;
  }

  read8(addr: number): number {
    const a = addr & 0xffff;
    if (a < RAM_SIZE) return this.ram[a];
    if (a >= 0x4000) return this.rom[a];
    return this.readIo(a);
  }

  write8(addr: number, val: number): void {
    const a = addr & 0xffff;
    const v = val & 0xff;
    if (a < RAM_SIZE) {
      this.ram[a] = v;
      return;
    }
    if (a < 0x4000) {
      this.writeIo(a, v);
      return;
    }
    if (a >= 0x8000) {
      this.watchdogCycles = 0;
      if (this.timerFlag) {
        this.timerFlag = false;
        this.updateIrq();
      }
    }
  }

  private muxInputByte(strobe: number): number {
    if (strobe === 5) {
      let optics = 0;
      for (let i = 0; i < this.reels.length; i++) if (this.reels[i].optic()) optics |= 1 << i;
      return optics & this.reelFit.mask;
    }
    return ~this.inputRegs[strobe & 7] & 0xff;
  }

  private readIo(a: number): number {
    this.noteIo(a, false);
    if (a >= 0x2600 && a < 0x2800) return this.meterLatch;
    if (a === 0x2800) return this.triacLatch;
    if (a === 0x2a00) {
      if (this.muxModeInput) {
        const v = this.muxInputByte(this.muxInputStrobe);
        if (this.muxInputAuto) this.muxInputStrobe = (this.muxInputStrobe + 1) & 7;
        return v;
      }
      const v = this.muxOutputs[this.muxOutputLatch];
      if (this.muxOutputAuto) this.muxOutputLatch = (this.muxOutputLatch + 1) & 15;
      return v;
    }
    if (a === 0x2a01) return 0;
    if (a === 0x2e00) {
      if (this.timerFlag) return 0x01;
      return this.aciaAssertingIrq() ? 0x02 : 0x00;
    }
    if (a === 0x3402) return 0x02 | (this.ackReady() ? 0x01 : 0x00);
    if (a === 0x3403) return 0;
    if (a !== 0x3001 && a !== 0x3406 && a !== 0x3407) this.strays.hit(a);
    return this.io[a & 0x3fff];
  }

  readonly strays = new StrayCounter();

  private writeIo(a: number, v: number): void {
    this.noteIo(a, true);
    this.io[a & 0x3fff] = v;

    if (a >= 0x2000 && a < 0x2200) {
      this.reels[2]?.update((v >> 4) & 0x0f);
      this.reels[3]?.update(v & 0x0f);
      return;
    }
    if (a >= 0x2200 && a < 0x2400) {
      this.reels[0]?.update((v >> 4) & 0x0f);
      this.reels[1]?.update(v & 0x0f);
      return;
    }
    if (a >= 0x2400 && a < 0x2600) {
      this.coinInhibits = v & 0x1f;
      this.vfd.por((v & 0x20) !== 0);
      this.vfd.data(!(v & 0x40));
      this.vfd.sclk((v & 0x80) !== 0);
      this.bd1.serial(!(v & 0x20), !(v & 0x80), !(v & 0x40));
      return;
    }
    if (a >= 0x2600 && a < 0x2800) {
      this.meterLatch = v;
      this.meterBank.write(v & 0xff);
      if (v !== 0) {
        this.cpu.setFIRQ(true);
        this.firqArmed = true;
      }
      return;
    }
    if (a === 0x2800) {
      const rising = v & ~this.triacLatch;
      this.triacLatch = v;
      for (let b = 0; b < 8; b++) {
        if (rising & (1 << b)) {
          this.slideEjects[b]++;
          this.bookSlide(b);
        }
      }
      return;
    }
    if (a === 0x2a00) {
      this.muxOutputs[this.muxOutputLatch] = v;
      this.lampHistory.writeByte(this.muxOutputLatch * 8, v);
      if (this.muxOutputAuto) this.muxOutputLatch = (this.muxOutputLatch + 1) & 15;
      return;
    }
    if (a === 0x2a01) {
      switch ((v & 0xe0) >> 5) {
        case 2:
          this.muxInputStrobe = v & 7;
          this.muxInputAuto = (v & 0x10) !== 0;
          this.muxModeInput = true;
          break;
        case 3:
          this.muxOutputLatch = v & 0x0f;
          this.muxOutputAuto = (v & 0x10) !== 0;
          this.muxModeInput = false;
          break;
        case 4:
          this.muxOutputLatch = v & 0x0f;
          this.muxOutputAuto = (v & 0x10) !== 0;
          break;
        case 6:
          if (v === 0xc1) {
            this.muxOutputs.fill(0);
            for (let latch = 0; latch < 16; latch++) this.lampHistory.writeByte(latch * 8, 0);
          }
          break;
        default:
          break;
      }
      return;
    }
    if (a >= 0x3000 && a < 0x3200) {
      this.ay.write(v);
      return;
    }
    if (a >= 0x3200 && a < 0x3400) {
      this.ay.selectAddress(v);
      return;
    }
    if (a === 0x3402) return;
    if (a === 0x3403) {
      if (this.dataportFitted) this.dataPak.receive(v, this.cpu.cycles);
      return;
    }
    if (a === 0x3404) {
      this.reels[4]?.update((v >> 4) & 0x0f);
      this.reels[5]?.update(v & 0x0f);
      return;
    }
    if (a === 0x3600) return;
    if (a >= 0x2800 && a < 0x2a00) return;
    this.strays.hit(a);
  }

  step(): number {
    const dropFirq = this.firqArmed;

    const cycles = this.cpu.step();

    const confirmed = this.meterBank.advance(1, METER_TICK_INSTRUCTIONS);
    if (confirmed) for (let b = 0; b < 8; b++) if (confirmed & (1 << b)) this.meterCounts[b]++;

    if (dropFirq) {
      this.cpu.setFIRQ(false);
      this.firqArmed = false;
    }

    this.timerCycles += cycles;
    if (this.timerCycles >= Sys85.TIMER_CYCLES) {
      this.timerCycles -= Sys85.TIMER_CYCLES;
      this.timerFlag = true;
      this.updateIrq();
    }

    this.watchdogCycles += cycles;
    if (this.watchdogCycles >= Sys85.WATCHDOG_CYCLES) {
      this.watchdogCycles = 0;
      this.watchdogResets++;
      this.warmReset();
      return cycles;
    }

    this.ay.tick(cycles, CPU_CLOCK);
    this.bd1.tick(cycles);

    if (this.coinCycles > 0) {
      this.coinCycles -= cycles;
      if (this.coinCycles <= 0) {
        this.inputRegs[0] &= ~this.coinMask & 0xff;
        this.coinCycles = 0;
      }
    }

    return cycles;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  ioActivity(): IoAccess[] {
    return [...this.ioLog.values()].sort(
      (x, y) => y.reads + y.writes - (x.reads + x.writes),
    );
  }
}
