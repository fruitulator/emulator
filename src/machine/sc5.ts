import { Ygv619 } from '../hw/ygv619';
import { M68000 } from '../cpu/m68000';
import { ColdfireWasm, REASON_FALLBACK } from '../cpu/coldfirewasm';
import type { Bus16 } from '../cpu/bus68k';
import { Mcf5206e, RSR_POWER, RSR_WATCHDOG } from '../hw/mcf5206e';
import { Mc68681 } from '../hw/mc68681';
import { Ymz280b } from '../hw/ymz280b';
import { Sc5Volume } from '../hw/sc5volume';
import { X1227 } from '../hw/x1227';
import { Sc5LedBoard } from '../hw/sc5ledboard';
import { Sc5E2rom } from '../hw/sc5e2rom';
import { Sc5GameCard, gameCardKey } from '../hw/sc5gamecard';
import { BetcomAlpha } from '../hw/betcomalpha';
import { Sc5Security, findSecurityKey } from '../hw/sc5sec';
import { Sec } from '../hw/sec';
import { Bda } from '../hw/bda';
import { Bd1 } from '../hw/bd1';
import { BfmLed } from '../hw/bfmled';
import { Reel } from '../hw/reel';
import { JcmEba, deviceFor, Sr5iMech, Sch2Hopper, type CcTalkDevice } from '../hw/cctalk';
import { DataPak } from '../hw/datapak';
import { SwitchedLamps } from '../hw/switchedlamps';
import { percentageCode, prizeCode, stakeCode } from '../hw/bfmkeys';

const SC5_PERCENTAGES = ['70%', '72%', '74%', '76%', '78%', '80%', '82%', '84%',
  '86%', '88%', '90%', '92%', '94%', '96%', '98%'];
const SC5_PRIZES = ['£5', '£8T', '£8', '£10', '£15', '£25', '£35', '£70', '£3',
  '£4', '£6', '£6T', '£25LBO', '£100'];
const SC5_STAKES = ['5p', '10p', '20p', '25p', '30p', '50p', '£1'];
import type { FittedPeripherals } from '../layout/fmlconfig';
import type { ReelGeometry } from './layoutreels';
import { layoutPanelRows, type LayoutSwitch } from './layoutswitches';
import { StatedLines } from './statedlines';

export function adder5ScreenSize(mode: number): { width: number; height: number } | null {
  switch (mode) {
    case 0: return { width: 600, height: 800 };
    case 1: return { width: 480, height: 640 };
    case 2: return { width: 800, height: 600 };
    case 3: return { width: 640, height: 480 };
    default: return null;
  }
}
import { opticWindowForFlag } from '../layout/datreels';
import type { Machine, MachineDisplay, AudioSource, OptionKey, DigitKind, NoteResult, CabinetSwitch } from './machine';
import { newCashLedger, ledgerOutMults, dilSwitchLabel } from './machine';
import type { BoardPart } from './parts';
import { everyNth } from './schematic';
import { resetReelsInPlace } from './v20optic';
import { ROM_UNPLACED } from './pairplacer';

const MASTER_CLOCK = 40_000_000;
const DUART_CLOCK = 3_686_400;

const YMZ_BASE = 0x01010244;
const YMZ_END = 0x0101024c;
const SEC_PORT = 0x01020300;
const AIM_GRAY = [0x00, 0x01, 0x03, 0x02];
const AIM_ROW = 15;
const DUART_BASE = 0x02000000;
const DUART_END = 0x02000020;
const MUX_A_BASE = 0x01020000;
const MUX_B_BASE = 0x01010000;
const BATTERY_BASE = 0x01000000;

export function findReelSettleStore(rom: Uint8Array): number | undefined {
  const u32 = (i: number) => (rom[i] << 24 | rom[i + 1] << 16 | rom[i + 2] << 8 | rom[i + 3]) >>> 0;
  for (let i = 0; i + 40 <= rom.length; i += 2) {
    if (rom[i] !== 0x70 || rom[i + 1] !== 0x08 || rom[i + 2] !== 0x2f || rom[i + 3] !== 0x00) continue;
    if (rom[i + 4] !== 0x2f || rom[i + 5] !== 0x3c || rom[i + 10] !== 0x2f || rom[i + 11] !== 0x3c) continue;
    const shadow = u32(i + 6);
    const record = u32(i + 12);
    if (shadow !== record + 8) continue;
    const j = i + 16;
    if (rom[j] !== 0x4e || rom[j + 1] !== 0xb9) continue;
    if (u32(j + 6) !== 0x4fef000c) continue;
    if (rom[j + 10] !== 0x4a || rom[j + 11] !== 0x40 || rom[j + 12] !== 0x66) continue;
    if (rom[j + 14] !== 0x42 || rom[j + 15] !== 0x42 || rom[j + 16] !== 0x22 || rom[j + 17] !== 0x7c) continue;
    const rows = u32(j + 18);
    if (rows !== record + 2) continue;
    return rows >= BATTERY_BASE && rows + 3 <= BATTERY_BASE + RAM_SIZE ? rows - BATTERY_BASE : undefined;
  }
  return undefined;
}

const ROM_SIZE = 0x400000;
const RAM_SIZE = 0x10000;
const SRAM_SIZE = 0x10000;

export interface IoAccess {
  addr: number;
  reads: number;
  writes: number;
}

export interface IoEvent {
  pc: number;
  addr: number;
  value: number;
  write: boolean;
}

const TRACE_CAP = 8192;

const CC_MECH = 2;
const CC_HOPPER = 3;
const CC_HOPPER2 = 4;
const CC_NOTE = 0x28;
const CC_HOST = 1;

export const SC5_SWITCH_IDLE = Uint8Array.of(
  0xff, 0xdf, 0x7f, 0x9f, 0xff, 0xdf, 0xdf, 0xff,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xf1, 0x71, 0xd1, 0xf1, 0xf1, 0x71, 0xf1, 0xf1,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
);

const DEFAULT_MECH = 'SR5i';
const DEFAULT_HOPPER = 'SCH 2';
const DEFAULT_NOTE = 'JCM EBA';

function deviceAt(addr: number, model: string): CcTalkDevice {
  const dev = deviceFor(model)!;
  dev.address = addr;
  return dev;
}

export class Sc5 implements Bus16, Machine {
  static readonly snapshotConfig: readonly string[] = ['nvram', 'mechCurrency'];
  readonly digitKind: DigitKind = 'sc4';
  readonly cpu: M68000;
  readonly sim: Mcf5206e;
  readonly duart = new Mc68681({
    irqChanged: () => this.ipl4(),
    txByte: (ch, v) => this.payTx(ch, v),
    outputPort: (v) => {
      this.drive(4, v & 0x0f);
      this.drive(5, (v >> 4) & 0x0f);
      this.updateOptics();
    },
  });

  readonly duart2 = new Mc68681({
    irqChanged: () => this.ipl4(),
    txByte: (ch, v) => { if (ch === 1) this.peerTx(v); },
  });

  private readonly peer = new Uint8Array(0x12);
  private peerSeed = 0x2545f491;

  private peerRandom(): number {
    let x = this.peerSeed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.peerSeed = x >>> 0;
    return this.peerSeed & 0xff;
  }

  private peerStream(): number {
    const p = this.peer;
    if (p[0] === 0) {
      p[1] = 4; p[2] = 3; p[3] = 2; p[4] = 1;
      for (let i = 5; i <= 8; i++) p[i] = this.peerRandom();
      p[9] = 0;
    }
    const v = p[p[0] + 1];
    p[0]++;
    if (p[0] === 9) p[0] = 0;
    return v;
  }

  private peerChallenge(): number | null {
    const p = this.peer;
    if (p[0x11] === 0) return null;
    p[0x11]--;
    const v = p[p[0] + 1];
    p[0]++;
    return v;
  }

