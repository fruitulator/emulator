import { Scmp } from '../cpu/scmp';
import { SwitchedLamps } from '../hw/switchedlamps';
import { MeterConfirm } from '../hw/meterconfirm';
import { OneBitSpeaker } from '../hw/speaker';
import { AY_RATE } from '../hw/ay8910';
import { BASE_BOARD_BASS_FREQ } from '../hw/blipleak';
import { V20Reels } from './v20reels';
import { placeRomFlat } from './pairplacer';
import { StrayCounter } from './strayaccess';
import { COIN_RAW } from './coinraw';
import type { AudioSource, CabinetSwitch, CashLedger, DigitKind, Machine, NamedCoin } from './machine';
import { newCashLedger } from './machine';
import { CoinBook, SlotCoins, coinOfNote, type BookedCoin } from './coinbook';
import type { SlideEffect } from '../layout/fmlconfig';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import type { ReelGeometry } from './layoutreels';
import type { Reel } from '../hw/reel';

export const PCLMAXI_CLOCK = 500_000;
const REEL_COUNT = 4;
export const PCLMAXI_REEL_ADJUST = 2;
const REEL_PATTERN = [0, 1, 4, 5, 2, 3, 6, 7, 8, 9, 12, 13, 10, 11, 14, 15];
const BCD_SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0, 0, 0, 0, 0xb4, 0];
const TIMER_PERIOD = 10000;
const MAINS_HALF = 5000;
const LADDER = [33000, 16000, 8200, 3900, 2000, 1000];

export const PCLMAXI_TONE: readonly number[] = Array.from({ length: 64 }, (_, code) => {
  let r = 0;
  for (let i = 0; i < 6; i++) {
    if (!(code & (1 << i))) continue;
    r = r === 0 ? LADDER[i] : Math.fround((r * LADDER[i]) / (r + LADDER[i]));
  }
  if (r === 0) return 0;
  const f = Math.fround((PCLMAXI_CLOCK / ((((15 - (15 / (r + 160)) * r) * 2) / (15 * 160 * Math.fround(1e-6))))) / 2);
  return Math.trunc(f);
});

export const PCLMAXI_DISC: Uint8Array = (() => {
  const t = new Uint8Array(0xf0);
  for (let i = 0xf0; i > 0; i -= 12) {
    let u = Math.trunc(i / 12);
    t[i % 0xf0] = 3;
    for (let k = 2; k < 12; k += 2) {
      const bit = u & 0x10;
      u <<= 1;
      t[i - k] = 2 - (bit >> 4);
    }
  }
  return t;
})();

const LAMP_COUNT = 0x70;
const TRIAC_LINES = 12;
const COIN_HOLD_LINE = Math.round(0.075 * PCLMAXI_CLOCK);
const COIN_GAP = Math.round(0.005 * PCLMAXI_CLOCK);

export class PclMaxi implements Machine {
  static readonly snapshotConfig: readonly string[] = ['switches', 'nvram', 'opticMode', 'meterInRaw', 'meterOutRaw', 'triacInRaw', 'triacOutRaw'];

  readonly clockHz = PCLMAXI_CLOCK;
  readonly cpu: Scmp;
  readonly display = null;

  readonly rom = new Uint8Array(0x1000);
  readonly work = new Uint8Array(0x100);
  readonly ram = new Uint8Array(0x40);
  private nvram: Uint8Array | null = null;

  readonly lampStore = new SwitchedLamps(LAMP_COUNT, 0);
  get lamps(): Uint8Array { return this.lampStore.shown; }
  readonly digitKind: DigitKind = 'byte16';
  readonly digits = new Uint8Array(16);

  private readonly reelBank = new V20Reels(REEL_COUNT);
  get reels(): readonly Reel[] { return this.reelBank.reels; }

  readonly meters = new MeterConfirm();
  readonly meterCounts = new Uint32Array(TRIAC_LINES);
  readonly triacPulses = new Uint32Array(TRIAC_LINES);
  private triacWord = 0;
  private meterWord = 0;
  get triacLevels(): number { return this.triacWord; }

