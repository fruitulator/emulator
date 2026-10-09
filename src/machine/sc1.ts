import { ROM_UNPLACED } from './pairplacer';
import type { Bus } from '../cpu/bus';
import type { CabinetSwitch, Machine, CoinWiringStatus } from './machine';
import { newCashLedger, dilSwitchLabel } from './machine';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import { StatedLines } from './statedlines';
import { M6809 } from '../cpu/m6809';
import type { SlideEffect } from '../layout/fmlconfig';
import { Bd1 } from '../hw/bd1';
import { Reel } from '../hw/reel';
import { MODEL_RELATIONS, parkAtV20PowerUp, resetReelsInPlace } from './v20optic';
import { Upd7759, UPD7759_RATE } from '../hw/upd7759';
import { DataPak } from '../hw/datapak';
import { MeterConfirm } from '../hw/meterconfirm';
import { Ay8910 } from '../hw/ay8910';
import { Mixer } from '../hw/mixer';
import { LampHistory } from '../hw/lamphistory';
import { fitReelBank, type ReelFit } from './reelfit';
import { noteBoardDefault, noteRomCut } from './boarddefaults';
import { detectCoins, linesOf, type CoinLineTable, type CoinWiring, type SlotCoin, type StepState } from './coinwiring';
import type { DeclaredCoin } from './layoutcoins';
import { CoinLockJudge, locateSc1CoinTables, sc1CoinSwitches, sc1CoinTable, sc1LockedLines, sc1PlainCoinMask, SC1_COIN_LINES, type Sc1CoinSwitch, type Sc1CoinTables, type Sc1Mem } from './sc1coins';
import type { Refusal } from './coinwiring';
import { StrayCounter } from './strayaccess';
import { mpu4RomImage } from './mpu4';

export const MASTER_CLOCK = 4_000_000;
export const CPU_CLOCK = MASTER_CLOCK / 4;

const RAM_SIZE = 0x2000;
const DIRECT_COIN_ROW = 8;
const ROM_SIZE = 0x10000;

const TIMER_HZ = 1000;
const METER_TICK_INSTRUCTIONS = 1000;

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

export class Sc1 implements Bus, Machine {
  static readonly snapshotConfig: readonly string[] = ['nvram', 'wiring', 'coinSlots', 'coinTablesCache', 'programMem'];
  readonly cpu: M6809;
  readonly ram = new Uint8Array(RAM_SIZE);
  readonly rom = new Uint8Array(ROM_SIZE);
  private bank = 3;

  readonly vfd = new Bd1();

  private vfdShift = 0;
  private vfdBits = 0;
  private vfdSclk = 0;
  private vfdData = 0;

  readonly reels = parkAtV20PowerUp([0, 1, 2, 3, 4, 5].map(
    () => new Reel({
      stepsPerRevolution: 96, symbols: 16, mame: true,
      indexStart: 1, indexEnd: 3, indexPattern: 0, initPhase: 4,
    }),
  ), MODEL_RELATIONS.SCORPION1);

  setReelPosition(i: number, pos: number): void {
    this.reels[i]?.park(pos);
  }

  reelFit: ReelFit = { mask: 0x3f, channels: 6, beyond: [] };

  setFittedReels(channels: readonly number[]): ReelFit {
    this.reelFit = fitReelBank(this.reels, channels);
    return this.reelFit;
  }

  reelStripOffsets: number[] = [0, 0, 0, 0, 0, 0];

  readonly lampHistory = new LampHistory(256);
  get lamps(): Uint8Array {
    return this.lampHistory.level;
  }

  readonly inputRegs = new Uint8Array(DIRECT_COIN_ROW + 1);

  private readonly idleInputs = new Uint8Array(DIRECT_COIN_ROW + 1);

  readonly #stated = new StatedLines(8);

  postRestore(): void {
    this.#stated.reassert(this.idleInputs, this.inputRegs);
  }

  private mux1Latch = 0x08;
  private mux1DataLo = 0;
  private mux1DataHi = 0;
  private mux1Input = 0;
  private mux2Latch = 0x08;
  private mux2DataLo = 0;
  private mux2DataHi = 0;
  private mux2Input = 0;

