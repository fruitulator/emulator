import { countOutClick, outClicksOf } from './payoutcheck';
import { newCashLedger, ledgerOutMults, dilPlace, dilSwitchLabel, type CabinetSwitch, type CashLedger, type Machine, type MachineDisplay } from './machine';
import { triacSenseRelease } from '../hw/triacsense';
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
import type { SlideEffect } from '../layout/fmlconfig';
import { DataPak } from '../hw/datapak';
import type { ReelGeometry } from './layoutreels';
import { layoutPanelRows, type LayoutSwitch } from './layoutswitches';
import { StatedLines } from './statedlines';
import type { BoardPart } from './parts';
import { fitReelBank, type ReelFit } from './reelfit';
import { noteRomCut } from './boarddefaults';
import { COIN_RAW, coinMatrixSteps } from './coinraw';
import { StrayCounter } from './strayaccess';
import type { DigitKind, CoinWiringStatus } from './machine';
import { calibratorState, changeOf, detectCoins, linesOf, MeterStepCalibrator, PairedMeterCheck, wiringKey, wiringStateFor, type CalibratorState, type CoinLineTable, type CoinWiring, type SlotCoin, type StepState } from './coinwiring';
import { metersInPairs, pairedBank, PendingCounterFinder, readCountedMeters, readCreditMeters, readMps2CoinTable } from './mps2coins';
import { lockoutRefuses, type CoinLockoutWiring } from '../hw/coinlockout';
import { CoinBook, bookedOfSlotCoin, statedCoinOf, type BookedCoin } from './coinbook';

const RAM_LO = 0xe800;
const RAM_HI = 0xf0fc;
const CLOCK = 1_500_000;

const LAMP_FULL = 0xff;
const LAMP_FLICKER = 0x7f;

const LAMP_AGE_INSTRUCTIONS = 500;

const SEG_PERSISTENCE = 30;

const BCD7 = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

const ALARM_PULSE = 0x5dc;
const WATCHDOG_CYCLES = 1_000_000;
const COIN_HOLD = Math.round(0.15 * CLOCK);
const COIN_GAP = Math.round(0.15 * CLOCK);

const COIN_INHIBIT_MASKS: readonly (number | null)[] = [
  ...Array(20).fill(null),
  0x10,
  0x20,
  0x40,
  0x80,
];
const COIN_INHIBITS: CoinLockoutWiring = { openSense: 0, mask: 0xf0, bits: [], masks: COIN_INHIBIT_MASKS };
const INHIBITED_LINES = 0xf << 20;

const TUBE_FULL_MASK = 0b0000_0111;

const METER_UNIT_PENCE = 10;

const METER_STEPS: readonly number[] = [1, 2, 5, 10];

const CASH_IN_LINE = 1;

const METER_TICK_CYCLES = 4000;

const REEL_BONUS_TICKS = 10;
const REEL_BONUS_SLOT = 4;

const TOKEN_OUT_LINE = 7;

const REEL_STAND_IN_HALF_STEPS = 96;
const REEL_STAND_IN_STOPS = 12;

const SET_REELS_COUNT = 6;
const SET_REELS_ADJUST = 3;

function v20UnfittedReelpos(pos: number, bankSteps: number): number {
  return ((bankSteps - pos) % bankSteps + bankSteps) % bankSteps;
}

export class Mps2 implements Machine {
  triacSenseLine = -1;
  triacSenseMask = 0xff;
  static readonly snapshotConfig: readonly string[] = ['triacSenseLine', 'triacSenseMask', 'triacInMult', 'triacOutMultRaw', 'triacHasMoney', 'fitted', 'windowOnly', 'wiring', 'coinSlots', 'slotStated', 'creditTubesRead', 'payoutSlides', 'pendingFinder'];

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
  private readonly jpmReels = new JpmReels(8);
  private readonly rom = new Uint8Array(0xc000);
  private readonly ram = new Uint8Array(0x10000);

  readonly lamps = new Uint8Array(256);
  readonly digits = new Uint16Array(16);
  private lampCol = 0;
  private lampPending = false;
  private lampSeenA = false;
  private lampSeenB = false;
  private lampFlicker = 0;
  private readonly lampHist = new Uint8Array(64);
  private lampAge = 0;
  private readonly digitTime = new Uint8Array(16);
  readonly meterCounts = new Uint32Array(8);
  private now = 0;
  private readonly meterBank = new MeterConfirm();
  private meterLevel = 0;
  get meterLevels(): number { return this.meterLevel & 0xff; }
  private meterLevel0 = 0;

