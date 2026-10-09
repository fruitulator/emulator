import type { Bus16 } from '../cpu/bus68k';
import type { AudioSource, CabinetSwitch, Machine, MachineDisplay, DigitKind } from './machine';
import type { BoardPart } from './parts';
import { newCashLedger, ledgerOutMults, dilSwitchLabel } from './machine';
import type { Reel } from '../hw/reel';
import { M68000 } from '../cpu/m68000';
import { M68340Sim, MBAR_ADDR, RSR_WATCHDOG, SPURIOUS_VECTOR, OFF_PORTA, OFF_DDRA } from '../hw/m68340';
import { EpochReels } from '../hw/epochreels';
import { Hopper, v20Waveform } from '../hw/hopper';
import { Eeprom24c, I2cBitBang } from '../hw/eeprom';
import type { ReelGeometry } from './layoutreels';
import type { LayoutSwitch } from './layoutswitches';
import { AstraDotAlpha } from '../hw/astradotalpha';
import { AstraSound, ASTRA_SOUND_RATE } from '../hw/astrasound';
import { Mixer } from '../hw/mixer';
import { Mc68681 } from '../hw/mc68681';
import { DataPak, V20_CPU32_DATAPAK_CLOCK } from '../hw/datapak';
import { Sec } from '../hw/sec';
import { noteRomCut } from './boarddefaults';
import { StrayCounter } from './strayaccess';
import { ROM_UNPLACED } from './pairplacer';
import { COIN_RAW } from './coinraw';
import { placeV20RomList } from './v20romlist';

export const PLUTO5_CLOCK = 32_768 * 4 * 64 * 2;

const ROM_SIZE = 0x800000;
const RAM_SIZE = 0x10000;

const COLUMN_ROW = [8, 4, 5, 8, 6, 8, 8, 8, 7, 8, 8, 8, 8, 8, 8, 8];
const SOUND_PERIOD = [0x1062, 0x831, 0x418, 0x20c];
const DUART_IRQ_LEVEL = 5;
const DUART_IRQ_VECTOR = 0x1d;
const DUART_X1 = 3_686_400;
const COIN_ROW = 3;
const COIN_HOLD = Math.floor(PLUTO5_CLOCK * 0.02);
const COIN_TAIL = Math.floor(PLUTO5_CLOCK * 0.005);
const HOPPER_TICK_CYCLES = 0x4083;

export class Pluto5 implements Bus16, Machine {
  static readonly snapshotConfig: readonly string[] = ['switches', 'nvram'];

  readonly digitKind: DigitKind = 'byte16';
  readonly cpu: M68000;
  readonly sim: M68340Sim;
  readonly rom = new Uint8Array(ROM_SIZE);
  readonly ram = new Uint8Array(RAM_SIZE);
  private nvram: Uint8Array | null = null;

  readonly matrix = new Uint8Array(16);
  dip1 = 0;
  dip2 = 0;

  private readonly outputs = new Uint8Array(8);
  private column = 0;
  private strobe = 0;
  private readonly lampWord = new Uint16Array(16);
  private readonly ledWord = new Uint16Array(16);
  private aux = 0xff;
  private portAShadow = 7;

  readonly lamps = new Uint8Array(256);
  readonly digits = new Uint8Array(16);

  private coinMask = 0;
  private coinTimer = 0;

  private switches: LayoutSwitch[] = [];
  private readonly doorSwitches: { number: number; label: string; made: boolean }[] = [];
  private dilLabels: readonly string[] | null = null;

  private reelDrive = new EpochReels([], { opticInverted: false });

  static readonly HOPPER_WAVEFORM = v20Waveform((HOPPER_TICK_CYCLES / PLUTO5_CLOCK) * 1000, { beam: 0x19 + 1, gap: 0x96, start: 0x96, settle: 1 });
  readonly hopper = new Hopper(PLUTO5_CLOCK, Pluto5.HOPPER_WAVEFORM);
  hopperEjects = 0;