  private locked = 0x07;

  private timerCycles = 0;
  private irqArmed = false;
  private firqArmed = false;
  private irqStatus = 0;

  private static readonly WATCHDOG_CYCLES = Math.floor(CPU_CLOCK * 0.1);
  private watchdogCycles = 0;
  watchdogResets = 0;

  readonly ay = new Ay8910(MASTER_CLOCK / 4, 'ay8910', UPD7759_RATE);

  readonly upd = new Upd7759();
  private updFitted = false;

  private readonly mixer = new Mixer([this.upd, this.ay]);

  meterLatch = 0;
  get meterLevels(): number { return this.meterLatch & 0xff; }
  readonly meterCounts = new Uint32Array(8);
  private readonly meterBank = new MeterConfirm();

  triacLatch = 0;

  private triacWord = 0;

  readonly slideEjects = new Uint32Array(8);
  get triacLevels(): number {
    return this.triacWord;
  }

  private driveSlides(): void {
    const pa = ~this.ay.portAOut & 0xff;
    const word = this.triacLatch ? (pa & 0x0f) | ((pa & 0xc0) >> 2) : 0;
    const rising = word & ~this.triacWord;
    this.triacWord = word;
    for (let b = 0; b < 8; b++) {
      if (rising & (1 << b)) {
        this.slideEjects[b]++;
        this.gridTotals.in += this.triacInMult[b]!;
        this.gridTotals.out += this.triacOutMult[b]!;
        this.bookSlide(b);
      }
    }
  }

  readonly slidePence: SlideEffect[] = [null, null, null, null, null, null, null, null];

  setSlidePence(slides: readonly SlideEffect[]): void {
    for (let i = 0; i < 8; i++) this.slidePence[i] = slides[i] ?? null;
  }

  private bookSlide(i: number): void {
    if (!this.booksMoney) return;
    const price = this.slidePence[i];
    if (typeof price === 'number') this.cashLedger.outPence += price;
    else if (price === 'token') this.cashLedger.tokenOutPence += Sc1.TOKEN_PENCE;
    else this.cashLedger.unpricedOut++;
  }

  private static readonly COIN_DWELL = Math.floor(CPU_CLOCK * 0.06);
  private coinCycles = 0;
  private coinMask = 0;
  private coinStrobe = 0;
  private coinNext: Sc1CoinSwitch[] = [];
  private readonly judge = new CoinLockJudge();

  private static readonly COIN_PENCE: (number | null)[] = [10, 20, 50, 100, null];

  private coinLinePence: (number | null)[] = [...Sc1.COIN_PENCE];

  setCoinLinePence(table: (number | null)[]): void {
    for (let i = 0; i < table.length && i < this.coinLinePence.length; i++) {
      this.coinLinePence[i] = table[i];
    }
  }
  private static readonly TOKEN_LINE = 4;
  private static readonly TOKEN_PENCE = 20;

  readonly cashLedger = newCashLedger();

