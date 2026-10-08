import { Sys80 } from './sys80';
import { noteRomCut } from './boarddefaults';
import { v20LoadRamFile } from './v20ramfile';
import type { BoardPart } from './parts';
import { OneBitSpeaker } from '../hw/speaker';
import { SRU_BASS_FREQ } from '../hw/blipleak';
import { AY_RATE } from '../hw/ay8910';
import { Mixer } from '../hw/mixer';
import { newCashLedger, type CashLedger, type CabinetSwitch, type CoinChute, type NamedCoin } from './machine';
import type { SlideEffect } from '../layout/fmlconfig';

const SRU_CLOCK = 1_500_000;
const INT1_PERIOD = 0x2004;
const INT2_PERIOD = 15000;
const REFRESH_TICK = 800;
const COIN_HOLD = Math.round(0.15 * SRU_CLOCK);
const COIN_GAP = Math.round(0.15 * SRU_CLOCK);

const inRam = (a: number) => (a >= 0x0c00 && a < 0x1000) || (a >= 0x1400 && a < 0x1800);

export type SruCoin = number | { token: number } | 'token' | null;

export const SRU_COIN_ROW = 2;

function coinName(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : pence > 100 ? `£${(pence / 100).toFixed(2)}` : `${pence}p`;
}

export function sruCoinsFromCabinet(
  slots: readonly { pence: number | null; token: boolean; mask: number }[],
): SruCoin[] {
  const out: SruCoin[] = [null, null, null, null];
  for (const s of slots) {
    const bit = [4, 5, 6, 7].find((b) => s.mask === 1 << b);
    if (bit === undefined || s.token || s.pence === null) continue;
    out[bit - 4] = s.pence;
  }
  return out;
}

const TONE_VOLTS = [6.764, 7.309, 7.848, 8.39, 8.926, 9.412, 10.0];
export const SRU_TONE_POT_DEFAULT = 50;

