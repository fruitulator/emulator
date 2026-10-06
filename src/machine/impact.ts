import type { Bus16 } from '../cpu/bus68k';
import type { CabinetSwitch, Machine, DigitKind, NoteResult } from './machine';
import type { SlideEffect } from '../layout/fmlconfig';
import { newCashLedger, ledgerOutMults, dilSwitchLabel } from './machine';
import type { BoardPart } from './parts';
import { M68000 } from '../cpu/m68000';
import { Mc68681 } from '../hw/mc68681';
import { I8255 } from '../hw/i8255';
import { S16lf01 } from '../hw/s16lf01';
import { Reel } from '../hw/reel';
import { MODEL_RELATIONS, parkAtV20PowerUp, resetReelsInPlace } from './v20optic';
import { Upd7759 } from '../hw/upd7759';
import { Hopper, v20Waveform } from '../hw/hopper';
import { Sec } from '../hw/sec';
import { MeterConfirm } from '../hw/meterconfirm';
import { DataPak } from '../hw/datapak';
import { SspValidator, SSP_CHANNEL_PENCE } from '../hw/ssp';
import { fitReelBank, type ReelFit } from './reelfit';
import { noteRomCut } from './boarddefaults';
import { StrayCounter } from './strayaccess';
import { ROM_UNPLACED } from './pairplacer';
import { COIN_RAW } from './coinraw';
import type { LayoutSwitch } from './layoutswitches';
import { StatedLines } from './statedlines';
import { CurveMux } from '../hw/curvemux';

export const CPU_CLOCK = 8_000_000;
const DUART_CLOCK = 3_686_400;
const METER_TICK_CYCLES = 20 * 600;

const ROM_SIZE = 0x100000;
const RAM_BASE = 0x400000;
const RAM_SIZE = 0x4000;

const DUART_BASE = 0x480000;
const DUART_END = 0x480020;
const DUART2_BASE = 0x4801e0;
const DUART2_END = 0x480200;
const DUART2_IP_IDLE = 0x20;
const PORTS_BASE = 0x480020;
const PORTS_END = 0x480034;
const OPTOS_ADDR = 0x480040;
const PPI_BASE = 0x480060;
const PPI_END = 0x480068;
const UPD_BASE = 0x480080;
const UPD_END = 0x480086;
const LATCH_BASE = 0x4800a0;
const LATCH_END = 0x4800b0;
const LAMP_INTENSITY: readonly number[] = [
  0x5a, 0x65, 0x70, 0x7b, 0x86, 0x91, 0x9c, 0xa7, 0xb2, 0xbd, 0xc8, 0xd3, 0xde, 0xe9, 0xf4, 0xff,
];

const PORT_DSW = 0;
const PORT_PERCENT = 1;
const PORT_J10_0 = 2;
const PORT_COINS = 9;

const IDLE_PORTS = [0xff, 0x00, 0xd8, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];

const MATRIX_EXTRA = [13, 14, 11, 12] as const;

const COIN_DWELL = Math.floor(CPU_CLOCK * 0.04);

export interface IoAccess {
  addr: number;
  reads: number;
  writes: number;
}

export class Impact implements Bus16, Machine {
  static readonly snapshotConfig: readonly string[] = ['nvram'];
  readonly digitKind: DigitKind = 'impact';
  readonly cpu: M68000;
  readonly rom = new Uint8Array(ROM_SIZE);
  readonly ram = new Uint8Array(RAM_SIZE);
  private nvram: Uint8Array | null = null;

  readonly vfd = new S16lf01();

  payen = 0;
  private portA = 0;
  private payoutWord = 0;
  private slideState = 0;
  readonly slidePulses = new Uint32Array(4);
  private coinLeft = false;
  heldOutPulses = 0;
  private coinHasLeft(): boolean {
    if (!this.coinLeft && (this.hopper1.paid > 0 || this.hopper2.paid > 0)) this.coinLeft = true;
    return this.coinLeft;
  }
  get triacLevels(): number {
    return this.slideState & 0x0f;
  }
  private slidePence: SlideEffect[] = [null, null, null, null];
  static readonly HOPPER1_WAVEFORM = v20Waveform(1, { beam: 0x28, gap: 0x50 });
  static readonly HOPPER2_WAVEFORM = v20Waveform(1, { beam: 0x19, gap: 0x50 });

  private readonly hopper1 = new Hopper(CPU_CLOCK, Impact.HOPPER1_WAVEFORM);
  private readonly hopper2 = new Hopper(CPU_CLOCK, Impact.HOPPER2_WAVEFORM);

  readonly cashLedger = newCashLedger();
  private readonly meterState = [false, false, false, false, false, false, false, false];
  private readonly meterBank = new MeterConfirm();
  readonly meterCount = [0, 0, 0, 0, 0, 0, 0, 0];
  get meterLevels(): number {
    let v = 0;
    this.meterState.forEach((on, i) => { if (on) v |= 1 << i; });
    return v;
  }
  private readonly meterInMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private readonly meterOutMult = [0, 0, 0, 0, 0, 0, 0, 0];
  private meterLedgerMult = [0, 0, 0, 0, 0, 0, 0, 0];
  readonly meterTotals = { in: 0, out: 0 };