  private peerTx(v: number): void {
    if (v !== 0x20 && v !== 0x47) return;
    const p = this.peer;
    p[1] = this.peerRandom();
    p[2] = this.peerRandom();
    p[3] = ~p[1] & 0xff;
    p[4] = ~p[2] & 0xff;
    p[0x11] = 4;
    p[0] = 0;
  }

  private feedPeer(): void {
    if (!this.duart2.rxEnabled(1) || this.duart2.rxSpace(1) === 0) return;
    this.duart2.receive(1, this.peerStream());
    const c = this.peerChallenge();
    if (c !== null) this.duart2.receive(1, c);
  }

  private payFrame: number[] = [];

  private busNow = 0;
  private rxQueue: { at: number; port: Mc68681; ch: 0 | 1; b: number }[] = [];

  private static readonly REPLY_DELAY = 120_000;
  private static readonly BYTE_GAP = 40_000;

  private sendReply(
    ch: 0 | 1, bytes: number[], delay = Sc5.REPLY_DELAY, port: Mc68681 = this.duart,
  ): void {
    let at = this.busNow + delay;
    for (const b of bytes) {
      this.rxQueue.push({ at, port, ch, b: b & 0xff });
      at += Sc5.BYTE_GAP;
    }
  }

  private static readonly CC_BYTE_TIMEOUT = MASTER_CLOCK / 20;
  private payLastAt = 0;

  private payTx(ch: 0 | 1, v: number): void {
    this.duart.receive(ch, v);
    if (ch !== 0) return;
    const f = this.payFrame;
    if (f.length && this.busNow - this.payLastAt > Sc5.CC_BYTE_TIMEOUT) f.length = 0;
    this.payLastAt = this.busNow;
    f.push(v & 0xff);
    if (f.length >= 5 && f.length === 5 + (f[1] ?? 0)) {
      this.ccTalkReply(f);
      this.payFrame = [];
    } else if (f.length > 32) {
      f.shift();
    }
  }

  private ccTalkReply(f: number[]): void {
    const [dest, len, src] = f;
    const dev = this.bus.get(dest ?? 0);
    if (!dev) return;

    const msg = dev.decodeFrame
      ? dev.decodeFrame(f)
      : { header: f[3] ?? 0, data: f.slice(4, 4 + (len ?? 0)) };
    if (!msg) return;

    const rd = dev.reply(msg.header, msg.data);
    if (!rd) return;

    const host = dev.decodeFrame ? CC_HOST : (src ?? CC_HOST);
    if (dev.encodeFrame) {
      this.sendReply(0, dev.encodeFrame(host, rd));
      return;
    }
    const b = [host, rd.length, dest, 0, ...rd];
    let s = 0;
    for (const x of b) s = (s + x) & 0xff;
    this.sendReply(0, [...b, (0x100 - s) & 0xff]);
  }

  private bus = new Map<number, CcTalkDevice>([
    [CC_MECH, deviceAt(CC_MECH, DEFAULT_MECH)],
    [CC_HOPPER, deviceAt(CC_HOPPER, DEFAULT_HOPPER)],
    [CC_HOPPER2, deviceAt(CC_HOPPER2, DEFAULT_HOPPER)],
    [CC_NOTE, deviceAt(CC_NOTE, DEFAULT_NOTE)],
  ]);

  ccTalkParts: Record<number, CcTalkDevice> = {};

  private syncCcTalkParts(): void {
    this.ccTalkParts = Object.fromEntries(this.bus);
    this.payHoppers = [...this.bus.values()].filter((d): d is Sch2Hopper => d instanceof Sch2Hopper);
    for (const h of this.payHoppers) h.setPeriod(Math.floor(MASTER_CLOCK / 6));
  }

  private payHoppers: Sch2Hopper[] = [];

  setPeripherals(fitted: FittedPeripherals): void {
    const fit = (addr: number, model: string | null): void => {
      if (model === null) return;
      if (model.toUpperCase() === 'NONE') { this.bus.delete(addr); return; }
      const dev = deviceFor(model);
      if (dev) {
        dev.address = addr;
        this.bus.set(addr, dev);
        return;
      }
      this.bus.delete(addr);
      this.unmodelled.push(`${model} at ccTalk ${addr}`);
    };
    fit(CC_MECH, fitted.coinMech);
    fit(CC_HOPPER, fitted.hoppers[0] ?? null);
    fit(CC_HOPPER2, fitted.hoppers[1] ?? null);
    fit(CC_NOTE, fitted.noteAcceptor);
    this.applyDesKeys();
    this.applyBnvKey();
    this.applyDesFitted();
    this.applyMechCurrency();
    this.hookLedger();
    this.syncCcTalkParts();
    this.resetPeripherals();
  }

  private desFitted: { mech: boolean | null; note: boolean | null; hopper1: boolean | null; hopper2: boolean | null } =
    { mech: null, note: null, hopper1: null, hopper2: null };

  private mechCurrency: number | null = null;

  setCoinMechCurrency(c: number | null): void {
    this.mechCurrency = c;
    this.applyMechCurrency();
  }

  private applyMechCurrency(): void {
    const mech = this.bus.get(CC_MECH);
    if (this.mechCurrency !== null && mech instanceof Sr5iMech) mech.currency = this.mechCurrency;
  }

  setDesFitted(f: Partial<typeof this.desFitted>): void {
    this.desFitted = { ...this.desFitted, ...f };
    this.applyDesFitted();
  }

  private applyDesFitted(): void {
    const set = (addr: number, v: boolean | null): void => {
      const d = this.bus.get(addr);
      if (v !== null && d && 'desFitted' in d) (d as { desFitted: boolean }).desFitted = v;
    };
    set(CC_MECH, this.desFitted.mech);
    set(CC_NOTE, this.desFitted.note);
    set(CC_HOPPER, this.desFitted.hopper1);
    set(CC_HOPPER2, this.desFitted.hopper2);
  }

  private desKeys: Partial<Record<number, number[] | null>> = {};

  private bnvKey: number[] | null = null;

  setBnvKey(key: number[] | null): void {
    this.bnvKey = key;
    this.applyBnvKey();
  }

  private applyBnvKey(): void {
    const v = this.bus.get(CC_NOTE);
    if (this.bnvKey && v instanceof JcmEba) v.setStoredKey(this.bnvKey);
    for (const [addr, dev] of this.bus) {
      const k = this.partBnvKeys[addr];
      if (k && 'bnvKey' in dev) (dev as { bnvKey: number[] }).bnvKey = [...k];
    }
  }

  private partBnvKeys: Partial<Record<number, number[] | null>> = {};

  setPartBnvKeys(keys: { mech?: number[] | null; hopper?: number[] | null; hopper2?: number[] | null }): void {
    this.partBnvKeys = { [CC_MECH]: keys.mech, [CC_HOPPER]: keys.hopper, [CC_HOPPER2]: keys.hopper2 };
    this.applyBnvKey();
  }

  setDesKeys(keys: { mech?: number[] | null; hopper?: number[] | null; hopper2?: number[] | null; note?: number[] | null }): void {
    this.desKeys = { [CC_MECH]: keys.mech, [CC_HOPPER]: keys.hopper, [CC_HOPPER2]: keys.hopper2, [CC_NOTE]: keys.note };
    this.applyDesKeys();
  }

  private applyDesKeys(): void {
    for (const [addr, dev] of this.bus) {
      const k = this.desKeys[addr];
      if (dev.des && k !== undefined) dev.des.key = k ? [...k] : null;
    }
  }

  readonly cashLedger = newCashLedger();

  private secInMult: number[] = [];
  private secOutMult: number[] = [];
  readonly meterTotals = { in: 0, out: 0 };
  private static readonly SEC_UNIT_PENCE = 10;

  setSecMoneyMap(secIn: number[], secOut: number[]): void {
    this.secInMult = [...secIn];
    this.secOutMult = [...secOut];
    [this.secLedgerMult] = ledgerOutMults({ in: this.secInMult, out: this.secOutMult });
  }

  private secLedgerMult: number[] = [];

