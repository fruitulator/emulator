import type { Bus16 } from '../cpu/bus68k';
import type { AudioSource, CabinetSwitch, CoinPortLines, CoinWiringStatus, Machine, DigitKind } from './machine';
import { newCashLedger, ledgerOutMults, dilSwitchLabel } from './machine';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import { M68000 } from '../cpu/m68000';
import { Ptm6840 } from '../hw/ptm6840';
import { Pia6821 } from '../hw/pia6821';
import { S16lf01 } from '../hw/s16lf01';
import { Upd7759 } from '../hw/upd7759';
import { Ym2413 } from '../hw/ym2413';
import { Saa1099 } from '../hw/saa1099';

import { Mixer } from '../hw/mixer';
import { Reel } from '../hw/reel';
import { MODEL_RELATIONS, parkAtV20PowerUp, resetReelsInPlace } from './v20optic';
import { DataPak } from '../hw/datapak';
import { MeterConfirm } from '../hw/meterconfirm';
import { fitReelBank, type ReelFit } from './reelfit';
import { placeRomPairs, ROM_UNPLACED } from './pairplacer';
import { noteBoardDefault, noteRomCut } from './boarddefaults';
import type { DeclaredCoin } from './layoutcoins';
import { COIN_RAW } from './coinraw';
import { linesOf, wiringKey, wiringStateFor, type CoinLineTable, type CoinWiring, type Refusal, type SlotCoin, type StepState } from './coinwiring';
import { locateSys5Coins, locateSys5Meters, sys5CoinTable, sys5DryCall, SYS5_RAM_BASE, type Sys5CoinCode, type Sys5Meters } from './sys5coins';
import { StrayCounter } from './strayaccess';

export function sys5SlotLine(c: Pick<DeclaredCoin, 'line' | 'note' | 'button' | 'token'>, port: CoinPortLines): number {
  if (c.line !== null) return c.line;
  const rowLine = (bit: number): number | undefined => (bit >= 2 && bit <= 6 ? 8 + bit : undefined);
  const btn = c.button ?? -1;
  if (c.note !== null) {
    let mask: number | undefined;
    if (c.note >= 0x0f && c.note <= 0x16) {
      const hit = rowLine(c.note - 0x0f);
      if (hit !== undefined) return hit;
      mask = 1 << (c.note - 0x0f);
    } else if (c.note === 0x47) {
      if (btn >= 0 && btn < 128 && ((btn >> 3) & 15) === 7) {
        const hit = rowLine(btn & 7);
        if (hit !== undefined) return hit;
        mask = 1 << (btn & 7);
      }
    } else {
      const raw = COIN_RAW[c.note];
      if (raw !== undefined) mask = raw & 0x100 ? ((((raw & 0x78) >> 3) === 7) ? 1 << (raw & 7) : undefined) : raw & 0xff;
    }
    if (mask !== undefined) {
      const hit = port.lines.find((l) => (l.mask & port.compare) === (mask! & port.compare));
      return hit ? hit.bit : -1;
    }
  }
  return c.token ? 14 : 13;
}

export const SAA_CLOCK = 8_000_000;

export const CPU_CLOCK = 8_000_000;
export const PTM_CLOCK = 800_000;
const PTM_DIVIDER = CPU_CLOCK / PTM_CLOCK;
const METER_TICK_CYCLES = 25 * 750;

const ROM_SIZE = 0x40000;
const RAM_BASE = 0x040000;
const RAM_SIZE = 0x4000;
export const REEL_LAMP_BASE = 256;
export const AUX_LAMP_BASE = 288;

export interface IoAccess {
  addr: number;
  reads: number;
  writes: number;
}

class Acia6850 {
  private control = 0;
  private rx: number[] = [];
  private irqState = false;
  constructor(private readonly onIrq: () => void) {}

  reset(): void {
    this.control = 0;
    this.rx = [];
    this.irqState = false;
  }

  receive(byte: number): void {
    if (this.rx.length < 16) this.rx.push(byte & 0xff);
    this.refreshIrq();
  }

  status(): number {
    let s = 0;
    if (this.tdre()) s |= 0x02;
    if (this.rx.length) s |= 0x01;
    if (this.irqState) s |= 0x80;
    return s;
  }

  read(): number {
    const v = this.rx.shift() ?? 0;
    this.refreshIrq();
    return v;
  }

  writeControl(v: number): void {
    this.control = v & 0xff;
    if ((v & 0x03) === 0x03) {
      this.rx = [];
    }
    this.refreshIrq();
  }

  irq(): boolean {
    return this.irqState;
  }

  private txBusy = 0;

  tick(cycles: number): void {
    if (this.txBusy > 0) {
      this.txBusy -= cycles;
      if (this.txBusy <= 0) { this.txBusy = 0; this.refreshIrq(); }
    }
  }

  private tdre(): boolean {
    return this.txBusy <= 0;
  }

  markTransmit(): void {
    this.txBusy = 800;
    this.refreshIrq();
  }

