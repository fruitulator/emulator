import type { Machine, MachineDisplay, CabinetSwitch, CashLedger, AudioSource, DigitKind, CoinChute, CoinWiringStatus } from './machine';
import { newCashLedger, ledgerOutMults, dilSwitchLabel } from './machine';
import { detectCoins, linesOf, wiringKey, wiringStateFor, type CoinLineTable, type CoinWiring, type Refusal, type SlotCoin, type StepState } from './coinwiring';
import type { DeclaredCoin } from './layoutcoins';
import {
  coinReachesRow, locatePhoenixCoins, phoenixCoins, phxCoinOf, phxCoinTable, phxIdHits, phxReadLines, phxSlotId,
  TOKEN_IN_METER, TOKEN_OUT_METER, type PhxCoin, type PhxCoinCode,
} from './phoenixcoins';
import { Z180 } from '../cpu/z180';
import type { Z80Io } from '../cpu/z80';
import { I8255 } from '../hw/i8255';
import { Ay8910, AY_RATE } from '../hw/ay8910';
import { Ym2413 } from '../hw/ym2413';
import { Mixer } from '../hw/mixer';
import { DataPak } from '../hw/datapak';
import { Okim6295 } from '../hw/okim6295';
import { COIN_RAW } from './coinraw';
import { V20Reels, v20OpticWindowPhoenix } from './v20reels';
import type { ReelGeometry } from './layoutreels';
import type { LayoutSwitch } from './layoutswitches';
import type { BoardPart } from './parts';
import { noteRomCut } from './boarddefaults';

export const CLOCK = 6_144_000;
const ROM_SIZE = 0x10000;
const ROM_TOP = 0xe000;
const RAM_BASE = 0xe000;
const RAM_SIZE = 0x2000;
const INT0_PERIOD = 0x3000;
const INT1_PERIOD = 0xf000;
const AY_CLOCK = 0x177000;
const REEL_COUNT = 8;
export const PHOENIX_REEL_ADJUST = 0;
const WATCHDOG2 = 0x96000;
const METER_UNIT_PENCE = 10;
const METER_TICK = 1000;
const COIN_HOLD_LINE = Math.round(0.07 * CLOCK);
const COIN_TAIL = Math.round(0.005 * CLOCK);
const COIN_GAP = Math.round(0.1 * CLOCK);
const COIN_HOLD = Math.round(0.1 * CLOCK);
const OKI_RATE = 0x1d97;

const PCT_KEY = [0x0, 0x8, 0x4, 0xc, 0x2, 0xa, 0x6, 0xe, 0x1, 0x9, 0x5, 0xd, 0x3, 0xb, 0x7, 0xf];
const BITREV8 = Uint8Array.from({ length: 256 }, (_, i) => {
  let r = 0;
  for (let b = 0; b < 8; b++) if (i & (1 << b)) r |= 0x80 >> b;
  return r;
});
function phoenix2Segments(x: number): number {
  return (((x & 0x8000) >> 15) | ((x & 0x4000) >> 13) | ((x & 0x2000) >> 6) | ((x & 0x1000) >> 2) |
    (x & 0x0800) | ((x & 0x0400) << 2) | ((x & 0x0200) >> 7) | (x & 0x0100) | ((x & 0x0080) << 2) |
    (x & 0x0040) | ((x & 0x0020) << 10) | ((x & 0x0010) << 10) | ((x & 0x0008) << 10) |
    ((x & 0x0004) << 1) | ((x & 0x0002) << 4) | ((x & 0x0001) << 4)) & 0xffff;
}

const LAMP_COUNT = 0x120;

class Ppi {
  readonly pins = [0, 0, 0];
  inA = 0xff;
  inB = 0xff;
  inC = 0xff;
  readonly chip: I8255;
  constructor() {
    this.chip = new I8255({
      outA: (v) => { this.pins[0] = v; },
      outB: (v) => { this.pins[1] = v; },
      outC: (v) => { this.pins[2] = v; },
      inA: () => this.inA,
      inB: () => this.inB,
      inC: () => this.inC,
    }, { modeSetKeepsLatches: true });
  }
  eff(i: number): number {
    const ctrl = this.chip.read(3);
    if (i === 0) return ctrl & 0x10 ? 0 : this.pins[0];
    if (i === 1) return ctrl & 0x02 ? 0 : this.pins[1];
    const dir = (ctrl & 0x08 ? 0xf0 : 0) | (ctrl & 0x01 ? 0x0f : 0);
    return this.pins[2] & ~dir & 0xff;
  }
  read(reg: number): number {
    return (reg & 3) === 3 ? 0xff : this.chip.read(reg & 3);
  }
  write(reg: number, v: number): void {
    this.chip.write(reg, v);
  }
  reset(): void {
    this.chip.reset();
  }
}

