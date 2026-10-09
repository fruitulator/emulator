import { HD6303Y } from '../cpu/m6303';
import type { Bus } from '../cpu/bus';
import { Ptm6840 } from '../hw/ptm6840';
import { Acia6850 } from '../hw/acia6850';
import { Ay8910, AY_RATE } from '../hw/ay8910';
import { OneBitSpeaker } from '../hw/speaker';
import { Mixer } from '../hw/mixer';
import { S16lf01 } from '../hw/s16lf01';
import { DataPak } from '../hw/datapak';
import { SwitchedLamps } from '../hw/switchedlamps';
import { MeterConfirm } from '../hw/meterconfirm';
import { BASE_BOARD_BASS_FREQ } from '../hw/blipleak';
import { V20Reels } from './v20reels';
import { placeRomFlat } from './pairplacer';
import { StrayCounter } from './strayaccess';
import { COIN_RAW } from './coinraw';
import type { AudioSource, CabinetSwitch, CashLedger, DigitKind, Machine, MachineDisplay } from './machine';
import { newCashLedger } from './machine';
import type { SlideEffect } from '../layout/fmlconfig';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import type { ReelGeometry } from './layoutreels';
import type { Reel } from '../hw/reel';

export const SYS83_CLOCK = 1_000_000;
const REEL_COUNT = 4;
export const SYS83_REEL_ADJUST = 7;
const REEL_PATTERN = [0, 1, 4, 5, 2, 3, 6, 7, 8, 9, 12, 13, 10, 11, 14, 15];
const BCD_SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7c, 0x07, 0x7f, 0x67, 0, 0, 0, 0, 0, 0];
const BITREV8 = Uint8Array.from({ length: 256 }, (_, i) => {
  let r = 0;
  for (let b = 0; b < 8; b++) if (i & (1 << b)) r |= 0x80 >> b;
  return r;
});
const ADDRESS_DECODE = [
  0x0200, 0x0400, 0x0020, 0x0001, 0x0002, 0x0080, 0x0010, 0x0100,
  0x0800, 0x0008, 0x0040, 0x1000, 0x0004, 0x2000, 0x4000, 0x8000,
];
const DATA_DECODE = [0x80, 0x04, 0x40, 0x10, 0x08, 0x01, 0x20, 0x02];
const NMI_PERIOD = 10000;
const VFD_BUSY = 0x96;
const WATCHDOG = 20000;
const METER_TICK_INSTRUCTIONS = 100;
const LAMP_COUNT = 0x8c;
const TRIAC_LINES = 10;
export const SYS83_COIN_ROW = 3;
const COIN_HOLD_ROW = Math.round(0.1 * SYS83_CLOCK);
const COIN_HOLD_LINE = Math.round(0.07 * SYS83_CLOCK);
const COIN_GAP = Math.round(0.05 * SYS83_CLOCK);

const lowSet = (latch: number, ctl: number): number => {
  const s = (ctl >> 1) & 7;
  return ((latch & ~(1 << s)) | ((ctl & 1) << s)) & 0xff;
};
const highSet = (latch: number, ctl: number): number => {
  const t = ctl >> 5;
  return ((latch & ~(1 << t)) | (((ctl >> 4) & 1) << t)) & 0xff;
};

export class Sys83 implements Bus, Machine {
  static readonly snapshotConfig: readonly string[] = ['switches', 'slidePence', 'meterInRaw', 'meterOutRaw', 'triacInRaw', 'triacOutRaw', 'nvram'];

  readonly clockHz = SYS83_CLOCK;
  readonly cpu: HD6303Y;

  readonly rom = new Uint8Array(0x10000);
  readonly ram = new Uint8Array(0x800);
  private nvram: Uint8Array | null = null;

