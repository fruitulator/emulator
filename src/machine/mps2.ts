import { newCashLedger, ledgerOutMults, dilSwitchLabel, type CabinetSwitch, type CashLedger, type Machine, type MachineDisplay } from './machine';
import { Reel } from '../hw/reel';
import { I8255 } from '../hw/i8255';
import { Tms9995, type Tms9995Bus } from '../cpu/tms9995';
import { Tms9902 } from '../hw/tms9902';
import { Sn76489 } from '../hw/sn76489';
import { Mixer } from '../hw/mixer';
import { OneBitSpeaker } from '../hw/speaker';
import { BASE_BOARD_BASS_FREQ } from '../hw/blipleak';
import { JpmReels } from '../hw/jpmreels';
import { MeterConfirm } from '../hw/meterconfirm';
import { Hopper, v20Waveform } from '../hw/hopper';
import { DataPak } from '../hw/datapak';
import type { ReelGeometry } from './layoutreels';
import { layoutPanelRows, type LayoutSwitch } from './layoutswitches';
import { StatedLines } from './statedlines';
import type { BoardPart } from './parts';
import { fitReelBank, type ReelFit } from './reelfit';
import { noteRomCut } from './boarddefaults';
import { StrayCounter } from './strayaccess';
import type { DigitKind, CoinWiringStatus } from './machine';
import { calibratorState, changeOf, linesOf, MeterStepCalibrator, wiringKey, wiringStateFor, type CalibratorState, type CoinLineTable, type CoinWiring, type SlotCoin, type WatchedCoin } from './coinwiring';
import { readMps2CoinTable } from './mps2coins';

const RAM_LO = 0xe800;
const RAM_HI = 0xf0fc;
const CLOCK = 1_500_000;

const LAMP_PERSISTENCE = 12;

const LAMP_AGE_INSTRUCTIONS = 500;

const SEG_PERSISTENCE = 30;

const BCD7 = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

const ALARM_PULSE = 0x5dc;
const WATCHDOG_CYCLES = 1_000_000;
const COIN_HOLD = Math.round(0.15 * CLOCK);
const COIN_GAP = Math.round(0.15 * CLOCK);

const TUBE_FULL_MASK = 0b0000_0111;

const METER_UNIT_PENCE = 10;

const METER_TICK_CYCLES = 4000;

const TOKEN_IN_LINE = 3;
const TOKEN_OUT_LINE = 7;

const REEL_STAND_IN_HALF_STEPS = 96;
const REEL_STAND_IN_STOPS = 12;

export class Mps2 implements Machine {
  static readonly snapshotConfig: readonly string[] = ['fitted', 'wiring', 'coinSlots'];

  readonly digitKind: DigitKind = 'impact';
  readonly clockHz = CLOCK;
  readonly reelsByLayoutNumber = true;

  readonly lampsDriven = 256;

  private readonly cpu: Tms9995;
  private readonly duart1 = new Tms9902();
  private readonly duart2 = new Tms9902();
  readonly dataPak = new DataPak(CLOCK);
  private protocol = 0;
  private readonly sn = new Sn76489(CLOCK / 1);
  private readonly jpmReels = new JpmReels(6);
  private readonly rom = new Uint8Array(0xc000);
  private readonly ram = new Uint8Array(0x10000);

  readonly lamps = new Uint8Array(256);
  readonly digits = new Uint16Array(16);
  private lampData = 0;
  private lampAge = 0;
  private readonly digitTime = new Uint8Array(16);
  readonly meterCounts = new Uint32Array(8);
  private now = 0;
  private readonly meterBank = new MeterConfirm();
  private meterLevel = 0;
  get meterLevels(): number { return this.meterLevel & 0xff; }
  private meterLevel0 = 0;

  private readonly ledger = newCashLedger();
  private meterInPence: number[] = [];
  private meterOutPence: number[] = [];
  get cashLedger(): CashLedger | undefined {
    return this.meterInPence.length ? this.ledger : undefined;
  }