  private pricesOut(): boolean {
    return this.secLedgerMult.some((x) => x > 0);
  }

  private secCount(meter: number, delta: number): void {
    const inMult = this.secInMult[meter] ?? 0;
    const outMult = this.secOutMult[meter] ?? 0;
    if (inMult) this.meterTotals.in += inMult * delta;
    if (outMult) {
      this.meterTotals.out += outMult * delta;
      this.cashLedger.outPence += (this.secLedgerMult[meter] ?? 0) * delta * Sc5.SEC_UNIT_PENCE;
    }
  }

  get hoppers(): { paid: number; running: boolean }[] {
    const h = this.bus.get(CC_HOPPER);
    return [{ paid: 0, running: h instanceof Sch2Hopper && h.dispensing }];
  }

  private hookLedger(): void {
    for (const addr of [CC_HOPPER, CC_HOPPER2]) {
      const h = this.bus.get(addr);
      if (h instanceof Sch2Hopper) {
        h.onPaid = () => { if (!this.pricesOut()) this.cashLedger.unpricedOut++; };
      }
    }
    const note = this.bus.get(CC_NOTE);
    if (note instanceof JcmEba) {
      note.onStacked = (type) => { this.cashLedger.inPence += JcmEba.billPence(type) ?? 0; };
      note.onLampWord = (word) => { this.noteLamps.write(word); this.packVendLamps(); };
    }
    const mech = this.bus.get(CC_MECH);
    if (mech instanceof Sr5iMech) {
      mech.onLampWord = (word) => { this.mechLamps.write(word); this.packVendLamps(); };
    }
    this.sec.onCount = (meter, delta) => this.secCount(meter, delta);
    this.dataPak.onCashOut = (pence) => {
      if (this.pricesOut()) return;
      if (this.cashLedger.unpricedOut > 0) this.cashLedger.unpricedOut--;
      this.cashLedger.outPence += pence;
    };
  }

  readonly unmodelled: string[] = [];

  get fitted(): { addr: number; model: string }[] {
    return [...this.bus].map(([addr, d]) => ({ addr, model: d.model }))
      .sort((a, b) => a.addr - b.addr);
  }

  private get mech(): Sr5iMech | null {
    const d = this.bus.get(CC_MECH);
    return d instanceof Sr5iMech ? d : null;
  }

  private get validator(): JcmEba | null {
    const d = this.bus.get(CC_NOTE);
    return d instanceof JcmEba ? d : null;
  }

  insertNote(type: number): NoteResult {
    const v = this.validator;
    if (!v) return 'unfitted';
    return v.insertNote(type);
  }

  private resetPeripherals(): void {
    for (const d of this.bus.values()) d.reset();
    this.resetVendLamps();
  }

  private readonly mechLamps = new SwitchedLamps(16);
  private readonly noteLamps = new SwitchedLamps(16);

  static readonly MECH_LAMPS = 0x200;
  static readonly NOTE_LAMPS = 0x210;

  private resetVendLamps(): void {
    this.mechLamps.reset();
    this.noteLamps.reset();
    this.mechLamps.write(this.mech?.lampWord ?? 0x8000);
    this.noteLamps.write(this.validator?.lampWord ?? 0x8000);
    this.packVendLamps();
  }

  private packVendLamps(): void {
    for (const [first, block] of [[Sc5.MECH_LAMPS, this.mechLamps], [Sc5.NOTE_LAMPS, this.noteLamps]] as const) {
      for (let k = 0; k < 16; k += 8) {
        let byte = 0;
        for (let b = 0; b < 8; b++) if (block.shown[k + b]) byte |= 1 << b;
        this.lamps[(first + k) >> 3] = byte;
      }
    }
  }

  readonly dataPak = new DataPak(MASTER_CLOCK);

  private dataPakTx(uart: 1 | 2, ch: 0 | 1, v: number): void {
    if (uart !== 1 || ch !== 0) return;
    const reply = this.dataPak.receive(v, this.busNow);
    if (reply) this.sendReply(0, reply, Sc5.REPLY_DELAY, this.sim.uart1);
  }

  private serviceBus(): void {
    while (this.rxQueue.length && this.rxQueue[0].at <= this.busNow) {
      const q = this.rxQueue.shift()!;
      q.port.receive(q.ch, q.b);
    }
  }

  readonly security = new Sc5Security();
  readonly sec = new Sec();
  private secLatch = 0;

  loadEeprom(data: Uint8Array): void {
    this.eeprom.data.fill(0xff);
    this.eeprom.data.set(data.subarray(0, this.eeprom.data.length));
  }

  fitSec(counters: { label: string; value: number }[] = []): void {
    this.sec.fitV20();
    counters.forEach((c, i) => {
      this.sec.counters[i] = c.value;
      if (c.label) this.sec.counterText[i] = c.label;
    });
  }

  private mbusTarget: 'x1227' | 'sec' | 'led' | 'e2rom' | 'gamecard' | 'volume' | null = null;

  readonly volume = new Sc5Volume();

  readonly ledBoard = new Sc5LedBoard();

  readonly e2rom = new Sc5E2rom();

  readonly gameCard = new Sc5GameCard();

  loadGameCard(data: Uint8Array): void {
    this.gameCard.load(data);
  }

  loadE2rom(data: Uint8Array): void {
    this.e2rom.load(data);
  }

  muxLedColour(n: number): number {
    return this.ledBoard.colour(n);
  }
  private mbusExpectAddress = true;

  private mbusStart(): void {
    this.mbusExpectAddress = true;
    this.eeprom.busStart(MASTER_CLOCK);
  }

  private mbusRepeatedStart(): void {
    this.mbusExpectAddress = true;
  }

  private mbusStop(): void {
    if (this.mbusTarget === 'led') this.ledBoard.stop();
    this.mbusTarget = null;
    this.mbusExpectAddress = true;
    this.security.deselect();
    this.eeprom.stop();
  }

  private mbusWrite(v: number): void {
    if (this.mbusExpectAddress) {
      this.mbusExpectAddress = false;
      const addr = v & 0xfe;
      if (addr === Sc5Security.ADDRESS) {
        this.mbusTarget = 'sec';
        this.security.select((v & 1) === 0);
        return;
      }
      if (X1227.owns(v)) {
        this.mbusTarget = 'x1227';
        this.eeprom.select(v);
        return;
      }
      if (v === Sc5LedBoard.ADDRESS) {
        this.mbusTarget = 'led';
        this.ledBoard.select();
        return;
      }
      if (addr === Sc5E2rom.ADDRESS) {
        this.mbusTarget = 'e2rom';
        this.e2rom.select((v & 1) === 0);
        return;
      }
      if (addr === Sc5GameCard.ADDRESS) {
        this.mbusTarget = 'gamecard';
        this.gameCard.select((v & 1) === 0);
        return;
      }
      if (v === Sc5Volume.ADDRESS) {
        this.mbusTarget = 'volume';
        this.volume.select();
        return;
      }
      this.mbusTarget = null;
      return;
    }
    if (this.mbusTarget === 'sec') this.security.write(v);
    else if (this.mbusTarget === 'x1227') this.eeprom.write(v);
    else if (this.mbusTarget === 'led') this.ledBoard.write(v);
    else if (this.mbusTarget === 'e2rom') this.e2rom.write(v);
    else if (this.mbusTarget === 'gamecard') this.gameCard.write(v);
    else if (this.mbusTarget === 'volume') this.volume.write(v);
  }

  private mbusRead(): number {
    if (this.mbusTarget === 'sec') return this.security.read();
    if (this.mbusTarget === 'x1227') return this.eeprom.read();
    if (this.mbusTarget === 'e2rom') return this.e2rom.read();
    if (this.mbusTarget === 'gamecard') return this.gameCard.read();
    return 0xff;
  }

  private installReflexHopperKey(): void {
    this.eeprom.arrayRead = (addr) => {
      if (this.seg7.mode !== 'reflex' || addr < 0x30 || addr > 0x37) return null;
      const hopper = this.bus.get(CC_HOPPER);
      const key = hopper?.des?.key;
      return key ? key[addr - 0x30] : null;
    };
  }

