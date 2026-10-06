import type { Bus } from '../cpu/bus';
import type { CabinetSwitch, Machine, MachineDisplay, DigitKind } from './machine';
import { newCashLedger, dilSwitchLabel } from './machine';
import type { BoardPart } from './parts';
import { HD6303Y } from '../cpu/m6303';
import { Pia6821 } from '../hw/pia6821';
import { CurveMux } from '../hw/curvemux';
import { Reel } from '../hw/reel';
import { AceSpReelController } from '../hw/ace-reelctrl';
import { AcePcpReelPcb, PCP_MCU_HZ } from '../hw/ace-pcp-reelpcb';
import { AceSpSoundPort } from '../hw/ace-sndport';
import { Msc1937 } from '../hw/msc1937';
import { Msm6376, MSM6376_RATE } from '../hw/msm6376';
import { Ay8910 } from '../hw/ay8910';
import { MeterConfirm } from '../hw/meterconfirm';
import { Mixer } from '../hw/mixer';
import { DataPak } from '../hw/datapak';
import type { AudioSource } from './machine';
import { noteBoardDefault, noteRomCut } from './boarddefaults';
import { StrayCounter } from './strayaccess';
import { fitReelBank, type ReelFit } from './reelfit';
import { layoutPanelRows, type LayoutSwitch } from './layoutswitches';
import { StatedLines } from './statedlines';

export const E_CLOCK = 2_000_000;
const ACESP_AY_CLOCK = 2_000_000;
const ALPHA_DIGIT_SEGS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f] as const;

const COIN_BYTE = 4;
const COIN_LINES = [4, 5, 6, 7] as const;

const TOKEN_MECH_LINE = 3;

const MECH_LINES = [...COIN_LINES, TOKEN_MECH_LINE] as const;

const SWITCH_BYTE_OF_MATRIX = [3, 0, 1, 2, 4] as const;
const COIN_PENCE = [10, 20, 50, 100] as const;

export const ACE_METER_ROLES = [
  'cash-in', 'cash-out', 'token-in', 'token-out', 'token-refill',
  'unassigned', 'unassigned', 'unassigned',
] as const;

export const NMI_HZ = 1000;

export const IRQ2_HZ = 100;

const TCSR_ETOI = 0x04;
const TCSR_EOCI = 0x08;
const TCSR_EICI = 0x10;
const TCSR_TOF = 0x20;
const TCSR_OCF = 0x40;
const TCSR_ICF = 0x80;
const TCSR2_EOCI2 = 0x08;
const TCSR2_OCF2 = 0x20;

const TRCSR_TE = 0x02;
const TRCSR_TIE = 0x04;
const TRCSR_RIE = 0x10;
const TRCSR_TDRE = 0x20;
const TRCSR_ORFE = 0x40;
const TRCSR_RDRF = 0x80;

const ROM_BASE = 0x2000;

const P2_INPUT_IDLE = 0x7f;

export interface AceSpOutputs {
  readonly lamps: Uint8Array;
  readonly dots: Uint8Array;
  readonly segments: Uint8Array;
  readonly shift: Uint8Array;
  readonly reels: readonly Reel[];
}

export interface AceSpInputs {
  readonly switches: Uint8Array;
  power: number;
  health: number;
}

export class AceSp implements Bus, Machine {
  static readonly snapshotConfig: readonly string[] = ['nvram'];
  readonly digitKind: DigitKind = 'space';
  readonly cpu: HD6303Y;

  readonly internalRam = new Uint8Array(0x100);
  readonly ram = new Uint8Array(0x1ec0);

