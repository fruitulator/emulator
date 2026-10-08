import { ROM_UNPLACED } from './pairplacer';
import type { Bus } from '../cpu/bus';
import type { CabinetSwitch, Machine, OptionKey, CoinWiringStatus } from './machine';
import { newCashLedger, ledgerOutMults, dilSwitchLabel } from './machine';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import { StatedLines } from './statedlines';
import type { SlideEffect } from '../layout/fmlconfig';
import { M6809 } from '../cpu/m6809';
import { Bd1 } from '../hw/bd1';
import { Dm01 } from '../hw/dm01';
import { Eeprom24c, I2cBitBang } from '../hw/eeprom';
import { Reel } from '../hw/reel';
import { MODEL_RELATIONS, parkAtV20PowerUp, resetReelsInPlace } from './v20optic';
import { Upd7759, UPD7759_RATE } from '../hw/upd7759';
import { Ym2413 } from '../hw/ym2413';
import { Mixer } from '../hw/mixer';
import { DataPak } from '../hw/datapak';
import { MeterConfirm } from '../hw/meterconfirm';
import { SteppedVolume, setBoardLevel } from '../hw/steppedvolume';
import { LampSetClear } from '../hw/lampsetclear';
import { fitReelBank, type ReelFit } from './reelfit';
import { noteBoardDefault, noteRomCut } from './boarddefaults';
import { detectCoins, linesOf, type CoinLineTable, type CoinWiring, type SlotCoin, type StepState, wiringKey, wiringStateFor } from './coinwiring';
import type { DeclaredCoin } from './layoutcoins';
import { locateSc2CoinTables, sc2CoinTable, sc2LinePattern, sc2ProgramLine, SC2_COIN_LINES, type Sc2CoinTables, type Sc2Mem } from './sc2coins';
import { StrayCounter } from './strayaccess';

export const MASTER_CLOCK = 8_000_000;
const DIM_SELECT = 0;

export const CPU_CLOCK = MASTER_CLOCK / 4;

const RAM_SIZE = 0x2000;

const sc2ReadDecoded = (a: number): boolean =>
  a === 0x2000 || (a >= 0x2300 && a <= 0x230b) || a === 0x2324 || a === 0x2329 || a === 0x232e
  || a === 0x2400 || a === 0x2500 || a === 0x2600 || a === 0x2700
  || (a >= 0x3c00 && a <= 0x3c07) || a === 0x3e00 || a === 0x3e01 || a === 0x3ffe || a === 0x3fff;
const sc2WriteDecoded = (a: number): boolean =>
  (a >= 0x2000 && a <= 0x2339) || a === 0x2400 || a === 0x2500 || a === 0x2600 || a === 0x2700
  || a === 0x2800 || a === 0x2900 || (a >= 0x2a00 && a <= 0x2bff) || a === 0x2c00
  || a === 0x2d00 || a === 0x2d01 || a === 0x2e00 || a === 0x3c80 || a === 0x3e00 || a === 0x3e01;

const MUX_BASE = 0x2300;
const MUX_END = 0x2320;
const UPD_LATCH = 0x2a00;
const UPD_RESET = 0x2b00;
const OPLL_ADDR = 0x2d00;
const OPLL_DATA = 0x2d01;
const ROM_SIZE = 0x10000;

const TIMER_HZ = 1000;

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

export class Sc2 implements Bus, Machine {
  static readonly snapshotConfig: readonly string[] = ['nvram', 'wiring', 'coinSlots', 'cabinetLines', 'coinTablesCache', 'programMem'];
  readonly cpu: M6809;
  readonly ram = new Uint8Array(RAM_SIZE);
  readonly rom = new Uint8Array(ROM_SIZE);
  private bank = 3;

  readonly vfd = new Bd1();

  dm01: Dm01 | null = null;

  private dmBusySwitch = 36;

  setDmBusySwitch(id: number): void {
    if (id >= 0 && id < 64 && (id & 7) < 5) this.dmBusySwitch = id;
  }

  get outputs(): { dots: Uint8Array } | undefined {
    return this.dm01 ? { dots: this.dm01.dots } : undefined;
  }

  fitDotMatrix(rom: Uint8Array): void {
    this.dm01 = new Dm01();
    this.dm01.loadRom(rom);
    this.dm01.reset();
  }

  readonly eeprom = new Eeprom24c(1024, 0xa0);
  private readonly i2c = new I2cBitBang(this.eeprom);

  readonly key = new Uint8Array(8);

  readonly reels = parkAtV20PowerUp([0, 1, 2, 3, 4, 5].map(
    () => new Reel({
      stepsPerRevolution: 96, symbols: 16, mame: true,
      indexStart: 1, indexEnd: 3, indexPattern: 0, initPhase: 4,
    }),
  ), MODEL_RELATIONS.SCORPION2);

  setReelPosition(i: number, pos: number): void {
    this.reels[i]?.park(pos);
  }