  pinHostClock(at: Date | null): void {
    this.eeprom.pin(at, this.clockHz);
  }

  readonly ymz = new Ymz280b();
  readonly eeprom = new X1227();
  readonly vfd = Object.assign(new Bda(7, true, true), {
    scrollPeriod: 1_800_000, flashBase: 400_000, onByte: (b: number) => this.bd1.writeChar(b),
  });
  readonly bd1 = Object.assign(new Bd1(), { flashBase: 400_000 });
  segmentedAlpha = false;

  betcomAlpha: BetcomAlpha | null = null;

  fitBetcomAlpha(on: boolean): void {
    this.betcomAlpha = on ? new BetcomAlpha() : null;
    this.gameCard.key = (on ? gameCardKey(this.rom) : null) ?? new Uint8Array(8);
  }

  private rom = new Uint8Array(ROM_SIZE);
  private ram = new Uint8Array(RAM_SIZE);
  private sram = new Uint8Array(SRAM_SIZE);
  private nvram: Uint8Array | null = null;

  private wasm: ColdfireWasm | null = null;
  private wasmMode = true;
  private wasmBytesOverride: Uint8Array | null = null;

  private mbarBase = -1;
  private rambarBase = -1;

  private readonly ioLog = new Map<number, IoAccess>();
  readonly strayReads = new Map<number, number>();
  private readonly trace: IoEvent[] = [];
  private tracePos = 0;
  watchdogResets = 0;

  constructor() {
    this.volume.onLevel = (level) => this.ymz.setGain(level / 0xff);
    this.hookLedger();
    this.syncCcTalkParts();
    this.resetVendLamps();
    this.installReflexHopperKey();
    this.sim = new Mcf5206e({
      watchdogReset: () => this.onWatchdog(),
      parallelIn: () => (this.sec.data() ? 0x02 : 0) | (this.testHeld ? 0 : 0x01),
      uartTx: (uart, ch, v) => this.dataPakTx(uart, ch, v),
      mbusByte: (v) => this.mbusWrite(v),
      mbusRead: () => this.mbusRead(),
      mbusStart: () => this.mbusStart(),
      mbusRepeatedStart: () => this.mbusRepeatedStart(),
      mbusStop: () => this.mbusStop(),
      chipSelectWritten: () => this.syncChipSelects(),
    });
    this.cpu = new M68000(this, { variant: 'coldfire' });
    this.cpu.setRegionsEnabled(false);
    this.cpu.onControlReg = (reg, v) => {
      if (reg === 0xc0f) this.mbarBase = (v & 0xfffffc00) >>> 0;
      if (reg === 0xc04) {
        this.rambarBase = (v & 0xffff0000) >>> 0;
        this.wasm?.setSramBase(this.rambarBase);
      }
    };
  }

  loadRomPair(hi: Uint8Array, lo: Uint8Array): void {
    this.rom.fill(ROM_UNPLACED);
    for (let i = 0; i < hi.length && i * 2 < ROM_SIZE; i++) this.rom[i * 2] = hi[i];
    for (let i = 0; i < lo.length && i * 2 + 1 < ROM_SIZE; i++) this.rom[i * 2 + 1] = lo[i];
    const key = findSecurityKey(this.rom);
    if (key) this.security.setKey(key);
    this.machineCode = Sc5.machineCodeOf(this.rom);
    this.driftBase = findReelSettleStore(this.rom);
    this.cpu.setCodeRegion(0, this.rom);
  }

  ygv: [Ygv619, Ygv619] | null = null;
  private ygvBank = 0;

  fitAdder5(width1 = 640, height1 = 480, width2 = 640, height2 = 480): void {
    this.ygv = [new Ygv619(width1, height1, () => this.ipl4()), new Ygv619(width2, height2, () => this.ipl4())];
    this.ygvBank = 0;
  }

  private ipl4(): void {
    this.sim.setExternalIrq(4, this.scanPending || this.duart.irq() || this.duart2.irq() || (this.ygv !== null && (this.ygv[0].irq || this.ygv[1].irq)));
  }

  private ygvRegs(a: number): Ygv619 | null {
    if (this.ygv === null) return null;
    if (a >= 0x01030000 && a < 0x01030100) return this.ygv[0];
    if (a >= 0x010b0000 && a < 0x010b0100) return this.ygv[1];
    return null;
  }

  private get ygvVram(): Ygv619 {
    return this.ygv![this.ygvBank];
  }

  loadRomFlat(image: Uint8Array): void {
    const size = Math.max(ROM_SIZE, Math.ceil(image.length / 0x10000) * 0x10000);
    if (size > 0x01000000) throw new Error(`Scorpion 5 program image of ${image.length} bytes exceeds the 16M ROM window`);
    if (this.rom.length !== size) this.rom = new Uint8Array(size);
    this.rom.fill(ROM_UNPLACED);
    this.rom.set(image);
    const key = findSecurityKey(this.rom);
    if (key) this.security.setKey(key);
    this.machineCode = Sc5.machineCodeOf(this.rom);
    this.driftBase = findReelSettleStore(this.rom);
    this.cpu.setCodeRegion(0, this.rom);
  }

  machineCode: string | null = null;

  static machineCodeOf(rom: Uint8Array): string | null {
    for (let i = 0; i + 10 <= rom.length; i++) {
      if (rom[i] !== 0x60 || rom[i + 1] !== 0x08) continue;
      let ok = true;
      for (let k = 2; k < 10; k++) {
        const c = rom[i + k];
        if (!((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a))) { ok = false; break; }
      }
      if (ok) return String.fromCharCode(...rom.subarray(i + 2, i + 10));
    }
    return null;
  }

  get reelDriftBase(): number | undefined {
    return this.driftBase;
  }

  private driftBase: number | undefined;

  loadSoundRoms(parts: Uint8Array[]): void {
    const sample = new Uint8Array(0x400000);
    let at = 0;
    for (const p of parts) {
      sample.set(p.subarray(0, sample.length - at), at);
      at += p.length;
    }
    this.ymz.loadRom(sample);
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
    else this.ram.fill(0x00);
    this.warmReset(RSR_POWER);
  }

  private warmReset(cause: number): void {
    this.ioLog.clear();
    this.strayReads.clear();
    this.sram.fill(0);
    this.mbarBase = -1;
    this.rambarBase = -1;
    this.payFrame = [];
    this.rxQueue = [];
    this.busNow = 0;
    this.scanAcc = 0;
    this.scanRow = 0;
    this.scanPending = false;
    this.resetPeripherals();
    this.sim.reset(cause);
    this.duart.reset();
    this.duart2.reset();
    this.peer.fill(0);
    this.ymz.reset();
    this.vfd.reset();
    this.bd1.reset();
    this.betcomAlpha?.reset();
    this.seg7.reset();
    this.security.reset();
    this.sec.reset();
    this.ledBoard.colours.fill(0);
    this.mbusTarget = null;
    this.mbusExpectAddress = true;
    this.eeprom.stopWatchdog();
    this.x1227ResetPending = false;
    resetReelsInPlace(this.reels);
    this.reel1Low = 0;
    this.cpu.reset();
  }

  private onWatchdog(): void {
    this.watchdogResets++;
    this.warmReset(RSR_WATCHDOG);
  }

  private x1227ResetPending = false;

  private onX1227Reset(): void {
    this.x1227Resets++;
    this.warmReset(RSR_POWER);
  }

  x1227Resets = 0;