export class Phoenix implements Machine {
  static readonly snapshotConfig: readonly string[] = ['switches', 'coinCodeCache', 'coinsCache', 'coinSlots', 'drawnCoins', 'wiring', 'meterInRaw', 'meterOutRaw'];

  readonly digitKind: DigitKind = 'impact';
  readonly clockHz = CLOCK;
  readonly reelsByLayoutNumber = true;

  readonly cpu: Z180;
  readonly phoenix2: boolean;
  readonly ppi = [new Ppi(), new Ppi(), new Ppi(), new Ppi(), new Ppi(), new Ppi()];
  readonly ay = new Ay8910(AY_CLOCK, 'ay8910');
  readonly ym = Object.assign(new Ym2413(AY_RATE), { v20Mix: true });
  private readonly mixer = new Mixer([this.ay, this.ym]);
  readonly dataPak = new DataPak(CLOCK);

  readonly rom = new Uint8Array(ROM_SIZE);
  readonly ram = new Uint8Array(RAM_SIZE);
  readonly lamps = new Uint8Array(LAMP_COUNT);
  readonly digits = new Uint16Array(16);
  readonly meters = new Uint32Array(8);
  readonly triacPulses = new Uint32Array(8);
  get triacLevels(): number {
    return this.triacLatch & 0xff;
  }
  private readonly reelBank = new V20Reels(REEL_COUNT, v20OpticWindowPhoenix);
  get reels() { return this.reelBank.reels; }
  get display(): MachineDisplay | null { return null; }
  readonly oki = new Okim6295(OKI_RATE);
  get audioSource(): AudioSource | null { return this.phoenix2 ? this.oki : this.mixer; }

  protected readonly matrix = new Uint8Array(8);
  protected switches: LayoutSwitch[] = [];
  private dip1 = 0;
  private dip2 = 0;
  private pct = 0;

  private column = 0;
  private lampLo = 0;
  private lampHi = 0;
  private lampCount = 0;
  private digitCount = 0;
  private digitHi = 0;
  private readonly lampCache = new Uint16Array(16);
  private meterLatch = 0;
  get meterLevels(): number { return this.meterLatch & 0xff; }
  private meterRise = 0;
  private readonly meterCount = new Uint8Array(8);
  private meterHeld = 0;
  private execCount = 0;
  private triacLatch = 0;
  private portC4 = 0;
  sampleBank = 0;
  sampleCommands = 0;

  private int0Acc = 0;
  private int1Acc = 0;
  private int0 = false;
  private int1 = false;
  private toggleAcc = 0;
  private toggle = 0;
  private watchdog = 0;
  watchdogResets = 0;
  wildAccesses = 0;
  private cycles = 0;

  constructor(roms: readonly Uint8Array[], nvram?: Uint8Array, phoenix2 = false) {
    this.phoenix2 = phoenix2;
    let off = 0;
    for (const r of roms) {
      if (off >= ROM_SIZE) break;
      this.rom.set(r.subarray(0, ROM_SIZE - off), off);
      off += r.length;
    }
    noteRomCut(this, off, ROM_SIZE);
    if (nvram) this.ram.set(nvram.subarray(0, RAM_SIZE));
    const io: Z80Io = { in: (p) => this.portIn(p), out: (p, v) => this.portOut(p, v) };
    this.cpu = new Z180({ read8: (a) => this.read(a), write8: (a, v) => this.write(a, v) }, io, {
      asciTx: (ch, b) => { if (ch === 1) this.pakByte(b); },
    });
  }

  setReelGeometry(geometry: readonly ReelGeometry[]): void { this.reelBank.setGeometry(geometry); }

