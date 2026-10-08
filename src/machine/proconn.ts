import type { Machine, MachineDisplay, CabinetSwitch, CashLedger, CoinChute, CoinWiringStatus, DigitKind } from './machine';
import { newCashLedger, ledgerOutMults, dilSwitchLabel } from './machine';
import { detectCoins, linesOf, wiringKey, wiringStateFor, type CoinLineTable, type CoinWiring, type Refusal, type SlotCoin, type StepState } from './coinwiring';
import type { DeclaredCoin } from './layoutcoins';
import { locateProconnCoins, proconnCoinOf, proconnCoinTable, proconnRowPattern, type ProconnCoinCode } from './proconncoins';
import { V20Reels } from './v20reels';
import { Z80, type Z80Io } from '../cpu/z80';
import { Z80Ctc } from '../hw/z80ctc';
import { Z80Pio } from '../hw/z80pio';
import { Z80DaisyChain } from '../hw/z80daisy';
import { Ay8910 } from '../hw/ay8910';
import { Upd7759, UPD7759_RATE } from '../hw/upd7759';
import { Mixer } from '../hw/mixer';
import { Hopper, v20Waveform } from '../hw/hopper';
import { S16lf01 } from '../hw/s16lf01';
import { DataPak } from '../hw/datapak';
import { COIN_RAW } from './coinraw';
import type { ReelGeometry } from './layoutreels';
import type { LayoutSwitch } from './layoutswitches';
import type { BoardPart } from './parts';
import { noteRomCut } from './boarddefaults';
import { CurveMux } from '../hw/curvemux';
import { MeterConfirm } from '../hw/meterconfirm';

const CLOCK = 3_686_400;
const AY_CLOCK = CLOCK / 2;
const ROM_TOP = 0xf000;
const RAM_SIZE = 0x800;
const LAMP_COUNT = 256;
const DIGIT_COUNT = 16;
const REEL_COUNT = 5;
export const PROCONN_REEL_ADJUST = 1;
const REEL_SETTLE = 1000;
const DATAPAK_TURNAROUND = 50_000;
const METER_UNIT_PENCE = 10;
const METER_TICK_INSTRUCTIONS = 50 * 20 * 2;

const PC90_PATTERN = [6, 3, 12, 9];
const REEL5_PATTERN = [0, 1, 4, 5, 2, 3, 6, 7, 8, 9, 12, 13, 10, 11, 14, 15];
const COIN_ROW = 6;
const COIN_HOLD = Math.round(0.1 * CLOCK);
const COIN_HOLD_LINE = Math.round(0.07 * CLOCK);
const COIN_TAIL = Math.round(0.005 * CLOCK);
const COIN_GAP = Math.round(0.1 * CLOCK);
const coinReachesRow = (id: number): boolean =>
  id >= 0 && id < COIN_RAW.length && !(id >= 0x1e && id <= 0x20) && !(id >= 0x27 && id <= 0x32);

export const enum ProconnType { PC92 = 0, PC90 = 1, PCPlus = 2 }

class ProconnSio {
  private readonly rx: number[][] = [[], []];
  private readonly ptr = [0, 0];
  readonly wr = [new Uint8Array(8), new Uint8Array(8)];
  lines = 0;
  readonly tx: number[][] = [[], []];

  reset(): void {
    this.ptr[0] = this.ptr[1] = 0;
    this.wr[0].fill(0);
    this.wr[1].fill(0);
    this.tx[0].length = this.tx[1].length = 0;
    this.rx[0].length = this.rx[1].length = 0;
  }

  receive(ch: number, v: number): void {
    if (this.rx[ch].length < 3) this.rx[ch].push(v & 0xff);
  }

  private rr0(ch: number): number {
    const dcd = ch ? (this.lines >> 2) & 1 : this.lines & 1;
    const cts = ch ? (this.lines >> 3) & 1 : (this.lines >> 1) & 1;
    return (this.rx[ch].length ? 1 : 0) | 0x04 | (dcd << 3) | (cts << 5);
  }

  controlWrite(ch: number, v: number): void {
    const p = this.ptr[ch];
    if (p === 0) {
      this.ptr[ch] = v & 7;
      if (((v >> 3) & 7) === 3) { this.wr[ch].fill(0); this.ptr[ch] = 0; }
    } else {
      this.wr[ch][p] = v;
      this.ptr[ch] = 0;
    }
  }

  controlRead(ch: number): number {
    const p = this.ptr[ch];
    this.ptr[ch] = 0;
    if (p === 0) return this.rr0(ch);
    if (p === 1) return 0x01;
    if (p === 2) return this.wr[1][2];
    return 0;
  }