  readonly ptm: Ptm6840;
  readonly acia: Acia6850;
  readonly datapak = new DataPak(SYS83_CLOCK);
  readonly ay = new Ay8910(SYS83_CLOCK, 'ay8910');
  readonly speaker = new OneBitSpeaker(SYS83_CLOCK, AY_RATE, { bassFreq: BASE_BOARD_BASS_FREQ });
  private readonly mix = new Mixer([this.ay, this.speaker]);
  get audioSource(): AudioSource { return this.mix; }

  readonly vfd = new S16lf01();
  get display(): MachineDisplay { return this.vfd; }

  readonly lampStore = new SwitchedLamps(LAMP_COUNT);
  get lamps(): Uint8Array { return this.lampStore.shown; }

  readonly digitKind: DigitKind = 'byte16';
  readonly digits = new Uint8Array(16);

  private readonly reelBank = new V20Reels(REEL_COUNT);
  get reels(): readonly Reel[] { return this.reelBank.reels; }

  readonly meters = new MeterConfirm();
  readonly meterCounts = new Uint32Array(8);

  readonly matrix = new Uint8Array(8);
  private switches: LayoutSwitch[] = [];
  private dip1 = 0;
  private dip2 = 0;

  private ctl = 0;
  private readonly lampLatch = new Uint8Array(4);
  private readonly pairLatch = new Uint8Array(8);
  private latch60 = 0;
  private latch61 = 0;
  private latch8 = 0;
  private latch5b = 0;
  private meterWord = 0;
  private triacWord = 0;
  get triacLevels(): number { return this.triacWord; }
  readonly triacPulses = new Uint32Array(TRIAC_LINES);

  private slidePence: SlideEffect[] = new Array(16).fill(null);
  private meterInRaw: number[] = [];
  private meterOutRaw: number[] = [];
  private triacInRaw: number[] = [];
  private triacOutRaw: number[] = [];
  private readonly gridTotals = { in: 0, out: 0 };
  get meterTotals(): { readonly in: number; readonly out: number } { return this.gridTotals; }
  readonly cashLedger: CashLedger = newCashLedger();
  get slidesPriced(): boolean { return this.slidePence.some((p) => p !== null); }

  private calls = 0;
  private nmiCount = 0;
  private vfdBusy = 0;
  private watchdog = 0;
  watchdogTrips = 0;
  private aciaClock = false;
  private speakerLevel = 0;
  private cycles = 0;

  private coinRow = 0;
  private coinMask = 0;
  private coinTimer = 0;

  readonly strays = new StrayCounter();

  constructor(prog: readonly Uint8Array[]) {
    this.cpu = new HD6303Y(this, 'm6800');
    this.ptm = new Ptm6840({
      output: (n, state) => { if (n === 1 && !state) this.aciaClock = true; },
    });
    this.acia = new Acia6850((b) => { this.datapak.receive(b, this.cycles); });
    this.loadRom(prog);
  }