  private noteStray(addr: number): void {
    if (this.strayReads.size < 10_000 || this.strayReads.has(addr)) {
      this.strayReads.set(addr, (this.strayReads.get(addr) ?? 0) + 1);
    }
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

  private noteTrace(addr: number, value: number, write: boolean): void {
    const ev = { pc: this.cpu.instructionPc >>> 0, addr, value, write };
    if (this.trace.length < TRACE_CAP) this.trace.push(ev);
    else {
      this.trace[this.tracePos] = ev;
      this.tracePos = (this.tracePos + 1) % TRACE_CAP;
    }
  }

  private csCanon(n: number, canonBase: number, a: number): number {
    const r = this.sim.regs;
    const o = 0x64 + 12 * n;
    const base = (((r[o] << 8) | r[o + 1]) << 16) >>> 0;
    const wild = ((((r[o + 4] << 24) | (r[o + 5] << 16)) | 0xffff)) >>> 0;
    if ((((a ^ base) & ~wild) >>> 0) !== 0) return -1;
    return (canonBase | (a & wild & 0x00ffffff)) >>> 0;
  }

  private csBase(n: number): number {
    const r = this.sim.regs;
    const o = 0x64 + 12 * n;
    return (((r[o] << 8) | r[o + 1]) << 16) >>> 0;
  }

  private duartWindow(): [number, number] {
    const base = this.csBase(1);
    return base >= 0x01000000 ? [base, base + (DUART_END - DUART_BASE)] : [DUART_BASE, DUART_END];
  }

  private syncChipSelects(): void {
    const b = this.csBase(2);
    if (b !== 0) this.wasm?.setRamBase(b);
  }

  read8(addr: number): number {
    const a = addr >>> 0;

    if (a < 0x01000000) return a < this.rom.length ? this.rom[a] : ROM_UNPLACED;

    if (this.rambarBase >= 0 && a >= this.rambarBase && a < this.rambarBase + SRAM_SIZE) {
      return this.sram[a - this.rambarBase];
    }

    if (this.mbarBase >= 0 && a >= this.mbarBase && a < this.mbarBase + 0x400) {
      return this.sim.read8(a - this.mbarBase);
    }

    const c1 = this.csCanon(1, DUART_BASE, a);
    if (c1 >= 0) return (a & 1) === 0 ? this.duart.read((c1 >> 1) & 0xf) : 0xff;

    const c2 = this.csCanon(2, 0x01000000, a);
    if (c2 >= 0) {
      if (c2 < 0x01010000) return this.ram[c2 & 0xffff];
      if (c2 >= 0x01800000 && c2 < 0x01810000) return this.duart2.read((c2 & 0x1f) >> 1);
      if (this.ygv !== null && c2 >= 0x01030000) {
        const chip = this.ygvRegs(c2);
        if (chip) return chip.read8(c2 & 0xff);
      }
      this.noteIo(c2, false);
      const v = this.muxRead(c2);
      this.noteTrace(c2, v, false);
      return v;
    }

    if (this.ygv !== null) {
      const c3 = this.csCanon(3, 0x80000000, a);
      if (c3 >= 0) return this.ygvVram.vramRead8(c3 - 0x80000000);
    }

    this.noteStray(a);
    return 0;
  }

  write8(addr: number, val: number): void {
    const a = addr >>> 0;
    const v = val & 0xff;

    if (this.rambarBase >= 0 && a >= this.rambarBase && a < this.rambarBase + SRAM_SIZE) {
      this.sram[a - this.rambarBase] = v;
      return;
    }

    if (a < 0x01000000) {
      this.noteIo(a, true);
      return;
    }

    if (this.mbarBase >= 0 && a >= this.mbarBase && a < this.mbarBase + 0x400) {
      this.sim.write8(a - this.mbarBase, v);
      return;
    }

    const c1 = this.csCanon(1, DUART_BASE, a);
    if (c1 >= 0) {
      if ((a & 1) === 0) this.duart.write((c1 >> 1) & 0xf, v);
      return;
    }

    const c2 = this.csCanon(2, 0x01000000, a);
    if (c2 >= 0) {
      if (c2 < 0x01010000) {
        this.ram[c2 & 0xffff] = v;
        return;
      }
      if (c2 >= 0x01800000 && c2 < 0x01810000) { this.duart2.write((c2 & 0x1f) >> 1, v); return; }
      if (this.ygv !== null && c2 >= 0x01030000) {
        const chip = this.ygvRegs(c2);
        if (chip) { chip.write8(c2 & 0xff, v); return; }
        if (c2 === 0x01130000) { this.ygvBank = v === 0 ? 0 : 1; return; }
      }
      this.noteIo(c2, true);
      this.noteTrace(c2, v, true);
      this.muxWrite(c2, v);
      return;
    }

    if (this.ygv !== null) {
      const c3 = this.csCanon(3, 0x80000000, a);
      if (c3 >= 0) {
        this.ygvVram.vramWrite8(c3 - 0x80000000, v);
        return;
      }
    }

    this.noteStray(a);
  }

  private muxRead(addr: number): number {
    if (addr === 0x010202e0) return 0x80 | (this.scanRow << 3) | (this.scanPending ? 3 : 0);
    if (addr === 0x010202b0 || addr === 0x01020290) {
      if (this.scanPending) {
        this.scanPending = false;
        this.ipl4();
      }
      return 0xff;
    }

    if (addr === YMZ_BASE) return this.ymz.read(0);
    if (addr === YMZ_BASE + 2) return this.ymz.read(1);

    const off = addr & 0xffff;
    if (off < 0x0200 && (off & 0x0f) === 0) {
      const bank = (addr & 0x00ff0000) === 0x00020000 ? 0 : 16;
      const row = bank + (off >> 4);
      return this.switches[row] & ~this.#keyClosed[row];
    }

    if ((addr & 0x00ff0000) === 0x00020000 && (off & 0x0ff0) === 0x0240) {
      return (this.aimShootHeld ? 0x04 : 0) | AIM_GRAY[this.aimDial & 3];
    }

    return 0xff;
  }

  aimDial = 0;

  get aimShootHeld(): boolean {
    return (this.switches[AIM_ROW] & 1) === 0;
  }

  readonly switches = Uint8Array.from(SC5_SWITCH_IDLE);

  setConfigKeys(gam: { stake?: number | null; prize?: number | null; percentage?: number | null }): void {
    this.#stated.keys = { ...this.#stated.keys, ...gam };
    if (gam.percentage !== undefined) this.fittedPercentage = gam.percentage ?? -1;
    if (gam.prize !== undefined) this.fittedPrize = gam.prize ?? -1;
    if (gam.stake !== undefined) this.fittedStake = gam.stake ?? -1;
    const code = (v: number | null | undefined, table: (i: number) => number | null): number | null =>
      v === undefined ? null : v === null ? 0 : (table(v) ?? 0);
    const pct = code(gam.percentage, percentageCode);
    if (pct !== null) {
      this.setKeyBit(1, 5, pct, 3);
      this.setKeyBit(1, 6, pct, 2);
      this.setKeyBit(1, 7, pct, 1);
      this.setKeyBit(5, 5, pct, 0);
    }
    const prize = code(gam.prize, prizeCode);
    if (prize !== null) {
      this.setKeyBit(2, 5, prize, 0);
      this.setKeyBit(2, 6, prize, 1);
      this.setKeyBit(2, 7, prize, 2);
      this.setKeyBit(6, 5, prize, 3);
    }
    const stake = code(gam.stake, stakeCode);
    if (stake !== null) {
      this.setKeyBit(3, 7, stake, 0);
      this.setKeyBit(3, 6, stake, 1);
      this.setKeyBit(3, 5, stake, 2);
      this.setKeyBit(7, 5, stake, 3);
    }
  }

  #stated: {
    dips: [number, number] | null;
    keys: { stake?: number | null; prize?: number | null; percentage?: number | null };
  } = { dips: null, keys: {} };