  private refreshIrq(): void {
    const rxIntEnabled = (this.control & 0x80) !== 0;
    const txIntEnabled = (this.control & 0x60) === 0x20;
    const next = (rxIntEnabled && this.rx.length > 0) || (txIntEnabled && this.tdre());
    if (next !== this.irqState) {
      this.irqState = next;
      this.onIrq();
    }
  }
}

export class Sys5 implements Bus16, Machine {
  static readonly snapshotConfig: readonly string[] = ['nvram', 'coinCodeCache', 'romLoads', 'coinSlots', 'wiring', 'meterInMult', 'meterOutMult', 'refusingCache'];
  readonly digitKind: DigitKind = 'byte16';
  readonly cpu: M68000;
  readonly rom = new Uint8Array(ROM_SIZE);
  readonly ram = new Uint8Array(RAM_SIZE);

  readonly vfd = new S16lf01();

  readonly reels = parkAtV20PowerUp([0, 1, 2, 3, 4, 5].map(
    () => new Reel({
      mame: true, mameDrive: 'starpoint',
      stepsPerRevolution: 200, symbols: 16,
      indexStart: 1, indexEnd: 3, indexPattern: 0, initPhase: 2,
    }),
  ), MODEL_RELATIONS.SYS5);

  setReelPosition(i: number, pos: number): void {
    this.reels[i]?.park(pos);
  }

  reelFit: ReelFit = { mask: 0x3f, channels: 6, beyond: [] };

  setFittedReels(channels: readonly number[]): ReelFit {
    this.reelFit = fitReelBank(this.reels, channels);
    return this.reelFit;
  }

  reelStripOffsets: number[] = [0, 0, 0, 0, 0, 0];

  private static readonly REEL_DRIVE = [0x0a, 0x09, 0x06, 0x05];

  numReels = 4;

  private readonly ioLatch = new Uint8Array(0x20);

  readonly lamps = new Uint8Array(REEL_LAMP_BASE + 40);
  readonly digits = new Uint8Array(16);
  private readonly muxram = new Uint16Array(0x80);
  private lampStrobe = 0;
  private mpxClk = 0;

  private readonly strobes = new Uint16Array(5).fill(0xffff);
  private dsw = 0xffff;
  private dsw2 = 0xffff;
  private rotary = 0xffff;
  private readonly idleStrobes = new Uint16Array(5).fill(0xffff);

  private directSwitches = 0;

  private sw48 = 0;
  private coinPulse = 0;
  private static readonly COIN_HOLD = Math.floor(CPU_CLOCK * 0.1);
  private static readonly COIN_TAIL = Math.floor(CPU_CLOCK * 0.005);
  private readonly coinCycles = new Array(16).fill(0);
  private static readonly COIN_PENCE: Record<number, number> = { 10: 10, 11: 20, 12: 50, 13: 100, 14: 20 };
  private static readonly TOKEN_LINE = 14;
  readonly cashLedger = newCashLedger();

  chop = false;

  readonly meterCounts = new Uint32Array(8);
  private readonly meterBank = new MeterConfirm();
  private meterLatch = 0;
  get meterLevels(): number { return this.meterLatch & 0xff; }
  private meterActive = false;

  private readonly ptm = new Ptm6840({
    output: (n, state) => {
      if (n === 0) this.mpxTick(state);
      this.ptm.setExternalClock(n === 0 ? 1 : n === 1 ? 2 : 0, state);
    },
    irqChanged: () => this.updateIrq(),
  });
  private readonly pia = new Pia6821({
    readA: () => ~((this.meterActive ? 0x80 : 0) | this.directSwitches) & 0xff,
    writeB: (v) => this.driveMeters(v),
    writeCA2: (v) => { this.chop = v; },
    irqChanged: () => this.updateIrq(),
  });
  private dataportFitted = false;

  fitDataport(): void {
    this.dataportFitted = true;
  }

  private readonly dataPak = new DataPak(CPU_CLOCK);

  private readonly acia = [new Acia6850(() => this.updateIrq())];

  readonly upd = new Upd7759();
  private soundType: 'Std' | 'Yamaha' | null = null;
  readonly opll = Object.assign(new Ym2413(this.upd.rate), { v20Mix: true });
  private readonly mixer = new Mixer([this.upd, this.opll]);
  readonly saa = new Saa1099(SAA_CLOCK, this.upd.rate);
  private readonly saaMixer = new Mixer([this.upd, this.saa]);

  setSoundType(type: 'Std' | 'Yamaha' | null): void {
    this.soundType = type;
  }
  get musicChip(): 'YM2413' | 'SAA1099' | null {
    return this.soundType === 'Yamaha' ? 'YM2413' : this.soundType === 'Std' ? 'SAA1099' : null;
  }

  private nvram: Uint8Array | null = null;
  private readonly ioLog = new Map<number, IoAccess>();

  constructor() {
    this.cpu = new M68000(this);
  }

  get clockHz(): number {
    return CPU_CLOCK;
  }

  get display(): S16lf01 {
    return this.vfd;
  }

  get audioSource(): AudioSource {
    return this.soundType === 'Yamaha' ? this.mixer : this.soundType === 'Std' ? this.saaMixer : this.upd;
  }