  setMeterMoney(inMult: readonly number[], outMult: readonly number[]): void {
    this.meterInMult = [...inMult];
    this.meterOutMultRaw = [...outMult];
    this.meterOutMult = [...ledgerOutMults({ in: inMult, out: outMult })[0]];
    this.meterInPence = this.meterInMult.map((x) => x * METER_UNIT_PENCE);
    this.meterOutPence = this.meterOutMult.map((x) => x * METER_UNIT_PENCE);
  }
  private meterInMult: number[] = [];
  private meterOutMult: number[] = [];
  private meterOutMultRaw: number[] = [];
  readonly meterTotals = { in: 0, out: 0 };

  private bookMeterLine(line: number): void {
    if (this.wiring) { this.bookWiredLine(line); return; }
    const inP = this.meterInPence[line] ?? 0;
    const outP = this.meterOutPence[line] ?? 0;
    if (line === TOKEN_IN_LINE) this.ledger.tokenInPence += inP;
    else this.ledger.inPence += inP;
    if (line === TOKEN_OUT_LINE) this.ledger.tokenOutPence += outP;
    else this.ledger.outPence += outP;
  }

  private wiring: {
    coins: Map<number, SlotCoin>;
    conflicts: number[];
    cal: MeterStepCalibrator;
    unpricedTokens: boolean;
    change: Map<number, number>;
  } | null = null;

  private wiringState: { key: string; cal: CalibratorState; held: { inC: Float64Array; outC: Float64Array }; windowLines: number[] } = Mps2.freshWiringState('');

  private static freshWiringState(key: string): { key: string; cal: CalibratorState; held: { inC: Float64Array; outC: Float64Array }; windowLines: number[] } {
    return { key, cal: calibratorState(), held: { inC: new Float64Array(9), outC: new Float64Array(9) }, windowLines: [] };
  }

  private static readonly WIRING_QUIET = Math.round(1.5 * CLOCK);
  private static readonly WIRING_FIRST_WAIT = Math.round(3 * CLOCK);

  setCoinWiring(w: CoinWiring): void {
    const { coins, conflicts } = linesOf(w);
    const pence = new Map<number, number>();
    for (const [line, c] of coins) { const v = typeof c === 'number' ? c : c.token; if (v !== null) pence.set(line, v); }
    this.wiringState = wiringStateFor(this.wiringState, this.wiring !== null, wiringKey(w), Mps2.freshWiringState);
    this.wiring = {
      coins,
      conflicts,
      cal: new MeterStepCalibrator(Mps2.WIRING_QUIET, Mps2.WIRING_FIRST_WAIT, this.wiringState.cal),
      unpricedTokens: [...coins.values()].some((c) => typeof c === 'object' && c.token === null),
      change: changeOf(this.coinLineTable, pence),
    };
  }

  get coinWiringStatus(): CoinWiringStatus | undefined {
    const w = this.wiring;
    if (!w) return undefined;
    return { state: w.cal.state, step: w.cal.step, conflicts: [...w.conflicts] };
  }

  private wiredValue(line: number): WatchedCoin {
    const c = this.wiring?.coins.get(line);
    if (c === undefined) return undefined;
    const v = typeof c === 'number' ? c : c.token;
    return v === null ? null : v - (this.wiring!.change.get(line) ?? 0);
  }

  private bookWiredLine(line: number): void {
    const w = this.wiring!;
    let inC = this.meterInMult[line] ?? 0;
    const outC = this.meterOutMult[line] ?? 0;
    if (line === TOKEN_IN_LINE && w.unpricedTokens) inC = 0;
    if (inC > 0) w.cal.count(inC, this.now);
    this.wiringState.held.inC[line] += inC;
    this.wiringState.held.outC[line] += outC;
    this.flushWired();
  }

  private flushWired(): void {
    const w = this.wiring!;
    if (w.cal.state !== 'calibrated' || w.cal.step === null) return;
    const step = w.cal.step;
    for (let line = 0; line < 9; line++) {
      const inP = this.wiringState.held.inC[line]! * step;
      const outP = this.wiringState.held.outC[line]! * step;
      this.wiringState.held.inC[line] = 0;
      this.wiringState.held.outC[line] = 0;
      if (line === TOKEN_IN_LINE) this.ledger.tokenInPence += inP;
      else this.ledger.inPence += inP;
      if (line === TOKEN_OUT_LINE) this.ledger.tokenOutPence += outP;
      else this.ledger.outPence += outP;
    }
  }