  readonly pia: Pia6821;
  readonly reelctrl = new AceSpReelController();
  reelpcb: AcePcpReelPcb | null = null;
  private mcuDebt = 0;

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: '128 LAMPS', part: '8 cols x 16',
        device: this.outputs.lamps, signal: 'lamps' },
      { id: 'switches', label: 'SWITCH CHAIN', part: 'serial shift-in',
        device: this.inputs.switches },
      { id: 'dots', label: 'DOT PANEL', part: '1536 dots',
        device: this.outputs.dots, signal: 'dots' },
      { id: 'sevenseg', label: '7-SEG', part: '32 from RAM + 16 from the alpha',
        device: this.outputs.segments, signal: 'digits' },
      { id: 'alpha', label: 'ALPHA', part: '16 char, bit-serial - $0036 register $98',
        device: this.vfd, signal: 'display' },
      { id: 'coins', label: 'COIN INPUTS', signal: 'coin' },

      { id: 'lamplatch', label: 'LAMP LATCHES', part: '$0031-$0033',
        device: this.outputs.lamps },
      { id: 'shift', label: 'SHIFT CHAIN', part: '$0034-$0035 - 8 meters - 4 slides - locks',
        device: this.outputs.shift },
      { id: 'pia', label: 'PIA', part: 'MC6821 - $0038', device: this.pia },

      { id: 'intram', label: 'INTERNAL RAM', part: '256 bytes', device: this.internalRam },
      { id: 'ram', label: 'RAM', part: '$0140-$1FFF', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: '64K - 2 images', device: this.rom },
      { id: 'watchdog', label: 'WATCHDOG', part: '$0037', modelled: true,
        note: 'Modelled as a kick counter on this board, not as a device.' },
      { id: 'sndport', label: 'SOUND PORT', part: '$0036 - cmd/data latch',
        device: this.sndport },
      { id: 'oki', label: 'SAMPLES', part: 'MSM6376 - plug-in board',
        ...(this.sndport.oki ? { device: this.sndport.oki } : { modelled: false,
          note: 'No sample ROMs in this set: first-generation sp.ACE has no $36 board.' }) },
      { id: 'ay1', label: 'AY #1', part: 'AY-3-8910 - 2 MHz, ports 5/6', device: this.ay[0] },
      { id: 'ay2', label: 'AY #2', part: 'AY-3-8910 - 2 MHz, ports 5/6', device: this.ay[1] },

      { id: 'cpu', label: 'CPU', part: 'HD6303Y - 2 MHz E', device: this.cpu, cpu: true },
      { id: 'timers', label: 'TIMERS', part: 'on-chip 1 and 2', device: this.cpu },
      { id: 'sci', label: 'SCI', part: '1200 baud - serial link (not sound)', device: this.txLog },
      { id: 'datapak', label: 'DATAPAK', part: 'audit link - on the SCI', device: this.dataPak },
      { id: 'ports', label: 'PORTS 2/5/6', part: 'on-chip I/O', device: this.outputs },

      this.reelpcb
        ? { id: 'reelctrl', label: 'REEL CONTROLLER', part: '68705P3 - PCP FCR 1 - real MCU',
            device: this.reelpcb.mcu, cpu: true }
        : { id: 'reelctrl', label: 'REEL CONTROLLER', part: '68705P3 - second PCB',
            device: this.reelctrl },
      { id: 'reels', label: 'REEL MECH', part: '4 reels',
        device: this.reels, signal: 'reels' },
      { id: 'coinmech', label: 'COIN MECH', part: 'acceptor', signal: 'coin' },
    ];
  }

  private readonly reelUnits = [0, 1, 2, 3].map(
    () => new Reel({ stepsPerRevolution: 96, symbols: 16, drive: 'ace',
      opticStart: 0, opticWidth: 4 }),
  );

  reelStripOffsets: number[] = [0, 0, 0, 0];

  readonly outputs: AceSpOutputs = {
    lamps: new Uint8Array(16 * 16),
    dots: new Uint8Array(0xc0),
    segments: new Uint8Array(0x40),
    shift: new Uint8Array(3),
    reels: this.reelUnits,
  };

  readonly inputs: AceSpInputs = {
    switches: new Uint8Array(5),
    power: 0xc0,
    health: 0xc0,
  };

  private rom = new Uint8Array(0x10000);
  private nvram: Uint8Array | null = null;

  private p2 = 0;
  private p2ddr = 0;
  private p5 = 0;
  private p5ddr = 0;

  dip1 = 0;
  dip2 = 0;

  get switchPanel(): CabinetSwitch[] {
    const rows: CabinetSwitch[] = layoutPanelRows(this.#panel, (id) => {
      const at = AceSp.panelLine(id);
      if (!at) return false;
      const set = (this.inputs.switches[at.byte] & at.mask) !== 0;
      return at.byte === 2 ? !set : set;
    });
    rows.push({
      id: AceSp.DIL_ID_BASE + AceSp.TEST_SWITCH_ROW,
      label: 'Test switch',
      on: (this.dip2 & (1 << (AceSp.TEST_SWITCH_ROW & 7))) !== 0,
    });
    for (let i = 0; i < 16; i++) {
      const bank = i < 8 ? this.dip1 : this.dip2;
      rows.push({
        id: AceSp.DIL_ID_BASE + i,
        label: dilSwitchLabel(`Switch ${(i & 7) + 1} bank ${i < 8 ? 1 : 2}`, this.dilLabels?.[i]),
        on: (bank & (1 << (i & 7))) !== 0,
        group: 'Option switches',
        ...(i === AceSp.TEST_SWITCH_ROW ? {} : { bootOnly: true }),
        option: true,
      });
    }
    return rows;
  }

  private static readonly TEST_SWITCH_ROW = 15;

  #panel: LayoutSwitch[] = [];
  readonly #stated = new StatedLines(5);

  private static panelLine(id: number): { byte: number; mask: number } | null {
    if (id < 0 || id >= 40) return null;
    const byte = SWITCH_BYTE_OF_MATRIX[id >> 3];
    if (byte === 2) {
      const line = AceSp.chainByte2Line(id);
      return line < 0 ? null : { byte, mask: 1 << line };
    }
    return { byte, mask: 1 << (id & 7) };
  }

  setLayoutSwitches(list: readonly LayoutSwitch[]): void {
    const wanted = list.filter((s) => s.number >= 0 && s.number < 64);
    if (!wanted.length) return;
    this.#panel = wanted.map((s) => ({ ...s }));
    for (const s of wanted) {
      const at = AceSp.panelLine(s.number);
      if (!at) continue;
      if (!s.closed && at.byte === COIN_BYTE
        && (MECH_LINES as readonly number[]).includes(s.number & 7)) continue;
      const set = at.byte === 2 ? !s.closed : s.closed;
      const b = this.inputs.switches;
      b[at.byte] = set ? b[at.byte] | at.mask : b[at.byte] & ~at.mask & 0xff;
      this.#stated.state(at.byte, at.mask, set ? at.mask : 0);
    }
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    const at = AceSp.panelLine(id);
    if (!at) return;
    const set = at.byte === 2 ? !made : made;
    const b = this.inputs.switches;
    b[at.byte] = set ? b[at.byte] | at.mask : b[at.byte] & ~at.mask & 0xff;
    this.#stated.state(at.byte, at.mask, set ? at.mask : 0);
    if (!this.#panel.some((s) => s.number === id)) this.#panel.push({ number: id, label, closed: made });
  }

  postRestore(): void {
    this.#stated.reassert(this.inputs.switches);
  }

  private dilLabels: readonly string[] | null = null;
  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  private static readonly DIL_ID_BASE = 64;

  private p6 = 0;
  private p6ddr = 0;
  private p6csr = 7;

  private rp5cr = 0x78;

  private counter = 0;
  private ocr1 = 0xffff;
  private ocr2 = 0xffff;
  private tcsr = 0;
  private tcsr2 = 0;
  private pendingTcsr = 0;
  private pendingTcsr2 = 0;

  private t2cnt = 0;
  private tconr = 0xff;
  private tcsr3 = 0;
  private t2divider = 0;

  private rmcr = 0;
  private trcsr = TRCSR_TDRE;
  private trcsr2 = 0;
  private rdr = 0;
  private txCycles = 0;
  private txShifting = -1;
  readonly txLog: number[] = [];

  readonly dataPak = new DataPak(E_CLOCK);

  private readonly mux = [new CurveMux(this.outputs.lamps, 8, 0), new CurveMux(this.outputs.lamps, 8, 0x80)];
  private lampStrobe = 0;
  private lampHi = 0;
  private lampLo = 0;
  private readonly muxOn = [0, 0];
  private ca2 = 0;

  private outChain1 = 0;
  private outChain0 = 0;
  private chainB7 = 0;
  private chainB5 = 0;
  private chainB4 = 0;

  private nmiCycles = 0;
  private irq2Cycles = 0;
  private irq2Pending = false;
  watchdogKicks = 0;

  constructor() {
    this.cpu = new HD6303Y(this);

    this.pia = new Pia6821({
      readA: () => this.inputs.power & 0xc0,
      readB: () => this.portB(),
    });
  }

  get clockHz(): number {
    return E_CLOCK;
  }

  get reels(): readonly Reel[] {
    return this.reelUnits;
  }

  reelFit: ReelFit = { mask: 0x0f, channels: 4, beyond: [] };

  setFittedReels(channels: readonly number[]): ReelFit {
    this.reelFit = fitReelBank(this.reelUnits, channels);
    this.reelctrl.fit(this.reelFit.channels);
    return this.reelFit;
  }

  readonly vfd = new Msc1937();
  alphaDrawn = false;
  get display(): MachineDisplay | null {
    return this.alphaDrawn ? this.vfd : null;
  }

  private alphaLines(v: number): void {
    this.vfd.por((v & 0x04) !== 0);
    this.vfd.data((v & 0x02) !== 0);
    this.vfd.sclk((v & 0x01) === 0);
    this.alphaDigits();
  }

  private alphaDigits(): void {
    const seg = this.outputs.segments;
    for (let k = 0; k < 16; k++) {
      const c = this.vfd.chars[15 - k];
      const d = c >= 0x30 && c <= 0x39 ? ALPHA_DIGIT_SEGS[c - 0x30] : 0;
      seg[32 + k] = d | (this.vfd.dots[15 - k] & 1 ? 0x80 : 0);
    }
  }

  readonly sndport = Object.assign(new AceSpSoundPort(), {
    onR98: (v: number) => this.alphaLines(v),
  });

  readonly ay = [new Ay8910(ACESP_AY_CLOCK, 'ay8910', MSM6376_RATE), new Ay8910(ACESP_AY_CLOCK, 'ay8910', MSM6376_RATE)];
  private ayLatch = 0;
  private audioMix: Mixer = new Mixer(this.ay);

  loadSoundRom(rom: Uint8Array): void {
    this.sndport.oki = new Msm6376(rom);
    this.audioMix = new Mixer([this.sndport.oki, ...this.ay]);
  }

  fitPcpReelPcb(rom: Uint8Array): void {
    const pcb = new AcePcpReelPcb(this.reelUnits);
    pcb.loadRom(rom);
    pcb.onNmi = () => {
      this.cpu.setNMI(true);
      this.cpu.setNMI(false);
    };
    this.reelpcb = pcb;
    this.mcuDebt = 0;
  }

  get audioSource(): AudioSource {
    return this.audioMix;
  }

  private static readonly COIN_DWELL = Math.floor(E_CLOCK * 0.06);
  private coinCycles = 0;
  private coinMask = 0;

  readonly cashLedger = newCashLedger();

  private coinLinePence: (number | null)[] = [...COIN_PENCE];

  setCoinLinePence(table: readonly (number | null | undefined)[]): void {
    for (let i = 0; i < table.length && i < this.coinLinePence.length; i++) {
      const p = table[i];
      if (p !== undefined) this.coinLinePence[i] = p;
    }
  }

  readonly meterPulses = new Uint32Array(8);
  private readonly meterBank = new MeterConfirm();
  static readonly METER_TICK_INSTRUCTIONS = 2000;
  readonly slidePulses = new Uint32Array(4);
  get triacLevels(): number {
    return this.prevSlideByte & 0x0f;
  }
  private prevMeterByte = 0;
  get meterLevels(): number { return this.prevMeterByte & 0xff; }
  private prevSlideByte = 0;

  private meterOutPence: number[] = [];
  setMeterOutPence(pencePerPulse: number[]): void {
    this.meterOutPence = pencePerPulse;
  }

  private meterInPence: number[] = [];
  setMeterInPence(pencePerPulse: number[]): void {
    this.meterInPence = pencePerPulse;
  }

  layoutLamp(n: number): boolean {
    return n >= 0 && n < this.outputs.lamps.length && this.outputs.lamps[n] !== 0;
  }

  layoutLampLevel(n: number): number {
    if (n < 0 || n >= this.outputs.lamps.length) return 0;
    return this.outputs.lamps[n];
  }

  layoutDigit(n: number): number {
    return this.outputs.segments[n & 0x3f];
  }

  static chainByte2Line(id: number): number {
    if (id < 24 || id > 31) return -1;
    const line = 31 - id;
    return line >= 6 ? -1 : line;
  }

  static standingChainByte2(closedIds: Iterable<number>): number {
    let v = 0x3f;
    for (const id of closedIds) {
      const line = AceSp.chainByte2Line(id);
      if (line >= 0) v &= ~(1 << line);
    }
    return v;
  }

  layoutInput(id: number, on: boolean): void {
    if (id >= AceSp.DIL_ID_BASE && id < AceSp.DIL_ID_BASE + 16) {
      const n = id - AceSp.DIL_ID_BASE;
      const mask = 1 << (n & 7);
      const raise = (v: number): number => (on ? v | mask : v & ~mask & 0xff);
      if (n < 8) this.dip1 = raise(this.dip1);
      else this.dip2 = raise(this.dip2);
      return;
    }
    const byte = SWITCH_BYTE_OF_MATRIX[id >> 3] ?? -1;
    if (byte < 0 || byte >= this.inputs.switches.length) return;
    const bit = id & 7;
    if (byte === 2) {
      const line = AceSp.chainByte2Line(id);
      if (line < 0) return;
      const m2 = 1 << line;
      if (on) this.inputs.switches[2] &= ~m2 & 0xff;
      else this.inputs.switches[2] |= m2;
      return;
    }
    if (byte === COIN_BYTE) {
      const mech = (MECH_LINES as readonly number[]).indexOf(bit);
      if (mech >= 0) {
        if (on) this.insertCoin(mech);
        return;
      }
    }
    const mask = 1 << bit;
    if (on) this.inputs.switches[byte] |= mask;
    else this.inputs.switches[byte] &= ~mask & 0xff;
  }

  insertCoin(bit: number): void {
    if (this.coinCycles > 0) return;
    const line = MECH_LINES[bit];
    if (line === undefined) return;
    this.coinMask = 1 << line;
    this.coinCycles = AceSp.COIN_DWELL;
    this.inputs.switches[COIN_BYTE] |= this.coinMask;
    if (line === TOKEN_MECH_LINE) return;
    const pence = this.coinLinePence[bit];
    if (pence !== null && pence !== undefined) this.cashLedger.inPence += pence;
  }

  get tokenInPriced(): boolean {
    return (this.meterInPence[ACE_METER_ROLES.indexOf('token-in')] ?? 0) > 0;
  }

  get tokenOutPriced(): boolean {
    return (this.meterOutPence[ACE_METER_ROLES.indexOf('token-out')] ?? 0) > 0;
  }

  get coinBusy(): boolean {
    return this.coinCycles > 0;
  }

  windowSymbol(i: number): number {
    const pos = this.reelUnits[i]?.position ?? 0;
    return (((pos / 6 - 7) % 16) + 16) % 16;
  }

  loadRomPair(low: Uint8Array, high: Uint8Array): void {
    this.rom = new Uint8Array(0x10000);
    noteRomCut(this, Math.max(low.length, high.length), 0x8000);
    this.rom.set(low.subarray(0, 0x8000), 0);
    this.rom.set(high.subarray(0, 0x8000), 0x8000);
  }

  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, 0x2000);
  }

  setReelPosition(i: number, halfSteps: number): void {
    this.reelctrl.setPosition(i, halfSteps);
    if (this.reelUnits[i]) this.reelUnits[i].position = this.reelctrl.positions[i];
  }

  mcuReelPositions(): number[] | null {
    return this.reelpcb ? this.reelpcb.mcuPositions() : null;
  }

  powerCycle(): void {
    const nv = this.nvram ? this.nvram.slice() : new Uint8Array(0x2000);
    nv.set(this.internalRam.subarray(0, Math.min(this.internalRam.length, nv.length - 0x40)), 0x40);
    nv.set(this.ram.subarray(0, Math.min(this.ram.length, nv.length - 0x140)), 0x140);
    this.nvram = nv;
    this.reset();
  }

  reset(): void {
    this.internalRam.fill(0);
    this.ram.fill(0);
    if (this.nvram) {
      const nv = this.nvram;
      for (let i = 0; i < this.internalRam.length && 0x40 + i < nv.length; i++) {
        this.internalRam[i] = nv[0x40 + i];
      }
      for (let i = 0; i < this.ram.length && 0x140 + i < nv.length; i++) {
        this.ram[i] = nv[0x140 + i];
      }
    }
    this.pia.reset();

    this.p2 = 0;
    this.p2ddr = 0;
    this.p5 = 0;
    this.p5ddr = 0;
    this.p6 = 0;
    this.p6ddr = 0;
    this.p6csr = 7;
    this.rp5cr = 0x78;

    this.counter = 0;
    this.ocr1 = 0xffff;
    this.ocr2 = 0xffff;
    this.tcsr = 0;
    this.tcsr2 = 0;
    this.pendingTcsr = 0;
    this.pendingTcsr2 = 0;
    this.t2cnt = 0;
    this.tconr = 0xff;
    this.tcsr3 = 0;
    this.t2divider = 0;

    this.rmcr = 0;
    this.trcsr = TRCSR_TDRE;
    this.trcsr2 = 0;
    this.rdr = 0;
    this.txCycles = 0;
    this.txShifting = -1;
    this.txLog.length = 0;
    this.dataPak.reset();

    this.sndport.reset();
    this.sndport.oki?.reset();
    this.ay[0].reset();
    this.ay[1].reset();
    this.ayLatch = 0;

    this.lampStrobe = 0;
    this.lampHi = 0;
    this.lampLo = 0;
    this.muxOn.fill(0);
    this.ca2 = 0;
    this.mux[0].reset();
    this.mux[1].reset();
    this.outputs.lamps.fill(0);
    this.outputs.shift.fill(0);
    this.prevMeterByte = 0;
    this.meterBank.reset();
    this.prevSlideByte = 0;
    this.outputs.dots.set(this.ram.subarray(0x1f00 - 0x0140, 0x1fc0 - 0x0140));
    this.outputs.segments.fill(0);
    this.outputs.segments.set(this.ram.subarray(0x1fc0 - 0x0140, 0x1fe0 - 0x0140));
    this.alphaDigits();

    this.outChain1 = 0;
    this.outChain0 = 0;
    this.chainB7 = 0;
    this.chainB5 = 0;
    this.chainB4 = 0;

    this.nmiCycles = 0;
    this.irq2Cycles = 0;
    this.irq2Pending = false;
    this.watchdogKicks = 0;

    if (this.coinMask) this.inputs.switches[COIN_BYTE] &= ~this.coinMask & 0xff;
    this.coinCycles = 0;
    this.coinMask = 0;

    if (this.reelpcb) {
      this.reelpcb.reset();
      this.mcuDebt = 0;
    } else {
      for (let i = 0; i < this.reelUnits.length; i++) {
        this.reelUnits[i].position = this.reelctrl.positions[i];
      }
    }

    this.cpu.reset();
    const base = this.firmwareStackBase();
    if (base !== null) this.cpu.s = base;
    this.syncIrqEnables();
  }

  private firmwareStackBase(): number | null {
    const entry = (this.read8(0xfffe) << 8) | this.read8(0xffff);
    for (let i = 0; i < 32; i++) {
      const at = (entry + i) & 0xffff;
      if (at < ROM_BASE) return null;
      if (this.rom[at] === 0x8e) return (this.rom[at + 1] << 8) | this.rom[at + 2];
    }
    return null;
  }

  read8(addr: number): number {
    addr &= 0xffff;
    if (addr >= ROM_BASE) return this.rom[addr];
    if (addr >= 0x0140) return this.ram[addr - 0x0140];
    if (addr >= 0x0040) return this.internalRam[addr - 0x0040];
    if (addr >= 0x0028) return this.readExternal(addr);
    return this.readRegister(addr);
  }

  write8(addr: number, val: number): void {
    addr &= 0xffff;
    val &= 0xff;
    if (addr >= ROM_BASE) return;
    if (addr >= 0x0140) {
      this.ram[addr - 0x0140] = val;
      if (addr >= 0x1f00) {
        if (addr < 0x1fc0) this.outputs.dots[addr - 0x1f00] = val;
        else if (addr < 0x1fe0) this.outputs.segments[addr - 0x1fc0] = val;
      }
      return;
    }
    if (addr >= 0x0040) {
      this.internalRam[addr - 0x0040] = val;
      return;
    }
    if (addr >= 0x0028) return this.writeExternal(addr, val);
    this.writeRegister(addr, val);
  }

  private readExternal(addr: number): number {
    if (addr === 0x30) return this.reelpcb ? this.reelpcb.read() : this.reelctrl.read();
    if (addr === 0x36) return this.sndport.read();
    if (addr >= 0x38 && addr <= 0x3b) return this.pia.read(addr & 3);
    if (addr < 0x30 || addr >= 0x3c) this.strays.hit(addr);
    return 0;
  }

  readonly strays = new StrayCounter();

  private foreignReelNoted = false;

  private noteForeignReels(): void {
    this.foreignReelNoted = true;
    noteBoardDefault(this, {
      axis: 'reel',
      text: 'reel controller program missing - the reels will not turn',
      ifWrong: 'This title needs its reel controller dump beside the game ROMs; the standard reel model cannot drive it.',
      node: 'reelctrl',
      unbuilt: 'reel controller',
    });
  }

  private writeExternal(addr: number, val: number): void {
    switch (addr) {
      case 0x30:
        if (this.reelpcb) this.reelpcb.write(val);
        else {
          this.reelctrl.write(val);
          if (this.reelctrl.foreignFrames && !this.foreignReelNoted) this.noteForeignReels();
        }
        return;
      case 0x31:
        this.lampHi = val;
        if (this.ca2 === 0) {
          const t = this.cpu.cycles;
          this.mux[0].writeHigh(this.lampStrobe, this.muxOn[0] ? val : 0, t);
          this.mux[1].writeHigh((this.lampStrobe - 5) & 7, this.muxOn[1] ? val : 0, t);
        }
        return;
      case 0x32:
        this.lampLo = val;
        if (this.ca2 === 0) {
          const t = this.cpu.cycles;
          this.mux[0].writeLow(this.lampStrobe, this.muxOn[0] ? val : 0, t);
          this.mux[1].writeLow((this.lampStrobe - 5) & 7, this.muxOn[1] ? val : 0, t);
        }
        return;
      case 0x33:
        this.strobeWhileEnabled(val & 7);
        return;
      case 0x34:
        this.strobeShiftChains();
        return;
      case 0x35:
        this.clockShiftChains();
        return;
      case 0x36:
        this.sndport.write(val);
        return;
      case 0x37:
        this.watchdogKicks++;
        return;
      default:
        if (addr >= 0x38 && addr <= 0x3b) {
          this.pia.write(addr & 3, val);
          if ((addr & 3) === 1) this.lampCra(val);
        } else this.strays.hit(addr);
    }
  }

  private openLampColumn(s: number, t: number): void {
    this.muxOn[1] = 0;
    this.muxOn[0] = 1;
    const nib = this.sndport.lampExtend;
    if ((nib & 0x0f) !== 0) {
      if (s === 5) {
        if (nib & 2) this.muxOn[1] = 1;
        if ((nib & 1) === 0) this.muxOn[0] = 0;
      } else if (s === 6) {
        if (nib & 8) this.muxOn[1] = 1;
        if ((nib & 4) === 0) this.muxOn[0] = 0;
      }
    }
    const word = (this.lampHi << 8) | this.lampLo;
    this.mux[0].write(s, this.muxOn[0] ? word : 0, -1, t);
    this.mux[1].write((s - 5) & 7, this.muxOn[1] ? word : 0, -1, t);
  }

  private strobeWhileEnabled(s: number): void {
    if (this.ca2 !== 0 || s === this.lampStrobe) {
      this.lampStrobe = s;
      return;
    }
    this.lampStrobe = s;
    this.openLampColumn(s, this.cpu.cycles);
  }

  private lampCra(cra: number): void {
    let next = this.ca2;
    if ((cra & 0x20) === 0) next = 1;
    else if ((cra & 0x10) !== 0) next = (cra >> 3) & 1;
    if (next === this.ca2) return;
    this.ca2 = next;
    const t = this.cpu.cycles;
    const s = this.lampStrobe;
    if (next === 0) {
      this.openLampColumn(s, t);
    } else {
      this.mux[0].write(s, 0, -1, t);
      this.mux[1].write((s - 5) & 7, 0, -1, t);
    }
  }

  private portB(): number {
    let v = this.reelpcb ? this.reelpcb.opticsNibble() : 0x0f;
    if (!(this.chainB7 & 0x80)) v |= 0x80;
    if (!(this.chainB5 & 0x8000)) v |= 0x20;
    if (!(this.chainB4 & 0x8000)) v |= 0x10;
    return v;
  }

  private reverseBits(v: number): number {
    let r = 0;
    for (let i = 0; i < 8; i++) if (v & (1 << i)) r |= 0x80 >> i;
    return r;
  }

  private strobeShiftChains(): void {
    this.outputs.shift[0] = (this.outChain1 >> 8) & 0xff;
    this.outputs.shift[1] = this.outChain1 & 0xff;
    this.outputs.shift[2] = this.outChain0 & 0xff;
    this.bookSlowOutputs();

    const s = this.inputs.switches;
    const s0 = s[0], s1 = s[1], s2 = s[2], s4 = s[4];
    const s3 = (s[3] & 0xfe) | (this.outputs.shift[1] !== 0 ? 0 : 1);
    this.chainB5 = ((this.reverseBits(s0) << 8) | this.reverseBits(s3)) & 0xffff;
    this.chainB4 = ((this.reverseBits(s1) << 8) | this.reverseBits(~s4 & 0xff)) & 0xffff;
    this.chainB7 = (s2 | this.inputs.health) & 0xff;
  }

  private meterConfirmed(b: number): void {
    this.meterPulses[b]++;
    const role = ACE_METER_ROLES[b];
    if (role === 'token-out') this.cashLedger.tokenOutPence += this.meterOutPence[b] ?? 0;
    else if (role === 'token-in') this.cashLedger.tokenInPence += this.meterInPence[b] ?? 0;
    else if (role !== 'cash-in') this.cashLedger.outPence += this.meterOutPence[b] ?? 0;
  }

  private tickMeters(n: number): void {
    const confirmed = this.meterBank.advance(n, AceSp.METER_TICK_INSTRUCTIONS);
    if (confirmed) for (let b = 0; b < 8; b++) if (confirmed & (1 << b)) this.meterConfirmed(b);
  }

  private bookSlowOutputs(): void {
    const meters = this.outputs.shift[1];
    const slides = this.outputs.shift[0] & 0x0f;
    const slideRise = slides & ~this.prevSlideByte;
    if (meters !== this.prevMeterByte) this.meterBank.write(meters & 0xff);
    for (let b = 0; b < 4; b++) {
      if (slideRise & (1 << b)) this.slidePulses[b]++;
    }
    this.prevMeterByte = meters;
    this.prevSlideByte = slides;
  }

  private clockShiftChains(): void {
    const data = (this.p2 >> 1) & 1;
    this.outChain1 = ((this.outChain1 << 1) | data) & 0xffff;
    this.outChain0 = ((this.outChain0 << 1) | (this.p2 & 1)) & 0xff;
    this.chainB7 = ((this.chainB7 << 1) | data) & 0xff;
    this.chainB5 = (this.chainB5 << 1) & 0xffff;
    this.chainB4 = (this.chainB4 << 1) & 0xffff;
  }

  private readRegister(addr: number): number {
    switch (addr) {
      case 0x03: return this.p2 | (~this.p2ddr & P2_INPUT_IDLE & 0xff);
      case 0x08:
        this.pendingTcsr = 0;
        return this.tcsr;
      case 0x09:
        if (!(this.pendingTcsr & TCSR_TOF)) this.tcsr &= ~TCSR_TOF & 0xff;
        return (this.counter >> 8) & 0xff;
      case 0x0a: return this.counter & 0xff;
      case 0x0b: return (this.ocr1 >> 8) & 0xff;
      case 0x0c: return this.ocr1 & 0xff;
      case 0x0d:
        if (!(this.pendingTcsr & TCSR_ICF)) this.tcsr &= ~TCSR_ICF & 0xff;
        return 0;
      case 0x0e: return 0;
      case 0x0f:
        this.pendingTcsr &= ~(TCSR_ICF | TCSR_OCF) & 0xff;
        this.pendingTcsr2 = 0;
        return this.tcsr2 | (this.tcsr & (TCSR_ICF | TCSR_OCF)) | 0x10;
      case 0x10: return this.rmcr;
      case 0x11: return this.trcsr;
      case 0x12:
        this.trcsr &= ~(TRCSR_RDRF | TRCSR_ORFE) & 0xff;
        this.updateInternalIrqs();
        return this.rdr;
      case 0x14: return this.rp5cr;
      case 0x15: return this.p5 | (~this.p5ddr & 0xff);
      case 0x17: return this.readPort6();
      case 0x19: return (this.ocr2 >> 8) & 0xff;
      case 0x1a: return this.ocr2 & 0xff;
      case 0x1b: return this.tcsr3;
      case 0x1d: return this.t2cnt;
      case 0x1e: return this.trcsr2;
      case 0x21: return this.p6csr | 7;
      default: return 0xff;
    }
  }

  private writeRegister(addr: number, val: number): void {
    switch (addr) {
      case 0x01: this.p2ddr = val; break;
      case 0x03: this.writePort2(val); break;
      case 0x08:
        this.tcsr = (val & 0x1f) | (this.tcsr & 0xe0);
        this.pendingTcsr &= this.tcsr;
        break;
      case 0x09: case 0x0a:
        this.counter = 0xfff8;
        break;
      case 0x0b:
        if (!(this.pendingTcsr & TCSR_OCF)) this.tcsr &= ~TCSR_OCF & 0xff;
        this.ocr1 = ((val << 8) | (this.ocr1 & 0xff)) & 0xffff;
        break;
      case 0x0c:
        if (!(this.pendingTcsr & TCSR_OCF)) this.tcsr &= ~TCSR_OCF & 0xff;
        this.ocr1 = ((this.ocr1 & 0xff00) | val) & 0xffff;
        break;
      case 0x0f:
        this.tcsr2 = (val & (TCSR2_EOCI2 | 0x07)) | (this.tcsr2 & TCSR2_OCF2);
        this.pendingTcsr2 &= this.tcsr2;
        break;
      case 0x10: this.rmcr = val; break;
      case 0x11:
        this.trcsr = (val & 0x1f) | (this.trcsr & 0xe0);
        break;
      case 0x13: this.transmit(val); break;
      case 0x14:
        this.rp5cr = val;
        this.syncIrqEnables();
        break;
      case 0x15: this.writePort5(val); break;
      case 0x16: this.p6ddr = val; break;
      case 0x17: this.p6 = val; this.ayLatch = val; break;
      case 0x19:
        if (!(this.pendingTcsr2 & TCSR2_OCF2)) this.tcsr2 &= ~TCSR2_OCF2 & 0xff;
        this.ocr2 = ((val << 8) | (this.ocr2 & 0xff)) & 0xffff;
        break;
      case 0x1a:
        if (!(this.pendingTcsr2 & TCSR2_OCF2)) this.tcsr2 &= ~TCSR2_OCF2 & 0xff;
        this.ocr2 = ((this.ocr2 & 0xff00) | val) & 0xffff;
        break;
      case 0x1b:
        this.tcsr3 = val & (0x5f | (this.tcsr3 & 0x80));
        break;
      case 0x1c: this.tconr = val; break;
      case 0x1d: this.t2cnt = val; break;
      case 0x1e: this.trcsr2 = val; break;
      case 0x20: this.p5ddr = val; break;
      case 0x21: this.p6csr = (this.p6csr & 0x80) | (val & 0x7f); break;
      default: break;
    }
    this.updateInternalIrqs();
  }

  private writePort2(val: number): void {
    this.p2 = val;
  }

  private readPort6(): number {
    let input = 0xff;
    if (this.p5 & 0x80) input &= ~this.dip1 & 0xff;
    if (this.p5 & 0x40) input &= ~this.dip2 & 0xff;
    return (this.p6 & this.p6ddr) | (input & ~this.p6ddr & 0xff);
  }

  private writePort5(val: number): void {
    const changed = this.p5 ^ val;
    this.p5 = val;
    const ayCycle = (changed & 0xf0) !== 0;
    if (ayCycle) this.ayBus(val);
    if (changed & 0x04 && (ayCycle || !(val & 0x04))) {
      if (this.reelpcb) this.reelpcb.startFrame();
      else this.reelctrl.startFrame();
    }
  }

  private ayBus(v: number): void {
    const top = v & 0xf0;
    const chip = top === 0x70 || top === 0x50 ? this.ay[0] : top === 0xb0 || top === 0x90 ? this.ay[1] : null;
    if (!chip) return;
    const select = chip === this.ay[0] ? v & 0x40 : v & 0x80;
    const mode = ((v & 0x20) ? 1 : 0) | (select ? 2 : 0) | ((v & 0x10) ? 4 : 0);
    if (mode === 1 || mode === 4 || mode === 7) chip.selectAddress(this.ayLatch & 0x0f);
    else if (mode === 6) chip.write(this.ayLatch);
  }

  private syncIrqEnables(): void {
    this.cpu.irq1Enabled = (this.rp5cr & 0x01) !== 0;
    this.cpu.irq2Enabled = (this.rp5cr & 0x02) !== 0;
    if (!(this.rp5cr & 0x02) && this.irq2Pending) {
      this.irq2Pending = false;
      this.cpu.setIRQ2(false);
    }
  }

  private characterCycles(): number {
    const bit = this.rmcr & 0x20 ? (this.tconr + 1) * 32 : 512;
    return bit * 10;
  }

  private transmit(val: number): void {
    this.txLog.push(val);
    if (this.txLog.length > 4096) this.txLog.shift();
    this.trcsr &= ~TRCSR_TDRE & 0xff;
    this.txCycles = this.characterCycles();
    this.txShifting = val & 0xff;
    this.updateInternalIrqs();
  }

  private updateInternalIrqs(): void {
    const oci =
      (this.tcsr & (TCSR_EOCI | TCSR_OCF)) === (TCSR_EOCI | TCSR_OCF) ||
      (this.tcsr2 & (TCSR2_EOCI2 | TCSR2_OCF2)) === (TCSR2_EOCI2 | TCSR2_OCF2);
    this.cpu.setInternalIRQ('oci', oci);
    this.cpu.setInternalIRQ('ici', (this.tcsr & (TCSR_EICI | TCSR_ICF)) === (TCSR_EICI | TCSR_ICF));
    this.cpu.setInternalIRQ('toi', (this.tcsr & (TCSR_ETOI | TCSR_TOF)) === (TCSR_ETOI | TCSR_TOF));
    this.cpu.setInternalIRQ('cmi', (this.tcsr3 & 0xc0) === 0xc0);
    this.cpu.setInternalIRQ('isi', (this.p6csr & 0xc0) === 0xc0);
    const rx = !!(this.trcsr & TRCSR_RIE) && !!(this.trcsr & (TRCSR_RDRF | TRCSR_ORFE));
    const tx = !!(this.trcsr & TRCSR_TIE) && !!(this.trcsr & TRCSR_TE) && !!(this.trcsr & TRCSR_TDRE);
    this.cpu.setInternalIRQ('sci', rx || tx);
  }

  private tickTimers(cycles: number): void {
    for (let i = 0; i < cycles; i++) {
      const next = (this.counter + 1) & 0xffff;
      if (next === this.ocr1) {
        this.tcsr |= TCSR_OCF;
        this.pendingTcsr |= TCSR_OCF;
      }
      if (next === this.ocr2) {
        this.tcsr2 |= TCSR2_OCF2;
        this.pendingTcsr2 |= TCSR2_OCF2;
      }
      if (next === 0) {
        this.tcsr |= TCSR_TOF;
        this.pendingTcsr |= TCSR_TOF;
      }
      this.counter = next;

      if (this.tcsr3 & 0x10) {
        const shift = (this.tcsr3 & 3) === 1 ? 8 : (this.tcsr3 & 3) === 2 ? 128 : 1;
        if ((this.tcsr3 & 3) !== 3 && ++this.t2divider >= shift) {
          this.t2divider = 0;
          this.t2cnt = (this.t2cnt + 1) & 0xff;
          if (this.t2cnt === ((this.tconr + 1) & 0xff)) {
            this.t2cnt = 0;
            this.tcsr3 |= 0x80;
          }
        }
      }
    }

    if (this.txCycles > 0) {
      this.txCycles -= cycles;
      if (this.txCycles <= 0) {
        this.txCycles = 0;
        this.trcsr |= TRCSR_TDRE;
        if (this.txShifting >= 0) {
          this.dataPak.receive(this.txShifting, this.cpu.cycles);
          this.txShifting = -1;
        }
      }
    }
    this.updateInternalIrqs();
  }

  step(): number {
    const cycles = this.cpu.step();
    this.tickMeters(1);
    this.tickTimers(cycles);
    this.sndport.tick(cycles);
    this.sndport.oki?.tick(cycles, E_CLOCK);
    this.ay[0].tick(cycles, E_CLOCK);
    this.ay[1].tick(cycles, E_CLOCK);

    if (this.coinCycles > 0) {
      this.coinCycles -= cycles;
      if (this.coinCycles <= 0) {
        this.inputs.switches[COIN_BYTE] &= ~this.coinMask & 0xff;
        this.coinCycles = 0;
        this.coinMask = 0;
      }
    }

    this.irq2Cycles += cycles;
    const irq2Period = Math.floor(E_CLOCK / IRQ2_HZ);
    if (this.irq2Cycles >= irq2Period) {
      this.irq2Cycles -= irq2Period;
      this.irq2Pending = true;
      this.cpu.setIRQ2(true);
    }

    if (this.reelpcb) {
      this.mcuDebt += cycles * (PCP_MCU_HZ / E_CLOCK);
      if (this.mcuDebt >= 1) this.mcuDebt -= this.reelpcb.run(this.mcuDebt);
      return cycles;
    }
    this.nmiCycles += cycles;
    const nmiPeriod = Math.floor(E_CLOCK / NMI_HZ);
    while (this.nmiCycles >= nmiPeriod) {
      this.nmiCycles -= nmiPeriod;
      this.cpu.setNMI(true);
      this.cpu.setNMI(false);
      this.reelctrl.tick(1);
      for (let i = 0; i < this.reelUnits.length; i++) {
        const u = this.reelUnits[i];
        const p = this.reelctrl.positions[i];
        const n = u.stepsPerRevolution;
        let d = p - u.position;
        if (d > n / 2) d -= n;
        else if (d < -n / 2) d += n;
        u.travel += d;
        u.position = p;
      }
    }
    return cycles;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  runFrame(): number {
    return this.run(Math.floor(E_CLOCK / 50));
  }
}