  readonly sec = new Sec();
  secFitted = false;
  private secInMult: number[] = [];
  private secOutMult: number[] = [];
  private secLedgerMult: number[] = [];
  readonly secTotals = { in: 0, out: 0 };
  private static readonly SEC_UNIT_PENCE = 10;

  readonly duart = new Mc68681({
    irqChanged: () => this.updateIrq(),
    txByte: (channel, v) => {
      this.queueSerial(channel, v);
      if (channel === 0) this.onDataPakTx(v);
      else if (this.duart.txBaud(1) === 9600) this.sspReceive(v);
    },
    outputPort: (opr) => this.opLampWrite(opr),
  });

  readonly duart2 = new Mc68681({ irqChanged: () => this.updateIrq() });

  private serialQueue: { ch: number; bytes: number[] }[] = [];
  private queueSerial(ch: number, v: number): void {
    const last = this.serialQueue[this.serialQueue.length - 1];
    if (last && last.ch === ch && last.bytes.length < 256) last.bytes.push(v);
    else if (this.serialQueue.length < 64) this.serialQueue.push({ ch, bytes: [v] });
  }

  drainSerial(): { ch: number; bytes: number[] }[] {
    if (!this.serialQueue.length) return this.serialQueue;
    const q = this.serialQueue;
    this.serialQueue = [];
    return q;
  }

  readonly dataPak = new DataPak(CPU_CLOCK);
  private dataPakType = 0;
  private dataPakOut: number[] = [];
  private dataPakWait = 0;
  private dataPakIn: { wait: number; b: number }[] = [];
  private static readonly DATAPAK_TURNAROUND = 50_000;

  fitDataPak(type: number): void {
    this.dataPakType = type;
  }

  private onDataPakTx(b: number): void {
    if (this.dataPakType === 0) return;
    const reply = this.dataPak.receive(b, this.cpu.cycles);
    if (this.dataPakType === 2) {
      this.dataPakOut.push(b);
      if (this.dataPakOut.length === 1) this.dataPakWait = Impact.DATAPAK_TURNAROUND;
      return;
    }
    if (!reply || this.dataPakType !== 1) return;
    if (this.dataPakOut.length === 0) this.dataPakWait = Impact.DATAPAK_TURNAROUND;
    this.dataPakOut.push(...reply);
  }

  private tickDataPak(cycles: number): void {
    if (!this.dataPakOut.length && !this.dataPakIn.length) return;
    let span = cycles;
    while (this.dataPakIn.length) {
      const head = this.dataPakIn[0];
      head.wait -= span;
      span = 0;
      if (head.wait > 0 || this.duart.rxSpace(0) === 0) break;
      this.duart.receive(0, head.b);
      this.dataPakIn.shift();
      if (this.dataPakIn.length) this.dataPakIn[0].wait += head.wait;
    }
    if (this.dataPakOut.length) {
      this.dataPakWait -= cycles;
      while (this.dataPakOut.length && this.dataPakWait <= 0) {
        const charCycles = Math.ceil(this.duart.characterTicks(0) * CPU_CLOCK / DUART_CLOCK);
        this.dataPakIn.push({ wait: charCycles + this.dataPakWait, b: this.dataPakOut.shift()! });
        this.dataPakWait += Impact.DATAPAK_TURNAROUND;
      }
    }
  }

  readonly ssp = new SspValidator();
  private sspIn: { wait: number; b: number }[] = [];
  private readonly sspLampState = new Uint8Array(8);

  private sspReceive(b: number): void {
    this.ssp.receive(b);
    if (this.ssp.lampsDirty) this.sspLamps();
  }

  private sspReply(bytes: number[]): void {
    const charCycles = Math.ceil(this.duart.characterTicks(1) * CPU_CLOCK / DUART_CLOCK);
    for (const b of bytes) this.sspIn.push({ wait: charCycles, b });
  }

  private tickSsp(cycles: number): void {
    let span = cycles;
    while (this.sspIn.length) {
      const head = this.sspIn[0];
      head.wait -= span;
      span = 0;
      if (head.wait > 0 || this.duart.rxSpace(1) === 0) break;
      this.duart.receive(1, head.b);
      this.sspIn.shift();
      if (this.sspIn.length) this.sspIn[0].wait += head.wait;
    }
  }

  private sspLamps(): void {
    this.ssp.lampsDirty = false;
    const bits = this.ssp.lampByte;
    for (let k = 0; k < 8; k++) {
      const on = (bits >> k) & 1;
      if (on && !this.sspLampState[k]) {
        this.sspLampState[k] = 1;
        this.lamps[264 + k] = 0xff;
      } else if (!on && this.sspLampState[k]) {
        this.sspLampState[k] = 0;
        this.lamps[264 + k] = 0;
      }
    }
  }

  insertParallelNote(channel: number): NoteResult {
    return this.ssp.insertNote(channel);
  }

  readonly parallelNoteReaderFitted = true;