  readonly speaker = new OneBitSpeaker(PCLMAXI_CLOCK, AY_RATE, { bassFreq: BASE_BOARD_BASS_FREQ });
  get audioSource(): AudioSource { return this.speaker; }

  readonly matrix = new Uint8Array(8);
  private switches: LayoutSwitch[] = [];
  opticMode = 0;

  readonly cashLedger: CashLedger = newCashLedger();
  private readonly book = new CoinBook(this.cashLedger, PCLMAXI_CLOCK);
  private readonly slots = new SlotCoins();
  private meterInRaw: number[] = [];
  private meterOutRaw: number[] = [];
  private triacInRaw: number[] = [];
  private triacOutRaw: number[] = [];
  private readonly gridTotals = { in: 0, out: 0 };
  get meterTotals(): { readonly in: number; readonly out: number } { return this.gridTotals; }

  private mainsAcc = 0;
  private timerAcc = 0;
  private timerFlag = false;
  private mains = 0;
  private toneCode = 0;
  private toneCount = 0;
  private tonePeriod = 0;
  private toneLevel = 0;
  sound2 = 0;
  private readonly outA = new Uint8Array(8);
  private readonly outB = new Uint8Array(8);

  private coinRow = 0;
  private coinMask = 0;
  private coinTimer = 0;

  readonly strays = new StrayCounter();

  constructor() {
    this.cpu = new Scmp({
      read: (a) => this.read(a),
      write: (a, v) => this.write(a, v),
      senseA: () => this.timerFlag || (this.matrix[0] & 0x3f) !== 0,
      senseB: () => false,
      flags: (f) => { if (f & 2) this.timerFlag = false; },
    });
    this.reset();
  }

  loadRom(files: readonly Uint8Array[]): void {
    this.rom.set(placeRomFlat(files, { max: 0x1000, reverse: false }).image.subarray(0, 0x1000));
  }