  dataWrite(ch: number, v: number): void {
    const q = this.tx[ch];
    q.push(v);
    if (q.length > 256) q.shift();
  }

  dataRead(ch: number): number { return this.rx[ch].shift() ?? 0; }
}

class ProconnLcd {
  readonly cells = new Uint8Array(80).fill(0x20);
  private cursor = 0;
  private escape = false;
  private escCmd = 0;
  private args = 0;

  reset(): void {
    this.cells.fill(0x20);
    this.cursor = 0;
    this.escape = false;
    this.escCmd = 0;
    this.args = 0;
  }

  write(b: number): void {
    if (this.args) {
      if (--this.args === 0 && this.escCmd === 0x48) this.cursor = b % 80;
      return;
    }
    if (this.escape) {
      this.escape = false;
      this.escCmd = b;
      if (b === 0x48) this.args = 1;
      else if (b === 0x49) this.reset();
      return;
    }
    switch (b) {
      case 0x08: this.cursor = this.cursor ? this.cursor - 1 : 79; return;
      case 0x0c: this.cursor = 0; return;
      case 0x0e: this.cells.fill(0x20); return;
      case 0x1b: this.escape = true; return;
      case 0x09: case 0x0a: case 0x0d: case 0x11: case 0x12:
      case 0x15: case 0x16: case 0x18: case 0x19:
        return;
      default:
        this.cells[this.cursor] = b;
        this.cursor = (this.cursor + 1) % 80;
    }
  }

  text(): string {
    return String.fromCharCode(...this.cells);
  }
}

export class Proconn implements Machine {
  static readonly snapshotConfig: readonly string[] = ['switches', 'card', 'sampleBankBlock', 'coinCodeCache', 'coinSlots', 'drawnCoins', 'wiring', 'meterInRaw', 'meterOutRaw', 'tokenOutAt'];

  readonly digitKind: DigitKind = 'proconn';
  readonly clockHz = CLOCK;
  readonly reelsByLayoutNumber = true;

  protected readonly cpu: Z80;
  readonly ctc = new Z80Ctc();
  readonly pio: Z80Pio[];
  private readonly chain: Z80DaisyChain;
  readonly sio = new ProconnSio();
  readonly lcd = new ProconnLcd();
  readonly dataPak = new DataPak(CLOCK);
  private dataPakOut: number[] = [];
  private dataPakWait = 0;
  private protocol = 0;
  private readonly ay = new Ay8910(AY_CLOCK, 'ay8910', UPD7759_RATE);
  readonly upd = new Upd7759();
  static readonly HOPPER_WAVEFORM = v20Waveform((0xe60 / CLOCK) * 1000, { beam: 0x1e + 1, gap: 0xaa, start: 200, settle: 1 });

  readonly hoppers = [new Hopper(CLOCK, Proconn.HOPPER_WAVEFORM), new Hopper(CLOCK, Proconn.HOPPER_WAVEFORM)];

  private readonly mixer = new Mixer([this.upd, this.ay]);
  private sampleLatch = 0;
  private readonly sampleBankBlock = Int8Array.from([0, -1, -1, -1, -1, -1, -1, -1]);
  readonly vfd = new S16lf01();

  readonly rom = new Uint8Array(ROM_TOP);
  readonly ram = new Uint8Array(RAM_SIZE);

  readonly lamps = new Uint8Array(LAMP_COUNT);
  private readonly mux = new CurveMux(this.lamps, 8);
  readonly digits = new Uint16Array(DIGIT_COUNT);
  readonly meters = new Uint32Array(8);
  private readonly meterBank = new MeterConfirm();
  readonly triacPulses = new Uint32Array(8);
  get triacLevels(): number {
    return this.triacs & 0x7f;
  }

  private readonly reelBank = new V20Reels(REEL_COUNT);
  get reels() { return this.reelBank.reels; }
  get display(): MachineDisplay { return this.vfd; }
  get audioSource(): Mixer { return this.mixer; }

  protected readonly matrix = new Uint8Array(13);
  protected switches: LayoutSwitch[] = [];
  private dip1 = 0;
  private type: ProconnType = ProconnType.PC92;
  private displayType = 0;
  private hopperBits = 0x50;
  private readonly card = new Uint8Array(4);

  private strobe = 0;
  private settle = 0;
  private readonly settleLast = new Uint8Array(4);
  private ayPortA = 0;
  get meterLevels(): number { return this.ayPortA & 0xff; }
  private ayPortB = 0;
  private triacs = 0;
  private cycles = 0;
  readonly ctcModes = new Set<number>();
  highRamAccesses = 0;

