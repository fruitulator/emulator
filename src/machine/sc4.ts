import type { Bus16 } from '../cpu/bus68k';
import type { Machine, OptionKey, DigitKind, NoteResult, CoinPortLines, CoinWiringStatus } from './machine';
import { newCashLedger, ledgerOutMults, dilSwitchLabel, type CabinetSwitch } from './machine';
import type { BoardPart } from './parts';
import { everyNth } from './schematic';
import { M68000 } from '../cpu/m68000';
import { M68307Sim, SIM_BASE } from '../hw/m68307';
import { opticWindowForFlag } from '../layout/datreels';
import { Eeprom24c } from '../hw/eeprom';
import { findSecurityKey, Sc4Mbus } from '../hw/sc4mbus';
import { Mc68681 } from '../hw/mc68681';
import { Sec } from '../hw/sec';
import { Sc4HopperPair, locateSc4PayoutUnits, readSc4HopperCoins, type Sc4Coin, type Sc4HopperCoins, type Sc4PayoutUnits } from '../hw/sc4hoppers';
import { JcmEba, Sch2Hopper, deviceFor } from '../hw/cctalk';
import type { BnvKey } from '../hw/cctalkbnv';
import { SwitchedLamps } from '../hw/switchedlamps';
import { DataPak } from '../hw/datapak';
import { MeterConfirm } from '../hw/meterconfirm';
import { SteppedVolume, v9Sc4Gain } from '../hw/steppedvolume';
import { BfmLed } from '../hw/bfmled';
import { Ymz280b } from '../hw/ymz280b';
import { Bda } from '../hw/bda';
import { Bd1 } from '../hw/bd1';
import { Reel } from '../hw/reel';
import { percentageCode, prizeCode, sc4StakeBits } from '../hw/bfmkeys';
import type { LayoutSwitch } from './layoutswitches';
import { fitReelBank, type ReelFit } from './reelfit';
import { noteBoardDefault, noteRomCut } from './boarddefaults';
import { ROM_UNPLACED } from './pairplacer';
import { resetReelsInPlace } from './v20optic';
import { lockoutRefuses, lockoutRefusing, type CoinLockoutWiring } from '../hw/coinlockout';
import { COIN_RAW } from './coinraw';
import { linesOf, type CoinLineTable, type CoinWiring, type SlotCoin, type StepState, wiringKey, wiringStateFor } from './coinwiring';
import { COIN_NOTES, COIN_NOTE_BLANK, type DeclaredCoin } from './layoutcoins';
import { locateSc4CoinTables, sc4CoinTable, sc4ProgramCoin, sc4TokenLine, SC4_COIN_LINES, type Sc4CoinTables, type Sc4Mem, type Sc4ProgramCoin } from './sc4coins';

export const MASTER_CLOCK = 16_000_000;

const ROM_SIZE = 0x200000;
const ROM_MASK = ROM_SIZE - 1;
const RAM_BASE = 0x800000;
const RAM_SIZE = 0x010000;
const IO_BASE = 0x810000;
const IO_SIZE = 0x010000;

const YMZ_OFF = 0x1245;
const YMZ_OFF_END = 0x124c;
const SEC_OFF_A = 0x0331;
const SEC_OFF_B = 0x1331;
const LATCH_A = 0x0001;
const LATCH_B = 0x1001;
const DUART_BASE = 0xc00000;

const REEL_STOP_LOOP = Uint8Array.of(0x70, 0x00, 0x10, 0x12, 0xd0, 0x40, 0x72, 0x00, 0x12, 0x13, 0x90, 0x41);
const MOVEA_L_A3 = 0x267c;
const LOOP_HEAD_BACK = 0xa0;

export function findReelStopArray(rom: Uint8Array): number | undefined {
  const at = indexOfBytes(rom, REEL_STOP_LOOP);
  if (at < 0) return undefined;
  for (let j = at - 2; j >= Math.max(0, at - LOOP_HEAD_BACK); j -= 2) {
    if ((rom[j] << 8 | rom[j + 1]) !== MOVEA_L_A3) continue;
    const addr = (rom[j + 2] << 24 | rom[j + 3] << 16 | rom[j + 4] << 8 | rom[j + 5]) >>> 0;
    return addr >= RAM_BASE && addr + 4 <= RAM_BASE + RAM_SIZE ? addr - RAM_BASE : undefined;
  }
  return undefined;
}

function indexOfBytes(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i += 2) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}

export interface IoAccess {
  addr: number;
  reads: number;
  writes: number;
}

export class Sc4 implements Bus16, Machine {
  static readonly snapshotConfig: readonly string[] = ['nvram', 'wiring', 'coinSlots', 'coinTablesCache', 'coinLinePattern', 'tokenLine', 'programMem'];
  readonly digitKind: DigitKind = 'sc4';
  readonly cpu: M68000;
  readonly sim: M68307Sim;
  readonly eeprom = new Eeprom24c();
  readonly mbus = new Sc4Mbus(this.eeprom);
  readonly duart = new Mc68681({
    irqChanged: () => this.refreshExternalInt(),
    txByte: (ch, v) => this.duartTx(ch, v),
    outputPort: (v) => {
      const r4 = this.reels[4];
      const r5 = this.reels[5];
      if (r4) { r4.traceClock = this.cpu.cycles >>> 0; r4.update(v & 0x0f); }
      if (r5) { r5.traceClock = this.cpu.cycles >>> 0; r5.update((v >> 4) & 0x0f); }
      this.updateOptics();
    },
  });

  private payFrame: number[] = [];
  private readonly ccHoppers = new Map<number, Sch2Hopper>();
  private serialHopperModels: readonly string[] = ['SCH 2', 'SCH 2'];

  setSerialHoppers(models: readonly (string | null)[]): void {
    this.serialHopperModels = [models[0] ?? 'SCH 2', models[1] ?? 'SCH 2'];
  }

  private lastPayTxCycle = 0;

  private duartTx(ch: 0 | 1, v: number): void {
    if (ch !== 1) return;
    this.duart.receive(1, v);
    if (this.totalCycles - this.lastPayTxCycle > 100_000) this.payFrame = [];
    this.lastPayTxCycle = this.totalCycles;
    const f = this.payFrame;
    f.push(v & 0xff);
    if (f.length >= 5 && f.length === 5 + (f[1] ?? 0)) {
      this.ccTalkReply(f);
      this.payFrame = [];
    } else if (f.length > 32) {
      f.shift();
    }
  }

  private ccReply: { at: number; b: number }[] = [];

  private static readonly CC_REPLY_DELAY = 48_000;
  private static readonly CC_BYTE_GAP = 16_000;

  private ccNoteReply(v: JcmEba, f: number[]): void {
    const msg = v.decodeFrame(f);
    if (!msg) return;
    const rd = v.reply(msg.header, msg.data);
    if (rd === null) return;
    let at = this.totalCycles + Sc4.CC_REPLY_DELAY;
    for (const x of v.encodeFrame(1, rd)) {
      this.ccReply.push({ at, b: x & 0xff });
      at += Sc4.CC_BYTE_GAP;
    }
  }

  private ccNote: JcmEba | null = null;

