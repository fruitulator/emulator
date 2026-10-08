import { COIN_RAW } from './coinraw';
import type { Bus16 } from '../cpu/bus68k';
import type { AudioSource, CabinetSwitch, Machine, MachineDisplay, DigitKind, CoinWiringStatus } from './machine';
import type { BoardPart } from './parts';
import { newCashLedger, ledgerOutMults, dilSwitchLabel } from './machine';
import type { Reel } from '../hw/reel';
import { M68000 } from '../cpu/m68000';
import {
  M68340Sim, MBAR_ADDR, RSR_WATCHDOG, SPURIOUS_VECTOR, OFF_PORTA, OFF_DDRA,
} from '../hw/m68340';
import { EpochReels } from '../hw/epochreels';
import { Hopper, v20Waveform } from '../hw/hopper';
import { Eeprom24c, I2cBitBang } from '../hw/eeprom';
import type { ReelGeometry } from './layoutreels';
import type { LayoutSwitch } from './layoutswitches';
import { Msc1937 } from '../hw/msc1937';
import { AstraDotAlpha } from '../hw/astradotalpha';
import { AstraSound } from '../hw/astrasound';
import { Ymz280b, YMZ_SAMPLE_RATE } from '../hw/ymz280b';
import { Mixer } from '../hw/mixer';
import { DataPak, V20_CPU32_DATAPAK_CLOCK } from '../hw/datapak';
import { Sec } from '../hw/sec';
import { noteRomCut } from './boarddefaults';
import { StrayCounter } from './strayaccess';
import { ROM_UNPLACED } from './pairplacer';
import { findAstraTokenPayout, astraTokenPence, type AstraTokenPayout } from '../hw/astratoken';
import { linesOf, type CoinLineTable, type CoinWiring, type SlotCoin, type StepState, wiringKey, wiringStateFor } from './coinwiring';
import type { DeclaredCoin } from './layoutcoins';
import {
  locateAstraCoinCode, astraCoins, astraCodeOf, astraCodeLocked, astraCoinTable, astraBoardMeter,
  type AstraCoinCode, type AstraCoins, type AstraCoin, type AstraMem,
} from './astracoins';

export const ASTRA_CLOCK = 32_768 * 4 * 64 * 2;

const ROM_SIZE = 0x800000;
const RAM_SIZE = 0x10000;

const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo }, (_, i) => lo + i);

const READ_MAP_1 = [...range(0, 16), ...range(0, 16), ...range(0x20, 0x30),
  0x30, 0x21, 0x32, 0x23, ...range(0x34, 0x40)];
const WRITE_MAP_1 = [...range(0, 16), ...range(0, 16), ...range(0x20, 0x30),
  0x20, 0x21, 0x32, 0x23, 0x24, 0x25, 0x26, 0x2e, ...range(0x38, 0x40)];

const REV8 = Uint8Array.from(range(0, 256), (v) => {
  let r = 0;
  for (let b = 0; b < 8; b++) if (v & (1 << b)) r |= 0x80 >> b;
  return r;
});
const REV4 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
const PRIZE_CODE = [0, 8, 6, 5, 7, 9, 10, 12, 13, 1, 2, 3, 4, 11, 14];
const STAKE_CODE = [0, 0, 1, 2, 3, 4, 5, 6];
const COLUMN = (state: number): number =>
  state === 1 ? 0 : state === 2 ? 1 : state === 4 ? 2 : state === 8 ? 3 : state === 16 ? 4 : -1;
const LAMP_DIM = [0x32, 0x50, 0x64, 0x78, 0x8c, 0xa0, 0xb4, 0xcd, 0xd2, 0xd7, 0xdc, 0xe1, 0xe6, 0xeb, 0xf2, 0xff];
const ROUTE_BITS = [0, 1, 2, 4];

const COIN_HOLD = Math.floor(ASTRA_CLOCK * 0.12);

const LAMP_DREQ_CYCLES = 0x20c1;
const SOUND_IRQ_LEVEL = 6;
const SOUND_IRQ_VECTOR = 0x1e;
const SOUND_PERIOD_CYCLES = [0x1046, 0x823, 0x411, 0x208];
const COIN_TAIL = Math.floor(ASTRA_CLOCK * 0.005);
const METER_UNIT_PENCE = 10;
const ASTRA_HOPPER_PENCE: (number | null)[] = [100, null];
const METER_TICK_CYCLES = 0x4e20;
const METER_HOLD_TICKS = 5;

const coinReachesRow = (id: number): boolean =>
  id >= 0 && id < COIN_RAW.length && !(id >= 0x1e && id <= 0x20) && !(id >= 0x27 && id <= 0x32);
const COIN_HOLD_LINE = Math.floor(ASTRA_CLOCK * 0.09);
const coinPattern = (raw: number): number =>
  ((raw & 1) << 2) | ((raw & 2) << 3) | ((raw & 4) << 1) | ((raw & 8) >> 2) | ((raw & 0x10) >> 4);

export class Astra implements Bus16, Machine {
  static readonly snapshotConfig: readonly string[] = ['switches', 'nvram', 'coinCodeCache', 'cabinetLines', 'coinSlots', 'wiring', 'programMem'];

  readonly digitKind: DigitKind = 'byte64';
  readonly cpu: M68000;
  readonly sim: M68340Sim;
  readonly rom = new Uint8Array(ROM_SIZE);
  readonly ram = new Uint8Array(RAM_SIZE);
  private nvram: Uint8Array | null = null;

  readonly matrix = new Uint8Array(16);
  dip1 = 0;
  dip2 = 0;
  stakeKey = 0;
  jackpotKey = 0;
  percentKey = 0;
  fpgaDesign = 0;
  muxType = 0;

  private reelDrive = new EpochReels([], { opticInverted: false });

  readonly latch = new Uint8Array(8);
  private columnState = 0;
  private column = 0;
  private latch2Seg = 0;
  private digitSel = -1;
  private idDetect = 0;