  layoutLamp(n: number): boolean {
    if (n >= 0 && n < this.lamps.length) return this.lamps[n] !== 0;
    return false;
  }

  layoutDigit(n: number): number {
    return n >= 0 && n < this.digits.length ? this.digits[n] : 0;
  }

  layoutInput(id: number, on: boolean): void {
    if (id >= Sys5.DIL_ID_BASE && id < Sys5.DIL_ID_BASE + 16) {
      const n = id - Sys5.DIL_ID_BASE;
      const mask = 1 << (n & 7);
      const set = (w: number): number => (on ? w & ~mask : w | mask) & 0xffff;
      if (n < 8) this.dsw = set(this.dsw);
      else this.dsw2 = set(this.dsw2);
      return;
    }
    if (id >= 40 && id < 48) {
      const bit = 1 << (id - 40);
      if (on) this.directSwitches |= bit;
      else this.directSwitches &= ~bit & 0xff;
      return;
    }
    if (id >= 48 && id < 64) {
      const bit = 1 << (id - 48);
      if (on) this.sw48 |= bit;
      else this.sw48 &= ~bit & 0xffff;
      return;
    }
    if (id < 0 || id >= 40) return;
    const strobe = id >> 3;
    const bit = id & 0x07;
    if (this.isPanelSwitch(id)) {
      if (on) this.idleStrobes[strobe] &= ~(1 << bit) & 0xffff;
      else this.idleStrobes[strobe] |= 1 << bit;
    }
    if (on) this.strobes[strobe] &= ~(1 << bit) & 0xffff;
    else this.strobes[strobe] |= 1 << bit;
  }

  private isPanelSwitch(id: number): boolean {
    return this.panel.some((s) => s.number === id);
  }

  private panel: LayoutSwitch[] = [];

  setLayoutSwitches(list: readonly LayoutSwitch[]): void {
    const wanted = list.filter((s) => s.number >= 0 && s.number < 64);
    if (!wanted.length) return;
    this.panel = wanted.map((s) => ({ ...s }));
    for (const s of wanted) {
      if (s.number >= 48) {
        const bit = 1 << (s.number - 48);
        if (s.closed) this.sw48 |= bit;
        else this.sw48 &= ~bit & 0xffff;
        continue;
      }
      if (s.number >= 40) {
        const bit = 1 << (s.number - 40);
        if (s.closed) this.directSwitches |= bit;
        else this.directSwitches &= ~bit & 0xff;
        continue;
      }
      const strobe = s.number >> 3;
      const bit = s.number & 0x07;
      if (s.closed) this.idleStrobes[strobe] &= ~(1 << bit) & 0xffff;
      else this.idleStrobes[strobe] |= 1 << bit;
    }
    this.strobes.set(this.idleStrobes);
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    if (id < 0 || id >= 64) return;
    if (this.panel.length && !this.isPanelSwitch(id)) this.panel.push({ number: id, label, closed: made });
    if (id >= 48) {
      const bit = 1 << (id - 48);
      this.sw48 = made ? this.sw48 | bit : this.sw48 & ~bit & 0xffff;
    } else if (id >= 40) {
      const bit = 1 << (id - 40);
      this.directSwitches = made ? this.directSwitches | bit : this.directSwitches & ~bit & 0xff;
    } else {
      const mask = 1 << (id & 7);
      const strobe = id >> 3;
      this.idleStrobes[strobe] = made ? this.idleStrobes[strobe] & ~mask & 0xffff : this.idleStrobes[strobe] | mask;
      this.strobes[strobe] = made ? this.strobes[strobe] & ~mask & 0xffff : this.strobes[strobe] | mask;
    }
  }

  setDips(bank1: string | undefined, bank2: string | undefined): void {
    const pack = (s: string | undefined): number => {
      let v = 0xff;
      if (s) for (let i = 0; i < 8 && i < s.length; i++) if (s[i] === '1') v &= ~(1 << i) & 0xff;
      return v | 0xff00;
    };
    this.dsw = pack(bank1);
    this.dsw2 = pack(bank2);
  }

  get switchPanel(): CabinetSwitch[] {
    const state = (n: number): boolean =>
      n >= 48
        ? (this.sw48 & (1 << (n - 48))) !== 0
        : n >= 40
          ? (this.directSwitches & (1 << (n - 40))) !== 0
          : (this.strobes[n >> 3] & (1 << (n & 0x07))) === 0;
    const repeats = new Map<string, number>();
    for (const s of this.panel) repeats.set(s.label, (repeats.get(s.label) ?? 0) + 1);
    const nth = new Map<string, number>();
    return this.panel.map((s) => {
      const n = (nth.get(s.label) ?? 0) + 1;
      nth.set(s.label, n);
      const label = s.label
        ? (repeats.get(s.label)! > 1 ? `${s.label} ${n}` : s.label)
        : `Switch ${s.number}`;
      return { id: s.number, label, on: state(s.number) };
    }).concat(this.optionRows());
  }