const roundEven = (x: number): number => {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

export function sruTonePeriods(pot: number): number[] {
  const f = Math.fround;
  const r = f(((100 - pot) * f(4700)) / f(100) + f(5400));
  const rc = f(r * f(2.2e-7) * f(10));
  return TONE_VOLTS.map((v) => {
    const hz = f(((f(10) - f(v)) * f(2)) / rc);
    return hz === 0 ? 0 : roundEven(750000 / hz);
  });
}

const TONE_OF_PATTERN = (() => {
  const t = new Uint8Array(64).fill(6);
  for (let p = 0x7f, i = 0; p !== 0; i++) {
    p >>= 1;
    t[p] = 6 - i;
  }
  return t;
})();

export class Sru extends Sys80 {
  static override readonly snapshotConfig: readonly string[] = [
    ...Sys80.snapshotConfig, 'slides',
    'coinPence', 'layoutCoinPence', 'chuteCache',
  ];

  override readonly clockHz = SRU_CLOCK;
  protected override readsProgramCoins = false;

  private row4 = 0;
  private int1En = 0;
  private int2En = 0;
  private latched = 0;
  private t1 = 0;
  private t2 = 0;
  tone = 0;
  private toneLatched = 0;
  private tonePeriods = sruTonePeriods(SRU_TONE_POT_DEFAULT);
  tonePeriod = 0;
  private toneLeft = 0;
  toneLevel = 0;
  private readonly toneSpeaker = new OneBitSpeaker(SRU_CLOCK, AY_RATE, { bassFreq: SRU_BASS_FREQ });
  private readonly toneMixer = new Mixer([this.toneSpeaker]);

  constructor(roms: readonly Uint8Array[], nvram?: Uint8Array) {
    super([], undefined);
    let at = 0;
    noteRomCut(this, roms.reduce((n, r) => n + r.length, 0), 0x1800);
    for (const r of roms) {
      this.memory.set(r.subarray(0, Math.max(0, 0x2000 - at)), at);
      at += r.length;
      if (at === 0x0c00) at = 0x1000;
      else if (at === 0x1400) at = 0x1800;
    }
    v20LoadRamFile(this.memory.subarray(0x1400, 0x1800), nvram);
  }

  override batteryRam(): Uint8Array { return this.memory.slice(0x1400, 0x1800); }

  override powerCycle(): void {
    this.reset();
  }

  override reset(): void {
    super.reset();
    this.memory.fill(0, 0x0c00, 0x1000);
    this.latched = 0;
    this.int1En = this.int2En = 0;
    this.t1 = this.t2 = 0;
    this.tone = 0;
    this.toneLevel = 0;
    this.tonePeriod = this.toneLeft = this.tonePeriods[0];
    this.toneSpeaker.reset();
    this.updateInt();
  }

  setTonePot(pot: number): void {
    this.tonePeriods = sruTonePeriods(pot);
  }

  override get audioSource(): Mixer { return this.toneMixer; }

  toneTick(c: number): void {
    if (this.toneLeft > 0) {
      this.toneLeft -= c;
      if (this.toneLeft < 1) {
        const at = Math.max(0, c + this.toneLeft - 1);
        this.toneLevel ^= 1;
        this.toneLeft += this.tonePeriod;
        if (this.tonePeriod === 0) { this.toneLevel = 1; this.toneLeft = 0; }
        this.toneSpeaker.tick(at);
        this.toneSpeaker.write(0, this.toneLevel);
        this.toneSpeaker.tick(c - at);
        return;
      }
    }
    this.toneSpeaker.tick(c);
  }

  protected override busRead(a: number): number {
    a &= 0xffff;
    if (a >= 0x2000) this.strays.hit(a);
    return this.memory[a];
  }

  protected override busWrite(a: number, v: number): void {
    a &= 0xffff;
    if (inRam(a)) this.memory[a] = v & 0xff;
    else if (a >= 0x2000) this.strays.hit(a);
  }

  protected override readPort(addr: number): number {
    switch (addr & 0x1e0) {
      case 0x000:
        this.matrix[0] = (this.matrix[0] & 0xf0) | (this.optos() ^ 0xf);
        return (this.matrix[(addr >> 3) & 3] >> (addr & 7)) & 1;
      case 0x020:
        return addr >= 0x30 && addr < 0x38 ? (this.row4 >> (addr & 7)) & 1 : 1;
      default:
        return 1;
    }
  }

  protected override writePort(addr: number, value: number): void {
    value &= 1;
    if (addr >= 0x38 && addr <= 0x3f) {
      if (addr === 0x3f) {
        if (this.int1En && !value) this.latched &= ~1;
        this.int1En = value;
        this.updateInt();
      } else if (addr === 0x3e) {
        if (this.int2En && !value) this.latched &= ~2;
        this.int2En = value;
        this.updateInt();
      } else {
        const m = 1 << (addr - 0x38);
        this.tone = value ? this.tone | m : this.tone & ~m;
        if (addr === 0x3d && this.tone !== this.toneLatched) {
          this.tonePeriod = this.tonePeriods[TONE_OF_PATTERN[this.tone]];
          if (this.toneLeft < 1) this.toneLeft = this.tonePeriod;
          this.toneLatched = this.tone;
        }
      }
      return;
    }
    this.writeMapped(addr & 0x1ff, value);
  }

  private updateInt(): void {
    const level = this.latched & 1 ? 1 : this.latched & 2 ? 2 : 0;
    this.cpu.setLevel(1, level === 1);
    this.cpu.setLevel(2, level === 2);
  }

  override step(): number {
    const c = this.cpu.step();
    this.tickMeters(c);
    if (++this.refresh >= 100000) this.refresh = 0;
    if (this.refresh % REFRESH_TICK === 0) this.ageSeg();
    this.toneTick(c);
    this.t1 += c;
    this.t2 += c;
    if (this.t1 > INT1_PERIOD) {
      this.t1 -= INT1_PERIOD;
      if (this.int1En) { this.latched |= 1; this.updateInt(); }
    }
    if (this.t2 > INT2_PERIOD) {
      this.t2 -= INT2_PERIOD;
      if (this.int2En) { this.latched |= 2; this.updateInt(); }
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
    return c;
  }

  override run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  protected override optionRows(): CabinetSwitch[] { return []; }

  override layoutInput(id: number, on: boolean): void {
    if (id >= 32 && id < 40) {
      const b = 1 << (id & 7);
      this.row4 = on ? this.row4 | b : this.row4 & ~b;
      return;
    }
    super.layoutInput(id, on);
  }

  private readonly gross = newCashLedger();
  override get cashLedger(): CashLedger | undefined {
    return this.coinPence.some((p) => p !== null) || this.slides.some((s) => s !== null)
      ? this.gross
      : undefined;
  }

  private slides: SlideEffect[] = [null, null, null, null, null, null, null, null];
  setSlidePence(slides: readonly SlideEffect[]): void {
    for (let i = 0; i < 8; i++) this.slides[i] = slides[i] ?? null;
  }

  private coinPence: SruCoin[] = [null, null, null, null];
  private layoutCoinPence: SruCoin[] = [null, null, null, null];
  setCoinPence(pence: readonly SruCoin[]): void {
    for (let i = 0; i < 4; i++) this.coinPence[i] = this.layoutCoinPence[i] = pence[i] ?? null;
    this.chuteCache = null;
  }

  override get unnamedCoinLines(): readonly number[] {
    const out: number[] = [];
    for (let i = 0; i < 4; i++) if (this.layoutCoinPence[i] === null) out.push(20 + i);
    return out;
  }

  nameCoin(line: number, coin: NamedCoin): void {
    const i = line - 20;
    if (i < 0 || i > 3 || this.layoutCoinPence[i] !== null) return;
    if (coin === 'token') this.coinPence[i] = 'token';
    else if (Number.isInteger(coin) && coin > 0) this.coinPence[i] = coin;
    else return;
    this.chuteCache = null;
  }

  private chuteCache: CoinChute[] | null = null;
  override get coinChutes(): readonly CoinChute[] | undefined {
    if (this.coinPence.every((p) => p === null)) return undefined;
    this.chuteCache ??= this.coinPence.map((p, i): CoinChute => {
      const bit = 20 + i;
      if (typeof p === 'number') return { label: coinName(p), bit, pence: p };
      if (p === 'token' || (p && typeof p === 'object')) return { label: 'Token', bit, pence: null, token: true };
      return { label: `Coin line ${bit - 16}`, bit };
    });
    return this.chuteCache;
  }

  private bookSlide(line: number): void {
    const s = this.slides[line];
    if (s === 'token') this.gross.unpricedTokenOut++;
    else if (s === 'unpriced') this.gross.unpricedOut++;
    else if (typeof s === 'number') this.gross.outPence += s;
  }

  private readonly bookedPulses = new Uint32Array(8);

  protected override writeMapped(port: number, value: number): void {
    super.writeMapped(port, value);
    for (let i = 0; i < 8; i++) {
      const seen = this.triacPulses[i];
      if (seen === this.bookedPulses[i]) continue;
      for (let n = this.bookedPulses[i]; n < seen; n++) this.bookSlide(i);
      this.bookedPulses[i] = seen;
    }
  }

  override insertCoin(bit: number): void {
    if (this.coinTimer > 0 || bit < 0 || bit > 39) return;
    this.coinInput = bit;
    this.layoutInput(bit, true);
    this.coinTimer = COIN_HOLD + COIN_GAP;
    const p = this.coinPence[bit - 20];
    if (typeof p === 'number') this.gross.inPence += p;
    else if (p === 'token') this.gross.unpricedTokenIn++;
    else if (p && typeof p === 'object') this.gross.tokenInPence += p.token;
  }

  override get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: 'LAMPS', part: 'direct drive', device: this.lamps, signal: 'lamps' },
      { id: 'sevenseg', label: '7-SEG', part: 'BCD - 2 or 4 digits', device: this.digits, signal: 'digits',
        note: 'The credit display: a 2 or 4 digit 7-segment LED unit.' },
      { id: 'meters', label: 'METERS', part: 'pulse counts', device: this.meters },
      { id: 'switches', label: 'SWITCH MATRIX', part: '5 rows x 8', device: this.matrix,
        note: 'CRU $00-$1F, plus the extension row at $30-$37. Row 0 carries the reel optos.' },
      { id: 'coins', label: 'COIN INPUTS', part: 'matrix lines', modelled: true, signal: 'coin',
        note: 'Timed matrix makes (insertCoin), as System 80 - not a mech.' },
      { id: 'ports', label: 'OUTPUT PORTS', part: '5 x 74LS259 - 40 lines', device: this.portWrites,
        note: 'What each line does - lamp, meter, triac, segment, reel phase - is a table this cabinet carries, not a property of the board.' },
      { id: 'inputs', label: 'INPUT PORTS', part: '3 x 74LS251 - 24 lines', device: this.matrix,
        note: 'Three 8-bit multiplexers, with a fourth row on the test/input extension socket.' },
      { id: 'decode', label: 'PORT DECODE', part: '2 x 74LS138 - 1 of 8', modelled: true,
        note: 'The CRU address decode is the switch in readPort/writePort; there is no separate device to point at.' },
      { id: 'ram', label: 'RAM', part: '2 x TMS4042 - 256 x 4', device: this.memory,
        note: 'Read and written at $0C00-$0FFF and $1400-$17FF.' },
      { id: 'rom', label: 'MEMORY CARD', part: '3K/4K/6K - TMS2708', device: this.memory,
        note: 'The card carries the game and gives the machine its identity: 3K from $0000, a fourth K at $1000, a fifth and sixth at $1800.' },
      { id: 'tone', label: 'TONE GENERATOR', part: 'NE566 VCO - CRU $38-$3D', device: this.toneSpeaker,
        note: 'Six tone lines pick the oscillator\u2019s control voltage through a resistor ladder; the panel pot sets the pitch.' },
      { id: 'busext', label: 'BUS EXTENSION', part: 'NVRAM + 24 DIP',
        note: 'An expansion board some cabinets carry: non-volatile memory, kept with the game, and operator switches, which are not emulated.' },
      { id: 'cpu', label: 'CPU', part: 'TMS9980A - 6 MHz xtal, 1.5 MHz', device: this.cpu, cpu: true },
      { id: 'irq', label: 'INTERRUPT TIMING', part: '74LS393 / 74LS148 - 183 Hz + 100 Hz', modelled: true,
        note: 'The two counters and the priority encoder are `step`’s t1/t2 and `updateInt`; both are fields on the board, not objects.' },
      { id: 'reels', label: 'REELS', part: 'stepper, 200 step - CRU $00-$0F', device: this.sreels, signal: 'reels' },
      { id: 'triacs', label: 'TRIAC PACKS', part: 'payout + lockout', device: this.triacPulses,
        note: 'Each triac sits out on the solenoid it switches. What a payout line throws is this cabinet\u2019s own data.' },
    ];
  }
}
