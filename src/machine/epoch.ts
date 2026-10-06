import type { Bus16 } from '../cpu/bus68k';
import type { CabinetSwitch, CoinChute, Machine, MachineDisplay, OptionKey, DigitKind } from './machine';
import { newCashLedger, ledgerOutMults, dilSwitchLabel } from './machine';
import type { Reel } from '../hw/reel';
import { H83002 } from '../hw/h83002';
import { EpochAsic } from '../hw/epochasic';
import { EpochPic } from '../hw/epochpic';
import { DataPak } from '../hw/datapak';
import { EpochAlpha } from '../hw/epochalpha';
import { Ymz280b } from '../hw/ymz280b';
import { EpochReels } from '../hw/epochreels';
import { EpochCoin, findEpochCoinTables, findEpochHopperCoins, type EpochCoinTables, type EpochHopperCoin } from '../hw/epochcoin';
import { Hopper, v20Waveform } from '../hw/hopper';
import { Sec } from '../hw/sec';
import { EpochMatrix } from '../hw/epochmatrix';
import { SwitchedLamps } from '../hw/switchedlamps';
import type { ReelGeometry } from './layoutreels';
import { EPOCH_LAMP_LEVELS, LAMP_FULL } from './framestate';
import type { BoardPart } from './parts';
import { noteRomCut } from './boarddefaults';
import { StrayCounter } from './strayaccess';

const h8OwnRegister = (a: number): boolean =>
  (a >= 0xffffec && a <= 0xffffef) || a === 0xfffff1 || a === 0xfffff3;
import { ROM_UNPLACED } from './pairplacer';
import { COIN_RAW } from './coinraw';
import { COIN_NOTES } from './layoutcoins';
import type { LayoutSwitch } from './layoutswitches';

const YMZ_BASE = 0xfffc00;
const YMZ_END = 0xfffc04;
const ASIC_BASE = 0xffff10;
const ASIC_END = 0xffff1c;

const INPUT_BASE = 0x0c00;

const STAKE_WIRE = [0, 0, 1, 2, 3, 4, 5, 6];

const JACKPOT_WIRE = [0, 8, 6, 5, 7, 9, 10, 12, 13, 1, 2, 3, 4, 11, 14];

const PERCENT_NIBBLE = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];

const KEY_OFFSET = 1;

const STAKE_POSITIONS = ['-', '5p', '10p', '20p', '25p', '30p', '50p', '£1'];

const PERCENT_POSITIONS = ['-', '70%', '72%', '74%', '76%', '78%', '80%', '82%',
  '84%', '86%', '88%', '90%', '92%', '94%', '96%', '98%'];

const JACKPOT_POSITIONS = Array.from({ length: 15 }, (_, i) => `position ${i}`);

const key = (label: string, positions: string[], get: () => number,
  set: (v: number) => void): OptionKey => ({
  label,
  positions,
  position: () => Math.max(0, Math.min(positions.length - 1, get() + KEY_OFFSET)),
  fit(v) { set(Math.max(0, Math.min(positions.length - 1, v | 0)) - KEY_OFFSET); },
});
const LAMP_BASE = 0x0800;
const LED_BASE = 0x0a00;
const OUTPUT_BASE = 0x1000;

const FLASH_RATES = 0x1200;
const LAMP_DIM = 0x1218;
const DIP_BANK_1 = 0x121a;
const DIP_BANK_2 = 0x121b;

export class Epoch implements Machine {
  readonly digitKind: DigitKind = 'sc4';
  readonly clockHz = 16_000_000;

  private readonly rom = new Uint8Array(0x200000);
  private romLength = 0;
  private readonly ram = new Uint8Array(0x10000);

  private readonly dev: H83002;
  private readonly asic: EpochAsic;

  readonly pic = new EpochPic(this.clockHz);

  readonly ymz = new Ymz280b();

  private readonly coin = new EpochCoin((n, on) => this.setSwitch(n, on));
  coinTables: EpochCoinTables | null = null;

  static readonly MFME_COIN_IDS: readonly number[] = [28, 68, 27, 25, 24, 23, 29, 26];
  private static readonly MFME_ROW2_LINES: readonly number[] = [18, 19, 20, 21, 22];

  static readonly HOPPER_WAVEFORM = v20Waveform(1, { beam: 0x28, gap: 0x96 });

  private readonly hoppers = [new Hopper(this.clockHz, Epoch.HOPPER_WAVEFORM), new Hopper(this.clockHz, Epoch.HOPPER_WAVEFORM)];