  loadRom(files: readonly Uint8Array[]): void {
    const { image, total } = placeRomFlat(files, { max: 0x10000, reverse: true });
    const start = Math.max(0, 0x10000 - total);
    const codec = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      let out = 0;
      for (let b = 0; b < 8; b++) if (v & (1 << b)) out |= DATA_DECODE[b];
      codec[v] = out;
    }
    this.rom.fill(0);
    for (let a = start; a < 0x10000; a++) {
      let na = 0;
      for (let b = 0; b < 16; b++) if (a & (1 << b)) na |= ADDRESS_DECODE[b];
      this.rom[na] = codec[image[a]];
    }
  }

  batteryRam(): Uint8Array { return this.ram.slice(); }
  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, 0x800);
    this.ram.fill(0);
    this.ram.set(this.nvram);
  }

  setDips(d1: number, d2: number): void { this.dip1 = d1 & 0xff; this.dip2 = d2 & 0xff; }

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

  setSlidePence(slides: readonly SlideEffect[]): void {
    for (let i = 0; i < 16; i++) this.slidePence[i] = slides[i] ?? null;
  }

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
    this.calls = 0;
    this.meters.reset();
    this.vfd.reset();
    this.ay.reset();
    this.acia.reset();
    this.acia.setCts(false);
    this.ptm.reset();
    this.datapak.reset();
    this.watchdog = 0;
    this.latch61 = 0;
    this.meterWord = 0;
    this.latch60 = 0;
    this.latch8 = 0;
    this.nmiCount = 0;
    this.latch5b = 0;
    this.triacWord = 0;
    this.vfdBusy = 0;
    this.aciaClock = false;
    this.speakerLevel = 0;
    this.speaker.reset();
    this.lampStore.reset();
    this.digits.fill(0);
    this.coinTimer = 0;
    this.coinMask = 0;
    this.cpu.reset();
    this.cpu.irq1Enabled = true;
  }

  step(): number {
    if (++this.calls % METER_TICK_INSTRUCTIONS === 0) this.confirmMeters(this.meters.tick());
    const c = this.cpu.step();
    this.cycles += c;
    this.slice(c);
    return c;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  private slice(c: number): void {
    this.nmiCount += c;
    this.ptm.tick(c);
    if (this.vfdBusy > 0) this.vfdBusy -= c;
    if (this.aciaClock) {
      this.aciaClock = false;
      this.acia.tick(1);
    }
    const level = this.ptm.pinLevel(0) || this.ptm.pinLevel(2) ? 1 : 0;
    if (level !== this.speakerLevel) {
      this.speakerLevel = level;
      this.speaker.write(0, level);
    }
    this.speaker.tick(c);
    this.ay.tick(c, SYS83_CLOCK);
    if (this.watchdog !== 0) {
      this.watchdog -= c;
      if (this.watchdog <= 0) {
        this.watchdog = 0;
        this.watchdogTrips++;
      }
    }
    if (this.nmiCount >= NMI_PERIOD) {
      this.nmiCount -= NMI_PERIOD;
      this.cpu.setNMI(true);
      this.cpu.setNMI(false);
      this.cpu.setIRQ1(false);
    } else {
      this.cpu.setIRQ1(this.ptm.irq());
    }
    if (this.coinTimer > 0) {
      this.coinTimer -= c;
      if (this.coinTimer <= COIN_GAP) this.matrix[this.coinRow] &= ~this.coinMask;
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
  }

  private static bitAt(b: number, addr: number): number { return ((b << (7 - (addr & 7))) & 0x80); }

  read8(addr: number): number {
    addr &= 0xffff;
    if (addr >= 0x4000) return this.rom[addr];
    if (addr < 0x800) return this.ram[addr];
    switch ((addr & 0x3c00) >> 10) {
      case 2:
        switch ((addr & 0x3c0) >> 6) {
          case 0xb: return this.ptm.read(addr & 7);
          case 0xc: return this.ayRead();
          case 0xd: return this.acia.read(addr & 1);
          case 0xe: return 0;
          case 0xf: {
            const b = (this.matrix[0] & 0xf7) | (this.latch8 & 8 ? 0 : 0x40)
              | (this.reelBank.optos & 8 ? 1 : 0) | (this.vfdBusy < 1 ? 8 : 0);
            return Sys83.bitAt(b, addr);
          }
          default: this.strays.hit(addr); return 0;
        }
      case 3: return Sys83.bitAt(this.matrix[1], addr);
      case 4: return Sys83.bitAt(this.matrix[2], addr);
      case 5: return Sys83.bitAt(this.matrix[3], addr);
      case 6: return Sys83.bitAt(((this.reelBank.optos & 7) << 4) | this.matrix[4], addr);
      default: this.strays.hit(addr); return 0;
    }
  }

  private ayRead(): number {
    const r = this.ay.selectedAddress;
    const mixer = this.ay.regs[7];
    if (r === 14 && !(mixer & 0x40)) return ~BITREV8[this.dip1] & 0xff;
    if (r === 15 && !(mixer & 0x80)) return ~BITREV8[this.dip2] & 0xff;
    return this.ay.read();
  }

  write8(addr: number, v: number): void {
    addr &= 0xffff;
    v &= 0xff;
    if (addr < 0x800) { this.ram[addr] = v; return; }
    if (addr >= 0x8000) { this.strays.hit(addr); return; }
    const ctl = this.ctl;
    switch ((addr & 0x3c00) >> 10) {
      case 2:
        switch ((addr & 0x3c0) >> 6) {
          case 0:
            this.digitPair(8, ctl);
            this.vfdBusy = VFD_BUSY;
            this.vfd.writeChar(ctl);
            return;
          case 1: this.digitPair(6, ctl); return;
          case 2: this.reelPair(2, ctl); return;
          case 3: this.reelPair(0, ctl); return;
          case 4: this.digitPair(4, ctl); return;
          case 5: this.digitPair(2, ctl); return;
          case 6: this.digitPair(0, ctl); return;
          case 7: this.digitPair(12, ctl); this.lampPair(0, 0x28); return;
          case 8: this.digitPair(10, ctl); this.lampPair(2, 0x38); return;
          case 9: this.lampPair(4, 0x48); return;
          case 0xa: this.lampPair(6, 0x58); return;
          case 0xb: this.ptm.write(addr & 7, v); return;
          case 0xc:
            if (addr & 2) this.ay.selectAddress(v);
            else this.ay.write(v);
            return;
          case 0xd: this.acia.write(addr & 1, v); return;
          case 0xe: this.ctl = v; return;
          default: return;
        }
      case 7: {
        const n = lowSet(this.latch5b, ctl);
        if (n !== this.latch5b) {
          this.latch5b = n;
          this.setTriacs(((this.latch8 & 0xc0) >> 6) | (n << 2));
        }
        return;
      }
      case 8: {
        const n = lowSet(this.latch8, ctl);
        const changed = n ^ this.latch8;
        if (!changed) return;
        this.latch8 = n;
        if (n & 1) this.watchdog = WATCHDOG;
        if (changed & 6) this.lampStore.writeAt(0x68, 2, (n >> 1) & 3);
        if (changed & 0xc0) this.setTriacs(((n & 0xc0) >> 6) | (this.latch5b << 2));
        return;
      }
      case 9:
        this.latch61 = lowSet(this.latch61, ctl);
        this.lampStore.writeAt(0x78, 8, this.latch61);
        return;
      case 0xa: {
        const s = (ctl & 0xe) >> 1;
        const w = ((~(4 << s) & this.meterWord) | ((ctl & 1) << (s + 2)) | ((this.latch60 & 0xc0) >> 6)) & 0xff;
        this.setMeters(w);
        return;
      }
      case 0xb: {
        this.latch60 = lowSet(this.latch60, ctl);
        this.setMeters(((this.meterWord & 0xfc) | ((this.latch60 & 0xc0) >> 6)) & 0xff);
        this.lampStore.writeAt(0x20, 8, this.latch60 & 0x3f);
        return;
      }
      case 0xc: this.lampByte(3, 0x18); return;
      case 0xd: this.lampByte(2, 0x10); return;
      case 0xe: this.lampByte(1, 0x08); return;
      case 0xf: this.lampByte(0, 0x00); return;
      default: this.strays.hit(addr); return;
    }
  }

  private digitPair(first: number, ctl: number): void {
    this.digits[first] = BCD_SEG[ctl & 0xf];
    this.digits[first + 1] = BCD_SEG[ctl >> 4];
  }

  private reelPair(first: number, ctl: number): void {
    this.reelBank.step(first, REEL_PATTERN[ctl & 0xf]);
    this.reelBank.step(first + 1, REEL_PATTERN[ctl >> 4]);
  }

  private lampByte(i: number, first: number): void {
    this.lampLatch[i] = lowSet(this.lampLatch[i], this.ctl);
    this.lampStore.writeAt(first, 8, this.lampLatch[i]);
  }

  private lampPair(i: number, first: number): void {
    this.pairLatch[i] = lowSet(this.pairLatch[i], this.ctl);
    this.pairLatch[i + 1] = highSet(this.pairLatch[i + 1], this.ctl);
    this.lampStore.writeAt(first, 16, this.pairLatch[i] | (this.pairLatch[i + 1] << 8));
  }

  private setMeters(w: number): void {
    if (w === this.meterWord) return;
    this.meterWord = w;
    this.meters.write(w);
  }

  private confirmMeters(confirmed: number): void {
    if (!confirmed) return;
    for (let i = 0; i < 8; i++) {
      if (!(confirmed & (1 << i))) continue;
      this.meterCounts[i]++;
      this.gridTotals.in += this.meterInRaw[i] ?? 0;
      this.gridTotals.out += this.meterOutRaw[i] ?? 0;
    }
  }

  private setTriacs(word: number): void {
    word &= 0x3ff;
    const changed = word ^ this.triacWord;
    if (!changed) return;
    const rising = word & changed;
    this.triacWord = word;
    for (let i = 0; i < TRIAC_LINES; i++) {
      if (!(rising & (1 << i))) continue;
      this.triacPulses[i]++;
      this.gridTotals.in += this.triacInRaw[i] ?? 0;
      this.gridTotals.out += this.triacOutRaw[i] ?? 0;
      const p = this.slidePence[i];
      if (p === null || p === undefined) continue;
      if (typeof p === 'number') this.cashLedger.outPence += p;
      else if (p === 'token') this.cashLedger.unpricedTokenOut++;
      else this.cashLedger.unpricedOut++;
    }
    this.lampStore.writeAt(0x80, TRIAC_LINES, word);
  }

  insertCoin(id: number): void {
    if (this.coinTimer > 0) return;
    const raw = id >= 0x100 && id < 0x180 ? id : COIN_RAW[id];
    if (raw === undefined) return;
    if (raw & 0x100) {
      const row = (raw & 0x78) >> 3;
      if (row >= this.matrix.length) return;
      this.coinRow = row;
      this.coinMask = 1 << (raw & 7);
      this.coinTimer = COIN_HOLD_LINE + COIN_GAP;
    } else {
      this.coinRow = SYS83_COIN_ROW;
      this.coinMask = raw & 0xff;
      if (!this.coinMask) return;
      this.coinTimer = COIN_HOLD_ROW + COIN_GAP;
    }
    this.matrix[this.coinRow] |= this.coinMask;
  }

  get coinBusy(): boolean { return this.coinTimer > 0; }

  get parts(): BoardPart[] {
    return [
      { id: 'cpu', label: 'CPU', part: 'MC6802 - 1 MHz', device: this.cpu, cpu: true },
      { id: 'ram', label: 'RAM', part: '2K, battery backed', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: 'EPROM card', device: this.rom },
      { id: 'ptm', label: 'TIMER', part: 'MC6840 - interrupts, sound', device: this.ptm },
      { id: 'acia', label: 'SERIAL', part: 'MC6850 - data retrieval', device: this.acia },
      { id: 'ay', label: 'SOUND', part: 'AY-3-8910 - DIP switches on its ports', device: this.ay },
      { id: 'speaker', label: 'TONE', part: 'timer outputs 1 and 3', device: this.speaker },
      { id: 'lamps', label: 'LAMPS', part: 'addressable latches', device: this.lamps },
      { id: 'sevenseg', label: '7-SEG', part: '14 digits', device: this.digits },
      { id: 'vfd', label: 'VFD', part: '16 characters', device: this.vfd },
      { id: 'meters', label: 'METERS', part: '8 lines', device: this.meterCounts },
      { id: 'triacs', label: 'TRIACS', part: '10 lines', device: this.triacPulses },
      { id: 'switches', label: 'SWITCHES', part: '5 rows, read a bit at a time', device: this.matrix },
      { id: 'coins', label: 'COIN INPUTS', part: 'row 3', modelled: true,
        note: 'Timed matrix makes on the line the acceptor names - not a mech.' },
      { id: 'reels', label: 'REELS', part: 'four steppers', device: this.reelBank.reels },
    ];
  }
}