  readonly sec = (() => {
    const sec = new Sec();
    sec.fitV20(true);
    return sec;
  })();

  readonly duarts = [0, 1, 2].map(() => new Mc68681());
  private duartAcc = 0;

  private readonly i2c: I2cBitBang;

  readonly dot = new AstraDotAlpha();
  get display(): MachineDisplay | null { return this.dotFitted ? this.dot : null; }
  dotFitted = false;

  readonly voices = [new AstraSound(ASTRA_SOUND_RATE), new AstraSound(ASTRA_SOUND_RATE)];
  private readonly mixer = new Mixer(this.voices);
  get audioSource(): AudioSource { return this.mixer; }
  private readonly ch = [0, 1].map(() => ({
    rate: 3, phase: 0, shift: 0x80, period: SOUND_PERIOD[3], running: false, acc: 0, request: false,
  }));

  readonly dataPak = new DataPak(V20_CPU32_DATAPAK_CLOCK);
  private dataPakType = 0;
  private dataPakOut: number[] = [];
  private dataPakWait = 0;
  private static readonly DATAPAK_TURNAROUND = 50_000;

  readonly cashLedger = newCashLedger();
  private secInMult: number[] = [];
  private secOutMult: number[] = [];
  private secLedgerMult: number[] = [];
  readonly secTotals = { in: 0, out: 0 };
  private static readonly SEC_UNIT_PENCE = 10;

  readonly io = new Map<string, number>();
  readonly strays = new StrayCounter();
  private irqLevel = 0;

  constructor() {
    this.sim = new M68340Sim({
      watchdogReset: () => this.onWatchdog(),
      portAIn: () => this.portAPins(),
      portBIn: () => 0,
      portWrite: () => this.portWrite(),
      serialTx: (ch, v) => this.onSerialTx(ch, v),
      serialOutputPort: (opr) => this.serialPins(~opr & 0xff),
      busRead8: (a) => this.read8(a),
      busWrite8: (a, v) => this.write8(a, v),
      busRead16: (a) => this.read16(a),
      busWrite16: (a, v) => this.write16(a, v),
      dmaStart: (ch) => this.dmaStart(ch),
      dmaStop: (ch) => this.dmaStop(ch),
    }, 130_000_000, PLUTO5_CLOCK);
    const dev = { start: () => {}, stop: () => {}, write: () => {}, read: () => 0 };
    this.i2c = new I2cBitBang(dev as unknown as Eeprom24c);
    this.cpu = new M68000(this, { variant: 'cpu32' });
    this.cpu.onInterruptAck = (level) => this.interruptAck(level);
    this.cpu.onResetInstruction = () => this.sim.moduleReset();
    this.sec.onCount = (meter, delta) => this.secCount(meter, delta);
  }

  loadRom(parts: readonly Uint8Array[]): void {
    this.rom.fill(ROM_UNPLACED);
    const spans = placeV20RomList(this.rom, parts);
    noteRomCut(this, spans, ROM_SIZE);
  }