  readonly lamps = new Uint8Array(256);
  readonly digits = new Uint8Array(64);
  private readonly held = new Uint8Array(5);
  private dimSplit = 0;
  private xcrb = 0;
  private xdr = 0;
  private xdrActive = false;
  private xdrClock = false;
  private xdrShift = 0;
  private xdrBits = 0;
  private readonly doorSwitches: { number: number; label: string; made: boolean }[] = [];
  readonly coinRoute = new Uint8Array(5);
  private coinPending = 0;

  readonly meterCounts = new Uint32Array(5);
  private meterWord = 0;
  get meterLevels(): number { return this.meterWord & 0x1f; }
  private readonly meterHold = new Uint8Array(5);
  private meterAcc = 0;
  readonly cashLedger = newCashLedger();

  private coinMask = 0;
  private coinRow = 2;
  private coinTimer = 0;

  private readonly i2c: I2cBitBang;
  readonly i2cSelects: number[] = [];

  readonly io = new Map<string, number>();
  private irqLevel = 0;

  static readonly HOPPER_WAVEFORM = v20Waveform((0x4083 / ASTRA_CLOCK) * 1000, { beam: 0x19 + 1, gap: 200, start: 0x7d, settle: 1 });

  readonly hoppers = [new Hopper(ASTRA_CLOCK, Astra.HOPPER_WAVEFORM), new Hopper(ASTRA_CLOCK, Astra.HOPPER_WAVEFORM)];

  hopperOpto = 0;
  secFitted = false;
  private secInMult: number[] = [];
  private secOutMult: number[] = [];
  readonly secTotals = { in: 0, out: 0 };
  private static readonly SEC_UNIT_PENCE = 10;

  setSecMoneyMap(secIn: readonly number[], secOut: readonly number[]): void {
    this.secInMult = [...secIn];
    this.secOutMult = [...secOut];
    this.relayLedgerMults();
  }

  private meterInMultRaw: readonly number[] = [];
  private meterOutMultRaw: readonly number[] = [];
  private secLedgerMult: number[] = [];
  private relayLedgerMults(): void {
    const [meters, secs] = ledgerOutMults(
      { in: this.meterInMultRaw, out: this.meterOutMultRaw },
      { in: this.secInMult, out: this.secOutMult },
    );
    this.meterOutPence = meters.map((x) => x * METER_UNIT_PENCE);
    this.secLedgerMult = secs;
  }

  pricesOut(): boolean {
    return this.meterOutPence.some((p) => p > 0) || this.secLedgerMult.some((x) => x > 0);
  }

  private secCount(meter: number, delta: number): void {
    const inMult = this.secInMult[meter] ?? 0;
    const outMult = this.secOutMult[meter] ?? 0;
    if (inMult) {
      this.secTotals.in += inMult * delta;
      if (!this.meterInPence.some((p) => p > 0) && !this.wiring) this.cashLedger.inPence += Math.max(0, inMult) * delta * Astra.SEC_UNIT_PENCE;
    }
    if (outMult) {
      this.secTotals.out += outMult * delta;
      if (this.booksMoney) this.cashLedger.outPence += (this.secLedgerMult[meter] ?? 0) * delta * Astra.SEC_UNIT_PENCE;
    }
  }
  private readonly paidBooked = [0, 0];
  hopperOutPence = 0;
  readonly hopperEjects = [0, 0];
  private tokenPayout: AstraTokenPayout | null = null;
  tokenCoinPence(): number | null {
    return this.tokenPayout ? astraTokenPence(this.tokenPayout, this.rom, this.ram) : null;
  }

  private readonly dmaFlag = [false, false];
  private soundAcc = 0;
  private lampAcc = 0;
  private soundPeriod = SOUND_PERIOD_CYCLES[0];
  private soundActive = false;
  private soundPhase = 0;
  private soundRate = 0;
  soundByte = 0;

  constructor() {
    this.sim = new M68340Sim({
      watchdogReset: () => this.onWatchdog(),
      portAIn: () => this.portAPins(),
      portWrite: () => this.portWrite(),
      serialTx: (ch, v) => this.onSerialTx(ch, v),
      busRead8: (a) => this.read8(a),
      busWrite8: (a, v) => this.write8(a, v),
      busRead16: (a) => this.read16(a),
      busWrite16: (a, v) => this.write16(a, v),
      dmaStart: (ch) => this.dmaStart(ch),
      dmaStop: (ch) => { if (ch === 0) { this.soundActive = false; this.snd.silence(); } },
    }, 130_000_000, ASTRA_CLOCK);
    let first = false;
    const selects = this.i2cSelects;
    const dev = {
      start: () => { first = true; },
      stop: () => { first = false; },
      write: (v: number) => {
        if (first && selects.length < 256) selects.push(v & 0xff);
        first = false;
      },
      read: () => 0,
    };
    this.i2c = new I2cBitBang(dev as unknown as Eeprom24c);
    this.cpu = new M68000(this, { variant: 'cpu32' });
    this.cpu.onInterruptAck = (level) => this.interruptAck(level);
    this.cpu.onResetInstruction = () => this.sim.moduleReset();
    this.sec.onCount = (meter, delta) => this.secCount(meter, delta);
  }

  loadRom(parts: readonly Uint8Array[]): void {
    this.rom.fill(ROM_UNPLACED);
    this.tokenPayout = null;
    if (parts.length < 2) {
      if (parts[0]) { noteRomCut(this, parts[0].length, ROM_SIZE); this.rom.set(parts[0].subarray(0, ROM_SIZE)); }
      this.tokenPayout = findAstraTokenPayout(this.rom, Math.min(ROM_SIZE, parts[0]?.length ?? 0));
      return;
    }
    const half = parts[0].length;
    parts.forEach((p, i) => {
      const lane = i & 1;
      for (let k = 0; k + 1 < p.length; k += 2) {
        if (lane + k < ROM_SIZE) this.rom[lane + k] = p[k];
        if (half + lane + k < ROM_SIZE) this.rom[half + lane + k] = p[k + 1];
      }
    });
    this.tokenPayout = findAstraTokenPayout(this.rom, Math.min(ROM_SIZE, 2 * half));
  }