  reelFit: ReelFit = { mask: 0x3f, channels: 6, beyond: [] };

  setFittedReels(channels: readonly number[]): ReelFit {
    this.reelFit = fitReelBank(this.reels, channels);
    return this.reelFit;
  }

  reelStripOffsets: number[] = [0, 0, 0, 0, 0, 0];

  readonly lampStore = new LampSetClear(256);
  get lamps(): Uint8Array {
    return this.lampStore.level;
  }

  readonly inputRegs = new Uint8Array(12);

  private static readonly IDLE_INPUTS = (() => {
    const t = new Uint8Array(12);
    t[3] = 0x01;
    t[4] = 0x0f;
    return t;
  })();

  private readonly idleInputs = Uint8Array.from(Sc2.IDLE_INPUTS);

  readonly #stated = new StatedLines(12);

  postRestore(): void {
    this.#stated.reassert(this.idleInputs, this.inputRegs);
  }

  coins = 0;

  private timerEnabled = false;
  private timerCycles = 0;
  private irqArmed = false;
  private irqStatus = 0;
  private timerStat = 0;

  private static readonly WATCHDOG_CYCLES = Math.floor(CPU_CLOCK * 0.1);
  private watchdogCycles = 0;
  watchdogResets = 0;

  readonly upd = new Upd7759();
  private soundBankHigh = 0;

  readonly opll = Object.assign(new Ym2413(UPD7759_RATE), { v20Mix: true });

  private readonly mixer = new Mixer([this.upd, this.opll]);

  private static readonly COIN_DWELL = Math.floor(CPU_CLOCK * 0.06);
  private coinCycles = 0;
  private coinMask = 0;

  readonly volume = Object.assign(new SteppedVolume(0x1f), { count: 0x1f });
  private setVolumeLevel(level: number): void {
    if (!this.volumeApplies) return;
    setBoardLevel(level, [this.upd, this.opll]);
  }
  volumeApplies = true;
  private expansionLatch = 1;

  private meterFirq = false;
  private meterFirqCountdown = 0;
  private static readonly METER_FIRQ_HOLD_CYCLES = 100;

  meterLatch = 0;
  get meterLevels(): number { return this.meterLatch & Sc2.METER_LINES; }

  readonly meterCounts = new Uint32Array(8);
  private readonly meterBank = new MeterConfirm();

  private payLatch = 0;
  private paySelect = 0;
  private slideFiring = 0;
  readonly slideEjects = new Uint32Array(6);
  get triacLevels(): number {
    return this.slideFiring & 0x3f;
  }
  readonly slidePence: SlideEffect[] = [null, null, null, null, null, null];

  setSlidePence(slides: readonly SlideEffect[]): void {
    for (let i = 0; i < 6; i++) this.slidePence[i] = slides[i] ?? null;
  }

  private static readonly METER_UNIT_PENCE = 10;
  private static readonly METER_CASH_IN = 1;
  private static readonly METER_CASH_OUT = 2;
  private static readonly METER_TOKEN_OUT = 4;
  private static readonly METER_TICK_INSTRUCTIONS = 1000;
  private static readonly METER_LINES = 0x3f;
  private static readonly SLIDE_PENDING_CYCLES = 5 * CPU_CLOCK;
  private ledgerClock = 0;
  metersLive = false;
  private readonly pendingOut = { pence: 0, unpriced: 0, tokenPence: 0, deadline: 0 };

  private tickMeters(n: number): void {
    const confirmed = this.meterBank.advance(n, Sc2.METER_TICK_INSTRUCTIONS);
    if (confirmed) for (let b = 0; b < 8; b++) if (confirmed & (1 << b)) this.meterConfirmed(b);
  }

  private meterConfirmed(b: number): void {
    this.meterCounts[b]++;
    this.meterTotals.in += this.meterInMult[b];
    this.meterTotals.out += this.meterOutMult[b];
    this.meterHeld(b);
  }

  private meterHeld(bit: number): void {
    if (this.meterMapStated) {
      const out = this.meterLedgerMult[bit] ?? 0;
      if (out || this.meterInMult[bit] > 0) this.metersLive = true;
      if (out) {
        if (this.booksMoney) this.cashLedger.outPence += out * Sc2.METER_UNIT_PENCE;
        this.pendingOut.pence = 0;
        this.pendingOut.unpriced = 0;
      } else if (bit === Sc2.METER_TOKEN_OUT && this.meterOutMult[Sc2.METER_CASH_OUT] > 0
        && !(this.meterInMult[bit] > 0)) {
        this.metersLive = true;
        if (this.booksMoney) this.cashLedger.tokenOutPence += Sc2.METER_UNIT_PENCE;
        this.pendingOut.tokenPence = 0;
      }
      return;
    }
    if (bit === Sc2.METER_CASH_IN) { this.metersLive = true; return; }
    if (bit === Sc2.METER_CASH_OUT) {
      this.metersLive = true;
      if (this.booksMoney) this.cashLedger.outPence += Sc2.METER_UNIT_PENCE;
      this.pendingOut.pence = 0;
      this.pendingOut.unpriced = 0;
    } else if (bit === Sc2.METER_TOKEN_OUT) {
      this.metersLive = true;
      if (this.booksMoney) this.cashLedger.tokenOutPence += Sc2.METER_UNIT_PENCE;
      this.pendingOut.tokenPence = 0;
    }
  }