  get reelStandIns(): readonly number[] { return this.reelBank.standIns; }
  setReelPosition(i: number, pos: number): void { this.reelBank.setPosition(i, pos); }
  setDips(d1: number, d2: number): void { this.dip1 = d1 & 0xff; this.dip2 = d2 & 0xff; }
  setPercentage(stored: number): void { this.pct = stored & 0xf; }

  loadSound(roms: readonly Uint8Array[]): void {
    const img = new Uint8Array(roms.reduce((a, r) => a + r.length, 0));
    let o = 0;
    for (const r of roms) { img.set(r, o); o += r.length; }
    this.oki.loadRom(img);
  }

  private readonly ledger = newCashLedger();
  private meterInPence: number[] = [];
  private meterOutPence: number[] = [];
  get cashLedger(): CashLedger | undefined {
    return this.meterInPence.length ? this.ledger : undefined;
  }
  setMeterMoney(inMult: readonly number[], outMult: readonly number[]): void {
    this.meterInRaw = [...inMult];
    this.meterOutRaw = [...outMult];
    this.meterInPence = inMult.map((x) => x * METER_UNIT_PENCE);
    this.meterOutPence = ledgerOutMults({ in: inMult, out: outMult })[0].map((x) => x * METER_UNIT_PENCE);
  }

  private get tokenInMeter(): number { return this.coinCode() ? TOKEN_IN_METER : -1; }
  private get tokenOutMeter(): number { return this.coinCode() ? TOKEN_OUT_METER : -1; }

  setSwitches(sw: LayoutSwitch[]): void {
    this.switches = sw;
    for (const s of sw) if (s.closed) this.layoutInput(s.number, true);
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    if (id < 0 || id >> 3 >= this.matrix.length) return;
    this.layoutInput(id, made);
    if (this.switches.length && !this.switches.some((s) => s.number === id)) {
      this.switches = [...this.switches, { number: id, label, closed: made }];
    }
  }

  get switchPanel(): CabinetSwitch[] {
    const rows: CabinetSwitch[] = this.switches.map((s) => ({
      id: s.number, label: s.label,
      on: s.number >> 3 < this.matrix.length && ((this.matrix[s.number >> 3] >> (s.number & 7)) & 1) === 1,
    }));
    const count = this.phoenix2 ? 8 : 16;
    for (let i = 0; i < count; i++) {
      const bank = i < 8 ? this.dip1 : this.dip2;
      rows.push({
        id: Phoenix.DIL_ID_BASE + i,
        label: dilSwitchLabel(`DIP switch ${(i & 7) + 1} bank ${i < 8 ? 1 : 2}`, this.dilLabels?.[i]),
        on: (bank & (1 << (i & 7))) !== 0,
        group: 'DIP switches',
        bootOnly: true,
        option: true,
      });
    }
    return rows;
  }

  private dilLabels: readonly string[] | null = null;
  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  private static readonly DIL_ID_BASE = 64;

  powerCycle(): void {
    this.reset();
  }

  reset(): void {
    this.cpu.reset();
    for (const p of this.ppi) p.reset();
    this.ay.reset();
    this.ym.reset();
    this.dataPak.reset();
    this.reelBank.reset();
    this.lamps.fill(0);
    this.digits.fill(0);
    this.lampCache.fill(0);
    this.column = this.lampLo = this.lampHi = this.lampCount = this.digitCount = this.digitHi = 0;
    this.meterLatch = this.meterRise = this.triacLatch = this.portC4 = this.sampleBank = 0;
    this.meterHeld = this.execCount = 0;
    this.meterCount.fill(0);
    this.oki.reset();
    this.int0Acc = this.int1Acc = this.toggleAcc = this.toggle = 0;
    this.int0 = this.int1 = false;
    this.watchdog = 0;
    this.coinTimer = 0;
    this.coinMask = 0;
    this.coinNext = 0;
    this.coinHeld = false;
    this.judgeId.fill(-1);
    this.judgeWait.fill(0);
    this.judging = false;
  }

  private read(a: number): number {
    if (a < ROM_TOP) return this.rom[a];
    if (a < RAM_BASE + RAM_SIZE) return this.ram[a - RAM_BASE];
    this.wildAccesses++;
    return 0xff;
  }

  private write(a: number, v: number): void {
    if (a < ROM_TOP) return;
    if (a < RAM_BASE + RAM_SIZE) { this.ram[a - RAM_BASE] = v; return; }
    this.wildAccesses++;
  }