  constructor(roms: readonly Uint8Array[], nvram?: Uint8Array) {
    let off = 0;
    for (const r of roms) {
      if (off >= ROM_TOP) break;
      this.rom.set(r.subarray(0, ROM_TOP - off), off);
      off += r.length;
    }
    noteRomCut(this, roms.reduce((n, r) => n + r.length, 0), 0x10000);
    if (nvram) this.ram.set(nvram.subarray(0, RAM_SIZE));
    this.pio = [0, 1, 2, 3, 4].map((n) => new Z80Pio({
      inA: () => this.pioInput(n, 0),
      inB: () => this.pioInput(n, 1),
    }));
    this.chain = new Z80DaisyChain([this.ctc]);
    const io: Z80Io = { in: (p) => this.portIn(p), out: (p, v) => this.portOut(p, v) };
    this.cpu = new Z80({ read8: (a) => this.read(a), write8: (a, v) => this.write(a, v) }, io, {
      irqAck: () => this.chain.ack(),
      reti: () => this.chain.reti(),
    });
  }

  setReelGeometry(geometry: readonly ReelGeometry[]): void { this.reelBank.setGeometry(geometry); }

  get reelStandIns(): readonly number[] { return this.reelBank.standIns; }

  setReelPosition(i: number, pos: number): void {
    this.reelBank.setPosition(i, pos);
  }