  private commitPendingOut(): void {
    const p = this.pendingOut;
    if (this.booksMoney) {
      this.cashLedger.outPence += p.pence;
      this.cashLedger.unpricedOut += p.unpriced;
      this.cashLedger.tokenOutPence += p.tokenPence;
    }
    p.pence = 0; p.unpriced = 0; p.tokenPence = 0; p.deadline = 0;
  }

  readonly meterTotals = { in: 0, out: 0 };
  private readonly meterInMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly meterOutMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly triacInMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly triacOutMult = [0, 0, 0, 0, 0, 0, 0, 0];

  setMeterMoneyMap(map: {
    meterIn: number[]; meterOut: number[]; triacIn: number[]; triacOut: number[];
  }): void {
    for (let i = 0; i < 8; i++) {
      this.meterInMult[i] = map.meterIn[i] ?? 0;
      this.meterOutMult[i] = map.meterOut[i] ?? 0;
      this.triacInMult[i] = map.triacIn[i] ?? 0;
      this.triacOutMult[i] = map.triacOut[i] ?? 0;
    }
    this.meterMapStated = this.meterInMult.some((x) => x > 0) || this.meterOutMult.some((x) => x > 0);
    [this.meterLedgerMult] = ledgerOutMults(
      { in: this.meterInMult, out: this.meterOutMult },
      { in: this.triacInMult, out: this.triacOutMult },
    );
  }
  private meterLedgerMult: number[] = [];

  meterMapStated = false;

  get moneyOutMeters(): { meters: number[]; from: 'layout' | 'manual' } {
    if (!this.meterMapStated) return { meters: [Sc2.METER_CASH_OUT + 1], from: 'manual' };
    const meters: number[] = [];
    this.meterLedgerMult.forEach((x, i) => { if (x > 0) meters.push(i + 1); });
    return { meters, from: 'layout' };
  }

  private bookSlide(i: number): void {
    if (!this.metersLive) {
      const price = this.slidePence[i];
      const p = this.pendingOut;
      if (typeof price === 'number') p.pence += price;
      else if (price === 'token') p.tokenPence += Sc2.COIN_PENCE[Sc2.TOKEN_LINE];
      else p.unpriced++;
      p.deadline = this.ledgerClock + Sc2.SLIDE_PENDING_CYCLES;
    }
    this.meterTotals.in += this.triacInMult[i];
    this.meterTotals.out += this.triacOutMult[i];
  }

  private nvram: Uint8Array | null = null;

  private readonly ioLog = new Map<number, IoAccess>();
  readonly io = new Uint8Array(0x2000);

  constructor() {
    this.cpu = new M6809(this);
    this.initE2ram();
    this.inputRegs.set(this.idleInputs);
  }

  private initE2ram(): void {
    this.eeprom.data.fill(0);
    this.eeprom.data.set([1, 4, 10, 20, 0, 1, 1, 4, 10, 20]);
  }

  get clockHz(): number {
    return CPU_CLOCK;
  }

  get display(): Bd1 {
    return this.vfd;
  }

  get audioSource(): Mixer {
    return this.mixer;
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
    if (this.#presetRows.some((r) => r.number === id)) return true;
    return Sc2.DIL_LINES.some((l) => l !== null && l[0] * 8 + l[1] === id);
  }

  setInput(strobe: number, bit: number, on: boolean): void {
    if (strobe >= 12) return;
    const mask = 1 << bit;
    if (on) this.inputRegs[strobe] |= mask;
    else this.inputRegs[strobe] &= ~mask & 0xff;
  }

  setLayoutSwitches(list: readonly LayoutSwitch[]): void {
    const wanted = list.filter((s) => s.number >= 0 && s.number >> 3 < 12 && (s.number & 7) < 5);
    if (!wanted.length) return;
    this.panel = wanted.map((s) => ({ ...s }));
    for (const s of wanted) this.idleInputs[s.number >> 3] &= ~(1 << (s.number & 7)) & 0xff;
    for (const s of wanted) {
      if (s.closed) this.idleInputs[s.number >> 3] |= 1 << (s.number & 7);
      this.#stated.stateLine(s.number, s.closed);
    }
    this.inputRegs.set(this.idleInputs);
  }

  readonly #presetRows: { number: number; label: string }[] = [];

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    if (id < 0 || id >> 3 >= 12 || (id & 7) >= 5) return;
    const mask = 1 << (id & 7);
    if (made) { this.idleInputs[id >> 3] |= mask; this.inputRegs[id >> 3] |= mask; }
    else { this.idleInputs[id >> 3] &= ~mask & 0xff; this.inputRegs[id >> 3] &= ~mask & 0xff; }
    this.#stated.stateLine(id, made);
    if (this.panel.length && !this.panel.some((s) => s.number === id)
      && !this.#presetRows.some((r) => r.number === id)) {
      this.#presetRows.push({ number: id, label });
    }
  }