  hopperType = 0;

  readonly matrix = new EpochMatrix();

  readonly sec = new Sec();

  private secLines = 0;

  readonly cashLedger = newCashLedger();
  private static readonly HOPPER_PENCE: (number | null)[] = [100, null];
  private hopperCoinRecords: [EpochHopperCoin | null, EpochHopperCoin | null] = [null, null];
  hopperPriceIsDefault(): boolean {
    return this.hopperCoinRecords[0] === null;
  }
  private readonly paidBooked = [0, 0];
  hopperOutPence = 0;
  readonly hopperEjects = [0, 0];

  static readonly METER_UNIT_PENCE = 10;
  static readonly SEC_UNIT_PENCE = 10;
  private meterOutPence: number[] = [];
  private secOutMult: number[] = [];

  setMeterMoney(outMult: readonly number[], inMult: readonly number[] = []): void {
    this.moneyGrid.meterOut = [...outMult];
    this.moneyGrid.meterIn = [...inMult];
    this.relayLedgerMults();
  }

  setSecMoneyMap(secOut: readonly number[], secIn: readonly number[] = []): void {
    this.secOutMult = [...secOut];
    this.moneyGrid.secIn = [...secIn];
    this.relayLedgerMults();
  }

  private readonly moneyGrid = { meterIn: [] as number[], meterOut: [] as number[], secIn: [] as number[] };
  private secLedgerMult: number[] = [];
  private relayLedgerMults(): void {
    const [meters, secs] = ledgerOutMults(
      { in: this.moneyGrid.meterIn, out: this.moneyGrid.meterOut },
      { in: this.moneyGrid.secIn, out: this.secOutMult },
    );
    this.meterOutPence = meters.map((x) => x * Epoch.METER_UNIT_PENCE);
    this.secLedgerMult = secs;
  }

  pricesOut(): boolean {
    return this.meterOutPence.some((p) => p > 0) || this.secLedgerMult.some((x) => x > 0);
  }

  pricesOutAtSec(): boolean {
    return this.secLedgerMult.some((x) => x > 0);
  }

  readonly meterCounts = new Uint32Array(8);
  private static readonly METER_TICK_CYCLES = 0x1f40;
  private static readonly METER_HOLD_TICKS = 5;
  private readonly meterHold = new Uint8Array(8);
  private meterWord = 0;
  private meterSlot = 0;
  private meterAcc = 0;

  private readonly switches = new Uint8Array(8);

  private bank1Row = 0;

  private static readonly SWITCH_IDLE = [0, 0, 0, 0, 0, 0, 0x80, 0x01];

  private readonly switchIdle = Uint8Array.from(Epoch.SWITCH_IDLE);
  private bank1Idle = 0;

  private panel: LayoutSwitch[] = [];

  setLayoutSwitches(list: readonly LayoutSwitch[]): void {
    const wanted = list.filter((s) => s.number >= 0 && s.number < 64);
    if (!wanted.length) return;
    this.panel = wanted.map((s) => ({ ...s }));
    this.switches.set(this.switchIdle);
    this.bank1Row = this.bank1Idle;
    for (const s of wanted) this.layoutInput(s.number, s.closed);
    this.switchIdle.set(this.switches);
    this.bank1Idle = this.bank1Row;
  }

  clearIdleDoors(): void {
    for (const id of [24, 39]) {
      if (this.panel.some((s) => s.number === id)) continue;
      this.layoutInput(id, false);
    }
    this.switchIdle.set(this.switches);
    this.bank1Idle = this.bank1Row;
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    if (id < 0 || id > 63) return;
    this.layoutInput(id, made);
    this.switchIdle.set(this.switches);
    this.bank1Idle = this.bank1Row;
    if (this.panel.length && !this.panel.some((s) => s.number === id)) {
      this.panel.push({ number: id, label, closed: made });
    }
  }

  private layoutLevel(id: number): boolean {
    const row = id >> 3;
    const bit = 1 << (id & 7);
    if (row === 7) return (this.bank1Row & bit) !== 0;
    return (this.switches[Epoch.RECORD_SLOT_OF_ROW[row]] & bit) !== 0;
  }

  stakeKey = 0;
  jackpotKey = 0;
  percentKey = 0;

  private inputBank = 0;

  inhibits = 0;
  diverter = 0;