  private readonly ledger = newCashLedger();
  private readonly coinBook = new CoinBook(this.ledger, Math.round(1.5 * CLOCK));
  get unpricedPaidLines(): readonly number[] { return this.coinBook.unpricedPaidLines; }
  private readonly dropLine = new Array<number>(4).fill(-1);
  private readonly dropWait = new Array<number>(4).fill(0);
  private dropping = false;
  coinsRefused = 0;
  private meterInPence: number[] = [];
  get cashLedger(): CashLedger | undefined {
    return this.ledger;
  }

  setMeterMoney(inMult: readonly number[], outMult: readonly number[], triacIn: readonly number[] = [], triacOut: readonly number[] = []): void {
    this.meterInMult = [...inMult];
    this.meterInMultRaw = [...inMult];
    this.meterOutMultRaw = [...outMult];
    const [meterOut] = ledgerOutMults({ in: inMult, out: outMult }, { in: triacIn, out: triacOut });
    this.meterOutMult = [...meterOut!];
    this.triacInMult = [...triacIn];
    this.triacOutMultRaw = [...triacOut];
    this.triacHasMoney = triacIn.some((x) => x) || triacOut.some((x) => x);
    const t = this.readCoinTable();
    if ('lines' in t) for (const bit of t.coinMeterBits ?? []) this.meterOutMult[bit + 1] = 0;
    const counted = readCountedMeters(this.rom);
    if (counted) {
      const { coinBit, payBit } = counted;
      if ((inMult[coinBit] ?? 0) > 0 && (this.meterOutMult[payBit] ?? 0) > 0 && !inMult[coinBit + 1] && !outMult[payBit + 1]) {
        this.meterInMult = [0, ...this.meterInMult.slice(0, -1)];
        this.meterOutMult = [0, ...this.meterOutMult.slice(0, -1)];
      }
    }
    const credit = readCreditMeters(this.rom);
    if (credit && this.meterOutMult.some((x) => x)) {
      this.meterOutMult = this.meterOutMult.map(() => 0);
      this.meterOutMult[credit.payBit + 1] = 1;
      this.meterInMult = this.meterInMult.map((x) => (x > 0 ? 1 : 0));
    }
    this.meterInPence = this.meterInMult.map((x) => x * METER_UNIT_PENCE);
    this.priceTokenTubes();
    this.pairedUnitRead = -1;
    this.creditTubesRead = -1;
  }
  readonly meterNameOffset = 1;
  private meterInMult: number[] = [];
  private meterOutMult: number[] = [];
  private triacInMult: number[] = [];
  private triacOutMultRaw: number[] = [];
  private triacHasMoney = false;
  private meterInMultRaw: number[] = [];
  private meterOutMultRaw: number[] = [];
  readonly meterTotals = { in: 0, out: 0 };

  private bookMeterLine(line: number): void {
    if ((this.meterInPence[line] ?? 0) > 0) {
      this.findPending(line);
      if ((this.pendingAt[line] ?? -1) < 0) this.meterTakesCoin();
    } else if (this.dropping && !this.meterChecksCoins) this.meterTakesCoin();
    if (this.unitState.cal.win.open) {
      const inC = this.meterInMult[line] ?? 0;
      if (inC > 0) this.unitCal().count(inC, this.now);
    }
    this.countMeterOut(this.meterOutMultRaw[line] ?? 0);
  }

  private countMeterOut(raw: number): void {
    if (raw > 0 && this.payoutDevices.length === 0) this.coinBook.pay('unpriced');
  }

  private payoutSlides: readonly SlideEffect[] = [null, null, null, null, null];
  setPayoutSlides(slides: readonly SlideEffect[] | null): void {
    this.payoutSlides = Array.from({ length: 5 }, (_, i) => slides?.[i] ?? null);
    this.coinBook.setSlides(this.payoutSlides);
    this.priceTokenTubes();
  }

  private get tokenOutMeterPence(): number | null {
    const m = this.meterOutMult[TOKEN_OUT_LINE] ?? 0;
    return m > 0 ? m * METER_UNIT_PENCE : null;
  }
  private priceTokenTubes(): void {
    const p = this.tokenOutMeterPence;
    this.payoutSlides.forEach((e, line) => this.coinBook.payouts.setDefault(line, e === 'token' ? p : null));
  }
  private static readonly HOPPER_LINE = 8;
  private isPayoutLine(i: number): boolean {
    return this.payoutSlides[i] !== null || (i >= 1 && i <= 3 && ((this.creditTubes() >> (i - 1)) & 1) === 1);
  }
  private get hopperFitted(): boolean { return (this.hoppersFlag & 0x40) === 0; }
  readonly outClicks: number[] = [];
  get outMeterClicks(): Readonly<Record<number, number>> { return outClicksOf(this.outClicks, this.meterOutMultRaw); }
  get rowCoins(): Readonly<Record<number, number>> { return this.coinBook.rowCoins(this.payoutDevices); }
  get unnamedPulses(): Readonly<Record<number, number>> { return this.coinBook.unnamedPulses(this.payoutDevices); }