  private dataportFitted = false;
  private readonly dataPak = new DataPak(CPU_CLOCK);
  private ackQueue: number[] = [];
  private ackDue = 0;
  private static readonly ACK_DELAY = 50_000;

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
    if (this.doorSwitches.some((d) => d.number === id)) return true;
    return id >= 48 && id < 64;
  }

  private readonly doorSwitches: { number: number; label: string }[] = [];

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    if (id < 0 || id >= 64) return;
    const mask = 1 << (id & 7);
    if (made) { this.idleInputs[id >> 3] |= mask; this.inputRegs[id >> 3] |= mask; }
    else { this.idleInputs[id >> 3] &= ~mask & 0xff; this.inputRegs[id >> 3] &= ~mask & 0xff; }
    this.#stated.stateLine(id, made);
    if (!this.doorSwitches.some((d) => d.number === id)) this.doorSwitches.push({ number: id, label });
  }

  setInput(strobe: number, bit: number, on: boolean): void {
    if (strobe >= this.inputRegs.length) return;
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

  private percentKey = 0;

  setPercentKey(v: number): void {
    this.percentKey = v & 0xff;
  }

  fitDataport(): void {
    this.dataportFitted = true;
  }

  private ackReady(): boolean {
    return this.ackQueue.length > 0 && this.ackDue <= 0;
  }

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: '256 LAMPS', part: '2 muxes x 8 strobes x 16', device: this.lamps, signal: 'lamps' },
      { id: 'switches', label: 'SWITCH MUX', part: '8 strobes x 8', device: this.inputRegs },
      { id: 'meters', label: '8 METERS', part: 'electromechanical', device: this.meterCounts },
      { id: 'coins', label: 'COIN INPUTS', part: 'STROBE 0 b0-4', signal: 'coin' },

      { id: 'mux1', label: 'MUX 1', part: '$2A00 - lamps 0-127, inputs', device: this.io },
      { id: 'mux2', label: 'MUX 2', part: '$3408 - lamps 128-255, optics', device: this.io },

      { id: 'ram', label: 'BATTERY RAM', part: '8K', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: '64K - banked window', device: this.rom },
      { id: 'watchdog', label: 'WATCHDOG', part: '555', modelled: true,
        note: 'Modelled as a cycle counter and its kick, not as a device.' },
      { id: 'timer', label: 'TIMER IRQ', part: '1 kHz tick', modelled: true,
        note: 'Modelled as a cycle accumulator on this board, not as a timer chip.' },
      { id: 'bank', label: 'ROM BANK', part: '$3600 - 4 pages', modelled: true,
        note: 'Modelled as a page register indexing the ROM image, not as a device.' },

      { id: 'alpha', label: 'VFD', part: 'BD1 - 16 char, bit-serial', device: this.vfd,
        signal: 'display' },
      { id: 'ay', label: 'SOUND', part: 'AY8912', device: this.ay },
      { id: 'upd', label: 'SPEECH', part: 'uPD7759 (Viper)',
        ...(this.updFitted ? { device: this.upd } : {}) },
      { id: 'acia', label: 'DATAPORT', part: 'MC6850' },

      { id: 'cpu', label: 'CPU', part: 'MC6809 - 1 MHz E', device: this.cpu, cpu: true },
      { id: 'reels', label: 'REEL MECH', part: 'Starpoint', device: this.reels, signal: 'reels' },
      { id: 'triac', label: 'PAYSLIDES', part: 'triac latch' },
      { id: 'coinmech', label: 'COIN MECH', part: 'acceptor', signal: 'coin' },
    ];
  }

  insertCoin(bit: number): void {
    if (this.coinCycles > 0) return;
    const line = bit;
    if (!Number.isInteger(line) || line < 0 || line >= SC1_COIN_LINES) { this.coinsRefused++; return; }
    const taken = this.programCoinOn(line);
    const [sw, ...next] = sc1CoinSwitches(this.coinTables(), this.rom, this.programMem, line);
    this.coinNext = next;
    this.pulseCoinSwitch(sw!);
    const t = this.coinTables();
    const mask = 'refused' in t || !t.lock ? 0 : sc1PlainCoinMask(t, this.rom, this.programMem, line);
    this.judge.begin(line, mask, taken === 'refused', Sc1.JUDGE_WAIT);
    if (taken === 'refused') { this.coinsRefused++; return; }
    this.bookTakenCoin(line, taken);
  }

  private bookTakenCoin(line: number, taken: SlotCoin | null): void {
    this.judge.book(this.cashLedger, () => {
      if (this.wiring) this.bookWiredCoin(line, taken);
      else this.bookProgramCoin(line, taken);
    });
  }

  private static readonly JUDGE_WAIT = Math.floor(CPU_CLOCK * 0.5);

  private judgeCoinLeaving(cycles: number): void {
    const t = this.coinTables();
    const line = this.judge.line;
    const v = this.judge.watch(cycles, 'refused' in t ? null : t.lock, this.programMem, this.cashLedger);
    if (v === 'refused') { this.coinsRefused++; return; }
    if (v !== 'taken') return;
    const taken = this.programCoinOn(line, false);
    if (taken === 'refused') return;
    this.coinsRefused--;
    this.bookTakenCoin(line, taken);
  }

  private bookProgramCoin(line: number, taken: SlotCoin | null): void {
    if (taken === null) {
      noteBoardDefault(this, {
        axis: 'coin',
        text: 'the program\'s coin table was not read - a coin books the board\'s price for its line',
        ifWrong: 'A coin the program values differently, or does not take, books the wrong money.',
      });
      const pence = this.coinLinePence[line];
      if (pence === null || pence === undefined) return;
      if (line === Sc1.TOKEN_LINE) this.cashLedger.tokenInPence += pence;
      else this.cashLedger.inPence += pence;
      return;
    }
    if (typeof taken === 'number') { this.cashLedger.inPence += taken; return; }
    if (taken.token === null) this.cashLedger.unpricedTokenIn++;
    else this.cashLedger.tokenInPence += taken.token;
  }

  private coinTablesCache: { rom: Uint8Array; t: Sc1CoinTables | Refusal } | null = null;
  private coinTables(): Sc1CoinTables | Refusal {
    if (this.coinTablesCache?.rom !== this.rom) this.coinTablesCache = { rom: this.rom, t: locateSc1CoinTables(this.rom) };
    return this.coinTablesCache.t;
  }

  private readonly programMem: Sc1Mem = (a) => (a < RAM_SIZE ? this.ram[a]! : a >= 0x8000 && a < this.rom.length ? this.rom[a]! : 0);

  private readCoinTable(): CoinLineTable | Refusal {
    const t = this.coinTables();
    if ('refused' in t) return t;
    return sc1CoinTable(t, this.rom, this.programMem);
  }

  private programCoinOn(line: number, locks = true): SlotCoin | 'refused' | null {
    const t = this.readCoinTable();
    if ('refused' in t) return null;
    const coins = detectCoins(t);
    if (!(coins instanceof Map)) return null;
    if (locks && this.programLocked() & (1 << line)) return 'refused';
    return coins.get(line) ?? 'refused';
  }

  private programLocked(): number {
    const t = this.coinTables();
    return 'refused' in t ? 0 : sc1LockedLines(t, this.rom, this.programMem);
  }

  get coinRefusing(): number {
    const t = this.readCoinTable();
    if ('refused' in t) return 0;
    let m = 0;
    for (let n = 0; n < SC1_COIN_LINES; n++) if (this.programCoinOn(n) === 'refused') m |= 1 << n;
    return m;
  }

  get coinLineTable(): CoinLineTable | null {
    const t = this.readCoinTable();
    return 'refused' in t ? null : t;
  }

  get coinLineTableRefusal(): string | null {
    const t = this.readCoinTable();
    return 'refused' in t ? t.refused : null;
  }

  coinsRefused = 0;

  private wiring: { coins: Map<number, SlotCoin>; conflicts: number[]; state: StepState } | null = null;

  setCoinWiring(w: CoinWiring): void {
    const { coins, conflicts } = linesOf(w);
    this.wiring = { coins, conflicts, state: 'waiting' };
  }

  get coinWiringStatus(): CoinWiringStatus | undefined {
    const w = this.wiring;
    if (!w) return undefined;
    return { state: w.state, step: w.state === 'calibrated' ? 1 : null, conflicts: [...w.conflicts] };
  }

  private get booksMoney(): boolean {
    return this.wiring?.state !== 'disagrees';
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
      w.state = agrees ? 'calibrated' : 'disagrees';
      if (!agrees) return;
    }
    if (typeof c === 'number') { this.cashLedger.inPence += c; return; }
    if (c.token === null) { this.cashLedger.unpricedTokenIn++; return; }
    this.cashLedger.tokenInPence += c.token;
  }

  private coinSlots: number[] = [];

  setLayoutCoins(list: readonly DeclaredCoin[]): void {
    const slots = new Set<number>();
    for (const c of list) {
      if (c.named?.name.startsWith('ccTalk') || c.named?.name.startsWith('NV')) continue;
      let line: number | null = null;
      if (c.line !== null) line = c.line;
      else if (c.note !== null && c.note >= 0x0f && c.note <= 0x16) {
        if (c.note - 0x0f < SC1_COIN_LINES) line = c.note - 0x0f;
      } else if (c.note === 0x47 && c.button !== null && c.button >= 0 && c.button < 128) {
        const row = (c.button >> 3) & 15;
        if (row === Sc1.DIRECT_ROW) continue;
        if (row === 0 && (c.button & 7) < SC1_COIN_LINES) line = c.button & 7;
      }
      if (line === null) line = c.token ? Sc1.TOKEN_LINE : Sc1.DEFAULT_LINE;
      if (line < 0 || line >= SC1_COIN_LINES) continue;
      if (c.pence === null) slots.add(line);
    }
    this.coinSlots = [...slots].sort((a, b) => a - b);
  }

  private static readonly DEFAULT_LINE = 3;
  private static readonly DIRECT_ROW = DIRECT_COIN_ROW;

  get unnamedCoinLines(): readonly number[] {
    return this.coinSlots;
  }

  private readonly meterInMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly meterOutMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly triacInMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly triacOutMult = [0, 0, 0, 0, 0, 0, 0, 0];

  setMeterMoneyMap(map: {
    meterIn: readonly number[]; meterOut: readonly number[];
    triacIn: readonly number[]; triacOut: readonly number[];
  }): void {
    for (let i = 0; i < 8; i++) {
      this.meterInMult[i] = map.meterIn[i] ?? 0;
      this.meterOutMult[i] = map.meterOut[i] ?? 0;
      this.triacInMult[i] = map.triacIn[i] ?? 0;
      this.triacOutMult[i] = map.triacOut[i] ?? 0;
    }
  }

  get meterTotals(): { in: number; out: number } {
    return { in: this.gridTotals.in, out: this.gridTotals.out };
  }
  private readonly gridTotals = { in: 0, out: 0 };

  private pulseCoinSwitch(sw: Sc1CoinSwitch): void {
    this.coinStrobe = sw.strobe;
    this.coinMask = 1 << sw.bit;
    this.coinCycles = Sc1.COIN_DWELL;
    this.inputRegs[sw.strobe] |= this.coinMask;
  }

  get coinBusy(): boolean {
    return this.coinCycles > 0;
  }

  loadRom(chunks: readonly Uint8Array[], decode = true): void {
    const image = mpu4RomImage(chunks);
    noteRomCut(this, image.length, ROM_SIZE);
    let total = 0;
    for (const c of chunks) total += c.length;
    const raw = new Uint8Array(ROM_SIZE).fill(ROM_UNPLACED);
    const start = Math.max(0, ROM_SIZE - total);
    raw.set(image.subarray(start, ROM_SIZE), start);
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

  loadSoundRom(data: Uint8Array): void {
    this.upd.loadRom(data);
    this.updFitted = true;
  }

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
    if (this.nvram) this.ram.set(this.nvram);
    else this.ram.fill(0);
    this.inputRegs.set(this.idleInputs);
    this.warmReset();
  }

  private warmReset(): void {
    this.bank = 3;
    this.vfd.reset();
    this.vfdShift = 0;
    this.vfdBits = 0;
    this.vfdSclk = 0;
    this.vfdData = 0;
    resetReelsInPlace(this.reels);
    this.lampHistory.reset();
    this.io.fill(0);
    this.mux1Latch = 0x08;
    this.mux1DataLo = 0;
    this.mux1DataHi = 0;
    this.mux1Input = 0;
    this.mux2Latch = 0x08;
    this.mux2DataLo = 0;
    this.mux2DataHi = 0;
    this.mux2Input = 0;
    this.locked = 0x07;
    this.timerCycles = 0;
    this.irqArmed = false;
    this.firqArmed = false;
    this.irqStatus = 0;
    this.watchdogCycles = 0;
    this.meterLatch = 0;
    this.meterBank.reset();
    this.triacLatch = 0;
    this.triacWord = 0;
    this.ay.reset();
    this.upd.reset();
    this.ackQueue = [];
    this.ackDue = 0;
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
    if (a < 0x4000) {
      this.writeIo(a, v);
      return;
    }
    if (a >= 0x8000) {
      this.watchdogCycles = 0;
      this.irqStatus &= 0xfe;
    }
  }

  private readIo(a: number): number {
    this.noteIo(a, false);
    if (a >= 0x2a00 && a <= 0x2a02) return a === 0x2a00 ? this.mux1Input : 0;
    if (a >= 0x2600 && a < 0x2800) return this.meterLatch;
    if (a === 0x2800) return this.triacLatch;
    if (a === 0x2e00) {
      return this.irqStatus | 0x02;
    }
    if (a === 0x3001) return 0;
    if (a === 0x3404) return this.inputRegs[DIRECT_COIN_ROW];
    if (a === 0x3406) return 0x02 | (this.ackReady() ? 0x01 : 0x00);
    if (a === 0x3407) {
      if (!this.ackReady()) return 0;
      const v = this.ackQueue.shift() ?? 0;
      this.ackDue = Sc1.ACK_DELAY;
      return v;
    }
    if (a >= 0x3408 && a <= 0x340a) return a === 0x3408 ? this.mux2Input : 0;
    if (a === 0x3801) {
      const ready = this.updFitted && this.upd.active() ? 0 : 1;
      return ready | (this.updFitted ? 2 : 0);
    }
    this.strays.hit(a);
    return this.io[a & 0x3fff];
  }

  readonly strays = new StrayCounter();

  private writeIo(a: number, v: number): void {
    this.noteIo(a, true);
    this.io[a & 0x3fff] = v;

    if (a >= 0x2000 && a < 0x2200) {
      if (this.locked & 0x02) {
        if (v === 0x42) this.locked &= ~0x02;
        return;
      }
      this.reels[2]?.update((v >> 4) & 0x0f);
      this.reels[3]?.update(v & 0x0f);
      return;
    }
    if (a >= 0x2200 && a < 0x2400) {
      if (this.locked & 0x01) {
        if (v === 0x46) this.locked &= ~0x01;
        return;
      }
      this.reels[0]?.update((v >> 4) & 0x0f);
      this.reels[1]?.update(v & 0x0f);
      return;
    }
    if (a >= 0x2400 && a < 0x2600) {
      if (!(v & 0x20)) {
        this.vfd.reset();
        this.vfdShift = 0;
        this.vfdBits = 0;
      }
      this.vfdData = v & 0x40;
      const sclk = v & 0x80;
      if (!this.vfdSclk && sclk) {
        this.vfdShift = ((this.vfdShift << 1) | (this.vfdData ? 0 : 1)) & 0xff;
        if (++this.vfdBits >= 8) {
          this.vfd.writeChar(this.vfdShift);
          this.vfdBits = 0;
          this.vfdShift = 0;
        }
      }
      this.vfdSclk = sclk;
      return;
    }
    if (a >= 0x2600 && a < 0x2800) {
      if (this.locked & 0x04) {
        this.locked &= ~0x04;
        return;
      }
      const changed = this.meterLatch ^ v;
      this.meterLatch = v;
      this.meterBank.write(v & 0xff);
      if (changed) {
        this.cpu.setFIRQ(true);
        this.firqArmed = true;
      }
      return;
    }
    if (a === 0x2800) {
      this.triacLatch = v;
      this.driveSlides();
      return;
    }
    if (a === 0x2a00) {
      const changed = this.mux1Latch ^ v;
      this.mux1Latch = v;
      if ((changed & 0x08) && !(v & 0x08)) {
        const strobe = v & 0x07;
        const base = strobe * 16;
        this.lampHistory.writeByte(base, this.mux1DataLo);
        this.lampHistory.writeByte(128 + base, this.mux1DataHi);
        this.mux1Input = this.inputRegs[strobe] | (strobe === 5 ? this.percentKey : 0);
      }
      return;
    }
    if (a === 0x2a01) {
      this.mux1DataLo = v;
      return;
    }
    if (a === 0x2a02) {
      this.mux1DataHi = v;
      return;
    }
    if (a === 0x3001) {
      this.ay.write(v);
      if (this.triacLatch) this.driveSlides();
      return;
    }
    if (a >= 0x3101 && a <= 0x3201) {
      this.ay.selectAddress(v);
      return;
    }
    if (a === 0x3406) return;
    if (a === 0x3407) {
      if (this.dataportFitted) {
        const reply = this.dataPak.receive(v, this.cpu.cycles);
        if (reply) {
          if (!this.ackQueue.length) this.ackDue = Sc1.ACK_DELAY;
          for (const b of reply) if (this.ackQueue.length < 16) this.ackQueue.push(b);
        }
      }
      return;
    }
    if (a === 0x3408) {
      const changed = this.mux2Latch ^ v;
      this.mux2Latch = v;
      if ((changed & 0x08) && !(v & 0x08)) {
        const strobe = v & 0x07;
        const base = strobe * 16 + 8;
        this.lampHistory.writeByte(base, this.mux2DataLo);
        this.lampHistory.writeByte(128 + base, this.mux2DataHi);
        let optics = 0;
        for (let i = 0; i < this.reels.length; i++) if (this.reels[i].optic()) optics |= 1 << i;
        optics &= this.reelFit.mask;
        this.mux2Input = 0x3f ^ optics;
      }
      return;
    }
    if (a === 0x3409) {
      this.mux2DataLo = v;
      return;
    }
    if (a === 0x340a) {
      this.mux2DataHi = v;
      return;
    }
    if (a === 0x3600) {
      this.bank = v & 3;
      return;
    }
    if (a === 0x3800) {
      this.reels[4]?.update((v >> 4) & 0x0f);
      this.reels[5]?.update(v & 0x0f);
      return;
    }
    if (a >= 0x3900 && a < 0x3a00) {
      this.reels[4]?.update((v >> 4) & 0x0f);
      this.reels[5]?.update(v & 0x0f);
      return;
    }
    if (a > 0x3800 && a < 0x3900 && this.updFitted) {
      this.upd.portW(v & 0x3f);
      this.upd.setStartLine(false);
      this.upd.setStartLine(true);
      return;
    }
    if (a >= 0x3800 && a < 0x3900) return;
    this.strays.hit(a);
  }

  step(): number {
    const dropIrq = this.irqArmed;
    const dropFirq = this.firqArmed;

    const cycles = this.cpu.step();

    const confirmed = this.meterBank.advance(1, METER_TICK_INSTRUCTIONS);
    if (confirmed) {
      for (let b = 0; b < 8; b++) {
        if (!(confirmed & (1 << b))) continue;
        this.meterCounts[b]++;
        this.gridTotals.in += this.meterInMult[b]!;
        this.gridTotals.out += this.meterOutMult[b]!;
      }
    }

    if (this.ackDue > 0) this.ackDue -= cycles;

    if (dropIrq) {
      this.cpu.setIRQ(false);
      this.irqArmed = false;
    }
    if (dropFirq) {
      this.cpu.setFIRQ(false);
      this.firqArmed = false;
    }

    this.timerCycles += cycles;
    const period = Math.floor(CPU_CLOCK / TIMER_HZ);
    if (this.timerCycles >= period) {
      this.timerCycles -= period;
      this.irqStatus = 0x03;
      this.cpu.setIRQ(true);
      this.irqArmed = true;
    }

    this.watchdogCycles += cycles;
    if (this.watchdogCycles >= Sc1.WATCHDOG_CYCLES) {
      this.watchdogCycles = 0;
      this.watchdogResets++;
      this.warmReset();
      return cycles;
    }

    this.ay.tick(cycles, CPU_CLOCK);
    this.upd.tick(cycles, CPU_CLOCK);

    if (this.coinCycles > 0) {
      this.coinCycles -= cycles;
      if (this.coinCycles <= 0) {
        this.inputRegs[this.coinStrobe] &= ~this.coinMask & 0xff;
        this.coinCycles = 0;
        const next = this.coinNext.shift();
        if (next) this.pulseCoinSwitch(next);
      }
    }
    if (this.judge.line >= 0) this.judgeCoinLeaving(cycles);

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