  private portIn(port: number): number {
    const p = port & 0xff;
    const reg = p & 3;
    const m = this.matrix;
    const optos = this.reelBank.optos;
    switch (p & 0xfc) {
      case 0x40:
        if (!this.phoenix2) this.ppi[0].inC = 0x20 | (this.meterLatch ? 0x10 : 0);
        return this.ppi[0].read(reg);
      case 0x44:
        return this.ppi[1].read(reg);
      case 0x48: {
        const q = this.ppi[2];
        q.inA = ~m[2] & 0xff;
        q.inB = ~m[0] & 0xff;
        q.inC = this.phoenix2
          ? (~m[1] & 0x9f) | this.toggle | (this.meterRise ? 0x20 : 0)
          : ~m[3] & 0xff;
        return q.read(reg);
      }
      case 0x4c:
        this.ppi[3].inC = this.phoenix2
          ? ((optos << 4) | (~PCT_KEY[this.pct] & 0xf)) & 0xff
          : ((~optos << 4) | (m[4] & 0xf)) & 0xff;
        return this.ppi[3].read(reg);
      case 0x50: {
        const q = this.ppi[4];
        if (this.phoenix2) q.inC = ~m[3] & 0xff;
        else q.inB = q.eff(2) === 1 ? ~PCT_KEY[this.pct] & 0xf : ~m[1] & 0xff;
        return q.read(reg);
      }
      case 0x54:
        if (this.phoenix2) return ~BITREV8[this.dip1] & 0xff;
        return reg & 1 ? 0 : this.ayRead();
      case 0x5c:
        if (this.phoenix2) return reg === 0 ? this.oki.read() & 0x0f : 0;
        this.ppi[5].inC = ~optos & 0xf0;
        return this.ppi[5].read(reg);
      default:
        return 0;
    }
  }

  private ayRead(): number {
    const r = this.ay.selectedAddress;
    const mixer = this.ay.regs[7];
    if (r === 14 && !(mixer & 0x40)) return ~this.dip1 & 0xff;
    if (r === 15 && !(mixer & 0x80)) return ~this.dip2 & 0xff;
    return this.ay.read();
  }

  private portOut(port: number, v: number): void {
    const p = port & 0xff;
    const reg = p & 3;
    switch (p & 0xfc) {
      case 0x40: return this.ppiOut(0, reg, v);
      case 0x44: return this.ppiOut(1, reg, v);
      case 0x48: return this.ppiOut(2, reg, v);
      case 0x4c: return this.ppiOut(3, reg, v);
      case 0x50: return this.ppiOut(4, reg, v);
      case 0x54:
        if (this.phoenix2) return;
        if (reg & 1) this.ay.write(v);
        else this.ay.selectAddress(v);
        return;
      case 0x58:
        if (this.phoenix2) return;
        if (reg === 1) { this.int0 = false; this.cpu.setIrqLine(0, false); }
        else if (reg === 2) { this.int1 = false; this.cpu.setIrqLine(1, false); }
        else if (reg === 3) this.ym.writeAddress(v);
        return;
      case 0x5c:
        if (!this.phoenix2) return this.ppiOut(5, reg, v);
        if (reg === 0) {
          const hi = port & 0xff00;
          if (hi === 0x2000) this.watchdog = WATCHDOG2;
          else if (hi === 0x1000) { this.sampleCommands++; this.oki.write(v); }
        }
        return;
      case 0xd8:
        if (p === 0xdb && !this.phoenix2) this.ym.writeData(v);
        return;
      default:
        return;
    }
  }