  private readonly noteLamps = new SwitchedLamps(16);
  static readonly NOTE_LAMPS = 0x210;

  private resetNoteLamps(): void {
    this.noteLamps.reset();
    this.noteLamps.write(this.ccNote?.lampWord ?? 0x8000);
    this.packNoteLamps();
  }

  private packNoteLamps(): void {
    for (let k = 0; k < 16; k += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b++) if (this.noteLamps.shown[k + b]) byte |= 1 << b;
      this.lamps[(Sc4.NOTE_LAMPS + k) >> 3] = byte;
    }
  }

  fitNoteValidator(type: number, desFitted = false, bnvKey: BnvKey | null = null): boolean {
    if (type !== 1) {
      this.ccNote = null;
      this.resetNoteLamps();
      return false;
    }
    const v = new JcmEba();
    v.address = 0x28;
    v.desFitted = desFitted;
    if (bnvKey) v.setStoredKey(bnvKey);
    v.onStacked = (billType) => { if (this.booksMoney) this.cashLedger.inPence += JcmEba.billPence(billType) ?? 0; };
    v.onLampWord = (word) => { this.noteLamps.write(word); this.packNoteLamps(); };
    this.ccNote = v;
    this.resetNoteLamps();
    return true;
  }

  get noteReaderFitted(): boolean {
    return this.ccNote !== null;
  }

  insertNote(type: number): NoteResult {
    return this.ccNote ? this.ccNote.insertNote(type) : 'unfitted';
  }

  private serviceCcTalk(): void {
    while (this.ccReply.length && this.ccReply[0].at <= this.totalCycles
        && this.duart.rxSpace(1) > 0) {
      this.duart.receive(1, this.ccReply.shift()!.b);
    }
  }

  private ccTalkReply(f: number[]): void {
    const [dest, len, src, header] = f;
    if (this.ccNote && dest === this.ccNote.address) {
      this.ccNoteReply(this.ccNote, f);
      return;
    }
    if (dest !== 3 && dest !== 4) return;
    let h = this.ccHoppers.get(dest);
    if (!h) {
      const part = deviceFor(this.serialHopperModels[dest - 3]);
      if (!(part instanceof Sch2Hopper)) return;
      h = part;
      h.setPeriod(Math.floor(MASTER_CLOCK / 6));
      const address = dest;
      h.onPaid = () => { if (!this.pricesOut()) this.bookHopperCoin(this.hopperCoins().cctalk.get(address) ?? null); };
      this.ccHoppers.set(dest, h);
    }
    const rd = h.reply(header, f.slice(4, 4 + (len ?? 0)));
    if (rd === null) return;
    const b = [src ?? 1, rd.length, dest, 0, ...rd];
    let s = 0;
    for (const x of b) s = (s + x) & 0xff;
    let at = this.totalCycles + Sc4.CC_REPLY_DELAY;
    for (const x of [...b, (0x100 - s) & 0xff]) {
      this.ccReply.push({ at, b: x & 0xff });
      at += Sc4.CC_BYTE_GAP;
    }
  }
  readonly sec = new Sec();
  private secInMult: number[] = [];
  private secOutMult: number[] = [];
  readonly meterTotals = { in: 0, out: 0 };
  private static readonly SEC_UNIT_PENCE = 10;

  setSecMoneyMap(secIn: number[], secOut: number[]): void {
    this.secInMult = [...secIn];
    this.secOutMult = [...secOut];
    this.relayLedgerMults();
  }

  private secLedgerMult: number[] = [];
  private meterLedgerMult: number[] = [];
  private relayLedgerMults(): void {
    [this.secLedgerMult, this.meterLedgerMult] = ledgerOutMults(
      { in: this.secInMult, out: this.secOutMult },
      { in: this.meterInMult, out: this.meterOutMult },
    );
  }

  private meterInMult: number[] = [];
  private meterOutMult: number[] = [];

  setMeterMoneyMap(meterIn: number[], meterOut: number[]): void {
    this.meterInMult = [...meterIn];
    this.meterOutMult = [...meterOut];
    this.relayLedgerMults();
  }

  private pricesOut(): boolean {
    const prices = (m: number[]) => m.some((x) => x > 0);
    return prices(this.secLedgerMult) || prices(this.meterLedgerMult);
  }

  readonly meterCounts = new Uint32Array(8);

  private meterPulse(n: number): void {
    this.meterCounts[n]++;
    const inMult = this.meterInMult[n] ?? 0;
    const outMult = this.meterOutMult[n] ?? 0;
    if (inMult) this.meterTotals.in += inMult;
    if (outMult) {
      this.meterTotals.out += outMult;
      if (this.booksMoney) this.cashLedger.outPence += (this.meterLedgerMult[n] ?? 0) * Sc4.SEC_UNIT_PENCE;
    }
  }

  private readonly meterBank = new MeterConfirm();
  private static readonly METER_TICK_CYCLES = 50_000;

  private setMeterLatch(v: number): void {
    const x = v & 0xff;
    if (x === this.meterLatch) return;
    this.meterLatch = x;
    this.meterBank.write(x);
  }

  private serviceMeters(cycles: number): void {
    const confirmed = this.meterBank.advance(cycles, Sc4.METER_TICK_CYCLES);
    if (confirmed) for (let b = 0; b < 8; b++) if (confirmed & (1 << b)) this.meterPulse(b);
  }

  private secCount(meter: number, delta: number): void {
    const inMult = this.secInMult[meter] ?? 0;
    const outMult = this.secOutMult[meter] ?? 0;
    if (inMult) this.meterTotals.in += inMult * delta;
    if (outMult) {
      this.meterTotals.out += outMult * delta;
      if (this.booksMoney) this.cashLedger.outPence += (this.secLedgerMult[meter] ?? 0) * delta * Sc4.SEC_UNIT_PENCE;
    }
  }
  readonly parHopper = new Sc4HopperPair(MASTER_CLOCK);
  private payoutUnits: Sc4PayoutUnits | null = null;

  hopperCoins(): Sc4HopperCoins {
    return readSc4HopperCoins(this.payoutUnits, (a) => {
      if (a < 0) return -1;
      if (a + 1 < ROM_SIZE) return (this.rom[a] << 8) | this.rom[a + 1];
      if (a >= RAM_BASE && a + 1 < RAM_BASE + RAM_SIZE) return (this.ram[a - RAM_BASE] << 8) | this.ram[a - RAM_BASE + 1];
      return -1;
    });
  }

  private bookHopperCoin(coin: Sc4Coin | null): void {
    if (!this.booksMoney) return;
    if (coin === null) this.cashLedger.unpricedOut++;
    else if (coin.token) this.cashLedger.tokenOutPence += coin.pence;
    else this.cashLedger.outPence += coin.pence;
  }
  readonly seg7 = new BfmLed();
  private parHopperFitted = false;

  private cabinetRio = false;
  setCabinetStyle(style: string | null): void {
    this.cabinetRio = style === 'Rio';
  }

  setHoppers(hoppersWord = 0): void {
    const w = hoppersWord & 0xff;
    this.parHopperFitted = w !== 0x50;
    this.parHopper.setHoppersWord(w);
  }

  get hoppers(): { paid: number; running: boolean }[] {
    const cc = (address: number) => this.ccHoppers.get(address)?.dispensing ?? false;
    const par = this.parHopperFitted;
    return [
      { paid: this.parHopper.paid1, running: (par && this.parHopper.running1) || cc(3) },
      { paid: this.parHopper.paid2, running: (par && this.parHopper.running2) || cc(4) },
    ];
  }
  readonly ymz = new Ymz280b();
  readonly vfd = Object.assign(new Bda(7, true, true), {
    scrollPeriod: Math.round((1_800_000 * MASTER_CLOCK) / 16_670_000),
    flashBase: Math.round((100_000 * MASTER_CLOCK) / 16_670_000),
    onByte: (b: number) => this.bd1.writeChar(b),
  });
  readonly bd1 = Object.assign(new Bd1(), {
    flashBase: Math.round((100_000 * MASTER_CLOCK) / 16_670_000),
  });
  segmentedAlpha = false;
  readonly vfd2 = new Bda(7, true, true);
  private ac2 = 0xff;
  private portB = 0;
  readonly reels = [0, 1, 2, 3, 4, 5].map(
    (i) => i === 4
      ? new Reel({ stepsPerRevolution: 192, symbols: 12, opticStart: 80, opticWidth: 16, drive: 'starpoint' })
      : new Reel({ stepsPerRevolution: 96, symbols: 16, mfmeJpm: true, opticStart: 7, opticWidth: 1 }),
  );
  private readonly reelOpticInverted = [false, false, false, false, false, false];

  reelFit: ReelFit = { mask: 0x3f, channels: 6, beyond: [] };

  setFittedReels(channels: readonly number[]): ReelFit {
    this.reelFit = fitReelBank(this.reels, channels);
    this.updateOptics();
    return this.reelFit;
  }

  setReelGeometry(geometry: readonly { number: number; stops: number; halfSteps: number; flip?: boolean }[]): void {
    for (const g of geometry) {
      if (g.number < 0 || g.number >= this.reels.length) continue;
      this.reels[g.number] = new Reel({
        stepsPerRevolution: g.halfSteps, symbols: g.stops, mfmeJpm: true, opticStart: 7, opticWidth: 1,
        flip: g.flip ?? false,
      });
      this.reelFromLayout[g.number] = true;
    }
    this.updateOptics();
  }

  setReelPosition(i: number, pos: number): void {
    if (!this.reelFromLayout[i]) return;
    this.reels[i].park(pos);
    this.updateOptics();
  }

  private readonly reelFromLayout = [false, false, false, false, false, false];

  setReelOpticFlag(channel: number, flag: number, inverted: boolean): void {
    const r = this.reels[channel];
    if (!r || (channel === 4 && !this.reelFromLayout[4])) return;
    const w = opticWindowForFlag(flag);
    r.setOpticWindow(w.start, w.width);
    this.reelOpticInverted[channel] = inverted;
    this.updateOptics();
  }
  readonly rom = new Uint8Array(ROM_SIZE);
  readonly reelsByLayoutNumber = true;
  readonly ram = new Uint8Array(RAM_SIZE);
  readonly io = new Uint8Array(IO_SIZE);

  readonly inputRegs = new Uint8Array(32);

  private static readonly SENSE_OR = new Uint8Array(32);

  private static readonly DOOR_MASK_DEFAULT = { cash: 8, service: 6 } as const;
  private doorMask: { cash: number; service: number } = { ...Sc4.DOOR_MASK_DEFAULT };
  private doorOpen = { cash: false, service: false };
  private testSw = false;

  private static readonly PANEL_CASH = 0x1000;
  private static readonly PANEL_SERVICE = 0x1001;
  private static readonly PANEL_TEST = 0x1002;

  setDoorMasks(ids: { Cash?: number; Service?: number }): void {
    this.doorMask.cash = (ids.Cash ?? Sc4.DOOR_MASK_DEFAULT.cash) & 0xff;
    this.doorMask.service = (ids.Service ?? Sc4.DOOR_MASK_DEFAULT.service) & 0xff;
  }

  readonly #presetRows: { number: number; label: string }[] = [];

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    if (id < 0 || id >= 256) return;
    this.setInput(id >> 3, id & 7, made);
    if (!this.panel.some((s) => s.number === id) && !this.#presetRows.some((r) => r.number === id)) {
      this.#presetRows.push({ number: id, label });
    }
  }

  setDoor(door: 'cash' | 'service', open: boolean): void {
    this.doorOpen[door] = open;
  }

  setTestSwitch(on: boolean): void {
    this.testSw = on;
  }

  private panel: LayoutSwitch[] = [];

  setLayoutSwitches(list: readonly LayoutSwitch[]): void {
    if (!list.length) return;
    this.panel = list.filter((s) => s.number >= 0 && s.number < 256).map((s) => ({ ...s }));
    for (const s of this.panel) this.setInput(s.number >> 3, s.number & 7, s.closed);
  }

  private testSwByte(): number {
    return (this.testSw ? 1 : 0)
      | (this.doorOpen.cash ? 0 : this.doorMask.cash)
      | (this.doorOpen.service ? 0 : this.doorMask.service);
  }

  get switchPanel(): CabinetSwitch[] {
    const state = (n: number): boolean => {
      const cell = Sc4.matrixCell(n >> 3, n & 7);
      return !!cell && (this.inputRegs[cell[0]] & cell[1]) !== 0;
    };
    return [
      { id: Sc4.PANEL_CASH, label: 'Cashbox door open', on: this.doorOpen.cash },
      { id: Sc4.PANEL_SERVICE, label: 'Service door open', on: this.doorOpen.service },
      { id: Sc4.PANEL_TEST, label: 'Test switch', on: this.testSw },
      ...this.panel.map((s) => ({
        id: s.number,
        label: s.label || `Switch ${s.number}`,
        on: state(s.number),
        group: 'Layout switches',
      })),
      ...this.#presetRows.map((r) => ({ id: r.number, label: r.label, on: state(r.number) })),
      ...this.dilRows,
    ];
  }

  private dilLabels: readonly string[] | null = null;
  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  private static readonly DIL_ID_BASE = 0x1010;

  get dilRows(): CabinetSwitch[] {
    const out: CabinetSwitch[] = [];
    for (let i = 0; i < 16; i++) {
      const bank = i < 8 ? this.dip1 : this.dip2;
      out.push({
        id: Sc4.DIL_ID_BASE + i,
        label: dilSwitchLabel(`DIL${String(i + 1).padStart(2, '0')}`, this.dilLabels?.[i]),
        on: (bank & (1 << (i & 7))) !== 0,
        group: 'DIL switches',
        option: true,
        bootOnly: true,
      });
    }
    return out;
  }

  private keyCode = 0x08;

  private percentKey = 0x01;

  private stakeBits = 0;

  setConfigKeys(gam: { prize?: number | null; percentage?: number | null; stake?: number }): void {
    if (gam.stake !== undefined) this.stakeBits = sc4StakeBits(gam.stake) ?? 0;
    if (gam.prize === null) this.keyCode = 0x00;
    else if (gam.prize !== undefined) this.keyCode = (prizeCode(gam.prize) ?? 0) & 0x0f;
    if (gam.percentage === null) this.percentKey = 0x00;
    else if (gam.percentage !== undefined) {
      this.percentKey = (percentageCode(gam.percentage) ?? 0) & 0x0f;
    }
  }

  get optionKeys(): OptionKey[] {
    return [{
      label: 'Stake/jackpot key',
      positions: ['Not fitted', ...Array.from({ length: 15 }, (_, i) => `Code ${i + 1}`)],
      position: () => this.keyCode,
      fit: (v: number) => { this.keyCode = v & 0x0f; },
    }];
  }

  private totalCycles = 0;

  private haltSteps = 0;
  private haltPc = -1;

  private secFitted = false;

  fitSec(counters: { label: string; value: number }[] = []): void {
    this.secFitted = true;
    counters.forEach((c, i) => {
      this.sec.counters[i] = c.value;
      if (c.label) this.sec.counterText[i] = c.label;
    });
    this.sec.onCount = (meter, delta) => this.secCount(meter, delta);
    this.sec.fitV20();
  }

  private detBits = 0;
  private detCur = 0;
  private detMsg: number[] = [];
  private detPrevClk = 0;
  private secDetect = true;
  setSecDetect(on: boolean): void { this.secDetect = on; }
  private meterLatch = 0;
  get meterLevels(): number { return this.meterLatch & 0xff; }

  readonly dataPak = new DataPak(16_670_000);
  private dataPakType = 0;
  private dataPakOnUart = true;
  private ackQueue: number[] = [];
  private ackDue = 0;
  private static readonly ACK_DELAY = 50_000;

  fitDataport(protocol = 1, serialPort: string | null = null): void {
    this.dataPakType = protocol;
    this.dataPakOnUart = serialPort !== 'LJpot';
  }

  private serviceDataport(cycles: number): void {
    if (!this.ackQueue.length) return;
    this.ackDue -= cycles;
    if (this.ackDue > 0) return;
    this.sim.receive(this.ackQueue.shift()!);
    this.ackDue = Sc4.ACK_DELAY;
  }

  private secDetectClock(level: number): void {
    if (level && !this.detPrevClk) {
      const bit = 1 - ((this.io[SEC_OFF_B] >> 4) & 1);
      this.detCur = ((this.detCur << 1) | bit) & 0xff;
      if (++this.detBits === 8) {
        this.detBits = 0;
        this.detMsg.push(this.detCur);
        this.detCur = 0;
        const m = this.detMsg;
        if (m.length >= 4 && m.length === 4 + m[2]) {
          const sum = m.slice(0, -1).reduce((a, b) => (a + b) & 0xff, 0);
          if (sum === m[m.length - 1]) this.fitSec();
          this.detMsg = [];
        } else if (m.length > 16) {
          this.detMsg = [];
        }
      }
    }
    this.detPrevClk = level;
  }

  private dip1 = 0;
  private dip2 = 0;

  setDips(dip1: number, dip2: number): void {
    this.dip1 = dip1 & 0xff;
    this.dip2 = dip2 & 0xff;
  }

  private senseOr(reg: number): number {
    let s = Sc4.SENSE_OR[reg];
    if (reg === 3) s |= this.stakeBits;
    if (reg === 5) s |= this.keyCode;
    if (reg === 6) s |= this.percentKey;
    if (reg === 16) s |= this.dip1 & 0x1f;
    if (reg === 17) s |= (this.dip1 >> 5) | ((this.dip2 & 3) << 3);
    if (reg === 18) s |= (this.dip2 & 0x7c) >> 2;
    if (reg === 19) s |= this.dip2 >> 7;
    if (reg === 20) s |= this.testSwByte();
    return s;
  }

  setInput(strobe: number, bit: number, on: boolean): void {
    const cell = Sc4.matrixCell(strobe, bit);
    if (!cell) return;
    const [reg, mask] = cell;
    if (on) this.inputRegs[reg] |= mask;
    else this.inputRegs[reg] &= ~mask & 0xff;
  }

  private static matrixCell(strobe: number, bit: number): [number, number] | null {
    if (strobe < 8) return bit < 5 ? [strobe, 1 << bit] : null;
    if (strobe < 12) {
      if (bit < 3) return [strobe - 8, 1 << (bit + 5)];
      if (bit < 5) return [strobe - 4, 1 << (bit + 2)];
      return null;
    }
    if (strobe === 16) return [20, 1 << bit];
    if (strobe === 12 || strobe === 13) return [strobe, 1 << bit];
    return null;
  }

  readonly lamps = new Uint8Array(68);

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: '512 LAMPS', part: '32 x 16 matrix', signal: 'lamps' },
      { id: 'switches', label: 'SWITCH MATRIX', part: '2 banks x 16', device: this.inputRegs },
      { id: 'meters', label: 'METERS', part: 'current sense', modelled: true,
        note: 'Modelled as the supply sense and its edge detector, not as a device.' },
      { id: 'coins', label: 'COIN INPUTS', part: '2-optic walk', signal: 'coin' },

      { id: 'mux', label: 'I/O LATCHES',
        part: '$810000-$81FFFF - lamp columns - switch strobes',
        device: this.io,
        io: [...everyNth(IO_BASE + LATCH_A, 32, 16), ...everyNth(IO_BASE + LATCH_B, 32, 16)] },
      { id: 'psu', label: 'PSU', part: 'power in' },

      { id: 'ram', label: 'BATTERY RAM', part: '64K', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: '2M - even/odd pairs', device: this.rom },
      { id: 'eeprom', label: 'EEPROM', part: '24Cxx - I2C', device: this.eeprom },
      { id: 'sec', label: 'SEC', part: 'security cartridge', device: this.sec,
        io: [[IO_BASE + SEC_OFF_A, IO_BASE + SEC_OFF_A + 1],
          [IO_BASE + SEC_OFF_B, IO_BASE + SEC_OFF_B + 1]] },
      { id: 'ymz', label: 'SOUND', part: 'YMZ280B - 4M samples', device: this.ymz,
        io: [[IO_BASE + YMZ_OFF, IO_BASE + YMZ_OFF_END]] },
      { id: 'alpha', label: 'VFD', part: 'BDA - 16 char', device: this.vfd, signal: 'display' },
      { id: 'alpha2', label: 'VFD 2', part: 'AC2 - 16 char', device: this.vfd2,
        io: [[IO_BASE + 0x1370, IO_BASE + 0x137f]] },

      { id: 'cpu', label: 'CPU', part: 'MC68307 EC000 - 16 MHz', device: this.cpu, cpu: true },
      { id: 'sim', label: 'SIM', part: 'ports - timers - I2C', device: this.sim },
      { id: 'duart', label: 'DUART', part: 'MC68681', device: this.duart,
        io: [[DUART_BASE, DUART_BASE + 0x20]] },
      { id: 'clubmeter', label: 'CLUB METER', part: 'serial meter unit',
        device: this.payFrame },

      { id: 'cctalk', label: 'ccTALK BUS', device: this.ccHoppers },
      { id: 'i2c', label: 'I2C', device: this.mbus },
      { id: 'bdm', label: 'BDM' },

      { id: 'reels', label: 'REEL MECH', part: 'Starpoint', device: this.reels, signal: 'reels' },
      { id: 'hopper', label: 'HOPPER 1', part: 'ccTalk 3', device: this.ccHoppers },
      { id: 'hopper2', label: 'HOPPER 2', part: 'ccTalk 4', device: this.ccHoppers },
      { id: 'notes', label: 'NOTE ACCEPTOR', ...(this.ccNote ? { part: 'ccTalk $28', device: this.ccNote } : {}) },
    ];
  }

  lamp(bank: number, column: number, bit: number): boolean {
    return (this.lamps[(bank & 1) * 32 + (column & 31)] & (1 << (bit & 7))) !== 0;
  }

  get clockHz(): number {
    return MASTER_CLOCK;
  }

  get display(): Bda | Bd1 {
    return this.segmentedAlpha ? this.bd1 : this.vfd;
  }

  get audioSource(): Ymz280b {
    return this.ymz;
  }

  layoutLamp(n: number): boolean {
    if (n >= Sc4.NOTE_LAMPS && n < Sc4.NOTE_LAMPS + 16) return (this.lamps[n >> 3] & (1 << (n & 7))) !== 0;
    return this.lamp(n >> 8, (n >> 3) & 31, n & 7);
  }

  get ledOutputs(): Uint8Array {
    return this.seg7.raw;
  }

  get segDigits(): Uint8Array {
    return this.seg7.digits;
  }

  layoutDigit(n: number): number {
    return n >= 0 && n < this.seg7.digits.length ? this.seg7.digits[n] : 0;
  }

  pinHostClock(at: Date | null): void {
    this.mbus.rtc.pin(at, this.clockHz);
  }

  layoutInput(id: number, on: boolean): void {
    if (id === Sc4.PANEL_CASH) { this.setDoor('cash', on); return; }
    if (id === Sc4.PANEL_SERVICE) { this.setDoor('service', on); return; }
    if (id === Sc4.PANEL_TEST) { this.setTestSwitch(on); return; }
    if (id >= Sc4.DIL_ID_BASE && id < Sc4.DIL_ID_BASE + 16) {
      const n = id - Sc4.DIL_ID_BASE;
      const mask = 1 << (n & 7);
      const raise = (v: number): number => (on ? v | mask : v & ~mask & 0xff);
      if (n < 8) this.dip1 = raise(this.dip1);
      else this.dip2 = raise(this.dip2);
      return;
    }
    this.setInput(id >> 3, id & 7, on);
  }

  readonly cashLedger = newCashLedger();

  private static readonly COIN_PENCE = [100, 50, 20, 10, 0, 5];

  coins = 0x3f;

  setCoinLine(bit: number, present: boolean): void {
    if (present) this.coins &= ~(1 << bit) & 0x3f;
    else this.coins |= (1 << bit) & 0x3f;
  }

  private static readonly COIN_PULSE_INSTRUCTIONS = (0x50 - 15) * 5000;
  private coinInstructions = 0;
  private coinBit = -1;

  get coinBusy(): boolean {
    return this.coinBit >= 0;
  }

  insertCoin(bit: number): void {
    if (this.coinBit >= 0) return;
    if (lockoutRefuses(Sc4.LOCKOUT, this.io[Sc4.LOCKOUT_OFF], this.lockoutPattern(bit))) {
      this.coinsRefused++;
      return;
    }
    const taken = this.programCoinOn(bit);
    this.coinBit = bit;
    this.coinInstructions = 0;
    this.coins &= ~this.coinPattern(bit) & 0x3f;
    if (taken === 'refused') { this.coinsRefused++; return; }
    if (this.wiring) { this.bookWiredCoin(bit, taken); return; }
    this.bookProgramCoin(bit, taken);
  }

  private bookProgramCoin(line: number, taken: Sc4ProgramCoin): void {
    if (taken === 'refused') return;
    if (taken === null) {
      noteBoardDefault(this, {
        axis: 'coin',
        text: 'the program\'s coin table was not read - a coin books the board\'s price for its line',
        ifWrong: 'A coin the program values differently, or does not take, books the wrong money.',
      });
      this.cashLedger.inPence += Sc4.COIN_PENCE[line & 7] ?? 0;
      return;
    }
    if (taken.token) this.cashLedger.tokenInPence += taken.pence;
    else this.cashLedger.inPence += taken.pence;
  }

  private programCoinOn(line: number): Sc4ProgramCoin {
    const t = this.coinTables();
    if ('refused' in t) return null;
    return sc4ProgramCoin(t, this.programMem, this.coinPattern(line) & 0x3f);
  }

  private coinTablesCache: { rom: Uint8Array; t: Sc4CoinTables | { refused: string } } | null = null;
  private coinTables(): Sc4CoinTables | { refused: string } {
    if (this.coinTablesCache?.rom !== this.rom) this.coinTablesCache = { rom: this.rom, t: locateSc4CoinTables(this.rom) };
    return this.coinTablesCache.t;
  }

  private readonly programMem: Sc4Mem = {
    w: (a) => (a >= RAM_BASE
      ? (a + 1 < RAM_BASE + RAM_SIZE ? (this.ram[a - RAM_BASE]! << 8) | this.ram[a - RAM_BASE + 1]! : 0)
      : a + 1 < ROM_SIZE ? (this.rom[a]! << 8) | this.rom[a + 1]! : 0),
    l: (a) => ((this.programMem.w(a) << 16) | this.programMem.w(a + 2)) >>> 0,
  };

  static readonly LOCKOUT: CoinLockoutWiring = { openSense: 1, mask: 0x3f, bits: [0, 1, 2, 3, 4, 5] };
  static readonly LOCKOUT_OFF = 0x02f1;

  private lockoutPattern(line: number): number {
    return this.binaryMech ? 0x3f : this.coinPattern(line) & 0x3f;
  }

  coinsRefused = 0;

  get coinRefusing(): number {
    let m = lockoutRefusing(Sc4.LOCKOUT, this.io[Sc4.LOCKOUT_OFF], 6, (n) => this.lockoutPattern(n));
    for (let n = 0; n < SC4_COIN_LINES; n++) if (this.programCoinOn(n) === 'refused') m |= 1 << n;
    return m >>> 0;
  }

  private tickCoin(): void {
    if (this.coinBit < 0) return;
    if (++this.coinInstructions < Sc4.COIN_PULSE_INSTRUCTIONS) return;
    this.coins |= this.coinPattern(this.coinBit) & 0x3f;
    this.coinBit = -1;
  }

  private binaryMech = false;
  private coinModeHold = 0;
  private reg1301 = 0;
  readonly volume = new SteppedVolume(100);
  volumeV9 = false;

  setCoinMech(mech: string | null): void {
    this.binaryMech = mech === 'Binary';
    this.coinLinePattern = Sc4.COIN_PENCE.map((p, b) => {
      if (!this.binaryMech || p <= 0) return 1 << b;
      const id = Sc4.BINARY_NOTE_BY_PENCE.get(p);
      return id === undefined ? 1 << b : COIN_RAW[id]! & 0x3f;
    });
    this.tokenLine = null;
  }

  private static readonly BINARY_NOTE_BY_PENCE = new Map([[5, 0], [10, 1], [20, 2], [50, 4], [100, 5], [200, 6]]);

  private tokenLine: number | null = null;

  private coinLinePattern: number[] = Sc4.COIN_PENCE.map((_, b) => 1 << b);

  private coinPattern(bit: number): number {
    return this.coinLinePattern[bit] ?? (1 << bit);
  }

  setCabinetCoinSlots(slots: readonly { pence: number | null; token: boolean; mask: number }[]): void {
    for (const s of slots) {
      if (s.token) {
        const t = this.coinTables();
        const line = 'refused' in t ? null : sc4TokenLine(t, this.programMem);
        if (line === null) continue;
        this.coinLinePattern[line] = s.mask & 0x3f;
        this.tokenLine = line;
        continue;
      }
      if (s.pence === null || s.pence <= 0) continue;
      const line = Sc4.COIN_PENCE.indexOf(s.pence);
      if (line < 0) continue;
      this.coinLinePattern[line] = s.mask & 0x3f;
    }
  }

  get coinPortLines(): CoinPortLines {
    return {
      compare: 0x3f,
      lines: this.coinLinePattern
        .map((mask, bit) => ({ bit, mask }))
        .filter((l) => Sc4.COIN_PENCE[l.bit] > 0 || l.bit === this.tokenLine),
    };
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

  private bookWiredCoin(line: number, taken: Sc4ProgramCoin): void {
    const w = this.wiring!;
    if (!this.booksMoney || w.conflicts.includes(line)) return;
    const c = w.coins.get(line);
    if (c === undefined) {
      this.bookProgramCoin(line, taken);
      return;
    }
    if (taken !== null && taken !== 'refused') {
      const agrees = typeof c === 'number'
        ? !taken.token && taken.pence === c
        : taken.token && (c.token === null || c.token === taken.pence);
      this.wiringState.state = agrees ? 'calibrated' : 'disagrees';
      if (!agrees) return;
    }
    if (typeof c === 'number') { this.cashLedger.inPence += c; return; }
    if (c.token === null) { this.cashLedger.unpricedTokenIn++; return; }
    this.cashLedger.tokenInPence += c.token;
  }

  private coinSlots: number[] = [];

  setLayoutCoins(list: readonly DeclaredCoin[]): void {
    const out = new Set<number>();
    const bit = (b: number): number | null => (b >= 0 && b < SC4_COIN_LINES && Sc4.COIN_PENCE[b]! > 0 ? b : null);
    for (const c of list) {
      if (c.pence !== null) continue;
      if (c.named?.name.startsWith('ccTalk') || c.named?.name.startsWith('NV')) continue;
      let line: number | null;
      if (c.line !== null && c.note === null) {
        if (c.line < 0 || c.line >= SC4_COIN_LINES) continue;
        line = c.line;
      } else if (c.note !== null && c.note >= 0x0f && c.note <= 0x16) {
        if ((line = bit(c.note - 0x0f)) === null) continue;
      } else if (c.note === COIN_NOTE_BLANK && c.button !== null && c.button >= 0 && c.button < 128 && (c.button >> 3) === Sc4.COIN_ROW) {
        if ((line = bit(c.button & 7)) === null) continue;
      } else if (c.token || (c.note !== null && COIN_NOTES.get(c.note)?.token)) {
        if (this.tokenLine === null) continue;
        line = this.tokenLine;
      } else line = 0;
      out.add(line);
    }
    this.coinSlots = [...out].sort((a, b) => a - b);
  }

  private static readonly COIN_ROW = 12;

  get unnamedCoinLines(): readonly number[] {
    return this.coinSlots;
  }

  private readCoinTable(): CoinLineTable | { refused: string } {
    const t = this.coinTables();
    if ('refused' in t) return t;
    return sc4CoinTable(t, this.programMem, this.coinLinePattern.map((p) => p & 0x3f));
  }

  get coinLineTable(): CoinLineTable | null {
    const t = this.readCoinTable();
    return 'refused' in t ? null : t;
  }

  get coinLineTableRefusal(): string | null {
    const t = this.readCoinTable();
    return 'refused' in t ? t.refused : null;
  }

  private static readonly NOTE_PORT_OFF = 0x8000;
  private static readonly NOTE_VEND_CYCLES = MASTER_CLOCK / 10;
  private static readonly NOTE_ESCROW_CYCLES = MASTER_CLOCK * 30;
  private static readonly NOTE_ACCEPT_CYCLES = MASTER_CLOCK / 2;
  private static readonly NOTE_ESCROW_BIT = 0x08;
  private static readonly NOTE_ABORT_BIT = 0x10;

  private notePence = new Map<number, number>();
  private noteFitted = false;
  private noteVendLeft = 0;
  private noteVendCode = 0;
  private noteHeld = 0;
  private noteHoldLeft = 0;
  private noteAcceptLeft = 0;
  private noteWritten = 0;
  readonly notePortIo = { reads: 0, writes: 0 };

  fitNoteReader(fitted: boolean, pence: ReadonlyMap<number, number>): void {
    this.noteFitted = fitted;
    this.notePence = new Map(pence);
  }

  get parallelNoteReaderFitted(): boolean {
    return this.noteFitted;
  }

  insertParallelNote(channel: number): NoteResult {
    if (!this.noteFitted) return 'unfitted';
    if (channel < 1 || channel > 3) return 'unprogrammed';
    const pence = this.notePence.get(channel);
    if (pence === undefined) return 'unprogrammed';
    if (this.noteVendLeft > 0 || this.noteHeld || this.noteAcceptLeft > 0) return 'busy';
    this.noteVendLeft = Sc4.NOTE_VEND_CYCLES;
    this.noteVendCode = 1 << channel;
    if (this.noteWritten & Sc4.NOTE_ESCROW_BIT) {
      this.noteHeld = channel;
      this.noteHoldLeft = Sc4.NOTE_ESCROW_CYCLES;
      return 'escrow';
    }
    if (this.booksMoney) this.cashLedger.inPence += pence;
    return 'stacked';
  }

  private readNotePort(): number {
    this.notePortIo.reads++;
    return (~this.noteWritten & 0x80) | this.noteVendCode | 1;
  }

  private writeNotePort(v: number): void {
    this.notePortIo.writes++;
    const changed = this.noteWritten ^ v;
    this.noteWritten = v;
    if (!this.noteHeld) return;
    if ((changed & Sc4.NOTE_ABORT_BIT) && !(v & Sc4.NOTE_ABORT_BIT)) {
      this.noteHeld = 0;
      this.noteHoldLeft = 0;
      this.noteVendLeft = 0;
      this.noteVendCode = 0;
      return;
    }
    if ((changed & Sc4.NOTE_ESCROW_BIT) && !(v & Sc4.NOTE_ESCROW_BIT)) {
      this.noteAcceptLeft = Sc4.NOTE_ACCEPT_CYCLES;
      this.noteHoldLeft = 0;
    }
  }

  private tickNote(cycles: number): void {
    if (this.noteVendLeft > 0 && (this.noteVendLeft -= cycles) <= 0) {
      this.noteVendLeft = 0;
      this.noteVendCode = 0;
    }
    if (this.noteAcceptLeft > 0 && (this.noteAcceptLeft -= cycles) <= 0) {
      this.noteAcceptLeft = 0;
      const channel = this.noteHeld;
      this.noteHeld = 0;
      this.noteVendLeft = Sc4.NOTE_VEND_CYCLES;
      this.noteVendCode = 1 << channel;
      if (this.booksMoney) this.cashLedger.inPence += this.notePence.get(channel) ?? 0;
      return;
    }
    if (this.noteHoldLeft > 0 && (this.noteHoldLeft -= cycles) <= 0) {
      this.noteHoldLeft = 0;
      this.noteHeld = 0;
    }
  }

  private nvram: Uint8Array | null = null;

  private readonly ioLog = new Map<number, IoAccess>();

  readonly strayReads = new Map<number, number>();

  constructor() {
    this.cpu = new M68000(this);
    this.resetNoteLamps();
    this.parHopper.onCoin = (h) => {
      if (this.pricesOut()) return;
      this.bookHopperCoin(this.hopperCoins().line[h - 1]);
    };
    this.sim = new M68307Sim({
      txByte: (v) => {
        if (!this.dataPakType || !this.dataPakOnUart) return;
        const reply = this.dataPak.receive(v, this.totalCycles);
        if (!reply || this.dataPakType !== 1) return;
        if (!this.ackQueue.length) this.ackDue = Sc4.ACK_DELAY;
        this.ackQueue.push(...reply);
      },
      irqChanged: () => this.updateIrq(),
      portA: (v) => {
        const r0 = this.reels[0];
        const r1 = this.reels[1];
        if (r0) { r0.traceClock = this.cpu.cycles >>> 0; r0.update(v & 0x0f); }
        if (r1) { r1.traceClock = this.cpu.cycles >>> 0; r1.update((v >> 4) & 0x0f); }
        this.updateOptics();
      },
      portB: (v) => {
        const r2 = this.reels[2];
        if (r2) { r2.traceClock = this.cpu.cycles >>> 0; r2.update((v >> 8) & 0x0f); }
        this.vfd.setSerial((v & 0x4000) !== 0, (v & 0x1000) !== 0, (v & 0x2000) === 0);
        this.portB = v;
        this.updateAc2();
        this.updateOptics();
      },
      mbusByte: (v) => this.mbus.write(v),
      mbusRead: () => this.mbus.read(),
      mbusStart: () => this.mbus.start(),
      mbusStop: () => this.mbus.stop(),
    });
  }

  private updateAc2(): void {
    this.vfd2.setSerial(
      (this.portB & 0x4000) !== 0,
      (this.ac2 & 0x01) === 0,
      (this.portB & 0x2000) === 0,
    );
  }

  private updateOptics(): void {
    let pattern = 0;
    for (let i = 0; i < this.reels.length; i++) {
      if (this.reels[i].optic() !== this.reelOpticInverted[i]) pattern |= 1 << i;
    }
    this.duart.inputPort = pattern & this.reelFit.mask;
  }

  private updateIrq(): void {
    const [level, vector] = this.sim.request();
    this.cpu.setIRQ(level, vector);
  }

  private refreshExternalInt(): void {
    if (!this.sim) return;
    const line = this.duart.irq();
    this.updatePortBIn();
    this.sim.setExternalInt(line);
  }

  private updatePortBIn(): void {
    let v = 0xffff;
    if (this.duart.irq()) v &= ~0x8000;
    if (this.meterLatch !== 0) v &= ~0x0040;
    this.sim.portBIn = v;
  }

  loadRomPair(evn: Uint8Array, odd: Uint8Array): void {
    const n = Math.min(evn.length, odd.length);
    this.rom.fill(ROM_UNPLACED);
    for (let i = 0; i < n && i * 2 + 1 < ROM_SIZE; i++) {
      this.rom[i * 2] = evn[i];
      this.rom[i * 2 + 1] = odd[i];
    }
    this.fitSecurityKey();
    this.payoutUnits = locateSc4PayoutUnits(this.rom, Math.min(ROM_SIZE, 2 * n));
    this.cpu.setCodeRegion(0, this.rom);
  }

  loadRom(image: Uint8Array): void {
    this.rom.fill(ROM_UNPLACED);
    noteRomCut(this, image.length, ROM_SIZE);
    this.rom.set(image.subarray(0, ROM_SIZE));
    this.fitSecurityKey();
    this.payoutUnits = locateSc4PayoutUnits(this.rom, Math.min(ROM_SIZE, image.length));
    this.cpu.setCodeRegion(0, this.rom);
  }

  private fitSecurityKey(): void {
    this.mbus.security.key = findSecurityKey(this.rom) ?? new Uint8Array(16);
    this.driftBase = findReelStopArray(this.rom);
  }

  private driftBase: number | undefined;

  get reelDriftBase(): number | undefined {
    return this.driftBase;
  }

  loadSoundRoms(first: Uint8Array, second: Uint8Array): void {
    const sample = new Uint8Array(0x400000);
    sample.set(first.subarray(0, 0x80000), 0x000000);
    sample.set(second.subarray(0, 0x80000), 0x080000);
    this.ymz.loadRom(sample);
  }

  batteryRam(): Uint8Array { return this.ram.slice(0, RAM_SIZE); }

  postRestore(): void {
    if (!this.sim.mapped && this.totalCycles > 0) {
      this.sim.mbar = 0xbfff;
      this.sim.base = SIM_BASE;
      this.sim.mapped = true;
    }
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
    else this.ram.fill(0xff);
    this.warmReset();
  }

  private warmReset(): void {
    this.io.fill(0);
    this.ioLog.clear();
    this.strayReads.clear();
    this.sim.reset();
    this.duart.reset();
    this.sec.abortTransfer();
    this.parHopper.reset();
    this.seg7.reset();
    this.ymz.reset();
    this.vfd.reset();
    this.bd1.reset();
    this.vfd2.reset();
    this.ac2 = 0xff;
    this.portB = 0;
    this.coinModeHold = 0;
    this.reg1301 = 0;
    this.noteVendLeft = 0;
    this.noteVendCode = 0;
    this.noteHeld = 0;
    this.noteHoldLeft = 0;
    this.noteAcceptLeft = 0;
    this.noteWritten = 0;
    this.ccNote?.reset();
    this.resetNoteLamps();
    resetReelsInPlace(this.reels);
    this.updateOptics();
    this.cpu.reset();
    this.haltSteps = 0;
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

  read8(addr: number): number {
    const a = addr & 0xffffff;
    if (a < RAM_BASE) return (a & 0xfffff0) === 0xf0 ? 0 : this.rom[a & ROM_MASK];
    if (a >= RAM_BASE && a < RAM_BASE + RAM_SIZE) return this.ram[a - RAM_BASE];
    if (a >= IO_BASE && a < IO_BASE + IO_SIZE) {
      const off = a - IO_BASE;
      this.noteIo(a, false);
      if ((off & 0xf00f) === 0x0001 && (off & 0x0ff0) <= 0x70) {
        const reg = (off >> 4) & 0x0f;
        return this.inputRegs[reg] | this.senseOr(reg);
      }
      if ((off & 0xf00f) === 0x1001 && (off & 0x0ff0) <= 0x70) {
        const reg = 16 + ((off >> 4) & 0x0f);
        return this.inputRegs[reg] | this.senseOr(reg);
      }
      if (off === 0x0240) {
        const m12 = this.inputRegs[12];
        return ((this.secFitted && this.sec.data()) ? 0x40 : 0x00)
          | (m12 & 0xc0)
          | (this.coins & ~this.coinModeHold & ~m12 & 0x3f);
      }
      if (off === 0x0241) {
        const m13 = this.inputRegs[13];
        return this.parHopperFitted
          ? this.parHopper.readPay() | (m13 & 0x9f)
          : this.parHopper.readUnfitted(this.cabinetRio, m13);
      }
      if (off === 0x02e0) return 0x00;
      if (off === 0x02e1) return 0x80;
      if (off === YMZ_OFF) return this.ymz.read(0);
      if (off === YMZ_OFF + 2) return this.ymz.read(1);
      return this.io[off];
    }
    if (a >= DUART_BASE && a < DUART_BASE + 0x20) {
      this.noteIo(a, false);
      return this.duart.read((a - DUART_BASE) >> 1);
    }
    const simOff = this.sim.offsetOf(a);
    if (simOff >= 0) return this.sim.read8(simOff);
    if (this.noteFitted && a === this.notePortAddr()) {
      this.noteIo(a, false);
      return this.readNotePort();
    }
    this.strayReads.set(a, (this.strayReads.get(a) ?? 0) + 1);
    return 0;
  }

  private notePortAddr(): number {
    const cs = this.sim.chipSelect(3);
    return cs.enabled ? cs.base + Sc4.NOTE_PORT_OFF : -1;
  }

  write8(addr: number, val: number): void {
    const a = addr & 0xffffff;
    const v = val & 0xff;
    if (a >= RAM_BASE && a < RAM_BASE + RAM_SIZE) {
      this.ram[a - RAM_BASE] = v;
      return;
    }
    if (a >= IO_BASE && a < IO_BASE + IO_SIZE) {
      const off = a - IO_BASE;
      this.noteIo(a, true);
      this.io[off] = v;
      if (off === 0x0301) this.parHopper.writeP03(v);
      if (off === 0x0311) this.parHopper.writePayen1(v);
      if (off === 0x1311) this.parHopper.writePayen2(v);
      if (off === 0x1301) {
        if ((this.reg1301 ^ v) & 4) this.coinModeHold = (v & 4) && this.binaryMech ? 0x20 : 0;
        if ((this.reg1301 ^ v) & v & 1) {
          const level = this.volume.step((v & 2) === 0);
          this.ymz.setGain(this.volumeV9 ? v9Sc4Gain(this.volume.count) : level / 0xff);
        }
        this.reg1301 = v;
      }
      if (off === 0x0331) {
        if (this.secFitted) {
          this.sec.lineCall(this.totalCycles);
          this.sec.setClock((v & 0x20) === 0);
        } else {
          if (this.secDetect) this.secDetectClock((v >> 5) & 1);
          this.setMeterLatch((this.meterLatch & 0xc0) | (v & 0x3f));
          this.updatePortBIn();
        }
      }
      if (off === 0x1331) {
        const r3 = this.reels[3];
        if (r3) { r3.traceClock = this.cpu.cycles >>> 0; r3.update(v & 0x0f); }
        this.updateOptics();
        if (this.secFitted) {
          this.sec.setCS((v & 0x20) === 0);
          this.sec.setData((v & 0x10) === 0);
        } else {
          this.setMeterLatch((this.meterLatch & 0x3f) | ((v & 0x30) << 2));
          this.updatePortBIn();
        }
      }
      if ((off & 0xf) === 0x1 && (off & 0xfff) <= 0x1f1) {
        if ((off & 0x1000) === 0) {
          this.lamps[(off & 0xfff) >> 4] = v;
        } else {
          this.seg7.writeBfm(v, (off >> 4) & 0x0f, (off & 0x100) ? 1 : 0);
        }
      }
      if ((off & 0xffff0) === 0x1370) {
        this.ac2 = v;
        this.updateAc2();
      }
      if (off === YMZ_OFF + 4) this.ymz.write(0, v);
      if (off === YMZ_OFF + 6) this.ymz.write(1, v);
      return;
    }
    if (a >= DUART_BASE && a < DUART_BASE + 0x20) {
      this.noteIo(a, true);
      this.duart.write((a - DUART_BASE) >> 1, v);
      return;
    }
    const simOff = this.sim.offsetOf(a);
    if (simOff >= 0) {
      this.sim.write8(simOff, v);
      return;
    }
    if (this.noteFitted && a === this.notePortAddr()) {
      this.noteIo(a, true);
      this.writeNotePort(v);
      return;
    }
  }

  read16(addr: number): number {
    const a = addr & 0xffffff;
    if ((a & 0xfffff0) === 0xf0) return this.sim.readControl16(a);
    if (a + 1 < RAM_BASE) {
      const r = a & ROM_MASK;
      if (r + 1 < ROM_SIZE) return (this.rom[r] << 8) | this.rom[r + 1];
    }
    if (a >= RAM_BASE && a + 1 < RAM_BASE + RAM_SIZE) {
      const i = a - RAM_BASE;
      return (this.ram[i] << 8) | this.ram[i + 1];
    }
    return ((this.read8(addr) << 8) | this.read8(addr + 1)) & 0xffff;
  }

  write16(addr: number, val: number): void {
    const a = addr & 0xffffff;
    if ((a & 0xfffff0) === 0xf0) {
      this.sim.writeControl16(a, val);
      return;
    }
    if (a >= RAM_BASE && a + 1 < RAM_BASE + RAM_SIZE) {
      const i = a - RAM_BASE;
      this.ram[i] = (val >> 8) & 0xff;
      this.ram[i + 1] = val & 0xff;
      return;
    }
    this.write8(addr, val >> 8);
    this.write8(addr + 1, val);
  }

  step(): number {
    const cycles = this.cpu.step();
    this.totalCycles += cycles;
    this.serviceCcTalk();
    if ((this.cpu.pc >>> 0) === this.haltPc) {
      if (++this.haltSteps >= 1000) this.warmReset();
    } else {
      this.haltPc = this.cpu.pc >>> 0;
      this.haltSteps = 0;
    }
    this.sim.tick(cycles);
    this.mbus.rtc.tick(cycles);
    this.vfd.tick(cycles);
    this.bd1.tick(cycles);
    this.serviceDataport(cycles);
    this.tickCoin();
    if (this.noteFitted) this.tickNote(cycles);
    if (this.parHopperFitted) this.parHopper.tick(cycles);
    for (const h of this.ccHoppers.values()) if (h.timing) h.tick(cycles);
    this.serviceMeters(cycles);
    this.ymz.tick(cycles, MASTER_CLOCK);
    if (!this.duart.idle()) this.duart.tick(cycles);
    return cycles;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  ioActivity(): IoAccess[] {
    return [...this.ioLog.values()].sort(
      (x, y) => y.reads + y.writes - (x.reads + x.writes),
    );
  }
}