  get payoutDevices(): readonly { line: number; kind: 'tube' | 'token-tube' | 'hopper'; displayNumber: number; defaultPence: number | null }[] {
    const rows: { line: number; kind: 'tube' | 'token-tube' | 'hopper'; displayNumber: number; defaultPence: number | null }[] = [];
    for (let line = 0; line < 5; line++) {
      if (!this.isPayoutLine(line)) continue;
      const e = this.payoutSlides[line];
      rows.push({ line, kind: e === 'token' ? 'token-tube' : 'tube', displayNumber: line + 1, defaultPence: typeof e === 'number' ? e : e === 'token' ? this.tokenOutMeterPence : null });
    }
    if (this.hopperFitted) rows.push({ line: Mps2.HOPPER_LINE, kind: 'hopper', displayNumber: 1, defaultPence: null });
    return rows;
  }
  get unpricedPayoutLines(): readonly number[] {
    return this.payoutDevices.filter((d) => d.defaultPence === null && !(d.line < 5 && this.payoutSlides[d.line] === 'token')).map((d) => d.line);
  }
  get tokenPayoutLines(): readonly number[] {
    return this.payoutSlides.flatMap((e, i) => (e === 'token' ? [i] : []));
  }
  get meterOnlyPayout(): boolean {
    return this.payoutDevices.length === 0 && this.meterOutMultRaw.some((x) => x > 0);
  }
  namePayout(line: number, pence: number): void { this.coinBook.payouts.name(line, pence); }

  private bookPayoutLine(i: number): void {
    if (this.isPayoutLine(i)) this.coinBook.tube(i);
    else this.coinBook.unnamed(i);
  }

  private readonly hopperBooked = { paid: 0 };
  private bookHoppers(): void {
    if (!this.hopperFitted) return;
    const fresh = this.hopper.paid - this.hopperBooked.paid;
    this.hopperBooked.paid = this.hopper.paid;
    if (fresh <= 0) return;
    for (let k = 0; k < fresh; k++) this.coinBook.tube(Mps2.HOPPER_LINE);
  }

  private readonly unitState: { cal: CalibratorState } = { cal: calibratorState() };

  private unitCal(): MeterStepCalibrator {
    return this.meterLaw(this.unitState.cal);
  }

  private meterLaw(s: CalibratorState): MeterStepCalibrator {
    const unit = this.pairedUnit();
    return unit === null
      ? new MeterStepCalibrator(Mps2.WIRING_QUIET, Mps2.WIRING_FIRST_WAIT, s)
      : new PairedMeterCheck(unit, Mps2.WIRING_QUIET, Mps2.WIRING_FIRST_WAIT, s);
  }

  private pairedUnitRead = -1;

  private pairedUnit(): number | null {
    if (this.pairedUnitRead === -1) this.pairedUnitRead = this.readPairedUnit() ?? 0;
    return this.pairedUnitRead || null;
  }

  private readPairedUnit(): number | null {
    if (!metersInPairs(this.rom)) return null;
    const t = this.coinLineTable;
    const coins = t ? detectCoins(t) : null;
    const x = this.meterInMult[CASH_IN_LINE] ?? 0;
    if (!t || !(coins instanceof Map) || x <= 0) return null;
    for (const l of t.lines) {
      const c = coins.get(l.line);
      if (typeof c !== 'number' || l.credits <= 0 || l.change.length) continue;
      const unit = c / l.credits / x;
      return METER_STEPS.includes(unit) ? unit : null;
    }
    return null;
  }

  private creditTubes(): number {
    if (this.creditTubesRead === -1) {
      const counted = this.meterOutMult.some((x) => x) ? readCountedMeters(this.rom)?.tubeBits ?? 0 : 0;
      const tubes = counted || (this.meterOutMult.some((x) => x) ? readCreditMeters(this.rom)?.tubeBits ?? 0 : 0);
      this.creditTubesRead = tubes && !this.coinsPriceable() ? tubes : 0;
    }
    return this.creditTubesRead;
  }
  private creditTubesRead = -1;

  private coinsPriceable(): boolean {
    if (!this.meterChecksCoins) return false;
    const t = this.coinLineTable;
    const priced = t ? detectCoins(t) : null;
    if (priced instanceof Map) for (const c of priced.values()) if (typeof c === 'number' || c.token !== null) return true;
    for (const c of this.slotStated.values()) if (typeof c === 'number' || (c !== null && typeof c === 'object')) return true;
    return false;
  }