  setDils(bank1: string | undefined, bank2: string | undefined): void {
    const bits = (s: string | undefined, first: number): void => {
      if (!s) return;
      for (let i = 0; i < 8; i++) {
        const line = Sc2.DIL_LINES[first + i];
        if (!line) continue;
        const mask = 1 << line[1];
        if (s[i] === '1') this.idleInputs[line[0]] |= mask;
        else this.idleInputs[line[0]] &= ~mask & 0xff;
        this.#stated.state(line[0], mask, s[i] === '1' ? mask : 0);
      }
    };
    bits(bank1, 0);
    bits(bank2, 8);
    this.inputRegs.set(this.idleInputs);
  }

  private static readonly DIL_LINES: ([number, number] | null)[] = [
    null, [9, 1], [9, 2], [9, 3], [9, 4], [10, 0], [10, 1], [10, 2],
    null, [10, 3], [10, 4], [11, 0], [11, 1], [11, 2], [11, 3], [11, 4],
  ];

  private dilLabels: readonly string[] | null = null;

  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  private panel: LayoutSwitch[] = [];

  get switchPanel(): CabinetSwitch[] {
    const state = (n: number): boolean => (this.inputRegs[n >> 3] & (1 << (n & 7))) !== 0;
    const keyed = (n: number): boolean =>
      Sc2.KEY_SOCKETS.some((k) => k.strobe === n >> 3 && (k.mask & (1 << (n & 7))) !== 0);
    const shown = this.panel.filter((s) => !keyed(s.number));
    const repeats = new Map<string, number>();
    for (const s of shown) repeats.set(s.label, (repeats.get(s.label) ?? 0) + 1);
    const nth = new Map<string, number>();
    const out: CabinetSwitch[] = shown.map((s) => {
      const n = (nth.get(s.label) ?? 0) + 1;
      nth.set(s.label, n);
      const label = s.label
        ? (repeats.get(s.label)! > 1 ? `${s.label} ${n}` : s.label)
        : `Switch ${s.number}`;
      return { id: s.number, label, on: state(s.number) };
    });
    for (const r of this.#presetRows) out.push({ id: r.number, label: r.label, on: state(r.number) });
    Sc2.DIL_LINES.forEach((line, i) => {
      if (!line) return;
      const id = line[0] * 8 + line[1];
      out.push({
        id,
        label: dilSwitchLabel(`DIL${String(i + 1).padStart(2, '0')}`, this.dilLabels?.[i]),
        on: state(id),
        group: 'DIL switches',
        option: true,
        bootOnly: true,
      });
    });
    return out;
  }

  private static readonly COIN_PENCE = [10, 20, 50, 100, 20];
  private static readonly TOKEN_LINE = 4;

  readonly cashLedger = newCashLedger();

  readonly dataPak = new DataPak(CPU_CLOCK);
  private dataPakType = 0;
  private ackQueue: number[] = [];
  private ackDue = 0;
  private static readonly ACK_DELAY = 50_000;

  fitDataport(protocol = 1): void {
    this.dataPakType = protocol;
  }

  private ackReady(): boolean {
    return this.ackQueue.length > 0 && this.ackDue <= 0;
  }

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: '256 LAMPS', part: '32 cols x 8', device: this.lamps, signal: 'lamps' },
      { id: 'switches', label: 'SWITCH MUX', part: '12 strobes x 5', device: this.inputRegs },
      { id: 'meters', label: '8 METERS', part: 'electromechanical', device: this.meterCounts },
      { id: 'coins', label: 'COIN INPUTS', part: '$3FFF', signal: 'coin' },

      { id: 'mux', label: 'LAMP / INPUT MUX',
        part: '$2300-$231F columns - $2300-$230B strobes',
        device: this.io, io: [[MUX_BASE, MUX_END]] },
      { id: 'watchdog', label: 'WATCHDOG', part: '555', modelled: true,
        note: 'Modelled as a cycle counter and its kick, not as a device.' },

      { id: 'ram', label: 'BATTERY RAM', part: '8K', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: '64K - banked window', device: this.rom },
      { id: 'eeprom', label: 'EEPROM', part: 'X24C08', device: this.eeprom },
      { id: 'keyprom', label: 'KEY PROM', part: 'video sets only' },
      { id: 'upd', label: 'SPEECH', part: 'uPD7759', device: this.upd,
        io: [[UPD_LATCH, UPD_LATCH + 1], [UPD_RESET, UPD_RESET + 1]] },
      { id: 'opll', label: 'FM', part: 'YM2413', device: this.opll,
        io: [[OPLL_ADDR, OPLL_DATA + 1]] },
      ...(this.dm01
        ? [{ id: 'dm01', label: 'DOT MATRIX', part: 'DM01 - 65x21, own MC6809',
            device: this.dm01 } as BoardPart]
        : [{ id: 'alpha', label: 'VFD', part: 'BD1 - 16 char', device: this.vfd,
            signal: 'display' } as BoardPart]),