  private readonly mechLamps = new SwitchedLamps(3);
  private readonly inhibitLamps = new SwitchedLamps(8);
  private inhibitShown = 0xff;

  readonly meterSounds = new Uint32Array(8);

  get meterLevels(): number {
    return (this.meterWord & 0xff) | (this.ram[OUTPUT_BASE + 1] & 0x04 ? 0x10 : 0);
  }

  dips = [0, 0];

  get switchPanel(): CabinetSwitch[] {
    const rows: CabinetSwitch[] = this.panel.map((s) => ({
      id: s.number,
      label: s.label.replace(/\s+/g, ' ').trim() || `Switch ${s.number}`,
      on: this.layoutLevel(s.number),
      group: 'Layout switches',
    }));
    for (let i = 0; i < 16; i++) {
      rows.push({
        id: Epoch.DIL_ID_BASE + i,
        label: dilSwitchLabel(`DIL ${(i & 7) + 1} Bank ${i < 8 ? 1 : 2}`, this.dilLabels?.[i]),
        on: (this.dips[i >> 3] & (1 << (i & 7))) !== 0,
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

  private drive = new EpochReels([]);

  get reels(): readonly Reel[] {
    return this.drive.reels;
  }

  setReelPosition(i: number, pos: number): void {
    this.drive.setPosition(i, pos);
  }

  setReelGeometry(geometry: readonly ReelGeometry[], reelBoard: 3 | 6 = 3): void {
    this.drive = new EpochReels(geometry, { reelBoard });
  }

  panelBytes(): Uint8Array {
    const out = new Uint8Array(32 + this.matrix.frame.length);
    const cells = (this.display as EpochAlpha).dot.cells;
    for (let i = 0; i < 16; i++) {
      out[i] = cells[i] & 0xff;
      out[16 + i] = ((cells[i] >> 8) & 0x7f) | (cells[i] & 0x20000 ? 0x80 : 0);
    }
    out.set(this.matrix.frame, 32);
    return out;
  }

  get parts(): BoardPart[] {
    const hex = (a: number): string => `$FE${a.toString(16).padStart(4, '0').toUpperCase()}`;
    return [
      { id: 'lamps', label: '512 LAMPS', part: `${hex(LAMP_BASE)} - one byte each`,
        device: this.ram, signal: 'lamps' },
      { id: 'leds', label: '512 LEDs', part: `${hex(LED_BASE)} - unused` },
      { id: 'switches', label: '64 SWITCHES', part: 'input record', device: this.switches },
      { id: 'coins', label: 'COIN INPUTS', part: 'stakes and prizes board',
        device: this.coin, signal: 'coin' },

      { id: 'mux', label: 'LINK BUS RECORDS',
        part: '$FE0C00 inputs - $FE1000 outputs, swept by the ASIC',
        device: this.asic },
      { id: 'psu', label: 'PSU', part: 'power in' },

      { id: 'ram', label: 'BATTERY RAM', part: '64K - $FE0000', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: 'up to 2M - .g0/.g1 (+ .g2/.g3) pairs', device: this.rom },
      { id: 'pic', label: 'SECURITY PIC', part: 'bit-banged on port A', device: this.pic },
      { id: 'ymz', label: 'SOUND', part: 'YMZ280B - 4M samples',
        device: this.ymz, io: [[YMZ_BASE, YMZ_END]] },
      { id: 'alpha', label: 'ALPHA', part: 'front door board',
        device: this.display, signal: 'display' },

      { id: 'cpu', label: 'CPU', part: 'HD6413002FN16 - 16 MHz', device: this.dev.cpu, cpu: true },
      { id: 'asic', label: 'ASIC', part: '$FFFF10 - owns all I/O',
        device: this.asic, io: [[ASIC_BASE, ASIC_END]] },
      { id: 'sci', label: 'SCI', part: 'on-chip serial', device: this.dev.sci[0] },
      { id: 'ports', label: 'PORTS', part: 'on-chip I/O', device: this.dev.portA },

      { id: 'reels', label: 'REEL DRIVER', part: 'six 15-way plugs',
        device: this.drive, signal: 'reels' },
      { id: 'meters', label: 'METERS', part: 'output slot 6 - MET1-6', device: this.meterCounts },
      { id: 'sec', label: 'SEC', part: 'protected counters - ports 6 and B', device: this.sec },
      { id: 'hopper', label: 'HOPPER', part: 'output record' },
      { id: 'coinmech', label: 'COIN MECH', part: 'acceptor',
        device: this.coin, signal: 'coin' },
    ];
  }
  readonly display: MachineDisplay = new EpochAlpha();
  get audioSource(): Ymz280b {
    return this.ymz;
  }

  loadSoundRoms(first: Uint8Array, second?: Uint8Array): void {
    const sample = new Uint8Array(0x400000);
    sample.set(first.subarray(0, 0x80000), 0x000000);
    if (second) sample.set(second.subarray(0, 0x80000), 0x080000);
    this.ymz.loadRom(sample);
  }

  readonly optionKeys: readonly OptionKey[] = [
    key('Stake', STAKE_POSITIONS, () => this.stakeKey, (v) => { this.stakeKey = v; }),
    key('Jackpot', JACKPOT_POSITIONS, () => this.jackpotKey, (v) => { this.jackpotKey = v; }),
    key('Percentage', PERCENT_POSITIONS, () => this.percentKey, (v) => { this.percentKey = v; }),
  ];

  constructor() {
    const board: Bus16 = {
      read8: (a) => this.read8(a),
      write8: (a, v) => this.write8(a, v),
      read16: (a) => this.read16(a),
      write16: (a, v) => this.write16(a, v),
    };
    this.dev = new H83002(board);
    this.asic = new EpochAsic(this.dev.intc);
    this.asic.onDisplayReset = () => {
      (this.display as EpochAlpha).dot.reset();
      this.mechLamps.resetDark();
      this.inhibitLamps.resetDark();
    };
    this.asic.onScan = () => {
      if (this.inhibits === this.inhibitShown) return;
      this.inhibitShown = this.inhibits;
      this.inhibitLamps.write(~this.inhibits & 0xff);
    };
    this.asic.onMatrixCommit = (bank) => this.matrix.commit(this.ram, bank << 10, bank);

    this.dev.portA.forcedInputs = 0x08;
    this.dev.portA.inputSource = () => (this.pic.oscillator ? 0x08 : 0x00);
    this.dev.port8.forcedInputs = 0x07;
    this.dev.port8.inputSource = () => (this.pic.dataOut ? 0x04 : 0x00);
    this.dev.portA.onOutput = () => {
      const dr = this.dev.portA.drR();
      this.pic.setClock((dr & 0x02) !== 0);
      this.pic.setData((dr & 0x04) !== 0);
    };

    this.sec.fitV20(true);
    this.sec.onCount = (meter, delta) => {
      const mult = this.secLedgerMult[meter] ?? 0;
      if (mult && delta > 0) this.cashLedger.outPence += mult * delta * Epoch.SEC_UNIT_PENCE;
    };
    this.dev.portB.inputSource = () => (this.sec.data() ? 0x10 : 0x00);
    this.dev.port6.onOutput = () => this.driveSec();
    this.dev.portB.onOutput = () => this.driveSec();

    this.dev.sci[0].onTransmit = (b) => this.onDataPakTx(b);
  }

  private driveSec(): void {
    const v = (((this.dev.port6.levels(0x06) & 0x06) << 5)
      | (this.dev.portB.levels(0x21) & 0x3f)) & 0xff;
    const changed = v ^ this.secLines;
    this.secLines = v;
    if (!changed) return;
    if (changed & 0x80) this.sec.setCS((v & 0x80) !== 0);
    if (changed & 0x40) this.sec.setData((v & 0x40) !== 0);
    if (changed & 0x20) {
      this.sec.lineCall(this.dev.cpu.totalCycles);
      this.sec.setClock((v & 0x20) !== 0);
    }
  }

  readonly dataPak = new DataPak(this.clockHz);
  private dataPakType = 0;
  private dataPakOut: number[] = [];
  private dataPakWait = 0;
  private static readonly DATAPAK_TURNAROUND = 50_000;

  fitDataPak(type: number): void {
    this.dataPakType = type;
  }

  private onDataPakTx(b: number): void {
    if (this.dataPakType === 0) return;
    if (this.dataPakType === 2) {
      this.dev.sci[0].receive(b);
      return;
    }
    const reply = this.dataPak.receive(b, this.dev.cpu.totalCycles);
    if (!reply) return;
    if (this.dataPakOut.length === 0) this.dataPakWait = Epoch.DATAPAK_TURNAROUND;
    this.dataPakOut.push(...reply);
  }

  private tickDataPak(cycles: number): void {
    this.dataPakWait -= cycles;
    while (this.dataPakOut.length && this.dataPakWait <= 0) {
      this.dev.sci[0].receive(this.dataPakOut.shift()!);
      this.dataPakWait += Epoch.DATAPAK_TURNAROUND;
    }
  }

  loadRom(bytes: Uint8Array): void {
    this.rom.fill(ROM_UNPLACED);
    noteRomCut(this, bytes.length, this.rom.length);
    this.rom.set(bytes.subarray(0, this.rom.length));
    this.romLength = Math.min(bytes.length, this.rom.length);
    this.coinTables = findEpochCoinTables(this.rom.subarray(0, this.romLength));
    this.hopperCoinRecords = findEpochHopperCoins(this.rom.subarray(0, this.romLength));
    this.coin.setSwitches(this.coinTables ? this.coinTables.codeSwitches : Epoch.MFME_ROW2_LINES);
  }

  get coinChutes(): CoinChute[] | undefined {
    if (!this.coinTables) {
      return Epoch.MFME_COIN_IDS.map((id) => {
        const n = COIN_NOTES.get(id)!;
        return { label: n.name.replace(/ EPOCH$/, ''), bit: id, pence: n.pence, token: n.token, note: id };
      });
    }
    return this.coinTables.records.map((r, i) => ({ label: r.name, bit: i, pence: r.pence, token: r.token }));
  }

  static interleave(g0: Uint8Array, g1: Uint8Array): Uint8Array {
    const rom = new Uint8Array(Math.max(g0.length, g1.length) * 2);
    for (let i = 0; i < g0.length; i++) rom[i * 2] = g0[i];
    for (let i = 0; i < g1.length; i++) rom[i * 2 + 1] = g1[i];
    return rom;
  }

  loadNvram(bytes: Uint8Array): void {
    this.ram.set(bytes.subarray(0, this.ram.length));
  }

  nvram(): Uint8Array {
    return this.ram.slice();
  }

  powerCycle(): void {
    this.reset();
  }

  reset(): void {
    this.switches.set(this.switchIdle);
    this.pic.reset();
    this.drive.reset();
    this.coin.reset();
    this.hoppers[0].reset();
    this.hoppers[1].reset();
    this.paidBooked[0] = 0;
    this.paidBooked[1] = 0;
    this.meterHold.fill(0);
    this.meterWord = 0;
    this.meterSlot = 0;
    this.meterAcc = 0;
    this.ymz.reset();
    this.inputBank = 0;
    this.bank1Row = this.bank1Idle;
    this.inhibits = 0;
    this.diverter = 0;
    this.mechLamps.reset();
    this.inhibitLamps.reset();
    this.inhibitShown = 0xff;
    (this.display as EpochAlpha).clear();
    this.secLines = 0xff;
    this.dev.reset();
    this.asic.reset();
    this.dataPak.reset();
    this.dataPakOut = [];
    this.dataPakWait = 0;
    this.sec.reset();
    this.secLines = 0xff;
    this.matrix.reset();
  }

  step(): number {
    const cycles = this.dev.step();
    this.asic.soundFlag = this.ymz.irqLine;
    this.asic.tick(cycles);
    this.pic.tick(cycles);
    if (this.dataPakOut.length) this.tickDataPak(cycles);
    this.drive.tick(cycles);
    this.coin.tick(cycles);
    this.hoppers[0].tick(cycles);
    this.hoppers[1].tick(cycles);
    for (let h = 0; h < 2; h++) {
      const paid = this.hoppers[h].paid;
      const fresh = paid - this.paidBooked[h];
      if (fresh > 0) {
        const coin = this.hopperCoinRecords[h];
        const pence = coin ? coin.pence : Epoch.HOPPER_PENCE[h];
        const token = coin?.token === true;
        if (!token) this.hopperOutPence += fresh * (pence ?? 0);
        this.hopperEjects[h] += fresh;
        if (!this.pricesOut()) {
          if (pence === null) this.cashLedger.unpricedOut += fresh;
          else if (token) this.cashLedger.tokenOutPence += fresh * pence;
          else this.cashLedger.outPence += fresh * pence;
        }
        this.paidBooked[h] = paid;
      }
    }
    this.meterAcc += cycles;
    if (this.meterAcc >= Epoch.METER_TICK_CYCLES) this.tickMeters();
    this.ymz.tick(cycles, this.clockHz);
    return cycles;
  }

  private writeSlot1(was: number, v: number): void {
    const diff = was ^ v;
    if ((diff & 0x04) && (v & 0x04)) this.meterSounds[4]++;
    if (diff & 0x38) this.mechLamps.write((v & 0x38) >> 3);
  }

  private writeMeters(val: number): void {
    const v = val & 0xff;
    const changed = this.meterSlot ^ v;
    this.meterSlot = v;
    if (!(changed & 0x0f)) return;
    const diff = this.meterWord ^ v;
    for (let b = 0; b < 8; b++) {
      const bit = 1 << b;
      if (diff & bit) this.meterHold[b] = v & bit ? Epoch.METER_HOLD_TICKS : 0;
    }
    this.meterWord = v;
  }

  private tickMeters(): void {
    while (this.meterAcc >= Epoch.METER_TICK_CYCLES) {
      this.meterAcc -= Epoch.METER_TICK_CYCLES;
      for (let b = 0; b < 8; b++) {
        if (!(this.meterWord & (1 << b)) || this.meterHold[b] === 0) continue;
        if (--this.meterHold[b] === 0) {
          this.meterCounts[b]++;
          this.cashLedger.outPence += this.meterOutPence[b] ?? 0;
        }
      }
    }
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  private read16(addr: number): number {
    const a = addr & 0xffffff;
    if ((a & 1) === 0) {
      if (a + 1 < this.romLength) return (this.rom[a] << 8) | this.rom[a + 1];
      if (a >= 0xfe0000 && a < 0xff0000) {
        const off = a - 0xfe0000;
        if ((off < INPUT_BASE || off >= INPUT_BASE + 0x200) && off !== DIP_BANK_1) {
          return (this.ram[off] << 8) | this.ram[off + 1];
        }
      }
    }
    return (this.read8(a) << 8) | this.read8(a + 1);
  }

  private write16(addr: number, val: number): void {
    const a = addr & 0xffffff;
    if ((a & 1) === 0 && a >= 0xfe0000 && a < 0xff0000) {
      const off = a - 0xfe0000;
      if (off + 1 < OUTPUT_BASE || off >= OUTPUT_BASE + 8) {
        this.ram[off] = (val >> 8) & 0xff;
        this.ram[off + 1] = val & 0xff;
        return;
      }
    }
    this.write8(a, val >> 8);
    this.write8(a + 1, val & 0xff);
  }

  private read8(addr: number): number {
    const a = addr & 0xffffff;
    if (a < this.romLength) return this.rom[a];
    if (a >= 0x40000 && a < 0x4ffff) { this.strays.hit(a); return 0xff; }
    if (a === YMZ_BASE) return this.ymz.read(0);
    if (a === YMZ_BASE + 2) return this.ymz.read(1);
    if (a >= ASIC_BASE && a < ASIC_END) return this.asic.read8(a);
    if (a >= 0xfe0000 && a < 0xff0000) {
      const off = a - 0xfe0000;
      if (off >= INPUT_BASE && off < INPUT_BASE + 0x200) return this.readInput(off);
      if (off === DIP_BANK_1) return this.dips[1] & 0xff;
      if (off === DIP_BANK_2) return this.dips[0] & 0xff;
      return this.ram[off];
    }
    if (!h8OwnRegister(a)) this.strays.hit(a);
    return 0;
  }

  readonly strays = new StrayCounter();

  private write8(addr: number, val: number): void {
    const a = addr & 0xffffff;
    if (a === YMZ_BASE) { this.ymz.write(0, val); return; }
    if (a === YMZ_BASE + 2) { this.ymz.write(1, val); return; }
    if (a >= ASIC_BASE && a < ASIC_END) { this.asic.write8(a, val); return; }
    if (a >= 0xfe0000 && a < 0xff0000) {
      const off = a - 0xfe0000;
      if (off < 0x800 && this.ram[off] !== (val & 0xff)) this.asic.markMatrixDirty(off >> 10);
      const was = this.ram[off];
      this.ram[off] = val & 0xff;
      if (off === OUTPUT_BASE) (this.display as EpochAlpha).writeData(val);
      else if (off === OUTPUT_BASE + 1) {
        this.writeSlot1(was, val & 0xff);
        (this.display as EpochAlpha).writeControl(val);
      }
      else if (off === OUTPUT_BASE + 2) {
        this.inputBank = val & 0xff;
        this.inhibits = val & 0xff;
      } else if (off === OUTPUT_BASE + 3) this.diverter = val & 0xff;
      else if (off === OUTPUT_BASE + 4) this.drive.write(0, val);
      else if (off === OUTPUT_BASE + 5) this.drive.write(1, val);
      else if (off === OUTPUT_BASE + 6) this.writeMeters(val);
      else if (off === OUTPUT_BASE + 7) this.writeHopperDrive(val);
      return;
    }
    if (a >= this.romLength && !h8OwnRegister(a)) this.strays.hit(a);
  }

  private writeHopperDrive(val: number): void {
    const v = val & 0xff;
    switch (this.hopperType) {
      case 1:
      case 4: {
        const drive = (v & (this.hopperType === 1 ? 0x08 : 0x40)) !== 0;
        if ((v & 0x02) !== 0) {
          this.hoppers[0].motorDrive(false);
          this.hoppers[0].optoDriveLine(drive);
        } else {
          this.hoppers[0].optoDriveLine(false);
          this.hoppers[0].motorDrive(drive);
        }
        this.hoppers[1].motorDrive(false);
        this.hoppers[1].optoDriveLine(false);
        return;
      }
      case 2:
      case 3: {
        this.hoppers[0].optoDriveLine(false);
        this.hoppers[0].motorDrive((v & 0x40) !== 0);
        if (this.hopperType === 2) {
          this.hoppers[1].optoDriveLine(false);
          this.hoppers[1].motorDrive((v & 0x80) !== 0);
        }
        return;
      }
      default: {
        const opto = (v & 0x20) !== 0;
        this.hoppers[0].optoDriveLine(opto);
        this.hoppers[1].optoDriveLine(opto);
        this.hoppers[0].motorDrive((v & 0x40) !== 0);
        this.hoppers[1].motorDrive((v & 0x80) !== 0);
      }
    }
  }

  private hopperSense(): number {
    switch (this.hopperType) {
      case 1:
      case 3:
        return this.hoppers[0].runPin();
      case 4:
        return 1 - this.hoppers[0].runPin();
      default:
        return this.hoppers[0].senseBit() | (this.hoppers[1].senseBit() << 1);
    }
  }

  get hopperPaid(): number[] {
    return this.hoppers.map((h) => h.paid);
  }

  private readInput(off: number): number {
    if (off > INPUT_BASE + this.asic.inputBytes) return 0;
    const v = this.inputSlot(off);
    this.ram[off] = v;
    return v;
  }

  lampTestPass = true;

  private inputSlot(off: number): number {
    const stake = STAKE_WIRE[this.stakeKey + KEY_OFFSET] ?? 0;
    const jackpot = JACKPOT_WIRE[this.jackpotKey + KEY_OFFSET] ?? 0;
    const percent = PERCENT_NIBBLE[(this.percentKey + KEY_OFFSET) & 0xf];
    const slot = off & 0xf;
    switch (slot) {
      case 3:
        if (this.inputBank & 1) return (stake & 4) | this.bank1Row;
        return (percent << 4)
          | this.switches[3]
          | ((stake & 1) << 3) | ((stake & 2) * 2)
          | ((jackpot & 8) >> 2) | ((jackpot & 4) >> 2);
      case 4:
        if (this.drive.reelBoard === 6) return (this.drive.optics() << 2) & 0xfc;
        return (this.drive.optics() << 4) & 0xf0;
      case 1:
        return this.switches[1] | (this.lampTestPass ? 0x80 : 0);
      case 2:
        return this.switches[2] | 0x01
          | ((jackpot & 1) << 6) | ((jackpot & 2) << 6);
      case 5:
        return this.switches[5] | 0x40 | this.hopperSense();
      default:
        return slot < 8 ? this.switches[slot] : 0;
    }
  }

  get lamps(): Uint8Array {
    const out = this.lampOut;
    out.set(this.ram.subarray(LAMP_BASE, LAMP_BASE + 0x200));
    for (let n = 0x200; n < 0x210; n++) out[n] = this.switchedLamp(n) ? 0x01 : 0;
    return out;
  }

  private readonly lampOut = new Uint8Array(0x210);

  private switchedLamp(n: number): boolean {
    const k = n - 0x200;
    if (k < 3) return this.mechLamps.shown[k] !== 0;
    if (k >= 8 && k < 16) return this.inhibitLamps.shown[k - 8] !== 0;
    return false;
  }

  layoutLamp(n: number): boolean {
    if (n >= 0x200 && n < 0x210) return this.switchedLamp(n);
    if (n < 0 || n >= 0x200) return false;
    const b = this.ram[LAMP_BASE + n];
    if ((b & 1) === 0) return false;
    const rate = (b >> 1) & 7;
    if (rate === 0) return true;
    return ((this.lampPhase() >> (Math.min(rate, 6) - 1)) & 1) !== (b >> 7);
  }

  lampPhase(): number {
    const ms = this.clockHz / 1000;
    const cycles = this.dev.cpu.totalCycles;
    let bits = 0;
    for (let i = 0; i < 6; i++) {
      const a = FLASH_RATES + i * 2;
      const on = (this.ram[a + 1] === 1 ? 2 : this.ram[a + 1]) * 12 * ms;
      const off = (this.ram[a] === 1 ? 2 : this.ram[a]) * 12 * ms;
      const period = on + off;
      if (period > 0 && cycles % period >= on) bits |= 1 << i;
    }
    return bits;
  }

  layoutLampLevel(n: number): number {
    if (!this.layoutLamp(n)) return 0;
    if (n >= 0x200) return LAMP_FULL;
    return (this.ram[LAMP_BASE + n] & 0x40)
      ? EPOCH_LAMP_LEVELS[this.lampDim()] : LAMP_FULL;
  }

  lampDim(): number {
    return this.ram[LAMP_DIM] & 7;
  }

  get segDigits(): Uint8Array {
    const out = new Uint8Array(32);
    for (let k = 0; k < 32; k++) {
      const base = LED_BASE + (k & 16 ? 128 : 0) + (k & 15);
      let row = 0;
      for (let b = 0; b < 8; b++) if (this.ram[base + (b << 4)] & 1) row |= 1 << b;
      out[k] = row;
    }
    return out;
  }

  layoutDigit(n: number): number {
    return n >= 0 && n < 32 ? this.segDigits[n] : 0;
  }

  setSwitch(n: number, on: boolean): void {
    if (n < 1 || n > 64) return;
    const byte = (n - 1) >> 3;
    const bit = 1 << ((n - 1) & 7);
    if (on) this.switches[byte] |= bit;
    else this.switches[byte] &= ~bit;
  }

  pinHostClock(at: Date | null): void {
    this.pic.pin(at);
  }

  layoutInput(id: number, on: boolean): void {
    if (id >= Epoch.DIL_ID_BASE && id < Epoch.DIL_ID_BASE + 16) {
      const n = id - Epoch.DIL_ID_BASE;
      const mask = 1 << (n & 7);
      const b = n >> 3;
      this.dips[b] = on ? this.dips[b] | mask : this.dips[b] & ~mask & 0xff;
      return;
    }
    if (id < 0 || id > 63) return;
    const row = id >> 3;
    const bit = 1 << (id & 7);
    if (row === 7) {
      this.bank1Row = on ? this.bank1Row | bit : this.bank1Row & ~bit;
      return;
    }
    const slot = Epoch.RECORD_SLOT_OF_ROW[row];
    if (on) this.switches[slot] |= bit;
    else this.switches[slot] &= ~bit;
  }

  private static readonly RECORD_SLOT_OF_ROW = [0, 1, 2, 7, 6, 3, 5];

  insertCoin(index: number): void {
    const t = this.coinTables;
    if (!t) {
      this.insertMfmeCoin(index);
      return;
    }
    const coin = t.records[index];
    if (!coin) return;
    const mode = this.mechMode();
    const code = coin.codes[mode] ?? 0;
    if (code !== 0 && !this.coin.busy && coin.pence !== null) {
      if (coin.token) this.cashLedger.tokenInPence += coin.pence;
      else this.cashLedger.inPence += coin.pence;
    }
    this.coin.insertCode(code);
  }

  private insertMfmeCoin(id: number): void {
    if (!Epoch.MFME_COIN_IDS.includes(id)) return;
    const raw = COIN_RAW[id];
    const note = COIN_NOTES.get(id);
    if (raw === undefined || !note || (raw & ~0x3e) !== 0) return;
    if (!this.coin.busy && note.pence !== null) {
      if (note.token) this.cashLedger.tokenInPence += note.pence;
      else this.cashLedger.inPence += note.pence;
    }
    this.coin.insertCode(raw >> 1);
  }

  mechMode(): number {
    const t = this.coinTables;
    if (!t) return -1;
    return (this.ram[t.modeWord] << 8) | this.ram[t.modeWord + 1];
  }

  get coinBusy(): boolean {
    return this.coin.busy;
  }
}