  private ppiOut(n: number, reg: number, v: number): void {
    const q = this.ppi[n];
    const b0 = q.eff(0), b1 = q.eff(1), b2 = q.eff(2);
    q.write(reg, v);
    const e0 = q.eff(0), e1 = q.eff(1), e2 = q.eff(2);
    const mode0 = reg === 3 && (v & 0xe4) === 0x80;
    const wA = reg === 0 || mode0;
    const wB = reg === 1 || mode0;
    const c0 = b0 ^ e0, c1 = b1 ^ e1, c2 = b2 ^ e2;
    switch (n) {
      case 0:
        if (c2 & 0xf) {
          this.flushLamps();
          this.column = e2 & 0xf;
          this.lampCount = 0;
          this.digitCount = 0;
        }
        if (this.phoenix2) { this.sampleBank = (e2 & 0x30) >> 4; this.oki.setBank(this.sampleBank); }
        if (wA && this.lampCount === 0) this.lampLo = e0;
        if (wB && this.lampCount === 0) { this.lampCount++; this.lampHi = e1; }
        return;
      case 1:
        if (c0) this.meterWrite(e0);
        if (c1) { this.bank(0x110, e1); this.triacWrite(e1); }
        if (c2) this.bank(0x100, e2);
        return;
      case 3:
        if (c0) { this.reelBank.step(0, e0 & 0xf); this.reelBank.step(1, e0 >> 4); }
        if (c1) { this.reelBank.step(2, e1 & 0xf); this.reelBank.step(3, e1 >> 4); }
        if (c2 && !this.phoenix2) this.portC4 = (this.portC4 & 0x0f) | (e2 << 4);
        return;
      case 4:
        if (this.phoenix2) {
          if (wA && this.digitCount === 0) { this.digitCount = 1; this.digitHi = e0; }
          if (wB && this.digitCount === 1) {
            this.digitCount = 2;
            this.digits[this.column] = this.column < 14 ? phoenix2Segments((this.digitHi << 8) | e1) : BITREV8[e1];
          }
          return;
        }
        if (wA && this.digitCount < 1) { this.digitCount++; this.digits[this.column] = e0; }
        if (c2) this.bank(0x108, e2);
        return;
      case 5:
        if (c0) { this.reelBank.step(4, e0 & 0xf); this.reelBank.step(5, e0 >> 4); }
        if (c1) { this.reelBank.step(6, e1 & 0xf); this.reelBank.step(7, e1 >> 4); }
        if (c2) this.portC4 = (this.portC4 & 0xf0) | (e2 & 0xf);
        return;
      default:
        return;
    }
  }

  private flushLamps(): void {
    const w = (this.lampHi << 8) | this.lampLo;
    const c = this.column;
    if (w === this.lampCache[c]) return;
    this.lampCache[c] = w;
    const base = c * 16;
    for (let i = 0; i < 16; i++) this.lamps[base + i] = (w >> i) & 1 ? 0xff : 0;
  }

  private bank(base: number, v: number): void {
    for (let i = 0; i < 8; i++) this.lamps[base + i] = (v >> i) & 1 ? 0xff : 0;
  }

  private meterWrite(v: number): void {
    const changed = v ^ this.meterLatch;
    for (let i = 0; i < 8; i++) {
      const bit = 1 << i;
      if (!(changed & bit)) continue;
      if (v & bit) { this.meterCount[i] = 5; this.meterHeld |= bit; }
      else { this.meterCount[i] = 0; this.meterHeld &= ~bit; }
    }
    this.meterRise = v & changed;
    this.meterLatch = v;
  }

  private meterTick(): void {
    for (let i = 0, held = this.meterHeld; held; i++, held >>= 1) {
      if (!(held & 1) || this.meterCount[i] === 0) continue;
      if (--this.meterCount[i] === 0) {
        this.meterHeld &= ~(1 << i);
        this.meters[i]++;
        this.gridTotals.in += this.meterInRaw[i] ?? 0;
        this.gridTotals.out += this.meterOutRaw[i] ?? 0;
        if (!this.booksMoney) continue;
        if (!this.wiredIn) {
          const p = this.meterInPence[i] ?? 0;
          if (i === this.tokenInMeter) this.ledger.tokenInPence += p;
          else this.ledger.inPence += p;
        }
        const q = this.meterOutPence[i] ?? 0;
        if (i === this.tokenOutMeter) this.ledger.tokenOutPence += q;
        else this.ledger.outPence += q;
      }
    }
  }

  private triacWrite(v: number): void {
    const rise = v & ~this.triacLatch;
    for (let i = 0; i < 8; i++) if (rise & (1 << i)) this.triacPulses[i]++;
    this.triacLatch = v;
  }

  private pakByte(b: number): void {
    this.dataPak.receive(b, this.cycles);
  }