  batteryRam(): Uint8Array { return this.ram.slice(0, RAM_SIZE); }

  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, RAM_SIZE);
  }

  setReelGeometry(geometry: readonly ReelGeometry[]): void {
    if (!geometry.length) { this.reelDrive = new EpochReels([], { opticInverted: false }); return; }
    const top = Math.min(7, Math.max(...geometry.map((g) => g.number)));
    const slots = Array.from({ length: top + 1 }, (_, n) => geometry.find((g) => g.number === n) ?? { ...geometry[0], number: n });
    this.reelDrive = new EpochReels(slots, { opticInverted: false });
  }

  setReelPosition(i: number, pos: number): void {
    this.reelDrive.setPosition(i, pos);
  }

  get reels(): readonly Reel[] { return this.reelDrive.reels; }

  get clockHz(): number { return PLUTO5_CLOCK; }

  fitDataPak(type: number): void { this.dataPakType = type; }

  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  setSecMoneyMap(secIn: readonly number[], secOut: readonly number[]): void {
    this.secInMult = [...secIn];
    this.secOutMult = [...secOut];
    this.secLedgerMult = ledgerOutMults({ in: [], out: [] }, { in: this.secInMult, out: this.secOutMult })[1];
  }

  get meterTotals(): { in: number; out: number } { return { ...this.secTotals }; }

  private secCount(meter: number, delta: number): void {
    const inMult = this.secInMult[meter] ?? 0;
    const outMult = this.secOutMult[meter] ?? 0;
    if (inMult) {
      this.secTotals.in += inMult * delta;
      this.cashLedger.inPence += Math.max(0, inMult) * delta * Pluto5.SEC_UNIT_PENCE;
    }
    if (outMult) {
      this.secTotals.out += outMult * delta;
      this.cashLedger.outPence += (this.secLedgerMult[meter] ?? 0) * delta * Pluto5.SEC_UNIT_PENCE;
    }
  }

  layoutLamp(n: number): boolean { return n >= 0 && n < 256 && this.lamps[n] !== 0; }
  layoutLampLevel(n: number): number { return n >= 0 && n < 256 ? this.lamps[n] : 0; }
  layoutDigit(n: number): number { return this.digits[n & 15]; }

  private static readonly DIL_ID_BASE = 128;

  layoutInput(id: number, on: boolean): void {
    if (id >= Pluto5.DIL_ID_BASE && id < Pluto5.DIL_ID_BASE + 16) {
      const n = id - Pluto5.DIL_ID_BASE;
      const mask = 1 << (n & 7);
      const raise = (v: number): number => (on ? v | mask : v & ~mask & 0xff);
      if (n < 8) this.dip1 = raise(this.dip1);
      else this.dip2 = raise(this.dip2);
      return;
    }
    if (id < 0 || id >= this.matrix.length * 8) return;
    const bit = 1 << (id & 7);
    if (on) this.matrix[id >> 3] |= bit;
    else this.matrix[id >> 3] &= ~bit;
  }

  setSwitches(sw: LayoutSwitch[]): void {
    this.switches = sw;
    for (const s of sw) if (s.closed) this.layoutInput(s.number, true);
  }

  presetOperatorSwitch(n: number, made: boolean, label: string): void {
    if (n < 0 || n >= this.matrix.length * 8) return;
    const known = this.doorSwitches.find((d) => d.number === n);
    if (known) known.made = made;
    else this.doorSwitches.push({ number: n, label, made });
    this.layoutInput(n, made);
  }

  get switchPanel(): CabinetSwitch[] {
    const made = (n: number) => ((this.matrix[n >> 3] >> (n & 7)) & 1) === 1;
    const out: CabinetSwitch[] = this.switches.map((s) => ({ id: s.number, label: s.label, on: made(s.number) }));
    for (const d of this.doorSwitches) {
      if (!out.some((s) => s.id === d.number)) out.push({ id: d.number, label: d.label, on: made(d.number) });
    }
    for (let i = 0; i < 16; i++) {
      const bank = i < 8 ? this.dip1 : this.dip2;
      out.push({
        id: Pluto5.DIL_ID_BASE + i,
        label: dilSwitchLabel(`SW${i < 8 ? 1 : 2}:${(i & 7) + 1}`, this.dilLabels?.[i]),
        on: (bank & (1 << (i & 7))) !== 0,
        group: 'DIL switches',
        option: true,
        bootOnly: true,
      });
    }
    return out;
  }

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: 'LAMPS', part: '16 strobes x 16 - FPGA word $80', device: this.lamps },
      { id: 'leds', label: 'LED DIGITS', part: '16 digits - FPGA word $82', device: this.digits },
      { id: 'alpha', label: 'DOT ALPHA', part: 'AUX0-2', device: this.dot },
      { id: 'switches', label: 'INPUTS', part: 'IP0-31 + DIL SW1/SW2', device: this.matrix },
      { id: 'coins', label: 'COIN INPUTS', part: 'matrix row 3', modelled: true,
        note: 'Timed matrix bits by CoinNoteId (insertCoin), as MFME v20 - not a mech.' },
      { id: 'fpga', label: 'FPGA', part: 'CS2 - outputs, reels, multiplex', device: this.outputs },
      { id: 'duarts', label: 'DUARTS', part: 'three MC68681 in the FPGA - IRQ5', device: this.duarts },
      { id: 'sec', label: 'SEC', part: 'meter unit on $4E', device: this.sec },
      { id: 'ram', label: 'RAM', part: 'battery backed - 64K', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: 'U1/U2 - 16-bit mode', device: this.rom },
      { id: 'eeprom', label: 'I2C', part: 'PORTA4/5', device: this.i2c },
      { id: 'cpu', label: 'CPU', part: `MC68340 CPU32 - ${(PLUTO5_CLOCK / 1e6).toFixed(2)} MHz`, device: this.cpu, cpu: true },
      { id: 'sim', label: 'SIM40', part: 'timers - DMA - serial', device: this.sim },
      { id: 'datapak', label: 'DATAPAK', part: 'serial channel B', device: this.dataPak },
      { id: 'reels', label: 'REELS', part: 'stepper', device: this.reelDrive },
      { id: 'hopper', label: 'HOPPER', part: 'one', device: this.hopper },
      { id: 'sound', label: 'SOUND', part: 'two MSM6585 ADPCM by DMA', device: this.voices },
    ];
  }

  insertCoin(id: number): void {
    if (this.coinTimer > 0) return;
    const raw = COIN_RAW[id] ?? 0;
    let row = COIN_ROW;
    let mask = raw & 0xff;
    if (raw & 0x100) { row = (raw & 0x78) >> 3; mask = 1 << (raw & 7); }
    this.coinRowNow = row;
    this.coinMask = mask;
    this.coinTimer = COIN_HOLD + COIN_TAIL;
    this.matrix[row] |= mask;
  }
  private coinRowNow = COIN_ROW;

  get coinBusy(): boolean { return this.coinTimer > 0; }

  powerCycle(): void {
    this.nvram = this.ram.slice();
    this.reset();
  }

  reset(): void {
    if (this.nvram) this.ram.set(this.nvram);
    else this.ram.fill(0);
    this.outputs.fill(0);
    this.column = 0;
    this.strobe = 0;
    this.lampWord.fill(0);
    this.ledWord.fill(0);
    this.lamps.fill(0);
    this.digits.fill(0);
    this.aux = 0xff;
    this.portAShadow = 7;
    this.dot.reset();
    for (const d of this.duarts) d.reset();
    this.duartAcc = 0;
    this.i2c.reset();
    this.hopper.reset();
    this.sec.reset();
    this.dataPak.reset();
    this.dataPakOut = [];
    this.dataPakWait = 0;
    for (let i = 0; i < 2; i++) {
      Object.assign(this.ch[i], { rate: 3, phase: 0, shift: 0x80, period: SOUND_PERIOD[3], running: false, acc: 0, request: false });
      this.voices[i].reset();
      this.voices[i].restart();
      this.voices[i].setVolumeTarget(0);
    }
    this.coinMask = 0;
    this.coinTimer = 0;
    this.matrix[COIN_ROW] = 0;
    for (const s of this.switches) if (s.closed && s.number >> 3 === COIN_ROW) this.layoutInput(s.number, true);
    for (const d of this.doorSwitches) this.layoutInput(d.number, d.made);
    this.reelDrive.reset();
    this.sim.reset();
    this.irqLevel = 0;
    this.cpu.reset();
  }

  step(): number {
    const cycles = this.cpu.step();
    this.sim.tick(cycles);
    this.duartAcc += cycles * DUART_X1;
    if (this.duartAcc >= PLUTO5_CLOCK) {
      const t = Math.floor(this.duartAcc / PLUTO5_CLOCK);
      this.duartAcc -= t * PLUTO5_CLOCK;
      for (const d of this.duarts) d.tick(t);
    }
    let level = this.sim.request();
    if (level < DUART_IRQ_LEVEL && this.duarts.some((d) => d.irq())) level = DUART_IRQ_LEVEL;
    if (level !== this.irqLevel) {
      this.irqLevel = level;
      this.cpu.setIRQ(level);
    }
    this.soundTick(cycles);
    this.reelDrive.tick(cycles);
    this.hopper.tick(cycles);
    if (this.hopper.paid > this.hopperEjects) this.hopperEjects = this.hopper.paid;
    if (this.dataPakOut.length) this.tickDataPak(cycles);
    if (this.coinTimer > 0) {
      this.coinTimer -= cycles;
      if (this.coinTimer <= COIN_TAIL) this.matrix[this.coinRowNow] &= ~this.coinMask;
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
    return cycles;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  private soundTick(cycles: number): void {
    for (let i = 0; i < 2; i++) {
      const c = this.ch[i];
      const v = this.voices[i];
      v.tick(cycles, PLUTO5_CLOCK);
      c.acc += cycles;
      if (c.acc >= c.period) {
        if (c.running) {
          v.nibble(c.shift >> 4);
          c.shift = (c.shift << 4) & 0xff;
          c.phase ^= 1;
          if (c.phase === 0) c.request = true;
        }
        c.acc -= c.period;
      }
      if (c.request && this.sim.dmaRequest(i)) c.request = false;
    }
  }

  private dmaStart(i: number): void {
    const c = this.ch[i];
    if (!c) return;
    c.running = true;
    c.request = false;
    c.period = SOUND_PERIOD[c.rate & 3];
    this.voices[i].setVolumeTarget(255);
  }

  private dmaStop(i: number): void {
    const c = this.ch[i];
    if (!c) return;
    c.running = false;
    this.voices[i].setVolumeTarget(0);
  }

  private onWatchdog(): void {
    this.count('watchdog');
    this.sim.reset(RSR_WATCHDOG);
    this.cpu.reset();
  }

  private interruptAck(level: number): number {
    const onChip = this.sim.interruptAck(level);
    if (onChip !== null) return onChip;
    if (level === DUART_IRQ_LEVEL && this.duarts.some((d) => d.irq())) return DUART_IRQ_VECTOR;
    if (this.sim.autovectored(level)) return 24 + level;
    return SPURIOUS_VECTOR;
  }

  private count(key: string): void {
    this.io.set(key, (this.io.get(key) ?? 0) + 1);
  }

  private onSerialTx(channel: 0 | 1, v: number): void {
    if (channel !== 1) return;
    const reply = this.dataPak.receive(v, this.cpu.cycles);
    if (!reply || this.dataPakType !== 1) return;
    if (this.dataPakOut.length === 0) this.dataPakWait = Pluto5.DATAPAK_TURNAROUND;
    this.dataPakOut.push(...reply);
  }

  private tickDataPak(cycles: number): void {
    this.dataPakWait -= cycles;
    while (this.dataPakOut.length && this.dataPakWait <= 0) {
      this.sim.serialReceive(1, this.dataPakOut.shift()!);
      this.dataPakWait += Pluto5.DATAPAK_TURNAROUND;
    }
  }

  private portWrite(): void {
    const ddr = this.sim.regs[OFF_DDRA];
    const v = ((this.sim.regs[OFF_PORTA] & ddr) | (~ddr & 0xff)) & 0xff;
    const was = this.portAShadow;
    if ((was & 1) && !(v & 1)) this.voices[0].restart();
    if ((was & 2) && !(v & 2)) this.voices[1].restart();
    this.ch[1].rate = (v >> 6) & 3;
    this.portAShadow = v;
    this.i2c.set((v & 0x10) !== 0, (v & 0x20) !== 0);
  }

  private portAPins(): number {
    return (this.portAShadow & 0xd7) | (this.i2c.data() ? 0x20 : 0);
  }

  private serialPins(pins: number): void {
    this.ch[0].rate = ((pins & 0x40) >> 5) | ((pins & 0x10) >> 4);
  }

  private simOff(addr: number): number {
    if (!this.sim.valid) return -1;
    const off = addr - this.sim.base;
    return off >= 0 && off < 0x1000 ? off : -1;
  }

  private cs2Off(addr: number): number {
    return (addr - this.sim.csBaseOf(2)) & 0xffff;
  }

  read8(addr: number, fc?: number): number {
    addr >>>= 0;
    if (fc === 7) return (addr & ~3) >>> 0 === MBAR_ADDR ? this.sim.mbarByteRead(addr & 3) : 0;
    const so = this.simOff(addr);
    if (so >= 0) return this.sim.read8(so);
    const cs = this.sim.csLookup(addr);
    if (cs < 0) { this.strays.hit(addr); return 0xff; }
    switch (cs & 3) {
      case 0: return this.rom[addr & (ROM_SIZE - 1)];
      case 1: return this.ram[(addr - this.sim.csBaseOf(1)) & (RAM_SIZE - 1)];
      case 2: return this.fpgaRead8(this.cs2Off(addr));
      default: this.count(`cs3 r ${(addr & 0xffff).toString(16)}`); return 0;
    }
  }

  read16(addr: number, fc?: number): number {
    addr >>>= 0;
    if (fc !== 7 && this.simOff(addr) < 0) {
      const cs = this.sim.csLookup(addr);
      if (cs >= 0 && (cs & 3) === 2) {
        const off = this.cs2Off(addr) & 0xfffe;
        if (off >= 0x40 && off <= 0x46) return this.inputWord(off);
      }
    }
    return ((this.read8(addr, fc) << 8) | this.read8((addr + 1) >>> 0, fc)) & 0xffff;
  }

  write8(addr: number, val: number, fc?: number): void {
    addr >>>= 0;
    const v = val & 0xff;
    if (fc === 7) {
      if ((addr & ~3) >>> 0 === MBAR_ADDR) this.sim.mbarByteWrite(addr & 3, v);
      return;
    }
    const so = this.simOff(addr);
    if (so >= 0) { this.sim.write8(so, v); return; }
    const cs = this.sim.csLookup(addr);
    if (cs < 0) { this.strays.hit(addr); return; }
    switch (cs & 3) {
      case 0: return;
      case 1: this.ram[(addr - this.sim.csBaseOf(1)) & (RAM_SIZE - 1)] = v; return;
      case 2: this.fpgaWrite8(this.cs2Off(addr), v); return;
      default: this.count(`cs3 w ${(addr & 0xffff).toString(16)}`);
    }
  }

  write16(addr: number, val: number, fc?: number): void {
    addr >>>= 0;
    if (fc !== 7 && this.simOff(addr) < 0) {
      const cs = this.sim.csLookup(addr);
      if (cs >= 0 && (cs & 3) === 2) { this.fpgaWrite16(this.cs2Off(addr) & 0xfffe, val & 0xffff); return; }
    }
    this.write8(addr, (val >> 8) & 0xff, fc);
    this.write8((addr + 1) >>> 0, val & 0xff, fc);
  }

  private fpgaRead8(off: number): number {
    if (off < 0x30) return this.duarts[off >> 4].read(off & 0x0f);
    if (off >= 0x40 && off < 0x48) {
      const w = this.inputWord(off & 0xfe);
      return off & 1 ? w & 0xff : w >> 8;
    }
    this.count(`fpga r8 ${off.toString(16)}`);
    return 0;
  }

  private inputWord(off: number): number {
    const sh = off - 0x40;
    const dil = (((this.dip1 >> sh) & 3) << 8) | (((this.dip2 >> sh) & 3) << 10);
    const m = this.matrix;
    let lo = 0;
    switch (off) {
      case 0x40: lo = (~this.reelDrive.optics() & 0x3f) | m[0]; break;
      case 0x42: lo = m[1] | m[COLUMN_ROW[this.column & 15]]; break;
      case 0x44:
        lo = (this.hopper.opto ? 0 : 0x10)
          | (this.sec.data() ? 0 : 0x08)
          | m[2];
        break;
      case 0x46: lo = m[3]; break;
    }
    return ~(dil | lo) & 0xffff;
  }

  private fpgaWrite8(off: number, v: number): void {
    if (off < 0x30) { this.duarts[off >> 4].write(off & 0x0f, v); return; }
    if (off === 0x31) { this.strobe = (v + 1) & 0x0f; return; }
    if (off === 0x36 || off === 0x37) { this.ch[off - 0x36].shift = v; return; }
    if (off === 0x41 || off === 0x43 || off === 0x45) { this.reelDrive.stepPair((off - 0x41) >> 1, v); return; }
    if (off >= 0x50 && off <= 0x57) { this.auxWrite(off - 0x50, v); return; }
    if (off === 0x30) return;
    this.count(`fpga w8 ${off.toString(16)}`);
  }

  private auxWrite(n: number, v: number): void {
    const bit = 1 << n;
    const next = (v & 1) ? this.aux & ~bit : this.aux | bit;
    const changed = (this.aux ^ next) & 0xff;
    this.aux = next & 0xff;
    if (changed & 5) this.dot.lines((next & 1) !== 0, (next & 4) !== 0, (next & 2) !== 0);
  }

  private fpgaWrite16(off: number, w: number): void {
    const lo = w & 0xff;
    if (off >= 0x40 && off <= 0x4e) { this.outputWrite(off, lo); return; }
    switch (off) {
      case 0x80: {
        const s = this.strobe;
        if (this.lampWord[s] === w) return;
        this.lampWord[s] = w;
        for (let b = 0; b < 16; b++) this.lamps[s * 16 + b] = (w >> b) & 1 ? 0xff : 0;
        return;
      }
      case 0x82: {
        const s = this.strobe;
        if (this.ledWord[s] === w) return;
        this.ledWord[s] = w;
        this.digits[s] = lo;
        return;
      }
      case 0x84: case 0x86: return;
    }
    this.count(`fpga w16 ${off.toString(16)}`);
  }

  private outputWrite(off: number, v: number): void {
    const i = (off - 0x40) >> 1;
    const prev = this.outputs[i];
    if (prev === v) return;
    this.outputs[i] = v;
    switch (off) {
      case 0x40: case 0x42: case 0x44:
        this.reelDrive.stepPair(i, v);
        return;
      case 0x4a:
        if ((prev ^ v) & 0x20) this.hopper.motorDrive((v & 0x20) !== 0);
        return;
      case 0x4c:
        if ((prev ^ v) & 0xc0) this.column = (this.column & 3) | ((v & 0xc0) >> 4);
        return;
      case 0x4e:
        if ((prev ^ v) & 3) this.column = (this.column & 0x0c) | (v & 3);
        if ((prev ^ v) & 8) this.sec.setCS((v & 8) === 0);
        if ((prev ^ v) & 0x10) {
          this.sec.lineCall(this.cpu.cycles);
          this.sec.setData((v & 4) === 0);
          this.sec.setClock((v & 0x10) === 0);
        }
        return;
      default:
        this.count(`out ${off.toString(16)}`);
    }
  }
}