      { id: 'cpu', label: 'CPU', part: 'MC6809 - 2 MHz E', device: this.cpu, cpu: true },
      { id: 'timer', label: 'TIMER IRQ', part: '1 kHz tick', modelled: true,
        note: 'Modelled as a cycle accumulator on this board, not as a timer chip.' },
      { id: 'bank', label: 'ROM BANK', part: '$2E00 - 4 pages', modelled: true,
        note: 'Modelled as a page register indexing the ROM image, not as a device.' },
      { id: 'uarts', label: 'DATALINK UARTs', part: 'MC6850 x2' },

      { id: 'reels', label: 'REEL MECH', part: 'Starpoint', device: this.reels, signal: 'reels' },
      { id: 'hopper', label: 'PAYOUT SLIDES', part: '6 slides + triacs',
        device: this.slideEjects },
      { id: 'coinmech', label: 'COIN MECH', part: 'acceptor', signal: 'coin' },
    ];
  }

  insertCoin(bit: number): void {
    if (this.coinCycles > 0) return;
    const line = bit & 7;
    if (!(this.io[0x232f & 0x1fff] & (1 << line))) { this.coinsRefused++; return; }
    const taken = this.programCoinOn(line);
    this.coinMask = this.linePattern(line);
    this.coinCycles = Sc2.COIN_DWELL;
    this.coins |= this.coinMask;
    if (taken === 'refused') { this.coinsRefused++; return; }
    if (this.wiring) { this.bookWiredCoin(line, taken); return; }
    this.bookProgramCoin(line, taken);
  }

  private bookProgramCoin(line: number, taken: SlotCoin | null): void {
    if (taken === null) {
      noteBoardDefault(this, {
        axis: 'coin',
        text: 'the program\'s coin table was not read - a coin books the board\'s price for its line',
        ifWrong: 'A coin the program values differently, or does not take, books the wrong money.',
      });
      if (line === Sc2.TOKEN_LINE) this.cashLedger.tokenInPence += Sc2.COIN_PENCE[line] ?? 0;
      else this.cashLedger.inPence += Sc2.COIN_PENCE[line] ?? 0;
      return;
    }
    if (typeof taken === 'number') { this.cashLedger.inPence += taken; return; }
    if (taken.token === null) this.cashLedger.unpricedTokenIn++;
    else this.cashLedger.tokenInPence += taken.token;
  }

  private coinTablesCache: { rom: Uint8Array; t: Sc2CoinTables | { refused: string } } | null = null;
  private coinTables(): Sc2CoinTables | { refused: string } {
    if (this.coinTablesCache?.rom !== this.rom) this.coinTablesCache = { rom: this.rom, t: locateSc2CoinTables(this.rom) };
    return this.coinTablesCache.t;
  }

  private readonly programMem: Sc2Mem = (a) => (a < RAM_SIZE ? this.ram[a]! : a >= 0x8000 && a < this.rom.length ? this.rom[a]! : 0);

  private programCoins(): Map<number, SlotCoin> | { refused: string } {
    const t = this.readCoinTable();
    if ('refused' in t) return t;
    return detectCoins(t);
  }

  private programCoinOn(line: number): SlotCoin | 'refused' | null {
    const t = this.coinTables();
    if ('refused' in t) return null;
    const hit = sc2ProgramLine(t, this.rom, this.programMem, this.linePattern(line));
    if (hit === 'refused') return 'refused';
    if (hit === null) return null;
    const coins = this.programCoins();
    if (!(coins instanceof Map)) return null;
    return coins.get(hit) ?? 'refused';
  }

  private linePattern(line: number): number {
    const bit = 1 << line;
    if (this.cabinetLines.includes(line)) return bit;
    const t = this.coinTables();
    return 'refused' in t ? bit : sc2LinePattern(t, this.rom, this.programMem, line);
  }

  private cabinetLines: number[] = [];

  coinsRefused = 0;

  get coinRefusing(): number {
    const inhibit = this.io[0x232f & 0x1fff]!;
    let m = 0;
    for (let n = 0; n < SC2_COIN_LINES; n++) {
      if (!(inhibit & (1 << n)) || this.programCoinOn(n) === 'refused') m |= 1 << n;
    }
    return m >>> 0;
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

  private bookWiredCoin(line: number, taken: SlotCoin | null): void {
    const w = this.wiring!;
    if (!this.booksMoney || w.conflicts.includes(line)) return;
    const c = w.coins.get(line);
    if (c === undefined) {
      this.bookProgramCoin(line, taken);
      return;
    }
    if (taken !== null) {
      const agrees = typeof c === 'number'
        ? typeof taken === 'number' && taken === c
        : typeof taken === 'object' && (c.token === null || c.token === taken.token);
      this.wiringState.state = agrees ? 'calibrated' : 'disagrees';
      if (!agrees) return;
    }
    if (typeof c === 'number') { this.cashLedger.inPence += c; return; }
    if (c.token === null) { this.cashLedger.unpricedTokenIn++; return; }
    this.cashLedger.tokenInPence += c.token;
  }

  private coinSlots: number[] = [];

  setLayoutCoins(list: readonly DeclaredCoin[]): void {
    const slots = new Set<number>();
    const drawn = new Set<number>();
    for (const c of list) {
      if (c.named?.name.startsWith('ccTalk') || c.named?.name.startsWith('NV')) continue;
      let line: number | null = null;
      if (c.line !== null) line = c.line;
      else if (c.note !== null && c.note >= 0x0f && c.note <= 0x16) {
        if (c.note - 0x0f < Sc2.ROW_LINES) line = c.note - 0x0f;
      } else if (c.note === 0x47 && c.button !== null && c.button >= 0 && c.button < 128
        && ((c.button >> 3) & 15) === Sc2.COIN_ROW && (c.button & 7) < Sc2.ROW_LINES) line = c.button & 7;
      if (line === null) line = c.token ? Sc2.TOKEN_LINE : Sc2.DEFAULT_LINE;
      drawn.add(line);
      if (c.pence === null) slots.add(line);
    }
    this.cabinetLines = [...drawn].sort((a, b) => a - b);
    this.coinSlots = [...slots].sort((a, b) => a - b);
  }

  private static readonly COIN_ROW = 10;
  private static readonly ROW_LINES = 5;
  private static readonly DEFAULT_LINE = 3;

  get unnamedCoinLines(): readonly number[] {
    return this.coinSlots;
  }

  private readCoinTable(): CoinLineTable | { refused: string } {
    const t = this.coinTables();
    if ('refused' in t) return t;
    return sc2CoinTable(t, this.rom, this.programMem);
  }

  get coinLineTable(): CoinLineTable | null {
    const t = this.readCoinTable();
    return 'refused' in t ? null : t;
  }

  get coinLineTableRefusal(): string | null {
    const t = this.readCoinTable();
    return 'refused' in t ? t.refused : null;
  }

  get coinBusy(): boolean {
    return this.coinCycles > 0;
  }

  loadRom(image: Uint8Array, decode = true): void {
    const raw = new Uint8Array(ROM_SIZE).fill(ROM_UNPLACED);
    noteRomCut(this, image.length, ROM_SIZE);
    raw.set(image.subarray(0, ROM_SIZE), Math.max(0, ROM_SIZE - Math.min(image.length, ROM_SIZE)));
    if (!decode) {
      this.rom.set(raw);
      this.wireOptionKeys();
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
    this.wireOptionKeys();
  }

  loadSoundRom(data: Uint8Array): void {
    this.upd.loadRom(data);
  }

  private varStake = false;

  private wireOptionKeys(): void {
    const text = Array.from(this.rom, (b) => String.fromCharCode(b)).join('');
    if (!text.includes('VAR STAKE')) return;
    this.varStake = true;
    this.fitKey(5, 0x07, 0x04);
    this.fitKey(6, 0x0f, 0x0a);
  }

  private percentKey = 0;

  setPercentageKey(index: number | undefined): void {
    this.percentKey = index !== undefined && Number.isInteger(index) && index >= 0 && index < 15
      ? index + 1 : 0;
  }

  private fitKey(strobe: number, mask: number, value: number): void {
    this.idleInputs[strobe] = (this.idleInputs[strobe] & ~mask) | (value & mask);
    this.inputRegs[strobe] = (this.inputRegs[strobe] & ~mask) | (value & mask);
    this.#stated.state(strobe, mask, value);
  }

  get optionKeys(): OptionKey[] {
    const generic = (n: number) =>
      ['Not fitted', ...Array.from({ length: n }, (_, i) => `Position ${i + 1}`)];
    const stake = this.varStake
      ? ['Not fitted', '£3 cash', '£4 cash', '£6 cash', '£6 token', '£8 cash', '£8 token', '£10 cash']
      : generic(7);
    return Sc2.KEY_SOCKETS.map(({ label, strobe, mask }) => ({
      label,
      positions: strobe === 5 ? stake : generic(15),
      position: () => (strobe === 6 && this.percentKey) || (this.idleInputs[strobe] & mask),
      fit: (v: number) => {
        if (strobe === 6) this.percentKey = 0;
        this.fitKey(strobe, mask, v);
      },
    }));
  }

  private static readonly KEY_SOCKETS = [
    { label: 'Stake/jackpot key', strobe: 5, mask: 0x07 },
    { label: 'Percentage key', strobe: 6, mask: 0x0f },
  ];

  batteryRam(): Uint8Array { return this.ram.slice(0, RAM_SIZE); }

  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, RAM_SIZE);
    this.ram.set(this.nvram);
  }

  powerCycle(): void {
    this.nvram = this.ram.slice();
    this.reset();
  }

  reset(): void {
    this.dataPak.reset();
    this.ackQueue = [];
    this.ackDue = 0;
    if (this.nvram) this.ram.set(this.nvram);
    else this.ram.fill(0);
    this.inputRegs.set(this.idleInputs);
    this.dm01?.reset();
    this.warmReset();
  }

  private warmReset(): void {
    this.bank = 3;
    this.vfd.reset();
    this.i2c.reset();
    resetReelsInPlace(this.reels);
    this.lampStore.reset();
    this.io.fill(0);
    this.timerEnabled = false;
    this.timerCycles = 0;
    this.irqArmed = false;
    this.irqStatus = 0;
    this.timerStat = 0;
    this.watchdogCycles = 0;
    this.upd.reset();
    this.opll.reset();
    this.soundBankHigh = 0;
    this.meterLatch = 0;
    this.meterFirq = false;
    this.meterFirqCountdown = 0;
    this.meterBank.reset();
    this.volume.count = 0x1f;
    this.setVolumeLevel(this.volume.set(this.volume.counted()));
    this.expansionLatch = 1;
    this.payLatch = 0;
    this.paySelect = 0;
    this.slideFiring = 0;
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
    if (a >= 0x4000) {
      if (a < 0x6000 || a >= 0x8000) return this.rom[a];
      return this.rom[(this.bank & 3) * 0x2000 + (a - 0x6000)];
    }
    return this.readIo(a);
  }

  write8(addr: number, val: number): void {
    const a = addr & 0xffff;
    const v = val & 0xff;
    if (a < RAM_SIZE) {
      this.ram[a] = v;
      return;
    }
    if (a < 0x4000) this.writeIo(a, v);
  }

  private readIo(a: number): number {
    this.noteIo(a, false);
    if (a === 0x2000) {
      let v = 0;
      for (let i = 0; i < this.reels.length; i++) if (this.reels[i].optic()) v |= 1 << i;
      v &= this.reelFit.mask;
      if (this.upd.active()) v |= 0x80;
      if (this.dm01?.busy()) v |= 0x40;
      return v;
    }
    if (a >= MUX_BASE && a < MUX_BASE + 0x0c) {
      const off = a - MUX_BASE;
      if (off >= 8) return 0xff;
      let low = this.inputRegs[off] & 0x1f;
      if (this.dm01 && off === (this.dmBusySwitch >> 3)) {
        const bit = 1 << (this.dmBusySwitch & 7);
        low = (low & ~bit & 0x1f) | (this.dm01.busy() ? 0 : bit);
      }
      const high = off < 4
        ? (this.inputRegs[off + 8] & 0x07) << 5
        : ((this.inputRegs[off + 4] << 2) & 0x60);
      const key = off >= 6 ? this.percentKey : 0;
      return low | high | key;
    }
    if (a === 0x2329) {
      this.cpu.setIRQ(false);
      this.irqArmed = false;
      this.timerStat = 0;
      this.irqStatus = 0;
      return 0;
    }
    if (a === 0x232e) {
      const v = this.irqStatus | this.timerStat | 0x80;
      this.timerStat = 0;
      return v;
    }
    if (a === 0x2400) return 0x02 | (this.ackReady() ? 0x01 : 0x00);
    if (a === 0x2600) return 0x02;
    if (a === 0x2500) {
      if (!this.ackReady()) return 0x00;
      const v = this.ackQueue.shift() ?? 0;
      this.ackDue = Sc2.ACK_DELAY;
      return v;
    }
    if (a === 0x2700) return 0x00;
    if (a >= 0x3c00 && a < 0x3c08) {
      const off = a - 0x3c00;
      let v = this.key[off];
      if (off === 7) v = (v & 0xfe) | (this.i2c.data() ? 1 : 0);
      return v;
    }
    if (a === 0x3fff) return this.coins;
    if (!sc2ReadDecoded(a)) this.strays.hit(a);
    return this.io[a & 0x1fff];
  }

  readonly strays = new StrayCounter();

  private writeIo(a: number, v: number): void {
    this.noteIo(a, true);
    this.io[a & 0x1fff] = v;

    if (a === 0x2500 && this.dataPakType) {
      const reply = this.dataPak.receive(v, this.cpu.cycles);
      if (reply && this.dataPakType === 1) {
        if (!this.ackQueue.length) this.ackDue = Sc2.ACK_DELAY;
        this.ackQueue.push(...reply);
      }
    }

    if (a >= 0x2000 && a < 0x2300) {
      const pair = (a >> 8) & 3;
      this.reels[pair * 2]?.update(v & 0x0f);
      this.reels[pair * 2 + 1]?.update((v >> 4) & 0x0f);
      return;
    }
    if (a >= MUX_BASE && a < MUX_END) {
      this.lampStore.writeByte((a - MUX_BASE) * 8, v);
      return;
    }
    switch (a) {
      case 0x2320:
      case 0x2321:
      case 0x2322:
      case 0x2323:
        this.lampStore.setDimMask(DIM_SELECT * 2 + (a - 0x2320), v);
        return;
      case 0x2336:
        this.lampStore.setDimLevel(DIM_SELECT, v);
        return;
      case 0x2329:
        this.timerEnabled = (v & 1) !== 0;
        return;
      case 0x2332:
        this.watchdogCycles = 0;
        return;
      case 0x2330:
        this.payLatch = v;
        return;
      case 0x2338:
        this.paySelect = v;
        return;
      case 0x2331: {
        if (this.paySelect !== 0x57) return;
        const slide = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20].indexOf(this.payLatch);
        if (slide < 0) return;
        const bit = 1 << slide;
        if (v === 0x4d) {
          if (!(this.slideFiring & bit)) {
            this.slideFiring |= bit;
            this.slideEjects[slide]++;
            this.bookSlide(slide);
          }
        } else {
          this.slideFiring &= ~bit;
        }
        return;
      }
      case 0x2333: {
        if ((this.meterLatch & Sc2.METER_LINES) === v) return;
        this.meterLatch = v & Sc2.METER_LINES;
        if (this.meterLatch === 0) this.meterFirqCountdown = Sc2.METER_FIRQ_HOLD_CYCLES;
        else this.meterFirq = true;
        this.meterBank.write(this.meterLatch);
        return;
      }
      case 0x2800:
        if (this.dm01) this.dm01.queueChar(v);
        else this.vfd.writeChar(v);
        return;
      case 0x2900:
        this.vfd.reset();
        if (this.dm01 && v === 0) this.dm01.reset();
        return;
      case 0x2324:
        this.soundBankHigh = (v >> 1) & 1;
        if ((this.expansionLatch ^ v) & 0x04 && !(v & 0x04)) {
          this.setVolumeLevel(this.volume.step((v & 0x08) !== 0));
        }
        this.expansionLatch = v;
        return;
      case 0x2337:
        this.setVolumeLevel(this.volume.set(v ? 0xff : this.volume.counted()));
        return;
      case UPD_LATCH:
        this.upd.setRomBank(((v >> 7) & 1) | (this.soundBankHigh << 1));
        this.upd.portW(v & 0x3f);
        this.upd.setStartLine(false);
        this.upd.setStartLine(true);
        return;
      case UPD_RESET:
        this.upd.setResetLine((v & 0x01) !== 0);
        return;
      case OPLL_ADDR:
        this.opll.writeAddress(v);
        return;
      case OPLL_DATA:
        this.opll.writeData(v);
        return;
      case 0x2e00:
        this.bank = v & 3;
        return;
      case 0x3c80:
        this.i2c.set((v & 1) === 0, (v & 2) === 0);
        return;
      default:
        if (!sc2WriteDecoded(a)) this.strays.hit(a);
        return;
    }
  }

  step(): number {
    const dropIrq = this.irqArmed;

    const cycles = this.cpu.step();
    this.tickMeters(1);
    this.ledgerClock += cycles;
    if (this.pendingOut.deadline && this.ledgerClock >= this.pendingOut.deadline) this.commitPendingOut();

    if (this.ackDue > 0) this.ackDue -= cycles;

    if (dropIrq) {
      this.cpu.setIRQ(false);
      this.irqArmed = false;
    }
    if (this.meterFirqCountdown !== 0) {
      this.meterFirqCountdown -= cycles;
      if (this.meterFirqCountdown <= 0) {
        this.meterFirqCountdown = 0;
        this.meterFirq = false;
      }
    }
    this.cpu.setFIRQ(this.meterFirq);

    this.timerCycles += cycles;
    const period = Math.floor(CPU_CLOCK / TIMER_HZ);
    if (this.timerCycles >= period) {
      this.timerCycles -= period;
      if (this.timerEnabled) {
        this.timerStat = 0x01;
        this.irqStatus = 0x02;
        this.cpu.setIRQ(true);
        this.irqArmed = true;
      }
    }

    this.watchdogCycles += cycles;
    if (this.watchdogCycles >= Sc2.WATCHDOG_CYCLES) {
      this.watchdogCycles = 0;
      this.watchdogResets++;
      this.warmReset();
      return cycles;
    }

    this.upd.tick(cycles, CPU_CLOCK);
    this.opll.tick(cycles, CPU_CLOCK);

    this.dm01?.run(cycles);

    if (this.coinCycles > 0) {
      this.coinCycles -= cycles;
      if (this.coinCycles <= 0) {
        this.coins &= ~this.coinMask & 0xff;
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