  step(): number {
    const c = this.cpu.step();
    this.cycles += c;
    if (++this.execCount >= METER_TICK) { this.execCount = 0; this.meterTick(); }
    if (this.phoenix2) {
      this.oki.tick(c, CLOCK);
      this.toggleAcc += c;
      if (this.toggleAcc >= INT1_PERIOD) { this.toggleAcc -= INT1_PERIOD; this.toggle ^= 0x40; }
      if (this.watchdog > 0) {
        this.watchdog -= c;
        if (this.watchdog < 1) {
          this.watchdogResets++;
          this.reset();
          return c;
        }
      }
    } else {
      this.int0Acc += c;
      if (this.int0Acc >= INT0_PERIOD) {
        if (!this.int0) { this.int0 = true; this.cpu.setIrqLine(0, true); }
        this.int0Acc -= INT0_PERIOD;
      }
      this.int1Acc += c;
      if (this.int1Acc >= INT1_PERIOD) {
        if (!this.int1) { this.int1 = true; this.cpu.setIrqLine(1, true); }
        this.int1Acc -= INT1_PERIOD;
      }
      this.ay.tick(c, CLOCK);
      this.ym.tick(c, CLOCK);
    }
    if (this.coinTimer > 0) {
      this.coinTimer -= c;
      if (this.coinHeld && this.coinTimer <= this.coinReleaseAt) {
        this.matrix[this.coinRow] &= ~this.coinMask;
        this.coinHeld = false;
      }
      if (this.coinTimer <= 0) {
        this.coinTimer = 0;
        if (this.coinNext) {
          const code = this.coinNext & 0xfff;
          this.coinNext >>>= 12;
          this.pressCoin(code);
        }
      }
    }
    if (this.judging) this.judgeCoinStep(c);
    return c;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  get parts(): BoardPart[] {
    const p2 = this.phoenix2;
    const list: BoardPart[] = [
      { id: 'lamps', label: 'LAMPS', part: '16x16 strobe on PPI 1 + mirrors', device: this.lamps },
      { id: 'sevenseg', label: p2 ? '16-SEG' : '7-SEG', part: 'one digit per strobe column, PPI 5', device: this.digits },
      { id: 'meters', label: 'METERS', part: 'pulse counts - PPI 2 A', device: this.meters },
      { id: 'switches', label: 'SWITCHES', part: 'switch rows on PPI 3/4/5 + DIPs', device: this.matrix },
      { id: 'coins', label: 'COIN INPUTS', part: 'coin row 0', modelled: true,
        note: 'v20 coin notes: a CoinNoteId (its raw pattern into row 0, or one line) or $100 | line.' },
      { id: 'serial', label: 'ASCI', part: 'Z180 ASCI 1 - DataPak', device: this.dataPak },
      { id: 'ram', label: 'BATTERY RAM', part: '8K at $E000', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: '56K from $0000', device: this.rom },
      { id: 'cpu', label: 'CPU', part: 'HD64180 (Z80180) - 6.144 MHz', device: this.cpu, cpu: true },
      { id: 'reels', label: 'REELS', part: '8 channels, PPI 4/8', device: this.reelBank.state },
      p2
        ? { id: 'sound', label: 'SOUND', part: 'OKI MSM6295 - OUT ($5C), B = $10; bank PPI 1 C4-5', device: this.oki }
        : { id: 'sound', label: 'SOUND', part: 'AY-3-8910 + YM2413', device: this.ay },
    ];
    return list;
  }

  layoutLamp(n: number): boolean { return n >= 0 && n < LAMP_COUNT && this.lamps[n] !== 0; }
  layoutLampLevel(n: number): number { return n >= 0 && n < LAMP_COUNT ? this.lamps[n] : 0; }
  layoutDigit(n: number): number { return n >= 0 ? this.digits[n & 15] : 0; }

  layoutInput(id: number, on: boolean): void {
    if (id >= Phoenix.DIL_ID_BASE && id < Phoenix.DIL_ID_BASE + (this.phoenix2 ? 8 : 16)) {
      const n = id - Phoenix.DIL_ID_BASE;
      const mask = 1 << (n & 7);
      const raise = (v: number): number => (on ? v | mask : v & ~mask & 0xff);
      if (n < 8) this.dip1 = raise(this.dip1);
      else this.dip2 = raise(this.dip2);
      return;
    }
    const row = id >> 3;
    if (id < 0 || row >= this.matrix.length) return;
    if (on) this.matrix[row] |= 1 << (id & 7);
    else this.matrix[row] &= ~(1 << (id & 7));
  }

  insertCoin(id: number): void {
    if (this.coinTimer > 0 || this.coinNext) return;
    let raw: number;
    if (id >= 0x100 && id < 0x180) raw = id;
    else if (coinReachesRow(id)) raw = COIN_RAW[id];
    else return;
    const coins = this.coinsInForce();
    if (coins) {
      const reads = phxReadLines(coins);
      if (![...reads].some((l) => phxIdHits(id, l))) { this.coinsRefused++; return; }
    }
    this.coinNext = raw >>> 12;
    this.pressCoin(raw & 0xfff);
    if (this.wiring && coins) this.pend(id);
  }

  private pressCoin(code: number): void {
    const line = (code & 0x100) !== 0;
    this.coinRow = line ? (code & 0x78) >> 3 : 0;
    this.coinMask = line ? 1 << (code & 7) : code & 0xff;
    if (this.coinRow >= this.matrix.length || !this.coinMask) { this.coinTimer = 0; this.coinNext = 0; return; }
    const after = this.coinNext ? COIN_TAIL : COIN_GAP;
    this.coinTimer = (line ? COIN_HOLD_LINE : COIN_HOLD) + COIN_TAIL + after;
    this.coinReleaseAt = after;
    this.coinHeld = true;
    this.matrix[this.coinRow] |= this.coinMask;
  }
  private coinTimer = 0;
  private coinRow = 0;
  private coinMask = 0;
  private coinNext = 0;
  private coinHeld = false;
  private coinReleaseAt = 0;
  get coinBusy(): boolean { return this.coinTimer > 0 || this.coinNext !== 0; }

  private coinCodeCache: PhxCoinCode | Refusal | null = null;
  private coinCodeFound(): PhxCoinCode | Refusal {
    return (this.coinCodeCache ??= locatePhoenixCoins(this.rom, this.phoenix2));
  }
  private coinCode(): PhxCoinCode | null {
    const c = this.coinCodeFound();
    return 'refused' in c ? null : c;
  }

  private coinsInForce(): PhxCoin[] | null {
    const code = this.coinCode();
    if (!code) return null;
    if (this.coinsCache) return this.coinsCache;
    const c = phoenixCoins(code, this.rom, this.ram, this.cpu.sp);
    if ('refused' in c) return null;
    if (code.shape === 'inline' && c.every((x) => x.value > 0)) this.coinsCache = c;
    return c;
  }
  private coinsCache: PhxCoin[] | null = null;

  get coinLineTable(): CoinLineTable | null {
    const code = this.coinCode();
    const coins = this.coinsInForce();
    return code && coins ? phxCoinTable(code, coins, this.drawnCoins) : null;
  }

  get coinLineTableRefusal(): string | null {
    const c = this.coinCodeFound();
    if ('refused' in c) return c.refused;
    const coins = phoenixCoins(c, this.rom, this.ram, this.cpu.sp);
    return 'refused' in coins ? coins.refused : null;
  }

  private priced(): Map<number, SlotCoin> | null {
    const t = this.coinLineTable;
    if (!t) return null;
    const c = detectCoins(t);
    return c instanceof Map ? c : null;
  }

  get coinChutes(): readonly CoinChute[] | undefined {
    const coins = this.priced();
    if (!coins) return undefined;
    const label = (p: number): string => (p >= 100 ? `£${p % 100 ? (p / 100).toFixed(2) : p / 100}` : `${p}p`);
    return [...coins].map(([bit, coin]): CoinChute => (typeof coin === 'number'
      ? { label: label(coin), bit, pence: coin }
      : { label: coin.token === null ? 'Token' : `${label(coin.token)} token`, bit, pence: coin.token, token: true }))
      .sort((a, b) => (b.pence ?? -1) - (a.pence ?? -1) || a.bit - b.bit);
  }

  coinsRefused = 0;

  private static readonly JUDGE_WAIT = Math.round(1.5 * CLOCK);
  private readonly judgeId = new Array<number>(4).fill(-1);
  private readonly judgeWait = new Array<number>(4).fill(0);
  private judging = false;

  private pend(id: number): void {
    const k = this.judgeId.indexOf(-1);
    if (k < 0) { this.coinsRefused++; return; }
    this.judgeId[k] = id;
    this.judgeWait[k] = Phoenix.JUDGE_WAIT;
    this.judging = true;
  }

  private pendingFor(coins: readonly PhxCoin[], c: PhxCoin): number {
    let k = -1;
    for (let i = 0; i < this.judgeId.length; i++) {
      const id = this.judgeId[i]!;
      if (id < 0 || phxCoinOf(coins, id) !== c) continue;
      if (k < 0 || this.judgeWait[i]! < this.judgeWait[k]!) k = i;
    }
    return k;
  }

  private judgeCoinStep(cycles: number): void {
    const code = this.coinCode();
    if (!code || !this.wiring) { this.judgeId.fill(-1); this.judgeWait.fill(0); this.judging = false; return; }
    const pc = this.cpu.pc;
    if (pc === code.take || code.noCredit.includes(pc)) {
      const coins = this.coinsInForce();
      let c: PhxCoin | undefined;
      if (coins && code.shape === 'inline') {
        const token = this.cpu.hl !== code.cashCounter;
        const hit = coins.filter((x) => x.value === this.cpu.a && x.token === token);
        c = hit.length === 1 ? hit[0] : undefined;
      } else if (coins) {
        c = coins.find((x) => x.record === this.cpu.ix);
      }
      if (c && coins) {
        const k = this.pendingFor(coins, c);
        const credited = pc === code.take && c.value > 0;
        if (k >= 0) {
          if (credited) this.bookTaken(this.judgeId[k]!, c, code);
          this.judgeId[k] = -1;
          this.judgeWait[k] = 0;
        } else if (credited) {
          this.bookTaken(-1, c, code);
        }
      }
    }
    let any = false;
    for (let k = 0; k < this.judgeId.length; k++) {
      if (this.judgeId[k]! < 0) continue;
      this.judgeWait[k] = this.judgeWait[k]! - cycles;
      if (this.judgeWait[k]! <= 0) {
        this.coinsRefused++;
        this.judgeId[k] = -1;
        this.judgeWait[k] = 0;
        continue;
      }
      any = true;
    }
    this.judging = any;
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

  private get wiredIn(): boolean {
    return !!this.wiring && this.coinCode() !== null;
  }

  private bookTaken(id: number, c: PhxCoin, code: PhxCoinCode): void {
    const w = this.wiring!;
    if (!this.booksMoney || (id >= 0 && w.conflicts.includes(id))) return;
    const pence = c.value * code.unit;
    const taken: SlotCoin = c.token ? { token: pence } : pence;
    const coins = this.coinsInForce() ?? [];
    const line = this.coinLineTable?.lines.find((l) => phxCoinOf(coins, l.line)?.line === c.line)?.line;
    const wired = (id >= 0 ? w.coins.get(id) : undefined) ?? (line === undefined ? undefined : w.coins.get(line));
    if (wired === undefined) { this.bookCoin(taken); return; }
    const agrees = typeof wired === 'number'
      ? !c.token && wired === pence
      : c.token && (wired.token === null || wired.token === pence);
    this.wiringState.state = agrees ? 'calibrated' : 'disagrees';
    if (agrees) this.bookCoin(wired);
  }

  private bookCoin(c: SlotCoin): void {
    if (typeof c === 'number') this.ledger.inPence += c;
    else if (c.token === null) this.ledger.unpricedTokenIn++;
    else this.ledger.tokenInPence += c.token;
  }

  private coinSlots: number[] = [];
  private drawnCoins: number[] = [];

  setLayoutCoins(list: readonly DeclaredCoin[]): void {
    const slots = new Set<number>();
    const drawn = new Set<number>();
    for (const c of list) {
      if (c.named?.name.startsWith('ccTalk') || c.named?.name.startsWith('NV')) continue;
      const id = phxSlotId(c);
      drawn.add(id);
      if (c.pence === null) slots.add(id);
    }
    this.coinSlots = [...slots].sort((a, b) => a - b);
    this.drawnCoins = [...drawn].sort((a, b) => a - b);
  }

  get unnamedCoinLines(): readonly number[] {
    return this.coinSlots;
  }

  private meterInRaw: number[] = [];
  private meterOutRaw: number[] = [];
  private readonly gridTotals = { in: 0, out: 0 };

  get meterTotals(): { in: number; out: number } {
    return { in: this.gridTotals.in, out: this.gridTotals.out };
  }
}