  private unitSample(line: number): number | null {
    const coin = this.dropCoin(line);
    const v = typeof coin === 'number' ? coin : coin !== null && typeof coin === 'object' ? coin.token : null;
    return v === null ? null : v - this.changeOn(line, v);
  }

  private tickUnit(): void {
    const closed = this.unitCal().tick(this.now);
    if (!closed) return;
    const s = this.unitState.cal;
    if (s.state === 'calibrated' && !METER_STEPS.includes(s.step!)) { s.state = 'disagrees'; s.step = null; }
  }

  private dropCoin(line: number): BookedCoin {
    const wired = this.wiredCoin(line);
    if (wired !== undefined) return wired;
    const t = this.coinLineTable;
    const priced = t ? detectCoins(t) : null;
    const c = priced instanceof Map ? priced.get(line) : undefined;
    if (c !== undefined) return bookedOfSlotCoin(c);
    return this.slotStated.get(line) ?? null;
  }

  private bookCoinTaken(line: number): void {
    const coin = this.dropCoin(line);
    if (this.wiredCoin(line)) this.wiringState.state = 'calibrated';
    this.coinBook.coin(coin);
  }

  private changeOn(line: number, coin: number): number {
    const pence = new Map<number, number>([[line, coin]]);
    const t = this.coinLineTable;
    const priced = t ? detectCoins(t) : null;
    if (priced instanceof Map) for (const [l, c] of priced) if (typeof c === 'number') pence.set(l, c);
    return changeOf(t, pence).get(line) ?? 0;
  }

  private get meterChecksCoins(): boolean {
    return this.meterInPence.some((p) => p > 0);
  }

  private meterTakesCoin(): void {
    let k = -1;
    for (let i = 0; i < this.dropLine.length; i++) {
      if (this.dropLine[i]! < 0) continue;
      if (k < 0 || this.dropWait[i]! < this.dropWait[k]!) k = i;
    }
    if (k < 0) return;
    this.bookCoinTaken(this.dropLine[k]!);
    this.dropLine[k] = -1;
    this.dropWait[k] = 0;
  }

  private bankTakesCoin(): void {
    if (this.pairedBankAt === -2) this.pairedBankAt = pairedBank(this.rom) ?? -1;
    if (this.pairedBankAt < 0) return;
    const odd = this.ram[this.pairedBankAt + 1]! & 1;
    if (odd && !this.bankOddSeen) this.meterTakesCoin();
    this.bankOddSeen = odd;
  }
  private pairedBankAt = -2;
  private bankOddSeen = 0;

  private readonly pendingAt = new Array<number>(9).fill(-1);
  private readonly pendingSeen = new Array<number>(9).fill(0);
  private readonly pendingPulseAt = new Array<number>(9).fill(0);
  private readonly pendingFinder = new PendingCounterFinder();
  private inPairsRead = -1;

  private findPending(line: number): void {
    if (line >= this.pendingAt.length) return;
    this.pendingPulseAt[line] = this.now;
    if (this.pendingAt[line]! >= 0) return;
    if (this.inPairsRead === -1) this.inPairsRead = metersInPairs(this.rom) ? 1 : 0;
    if (this.inPairsRead) return;
    const at = this.pendingFinder.pulse(line, this.ram, RAM_LO, RAM_HI, this.now);
    if (at === null) return;
    this.pendingAt[line] = at;
    this.pendingSeen[line] = this.ram[at]!;
    if (this.pendingFinder.rose) this.meterTakesCoin();
  }

  private pendingStillCounts(): void {
    for (let l = 0; l < this.pendingAt.length; l++) {
      const at = this.pendingAt[l]!;
      if (at >= 0 && this.now - this.pendingPulseAt[l]! > Mps2.WIRING_QUIET && this.ram[at]) this.pendingAt[l] = -1;
    }
  }

  private pendingTakesCoin(): void {
    for (let l = 0; l < this.pendingAt.length; l++) {
      const at = this.pendingAt[l]!;
      if (at < 0) continue;
      const v = this.ram[at]!;
      const up = (v - this.pendingSeen[l]!) & 0xff;
      this.pendingSeen[l] = v;
      if (up > 0 && up < 0x80) this.meterTakesCoin();
    }
  }