  batteryRam(): Uint8Array { return this.ram.slice(0, RAM_SIZE); }

  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, RAM_SIZE);
  }

  setReelGeometry(geometry: readonly ReelGeometry[]): void {
    this.reelDrive = new EpochReels(geometry, { opticInverted: false });
  }

  get clockHz(): number {
    return ASTRA_CLOCK;
  }

  setReelPosition(i: number, pos: number): void {
    this.reelDrive.setPosition(i, pos);
  }

  get reels(): readonly Reel[] {
    return this.reelDrive.reels;
  }

  readonly vfd = new Msc1937();
  readonly dot = new AstraDotAlpha();
  dotFitted = false;
  get display(): MachineDisplay { return this.dotFitted ? this.dot : this.vfd; }
  readonly snd = new AstraSound(YMZ_SAMPLE_RATE);
  readonly ymz = new Ymz280b();
  private readonly audioMix = new Mixer([this.ymz, this.snd]);
  get audioSource(): AudioSource {
    return this.audioMix;
  }
  private soundShift = 0;

  layoutLamp(n: number): boolean {
    return n >= 0 && n < this.lamps.length && this.lamps[n] !== 0;
  }

  layoutLampLevel(n: number): number {
    return n >= 0 && n < this.lamps.length ? this.lamps[n] : 0;
  }

  layoutDigit(n: number): number {
    return this.digits[n & 63];
  }

  layoutInput(id: number, on: boolean): void {
    if (id >= Astra.DIL_ID_BASE && id < Astra.DIL_ID_BASE + 16) {
      const n = id - Astra.DIL_ID_BASE;
      const mask = 1 << (n & 7);
      const raise = (v: number): number => (on ? v | mask : v & ~mask & 0xff);
      if (n < 8) this.dip1 = raise(this.dip1);
      else this.dip2 = raise(this.dip2);
      return;
    }
    if (id < 0 || id >= this.matrix.length * 8) return;
    const row = id >> 3;
    const bit = 1 << (id & 7);
    if (on) this.matrix[row] |= bit;
    else this.matrix[row] &= ~bit;
  }

  private switches: LayoutSwitch[] = [];

  presetOperatorSwitch(n: number, made: boolean, label: string): void {
    if (n < 0 || n >= this.matrix.length * 8) return;
    const known = this.doorSwitches.find((d) => d.number === n);
    if (known) known.made = made;
    else this.doorSwitches.push({ number: n, label, made });
    this.layoutInput(n, made);
  }

  private meterInPence: number[] = [];
  private meterOutPence: number[] = [];

  setMeterMoney(inMult: readonly number[], outMult: readonly number[]): void {
    this.meterInPence = inMult.map((x) => x * METER_UNIT_PENCE);
    this.meterInMultRaw = [...inMult];
    this.meterOutMultRaw = [...outMult];
    this.relayLedgerMults();
  }

  private dilLabels: readonly string[] | null = null;
  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  private static readonly DIL_ID_BASE = 128;

  get switchPanel(): CabinetSwitch[] {
    const made = (n: number) => ((this.matrix[n >> 3] >> (n & 7)) & 1) === 1;
    const out: CabinetSwitch[] = this.switches.map((s) => ({ id: s.number, label: s.label, on: made(s.number) }));
    for (const d of this.doorSwitches) {
      if (!out.some((s) => s.id === d.number)) out.push({ id: d.number, label: d.label, on: made(d.number) });
    }
    for (let i = 0; i < 16; i++) {
      const bank = i < 8 ? this.dip1 : this.dip2;
      out.push({
        id: Astra.DIL_ID_BASE + i,
        label: dilSwitchLabel(`DIL ${(i & 7) + 1} bank ${i < 8 ? 1 : 2}`, this.dilLabels?.[i]),
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
      { id: 'lamps', label: 'LAMPS', part: 'FPGA lamp frame by DMA', device: this.lamps },
      { id: 'leds', label: 'LED DIGITS', part: 'FPGA strobes', device: this.digits },
      { id: 'alpha', label: 'ALPHA', part: '16-char 10937 on XDR bits 5-7', device: this.display },
      { id: 'switches', label: 'SWITCH MATRIX', part: 'FPGA strobes + optos', device: this.matrix },
      { id: 'coins', label: 'COIN INPUTS', part: 'coded 5-bit pattern, strobe 5', modelled: true,
        note: 'Timed matrix pattern by CoinNoteId (insertCoin), as MFME v20 - not a mech.' },
      { id: 'meters', label: 'METERS', part: 'pulse counts', device: this.meterCounts },
      { id: 'fpga', label: 'FPGA', part: 'CS2 register file - design per layout', device: this.latch },
      { id: 'ram', label: 'RAM', part: 'battery backed', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: '8 MB - u1/u2 byte lanes', device: this.rom },
      { id: 'eeprom', label: 'EEPROM', part: 'I2C on port A', device: this.i2c },
      { id: 'cpu', label: 'CPU', part: `MC68340 CPU32 - ${(ASTRA_CLOCK / 1e6).toFixed(2)} MHz`, device: this.cpu, cpu: true },
      { id: 'sim', label: 'SIM40', part: 'timers - DMA - serial', device: this.sim },
      { id: 'datapak', label: 'DATAPAK', part: 'serial channel B', device: this.dataPak },
      { id: 'reels', label: 'REELS', part: 'stepper', device: this.reelDrive },
      { id: 'hopper', label: 'HOPPERS', part: 'two', device: this.hoppers },
      { id: 'sound', label: 'SOUND', part: 'DMA 4-bit ADPCM stream', device: this.snd },
      { id: 'ymz', label: 'SOUND BOARD', part: 'YMZ280B on CS3 - samples', device: this.ymz },
    ];
  }

  setSwitches(sw: LayoutSwitch[]): void {
    this.switches = sw;
    for (const s of sw) if (s.closed) this.layoutInput(s.number, true);
  }

  insertCoin(id: number): void {
    if (this.coinTimer > 0) return;
    const taken = this.programCoinOn(id);
    if (taken === 'refused') this.coinsRefused++;
    else if (this.wiring) this.bookWiredCoin(id, taken);
    if (id >= 0x100 && id < 0x180) {
      this.coinRow = (id & 0x78) >> 3;
      this.coinMask = 1 << (id & 7);
      this.coinTimer = COIN_HOLD_LINE + COIN_TAIL;
      this.matrix[this.coinRow] |= this.coinMask;
      return;
    }
    if (!coinReachesRow(id)) return;
    const raw = COIN_RAW[id];
    if (raw & 0x100) {
      this.coinRow = (raw & 0x78) >> 3;
      this.coinMask = 1 << (raw & 7);
      this.coinTimer = COIN_HOLD_LINE + COIN_TAIL;
    } else {
      this.coinRow = 2;
      this.coinMask = id < 7 ? coinPattern(raw) : raw & 0xff;
      this.coinTimer = COIN_HOLD + COIN_TAIL;
    }
    this.matrix[this.coinRow] |= this.coinMask;
  }

  get coinBusy(): boolean {
    return this.coinTimer > 0;
  }

  coinsRefused = 0;

  private coinCodeCache: { rom: Uint8Array; t: AstraCoinCode | { refused: string } } | null = null;
  private coinCode(): AstraCoinCode | { refused: string } {
    if (this.coinCodeCache?.rom !== this.rom) this.coinCodeCache = { rom: this.rom, t: locateAstraCoinCode(this.rom) };
    return this.coinCodeCache.t;
  }

  private readonly programMem: AstraMem = (a) => {
    const cs = this.cs(a >>> 0);
    if (cs < 0) return 0;
    if ((cs & 3) === 0) return this.rom[a & (ROM_SIZE - 1)]!;
    if ((cs & 3) === 1) return this.ram[a & (RAM_SIZE - 1)]!;
    return 0;
  };

  private programCoins(): AstraCoins | { refused: string } {
    const c = this.coinCode();
    return 'refused' in c ? c : astraCoins(c, this.rom, this.programMem);
  }

  private patternOf(id: number): number | null {
    if (id >= 0x100 && id < 0x180) return (id & 0x78) >> 3 === 2 ? 1 << (id & 7) : null;
    if (!coinReachesRow(id)) return null;
    const raw = COIN_RAW[id]!;
    if (raw & 0x100) return (raw & 0x78) >> 3 === 2 ? 1 << (raw & 7) : null;
    return id < 7 ? coinPattern(raw) : raw & 0xff;
  }

  private programCoinOn(id: number): AstraCoin | 'refused' | null {
    const p = this.patternOf(id);
    if (p === null) return null;
    const c = this.programCoins();
    if ('refused' in c) return null;
    const k = astraCodeOf(c.code, this.rom, p | (this.matrix[2]! & ~p));
    if (k === null) return 'refused';
    return c.coins.get(k) ?? 'refused';
  }

  private tableIds(c: AstraCoins): number[] {
    const bits = c.code.mask === 0x3f ? 6 : 5;
    return [...this.cabinetLines, 0, 1, 2, 3, 4, 5, 6, ...Array.from({ length: bits }, (_, i) => 0x0f + i)];
  }

  private readCoinTable(): CoinLineTable | { refused: string } {
    const c = this.programCoins();
    if ('refused' in c) return c;
    return astraCoinTable(c, this.rom, this.tableIds(c), (id) => this.patternOf(id));
  }

  get coinLineTable(): CoinLineTable | null {
    const t = this.readCoinTable();
    return 'refused' in t ? null : t;
  }

  get coinLineTableRefusal(): string | null {
    const t = this.readCoinTable();
    return 'refused' in t ? t.refused : null;
  }

  get coinLinesShut(): number {
    const c = this.programCoins();
    if ('refused' in c) return 0;
    let m = 0;
    for (const id of this.tableIds(c)) {
      if (id >= 32) continue;
      const p = this.patternOf(id);
      const k = p === null ? null : astraCodeOf(c.code, this.rom, p);
      if (k !== null && astraCodeLocked(c.code, this.rom, this.programMem, k)) m |= 1 << id;
    }
    return m >>> 0;
  }

  private tokenMeters(): number[] {
    const c = this.programCoins();
    if ('refused' in c) return [];
    const cashLogical = new Set<number>();
    for (const x of c.coins.values()) if (!x.token) for (const l of x.meters) cashLogical.add(l);
    const out = new Set<number>();
    for (const x of c.coins.values()) {
      if (!x.token) continue;
      for (const l of x.meters) {
        if (cashLogical.has(l)) continue;
        const b = astraBoardMeter(c, this.rom, this.programMem, l);
        if (b !== null) out.add(b);
      }
    }
    return [...out];
  }

  private coinSlots: number[] = [];
  private cabinetLines: number[] = [];

  setLayoutCoins(list: readonly DeclaredCoin[]): void {
    const slots = new Set<number>();
    const drawn = new Set<number>();
    for (const c of list) {
      if (c.named?.name.startsWith('ccTalk') || c.named?.name.startsWith('NV')) continue;
      let line: number;
      if (c.line !== null) line = c.line;
      else if (c.note !== null && c.note !== 0x47) line = c.note;
      else if (c.note === 0x47 && c.button !== null && c.button >= 0) line = 0x100 | (c.button & 0x7f);
      else line = Astra.DEFAULT_COIN_ID;
      drawn.add(line);
      if (c.pence === null) slots.add(line);
    }
    this.cabinetLines = [...drawn].sort((a, b) => a - b);
    this.coinSlots = [...slots].sort((a, b) => a - b);
  }

  private static readonly DEFAULT_COIN_ID = 5;

  get unnamedCoinLines(): readonly number[] {
    return this.coinSlots;
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

  private bookWiredCoin(id: number, taken: AstraCoin | null): void {
    const w = this.wiring!;
    if (!this.booksMoney || w.conflicts.includes(id)) return;
    const c = w.coins.get(id);
    if (c === undefined) {
      if (taken === null) return;
      if (taken.token) this.cashLedger.tokenInPence += taken.pence;
      else this.cashLedger.inPence += taken.pence;
      return;
    }
    if (taken !== null) {
      const agrees = typeof c === 'number'
        ? !taken.token && taken.pence === c
        : taken.token && (c.token === null || c.token === taken.pence);
      this.wiringState.state = agrees ? 'calibrated' : 'disagrees';
      if (!agrees) return;
    }
    if (typeof c === 'number') { this.cashLedger.inPence += c; return; }
    if (c.token === null) { this.cashLedger.unpricedTokenIn++; return; }
    this.cashLedger.tokenInPence += c.token;
  }

  get meterTotals(): { in: number; out: number } {
    return { in: this.gridTotals.in + this.secTotals.in, out: this.gridTotals.out + this.secTotals.out };
  }
  private readonly gridTotals = { in: 0, out: 0 };

  powerCycle(): void {
    this.nvram = this.ram.slice();
    this.reset();
  }

  reset(): void {
    if (this.nvram) this.ram.set(this.nvram);
    else this.ram.fill(0);
    this.latch.fill(0);
    this.columnState = 0;
    this.column = 0;
    this.latch2Seg = 0;
    this.digitSel = -1;
    this.lamps.fill(0);
    this.digits.fill(0);
    this.held.fill(0);
    this.dimSplit = 0;
    this.xcrb = 0;
    this.xdr = 0xff;
    this.vfd.reset();
    this.dot.reset();
    this.xdrActive = true;
    this.xdrClock = false;
    this.xdrShift = this.xdrBits = 0;
    this.coinRoute.fill(0);
    this.coinPending = 0;
    this.meterWord = 0;
    this.meterHold.fill(0);
    this.meterAcc = 0;
    this.coinMask = 0;
    this.coinRow = 2;
    this.coinTimer = 0;
    this.matrix[2] = 0;
    for (const s of this.switches) if (s.closed && s.number >> 3 === 2) this.layoutInput(s.number, true);
    for (const d of this.doorSwitches) this.layoutInput(d.number, d.made);
    this.reelDrive.reset();
    this.i2c.reset();
    this.dataPak.reset();
    this.sec.reset();
    this.dataPakOut = [];
    this.dataPakWait = 0;
    this.sim.reset();
    this.irqLevel = 0;
    this.hoppers[0].reset();
    this.hoppers[1].reset();
    this.paidBooked[0] = this.paidBooked[1] = 0;
    this.dmaFlag[0] = this.dmaFlag[1] = false;
    this.soundAcc = this.lampAcc = 0;
    this.soundPeriod = SOUND_PERIOD_CYCLES[0];
    this.soundActive = false;
    this.soundPhase = 0;
    this.soundRate = 0;
    this.soundByte = 0;
    this.soundShift = 0;
    this.snd.reset();
    this.ymz.reset();
    this.cpu.reset();
  }

  step(): number {
    const cycles = this.cpu.step();
    this.sim.tick(cycles);
    let level = this.sim.request();
    if (level < SOUND_IRQ_LEVEL && this.ymz.irq()) level = SOUND_IRQ_LEVEL;
    if (level !== this.irqLevel) {
      this.irqLevel = level;
      this.cpu.setIRQ(level);
    }
    this.dmaPace(cycles);
    this.snd.tick(cycles, ASTRA_CLOCK);
    this.ymz.tick(cycles, ASTRA_CLOCK);
    this.meterAcc += cycles;
    if (this.meterAcc >= METER_TICK_CYCLES) this.tickMeters();
    if (this.dataPakOut.length) this.tickDataPak(cycles);
    for (let h = 0; h < 2; h++) {
      this.hoppers[h].tick(cycles);
      const paid = this.hoppers[h].paid;
      if (paid > this.paidBooked[h]) {
        const fresh = paid - this.paidBooked[h];
        const token = h === 1 ? this.tokenCoinPence() : null;
        if (h !== 1) this.hopperOutPence += fresh * (ASTRA_HOPPER_PENCE[h] ?? 0);
        this.hopperEjects[h] += fresh;
        if (!this.pricesOut() && this.booksMoney) {
          const pence = ASTRA_HOPPER_PENCE[h];
          if (token !== null) this.cashLedger.tokenOutPence += token * fresh;
          else if (pence === null) this.cashLedger.unpricedTokenOut += fresh;
          else this.cashLedger.outPence += pence * fresh;
        }
        this.paidBooked[h] = paid;
      }
    }
    if (this.coinTimer > 0) {
      this.coinTimer -= cycles;
      if (this.coinTimer <= COIN_TAIL) this.matrix[this.coinRow] &= ~this.coinMask;
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
    return cycles;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  private dmaPace(cycles: number): void {
    this.soundAcc += cycles;
    this.lampAcc += cycles;
    if (this.soundAcc >= this.soundPeriod) {
      if (this.soundActive) {
        if (this.soundPhase === 0) this.soundShift = this.soundByte;
        this.snd.nibble(this.soundShift >> 4);
        this.soundShift = (this.soundShift << 4) & 0xff;
        this.soundPhase ^= 1;
        if (this.soundPhase === 0) this.dmaFlag[0] = true;
      }
      this.soundAcc -= this.soundPeriod;
    }
    if (this.lampAcc >= LAMP_DREQ_CYCLES) {
      if (this.xcrb & 4) this.dmaFlag[1] = true;
      this.lampAcc -= LAMP_DREQ_CYCLES;
    }
    for (let ch = 0; ch < 2; ch++) {
      if (this.dmaFlag[ch] && this.sim.dmaRequest(ch)) this.dmaFlag[ch] = false;
    }
  }

  readonly dataPak = new DataPak(V20_CPU32_DATAPAK_CLOCK);
  readonly sec = (() => {
    const sec = new Sec();
    sec.fitV20();
    return sec;
  })();
  private dataPakType = 0;
  private dataPakOut: number[] = [];
  private dataPakWait = 0;
  private static readonly DATAPAK_TURNAROUND = 50_000;

  fitDataPak(type: number): void {
    this.dataPakType = type;
  }

  private onSerialTx(channel: 0 | 1, v: number): void {
    if (channel !== 1) return;
    const reply = this.dataPak.receive(v, this.cpu.cycles);
    if (!reply || this.dataPakType !== 1) return;
    if (this.dataPakOut.length === 0) this.dataPakWait = Astra.DATAPAK_TURNAROUND;
    this.dataPakOut.push(...reply);
  }

  private tickDataPak(cycles: number): void {
    this.dataPakWait -= cycles;
    while (this.dataPakOut.length && this.dataPakWait <= 0) {
      this.sim.serialReceive(1, this.dataPakOut.shift()!);
      this.dataPakWait += Astra.DATAPAK_TURNAROUND;
    }
  }

  private tickMeters(): void {
    while (this.meterAcc >= METER_TICK_CYCLES) {
      this.meterAcc -= METER_TICK_CYCLES;
      for (let b = 0; b < 5; b++) {
        if (!(this.meterWord & (1 << b)) || this.meterHold[b] === 0) continue;
        if (--this.meterHold[b] !== 0) continue;
        this.meterCounts[b]++;
        this.gridTotals.in += this.meterInMultRaw[b] ?? 0;
        this.gridTotals.out += this.meterOutMultRaw[b] ?? 0;
        if (!this.booksMoney) continue;
        const inP = this.meterInPence[b] ?? 0;
        if (inP && !this.wiring) {
          if (this.tokenMeters().includes(b)) this.cashLedger.tokenInPence += inP;
          else this.cashLedger.inPence += inP;
        }
        this.cashLedger.outPence += this.meterOutPence[b] ?? 0;
      }
    }
  }

  private dmaStart(ch: number): void {
    if (ch !== 0) return;
    this.dmaFlag[0] = true;
    this.soundPhase = 0;
    this.soundActive = true;
    this.soundAcc = 0;
    this.soundPeriod = SOUND_PERIOD_CYCLES[this.soundRate];
  }

  private onWatchdog(): void {
    this.count('watchdog');
    this.sim.reset(RSR_WATCHDOG);
    this.cpu.reset();
  }

  private interruptAck(level: number): number {
    const onChip = this.sim.interruptAck(level);
    if (onChip !== null) return onChip;
    if (level === SOUND_IRQ_LEVEL && this.ymz.irq()) return SOUND_IRQ_VECTOR;
    if (this.sim.autovectored(level)) return 24 + level;
    return SPURIOUS_VECTOR;
  }

  readonly strays = new StrayCounter();

  private count(key: string): void {
    this.io.set(key, (this.io.get(key) ?? 0) + 1);
  }

  private portWrite(): void {
    const ddr = this.sim.regs[OFF_DDRA];
    const lat = this.sim.regs[OFF_PORTA];
    const scl = (ddr & 0x40) === 0 || (lat & 0x40) !== 0;
    const sda = (ddr & 0x20) === 0 || (lat & 0x20) !== 0;
    this.i2c.set(scl, sda);
    this.soundRate = ((((lat & ddr) | (this.portAPins() & ~ddr)) & 0xff) >> 3) & 3;
  }

  private portAPins(): number {
    return 0xdb | (this.i2c.data() ? 0x20 : 0) | (this.meterWord ? 0x04 : 0);
  }

  private cs(addr: number): number {
    return this.sim.csLookup(addr);
  }

  private simOff(addr: number): number {
    if (!this.sim.valid) return -1;
    const off = addr - this.sim.base;
    return off >= 0 && off < 0x1000 ? off : -1;
  }

  read8(addr: number, fc?: number): number {
    addr >>>= 0;
    if (fc === 7) return (addr & ~3) >>> 0 === MBAR_ADDR ? this.sim.mbarByteRead(addr & 3) : 0;
    const so = this.simOff(addr);
    if (so >= 0) return this.sim.read8(so);
    const cs = this.cs(addr);
    if (cs < 0) { this.strays.hit(addr); this.count(`stray r ${(addr >>> 8).toString(16)}xx`); return 0xff; }
    switch (cs & 3) {
      case 0: return this.rom[addr & (ROM_SIZE - 1)];
      case 1: return this.ram[addr & (RAM_SIZE - 1)];
      case 2: return this.fpgaRead8(addr & 0xff);
      default: this.count(`cs3 r ${(addr & 0xff).toString(16)}`); return this.soundBoardRead(addr);
    }
  }

  private soundBoardRead(addr: number): number {
    return this.ymz.read(addr & 1);
  }

  read16(addr: number, fc?: number): number {
    addr >>>= 0;
    if (fc !== 7 && this.simOff(addr) < 0) {
      const cs = this.cs(addr);
      if (cs >= 0 && (cs & 3) === 2) return this.fpgaRead16(addr & 0xfe);
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
    const cs = this.cs(addr);
    if (cs < 0) { this.strays.hit(addr); this.count(`stray w ${(addr >>> 8).toString(16)}xx`); return; }
    switch (cs & 3) {
      case 0: return;
      case 1: this.ram[addr & (RAM_SIZE - 1)] = v; return;
      case 2: this.fpgaWrite8(addr & 0xff, v); return;
      default: this.count(`cs3 w ${(addr & 0xff).toString(16)}`); this.ymz.write(addr & 1, v);
    }
  }

  write16(addr: number, val: number, fc?: number): void {
    addr >>>= 0;
    if (fc !== 7 && this.simOff(addr) < 0) {
      const cs = this.cs(addr);
      if (cs >= 0 && (cs & 3) === 2) { this.fpgaWrite16(addr & 0xfe, val & 0xffff); return; }
    }
    this.write8(addr, (val >> 8) & 0xff, fc);
    this.write8((addr + 1) >>> 0, val & 0xff, fc);
  }

  private readId(off: number): number {
    if (off >= 0x80) return off;
    if (this.fpgaDesign === 0) return off < 0x40 ? off : READ_MAP_1[off - 0x40] ?? off;
    return off < 0x40 ? READ_MAP_1[off] : off;
  }

  private writeId(off: number): number {
    if (off >= 0x80) return off;
    if (this.fpgaDesign === 0) return off < 0x40 ? off : WRITE_MAP_1[off - 0x40] ?? off;
    return off < 0x40 ? WRITE_MAP_1[off] : off;
  }

  private fpgaRead8(off: number): number {
    const id = this.readId(off);
    let v: number;
    if (id < 8) v = this.strobe(id);
    else if (id === 0x21) v = ~this.xdr;
    else if (id === 0x22) v = this.coinByte();
    else if (id === 0x23) v = 0xff;
    else { this.count(`fpga r8 ${off.toString(16)}`); v = 0; }
    this.count(`r8 ${id.toString(16)}`);
    return ~v & 0xff;
  }

  private fpgaRead16(off: number): number {
    const id = this.readId(off);
    this.count(`r16 ${id.toString(16)}`);
    if (id < 8) return ~((this.strobe(id) << 8) | this.strobe(id + 1)) & 0xffff;
    this.count(`fpga r16 ${off.toString(16)}`);
    return 3;
  }

  private percentCode(): number {
    return this.percentKey >= 0 && this.percentKey < 15 ? this.percentKey + 1 : 0;
  }

  private prizeCode(): number {
    return this.jackpotKey >= 0 && this.jackpotKey < 14 ? PRIZE_CODE[this.jackpotKey + 1] : 0;
  }

  private stakeCode(): number {
    return this.stakeKey >= 0 && this.stakeKey < 7 ? STAKE_CODE[this.stakeKey + 1] : 0;
  }

  private strobe(n: number): number {
    const col = this.column;
    const m = this.matrix;
    switch (n) {
      case 0: return REV8[this.dip1] & 0x0f;
      case 1: {
        let v = (~(this.idDetect | this.reelDrive.optics()) & 0x0f) | (m[0] & 0xf0);
        if (col === 0) v |= m[10] & 0xf0;
        else if (col === 1) v |= m[11] & 0xf0;
        return v;
      }
      case 2: return (REV8[this.dip1] >> 4) & 0x0f;
      case 3: return (m[1] ^ this.hopperBits()) | (this.secFitted && !this.sec.data() ? 0x80 : 0);
      case 4: return REV8[this.dip2] & 0x0f;
      case 5: return m[2];
      case 6: return (REV8[this.dip2] >> 4) & 0x0f;
      case 7: {
        let v = m[7];
        if (col >= 0) {
          v |= col === 4 ? m[8] : m[3 + col];
          if (col === 0) v |= (this.percentCode() & 0x0f) << 4;
          else if (col === 1) v |= REV4[this.prizeCode() & 0x0f] << 4;
          else if (col === 2) v |= ((this.stakeCode() & 3) << 6) | ((this.stakeCode() & 4) << 2);
        }
        return v & 0xff;
      }
    }
    return 0;
  }

  private coinByte(): number {
    let code = 0;
    if (this.xcrb & 8) {
      switch (this.matrix[2] & 0x1f) {
        case 1: code = 1; this.coinPending = this.coinRoute[0]; break;
        case 2: code = 2; this.coinPending = this.coinRoute[1]; break;
        case 4: code = 0x10; this.coinPending = this.coinRoute[4]; break;
        case 8: code = 4; this.coinPending = this.coinRoute[2]; break;
        case 0x10: code = 8; this.coinPending = this.coinRoute[3]; break;
        default: this.coinPending = 0;
      }
    } else this.coinPending = 0;
    return (~code & 0x1f) | ((~ROUTE_BITS[this.coinPending & 3] << 5) & 0xe0);
  }

  private fpgaWrite8(off: number, v: number): void {
    const id = this.writeId(off);
    this.count(`w8 ${id.toString(16)}`);
    if (id < 0x10 && (id & 1)) { this.setLatch(id >> 1, v); return; }
    switch (id) {
      case 0x20: this.soundByte = v; return;
      case 0x21: this.xdrWrite(v); return;
      case 0x22: case 0x23: case 0x24: return;
      case 0x25: this.xcrb = v & 0x0f; return;
      case 0x26: if (this.xcrb & 4) this.dimSplit = v & 0x0f; return;
      case 0x27: return;
      case 0x28: case 0x29: case 0x2a: case 0x2b: case 0x2c:
        this.coinRoute[id - 0x28] = v & 3; return;
      case 0x2d: return;
      case 0x2e: return;
      case 0x38: case 0x39: case 0x3a: case 0x3c: return;
      default: this.count(`fpga w8 ${off.toString(16)}`);
    }
  }

  private xdrWrite(v: number): void {
    const clock = (~v & 0x40) !== 0;
    if ((this.xdr ^ v) & 0xe0) this.dot.lines((v & 0x20) !== 0, clock, (~v & 0x80) !== 0);
    if (!(v & 0x20)) {
      if (this.xdrActive) {
        this.vfd.reset();
        this.xdrShift = this.xdrBits = 0;
      }
      this.xdrActive = false;
    } else {
      this.xdrActive = true;
      if (clock !== this.xdrClock && !clock) {
        this.xdrShift = ((this.xdrShift << 1) | (~v & 0x80 ? 1 : 0)) & 0xff;
        if (++this.xdrBits === 8) {
          this.xdrBits = 0;
          this.vfd.writeByte(this.xdrShift);
        }
      }
    }
    this.xdrClock = clock;
    this.xdr = v;
  }

  private fpgaWrite16(off: number, v: number): void {
    const id = this.writeId(off);
    this.count(`w16 ${id.toString(16)}`);
    const lo = v & 0xff;
    const hi = (v >> 8) & 0xff;
    if (id < 0x10 && (id & 1) === 0) { this.setLatch(id >> 1, lo); return; }
    if (this.muxType === 0 && id >= 0x80 && id <= 0xbf) {
      const strobe = (id >> 3) & 7;
      const second = (id & 4) !== 0;
      if ((id & 2) === 0) {
        if (!second) { this.held[2] = hi; this.held[3] = ~lo & 0xff; }
        else {
          this.ledPair(0, strobe, ~lo & 0xff, this.held[3]);
          this.lampPair(0x48, strobe * 2, hi, this.held[2]);
        }
      } else if (!second) { this.held[0] = lo; this.held[1] = hi; }
      else {
        this.lampPair(0, strobe, lo, this.held[0]);
        this.lampPair(0x40, strobe * 2, hi, this.held[1]);
      }
      return;
    }
    if (this.muxType === 1 && id >= 0x80) {
      const strobe = (id >> 4) & 7;
      const second = (id & 8) !== 0;
      switch (id & 7) {
        case 0:
          if (!second) { this.held[3] = ~lo & 0xff; this.held[4] = hi; }
          else { this.ledPair(0, strobe, ~lo & 0xff, this.held[3]); this.ledPair(8, strobe, hi, this.held[4]); }
          return;
        case 2:
          if (!second) { this.held[0] = lo; this.held[1] = hi; }
          else { this.lampPair(0, strobe, lo, this.held[0]); this.lampPair(0x40, strobe * 2, hi, this.held[1]); }
          return;
        case 4:
          if (!second) this.held[2] = hi;
          else this.lampPair(0x48, strobe * 2, hi, this.held[2]);
          return;
      }
    }
    this.count(`fpga w16 ${off.toString(16)}`);
  }

  private lampPair(base: number, col: number, second: number, first: number): void {
    for (let b = 0; b < 8; b++) {
      const f = (first >> b) & 1;
      const s = (second >> b) & 1;
      const level = f ? (s ? 0xff : LAMP_DIM[this.dimSplit]) : (s ? LAMP_DIM[15 - this.dimSplit] : 0);
      const n = base + col * 8 + b;
      if (n < this.lamps.length) this.lamps[n] = level;
    }
  }

  private ledPair(base: number, col: number, second: number, first: number): void {
    this.digits[(base + col) & 63] = (first | second) & 0xff;
  }

  private directLamps(base: number, v: number): void {
    for (let b = 0; b < 8; b++) this.lamps[base + b] = (v >> b) & 1 ? 0xff : 0;
  }

  private hopperBits(): number {
    const t = this.hopperOpto;
    if (t < 0 || t > 3) return 0;
    const inv = (t & 1) === 0;
    const [m0, m1] = t < 2 ? [2, 1] : [1, 2];
    const bit = (h: number, mask: number) => ((this.hoppers[h].opto ? mask : 0) ^ (inv ? mask : 0));
    return bit(0, m0) | bit(1, m1);
  }

  private setLatch(n: number, v: number): void {
    const prev = this.latch[n];
    if (prev === v) return;
    this.latch[n] = v;
    const fiveReels = this.reelDrive.reels.length > 4;
    switch (n) {
      case 0: this.reelDrive.stepPair(0, v); break;
      case 1:
        this.reelDrive.stepPair(1, v);
        this.idDetect = this.reelDrive.reels.length === 7 ? 8 : 0;
        break;
      case 2:
        if (!fiveReels) { this.latch2Seg = v; this.directLamps(0xc0, v); }
        else this.reelDrive.stepPair(2, v);
        break;
      case 3: {
        this.columnState = (this.columnState & 0x10) | (v >> 4);
        this.directLamps(0xc8, v);
        this.column = COLUMN(this.columnState);
        const sel = ~v & 0x0f;
        if (sel !== this.digitSel) {
          this.digitSel = sel;
          this.digits[16 + sel] = ~this.latch2Seg & 0xff;
        }
        break;
      }
      case 4:
        this.directLamps(0xd0, v & 0xbf);
        if ((prev ^ v) & 0x40) {
          this.columnState = (this.columnState & 0x0f) | ((v & 0x40) >> 2);
          this.column = COLUMN(this.columnState);
        }
        break;
      case 5: {
        this.hoppers[0].motorDrive((v & 7) === 7);
        this.hoppers[1].motorDrive((v & 7) === 6);
        if (this.secFitted) {
          if ((prev ^ v) & 0xf8) {
            this.sec.lineCall(this.cpu.cycles);
            this.sec.setCS((v & 0x20) === 0);
            this.sec.setData((v & 0x10) === 0);
            this.sec.setClock((v & 0x40) === 0);
          }
          break;
        }
        const word = (v >> 4) | ((v & 8) << 1);
        const rising = word & ~this.meterWord;
        for (let b = 0; b < 5; b++) {
          const bit = 1 << b;
          if (rising & bit) this.meterHold[b] = METER_HOLD_TICKS;
          else if (this.meterWord & bit && !(word & bit)) this.meterHold[b] = 0;
        }
        this.meterWord = word;
        break;
      }
      default: this.count(`latch ${n}`);
    }
  }
}