  private tickWiring(): void {
    const w = this.wiring!;
    const closed = w.cal.tick(this.now);
    if (!closed) return;
    const lines = this.wiringState.windowLines;
    this.wiringState.windowLines = [];
    if (closed.counts > 0) {
      this.ledger.unpricedTokenIn += closed.coins.filter((c) => c === null).length;
      for (const l of lines) {
        const c = w.change.get(l);
        if (c) { this.ledger.inPence += c; this.ledger.outPence += c; }
      }
    }
    this.flushWired();
  }

  private coinSlots: { line: number; token: boolean }[] = [];

  setLayoutCoins(list: readonly { button: number | null; pence: number | null; token: boolean }[]): void {
    const out = new Map<number, boolean>();
    for (const c of list) {
      if (c.button === null || c.button < 19 || c.button > 23 || c.pence !== null) continue;
      out.set(c.button, (out.get(c.button) ?? false) || c.token);
    }
    this.coinSlots = [...out].sort((a, b) => a[0] - b[0]).map(([line, token]) => ({ line, token }));
  }

  get unnamedCoinLines(): readonly number[] {
    return this.coinSlots.map((s) => s.line);
  }

  get coinLineTable(): CoinLineTable | null {
    const t = this.readCoinTable();
    if (!('lines' in t)) return null;
    const tokens = new Set(this.coinSlots.filter((s) => s.token).map((s) => s.line));
    return { ...t, lines: t.lines.map((l) => (tokens.has(l.line) ? { ...l, token: true } : l)) };
  }

  get coinLineTableRefusal(): string | null {
    const t = this.readCoinTable();
    return 'refused' in t ? t.refused : null;
  }

  private readCoinTable(): ReturnType<typeof readMps2CoinTable> {
    return readMps2CoinTable(this.rom, {
      rotaryByte: ((this.rotary << 4) ^ 0xf0) & 0xff,
      dil: (select) => ((select & 2) === 0 ? ~this.dip1 & 0xff : (select & 1) === 0 ? ~this.dip2 & 0xff : 0xff),
    });
  }

  private ppi26a = 0; private ppi26b = 0;
  private ppi22b = 0; private ppi22cPrev = 0;
  private ppi25a = 0; private ppi25b = 0; private ppi25c = 0;
  static readonly HOPPER_WAVEFORM = v20Waveform(1, { beam: 100, gap: 0x96 });
  private readonly hopper = new Hopper(CLOCK, Mps2.HOPPER_WAVEFORM);
  private readonly ppi26 = new I8255({
    outA: (v) => { this.ppi26a = v; this.driveHopper(); },
    outB: (v) => { this.ppi26b = v; this.refreshSeg(); this.driveHopper(); },
    outC: (v) => { this.driveMeters(v); },
  }, { modeSetKeepsLatches: true });
  private readonly ppi21 = new I8255({}, { modeSetKeepsLatches: true });
  private readonly ppi22 = new I8255({
    inB: () => this.dilPort(),
    outB: (v) => { this.ppi22b = v; },
    outC: (v) => {
      this.driveMeterLine0(v);
      if ((this.ppi22cPrev & 4) === 0 && (v & 4) !== 0) this.sn.write(this.ppi22b);
      this.ppi22cPrev = v;
    },
  }, { modeSetKeepsLatches: true });
  private readonly ppi25 = new I8255({
    outA: (v) => { this.ppi25a = v; this.refreshLamps(); },
    outB: (v) => { this.ppi25b = v; this.refreshLamps(); },
    outC: (v) => { this.ppi25c = v; },
  }, { modeSetKeepsLatches: true });

  private driveMeters(v: number): void {
    const ctrl = (this.ppi26 as I8255 | undefined)?.read(3) ?? 0x9b;
    const driven = ((ctrl & 0x08) ? 0 : 0xf0) | ((ctrl & 0x01) ? 0 : 0x0f);
    const level = v & driven;
    this.meterLevel = level;
    this.meterBank.write((level << 1) | (this.meterLevel0 ? 1 : 0));
  }