  private tickDrops(cycles: number): void {
    this.bankTakesCoin();
    this.pendingTakesCoin();
    let any = false;
    for (let i = 0; i < this.dropLine.length; i++) {
      if (this.dropLine[i]! < 0) continue;
      this.dropWait[i] = this.dropWait[i]! - cycles;
      if (this.dropWait[i]! <= 0) { this.coinsRefused++; this.dropLine[i] = -1; this.dropWait[i] = 0; continue; }
      any = true;
    }
    this.dropping = any;
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

  private wiredCoin(line: number): BookedCoin | undefined {
    const w = this.wiring;
    if (!w) return undefined;
    if (w.conflicts.includes(line)) return null;
    const c = w.coins.get(line);
    return c === undefined ? undefined : bookedOfSlotCoin(c);
  }

  private static readonly WIRING_QUIET = Math.round(1.5 * CLOCK);
  private static readonly WIRING_FIRST_WAIT = Math.round(3 * CLOCK);

  private coinSlots: { line: number; token: boolean }[] = [];

  setLayoutCoins(list: readonly { button: number | null; pence: number | null; token: boolean; note?: number | null }[]): void {
    this.tokenMech = list.some((c) => c.note === Mps2.TOK_MPS2) ? Mps2.TOKEN_MECH : null;
    const out = new Map<number, boolean>();
    for (const c of list) {
      if (c.button === null || c.button < 19 || c.button > 23 || c.pence !== null) continue;
      out.set(c.button, (out.get(c.button) ?? false) || c.token);
    }
    this.coinSlots = [...out].sort((a, b) => a[0] - b[0]).map(([line, token]) => ({ line, token }));
    const stated = new Map<number, BookedCoin>();
    for (const c of list) {
      if (c.button === null || c.button < 19 || c.button > 23) continue;
      const coin = statedCoinOf(c);
      const had = stated.get(c.button);
      stated.set(c.button, had === undefined || JSON.stringify(had) === JSON.stringify(coin) ? coin : null);
    }
    this.slotStated = stated;
    this.pairedUnitRead = -1;
    this.creditTubesRead = -1;
  }
  private slotStated = new Map<number, BookedCoin>();

  get unnamedCoinLines(): readonly number[] {
    const host = this.unpricedCoinLines;
    const drawn = this.coinSlots.map((s) => s.line);
    return host ? [...new Set([...drawn, ...host.map((c) => c.line)])].sort((a, b) => a - b) : drawn;
  }

  get unpricedCoinLines(): readonly { line: number; credits: number | null }[] | undefined {
    if (!this.creditTubes()) return undefined;
    return [19, 20, 21, 22, 23].map((line) => ({ line, credits: null }));
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
  private coinLockSeen = false;
  private tokenLockSeen = false;
  private tokenLockOutputWritten = false;
  private ppi22b = 0; private ppi22cPrev = 0;
  private ppi25a = 0; private ppi25b = 0; private ppi25c = 0;
  static readonly HOPPER_WAVEFORM = v20Waveform(1, { beam: 100, gap: 0x96, restart: 'rearm' });
  private readonly hopper = new Hopper(CLOCK, Mps2.HOPPER_WAVEFORM);
  private readonly ppi26 = new I8255({
    outA: (v) => {
      this.ppi26a = v;
      if ((v & 0xf0) !== 0xf0) this.coinLockSeen = true;
      this.driveHopper(); this.driveReelBonus(v); this.driveTriacSense();
    },
    outB: (v) => {
      this.ppi26b = v;
      if (this.tokenLockOutputWritten && (v & 0x80) !== 0) this.tokenLockSeen = true;
      this.refreshSeg(); this.driveHopper(); this.driveTriacSense();
    },
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
    outA: (v) => { this.ppi25a = v; },
    outB: (v) => { this.ppi25b = v; },
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
    if (this.dropping) this.tickDrops(cycles);
    if (this.unitState.cal.win.open) this.tickUnit();
    this.coinBook.elapse(cycles);
  }

  private meterConfirmed(line: number): void {
    if (line >= 1) {
      this.meterCounts[line - 1]++;
    }
    this.meterTotals.in += this.meterInMultRaw[line] ?? 0;
    this.meterTotals.out += this.meterOutMultRaw[line] ?? 0;
    countOutClick(this.outClicks, line, this.meterOutMultRaw[line]);
    this.bookMeterLine(line);
  }

  private driveMeterLine0(v: number): void {
    const ctrl = (this.ppi22 as I8255 | undefined)?.read(3) ?? 0x9b;
    const level = (ctrl & 0x01) ? 0 : v & 0x08;
    this.meterLevel0 = level;
    this.meterBank.write((this.meterLevel << 1) | (level ? 1 : 0));
  }

  private readonly matrix = new Uint8Array(16);
  #panel: LayoutSwitch[] = [];
  readonly #stated = new StatedLines(16);
  #declaredRow3 = 0;

  get tubeSensesStoodIn(): number[] {
    return [0, 1, 2].filter((b) => (TUBE_FULL_MASK & ~this.#declaredRow3) & (1 << b)).map((b) => 24 + b);
  }

  setLayoutSwitches(list: readonly LayoutSwitch[]): void {
    const wanted = list.filter((s) => s.number >= 0 && s.number < 128 &&
      !(s.number >= Mps2.DIL_ID_BASE && s.number < Mps2.DIL_ID_BASE + 16));
    if (!wanted.length) return;
    this.#panel = wanted.map((s) => ({ ...s }));
    for (const s of wanted) {
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
  private reelBonus = false;
  private reelBonusMotor = 0;
  private reelBonusCycles = 0;
  private reelBonusTicks = 0;
  private hoppersFlag = 0x50;

  private powerFail = 1;
  private watchdogTimeout = 1;
  private invalidAccess = 1;
  private clearDown = 1;

  readonly reels = [0, 1, 2, 3, 4, 5, 6, 7].map(
    () => new Reel({ stepsPerRevolution: REEL_STAND_IN_HALF_STEPS, symbols: REEL_STAND_IN_STOPS }),
  );

  reelFit: ReelFit = { mask: 0x3f, channels: 6, beyond: [] };

  setFittedReels(channels: readonly number[]): ReelFit {
    if (!channels.length) this.reels.length = Math.min(this.reels.length, SET_REELS_COUNT);
    this.reelFit = fitReelBank(this.reels, channels);
    return this.reelFit;
  }
  readonly display: MachineDisplay | null = null;
  readonly audioSource = new Mixer([this.sn, this.alarm]);

  constructor(roms: readonly Uint8Array[], nvram?: Uint8Array) {
    let off = 0;
    for (const r of roms) { if (off >= this.rom.length) break; this.rom.set(r.subarray(0, this.rom.length - off), off); off += r.length; }
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
      if (g.number < 0) continue;
      if (g.number >= SET_REELS_COUNT) {
        if (g.number >= this.jpmReels.reels.length) continue;
        this.windowOnly[g.number] = true;
        this.reels[g.number] = new Reel({
          stepsPerRevolution: g.halfSteps > 0 ? g.halfSteps : this.jpmReels.reels[g.number].steps,
          symbols: g.stops > 0 ? g.stops : REEL_STAND_IN_STOPS,
        });
        this.reels[g.number].position = this.windowPosition(g.number);
        if (g.stops <= 0 && !this.standInStops.includes(g.number)) this.standInStops.push(g.number);
        continue;
      }
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

  private windowOnly: boolean[] = [false, false, false, false, false, false, false, false];

  private windowPosition(i: number): number {
    const jr = this.jpmReels.reels[i];
    if (!this.windowOnly[i]) return jr.pos;
    const hs = this.reels[i].stepsPerRevolution;
    const v20 = v20UnfittedReelpos(jr.pos, jr.steps) % hs;
    return ((hs + SET_REELS_ADJUST - v20) % hs + hs) % hs;
  }

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
      id >= 0 && id < 128 && (this.matrix[id >> 3] & (1 << (id & 7))) !== 0);
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
        dil: dilPlace(`DIL ${i < 8 ? 4 : 3}`, i & 7, this.dilLabels?.[i]),
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
  private static readonly CLEAR_DOWN_KEY = 80;
  private static readonly TEST_SWITCH_ROW = 7;
  setHoppers(v: number): void { this.hoppersFlag = v & 0xff; }
  setProtocol(p: number): void { this.protocol = p; }
  setRotary(n: number): void { this.rotary = n & 0xf; this.pairedUnitRead = -1; }
  setGame(word: number): void { this.reelBonus = word === 1; }
  get hasReelBonus(): boolean { return this.reelBonus; }

  private driveReelBonus(v: number): void {
    if (!this.reelBonus || (v & 8) !== 0) return;
    this.reelBonusMotor = (v >> 2) & 1;
  }

  private tickReelBonus(cycles: number): void {
    this.reelBonusCycles += cycles;
    while (this.reelBonusCycles >= METER_TICK_CYCLES) {
      this.reelBonusCycles -= METER_TICK_CYCLES;
      if (++this.reelBonusTicks >= REEL_BONUS_TICKS) {
        this.reelBonusTicks = 0;
        if (this.reelBonusMotor) this.jpmReels.stepBonus(REEL_BONUS_SLOT);
      }
    }
  }

  get rotarySwitch(): number { return this.rotary; }

  setReelPosition(i: number, pos: number): void {
    this.jpmReels.setPosition(i, pos);
    const r = this.reels[i];
    if (r && this.jpmReels.reels[i]?.present) r.position = this.windowPosition(i);
  }

  batteryRam(): Uint8Array { return this.ram.slice(RAM_LO, RAM_LO + 0x800); }

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
    this.coinLockSeen = false;
    this.tokenLockSeen = false;
    this.tokenLockOutputWritten = false;
    this.dropLine.fill(-1);
    this.dropWait.fill(0);
    this.dropping = false;
    this.coinBook.reset();
    this.mechQueue = [];
    this.mechHeld = -1;
    this.mechTimer = 0;
    this.mechSettling = false;
    this.lampCol = 0;
    this.lampPending = false;
    this.lampSeenA = false;
    this.lampSeenB = false;
    this.lampFlicker = 0;
    this.lampHist.fill(0);
    this.lampAge = 0;
    this.hopper.reset();
    this.hopperBooked.paid = 0;

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
            if (this.reelBonus && (this.jpmReels.optos & (1 << REEL_BONUS_SLOT))) m3 |= 0x40;
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
      case 0x0:
        if ((a & 3) === 1) this.tokenLockOutputWritten = true;
        this.ppi26.write(a & 3, v);
        break;
      case 0x4: this.ppi21.write(a & 3, v); break;
      case 0x8: this.ppi22.write(a & 3, v); break;
      default: {
        const c0 = this.ppi25.drivenC();
        this.ppi25.write(a & 3, v);
        this.ppi25Lamps(a & 3, v, c0);
        break;
      }
    }
  }

  private ppi25Lamps(reg: number, v: number, c0: number): void {
    const modeSet = reg === 3 && (v & 0x80) !== 0;
    const cWritten = reg === 2 || reg === 3;
    if (cWritten && ((c0 ^ this.ppi25.drivenC()) & 0x0f) !== 0) {
      this.lampCol = this.ppi25.drivenC() & 0x0f;
      this.lampPending = true;
      this.lampSeenA = false;
      this.lampSeenB = false;
    }
    const col = this.lampCol, h = this.lampHist;
    if ((reg === 0 || modeSet) && !this.lampSeenA) {
      const a = this.ppi25a & 0xff, p = h[col], c = h[16 + col];
      this.lampFlicker = (this.lampFlicker & 0xff00) | ((p ^ c) & (c ^ a));
      h[col] = c; h[16 + col] = a;
      this.lampSeenA = true;
    }
    if (reg === 1 || modeSet) {
      if (!this.lampSeenB) {
        const b = this.ppi25b & 0xff, p = h[32 + col], c = h[48 + col];
        this.lampFlicker = (this.lampFlicker & 0x00ff) | (((p ^ c) & (c ^ b)) << 8);
        h[32 + col] = c; h[48 + col] = b;
        this.lampSeenB = true;
      }
      if (this.lampPending) {
        const data = ((this.ppi25b & 0xff) << 8) | (this.ppi25a & 0xff);
        const fl = this.lampFlicker, base = col * 16;
        for (let bit = 0; bit < 16; bit++) {
          const f = (fl >> bit) & 1;
          this.lamps[base + bit] = ((data >> bit) & 1) | f ? (f ? LAMP_FLICKER : LAMP_FULL) : 0;
        }
        this.lampPending = false;
      }
    }
  }

  private triacSenseWord = 0;
  private driveTriacSense(): void {
    const a = this.ppi26a, b = this.ppi26b;
    const word = !(a & 8) && this.nmiEnable ? (b & 1) | ((a & 7) << 1) | ((b & 0x80) >> 3) : 0;
    const rising = word & ~this.triacSenseWord;
    this.triacSenseWord = word;
    triacSenseRelease(this, rising);
    if (rising) {
      for (let i = 0; i < 5; i++) if ((rising >> i) & 1) this.bookPayoutLine(i);
    }
    if (rising && this.triacHasMoney) for (let i = 0; i < 5; i++) if ((rising >> i) & 1) this.bookTriacRise(i);
  }

  private bookTriacRise(i: number): void {
    const inC = this.triacInMult[i] ?? 0;
    this.meterTotals.in += inC;
    this.meterTotals.out += this.triacOutMultRaw[i] ?? 0;
    if (inC > 0) {
      this.meterTakesCoin();
      if (this.unitState.cal.win.open) this.unitCal().count(inC, this.now);
    }
    this.countMeterOut(this.triacOutMultRaw[i] ?? 0);
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
    if (this.reelBonus) this.tickReelBonus(c);
    if (++this.lampAge >= LAMP_AGE_INSTRUCTIONS) { this.lampAge = 0; this.ageSeg(); }
    this.hopper.tick(c);
    if (this.hopper.paid !== this.hopperBooked.paid) this.bookHoppers();
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
    if (this.matrix[Mps2.CLEAR_DOWN_KEY >> 3] & (1 << (Mps2.CLEAR_DOWN_KEY & 7))) this.clearDown = 0;
    if (!this.nmiEnable || (this.powerFail & this.watchdogTimeout & this.invalidAccess & this.clearDown)) {
      this.nmiRaised = 0;
    } else if (!this.nmiRaised) {
      this.nmiRaised = 1;
      this.cpu.nmi();
    }
    if (this.mechTimer > 0) this.tickMech(c);
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
          r.position = this.windowPosition(i);
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
      this.hopperFitted
        ? { id: 'hopper', label: 'HOPPER', part: 'motor hd10 bit 2', device: this.hopper }
        : { id: 'hopper', label: 'HOPPER', part: 'not fitted' },
      { id: 'coinmech', label: 'COIN MECH', part: 'inhibits - port A 4-7', signal: 'coin' },
    ];
  }

  layoutLamp(n: number): boolean {
    if (n >= this.lampsDriven) return true;
    return n >= 0 && this.lamps[n] !== 0;
  }

  layoutLampLevel(n: number): number {
    if (n >= this.lampsDriven) return 255;
    return n >= 0 ? this.lamps[n] : 0;
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
    const row = (id & 0x78) >> 3;
    const b = id & 7;
    if (on) this.matrix[row] |= 1 << b;
    else this.matrix[row] &= ~(1 << b);
  }

  insertCoin(bit: number): void {
    if (this.coinTimer > 0 || this.mechTimer > 0 || bit < 0 || bit > 31) return;
    if (this.tokenLockSeen && bit === 19 && (this.ppi26b & 0x80) === 0) {
      this.coinsRefused++;
      return;
    }
    if (this.coinLockSeen && bit >= 20 && bit <= 23 &&
        lockoutRefuses(COIN_INHIBITS, this.ppi26.read(0), 1 << bit)) {
      this.coinsRefused++;
      return;
    }
    if (!this.meterChecksCoins && !this.shutCoinWaits(bit)) {
      this.bookCoinTaken(bit);
    } else {
      this.pendingStillCounts();
      this.pendingFinder.dropped(this.ram, RAM_LO, RAM_HI, this.now);
      const k = this.dropLine.indexOf(-1);
      if (k < 0) this.coinsRefused++;
      else {
        if (!this.dropping) {
          this.bankTakesCoin();
          for (let l = 0; l < this.pendingAt.length; l++) if (this.pendingAt[l]! >= 0) this.pendingSeen[l] = this.ram[this.pendingAt[l]!]!;
        }
        this.dropLine[k] = bit; this.dropWait[k] = Mps2.WIRING_FIRST_WAIT; this.dropping = true;
      }
      this.unitCal().coin(this.unitSample(bit), this.now);
    }
    if (this.tokenMech && bit === this.tokenMech[0]) {
      this.mechQueue = this.tokenMech.slice(1);
      this.pressMech(this.tokenMech[0]!);
      return;
    }
    this.coinInput = bit;
    this.layoutInput(bit, true);
    this.coinTimer = COIN_HOLD + COIN_GAP;
  }

  get coinBusy(): boolean { return this.coinTimer > 0 || this.mechTimer > 0; }

  private shutCoinWaits(bit: number): boolean {
    return ((INHIBITED_LINES >>> bit) & 1) === 1 && this.inhibitsShut();
  }

  private inhibitsShut(): boolean {
    if (this.ppi26.read(3) & 0x10) return false;
    return lockoutRefuses(COIN_INHIBITS, this.ppi26.read(0), 0);
  }

  private static readonly TOK_MPS2 = 0x3f;
  private static readonly TOKEN_MECH: readonly number[] =
    (coinMatrixSteps(COIN_RAW[Mps2.TOK_MPS2]!) ?? []).map((s) => s.strobe * 8 + s.bit);
  private static readonly MECH_HELD = Math.round(0.05 * CLOCK);
  private static readonly MECH_TAIL = Math.round(0.02 * CLOCK);
  private static readonly MECH_SETTLE = Math.round(0.08 * CLOCK);
  private tokenMech: readonly number[] | null = null;
  private mechQueue: number[] = [];
  private mechHeld = -1;
  private mechTimer = 0;
  private mechSettling = false;

  private pressMech(id: number): void {
    this.mechHeld = id;
    this.layoutInput(id, true);
    this.mechTimer = Mps2.MECH_HELD + Mps2.MECH_TAIL;
    this.mechSettling = false;
  }

  private tickMech(c: number): void {
    this.mechTimer -= c;
    if (this.mechHeld >= 0 && this.mechTimer <= Mps2.MECH_TAIL) {
      this.layoutInput(this.mechHeld, false);
      this.mechHeld = -1;
    }
    if (this.mechTimer > 0) return;
    const next = this.mechQueue.shift();
    if (next !== undefined) { this.pressMech(next); return; }
    if (!this.mechSettling) { this.mechSettling = true; this.mechTimer = Mps2.MECH_SETTLE; return; }
    this.mechSettling = false;
    this.mechTimer = 0;
  }
}