  postRestore(): void {
    const dips = this.#stated.dips;
    if (dips) this.setDips(dips[0], dips[1]);
    this.setConfigKeys(this.#stated.keys);
    this.#panelLow.reassert(this.switches);
    this.#panelKeys.reassert(this.keyMatrix);
    this.foldKeyMatrix();
  }

  readonly keyMatrix = new Uint8Array(5);
  readonly #keyClosed = new Uint8Array(32);
  #panel: LayoutSwitch[] = [];
  readonly #panelLow = new StatedLines(8);
  readonly #panelKeys = new StatedLines(5);

  private foldKeyMatrix(): void {
    this.#keyClosed.fill(0);
    for (let j = 0; j < 4; j++) {
      const m = this.keyMatrix[j];
      this.#keyClosed[j] |= (m & 0x07) << 5;
      this.#keyClosed[j + 4] |= (m & 0x18) << 2;
    }
    const low = this.keyMatrix[4] & 0x1f;
    for (let r = 16; r < 24; r++) this.#keyClosed[r] |= low;
  }

  setLayoutSwitches(list: readonly LayoutSwitch[]): void {
    const wanted = list.filter((s) => s.number >= 0 && s.number < 256);
    if (!wanted.length) return;
    this.#panel = wanted.map((s) => ({ ...s }));
    for (const s of wanted) {
      this.layoutInput(s.number, s.closed);
      if (s.number < 40 && (s.number & 7) <= 4) this.#panelLow.stateLine(s.number, !s.closed);
      else if (s.number >= 64 && s.number < 104) this.#panelKeys.stateLine(s.number - 64, s.closed);
    }
  }

  private panelLevel(id: number): boolean {
    if (id >= 64 && id < 104) return (this.keyMatrix[(id - 64) >> 3] & (1 << (id & 7))) !== 0;
    const row = id >> 3;
    if (row >= 8 || (id & 7) > 4) return false;
    return (this.switches[row] & (1 << (id & 7))) === 0;
  }

  setDips(d1: number, d2: number): void {
    this.#stated.dips = [d1 & 0xff, d2 & 0xff];
    const top = [
      (d1 << 5) & 0xe0,
      d1 & 0xe0,
      ((d2 & 0xfc) << 3) & 0xe0,
      (d2 >> 2) & 0xe0,
      ((d1 & 0xd8) << 2) & 0xe0,
      (((d2 & 0xfb) << 5) & 0xe0) | (d1 & 0x80),
      (d2 & 0x60) | (((d2 & 0x10) << 3) & 0xe0),
      0,
    ];
    for (let r = 0; r < 8; r++) {
      const row = 16 + r;
      this.switches[row] = (this.switches[row] & 0x1f) | (~top[r] & 0xe0);
    }
  }

  get switchPanel(): CabinetSwitch[] {
    const [d1, d2] = this.optionBanks;
    const isKey = (s: LayoutSwitch): boolean => s.number >= 64 && s.number < 96;
    const level = (id: number): boolean => this.panelLevel(id);
    const rows: CabinetSwitch[] = [
      ...layoutPanelRows(this.#panel.filter((s) => !isKey(s)), level),
      ...layoutPanelRows(this.#panel.filter(isKey), level, { group: 'Key switches', option: true }),
    ];
    rows.push({ id: Sc5.TEST_SWITCH_ID, label: 'Test switch', on: this.testHeld });
    for (let i = 0; i < 16; i++) {
      const bank = i < 8 ? d1 : d2;
      rows.push({
        id: Sc5.DIL_ID_BASE + i,
        label: dilSwitchLabel(`DIL ${i + 1}`, this.dilLabels?.[i]),
        on: (bank & (1 << (i & 7))) !== 0,
        group: 'DIL switches',
        bootOnly: true,
        option: true,
      });
    }
    return rows;
  }

  get optionBanks(): readonly [number, number] { return this.#stated.dips ?? [0, 0]; }

  private dilLabels: readonly string[] | null = null;
  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  private static readonly DIL_ID_BASE = 1024;

  private static readonly TEST_SWITCH_ID = Sc5.DIL_ID_BASE + 16;
  private testHeld = false;

  private setKeyBit(row: number, bit: number, code: number, sw: number): void {
    const on = (code >> sw) & 1;
    this.switches[row] = on
      ? this.switches[row] & ~(1 << bit)
      : this.switches[row] | (1 << bit);
  }

  private scanAcc = 0;
  private scanRow = 0;
  private scanPending = false;
  private static readonly SCAN_PERIOD = 0xa000;

  private latchLamps(addr: number, val: number): boolean {
    const off = addr & 0xffff;
    if (off >= 0x0200 || (off & 0x0f) !== 0) return false;
    const bank = (addr & 0x00ff0000) === 0x00020000 ? 0 : 1;
    const index = bank * 32 + (off >> 4);
    this.lamps[index] = val & 0xff;
    if (bank === 1) this.seg7.writeBfm(val, (off >> 4) & 0x0f, (off & 0x100) ? 1 : 0);
    return true;
  }

  private muxWrite(addr: number, val: number): void {
    if (this.latchLamps(addr, val)) return;

    if (addr === 0x01020330) {
      this.drive(0, val & 0x0f);
      this.reel1Low = (val >> 4) & 0x03;
      this.updateOptics();
      return;
    }
    if (addr === 0x010102f0) {
      this.drive(2, (val >> 1) & 0x0f);
      this.updateOptics();
      return;
    }
    if (addr === 0x01010330) {
      this.drive(3, val & 0x0f);
      this.drive(1, this.reel1Low | (((val >> 4) & 0x03) << 2));
      this.updateOptics();
      return;
    }
    if (addr === YMZ_BASE + 4) {
      this.ymz.write(0, val);
      return;
    }
    if (addr === YMZ_BASE + 6) {
      this.ymz.write(1, val);
      return;
    }
    const secOff = addr & 0xffff;
    if ((addr & 0x00ff0000) === 0x00020000
      && (secOff & 0x03f0) === 0x0300 && secOff < 0x1400) {
      if ((val ^ this.secLatch) & 0x07) {
        this.sec.lineCall(this.busNow);
        this.sec.setCS((val & 0x04) !== 0);
        this.sec.setData((val & 0x02) !== 0);
        this.sec.setClock((val & 0x01) !== 0);
      }
      this.secLatch = val & 0xff;
      return;
    }
    if (addr === 0x010202f0) {
      if (this.betcomAlpha) this.betcomAlpha.writePort(val);
      else this.vfd.setSerial((val & 4) !== 0, (val & 1) !== 0, (val & 2) === 0);
    }
  }

  read16(addr: number): number {
    const a = addr >>> 0;
    if (a + 1 < this.rom.length) return (this.rom[a] << 8) | this.rom[a + 1];
    const rb = this.rambarBase;
    if (rb >= 0 && a >= rb && a + 1 < rb + SRAM_SIZE) {
      const i = a - rb;
      return (this.sram[i] << 8) | this.sram[i + 1];
    }
    const c2 = this.csCanon(2, 0x01000000, a);
    if (c2 >= 0x01000000 && c2 + 1 < 0x01010000) {
      const i = c2 & 0xffff;
      return (this.ram[i] << 8) | this.ram[i + 1];
    }
    if (this.ygv !== null) {
      if (c2 >= 0) {
        const chip = this.ygvRegs(c2);
        if (chip) return chip.read16(c2 & 0xff);
      }
      const c3 = this.csCanon(3, 0x80000000, a);
      if (c3 >= 0) return this.ygvVram.vramRead16(c3 - 0x80000000);
    }
    return ((this.read8(a) << 8) | this.read8(a + 1)) & 0xffff;
  }

  write16(addr: number, val: number): void {
    const a = addr >>> 0;
    const rb = this.rambarBase;
    if (rb >= 0 && a >= rb && a + 1 < rb + SRAM_SIZE) {
      const i = a - rb;
      this.sram[i] = (val >> 8) & 0xff;
      this.sram[i + 1] = val & 0xff;
      return;
    }
    const c2 = this.csCanon(2, 0x01000000, a);
    if (c2 >= 0x01000000 && c2 + 1 < 0x01010000) {
      const i = c2 & 0xffff;
      this.ram[i] = (val >> 8) & 0xff;
      this.ram[i + 1] = val & 0xff;
      return;
    }
    if (this.ygv !== null) {
      if (c2 >= 0) {
        const chip = this.ygvRegs(c2);
        if (chip) { chip.write16(c2 & 0xff, val & 0xffff); return; }
      }
      const c3 = this.csCanon(3, 0x80000000, a);
      if (c3 >= 0) { this.ygvVram.vramWrite16(c3 - 0x80000000, val & 0xffff); return; }
    }
    this.write8(a, (val >> 8) & 0xff);
    this.write8(a + 1, val & 0xff);
  }

  get clockHz(): number {
    return MASTER_CLOCK;
  }

  private duartAcc = 0;
  private preTicked = 0;

  deviceCatchUp(pre: number): void {
    if (pre === 0) return;
    this.preTicked += pre;
    this.busNow += pre;
    this.tickDevices(pre);
  }

  private tickDevices(span: number): void {
    this.sim.tick(span);
    this.duartAcc += span * DUART_CLOCK;
    if (this.duartAcc >= MASTER_CLOCK) {
      const ticks = (this.duartAcc / MASTER_CLOCK) | 0;
      this.duartAcc -= ticks * MASTER_CLOCK;
      if (!this.duart.idle()) this.duart.tick(ticks);
      if (!this.duart2.idle()) this.duart2.tick(ticks);
    }
    this.feedPeer();
    this.scanAcc += span;
    if (this.scanAcc >= Sc5.SCAN_PERIOD) {
      this.scanAcc -= Sc5.SCAN_PERIOD;
      this.scanRow = (this.scanRow + 1) & 15;
      if (!this.scanPending) {
        this.scanPending = true;
        this.ipl4();
      }
    }
    this.eeprom.tick(span);
    this.vfd.tick(span);
    this.bd1.tick(span);
    if (this.eeprom.watchdogTick(span)) this.x1227ResetPending = true;
    for (const h of this.payHoppers) if (h.timing) h.tick(span);
    this.ymz.tick(span, MASTER_CLOCK);
    if (this.ygv !== null) {
      this.ygv[0].tick(span);
      this.ygv[1].tick(span);
    }
  }

  useWasmCore(bytes?: Uint8Array): void {
    this.wasmMode = true;
    this.wasmBytesOverride = bytes ?? null;
    this.cpu.setRegionsEnabled(false);
  }

  useInterpreter(): void {
    if (this.wasm !== null) throw new Error('useInterpreter() after the WASM core is built');
    this.wasmMode = false;
    this.wasmBytesOverride = null;
    this.cpu.setRegionsEnabled(true);
  }

  get usingWasm(): boolean { return this.wasmMode; }

  get onWasm(): boolean { return this.wasm !== null; }

  private initWasm(): void {
    const w = new ColdfireWasm({
      wasmBytes: this.wasmBytesOverride ?? undefined,
      bus: this,
      codeBase: 0,
      romBytes: this.rom,
      ramBase: 0x01000000,
      ramSize: RAM_SIZE,
      sramSize: SRAM_SIZE,
    });
    w.ram.set(this.ram);
    this.ram = w.ram;
    w.sram.set(this.sram);
    this.sram = w.sram;
    if (this.rambarBase >= 0) w.setSramBase(this.rambarBase);
    const cs2 = this.csBase(2);
    if (cs2 !== 0) w.setRamBase(cs2);
    this.cpu.bindRegisters(w.d, w.a);
    w.sr = this.cpu.sr;
    w.pc = this.cpu.pc >>> 0;
    w.onDeviceTime = (pre) => this.deviceCatchUp(pre);
    this.cpu.setRegionsEnabled(false);
    this.wasm = w;
  }

  private stepWasm(): number {
    const cpu = this.cpu;
    const wasm = this.wasm!;
    const start = cpu.cycles;
    if (cpu.interruptPending() || cpu.halted) return cpu.stepInterpretOnce();

    const budget = Math.max(cpu.regionBudget, 1);
    wasm.pc = cpu.pc >>> 0;
    wasm.sr = cpu.sr;
    for (;;) {
      const remaining = budget - (cpu.cycles - start);
      if (remaining <= 0) break;
      const reason = wasm.run(remaining);
      cpu.cycles += wasm.used;
      if (reason !== REASON_FALLBACK) break;
      cpu.pc = wasm.pc >>> 0;
      cpu.sr = wasm.sr;
      const pre = (cpu.cycles - start) - this.preTicked;
      if (pre > 0) this.deviceCatchUp(pre);
      cpu.stepInterpretOnce();
      wasm.pc = cpu.pc >>> 0;
      wasm.sr = cpu.sr;
      if (cpu.interruptPending() || cpu.halted) break;
    }
    cpu.pc = wasm.pc >>> 0;
    cpu.sr = wasm.sr;
    return cpu.cycles - start;
  }

  step(): number {
    if (this.wasmMode && this.wasm === null) {
      try {
        this.initWasm();
      } catch (e) {
        console.warn('[sc5] WASM ColdFire core failed to start — falling back'
          + ` to the TS interpreter: ${(e as Error).message}`);
        this.wasmMode = false;
        this.wasmBytesOverride = null;
        this.cpu.setRegionsEnabled(true);
      }
    }
    {
      let budget = this.sim.nextDeadline();
      const wd = this.eeprom.watchdogHorizon();
      if (wd < budget) budget = wd;
      const t = this.duart.nextEventTicks();
      if (t !== Infinity) {
        const c = Math.floor((t * MASTER_CLOCK - this.duartAcc) / DUART_CLOCK) - 1;
        if (c < budget) budget = c > 0 ? c : 0;
      }
      if (this.rxQueue.length !== 0) {
        const toByte = this.rxQueue[0].at - this.busNow;
        if (toByte < budget) budget = toByte > 0 ? toByte : 0;
      }
      this.cpu.regionBudget = budget;
    }
    const cycles = this.wasm !== null ? this.stepWasm() : this.cpu.step();
    const rest = cycles - this.preTicked;
    this.preTicked = 0;
    this.busNow += rest;
    if (this.rxQueue.length) this.serviceBus();
    this.tickDevices(rest);
    if (this.x1227ResetPending) {
      this.x1227ResetPending = false;
      this.onX1227Reset();
    }
    const req = this.sim.request();
    if (req !== this.lastIrqReq) {
      this.lastIrqReq = req;
      this.cpu.setIRQ(req[0], req[1]);
    }
    return cycles;
  }

  private lastIrqReq: [number, number | null] | null = null;

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

  ioTrace(): IoEvent[] {
    return [...this.trace.slice(this.tracePos), ...this.trace.slice(0, this.tracePos)];
  }

  reels: Reel[] = [0, 1, 2, 3, 4, 5].map(() => new Reel(Sc5.reelConfig(96, 16)));

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: '512 LAMPS', part: '32 x 16 matrix', signal: 'lamps' },
      { id: 'switches', label: '32 SWITCHES', part: 'door - refill - test', device: this.switches },
      { id: 'meters', label: 'METERS', part: 'electronic - SEC', device: this.sec },
      { id: 'coins', label: 'COIN INPUTS', signal: 'coin' },

      { id: 'mux', label: 'MUX I/O LATCHES',
        part: 'lamp columns - switch rows - reel drives',
        device: this.lamps,
        io: [...everyNth(MUX_A_BASE, 16, 16), ...everyNth(MUX_B_BASE, 16, 16)] },
      { id: 'psu', label: 'PSU', part: 'power in' },

      { id: 'ram', label: 'BATTERY RAM', part: '64K', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: `${this.rom.length >> 20}M - hi/lo pair or flat image`, device: this.rom },
      { id: 'eeprom', label: 'RTC + EEPROM', part: 'X1227 - I2C', device: this.eeprom },
      { id: 'security', label: 'SECURITY', part: 'cartridge - I2C $12', device: this.security },
      { id: 'ymz', label: 'SOUND', part: 'YMZ280B', device: this.ymz,
        io: [[YMZ_BASE, YMZ_END]] },
      { id: 'alpha', label: 'VFD', part: 'BDA - 16 char', device: this.vfd, signal: 'display' },

      { id: 'cpu', label: 'CPU', part: 'MCF5206e ColdFire - 40 MHz', device: this.cpu, cpu: true },
      { id: 'sim', label: 'SIM', part: 'watchdog - UARTs - M-bus', device: this.sim },
      { id: 'duart', label: 'DUART', part: 'MC68681 - 3.68 MHz', device: this.duart,
        io: [this.duartWindow()] },
      { id: 'sec', label: 'SEC', part: 'meter cartridge', device: this.sec,
        io: [[SEC_PORT, SEC_PORT + 1]] },

      { id: 'datapak', label: 'DATAPAK', device: this.dataPak },
      { id: 'cctalk', label: 'ccTALK BUS', device: this.bus },
      { id: 'i2c', label: 'I2C', device: this.eeprom },
      { id: 'bdm', label: 'BDM' },

      { id: 'reels', label: 'REEL MECH', part: 'Starpoint', device: this.reels, signal: 'reels' },
      { id: 'hopper', label: 'HOPPER', part: 'ccTalk 3', device: this.bus.get(CC_HOPPER) },
      { id: 'coinmech', label: 'COIN MECH', part: 'ccTalk 2',
        device: this.bus.get(CC_MECH), signal: 'coin' },
      { id: 'notes', label: 'NOTE ACCEPTOR', part: 'ccTalk $28', device: this.bus.get(CC_NOTE) },
    ];
  }

  private drive(channel: number, phase: number): void {
    this.reels[channel]?.update(phase);
  }

  private static reelConfig(steps: number, symbols: number) {
    return {
      stepsPerRevolution: steps,
      symbols,
      mfmeJpm: true,
      opticStart: 7,
      opticWidth: 1,
    };
  }

  private reel1Low = 0;

  private readonly reelOpticInverted = [false, false, false, false, false, false];

  setReelGeometry(geometry: readonly ReelGeometry[]): void {
    if (!geometry.length) return;
    for (const g of geometry) {
      if (g.number < 0 || g.number >= this.reels.length) continue;
      const reel = new Reel(Sc5.reelConfig(g.halfSteps, g.stops));
      const w = opticWindowForFlag(g.flip ? 0 : g.optoTab);
      reel.setOpticWindow(w.start, w.width);
      this.reels[g.number] = reel;
      this.reelOpticInverted[g.number] = !g.flip && g.invertedOpto;
    }
    this.updateOptics();
  }

  setReelPosition(i: number, pos: number): void {
    const r = this.reels[i];
    if (!r) return;
    r.park(pos);
    this.updateOptics();
  }

  readonly reelsByLayoutNumber = true;

  private updateOptics(): void {
    let pattern = 0;
    for (let i = 0; i < this.reels.length; i++) {
      if (this.reels[i].optic() !== this.reelOpticInverted[i]) pattern |= 1 << i;
    }
    this.duart.inputPort = pattern;
  }
  get optionKeys(): OptionKey[] {
    const key = (
      label: string, positions: string[], get: () => number, set: (v: number) => void,
    ): OptionKey => ({
      label,
      positions: ['Not fitted', ...positions],
      position: () => get() + 1,
      fit: (v: number) => set(Math.max(0, Math.min(positions.length, v)) - 1),
    });
    return [
      key('Percentage key', SC5_PERCENTAGES,
        () => this.fittedPercentage, (v) => { this.fitConfigKey('percentage', v); }),
      key('Prize key', SC5_PRIZES,
        () => this.fittedPrize, (v) => { this.fitConfigKey('prize', v); }),
      key('Stake key', SC5_STAKES,
        () => this.fittedStake, (v) => { this.fitConfigKey('stake', v); }),
    ];
  }

  private fittedPercentage = -1;
  private fittedPrize = -1;
  private fittedStake = -1;

  private fitConfigKey(which: 'percentage' | 'prize' | 'stake', index: number): void {
    if (which === 'percentage') this.fittedPercentage = index;
    if (which === 'prize') this.fittedPrize = index;
    if (which === 'stake') this.fittedStake = index;
    const fitted = (i: number): number | null => (i >= 0 ? i : null);
    this.setConfigKeys({
      percentage: fitted(this.fittedPercentage),
      prize: fitted(this.fittedPrize),
      stake: fitted(this.fittedStake),
    });
  }

  get display(): MachineDisplay | null {
    return this.betcomAlpha ?? (this.segmentedAlpha ? this.bd1 : this.vfd);
  }

  get audioSource(): AudioSource | null {
    return this.ymz;
  }

  readonly lamps = new Uint8Array(68);

  layoutLamp(n: number): boolean {
    const i = n >> 3;
    return (this.lamps[i >= 0 && i < this.lamps.length ? i : i & 63] & (1 << (n & 7))) !== 0;
  }

  readonly seg7 = new BfmLed();

  get ledOutputs(): Uint8Array {
    return this.seg7.raw;
  }

  get segDigits(): Uint8Array {
    return this.seg7.digits;
  }

  layoutDigit(n: number): number {
    return n >= 0 && n < this.seg7.digits.length ? this.seg7.digits[n] : 0;
  }

  layoutInput(id: number, on: boolean): void {
    if (id === Sc5.TEST_SWITCH_ID) { this.testHeld = on; return; }
    if (id >= Sc5.DIL_ID_BASE && id < Sc5.DIL_ID_BASE + 16) {
      const n = id - Sc5.DIL_ID_BASE;
      const [d1, d2] = this.optionBanks;
      const mask = 1 << (n & 7);
      const raise = (v: number): number => (on ? v | mask : v & ~mask & 0xff);
      if (n < 8) this.setDips(raise(d1), d2);
      else this.setDips(d1, raise(d2));
      return;
    }
    const row = id >> 3;
    const bit = id & 7;
    if (row >= this.switches.length || bit > 4) return;
    if (row >= 8 && row <= 12) {
      const mask = 1 << bit;
      const j = row - 8;
      this.keyMatrix[j] = on ? this.keyMatrix[j] | mask : this.keyMatrix[j] & ~mask & 0xff;
      this.foldKeyMatrix();
      return;
    }
    if (row === AIM_ROW && on) {
      if (bit === 1) this.aimDial = (this.aimDial - 1) & 3;
      else if (bit === 2) this.aimDial = (this.aimDial + 1) & 3;
    }
    this.switches[row] = on
      ? this.switches[row] & ~(1 << bit)
      : this.switches[row] | (1 << bit);
  }

  isOptionLine(id: number): boolean {
    return (id & 7) > 4;
  }

  insertCoin(bit: number): void {
    const channel = (bit & 0x0f) || 1;
    if (!this.mech) { this.coinsRefused++; return; }
    if (this.coinTooSoon()) { this.coinsRefused++; return; }
    this.lastCoinAt = this.busNow >>> 0;
    if (!this.mech.insert(channel)) { this.coinsRefused++; return; }
    this.cashLedger.inPence += this.mech.pence(channel) ?? 0;
  }

  coinsRefused = 0;

  get unnamedCoinLines(): readonly number[] {
    return [];
  }

  get coinLineTable(): null {
    return null;
  }

  get coinLineTableRefusal(): string {
    return 'the coin mech is serial and names each coin itself';
  }

  get coinBusy(): boolean {
    return false;
  }

  private static readonly COIN_GAP = 400_000;
  private lastCoinAt = 0;

  private coinTooSoon(): boolean {
    return ((this.busNow - this.lastCoinAt) >>> 0) <= Sc5.COIN_GAP;
  }

  get coinRefusing(): number {
    const mech = this.mech;
    if (!mech) return 0;
    if (this.coinTooSoon()) return 0xffff;
    let mask = 0;
    for (let bit = 0; bit < 16; bit++) if (mech.refuses((bit & 0x0f) || 1)) mask |= 1 << bit;
    return mask;
  }
}