  loadSound(roms: readonly Uint8Array[], sampledSound?: number): void {
    const total = roms.reduce((n, r) => n + r.length, 0);
    const all = new Uint8Array(total);
    let off = 0;
    for (const r of roms) { all.set(r, off); off += r.length; }
    this.upd.loadRom(all);
    const blocks = (total + 0x1ffff) >>> 17;
    const stride = sampledSound !== 2 && blocks === 2 && roms.length === 2 ? 4 : 1;
    this.sampleBankBlock.fill(-1);
    for (let b = 0; b < blocks && b * stride < 8; b++) this.sampleBankBlock[b * stride] = b;
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

  setDips(d1: number): void { this.dip1 = d1 & 0xff; }

  setConfig(c: {
    type?: number; displayType?: number; hopperBits?: number; card?: Uint8Array; protocol?: number;
  }): void {
    if (c.protocol !== undefined) this.protocol = c.protocol;
    if (c.type !== undefined) this.type = c.type === 1 || c.type === 2 ? c.type : ProconnType.PC92;
    if (c.displayType !== undefined) this.displayType = c.displayType === 1 ? 1 : 0;
    if (c.hopperBits !== undefined) this.hopperBits = c.hopperBits & 0xff;
    if (c.card) this.card.set(c.card.subarray(0, 4));
  }

  setSwitches(sw: LayoutSwitch[]): void {
    this.switches = sw;
    for (const s of sw) if (s.closed) this.layoutInput(s.number, true);
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    if (id < 0 || id >= Proconn.DIL_ID_BASE) return;
    this.layoutInput(id, made);
    if (this.switches.length && !this.switches.some((s) => s.number === id)) {
      this.switches = [...this.switches, { number: id, label, closed: made }];
    }
  }

  private dilLabels: readonly string[] | null = null;
  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  private static readonly DIL_ID_BASE = 128;

  get switchPanel(): CabinetSwitch[] {
    const rows: CabinetSwitch[] = this.switches.map((s) => ({
      id: s.number, label: s.label,
      on: s.number >> 3 < this.matrix.length && ((this.matrix[s.number >> 3] >> (s.number & 7)) & 1) === 1,
    }));
    for (let i = 0; i < 8; i++) {
      rows.push({
        id: Proconn.DIL_ID_BASE + i,
        label: dilSwitchLabel(`DIL SW ${i + 1}`, this.dilLabels?.[i]),
        on: (this.dip1 & (1 << i)) !== 0,
        group: 'DIL switches',
        option: true,
        bootOnly: true,
      });
    }
    return rows;
  }

  powerCycle(): void {
    this.reset();
  }

  reset(): void {
    this.cpu.reset();
    this.ctc.reset();
    for (const p of this.pio) p.reset();
    this.sio.reset();
    this.lcd.reset();
    this.dataPak.reset();
    this.dataPakOut = [];
    this.dataPakWait = 0;
    this.ay.reset();
    this.upd.reset();
    this.hoppers[0].reset();
    this.hoppers[1].reset();
    this.sampleLatch = 0;
    this.vfd.reset();
    this.strobe = 0;
    this.settle = 0;
    this.settleLast.fill(0);
    this.ayPortA = this.ayPortB = 0;
    this.meterBank.reset();
    this.triacs = 0;
    this.lamps.fill(0);
    this.mux.reset();
    this.digits.fill(0);
    this.segCount = 0;
    this.segDigit = -1;
    this.cycles = 0;
    this.coinTimer = 0;
    this.coinMask = 0;
    this.judgeId.fill(-1);
    this.judgeWait.fill(0);
    this.judging = false;
    this.creditCode = -1;
    this.seqArmed = false;
    this.seqState = this.seqTimer = 0;
  }

  private read(a: number): number {
    if (a < ROM_TOP) return this.rom[a];
    if (a >= 0xf800) this.highRamAccesses++;
    return this.ram[a & (RAM_SIZE - 1)];
  }

  private write(a: number, v: number): void {
    if (a < ROM_TOP) return;
    if (a >= 0xf800) this.highRamAccesses++;
    this.ram[a & (RAM_SIZE - 1)] = v;
  }

  private portIn(port: number): number {
    const p = port ^ 0xff;
    const b = (p >> 9) & 1;
    const ctl = (p >> 8) & 1;
    const sel = (p & 0xf8) >> 3;
    const n = this.pioIndex(sel);
    if (n >= 0) return ctl ? this.pio[n].controlRead() : this.pio[n].dataRead(b);
    if (sel !== 0) return 0xff;
    switch (p & 7) {
      case 0:
        this.sio.lines = this.matrix[12] & 0x0f;
        return ctl ? this.sio.controlRead(b) : this.sio.dataRead(b);
      case 1: return this.ctc.read(b | (ctl << 1));
      case 4: return this.ayRead();
      case 5: return this.cardRead(port);
      case 6: return 0xfb;
      default: return 0xff;
    }
  }

  private portOut(port: number, v: number): void {
    const p = port ^ 0xff;
    const b = (p >> 9) & 1;
    const ctl = (p >> 8) & 1;
    const sel = (p & 0xf8) >> 3;
    const n = this.pioIndex(sel);
    if (n >= 0) {
      const pio = this.pio[n];
      const oldA = pio.ports[0].output;
      const oldB = pio.ports[1].output;
      if (ctl) pio.controlWrite(b, v);
      else pio.dataWrite(b, v);
      this.pioWritten(n, pio.ports[0].output ^ oldA, pio.ports[1].output ^ oldB, ctl ? -1 : b);
      return;
    }
    if (sel !== 0) return;
    switch (p & 7) {
      case 0:
        this.sio.lines = this.matrix[12] & 0x0f;
        if (ctl) this.sio.controlWrite(b, v);
        else {
          this.sio.dataWrite(b, v);
          if (b === 1) this.lcd.write(v);
          if (b === 0) {
            const reply = this.dataPak.receive(v, this.cycles);
            if (reply && this.protocol === 1) {
              if (!this.dataPakOut.length) this.dataPakWait = DATAPAK_TURNAROUND;
              this.dataPakOut.push(...reply);
            }
          }
        }
        return;
      case 1: {
        const ch = b | (ctl << 1);
        if (v & 1) this.ctcModes.add(v & 0xf8);
        this.ctc.write(ch, v);
        return;
      }
      case 2: this.ay.selectAddress(v); return;
      case 3: this.ayWrite(v); return;
      case 5: this.sampleWrite(v); return;
      case 6:
        if (this.displayType === 0) this.vfd.por((port >> 10) & 1);
        return;
      default: return;
    }
  }

  private pioIndex(sel: number): number {
    switch (sel) {
      case 0x10: return 0;
      case 0x08: return 1;
      case 0x04: return 2;
      case 0x02: return 3;
      case 0x01: return 4;
      default: return -1;
    }
  }

  private pioInput(n: number, ab: number): number {
    const inv = ~this.reelBank.optos & 0xff;
    const m = this.matrix;
    switch (n) {
      case 0:
        if (ab) return m[9];
        {
          let v = 0;
          for (let i = 0; i < 6; i++) {
            const row = i < 5 ? m[i] : this.dip1;
            if (!((row >> this.strobe) & 1)) v |= 1 << (5 - i);
          }
          if (this.type === ProconnType.PC92 && (this.strobe & 1)) v |= 0x80;
          return v;
        }
      case 1:
        if (ab) return 0;
        return (this.hopperFitted(2) ? (this.hoppers[1].opto ? 1 : 0) : (inv & 0x10) >> 4) | m[8];
      case 2:
        if (ab) return ~m[6] & 0xff;
        {
          const v = this.type === ProconnType.PC92
            ? (this.upd.busy() ? 8 : 0) | ((inv & 0x0f) << 4)
            : (inv & 0x0f) << 3;
          return (v ^ m[10]) & 0xff;
        }
      case 3:
        if (ab) return 0;
        return this.hopperFitted(1) ? (this.hoppers[0].opto ? 2 : 0) : m[7];
      default:
        return 0;
    }
  }

  private hopperFitted(h: number): boolean {
    return !(this.hopperBits & (h === 1 ? 0x40 : 0x10));
  }

  private cardRead(port: number): number {
    const n = (port >> 12) & 0xf;
    if (n >= 8) return 0xff;
    const byte = this.card[n >> 1];
    const f = n & 1 ? (byte >> 4) & 7 : byte & 7;
    return ~f & 0xff;
  }

  private pioWritten(n: number, chA: number, chB: number, data: number): void {
    const pio = this.pio[n];
    const a = pio.ports[0].output;
    const bOut = pio.ports[1].output;
    switch (n) {
      case 0:
        if (this.type === ProconnType.PC90) this.drivePc90(bOut);
        else if (chB) this.settle = REEL_SETTLE;
        this.lamps[0x90] = bOut & 1 ? 0xff : 0;
        break;
      case 1:
        if (this.type === ProconnType.PC92 && chA) this.settle = REEL_SETTLE;
        if (data === 1) {
          if (this.displayType === 0) {
            this.vfd.por(1);
            this.vfd.data(!(bOut & 4));
            this.vfd.sclk(bOut & 8);
          }
        }
        break;
      case 2:
        if (data === 0) {
          this.strobe = a & 7;
          this.mux.strobe(this.strobe);
        }
        for (let i = 0; i < 8; i++) this.lamps[0x88 + i] = (bOut >> i) & 1 ? 0xff : 0;
        break;
      case 3:
        if (chA & 0x7f) {
          const t = a & 0x7f;
          for (let i = 0; i < 7; i++) if ((t & ~this.triacs) & (1 << i)) this.triacPulses[i]++;
          this.triacs = t;
        }
        for (let i = 0; i < 8; i++) this.lamps[0x80 + i] = (a >> i) & 1 ? 0xff : 0;
        if (data === 1) this.segWrite(this.strobe, bOut);
        break;
      case 4:
        if (data >= 0) this.mux.write(this.strobe, (bOut << 8) | a, -1, this.cycles);
        break;
    }
  }

  private segWrite(digit: number, v: number): void {
    if (digit !== this.segDigit) {
      if (this.segCount > 1 && this.segDigit >= 0) {
        let p = 0;
        for (let i = 0; i < this.segCount && !p; i++) p = this.segVals[i];
        this.digits[this.segDigit] = p;
      }
      this.segCount = 0;
      this.segDigit = digit;
    }
    if (this.segCount < 8) this.segVals[this.segCount++] = v;
  }
  private readonly segVals = new Uint8Array(8);
  private segCount = 0;
  private segDigit = -1;

  private ayRead(): number {
    return this.ay.read();
  }

  private meterConfirmed(i: number): void {
    this.meters[i]++;
    this.gridTotals.in += this.meterInRaw[i] ?? 0;
    this.gridTotals.out += this.meterOutRaw[i] ?? 0;
    if (!this.wiredIn) {
      const p = this.meterInPence[i] ?? 0;
      if (p && i === this.coinCode()?.tokenMeter) this.ledger.tokenInPence += p;
      else this.ledger.inPence += p;
    }
    const t = this.tokenOutPulses > 0 ? this.coinCode()?.tokenOut : null;
    if (t && i === t.meter) {
      const acc = this.ram[t.acc & (RAM_SIZE - 1)]! | (this.ram[(t.acc + 1) & (RAM_SIZE - 1)]! << 8);
      this.tokenOutPulses = Math.min(this.tokenOutPulses, acc + 1);
    }
    if (t && i === t.meter && this.tokenOutPulses > 0) {
      this.tokenOutPulses--;
      if (++this.tokenOutPart >= t.counts) {
        this.tokenOutPart = 0;
        const pence = this.coinCode()!.pence ? t.value : t.value * METER_UNIT_PENCE;
        if (this.booksMoney) {
          if (pence > 0) this.ledger.tokenOutPence += pence;
          else this.ledger.unpricedTokenOut++;
        }
      }
      return;
    }
    if (this.booksMoney) this.ledger.outPence += this.meterOutPence[i] ?? 0;
  }

  private tokenOutPulses = 0;
  private tokenOutPart = 0;
  private tokenOutAt: number | null = null;
  private lastPc = -1;

  private tokenOutStep(pc: number): void {
    const at = this.tokenOutAt ??= this.coinCode()?.tokenOut?.at ?? -1;
    if (at >= 0 && this.lastPc === at && pc === at + 3) {
      const code = this.coinCode()!;
      const t = code.tokenOut!;
      const r = this.ram[code.route & (RAM_SIZE - 1)]!;
      if ((r & 0x70) === 0x40 && (r & 0x0f) === t.code) this.tokenOutPulses += t.counts;
    }
    this.lastPc = pc;
  }

  private ayWrite(v: number): void {
    const r = this.ay.selectedAddress;
    this.ay.write(v);
    const r7 = this.ay.regs[7];
    if (r === 0x0e && (r7 & 0x40)) {
      if (v !== this.ayPortA) this.meterBank.write(v & 0xff);
      this.ayPortA = v;
    } else if (r === 0x0f && (r7 & 0x80)) {
      const ch = this.ayPortB ^ v;
      this.ayPortB = v;
      if (ch & 0x04) this.hoppers[0].motorDrive(this.hopperFitted(1) && (v & 0x04) !== 0);
      if (ch & 0x08) this.hoppers[1].motorDrive(this.hopperFitted(2) && (v & 0x08) !== 0);
      if (ch & 0xf0) {
        this.reelBank.step(4, REEL5_PATTERN[(v >> 4) & 0xf]);
      }
    }
  }

  private sampleWrite(v: number): void {
    const d = this.sampleLatch ^ v;
    this.sampleLatch = v;
    if (d & v & 0x80) this.upd.portW(v & 0x3f);
    if (d & 0x20) this.upd.setResetLine((v & 0x20) !== 0);
    if (d & 0x40) {
      if (v & 0x40) { this.upd.setStartLine(true); return; }
      const block = this.sampleBankBlock[(v & 3) | ((v & 0x10) >> 2)];
      if (block >= 0) this.upd.setStartLine(false, block);
    }
  }

  private drivePc90(b: number): void {
    for (let k = 0; k < 4; k++) this.reelBank.step(k, PC90_PATTERN[(b >> (6 - 2 * k)) & 3]);
  }

  private applySettled(): void {
    const x = (this.pio[1].ports[0].output << 8) | this.pio[0].ports[1].output;
    for (let k = 0; k < 4; k++) {
      const c = ((x >> (2 * k)) & 3) | (((x >> (8 + 2 * k)) & 3) << 2);
      if (c && c !== this.settleLast[k]) {
        this.reelBank.step(3 - k, c);
        this.settleLast[k] = c;
      }
    }
  }

  step(): number {
    this.cpu.setIRQ(this.chain.irq);
    const c = this.cpu.step();
    this.cycles += c;
    const confirmed = this.meterBank.advance(1, METER_TICK_INSTRUCTIONS);
    if (confirmed) for (let i = 0; i < 8; i++) if (confirmed & (1 << i)) this.meterConfirmed(i);
    this.ctc.tick(c);
    this.ay.tick(c, CLOCK);
    this.upd.tick(c, CLOCK);
    this.hoppers[0].tick(c);
    this.hoppers[1].tick(c);
    if (this.settle > 0) {
      this.settle -= c;
      if (this.settle <= 0) { this.settle = 0; this.applySettled(); }
    }
    if (this.dataPakOut.length) {
      this.dataPakWait -= c;
      while (this.dataPakOut.length && this.dataPakWait <= 0) {
        this.sio.receive(0, this.dataPakOut.shift()!);
        this.dataPakWait += DATAPAK_TURNAROUND;
      }
    }
    this.coinSequencer(c);
    this.tokenOutStep(this.cpu.pc);
    if (this.judging) this.judgeCoinStep(c);
    if (this.coinTimer > 0) {
      const was = this.coinTimer;
      this.coinTimer -= c;
      if (was > COIN_GAP && this.coinTimer <= COIN_GAP && this.coinMask) {
        this.matrix[this.coinRow] &= ~this.coinMask;
        this.coinMask = 0;
      }
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
    return c;
  }

  private coinSequencer(c: number): void {
    const req = this.matrix[11] & 7;
    if (req === 0) {
      if (this.seqArmed) {
        this.seqArmed = false;
        if (this.seqState === 5) {
          this.matrix[8] |= 1;
          this.seqState = 0;
          this.lamps.fill(0, 0x91, 0x98);
        }
      }
    } else if (!this.seqArmed) {
      this.seqArmed = true;
      if (this.seqState === 0 && this.seqTimer < 1 && (this.pio[0].ports[1].output & 1)) {
        this.seqTimer = 1000;
        this.seqPhase = req === 1 ? 2_000_000 : req < 4 ? 500_000 : 100_000;
      }
    }
    if (this.seqTimer <= 0) return;
    this.seqTimer -= c;
    if (this.seqTimer >= 1) return;
    switch (this.seqState) {
      case 0: this.seqState = 1; this.seqTimer = this.seqPhase; this.matrix[8] &= 0xfe; break;
      case 1: this.seqState = 2; this.seqTimer = this.seqPhase; this.matrix[10] |= 0x80; break;
      case 2: this.seqState = 3; this.seqTimer = this.seqPhase; this.matrix[10] &= 0x7f; break;
      case 3: this.seqState = 4; this.seqTimer = this.seqPhase; this.matrix[8] |= 1; break;
      case 4:
        if (req === 0) {
          this.seqState = 0;
          this.lamps.fill(0, 0x91, 0x98);
        } else {
          this.seqState = 5;
          this.matrix[8] &= 0xfe;
        }
        break;
    }
    const s = Math.min(this.seqState, 4);
    if (s) for (let i = 0; i < 4; i++) this.lamps[0x91 + i] = i === s - 1 ? 0xff : 0;
  }
  private seqArmed = false;
  private seqState = 0;
  private seqTimer = 0;
  private seqPhase = 0;

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: 'LAMPS', part: '8 strobes x 16, PIO5', device: this.lamps },
      { id: 'sevenseg', label: '7-SEG', part: '8 digits, PIO4 B', device: this.digits },
      { id: 'vfd', label: 'VFD', part: '16 char, PIO2 B serial', device: this.vfd },
      { id: 'meters', label: 'METERS', part: 'pulse counts - AY port A', device: this.meters },
      { id: 'switches', label: 'SWITCHES', part: 'strobed matrix + DIP 1', device: this.matrix },
      { id: 'coins', label: 'COIN INPUTS', part: 'matrix lines', modelled: true,
        note: 'v20 coin notes as timed row-6 patterns (insertCoin); plus v20\'s coin-pulse sequencer.' },
      { id: 'ctc', label: 'CTC', part: 'Z80 CTC - IM 2 interrupts', device: this.ctc },
      { id: 'pio', label: 'PIO x5', part: 'Z80 PIO - reels, lamps, inputs', device: this.pio },
      { id: 'sio', label: 'SIO', part: 'Z80 SIO - DataPak / LCD (minimal)', device: this.sio },
      { id: 'ram', label: 'BATTERY RAM', part: '2K at $F000', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: 'to 60K from $0000', device: this.rom },
      { id: 'ay', label: 'SOUND', part: 'AY-3-8910 - meters, hoppers, reel 5', device: this.ay },
      { id: 'cpu', label: 'CPU', part: 'Z80 - 3.6864 MHz', device: this.cpu, cpu: true },
      { id: 'reels', label: '5 REELS', part: 'stepper, PIO1 B / PIO2 A / AY B', device: this.reelBank.state },
      { id: 'hopper', label: 'HOPPERS', part: 'two Compact Hoppers, AY port B', device: this.hoppers },
      { id: 'samples', label: 'SAMPLE SOUND', part: 'uPD7759, port FA', device: this.upd },
    ];
  }

  layoutLamp(n: number): boolean {
    return n >= 0 && n < LAMP_COUNT && this.lamps[n] !== 0;
  }

  layoutLampLevel(n: number): number {
    return n >= 0 && n < LAMP_COUNT ? this.lamps[n] : 0;
  }

  layoutDigit(n: number): number {
    if (n < 0) return 0;
    return n < 8 ? this.digits[7 - n] : this.digits[n & 15];
  }

  layoutInput(id: number, on: boolean): void {
    if (id >= Proconn.DIL_ID_BASE && id < Proconn.DIL_ID_BASE + 8) {
      const mask = 1 << (id - Proconn.DIL_ID_BASE);
      this.dip1 = on ? this.dip1 | mask : this.dip1 & ~mask & 0xff;
      return;
    }
    const row = id >> 3;
    if (id < 0 || row >= this.matrix.length) return;
    const b = id & 7;
    if (on) this.matrix[row] |= 1 << b;
    else this.matrix[row] &= ~(1 << b);
  }

  insertCoin(id: number): void {
    if (this.coinTimer > 0) return;
    let raw: number;
    if (id >= 0x100 && id < 0x180) raw = id;
    else if (coinReachesRow(id)) raw = COIN_RAW[id];
    else return;
    if (raw & 0x100) {
      this.coinRow = (raw & 0x78) >> 3;
      this.coinMask = 1 << (raw & 7);
      this.coinTimer = COIN_HOLD_LINE + COIN_TAIL + COIN_GAP;
    } else {
      this.coinRow = COIN_ROW;
      this.coinMask = raw & 0xff;
      this.coinTimer = COIN_HOLD + COIN_TAIL + COIN_GAP;
    }
    if (this.coinRow >= this.matrix.length || !this.coinMask) { this.coinTimer = 0; return; }
    this.matrix[this.coinRow] |= this.coinMask;
    if (this.wiring && this.coinCode()) this.pend(id);
  }
  private coinTimer = 0;
  private coinRow = COIN_ROW;
  private coinMask = 0;
  get coinBusy(): boolean { return this.coinTimer > 0; }

  private coinCodeCache: ProconnCoinCode | Refusal | null = null;
  private coinCodeFound(): ProconnCoinCode | Refusal {
    return (this.coinCodeCache ??= locateProconnCoins(this.rom));
  }
  private coinCode(): ProconnCoinCode | null {
    const c = this.coinCodeFound();
    return 'refused' in c ? null : c;
  }

  get coinLineTable(): CoinLineTable | null {
    const code = this.coinCode();
    return code ? proconnCoinTable(code, this.drawnCoins) : null;
  }

  get coinLineTableRefusal(): string | null {
    const c = this.coinCodeFound();
    return 'refused' in c ? c.refused : null;
  }

  private priced(): Map<number, SlotCoin> | null {
    const t = this.coinLineTable;
    if (!t) return null;
    const c = detectCoins(t);
    return c instanceof Map ? c : null;
  }

  private programLine(id: number): number | null {
    const code = this.coinCode();
    const t = this.coinLineTable;
    if (!code || !t) return null;
    const c = proconnCoinOf(code, id);
    if (!c) return null;
    return t.lines.find((l) => proconnCoinOf(code, l.line) === c)?.line ?? null;
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
  private readonly judgeId = new Array<number>(8).fill(-1);
  private readonly judgeWait = new Array<number>(8).fill(0);
  private judging = false;
  private creditCode = -1;

  private pend(id: number): void {
    const k = this.judgeId.indexOf(-1);
    if (k < 0) { this.coinsRefused++; return; }
    this.judgeId[k] = id;
    this.judgeWait[k] = Proconn.JUDGE_WAIT;
    this.judging = true;
  }

  private pendingFor(code: number): number {
    const c = this.coinCode();
    let best = -1;
    for (let k = 0; k < this.judgeId.length; k++) {
      const id = this.judgeId[k]!;
      if (id < 0 || !c || proconnCoinOf(c, id)?.code !== code) continue;
      if (best < 0 || this.judgeWait[k]! > this.judgeWait[best]!) best = k;
    }
    return best;
  }

  private judgeCoinStep(cycles: number): void {
    const code = this.coinCode();
    if (!code || !this.wiring) { this.judgeId.fill(-1); this.judgeWait.fill(0); this.judging = false; this.creditCode = -1; return; }
    const pc = this.cpu.pc;
    if (pc === code.credit.entry) this.creditCode = this.ram[code.route & (RAM_SIZE - 1)]! & 0x0f;
    else if (this.creditCode >= 0 && (pc === code.credit.at || pc === code.credit.exit)) {
      const k = this.pendingFor(this.creditCode);
      if (k >= 0) {
        if (pc === code.credit.at) this.bookTaken(this.judgeId[k]!);
        this.judgeId[k] = -1;
        this.judgeWait[k] = 0;
      }
      this.creditCode = -1;
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
    return !!this.wiring && (!this.booksMoney || this.coinCode() !== null);
  }

  private bookTaken(id: number): void {
    const w = this.wiring!;
    if (!this.booksMoney || w.conflicts.includes(id)) return;
    const line = this.programLine(id);
    const taken = line === null ? null : this.priced()?.get(line) ?? null;
    const c = w.coins.get(id) ?? (line === null ? undefined : w.coins.get(line));
    if (c === undefined) {
      if (taken) this.bookCoin(taken);
      return;
    }
    if (taken) {
      const agrees = typeof c === 'number'
        ? typeof taken === 'number' && taken === c
        : typeof taken === 'object' && (c.token === null || taken.token === null || c.token === taken.token);
      this.wiringState.state = agrees ? 'calibrated' : 'disagrees';
      if (!agrees) return;
    }
    this.bookCoin(c);
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
      const id = proconnSlotId(c);
      if (id === null) continue;
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

export function proconnSlotId(c: Pick<DeclaredCoin, 'line' | 'button' | 'note' | 'token'>): number | null {
  if (c.line !== null) return c.line;
  if (c.note !== null && c.note !== 0x47) return c.note;
  if (c.note === 0x47 && c.button !== null && c.button >= 0) return 0x100 | (c.button & 0x7f);
  return c.token ? null : 37;
}

export { proconnRowPattern };