  private optionRows(): CabinetSwitch[] {
    const rows: CabinetSwitch[] = [];
    for (let i = 0; i < 16; i++) {
      const word = i < 8 ? this.dsw : this.dsw2;
      rows.push({
        id: Sys5.DIL_ID_BASE + i,
        label: dilSwitchLabel(`DIP ${i < 8 ? 1 : 2} SW.${(i & 7) + 1}`, this.dilLabels?.[i]),
        on: (word & (1 << (i & 7))) === 0,
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

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: '256 LAMPS', part: '16 strobes x 16', device: this.lamps, signal: 'lamps' },
      { id: 'switches', label: 'INPUT MUX', part: '5 strobes x 16 + 2 DIP', device: this.strobes },
      { id: 'sevenseg', label: '7-SEG BANK', part: '16 digits', device: this.digits,
        signal: 'digits' },
      { id: 'meters', label: '8 METERS', part: 'electromechanical', device: this.meterCounts },
      { id: 'coins', label: 'COIN INPUTS', part: '$048004', signal: 'coin' },
      { id: 'mux', label: 'MUX RAM', part: '$04C000 - lamps, strobes, DIP',
        device: this.muxram },
      { id: 'reeldrv', label: 'REEL DRIVE', part: '$048008 drive, $048012 optos',
        device: this.reels },
      { id: 'ram', label: 'BATTERY RAM', part: '16K', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: '256K window', device: this.rom },
      { id: 'ptm', label: 'TIMER', part: 'MC6840 PTM', device: this.ptm },
      { id: 'pia', label: 'PIA', part: 'MC6821', device: this.pia },
      { id: 'acia', label: 'SERIAL', part: 'MC6850 (BACTA)' },
      { id: 'alpha', label: 'VFD', part: 'S16LF01 - 16 char', device: this.vfd, signal: 'display' },
      { id: 'upd', label: 'SPEECH', part: 'uPD7759', device: this.upd },
      this.soundType === 'Yamaha'
        ? { id: 'saa', label: 'MUSIC', part: 'YM2413', device: this.opll }
        : this.soundType === 'Std'
          ? { id: 'saa', label: 'MUSIC', part: 'SAA1099', device: this.saa }
          : { id: 'saa', label: 'MUSIC', part: 'music board - not stated' },
      { id: 'cpu', label: 'CPU', part: 'MC68000 - 8 MHz', device: this.cpu, cpu: true },
      { id: 'reels', label: 'REEL MECH', part: 'Starpoint x6', device: this.reels, signal: 'reels' },
      { id: 'coinmech', label: 'COIN MECH', part: 'acceptor', signal: 'coin' },
      { id: 'payout', label: 'PAYOUT TUBES', part: 'MS129 - tube solenoids',
        device: this.payoutPulses },
    ];
  }

  insertCoin(bit: number): void {
    const b = bit & 15;
    if (this.coinCycles[b] > 0) return;
    this.coinPulse |= 1 << b;
    this.coinCycles[b] = Sys5.COIN_HOLD + Sys5.COIN_TAIL;
    this.refusingCache = null;
    const code = this.coinCode();
    if (!code) {
      noteBoardDefault(this, {
        axis: 'coin',
        text: 'the program\'s coin table was not read - a coin books the board\'s price for its line',
        ifWrong: 'A coin the program values differently, or does not take, books the wrong money.',
      });
      if (b === Sys5.TOKEN_LINE) this.cashLedger.tokenInPence += Sys5.COIN_PENCE[b] ?? 0;
      else this.cashLedger.inPence += Sys5.COIN_PENCE[b] ?? 0;
      return;
    }
    if (!code.lines.some((l) => l.line === b)) { this.coinsRefused++; return; }
    this.judgeCount[b] = this.judgeCount[b]! + 1;
    this.judgeWait[b] = Sys5.JUDGE_WAIT;
    this.judging = true;
  }

  get coinBusy(): boolean {
    return this.coinCycles.some((c) => c > 0);
  }

  private romLoads = 0;
  private coinCodeCache: { at: number; c: Sys5CoinCode | Refusal; meters: Sys5Meters | Refusal } | null = null;
  private codeFound(): { c: Sys5CoinCode | Refusal; meters: Sys5Meters | Refusal } {
    if (this.coinCodeCache?.at !== this.romLoads) {
      this.coinCodeCache = { at: this.romLoads, c: locateSys5Coins(this.rom), meters: locateSys5Meters(this.rom) };
    }
    return this.coinCodeCache;
  }
  private coinCode(): Sys5CoinCode | null {
    const c = this.codeFound().c;
    return 'refused' in c ? null : c;
  }
  private programMeters(): Sys5Meters | null {
    const c = this.codeFound().meters;
    return 'refused' in c ? null : c;
  }
  get programReadsCoins(): boolean { return this.coinCode() !== null; }

  get coinLineTable(): CoinLineTable | null {
    const c = this.coinCode();
    return c ? sys5CoinTable(c) : null;
  }

  get coinLineTableRefusal(): string | null {
    const c = this.codeFound().c;
    return 'refused' in c ? c.refused : null;
  }

  private ramWord(a: number): number {
    const o = a - SYS5_RAM_BASE;
    return o >= 0 && o + 1 < this.ram.length ? (this.ram[o]! << 8) | this.ram[o + 1]! : 0;
  }

  private refillMade(code: Sys5CoinCode): boolean | null {
    const id = code.refillId < SYS5_RAM_BASE
      ? ((this.rom[code.refillId]! << 8) | this.rom[code.refillId + 1]!) : this.ramWord(code.refillId);
    const d0 = sys5DryCall({
      rom: this.rom, ram: this.ram, sp: this.cpu.a[7]!, sr: this.cpu.sr,
      input: (a) => (a >= 0x04c080 && a < 0x04c100 ? this.read16(a) : null),
    }, code.cond, id);
    return d0 === null ? null : d0 !== 0;
  }

  coinsRefused = 0;

  get coinRefusing(): number {
    const c = this.refusingCache;
    if (c && this.cycles >= c.at && this.cycles - c.at < Sys5.REFUSING_TTL) return c.mask;
    let m = 0;
    const code = this.coinCode();
    if (code) {
      const gated = code.gates.some((g) => this.ram[g - SYS5_RAM_BASE] !== 0);
      const refill = gated ? false : this.refillMade(code) === true;
      code.lines.forEach((l, k) => {
        if (gated || refill || this.ramWord(code.enable + 2 * k) === 0) m |= 1 << l.line;
      });
    }
    this.refusingCache = { at: this.cycles, mask: m };
    return m;
  }
  private refusingCache: { at: number; mask: number } | null = null;
  private static readonly REFUSING_TTL = CPU_CLOCK;
  private cycles = 0;

  private static readonly JUDGE_WAIT = Math.floor(CPU_CLOCK * 1.0);
  private judging = false;
  private readonly judgeCount = new Array(16).fill(0);
  private readonly judgeWait = new Array(16).fill(0);

  private judgeCoinStep(cycles: number): void {
    const code = this.coinCode();
    if (!code) { this.judgeCount.fill(0); this.judgeWait.fill(0); this.judging = false; return; }
    const pc = this.cpu.pc;
    if (pc === code.accept || pc === code.refill) {
      const k = this.cpu.d[4]! & 0xffff;
      const l = code.lines[k];
      if (l && this.judgeCount[l.line]! > 0) {
        this.judgeCount[l.line] = this.judgeCount[l.line]! - 1;
        this.refusingCache = null;
        if (pc === code.accept) this.bookTaken(l.line, l.token ? { token: l.pence } : l.pence);
      }
    }
    let any = false;
    for (let b = 0; b < 16; b++) {
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

  private bookTaken(line: number, taken: SlotCoin): void {
    if (this.wiring) { this.bookWiredCoin(line, taken); return; }
    if (typeof taken === 'number') this.cashLedger.inPence += taken;
    else this.cashLedger.tokenInPence += taken.token ?? 0;
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

  private bookWiredCoin(line: number, taken: SlotCoin): void {
    const w = this.wiring!;
    if (!this.booksMoney || w.conflicts.includes(line)) return;
    const c = w.coins.get(line);
    if (c === undefined) {
      if (typeof taken === 'number') this.cashLedger.inPence += taken;
      else this.cashLedger.tokenInPence += taken.token ?? 0;
      return;
    }
    const agrees = typeof c === 'number'
      ? typeof taken === 'number' && taken === c
      : typeof taken === 'object' && (c.token === null || c.token === taken.token);
    this.wiringState.state = agrees ? 'calibrated' : 'disagrees';
    if (!agrees) return;
    if (typeof c === 'number') { this.cashLedger.inPence += c; return; }
    if (c.token === null) { this.cashLedger.unpricedTokenIn++; return; }
    this.cashLedger.tokenInPence += c.token;
  }

  private coinSlots: number[] = [];

  setLayoutCoins(list: readonly DeclaredCoin[]): void {
    const slots = new Set<number>();
    for (const c of list) {
      if (c.named?.name.startsWith('ccTalk') || c.named?.name.startsWith('NV')) continue;
      if (c.pence !== null) continue;
      const line = sys5SlotLine(c, this.coinPortLines);
      if (line >= 0 && line <= 63) slots.add(line);
    }
    this.coinSlots = [...slots].sort((a, b) => a - b);
  }

  get unnamedCoinLines(): readonly number[] {
    return this.coinSlots;
  }

  get coinPortLines(): CoinPortLines {
    const code = this.coinCode();
    const lines = code ? code.lines.map((l) => l.line) : Object.keys(Sys5.COIN_PENCE).map(Number);
    return {
      compare: lines.reduce((m, l) => m | (1 << (l - 8)), 0),
      lines: lines.map((l) => ({ bit: l, mask: 1 << (l - 8) })),
    };
  }

  private readonly meterInMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly meterOutMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly gridTotals = { in: 0, out: 0 };

  get meterTotals(): { in: number; out: number } {
    return { in: this.gridTotals.in, out: this.gridTotals.out };
  }

  loadRom(files: Uint8Array[]): void {
    this.rom.fill(ROM_UNPLACED);
    this.romLoads++;
    const image = placeRomPairs(files, 0x8000, 0);
    noteRomCut(this, image.length, ROM_SIZE);
    this.rom.set(image.subarray(0, ROM_SIZE));
    this.cpu.setCodeRegion(0, this.rom);
  }

  loadSoundRom(data: Uint8Array): void {
    this.upd.loadRom(data);
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
    this.strobes.set(this.idleStrobes);
    this.coinPulse = 0;
    this.coinCycles.fill(0);
    this.judgeCount.fill(0);
    this.judgeWait.fill(0);
    this.judging = false;
    this.refusingCache = null;
    this.lamps.fill(0);
    this.digits.fill(0);
    this.ioLatch.fill(0);
    this.muxram.fill(0);
    this.lampStrobe = 0;
    this.mpxClk = 0;
    this.chop = false;
    this.meterLatch = 0;
    this.meterBank.reset();
    this.meterActive = false;
    this.payoutMask = 0;
    this.vfd.reset();
    this.ptm.reset?.();
    this.pia.reset?.();
    for (const a of this.acia) a.reset();
    this.dataPak.reset();
    resetReelsInPlace(this.reels);
    this.upd.reset();
    this.opll.reset();
    this.saa.reset();
    this.ptmFrac = 0;
    this.cpu.reset();
  }

  private updateIrq(): void {
    const level = this.acia[0].irq() ? 4
      : this.ptm.irq() ? 3
        : (this.pia.irqA() || this.pia.irqB()) ? 1
          : 0;
    this.cpu.setIRQ(level, null);
  }

  private mpxTick(state: boolean): void {
    const s = state ? 1 : 0;
    if (this.mpxClk !== s) {
      if (s === 0) {
        if (++this.lampStrobe > 15) this.lampStrobe = 0;
      }
      this.drawLamps();
    }
    this.mpxClk = s;
  }

  private drawLamps(): void {
    const st = this.lampStrobe;
    const lo = this.muxram[(st << 2) | 0];
    const hi = this.muxram[(st << 2) | 1];
    for (let i = 0; i < 8; i++) {
      this.lamps[(st << 4) | i] = (lo >> i) & 1;
      this.lamps[(st << 4) | i | 8] = (hi >> i) & 1;
    }
  }

  private coinInterfaceParallel = false;

  setCoinInterface(parallel: boolean): void {
    this.coinInterfaceParallel = parallel;
  }

  private latchAuxLamps(): void {
    const w = (this.ioLatch[6] << 8) | this.ioLatch[7];
    if (this.coinInterfaceParallel) {
      for (let i = 0; i < 8; i++) this.lamps[REEL_LAMP_BASE + i] = (w >> i) & 1;
    } else {
      const v = w >> 11;
      for (let i = 0; i < 8; i++) this.lamps[AUX_LAMP_BASE + i] = (v >> i) & 1;
    }
    this.drivePayout(w);
  }

  private payoutMask = 0;
  readonly payoutPulses = new Uint32Array(8);

  private drivePayout(w: number): void {
    const line = (w >> 4) & (this.coinInterfaceParallel ? 7 : 3);
    const mask = (w & 0x0f) === 0x0c ? 1 << line : 0;
    let rising = mask & ~this.payoutMask;
    this.payoutMask = mask;
    for (let i = 0; rising !== 0; i++, rising >>= 1) if (rising & 1) this.payoutPulses[i]++;
  }

  private meterOutPence: number[] = [];
  private tokenOutMeter = -1;

  setMeterMoney(outMult: readonly number[], inMult: readonly number[] = []): void {
    this.meterOutPence = ledgerOutMults({ in: inMult, out: outMult })[0].map((x) => x * Sys5.METER_UNIT_PENCE);
    const outs = outMult.flatMap((x, i) => (x ? [i] : []));
    this.tokenOutMeter = outs.length > 1 ? outs[1] : -1;
    for (let i = 0; i < 8; i++) {
      this.meterInMult[i] = inMult[i] ?? 0;
      this.meterOutMult[i] = outMult[i] ?? 0;
    }
  }

  static readonly METER_UNIT_PENCE = 10;

  private bookMeter(b: number): void {
    this.gridTotals.in += this.meterInMult[b] ?? 0;
    this.gridTotals.out += this.meterOutMult[b] ?? 0;
    if (!this.booksMoney) return;
    const pm = this.programMeters();
    if (pm) {
      if (b === pm.cashOut) this.cashLedger.outPence += Sys5.METER_UNIT_PENCE;
      else if (b === pm.tokenOut) this.cashLedger.tokenOutPence += Sys5.METER_UNIT_PENCE;
      return;
    }
    const p = this.meterOutPence[b] ?? 0;
    if (!p) return;
    noteBoardDefault(this, {
      axis: 'meter',
      text: 'the program\'s meter map was not read - money out is priced by the layout\'s meter grid',
      ifWrong: 'A meter the grid names wrongly books play or refills as money paid out.',
    });
    if (b === this.tokenOutMeter) this.cashLedger.tokenOutPence += p;
    else this.cashLedger.outPence += p;
  }

  private latchReelLamps(): void {
    const pairs: ReadonlyArray<readonly [number, number]> =
      [[0x0d, 0], [0x0c, 2], [0x0f, 4], [0x0e, 6]];
    for (const [off, base] of pairs) {
      const b = this.ioLatch[off];
      for (let row = 0; row < 3; row++) {
        this.lamps[REEL_LAMP_BASE + base + 8 * row] = (b >> (2 - row)) & 1;
        this.lamps[REEL_LAMP_BASE + base + 8 * row + 1] = (b >> (6 - row)) & 1;
      }
    }
  }

  private driveMeters(v: number): void {
    this.meterBank.write(v & 0xff);
    this.meterLatch = v;
    this.meterActive = v !== 0;
  }

  private noteIo(addr: number, isWrite: boolean): void {
    let e = this.ioLog.get(addr);
    if (!e) { e = { addr, reads: 0, writes: 0 }; this.ioLog.set(addr, e); }
    if (isWrite) e.writes++; else e.reads++;
  }

  read8(addr: number): number {
    const a = addr & 0xffffff;
    if (a < ROM_SIZE) return this.rom[a];
    if (a >= RAM_BASE && a < RAM_BASE + RAM_SIZE) return this.ram[a - RAM_BASE];
    const w = this.ioRead(a & ~1);
    return a & 1 ? w & 0xff : (w >> 8) & 0xff;
  }

  read16(addr: number): number {
    const a = addr & 0xfffffe;
    if (a < ROM_SIZE) return (this.rom[a] << 8) | this.rom[a + 1];
    if (a >= RAM_BASE && a < RAM_BASE + RAM_SIZE) {
      const o = a - RAM_BASE;
      return (this.ram[o] << 8) | this.ram[o + 1];
    }
    return this.ioRead(a);
  }

  write8(addr: number, val: number): void {
    const a = addr & 0xffffff;
    const v = val & 0xff;
    if (a < ROM_SIZE) return;
    if (a >= RAM_BASE && a < RAM_BASE + RAM_SIZE) { this.ram[a - RAM_BASE] = v; return; }
    this.ioWrite(a & ~1, a & 1 ? v : v << 8, a & 1 ? 0x00ff : 0xff00);
  }

  write16(addr: number, val: number): void {
    const a = addr & 0xfffffe;
    const v = val & 0xffff;
    if (a < ROM_SIZE) return;
    if (a >= RAM_BASE && a < RAM_BASE + RAM_SIZE) {
      const o = a - RAM_BASE;
      this.ram[o] = v >> 8;
      this.ram[o + 1] = v & 0xff;
      return;
    }
    this.ioWrite(a, v, 0xffff);
  }

  private ioRead(a: number): number {
    this.noteIo(a, false);
    if (a >= 0x046020 && a <= 0x046023) {
      return (a & 2) ? this.acia[0].read() : this.acia[0].status();
    }
    if (a >= 0x046040 && a <= 0x04604f) return this.ptm.read((a >> 1) & 7) & 0xff;
    if (a >= 0x046060 && a <= 0x046067) return this.pia.read((a >> 1) & 3) & 0xff;
    if (a >= 0x046080 && a <= 0x04609f) return 0xffff;

    if (a >= 0x048000 && a <= 0x04801f) {
      const off = a & 0x1f;
      if (off === 0 || off === 2) {
        const d = (this.ioLatch[0x0c] << 24) | (this.ioLatch[0x0d] << 16)
          | (this.ioLatch[0x0e] << 8) | this.ioLatch[0x0f];
        const r = (this.numReels * 4) & 31;
        const echo = r === 0 ? d >>> 0 : ((d >>> r) | (d << (32 - r))) >>> 0;
        return off === 0 ? echo >>> 16 : echo & 0xffff;
      }
      if (off === 4) return ~(this.sw48 | this.coinPulse) & 0xffff;
      if (off === 0x12) {
        let optos = 0;
        const n = Math.min(this.numReels, 8);
        for (let i = 0; i < n; i++) if (this.reels[i]?.optic()) optos |= 1 << i;
        optos &= this.reelFit.mask;
        return (this.ioLatch[0x12] << 8) | ((optos << (8 - n)) & 0xff);
      }
      return (this.ioLatch[off] << 8) | this.ioLatch[(off + 1) & 0x1f];
    }
    if (a >= 0x04c000 && a < 0x04c100) {
      switch (a - 0x04c000) {
        case 0x80: return this.dsw;
        case 0x82: return this.dsw2;
        case 0x84: return this.rotary;
        case 0x86: return this.strobes[0];
        case 0x88: return this.strobes[1];
        case 0x8a: return this.strobes[2];
        case 0x8c: return this.strobes[3];
        case 0x8e: return this.strobes[4];
        default: return 0xffff;
      }
    }
    if (a >= 0x04c100 && a <= 0x04c105) return 0x14 | (this.upd.active() ? 1 : 0);
    this.strays.hit(a);
    return 0xffff;
  }

  readonly strays = new StrayCounter();

  private ioWrite(a: number, v: number, mask: number): void {
    this.noteIo(a, true);
    const lo = v & 0xff;

    if (a >= 0x046020 && a <= 0x046023) {
      if (a & 2) this.txAcia(0, lo);
      else this.acia[0].writeControl(lo);
      return;
    }
    if (a >= 0x046040 && a <= 0x04604f) { this.ptm.write((a >> 1) & 7, lo); return; }
    if (a >= 0x046060 && a <= 0x046067) { this.pia.write((a >> 1) & 3, lo); return; }
    if (a >= 0x046080 && a <= 0x04609f) return;
    if (a >= 0x0460a0 && a <= 0x0460bf) {
      if (mask & 0x00ff) {
        if (this.soundType === 'Yamaha') {
          if (a & 2) this.opll.writeData(lo);
          else this.opll.writeAddress(lo);
        } else if (this.soundType === 'Std') {
          this.saa.write((a >> 1) & 1, lo);
        }
      }
      return;
    }
    if (a === 0x046000 || a === 0x0460c0) return;

    if (a >= 0x048000 && a <= 0x04801f) {
      const off = a & 0x1f;
      if (mask & 0xff00) this.ioLatch[off] = (v >> 8) & 0xff;
      if (mask & 0x00ff) this.ioLatch[(off + 1) & 0x1f] = lo;
      if (off === 8) this.driveReels((this.ioLatch[8] << 8) | this.ioLatch[9], 0);
      else if (off === 0x0a) this.driveReels((this.ioLatch[0x0a] << 8) | this.ioLatch[0x0b], 4);
      else if (off === 0x0c || off === 0x0e) this.latchReelLamps();
      else if (off === 6) this.latchAuxLamps();
      return;
    }

    if (a >= 0x04c000 && a < 0x04c100) {
      this.muxram[(a - 0x04c000) >> 1] = v & 0xffff;
      const strobe = (a & 0xff) >> 3;
      const kind = (a >> 1) & 3;
      if (strobe < 16) {
        if (kind === 0) {
          for (let i = 0; i < 8; i++) this.lamps[(strobe << 4) | i] = (lo >> i) & 1;
        } else if (kind === 1) {
          for (let i = 0; i < 8; i++) this.lamps[(strobe << 4) | i | 8] = (lo >> i) & 1;
        } else if (kind === 2) {
          this.digits[strobe] = lo;
        }
      }
      return;
    }
    if (a === 0x04c100) {
      this.upd.portW(lo);
      this.upd.setStartLine(false);
      this.upd.setStartLine(true);
      return;
    }
    if (a === 0x04c102) {
      this.vfd.por(v & 0x04);
      this.vfd.data(v & 0x02);
      this.vfd.sclk(v & 0x01);
      return;
    }
    if (a === 0x04c104) {
      this.upd.setResetLine((v & 0x04) === 0 ? false : true);
      this.upd.setRomBank((v >> 1) & 1);
      return;
    }
    if (a === 0x04c106 || a === 0x044000) return;
    this.strays.hit(a);
  }

  private txAcia(n: number, byte: number): void {
    this.acia[n].markTransmit();
    if (n !== 0 || !this.dataportFitted) return;
    const reply = this.dataPak.receive(byte, this.cpu.cycles);
    if (reply) for (const b of reply) this.acia[0].receive(b);
  }

  private driveReels(v: number, base: number): void {
    for (let i = 0; i < 4; i++) {
      const reel = base + i;
      if (reel >= this.reels.length) break;
      const drive = (v >> (i * 4)) & 0x03;
      this.reels[reel].update(Sys5.REEL_DRIVE[drive]);
    }
  }

  private ptmFrac = 0;

  step(): number {
    const cycles = this.cpu.step();
    this.cycles += cycles;
    if (this.judging) this.judgeCoinStep(cycles);

    this.ptmFrac += cycles;
    const ptmTicks = Math.floor(this.ptmFrac / PTM_DIVIDER);
    if (ptmTicks > 0) {
      this.ptmFrac -= ptmTicks * PTM_DIVIDER;
      this.ptm.tick(ptmTicks);
    }

    const confirmed = this.meterBank.advance(cycles, METER_TICK_CYCLES);
    if (confirmed) {
      for (let b = 0; b < 8; b++) if (confirmed & (1 << b)) { this.meterCounts[b]++; this.bookMeter(b); }
    }

    this.upd.tick(cycles, CPU_CLOCK);
    if (this.soundType === 'Yamaha') this.opll.tick(cycles, CPU_CLOCK);
    else if (this.soundType === 'Std') this.saa.tick(cycles, CPU_CLOCK);
    for (const a of this.acia) a.tick(cycles);

    for (let b = 0; b < this.coinCycles.length; b++) {
      if (this.coinCycles[b] > 0) {
        this.coinCycles[b] -= cycles;
        if (this.coinCycles[b] <= Sys5.COIN_TAIL) {
          this.coinPulse &= ~(1 << b) & 0xffff;
        }
        if (this.coinCycles[b] <= 0) this.coinCycles[b] = 0;
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
    return [...this.ioLog.values()].sort((x, y) => y.reads + y.writes - (x.reads + x.writes));
  }
}