  batteryRam(): Uint8Array { return this.ram.slice(); }
  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, 0x40);
    this.ram.fill(0);
    this.ram.set(this.nvram);
  }

  setReelGeometry(geo: readonly ReelGeometry[]): void { this.reelBank.setGeometry(geo); }
  get reelStandIns(): readonly number[] { return this.reelBank.standIns; }
  setReelPosition(i: number, pos: number): void { this.reelBank.setPosition(i, pos); }

  setSwitches(sw: readonly LayoutSwitch[]): void {
    this.switches = [...sw];
    for (const s of sw) if (s.closed) this.layoutInput(s.number, true);
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    this.layoutInput(id, made);
    const drawn = this.switches.find((s) => s.number === id);
    if (!drawn) this.switches = [...this.switches, { number: id, label, closed: made }]
      .sort((a, b) => a.number - b.number);
    else if (drawn.label === '' || drawn.label === String(id)) drawn.label = label;
  }

  get switchPanel(): CabinetSwitch[] {
    return this.switches.map((s) => ({
      id: s.number, label: s.label,
      on: s.number >> 3 < this.matrix.length && ((this.matrix[s.number >> 3] >> (s.number & 7)) & 1) === 1,
    }));
  }

  setSlides(slides: readonly SlideEffect[] | null): void { this.book.setSlides(slides); }
  setCoinSlots(lines: Iterable<readonly [number, BookedCoin]>): void { this.slots.setLines(lines); }
  get unnamedCoinLines(): readonly number[] { return this.slots.unnamed; }
  nameCoin(line: number, coin: NamedCoin): void { this.slots.name(line, coin); }
  setMeterMoney(map: {
    meterIn: readonly number[]; meterOut: readonly number[];
    triacIn: readonly number[]; triacOut: readonly number[];
  }): void {
    this.meterInRaw = [...map.meterIn];
    this.meterOutRaw = [...map.meterOut];
    this.triacInRaw = [...map.triacIn];
    this.triacOutRaw = [...map.triacOut];
  }

  layoutInput(id: number, on: boolean): void {
    if (id < 0 || id >= this.matrix.length * 8) return;
    if (on) this.matrix[id >> 3] |= 1 << (id & 7);
    else this.matrix[id >> 3] &= ~(1 << (id & 7));
  }

  layoutLamp(n: number): boolean { return n >= 0 && n < LAMP_COUNT && this.lamps[n] !== 0; }
  layoutLampLevel(n: number): number { return n >= 0 && n < LAMP_COUNT ? this.lamps[n] : 0; }
  layoutDigit(n: number): number { return n >= 0 && n < this.digits.length ? this.digits[n] : 0; }

  powerCycle(): void {
    this.nvram = this.ram.slice();
    this.reset();
  }

  reset(): void {
    if (this.nvram) this.ram.set(this.nvram);
    this.cpu.reset();
    this.timerFlag = false;
    this.timerAcc = 0;
    this.mains = 0;
    this.toneCount = 0;
    this.toneLevel = 0;
    this.meterWord = 0;
    this.triacWord = 0;
    this.outA.fill(0);
    this.meters.reset();
    this.speaker.reset();
    this.reelBank.reset();
    this.coinTimer = 0;
    this.coinMask = 0;
    this.book.reset();
  }

  step(): number {
    const c = this.cpu.step();
    this.slice(c);
    return c;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  private slice(c: number): void {
    this.timerAcc += c;
    this.mainsAcc += c;
    if (this.timerAcc >= TIMER_PERIOD) {
      this.timerFlag = true;
      this.timerAcc -= TIMER_PERIOD;
      this.confirmMeters(this.meters.tick());
    }
    if (this.mainsAcc >= MAINS_HALF) {
      this.mains ^= 0x40;
      this.mainsAcc -= MAINS_HALF;
    }
    if (this.toneCount > 0) {
      this.toneCount -= c;
      if (this.toneCount < 1) {
        this.toneLevel ^= 1;
        this.toneCount += this.tonePeriod;
        if (this.tonePeriod === 0) this.toneCount = 0;
        this.speaker.write(0, this.toneLevel);
      }
    }
    this.speaker.tick(c);
    this.book.elapse(c);
    if (this.coinTimer > 0) {
      this.coinTimer -= c;
      if (this.coinTimer <= COIN_GAP) this.matrix[this.coinRow] &= ~this.coinMask;
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
  }

  private disc(i: number): number {
    const r = this.reelBank.state[i];
    return r ? PCLMAXI_DISC[(r.pos >> 1) % 0xf0] : 0;
  }

  read(addr: number): number {
    addr &= 0xffff;
    switch (addr >> 10) {
      case 0: case 1: case 2: case 3: return this.rom[addr & 0xfff];
      case 4: return this.work[addr & 0xff];
      case 5: return this.ram[addr & 0x3f];
      case 6:
        if ((addr & 0x140) === 0x140) return ((this.matrix[0] & 0x3f) | this.mains) & 0xff;
        this.strays.hit(addr);
        return 0;
      case 7: {
        if ((addr & 0x140) !== 0x40) { this.strays.hit(addr); return 0; }
        const bit = addr & 0x3f;
        const row = bit && !(bit & (bit - 1)) && bit <= 0x20 ? 31 - Math.clz32(bit) + 1 : 0;
        if (!row) return 0;
        let v: number;
        if (row === 1 && this.opticMode === 0) v = ((this.disc(2) << 4) | (this.disc(1) << 2) | this.disc(0)) & 0x3f;
        else if (row === 1 && this.opticMode === 1) v = ((this.disc(1) << 2) | this.disc(0)) & 0x0f;
        else if (row === 1) v = 0;
        else if (row === 2 && this.opticMode === 1) v = ((this.disc(3) << 2) | this.disc(2)) & 0x0f;
        else v = this.matrix[row] & 0x3f;
        return (v | this.mains) & 0xff;
      }
      default: this.strays.hit(addr); return 0;
    }
  }

  write(addr: number, val: number): void {
    addr &= 0xffff;
    const v = val & 0xff;
    switch (addr >> 10) {
      case 4: this.work[addr & 0xff] = v; return;
      case 5: this.ram[addr & 0x3f] = v; return;
      case 6: return;
      case 7: break;
      default: this.strays.hit(addr); return;
    }
    const idx = addr & 7;
    const bits = v & 0x3f;
    switch ((addr >> 3) & 7) {
      case 0: {
        if (bits === this.outA[idx]) return;
        this.outA[idx] = bits;
        this.lampStore.writeAt(idx * 8, 6, bits);
        if (idx === 1) this.setTriacs((this.triacWord & 0xfc0) | bits);
        else if (idx === 3) {
          this.setMeters((this.meterWord & 0x3f) | (bits << 6));
          this.setTriacs((this.triacWord & 0x3f) | (bits << 6));
        } else if (idx === 4) this.setMeters((this.meterWord & 0xfc0) | bits);
        return;
      }
      case 1:
        if (bits === this.outB[idx]) return;
        this.outB[idx] = bits;
        this.lampStore.writeAt(0x30 + idx * 8, 8, bits);
        return;
      case 2:
        if (this.opticMode < 2 && idx < 4) this.reelBank.step(idx, REEL_PATTERN[~v & 0xf]);
        return;
      case 3: case 4:
        this.digits[((addr >> 3) & 7) - 3] = BCD_SEG[v & 0xf];
        return;
      case 6:
        if (bits === this.toneCode) return;
        this.toneCode = bits;
        this.tonePeriod = PCLMAXI_TONE[bits];
        if (this.toneCount < 1 && this.tonePeriod !== 0) this.toneCount = this.tonePeriod;
        return;
      case 7:
        this.sound2 = bits;
        return;
      default: this.strays.hit(addr);
    }
  }

  private setMeters(w: number): void {
    this.meterWord = w & 0xfff;
    this.meters.write(this.meterWord);
  }

  private confirmMeters(confirmed: number): void {
    if (!confirmed) return;
    for (let i = 0; i < TRIAC_LINES; i++) {
      if (!(confirmed & (1 << i))) continue;
      this.meterCounts[i]++;
      this.gridTotals.in += this.meterInRaw[i] ?? 0;
      this.gridTotals.out += this.meterOutRaw[i] ?? 0;
    }
  }

  private setTriacs(w: number): void {
    w &= 0xfff;
    const rising = w & ~this.triacWord;
    this.triacWord = w;
    for (let i = 0; i < TRIAC_LINES; i++) {
      if (!(rising & (1 << i))) continue;
      this.triacPulses[i]++;
      this.gridTotals.in += this.triacInRaw[i] ?? 0;
      this.gridTotals.out += this.triacOutRaw[i] ?? 0;
      this.book.slide(i);
    }
  }

  insertCoin(id: number): void {
    if (this.coinTimer > 0) return;
    const raw = id >= 0x100 && id < 0x180 ? id : COIN_RAW[id];
    if (raw === undefined || !(raw & 0x100)) return;
    const row = (raw & 0x78) >> 3;
    if (row >= this.matrix.length) return;
    this.coinRow = row;
    this.coinMask = 1 << (raw & 7);
    this.coinTimer = COIN_HOLD_LINE + COIN_GAP;
    this.matrix[this.coinRow] |= this.coinMask;
    this.book.coin(id >= 0x100 ? this.slots.coinOn(id) : coinOfNote(id), COIN_HOLD_LINE);
  }

  get coinBusy(): boolean { return this.coinTimer > 0; }

  get parts(): BoardPart[] {
    return [
      { id: 'cpu', label: 'CPU', part: 'SC/MP - 500 kHz', device: this.cpu, cpu: true },
      { id: 'rom', label: 'PROGRAM ROM', part: '4 x 1K', device: this.rom },
      { id: 'ram', label: 'RAM', part: '256 bytes, and 64 battery backed', device: this.ram },
      { id: 'lamps', label: 'LAMPS', part: 'six-bit latches', device: this.lamps },
      { id: 'sevenseg', label: '7-SEG', part: '2 digits', device: this.digits },
      { id: 'meters', label: 'METERS', part: '12 lines', device: this.meterCounts },
      { id: 'triacs', label: 'TRIACS', part: '12 lines', device: this.triacPulses },
      { id: 'speaker', label: 'TONE', part: 'resistor ladder', device: this.speaker },
      { id: 'switches', label: 'SWITCHES', part: '6 rows of 6', device: this.matrix },
      { id: 'reels', label: 'REELS', part: 'coded optic discs', device: this.reelBank.reels },
    ];
  }
}