  private tickMeters(cycles: number): void {
    const confirmed = this.meterBank.advance(cycles, METER_TICK_CYCLES);
    if (confirmed) for (let l = 0; l < 9; l++) if (confirmed & (1 << l)) this.meterConfirmed(l);
    if (this.wiring) this.tickWiring();
  }

  private meterConfirmed(line: number): void {
    if (line >= 1) this.meterCounts[line - 1]++;
    this.meterTotals.in += this.meterInMult[line] ?? 0;
    this.meterTotals.out += this.meterOutMultRaw[line] ?? 0;
    this.bookMeterLine(line);
  }

  private driveMeterLine0(v: number): void {
    const ctrl = (this.ppi22 as I8255 | undefined)?.read(3) ?? 0x9b;
    const level = (ctrl & 0x01) ? 0 : v & 0x08;
    this.meterLevel0 = level;
    this.meterBank.write((this.meterLevel << 1) | (level ? 1 : 0));
  }

  private readonly matrix = new Uint8Array(4);
  #panel: LayoutSwitch[] = [];
  readonly #stated = new StatedLines(4);
  #declaredRow3 = 0;

  get tubeSensesStoodIn(): number[] {
    return [0, 1, 2].filter((b) => (TUBE_FULL_MASK & ~this.#declaredRow3) & (1 << b)).map((b) => 24 + b);
  }

  setLayoutSwitches(list: readonly LayoutSwitch[]): void {
    const wanted = list.filter((s) => s.number >= 0 && s.number < 64);
    if (!wanted.length) return;
    this.#panel = wanted.map((s) => ({ ...s }));
    for (const s of wanted) {
      if (s.number >= 32) continue;
      this.layoutInput(s.number, s.closed);
      this.#stated.stateLine(s.number, s.closed);
      if (s.number >> 3 === 3) this.#declaredRow3 |= 1 << (s.number & 7);
    }
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    if (id < 0 || id >= 32) return;
    this.layoutInput(id, made);
    this.#stated.stateLine(id, made);
    if (!this.#panel.some((s) => s.number === id)) this.#panel.push({ number: id, label, closed: made });
  }

  postRestore(): void {
    this.#stated.reassert(this.matrix);
  }
  private fitted = [false, false, false, false, false, false];
  private coinTimer = 0;
  private coinInput = -1;
  private dip1 = 0;
  private dip2 = 0;
  private nmiEnable = 0;
  private reelEnable = 0;
  private alarmLine = 0;
  private alarmPulse = 0;
  private watchdog = 0;
  private nmiRaised = 0;
  readonly alarm = new OneBitSpeaker(CLOCK, 48_000, {
    bassFreq: BASE_BOARD_BASS_FREQ, steps: [0x3fff, 0], fullScale: 1 / (4 * 0xfff),
  });
  private rotary = 0;
  private hoppersFlag = 0x50;

  private powerFail = 1;
  private watchdogTimeout = 1;
  private invalidAccess = 1;
  private clearDown = 1;

  readonly reels = [0, 1, 2, 3, 4, 5].map(
    () => new Reel({ stepsPerRevolution: REEL_STAND_IN_HALF_STEPS, symbols: REEL_STAND_IN_STOPS }),
  );

  reelFit: ReelFit = { mask: 0x3f, channels: 6, beyond: [] };

  setFittedReels(channels: readonly number[]): ReelFit {
    this.reelFit = fitReelBank(this.reels, channels);
    return this.reelFit;
  }
  readonly display: MachineDisplay | null = null;
  readonly audioSource = new Mixer([this.sn, this.alarm]);

  constructor(roms: readonly Uint8Array[], nvram?: Uint8Array) {
    let off = 0;
    for (const r of roms) { this.rom.set(r.subarray(0, this.rom.length - off), off); off += r.length; }
    noteRomCut(this, off, 0x10000);
    if (nvram) this.ram.set(nvram.subarray(0, 0x800), RAM_LO);

    const bus: Tms9995Bus = {
      read8: (a) => this.busRead(a),
      write8: (a, v) => this.busWrite(a, v),
      cruRead: (b) => this.cruRead(b),
      cruWrite: (b, v) => this.cruWrite(b, v),
    };
    this.cpu = new Tms9995(bus);

    this.duart1.onTx = (byte) => {
      this.duart1.load(byte);
      if (!this.reelEnable) return;
      const reply = this.jpmReels.rxByte(byte);
      if (reply) for (const b of reply) this.duart1.receive(b);
    };
    this.duart2.onTx = (byte) => {
      if (this.protocol === 2) this.duart2.receive(byte);
      else this.dataPak.receive(byte, this.now);
    };
  }

  setReelGeometry(geometry: readonly ReelGeometry[]): void {
    for (const g of geometry) {
      if (g.number < 0 || g.number >= 6) continue;
      this.fitted[g.number] = true;
      this.jpmReels.reels[g.number].present = true;
      this.jpmReels.setGeometry(g.number, g.halfSteps, -3);
      this.reels[g.number] = new Reel({
        stepsPerRevolution: g.halfSteps > 0 ? g.halfSteps : this.jpmReels.reels[g.number].steps,
        symbols: g.stops > 0 ? g.stops : REEL_STAND_IN_STOPS,
      });
      if (g.stops <= 0 && !this.standInStops.includes(g.number)) this.standInStops.push(g.number);
    }
  }

  get reelStandIns(): number[] {
    return [...new Set([...this.jpmReels.standInSteps, ...this.standInStops])].sort((a, b) => a - b);
  }

  private readonly standInStops: number[] = [];

  setDips(d1: number, d2 = 0): void { this.dip1 = d1 & 0xff; this.dip2 = d2 & 0xff; }

  private dilPort(): number {
    if (!this.nmiEnable) return 0xff;
    const c = this.ppi22.drivenC();
    if ((c & 2) === 0) return ~this.dip1 & 0xff;
    if ((c & 1) === 0) return ~this.dip2 & 0xff;
    return 0xff;
  }

  get switchPanel(): CabinetSwitch[] {
    const rows: CabinetSwitch[] = layoutPanelRows(this.#panel, (id) =>
      id < 32 && (this.matrix[id >> 3] & (1 << (id & 7))) !== 0);
    rows.push({
      id: Mps2.DIL_ID_BASE + Mps2.TEST_SWITCH_ROW,
      label: 'Test switch',
      on: (this.dip1 & (1 << Mps2.TEST_SWITCH_ROW)) !== 0,
    });
    for (let i = 0; i < 16; i++) {
      const bank = i < 8 ? this.dip1 : this.dip2;
      rows.push({
        id: Mps2.DIL_ID_BASE + i,
        label: dilSwitchLabel(`DIL ${i < 8 ? 4 : 3} SW.${(i & 7) + 1}`, this.dilLabels?.[i]),
        on: (bank & (1 << (i & 7))) !== 0,
        group: 'DIL switches',
        bootOnly: true,
        option: true,
      });
    }
    return rows;
  }

  private dilLabels: readonly string[] | null = null;
  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  private static readonly DIL_ID_BASE = 64;
  private static readonly TEST_SWITCH_ROW = 7;
  setHoppers(v: number): void { this.hoppersFlag = v & 0xff; }
  setProtocol(p: number): void { this.protocol = p; }
  setRotary(n: number): void { this.rotary = n & 0xf; }
  get rotarySwitch(): number { return this.rotary; }

  setReelPosition(i: number, pos: number): void {
    this.jpmReels.setPosition(i, pos);
    const r = this.reels[i];
    if (r && this.jpmReels.reels[i]?.present) r.position = this.jpmReels.reels[i].pos;
  }

  powerCycle(): void {
    this.reset();
  }

  reset(): void {
    this.ppi26.reset(); this.ppi21.reset(); this.ppi22.reset(); this.ppi25.reset();
    this.duart1.reset(); this.duart2.reset();
    this.dataPak.reset();
    this.sn.reset(); this.jpmReels.reset();
    this.powerFail = this.watchdogTimeout = this.invalidAccess = this.clearDown = 1;
    this.nmiEnable = 0;
    this.reelEnable = 0;
    this.alarmLine = 0;
    this.alarmPulse = 0;
    this.alarm.reset();
    this.watchdog = 0;
    this.nmiRaised = 0;
    for (const g of [0, 1, 2, 3, 4, 5]) this.jpmReels.reels[g].present = this.fitted[g];
    this.coinTimer = 0;
    this.coinInput = -1;
    this.lampData = 0;
    this.lampAge = 0;
    this.hopper.reset();

    this.lamps.fill(0);
    this.digits.fill(0);
    this.digitTime.fill(0);
    this.cpu.reset();
  }

  private busRead(a: number): number {
    a &= 0xffff;
    if (a < 0xc000) return this.rom[a];
    if (a >= RAM_LO && a < RAM_HI) return this.ram[a];
    if ((a & 0xfff0) === 0xc000) return this.readIo(a);
    this.strays.hit(a);
    return 0;
  }

  readonly strays = new StrayCounter();

  private busWrite(a: number, v: number): void {
    a &= 0xffff;
    v &= 0xff;
    if (a >= RAM_LO && a < RAM_HI) { this.ram[a] = v; return; }
    if ((a & 0xfff0) === 0xc000) { this.writeIo(a, v); return; }
    if (a >= 0xc000) this.strays.hit(a);
  }

  private readIo(a: number): number {
    switch (a & 0xc) {
      case 0x0:
        return this.ppi26.read(a & 3);
      case 0x4:
        switch (a & 3) {
          case 0: {
            let m3 = this.matrix[3];
            m3 |= TUBE_FULL_MASK & ~this.#declaredRow3;
            if ((this.hoppersFlag & 0x40) === 0) m3 = (m3 & 0x7f) | (this.hopper.countPin() << 7);
            return ~m3 & 0xff;
          }
          case 1:
            return ~(((this.matrix[2] & 0xf8) >> 3) | ((this.matrix[0] & 0x7) << 5)) & 0xff;
          case 2:
            return ~(((this.matrix[0] & 0xf8) >> 3) | ((this.matrix[1] & 0x7) << 5)) & 0xff;
          default:
            return this.ppi21.read(a & 3);
        }
      case 0x8:
        switch (a & 3) {
          case 0:
            return ~(((this.matrix[1] & 0xf8) >> 3) | ((this.matrix[2] & 0x7) << 5)) & 0xff;
          case 1:
            return this.ppi22.read(1);
          case 2:
            return ((this.rotary << 4) ^ 0xf0) & 0xff;
          default:
            return this.ppi22.read(a & 3);
        }
      default:
        return this.ppi25.read(a & 3);
    }
  }

  private writeIo(a: number, v: number): void {
    switch (a & 0xc) {
      case 0x0: this.ppi26.write(a & 3, v); break;
      case 0x4: this.ppi21.write(a & 3, v); break;
      case 0x8: this.ppi22.write(a & 3, v); break;
      default: this.ppi25.write(a & 3, v); break;
    }
  }

  private refreshLamps(): void {
    const data = (this.ppi25b << 8) | this.ppi25a;
    if (data === this.lampData) return;
    this.lampData = data;
    const base = (this.ppi25c & 0x0f) * 16;
    for (let bit = 0; bit < 16; bit++) {
      if ((data >> bit) & 1) this.lamps[base + bit] = LAMP_PERSISTENCE;
    }
  }

  private driveHopper(): void {
    if (this.hoppersFlag & 0x40) return;
    const a = this.ppi26a, b = this.ppi26b;
    let hd10 = a & 0xf0;
    if ((a & 0x8) === 0) {
      hd10 |= ((b & 0x80) >> 7) + ((b & 0x1) << 4);
      hd10 |= ((a & 0x1) << 3) + ((a & 0x2) << 1);
      hd10 |= (a & 0x4) >> 1;
    }
    this.hopper.motorDrive((hd10 & 4) !== 0);
  }

  private ageLamps(): void {
    for (let i = 0; i < this.lamps.length; i++) {
      const v = this.lamps[i];
      if (v > 0 && v !== 0xff) this.lamps[i] = v - 1;
    }
  }

  private refreshSeg(): void {
    const value = ((this.ppi26b & 0x3c) >> 2) ^ 0x0f;
    const d = value < 10 ? BCD7[value] : 0;
    if (!d) return;
    const position = this.ppi25c & 0x0f;
    this.digitTime[position] = SEG_PERSISTENCE;
    this.digits[position] = d;
  }

  private ageSeg(): void {
    for (let i = 0; i < this.digitTime.length; i++) {
      if (this.digitTime[i] > 0 && --this.digitTime[i] === 0) this.digits[i] = 0;
    }
  }

  private cruRead(bit: number): number {
    const region = bit & 0x60;
    if (region === 0x00) return this.duart2.cruRead(bit & 0x1f);
    if (region === 0x40) return this.duart1.cruRead(bit & 0x1f);
    if (region === 0x20) {
      switch (bit & 0x1f) {
        case 0: return this.powerFail;
        case 1: return this.watchdogTimeout;
        case 2: return this.invalidAccess;
        case 3: return this.clearDown;
        case 6: return this.duart1.int ? 0 : 1;
        case 7: return this.duart2.int ? 0 : 1;
        default: return 0;
      }
    }
    return 1;
  }

  private cruWrite(bit: number, v: number): void {
    const region = bit & 0x60;
    if (region === 0x00) { this.duart2.cruWrite(bit & 0x1f, v); return; }
    if (region === 0x40) { this.duart1.cruWrite(bit & 0x1f, v); return; }
    if (region === 0x20) {
      switch (bit & 7) {
        case 0: this.powerFail = 1; break;
        case 1: this.watchdogTimeout = 1; break;
        case 2: this.invalidAccess = 1; break;
        case 3: this.clearDown = 1; break;
      }
      return;
    }
    if (region !== 0x60) return;
    switch (bit & 7) {
      case 0: if (!v) this.watchdog = WATCHDOG_CYCLES; break;
      case 2: {
        const line = v ? 1 : 0;
        if (line && !this.alarmLine) {
          this.alarm.write(0, 1);
          this.alarmPulse = ALARM_PULSE;
        }
        this.alarmLine = line;
        break;
      }
      case 3: this.nmiEnable = v ? 1 : 0; break;
      case 4: this.reelEnable = v ? 1 : 0; break;
    }
  }

  step(): number {
    const c = this.cpu.step();
    this.now += c;
    this.tickMeters(c);
    if (++this.lampAge >= LAMP_AGE_INSTRUCTIONS) { this.lampAge = 0; this.ageSeg(); this.ageLamps(); }
    this.hopper.tick(c);
    this.duart1.tick(c);
    this.duart2.tick(c);
    this.jpmReels.tick(c);
    this.sn.tick(c, CLOCK);
    this.alarm.tick(c);
    if (this.alarmPulse > 0 && (this.alarmPulse -= c) <= 0) {
      this.alarmPulse = 0;
      this.alarm.write(0, 0);
    }
    if (this.watchdog > 0 && (this.watchdog -= c) <= 0) {
      this.watchdog = 0;
      this.invalidAccess = 0;
      this.clearDown = 0;
    }
    if (!this.nmiEnable || (this.powerFail & this.watchdogTimeout & this.invalidAccess & this.clearDown)) {
      this.nmiRaised = 0;
    } else if (!this.nmiRaised) {
      this.nmiRaised = 1;
      this.cpu.nmi();
    }
    if (this.coinTimer > 0) {
      const was = this.coinTimer;
      this.coinTimer -= c;
      if (was > COIN_GAP && this.coinTimer <= COIN_GAP && this.coinInput >= 0) {
        this.layoutInput(this.coinInput, false);
        this.coinInput = -1;
      }
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
    this.cpu.setInt1(this.duart1.int || this.duart2.int);
    if (this.jpmReels.changed) {
      this.jpmReels.changed = false;
      for (let i = 0; i < this.reels.length; i++) {
        const jr = this.jpmReels.reels[i];
        const r = this.reels[i];
        if (r) {
          r.position = jr.pos;
          r.travel += jr.stepped;
        }
        jr.stepped = 0;
      }
    }
    return c;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    for (let i = 0; i < this.reels.length; i++) {
      if (this.reels[i]) this.reels[i].subStep = this.jpmReels.subStep(i);
    }
    return done;
  }

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: '192 LAMPS', part: '12 columns x 16', device: this.lamps },
      { id: 'switches', label: 'SWITCH MATRIX', part: '4 rows x 8 + 2 DIP', device: this.matrix },
      { id: 'sevenseg', label: '7-SEG BANK', part: '16 digits, BCD', device: this.digits },
      { id: 'meters', label: '8 METERS', part: 'electromechanical - PPI 26 port C', device: this.meterCounts },
      { id: 'coins', label: 'COIN INPUTS', part: 'matrix INPUT 19-23', modelled: true,
        note: 'Modelled as timed matrix pulses (insertCoin), not as a mech.' },

      { id: 'ppi26', label: 'PPI 26', part: 'i8255 $C000 - out, 7-seg', device: this.ppi26 },
      { id: 'ppi21', label: 'PPI 21', part: 'i8255 $C004 - matrix rows', device: this.ppi21 },
      { id: 'ppi22', label: 'PPI 22', part: 'i8255 $C008 - DIL 3/4, snd', device: this.ppi22 },
      { id: 'ppi25', label: 'PPI 25', part: 'i8255 $C00C - lamps, BCD', device: this.ppi25 },

      { id: 'ram', label: 'RAM', part: 'battery + on-chip', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: '48K - 3 x 8K', device: this.rom },
      { id: 'sn', label: 'SOUND', part: 'SN76489 - 1.5 MHz', device: this.sn },

      { id: 'cpu', label: 'CPU', part: 'TMS9995 - 1.5 MHz', device: this.cpu, cpu: true },
      { id: 'uart1', label: 'UART 1', part: 'TMS9902 - CRU $40', device: this.duart1 },
      { id: 'uart2', label: 'UART 2', part: 'TMS9902 - CRU $00', device: this.duart2 },
      { id: 'status', label: 'STATUS CRU', part: '$20 - power fail', modelled: true,
        note: 'Modelled as flag bits read over the CRU, not as a device. A latched flag raises the NMI while NMI enable is up.' },
      { id: 'ls259', label: 'OUTPUT LATCH', part: 'LS259 $60 - Q0, Q2-Q4', modelled: true,
        note: 'Its watchdog, alarm, reel enable and NMI enable are followed; NMI enable also enables the DIL switches.' },

      { id: 'reels', label: '6 REELS', part: 'JPM serial MCU', device: this.jpmReels },
      { id: 'hopper', label: 'HOPPER', part: 'not modelled' },
      { id: 'coinmech', label: 'COIN MECH', part: 'acceptor - not modelled' },
    ];
  }

  layoutLamp(n: number): boolean {
    if (n >= this.lampsDriven) return true;
    return n >= 0 && this.lamps[n] !== 0;
  }

  layoutDigit(n: number): number {
    return this.digits[n & 15];
  }

  layoutInput(id: number, on: boolean): void {
    if (id >= Mps2.DIL_ID_BASE && id < Mps2.DIL_ID_BASE + 16) {
      const i = id - Mps2.DIL_ID_BASE;
      const mask = 1 << (i & 7);
      if (i < 8) this.dip1 = on ? this.dip1 | mask : this.dip1 & ~mask & 0xff;
      else this.dip2 = on ? this.dip2 | mask : this.dip2 & ~mask & 0xff;
      return;
    }
    const row = (id >> 3) & 3;
    const b = id & 7;
    if (on) this.matrix[row] |= 1 << b;
    else this.matrix[row] &= ~(1 << b);
  }

  insertCoin(bit: number): void {
    if (this.coinTimer > 0 || bit < 0 || bit > 31) return;
    if (this.wiring) {
      this.wiring.cal.coin(this.wiredValue(bit), this.now);
      this.wiringState.windowLines.push(bit);
    }
    this.coinInput = bit;
    this.layoutInput(bit, true);
    this.coinTimer = COIN_HOLD + COIN_GAP;
  }

  get coinBusy(): boolean { return this.coinTimer > 0; }
}