  readonly ppi = new I8255({
    outA: (v) => this.payenW(v),
    inB: () => this.ppiPortB(),
    inC: () => this.ppiPortC(),
    outC: (v) => {
      this.vfd.por(1);
      this.vfd.data(v & 0x02);
      this.vfd.sclk(v & 0x01);
    },
  }, { modeSetKeepsLatches: true });

  readonly reels = parkAtV20PowerUp([0, 1, 2, 3, 4, 5].map(
    () => new Reel({
      stepsPerRevolution: 96, symbols: 16, mame: true,
      indexStart: 1, indexEnd: 3, indexPattern: 0, initPhase: 4,
    }),
  ), MODEL_RELATIONS.IMPACT);

  setReelPosition(i: number, pos: number): void {
    this.reels[i]?.park(pos);
  }

  reelFit: ReelFit = { mask: 0x3f, channels: 6, beyond: [] };

  setReelOpticInverted(reel: number, inverted: boolean): void {
    if (reel >= 0 && reel < this.reelOpticInverted.length) this.reelOpticInverted[reel] = inverted;
  }

  private readonly reelOpticInverted = [false, false, false, false, false, false];

  setFittedReels(channels: readonly number[]): ReelFit {
    this.reelFit = fitReelBank(this.reels, channels);
    return this.reelFit;
  }

  readonly lamps = new Uint8Array(272);
  private readonly opLampState = new Uint8Array(8);
  private opLampOpr = 0;
  readonly digits = new Uint16Array(16);
  private lampStrobe = 0;
  private lampWord = 0;
  private digitByte = 0;
  private readonly lampIntensity = new Uint8Array(16);
  private lampLevel = 0;
  private readonly lampMux = new CurveMux(this.lamps, 16);

  pwrLed = false;
  statLed = false;

  private readonly idle = Uint8Array.from(IDLE_PORTS);
  private readonly pressed = new Uint8Array(9);
  private readonly matrix = new Uint8Array(15);
  readonly #panelMask = new Uint8Array(10);
  #panel: LayoutSwitch[] = [];
  readonly #stated = new StatedLines(15);
  private testDemo = false;

  private coinstate = 0xffff;
  private readonly coinCycles = [0, 0, 0, 0, 0, 0];
  private readonly coinMasks = [0, 0, 0, 0, 0, 0];

  readonly upd = new Upd7759();

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: '256 LAMPS', part: '16 strobes x 16',
        device: this.lamps, signal: 'lamps' },
      { id: 'switches', label: 'INPUT PORTS', part: '$480020-$480033',
        device: this.pressed },
      { id: 'sevenseg', label: '16 DIGITS', part: '16-segment',
        device: this.digits, signal: 'digits' },
      { id: 'meters', label: '8 METERS', part: 'bits 10-17', device: this.meterCount },
      { id: 'coins', label: 'COIN OPTOS', part: 'active low', signal: 'coin' },

      { id: 'mux', label: 'OUTPUT LATCHES',
        part: '$4800A0-$4800AF - lamps - digits - reels - meters',
        device: this.lamps, io: [[LATCH_BASE, LATCH_END]] },
      { id: 'optos', label: 'REEL OPTOS', part: '$480040',
        device: this.reels, io: [[OPTOS_ADDR, OPTOS_ADDR + 1]] },

      { id: 'ram', label: 'BATTERY RAM', part: '16K', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: '256K - even/odd pair', device: this.rom },
      { id: 'upd', label: 'SPEECH', part: 'uPD7759', device: this.upd,
        io: [[UPD_BASE, UPD_END]] },
      { id: 'pot', label: 'VOLUME', part: 'X9C103 digital pot' },
      { id: 'alpha', label: 'VFD', part: 'S16LF01 - 16 char',
        device: this.vfd, signal: 'display' },

      { id: 'cpu', label: 'CPU', part: 'MC68000 - 8 MHz', device: this.cpu, cpu: true },
      { id: 'duart', label: 'DUART', part: 'MC68681 - IRQ5', device: this.duart,
        io: [[DUART_BASE, DUART_END]] },
      { id: 'duart2', label: 'DUART 2', part: 'MC68681 - IRQ5', device: this.duart2,
        io: [[DUART2_BASE, DUART2_END]] },
      { id: 'ppi', label: 'PPI', part: 'uPD71055C - payout', device: this.ppi,
        io: [[PPI_BASE, PPI_END]] },
      { id: 'ump', label: 'UMP', part: 'meter unit - absent' },
      ...(this.secFitted
        ? [{ id: 'sec', label: 'SEC', part: 'protected counters - in place of the meters', device: this.sec }]
        : []),

      { id: 'reels', label: 'REEL MECH', part: 'Starpoint',
        device: this.reels, signal: 'reels' },
      { id: 'hopper', label: 'HOPPER', part: 'optos on the PPI', device: this.ppi },
      { id: 'coinmech', label: 'COIN MECH', part: 'acceptor', signal: 'coin' },
    ];
  }
  private volumeLatch = 0;
  globalVolume = 0;
  private potSteps = 0;
  private potReversed = false;
  private potDir = 0;

  private duartFrac = 0;
  private cycleCount = 0;
  private readonly ioLog = new Map<number, IoAccess>();

  constructor() {
    this.cpu = new M68000(this);
    this.duart.inputPort = 0x30;
    this.duart2.inputPort = DUART2_IP_IDLE;
    this.sec.onCount = (meter, delta) => this.secCount(meter, delta);
    this.sec.fitV20();
    this.lamps.fill(0xff, 256);
    this.ssp.onReply = (bytes) => this.sspReply(bytes);
    this.ssp.onCredit = (channel) => { this.cashLedger.inPence += SSP_CHANNEL_PENCE[channel - 1] ?? 0; };
    this.sspLamps();
  }

  get clockHz(): number {
    return CPU_CLOCK;
  }

  get display(): S16lf01 {
    return this.vfd;
  }

  get audioSource(): Upd7759 {
    return this.upd;
  }

  readonly lampsDriven = 272;

  private opLampWrite(opr: number): void {
    const changed = (this.opLampOpr ^ opr) & 0xff;
    this.opLampOpr = opr & 0xff;
    if ((changed & 0xfc) === 0) return;
    const bits = ((~opr & 0xff) >> 2) & 0xff;
    for (let k = 0; k < 8; k++) {
      const on = (bits >> k) & 1;
      if (on && !this.opLampState[k]) {
        this.opLampState[k] = 1;
        this.lamps[256 + k] = 0xff;
      } else if (!on && this.opLampState[k]) {
        this.opLampState[k] = 0;
        this.lamps[256 + k] = 0;
      }
    }
  }

  layoutLamp(n: number): boolean {
    if (n >= this.lampsDriven) return true;
    return n >= 0 && this.lamps[n] !== 0;
  }

  layoutLampLevel(n: number): number {
    if (n >= this.lampsDriven) return 0xff;
    return n >= 0 ? this.lamps[n] : 0;
  }

  layoutDigit(n: number): number {
    return this.digits[n & 15];
  }

  layoutInput(id: number, on: boolean): void {
    if (id >= Impact.DIL_ID_BASE && id < Impact.DIL_ID_BASE + 8) {
      const mask = 1 << (id - Impact.DIL_ID_BASE);
      this.idle[PORT_DSW] = on ? this.idle[PORT_DSW] & ~mask : this.idle[PORT_DSW] | mask;
      return;
    }
    const port = id >> 3;
    const bit = id & 7;
    if (id >= 0 && port < this.matrix.length
      && (port >= 10 || (this.#panelMask[port] & (1 << bit)) !== 0)) {
      this.setMatrix(id, on);
    } else if (port < 9) {
      this.setInput(port, bit, on);
    } else if (port === PORT_COINS) {
      this.setCoinLine(bit, on);
    } else if (port === 19 && bit === 0) {
      this.setTestDemo(on);
    }
  }

  private setMatrix(id: number, on: boolean): void {
    const mask = 1 << (id & 7);
    if (on) this.matrix[id >> 3] |= mask;
    else this.matrix[id >> 3] &= ~mask & 0xff;
  }

  setLayoutSwitches(list: readonly LayoutSwitch[]): void {
    const wanted = list.filter((s) => s.number >= 0 && s.number < this.matrix.length * 8);
    if (!wanted.length) return;
    this.#panel = wanted.map((s) => ({ ...s }));
    for (const s of wanted) {
      const row = s.number >> 3;
      if (row < this.#panelMask.length) this.#panelMask[row] |= 1 << (s.number & 7);
      this.setMatrix(s.number, s.closed);
      this.#stated.stateLine(s.number, s.closed);
    }
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    if (id < 0 || id >= this.matrix.length * 8) return;
    const row = id >> 3;
    if (row < this.#panelMask.length) this.#panelMask[row] |= 1 << (id & 7);
    this.setMatrix(id, made);
    this.#stated.stateLine(id, made);
    if (this.#panel.length && !this.#panel.some((s) => s.number === id)) {
      this.#panel.push({ number: id, label, closed: made });
    }
  }

  postRestore(): void {
    this.#stated.reassert(this.matrix);
  }

  private withPanel(row: number, v: number): number {
    const declared = this.#panelMask[row];
    if (!declared) return v;
    const closed = this.matrix[row] & declared;
    v &= ~closed;
    if (row >= 3 && row !== PORT_COINS) v |= declared & ~closed;
    return v & 0xff;
  }

  setInput(port: number, bit: number, on: boolean): void {
    if (port >= 9) return;
    const mask = 1 << bit;
    if (on) this.pressed[port] |= mask;
    else this.pressed[port] &= ~mask & 0xff;
  }

  setTestDemo(on: boolean): void {
    this.testDemo = on;
    this.duart.setIP(5, on ? 0 : 1);
  }

  setCoinLine(bit: number, on: boolean): void {
    const mask = 1 << (bit & 7);
    if (on) this.coinstate &= ~mask & 0xffff;
    else this.coinstate |= mask;
  }

  private static readonly COIN_PENCE = [100, 50, 20, 10, 20, 5];

  private static readonly TOKEN_LINE = 4;

  private static readonly BINARY_CODE = [COIN_RAW[5], COIN_RAW[4], COIN_RAW[2], COIN_RAW[1], COIN_RAW[3], COIN_RAW[0]];

  insertCoin(bit: number): void {
    const b = bit & 7;
    if (b >= 6 || this.coinCycles[b] > 0) return;
    if (this.mechType && this.coinBusy) return;
    const mask = this.mechType ? Impact.BINARY_CODE[b] & 0x1f : 1 << b;
    this.coinstate &= ~mask & 0xffff;
    this.coinMasks[b] = mask;
    this.coinCycles[b] = COIN_DWELL;
    if (b === Impact.TOKEN_LINE) {
      this.cashLedger.tokenInPence += Impact.COIN_PENCE[b] ?? 0;
    } else {
      this.cashLedger.inPence += Impact.COIN_PENCE[b] ?? 0;
    }
  }

  get coinBusy(): boolean {
    return this.coinCycles.some((c) => c > 0);
  }

  get coinChutes(): readonly { label: string; bit: number; pence: number | null; token?: boolean }[] {
    return Impact.CHUTES;
  }

  private static readonly CHUTES = [
    { label: '£1', bit: 0, pence: 100 },
    { label: '50p', bit: 1, pence: 50 },
    { label: '20p', bit: 2, pence: 20 },
    { label: '10p', bit: 3, pence: 10 },
    { label: '20p token', bit: 4, pence: null, token: true },
    { label: '5p', bit: 5, pence: 5 },
  ];

  setDsw(v: number): void {
    this.idle[PORT_DSW] = v & 0xff;
  }

  get switchPanel(): CabinetSwitch[] {
    const repeats = new Map<string, number>();
    for (const s of this.#panel) repeats.set(s.label, (repeats.get(s.label) ?? 0) + 1);
    const nth = new Map<string, number>();
    const rows: CabinetSwitch[] = this.#panel.map((s) => {
      const n = (nth.get(s.label) ?? 0) + 1;
      nth.set(s.label, n);
      const label = s.label
        ? (repeats.get(s.label)! > 1 ? `${s.label} ${n}` : s.label)
        : `Switch ${s.number}`;
      return { id: s.number, label, on: (this.matrix[s.number >> 3] & (1 << (s.number & 7))) !== 0 };
    });
    for (let i = 0; i < 8; i++) {
      rows.push({
        id: Impact.DIL_ID_BASE + i,
        label: dilSwitchLabel(`DIL switch ${i + 1}`, this.dilLabels?.[i]),
        on: (this.idle[PORT_DSW] & (1 << i)) === 0,
        group: 'DIL switches',
        bootOnly: true,
        option: true,
      });
    }
    return rows;
  }

  private dilLabels: readonly string[] | null = null;
  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  private static readonly DIL_ID_BASE = 256;

  setPercentKey(v: number): void {
    this.idle[PORT_PERCENT] = v & 0xff;
  }

  setKeys(v: number): void {
    this.idle[PORT_J10_0] = v & 0xff;
  }

  get keyByte(): number {
    return this.idle[PORT_J10_0];
  }

  private hoppersWord = 0x50;

  setHoppers(word: number): void {
    this.hoppersWord = word & 0xff;
  }

  setTriacSlides(slides: SlideEffect[]): void {
    for (let i = 0; i < 4; i++) this.slidePence[i] = slides[i] ?? null;
  }

  private mechType = 0;

  setMechType(v: number): void {
    this.mechType = v & 1;
  }

  setMeterMap(inMult: number[], outMult: number[]): void {
    for (let i = 0; i < 8; i++) {
      this.meterInMult[i] = inMult[i] ?? 0;
      this.meterOutMult[i] = outMult[i] ?? 0;
    }
    this.meterMapStated = this.meterInMult.some((x) => x > 0) || this.meterOutMult.some((x) => x > 0);
    this.relayLedgerMults();
  }

  setSecMoneyMap(secIn: readonly number[], secOut: readonly number[]): void {
    this.secInMult = [...secIn];
    this.secOutMult = [...secOut];
    this.relayLedgerMults();
  }

  private relayLedgerMults(): void {
    [this.meterLedgerMult, this.secLedgerMult] = ledgerOutMults(
      { in: this.meterInMult, out: this.meterOutMult },
      { in: this.secInMult, out: this.secOutMult },
    );
  }

  get secOutPriced(): boolean {
    return this.secLedgerMult.some((x) => x > 0);
  }

  fitSec(counters: readonly { label: string; value: number }[] = []): void {
    this.secFitted = true;
    counters.forEach((c, i) => {
      this.sec.counters[i] = c.value;
      if (c.label) this.sec.counterText[i] = c.label;
    });
  }

  private secCount(meter: number, delta: number): void {
    const inMult = this.secInMult[meter] ?? 0;
    const outMult = this.secOutMult[meter] ?? 0;
    if (inMult) this.secTotals.in += inMult * delta;
    if (outMult) {
      this.secTotals.out += outMult * delta;
      if (!this.coinHasLeft()) { if (this.secLedgerMult[meter]) this.heldOutPulses += delta; return; }
      this.cashLedger.outPence += (this.secLedgerMult[meter] ?? 0) * delta * Impact.SEC_UNIT_PENCE;
    }
  }

  meterMapStated = false;

  loadRomPair(even: Uint8Array, odd: Uint8Array): void {
    this.rom.fill(ROM_UNPLACED);
    noteRomCut(this, Math.max(even.length, odd.length) * 2, ROM_SIZE);
    const n = Math.min(even.length, odd.length, ROM_SIZE >> 1);
    for (let i = 0; i < n; i++) {
      this.rom[i * 2] = even[i];
      this.rom[i * 2 + 1] = odd[i];
    }
    this.cpu.setCodeRegion(0, this.rom);
  }

  loadRom(image: Uint8Array): void {
    this.rom.fill(ROM_UNPLACED);
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
    this.coinHasLeft();
    this.nvram = this.ram.slice();
    this.reset();
  }

  reset(): void {
    if (this.nvram) this.ram.set(this.nvram);
    else this.ram.fill(0);
    this.duart.reset();
    this.duart.inputPort = 0x30;
    this.duart2.reset();
    this.duart2.inputPort = DUART2_IP_IDLE;
    this.ppi.reset();
    this.hopper1.reset();
    this.hopper2.reset();
    this.vfd.reset();
    resetReelsInPlace(this.reels);
    this.lampMux.reset();
    this.lamps.fill(0xff, 256);
    this.opLampState.fill(0);
    this.opLampOpr = 0;
    this.ssp.reset();
    this.sspIn = [];
    this.sspLampState.fill(0);
    this.sspLamps();
    this.digits.fill(0);
    this.pwrLed = false;
    this.statLed = false;
    this.coinstate = 0xffff;
    this.coinCycles.fill(0);
    this.coinMasks.fill(0);
    this.payen = 0;
    this.portA = 0;
    this.payoutWord = 0;
    this.slideState = 0;
    this.meterState.fill(false);
    this.meterBank.reset();
    this.sec.reset();
    this.dataPak.reset();
    this.dataPakOut = [];
    this.dataPakWait = 0;
    this.dataPakIn = [];
    this.upd.reset();
    this.globalVolume = 0;
    this.potSteps = 0;
    this.potReversed = false;
    this.potDir = 0;
    this.volumeLatch = 0;
    this.duartFrac = 0;
    this.ioLog.clear();
    this.setTestDemo(this.testDemo);
    this.cpu.reset();
  }

  private updateIrq(): void {
    this.cpu.setIRQ(this.duart.irq() || this.duart2.irq() ? 5 : 0, null);
  }

  private get hopper1Fitted(): boolean {
    return (~this.hoppersWord & 0x40) !== 0;
  }
  private get hopper2Fitted(): boolean {
    return (~this.hoppersWord & 0x10) !== 0;
  }

  private payenW(data: number): void {
    const changed = (this.portA ^ data) & 0xff;
    this.portA = data & 0xff;
    if (!(changed & 0xc5)) return;
    const opto = (data & 0x80) !== 0;
    if (this.hopper1Fitted) {
      this.hopper1.motorDrive((data & 0x01) !== 0);
      this.hopper1.optoDriveLine(opto);
    }
    if (this.hopper2Fitted) {
      this.hopper2.motorDrive((data & 0x44) !== 0);
      this.hopper2.optoDriveLine(opto);
    }
  }

  private ppiPortB(): number {
    let v = 0xe0;
    v |= !this.secFitted || this.sec.data() ? 0x04 : 0;
    v |= this.hopper1.countPin() & 1;
    v |= (this.hopper2.countPin(this.hoppersWord === 0x40) & 1) << 3;
    return v;
  }

  private ppiPortC(): number {
    return (~this.matrix[10] & 0x20) | this.hoppersWord;
  }

  private slidesW(v: number): void {
    const changed = (this.payoutWord ^ v) & 0xffff;
    this.payoutWord = v & 0xffff;
    if (changed & 0x10) {
      this.payen = v & 0x10;
      const on = this.payen !== 0;
      const opto = (this.portA & 0x90) !== 0;
      if (this.hopper1Fitted) {
        this.hopper1.motorDrive(on && (this.portA & 0x01) !== 0);
        this.hopper1.optoDriveLine(opto);
      }
      if (this.hopper2Fitted) {
        this.hopper2.motorDrive(on && (this.portA & 0x44) !== 0);
        this.hopper2.optoDriveLine(opto);
      }
    }
    const drives = (v & 0x10) !== 0 ? v & 0x0f : 0;

    let rising = drives & ~this.slideState & 0x0f;
    this.slideState = drives;
    for (let i = 0; rising !== 0; i++, rising >>= 1) {
      if (!(rising & 1)) continue;
      this.slidePulses[i]++;
      this.coinLeft = true;
    }

    if (this.secFitted) {
      if ((changed & 0x8c00) !== 0) {
        const b = ~(v >> 10) & 0xff;
        this.sec.setCS((b & 0x20) !== 0);
        this.sec.lineCall(this.cpu.cycles);
        this.sec.setData((b & 0x02) !== 0);
        this.sec.setClock((b & 0x01) !== 0);
      }
      return;
    }
    const state = (v >> 10) & 0xff;
    for (let i = 0; i < 8; i++) this.meterState[i] = (state & (1 << i)) !== 0;
    this.meterBank.write(state);
    this.duart.setIP(4, this.meterState.some(Boolean) ? 0 : 1);
  }

  private static readonly METER_CASH_OUT = 1;
  private static readonly METER_TOKEN_OUT = 3;
  private static readonly METER_UNIT_PENCE = 10;

  private tickMeters(cycles: number): void {
    const confirmed = this.meterBank.advance(cycles, METER_TICK_CYCLES);
    if (confirmed) for (let i = 0; i < 8; i++) if (confirmed & (1 << i)) this.meterConfirmed(i);
  }

  private meterConfirmed(id: number): void {
    if (id >= 8) return;
    this.meterCount[id]++;
    this.meterTotals.in += this.meterInMult[id];
    this.meterTotals.out += this.meterOutMult[id];
    const outMeter = this.meterMapStated
      ? (this.meterLedgerMult[id] ?? 0) > 0 || (id === Impact.METER_TOKEN_OUT
        && this.meterOutMult[Impact.METER_CASH_OUT] > 0 && !this.meterOutMult[id] && !this.meterInMult[id])
      : id === Impact.METER_CASH_OUT || id === Impact.METER_TOKEN_OUT;
    if (outMeter && !this.coinHasLeft()) { this.heldOutPulses++; return; }
    if (this.meterMapStated) {
      this.cashLedger.outPence += (this.meterLedgerMult[id] ?? 0) * Impact.METER_UNIT_PENCE;
      if (id === Impact.METER_TOKEN_OUT && this.meterOutMult[Impact.METER_CASH_OUT] > 0
        && !this.meterOutMult[id] && !this.meterInMult[id]) {
        this.cashLedger.tokenOutPence += Impact.METER_UNIT_PENCE;
      }
    } else if (id === Impact.METER_CASH_OUT) this.cashLedger.outPence += Impact.METER_UNIT_PENCE;
    else if (id === Impact.METER_TOKEN_OUT) this.cashLedger.tokenOutPence += Impact.METER_UNIT_PENCE;
  }

  private volumeW(v: number): void {
    const changed = this.volumeLatch ^ v;
    this.upd.setRomBank((v >> 1) & 3);
    this.upd.setResetLine((v & 0x01) !== 0);
    if (changed & 0x10 && !(v & 0x10) && !(v & 0x40)) {
      if (v & 0x20) {
        if (this.globalVolume < 99) this.globalVolume++;
        if (!this.potReversed) {
          if (this.potDir < 0) this.potReversed = true;
          else this.potSteps++;
        }
        this.potDir = 1;
      } else {
        if (this.globalVolume > 0) this.globalVolume--;
        if (!this.potReversed) {
          if (this.potDir < 1) this.potSteps++;
          else this.potReversed = true;
        }
        this.potDir = -1;
      }
      const level = this.potSteps ? Math.trunc((this.globalVolume * 255) / this.potSteps) : 0;
      this.upd.gain = Math.min(level, 255) / 255;
    }
    this.volumeLatch = v & 0xff;
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

  ioActivity(): IoAccess[] {
    return [...this.ioLog.values()].sort(
      (x, y) => y.reads + y.writes - (x.reads + x.writes),
    );
  }

  read8(addr: number): number {
    const a = addr & 0xffffff;
    if (a < ROM_SIZE) return this.rom[a];
    if (a >= RAM_BASE && a < RAM_BASE + RAM_SIZE) return this.ram[a - RAM_BASE];
    const w = this.ioRead(a & ~1, a & 1 ? 0x00ff : 0xff00);
    return a & 1 ? w & 0xff : (w >> 8) & 0xff;
  }

  read16(addr: number): number {
    const a = addr & 0xfffffe;
    if (a < ROM_SIZE) return (this.rom[a] << 8) | this.rom[a + 1];
    if (a >= RAM_BASE && a < RAM_BASE + RAM_SIZE) {
      const o = a - RAM_BASE;
      return (this.ram[o] << 8) | this.ram[o + 1];
    }
    return this.ioRead(a, 0xffff);
  }

  write8(addr: number, val: number): void {
    const a = addr & 0xffffff;
    const v = val & 0xff;
    if (a < ROM_SIZE) return;
    if (a >= RAM_BASE && a < RAM_BASE + RAM_SIZE) {
      this.ram[a - RAM_BASE] = v;
      return;
    }
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

  private portValue(port: number): number {
    if (port === PORT_COINS) {
      return this.withPanel(port, (this.coinstate & 0x3f & ~(this.mechType << 5)) | 0xc0);
    }
    return this.withPanel(port, (this.idle[port] ^ this.pressed[port]) & 0xff);
  }

  private ioRead(a: number, mask: number): number {
    this.noteIo(a, false);
    if (a >= DUART_BASE && a < DUART_END) {
      return mask & 0x00ff ? this.duart.read((a >> 1) & 0x0f) & 0xff : 0;
    }
    if (a >= PORTS_BASE && a < PORTS_END) return this.portValue((a - PORTS_BASE) >> 1);
    if (a >= 0x480034 && a < 0x480040) return 0xffff;
    if (a === OPTOS_ADDR) {
      let v = 0;
      for (let i = 0; i < this.reels.length; i++) {
        if (this.reels[i].optic() !== this.reelOpticInverted[i]) v |= 1 << i;
      }
      v &= this.reelFit.mask;
      return v;
    }
    if (a >= PPI_BASE && a < PPI_END) {
      return mask & 0x00ff ? this.ppi.read((a >> 1) & 3) & 0xff : 0;
    }
    if (a === UPD_BASE + 4) return this.upd.busy() ? 1 : 0;
    if (a >= 0x480086 && a < 0x4800a0) return 0x0001;
    if (a >= LATCH_BASE && a < LATCH_END) return 0xffff;
    if (a >= 0x4801c0 && a < 0x4801e0) {
      if (a < 0x4801d8) return 0xffff;
      const v = ~this.matrix[MATRIX_EXTRA[(a - 0x4801d8) >> 1]] & 0xff;
      return (v << 8) | v;
    }
    if (a >= DUART2_BASE && a < DUART2_END) {
      return mask & 0x00ff ? this.duart2.read((a >> 1) & 0x0f) & 0xff : 0;
    }
    if (a >= DUART2_END && a < 0x657600) return 0x0001;
    if (a === 0x657600) return 0x0000;
    if (a >= 0x657602) return 0x0001;
    this.strays.hit(a);
    return 0;
  }

  readonly strays = new StrayCounter();

  private ioWrite(a: number, v: number, mask: number): void {
    this.noteIo(a, true);
    if (a >= DUART_BASE && a < DUART_END) {
      if (mask & 0x00ff) this.duart.write((a >> 1) & 0x0f, v & 0xff);
      return;
    }
    if (a >= DUART2_BASE && a < DUART2_END) {
      if (mask & 0x00ff) this.duart2.write((a >> 1) & 0x0f, v & 0xff);
      return;
    }
    if (a >= PPI_BASE && a < PPI_END) {
      if (mask & 0x00ff) this.ppi.write((a >> 1) & 3, v & 0xff);
      return;
    }
    switch (a) {
      case 0x480080:
        if (mask & 0x00ff) {
          this.upd.portW(v & 0xff);
          this.upd.setStartLine(false);
          this.upd.setStartLine(true);
        }
        return;
      case 0x480082:
        if (mask & 0x00ff) this.volumeW(v & 0xff);
        return;
      case LATCH_BASE:
        this.pwrLed = !(v & 0x100);
        this.statLed = !(v & 0x200);
        return;
      case 0x4800a2:
        this.reels[0]?.update(v & 0x0f);
        this.reels[1]?.update((v >> 4) & 0x0f);
        this.reels[2]?.update((v >> 8) & 0x0f);
        this.reels[3]?.update((v >> 12) & 0x0f);
        return;
      case 0x4800a4:
        this.reels[4]?.update(v & 0x0f);
        this.reels[5]?.update((v >> 4) & 0x0f);
        return;
      case 0x4800a6:
        this.slidesW(v);
        return;
      case 0x4800a8:
        if (mask === 0xffff) this.lampWord = v & 0xffff;
        return;
      case 0x4800aa:
      case 0x4800ac:
      case 0x4800ae:
        if (mask !== 0xffff) this.lampRegW(a, mask === 0x00ff ? v & 0xff : (v >> 8) & 0xff);
        return;
      default:
        this.strays.hit(a);
        return;
    }
  }

  private lampRegW(a: number, v: number): void {
    const reg = (a & 0x1f) >> 1;
    if (reg === 5) {
      this.digitByte = v;
    } else if (reg === 6) {
      this.lampIntensity[(this.lampStrobe + 1) & 0x0f] = v;
      this.lampLevel = LAMP_INTENSITY[this.lampIntensity[this.lampStrobe] & 0x0f];
    } else if (v & 0x10) {
      this.lampStrobe = v & 0x0f;
      this.lampMux.write(this.lampStrobe, this.lampWord, this.lampLevel, this.cycleCount);
      this.digits[this.lampStrobe] = this.digitByte;
    } else if (this.lampMux.strobe(this.lampStrobe)) {
      this.digits.fill(0);
    }
  }

  step(): number {
    const cycles = this.cpu.step();
    this.cycleCount += cycles;

    this.duartFrac += cycles * DUART_CLOCK;
    const ticks = Math.floor(this.duartFrac / CPU_CLOCK);
    this.duartFrac -= ticks * CPU_CLOCK;
    this.duart.tick(ticks);
    this.duart2.tick(ticks);

    this.tickDataPak(cycles);
    if (this.sspIn.length) this.tickSsp(cycles);

    this.tickMeters(cycles);

    this.hopper1.tick(cycles);
    this.hopper2.tick(cycles);

    for (let i = 0; i < 6; i++) {
      if (this.coinCycles[i] > 0) {
        this.coinCycles[i] -= cycles;
        if (this.coinCycles[i] <= 0) {
          this.coinCycles[i] = 0;
          this.coinstate |= this.coinMasks[i] || 1 << i;
        }
      }
    }

    this.upd.tick(cycles, CPU_CLOCK);

    return cycles;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

}
