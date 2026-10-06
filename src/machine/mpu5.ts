import { M68000 } from '../cpu/m68000';
import type { Bus16 } from '../cpu/bus68k';
import { M68kWasm, REASON_FALLBACK } from '../cpu/m68kwasm';
import { M68K_WASM_B64 } from '../cpu/m68kwasm.cpu32.data';
import { CS_WP, M68340Sim, MBAR_ADDR, RSR_POWER, RSR_WATCHDOG, SPURIOUS_VECTOR } from '../hw/m68340';
import { Mpu5Asic } from '../hw/mpu5asic';
import { Mpu5Dsp } from '../hw/mpu5dsp';
import { Mc68681 } from '../hw/mc68681';
import { Barbus, MUX_UNITS as BARBUS_MUX_UNITS, MUX_UNIT_BYTES as BARBUS_MUX_UNIT_BYTES } from '../hw/barbus';
import { MpuPic, PIC_ACCESS_CYCLES } from '../hw/pic';
import { Sec } from '../hw/sec';
import { Sr5iMech, Sch2Hopper, JcmEba, deviceFor, type CcTalkDevice } from '../hw/cctalk';
import { HopperJitter } from '../hw/hopper';
import { CcTalkBus } from '../hw/cctalkbus';
import { DataPak, V20_CPU32_DATAPAK_CLOCK } from '../hw/datapak';
import { BCO_PULSE_MS, BCO_UK, LINE, type BcoUkCoin } from '../hw/cashflow';
import { Reel } from '../hw/reel';
import type { ReelGeometry } from './layoutreels';
import { LAMP_FULL, MPU5_DIGITS, decodeDigit, decodeDigitSegLevel } from './framestate';
import { MUX_LAMP_ALT } from '../hw/muxlamps';
import { mpu5LampBanks, mpu5MatrixSwitches, type Mpu5LampBanks, type Mpu5MatrixSwitch } from './bcosdev';
import type { LayoutSwitch } from './layoutswitches';
import type { CabinetSwitch, CoinPortLines, Machine, MachineDisplay, AudioSource, OptionKey, DigitKind, NoteResult } from './machine';
import { dilSwitchLabel } from './machine';
import { newCashLedger } from './machine';
import type { BoardPart } from './parts';
import { noteRomCut } from './boarddefaults';
import { ROM_UNPLACED } from './pairplacer';
import { MODEL_RELATIONS, oursFromMfme, V20_REEL_POWER_UP_POS } from './v20optic';
import { SwitchedLamps } from '../hw/switchedlamps';
import { Msc1937 } from '../hw/msc1937';
const MUX_UNITS = BARBUS_MUX_UNITS;
const MUX_UNIT_BYTES = BARBUS_MUX_UNIT_BYTES;

export const MASTER_CLOCK = 16_515_072;
const CS1_BASE = 0xffffff00;
const PIC_SUB = 0xd0;
const DUART_SUB = 0xe0;
const ASIC_SUB = 0xf0;
const PIC_WINDOW = CS1_BASE + PIC_SUB;
const DUART_WINDOW = CS1_BASE + DUART_SUB;
const ASIC_WINDOW = CS1_BASE + ASIC_SUB;
const ADDR_TOP = 0x100000000;
const DAC_PTR = ASIC_WINDOW + 0x4;
const DAC_PTR_END = ASIC_WINDOW + 0x8;
const DAC_SAMPLE = ASIC_WINDOW + 0xe;

const ROM_SIZE = 0x800000;
const ROM_MASK = ROM_SIZE - 1;
const RAM_SIZE = 0x10000;

export const MPU5_REEL_POWER_UP = oursFromMfme(MODEL_RELATIONS.MPU5, V20_REEL_POWER_UP_POS, 96);

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

export class Mpu5 implements Bus16, Machine {
  static readonly snapshotConfig: readonly string[] = ['banks', 'nvram'];

  readonly digitKind: DigitKind = 'mpu5';
  readonly cpu: M68000;
  readonly sim: M68340Sim;
  readonly asic: Mpu5Asic;
  readonly dsp: Mpu5Dsp;
  readonly duart = new Mc68681({
    txByte: (ch, v) => this.onDuartTx(ch, v),
    outputPort: (opr, was) => {
      if (((opr ^ was) & 0x0f) !== 0) this.opLamps.write(opr & 0x0f);
      if (((opr ^ was) & 0x60) !== 0) this.boardAlphaLines(opr, was);
    },
  });

  readonly boardAlpha = new Msc1937();
  alphaRoute: 'barbus' | 'board' | null = 'barbus';

  private boardAlphaLines(opr: number, was: number): void {
    const pins = ~opr & 0xff;
    if ((opr ^ was) & 0x20) this.boardAlpha.por((pins & 0x20) !== 0);
    this.boardAlpha.data((pins & 0x80) !== 0);
    this.boardAlpha.sclk((pins & 0x40) === 0);
  }

  readonly rom = new Uint8Array(ROM_SIZE);
  private romTop = 0;
  private ram = new Uint8Array(RAM_SIZE);
  private nvram: Uint8Array | null = null;

  private readonly ioLog = new Map<number, IoAccess>();
  readonly strayReads = new Map<number, number>();
  readonly blockedWrites = new Map<number, number>();
  private readonly pcRing = new Uint32Array(256);
  private readonly srRing = new Uint16Array(256);
  private pcRingPos = 0;
  private pcSampleCount = 0;

  private readonly trace: IoEvent[] = [];
  private tracePos = 0;
  watchdogResets = 0;

  constructor() {
    this.sim = new M68340Sim({
      watchdogReset: () => this.onWatchdog(),
      busRead8: (addr) => this.read8(addr, 5),
      busWrite8: (addr, val) => this.write8(addr, val, 5),
      serialTx: (channel, v) => this.barbus.feedTx(channel, v),
    });
    this.sim.serial.sclkHz = Mpu5.DUART_X1;
    this.asic = new Mpu5Asic({
      peekRam: (addr) => this.ram[addr & 0xffff],
      peekRom: (addr) => this.rom[(addr >>> 0) & ROM_MASK],
      inputPort: () => this.payoutEcho(),
      coinPort: () => this.coinPortF(),
    });
    this.asic.clockHz = MASTER_CLOCK;
    this.pic.machineCycles = () => this.cpu.cycles;
    this.pic.clockHz = MASTER_CLOCK;
    this.dsp = new Mpu5Dsp((addr) => this.rom[(addr >>> 0) & ROM_MASK]);
    this.asic.sink = this.dsp;
    this.audioSource = this.dsp;
    this.cpu = new M68000(this, { variant: 'cpu32' });
    this.busTimed = (this.cpu as unknown as { c32Cycles: unknown }).c32Cycles !== null;
    this.cpu.onInterruptAck = (level) => this.interruptAck(level);
    this.cpu.onResetInstruction = () => {
      if (this.pendingDevice !== 0) this.catchUp();
      this.deviceTouched = true;
      this.sim.moduleReset();
      this.duart.reset();
      this.asic.reset();
      this.dsp.reset();
      this.barbus.reset();
      this.pic.reset();
      this.port9Last = 0;
      this.vendBus?.reset();
    };
    this.barbus.onAlpha = (cells, punct) => {
      this.displayChars.set(cells);
      for (let i = 0; i < 16; i++) this.displayCells[i] = (cells[i] & 0x7f) | (punct[i] << 8);
      this.alphaSeen = true;
    };
    for (let n = 0; n < 10; n++) this.setReelPosition(n, MPU5_REEL_POWER_UP);
  }

  readonly barbus = new Barbus();

  readonly pic = new MpuPic();

  readonly sec = new Sec();

  private secFitted = false;
  private port9Last = 0;

  fitSec(counters: { label: string; value: number }[] = []): void {
    this.secFitted = true;
    this.sec.fitV20();
    counters.forEach((c, i) => {
      this.sec.counters[i] = c.value;
      if (c.label) this.sec.counterText[i] = c.label;
    });
    this.sec.onCount = (meter, delta) => {
      if (this.vendCoinsIn()) return;
      if ((this.sec.counterText[meter] ?? '').trim() === 'CASH IN') {
        this.cashLedger.inPence += delta * this.meterPencePerPulse;
      }
    };
  }

  loadRom(image: Uint8Array): void {
    this.rom.fill(ROM_UNPLACED);
    noteRomCut(this, image.length, ROM_SIZE);
    this.rom.set(image.subarray(0, ROM_SIZE));
    this.romTop = Math.min(image.length, ROM_SIZE);
    this.cpu.setCodeRegion(0, this.rom.subarray(0, this.romTop));
    const v23 = ((this.rom[0x5c] << 24) | (this.rom[0x5d] << 16)
      | (this.rom[0x5e] << 8) | this.rom[0x5f]) >>> 0;
    if (v23 >= 0xffff0000) this.asic.commandAddr = v23;
    this.banks = mpu5LampBanks(this.rom);
    this.#named = mpu5MatrixSwitches(this.rom.subarray(0, this.romTop)) ?? [];
  }

  private banks: Mpu5LampBanks | null = null;

  get lampBanks(): Mpu5LampBanks | null { return this.banks; }

  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, RAM_SIZE);
    this.ram.set(this.nvram);
    this.wasm?.invalidateAllRam();
  }

  powerCycle(): void {
    this.nvram = this.ram.slice();
    this.reset();
  }

  reset(): void {
    if (this.nvram) this.ram.set(this.nvram);
    else this.ram.fill(0x00);
    this.wasm?.invalidateAllRam();
    this.warmReset(RSR_POWER);
    this.asicLamps.reset();
    this.opLamps.reset();
    this.resetVendLamps();
    this.mirrorReels();
  }

  setReelPosition(n: number, pos: number): void {
    const board = n < 5 ? this.barbus.reel5 : this.barbus.reel5b;
    board.setPosition(n % 5, pos);
    this.mirrorReels();
  }

  private warmReset(cause: number): void {
    this.ioLog.clear();
    this.strayReads.clear();
    this.blockedWrites.clear();
    this.sim.reset(cause);
    this.asic.reset();
    this.dsp.reset();
    this.duart.reset();
    this.boardAlpha.reset();
    this.barbus.reset();
    this.pic.reset();
    this.sec.reset();
    this.port9Last = 0;
    this.meterPort = 0;
    this.meterHold.fill(0);
    this.meterHoldMask = 0;
    this.vendBus?.reset();
    this.resetDataPak();
    for (const r of this.reels) r.reset();
    this.cpu.reset();
  }

  postRestore(): void {
    this.coinPort = 0xff;
    this.coinCycles = 0;
    this.wasmCsEpoch = -1;
    this.wasm?.invalidateAllRam();
    this.barbus.resyncLink();
    this.sim.serial.resync();
    this.duart.resync();
    for (const s of this.#panel) this.layoutInput(s.number, s.closed);
  }

  private onWatchdog(): void {
    this.watchdogResets++;
    this.warmReset(RSR_WATCHDOG);
  }

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

  read8(addr: number, fc?: number): number {
    this.chargeBus(addr);
    if (fc === 7) {
      if ((addr & ~3) >>> 0 === MBAR_ADDR) return this.sim.mbarByteRead(addr & 3);
      this.noteIo(addr, false);
      return 0;
    }

    if (this.sim.valid) {
      const off = addr - this.sim.base;
      if (off >= 0 && off < 0x1000) {
        if (this.pendingDevice !== 0) this.catchUp();
        this.deviceTouched = true;
        return this.sim.read8(off);
      }
    }

    const cs = this.sim.csLookup(addr);
    if (cs < 0) {
      this.noteStray(addr);
      return 0;
    }

    switch (cs & 3) {
      case 0:
        if (addr < this.romTop) return this.rom[addr];
        this.noteIo(addr, false);
        return this.rom[addr & ROM_MASK];
      case 1: {
        this.noteIo(addr, false);
        if (this.pendingDevice !== 0) this.catchUp();
        this.deviceTouched = true;
        const v = this.peripheralRead(addr);
        if ((addr & 0xfc) !== 0xf4) this.noteTrace(addr, v, false);
        return v;
      }
      default:
        return this.ram[addr & 0xffff];
    }
  }

  write8(addr: number, val: number, fc?: number): void {
    this.chargeBus(addr);
    if (fc === 7) {
      if ((addr & ~3) >>> 0 === MBAR_ADDR) {
        this.sim.mbarByteWrite(addr & 3, val);
        return;
      }
      this.noteIo(addr, true);
      return;
    }

    if (this.sim.valid) {
      const off = addr - this.sim.base;
      if (off >= 0 && off < 0x1000) {
        if (this.pendingDevice !== 0) this.catchUp();
        this.deviceTouched = true;
        this.sim.write8(off, val);
        return;
      }
    }

    const cs = this.sim.csLookup(addr);
    if (cs < 0) {
      this.noteStray(addr);
      return;
    }
    if (cs & CS_WP) {
      this.blockedWrites.set(addr, (this.blockedWrites.get(addr) ?? 0) + 1);
      return;
    }

    switch (cs & 3) {
      case 0:
        this.noteIo(addr, true);
        this.noteTrace(addr, val, true);
        return;
      case 1:
        this.noteIo(addr, true);
        if ((addr & 0xfe) !== 0xfe) this.noteTrace(addr, val, true);
        if (this.pendingDevice !== 0) this.catchUp();
        this.deviceTouched = true;
        this.peripheralWrite(addr, val);
        return;
      default:
        this.ram[addr & 0xffff] = val & 0xff;
        if (this.wasm !== null) this.wasm.ramWritten(addr & 0xffff, 1);
        {
          const cmdOff = this.asic.commandAddr & 0xffff;
          const off = addr & 0xffff;
          if (off >= cmdOff && off <= cmdOff + 5) {
            this.asic.noteCommandWrite(off - cmdOff, this.cpu.instructionCycle);
          }
        }
    }
  }

  private peripheralRead(addr: number): number {
    switch (addr & 0xf0) {
      case PIC_SUB:
        if (this.inWordAccess && (addr & 1) === 0) return 0;
        this.chargePic();
        return this.pic.read(addr & 0xf);
      case DUART_SUB:
        if ((addr & 0xf) === 0xd) return this.coinLines | this.lampSense();
        this.syncDuart(0);
        if ((addr & 0xf) === 0x4) this.duart.inputPort = this.coinLines | this.lampSense();
        return this.duart.read(addr & 0xf);
      case ASIC_SUB:
        return this.asic.read(addr & 0xf, this.cpu.instructionCycle);
      default:
        return 0;
    }
  }

  private peripheralWrite(addr: number, val: number): void {
    switch (addr & 0xf0) {
      case PIC_SUB:
        if (this.inWordAccess && (addr & 1) === 0) {
          this.picHigh = val & 0xff;
          return;
        }
        this.chargePic();
        if (this.inWordAccess) {
          this.pic.write((addr & 0xf) - 1, (this.picHigh << 8) | (val & 0xff));
          this.picHigh = 0;
        } else {
          this.pic.write(addr & 0xf, val);
        }
        return;
      case DUART_SUB:
        this.syncDuart(0);
        this.duart.write(addr & 0xf, val);
        return;
      case ASIC_SUB:
        if ((addr & 0xf) === 0x9) this.port9Write(val);
        if ((addr & 0xf) === 0x7) this.asicLampWrite(val);
        this.asic.write(addr & 0xf, val, this.cpu.instructionPc, this.cpu.instructionCycle);
        return;
    }
  }

  readonly cashLedger = newCashLedger();
  private meterPort = 0;

  private port9Write(val: number): void {
    if (this.secFitted) {
      if ((val ^ this.port9Last) & 0x06) {
        this.sec.lineCall(this.cpu.cycles);
        this.sec.setCS((val & 0x04) === 0);
        this.sec.setData((val & 0x01) === 0);
        this.sec.setClock((val & 0x02) === 0);
      }
      this.port9Last = val & 0xff;
      return;
    }
    this.meterWrite(val);
  }

  private meterWrite(val: number): void {
    const v = val & 0xff;
    const rising = v & ~this.meterPort;
    const falling = this.meterPort & ~v;
    this.meterPort = v;
    if (rising & 0x01) this.cashLedger.inPence += this.meterPencePerPulse;
    for (let i = 0, bit = 1; i < 8; i++, bit <<= 1) {
      if (rising & bit) { this.meterHold[i] = Mpu5.METER_HOLD_TICKS; this.meterHoldMask |= bit; }
      else if (falling & bit) { this.meterHold[i] = 0; this.meterHoldMask &= ~bit; }
    }
  }

  readonly meterCounts = new Uint32Array(8);
  get meterLevels(): number { return this.secFitted ? 0 : this.meterPort; }
  private readonly meterHold = new Uint8Array(8);
  private meterHoldMask = 0;
  private meterTickAcc = 0;
  private static readonly METER_HOLD_TICKS = 5;
  private static readonly METER_TICK_CYCLES = 20000;

  private tickMeters(cycles: number): void {
    this.meterTickAcc += cycles;
    while (this.meterTickAcc >= Mpu5.METER_TICK_CYCLES) {
      this.meterTickAcc -= Mpu5.METER_TICK_CYCLES;
      if (this.meterHoldMask === 0) continue;
      for (let i = 0, bit = 1; i < 8; i++, bit <<= 1) {
        if (!(this.meterHoldMask & bit) || this.meterHold[i] === 0) continue;
        if (--this.meterHold[i] !== 0) continue;
        this.meterHoldMask &= ~bit;
        this.meterCounts[i]++;
      }
    }
  }

  private meterPencePerPulse = 10;
  setMeterPencePerPulse(pence: number): void {
    if (Number.isInteger(pence) && pence >= 1 && pence <= 10_000) this.meterPencePerPulse = pence;
  }

  static meterPencePerPulseOf(program: Uint8Array): number | null {
    const M = 0x4d, E = 0x45, T = 0x54, R = 0x52;
    for (let i = 0; i + 30 < program.length; i++) {
      if (program[i] !== M || program[i + 1] !== E || program[i + 2] !== T || program[i + 3] !== R) continue;
      if (program[i + 22] !== E || program[i + 23] !== M || program[i + 24] !== M || program[i + 25] !== E) continue;
      const device = (program[i + 26] << 8) | program[i + 27];
      if (device !== 0x67) continue;
      const v = (program[i + 20] << 8) | program[i + 21];
      return v >= 1 && v <= 10_000 ? v : null;
    }
    return null;
  }

  private hopperCoinPence: [number | null, number | null] = [null, null];
  setHopperCoinPence(one: number | null, two: number | null): void {
    this.hopperCoinPence = [one, two];
  }

  static hopperCoinPenceOf(program: Uint8Array, motorDevice: number): number | null {
    const key = (-motorDevice) & 0xffff;
    const u16 = (i: number) => (program[i] << 8) | program[i + 1];
    const u32 = (i: number) => ((program[i] << 24) | (program[i + 1] << 16) | (program[i + 2] << 8) | program[i + 3]) >>> 0;
    for (let i = 0; i + 0x70 < program.length; i += 2) {
      if (u32(i) !== 0x444d4f44 || u16(i + 4) !== 1 || u32(i + 6) !== 0x5041594f) continue;
      if (u32(i + 10) !== 0x1883d040 || u16(i + 14) !== 0x54a0) continue;
      let first = -1;
      for (let j = i + 30; j < i + 0x70; j += 2) {
        const w = u16(j);
        if (w > 0xff70 && w <= 0xff7f) { first = w; break; }
      }
      if (first !== key) continue;
      const coin = u32(i + 22);
      if (coin + 10 > program.length || u32(coin) !== 0x434f494e) continue;
      const pence = u16(coin + 8);
      return pence <= 10_000 ? pence : null;
    }
    return null;
  }

  private bookHopperCoin(): void {
    this.payoutCoins++;
    const pence = this.hopperCoinPence[0];
    if (pence !== null) {
      if (pence > 0) this.cashLedger.outPence += pence;
      else this.cashLedger.unpricedTokenOut++;
      return;
    }
    const drives = this.payoutDrives();
    if (drives & 0x02) this.cashLedger.outPence += 100;
    else if (drives & 0x01) this.cashLedger.outPence += 20;
    else this.cashLedger.unpricedOut++;
  }

  read16(addr: number, fc?: number): number {
    this.chargeBusWord(addr);
    if (fc === undefined && (addr & 1) === 0
      && !(this.sim.valid && addr - this.sim.base >= 0 && addr - this.sim.base < 0x1000)) {
      const cs = this.sim.csLookup(addr);
      if (cs >= 0) {
        if ((cs & 3) === 0) {
          if (addr + 1 < this.romTop) return (this.rom[addr] << 8) | this.rom[addr + 1];
        } else if ((cs & 3) !== 1) {
          const i = addr & 0xffff;
          return (this.ram[i] << 8) | this.ram[i + 1];
        }
      }
    }
    this.inWordAccess = true;
    const v = ((this.read8(addr, fc) << 8) | this.read8(addr + 1, fc)) & 0xffff;
    this.inWordAccess = false;
    return v;
  }

  write16(addr: number, val: number, fc?: number): void {
    this.chargeBusWord(addr);
    if (fc === undefined && (addr & 1) === 0
      && !(this.sim.valid && addr - this.sim.base >= 0 && addr - this.sim.base < 0x1000)) {
      const cs = this.sim.csLookup(addr);
      if (cs >= 0 && !(cs & CS_WP) && (cs & 3) !== 0 && (cs & 3) !== 1) {
        const i = addr & 0xffff;
        this.ram[i] = (val >> 8) & 0xff;
        this.ram[i + 1] = val & 0xff;
        if (this.wasm !== null) this.wasm.ramWritten(i, 2);
        const cmdOff = this.asic.commandAddr & 0xffff;
        const at = this.cpu.instructionCycle;
        if (i >= cmdOff && i <= cmdOff + 5) this.asic.noteCommandWrite(i - cmdOff, at);
        if (i + 1 >= cmdOff && i + 1 <= cmdOff + 5) this.asic.noteCommandWrite(i + 1 - cmdOff, at);
        return;
      }
    }
    this.inWordAccess = true;
    this.write8(addr, (val >> 8) & 0xff, fc);
    this.write8(addr + 1, val & 0xff, fc);
    this.inWordAccess = false;
  }

  private busPenalty = 0;
  private readonly busTimed: boolean;
  private picHigh = 0;

  private chargePic(): void {
    if (this.busTimed && this.pic.type !== 1) this.busPenalty += PIC_ACCESS_CYCLES;
  }
  private inWordAccess = false;

  private chargeBus(addr: number): void {
    if (!this.busTimed || this.inWordAccess) return;
    this.busPenalty += this.sim.busPenalty(addr, false);
  }

  penaltyMark(): number { return this.busPenalty; }
  penaltyRestore(mark: number): void { this.busPenalty = mark; }

  private chargeBusWord(addr: number): void {
    if (!this.busTimed) return;
    this.busPenalty += this.sim.busPenalty(addr, true);
  }

  fetchCost(addr: number, words: number): void {
    if (!this.busTimed) return;
    const sign = words < 0 ? -1 : 1;
    const n = words * sign;
    let block = -1;
    let price = 0;
    for (let i = 0; i < n; i++) {
      const a = (addr + i * 2) >>> 0;
      if ((a >>> 8) !== block) {
        block = a >>> 8;
        price = this.sim.busPenalty(a, true);
      }
      this.busPenalty += sign * price;
    }
  }

  refetch16(addr: number): number {
    const owed = this.busPenalty;
    const v = this.read16(addr);
    this.busPenalty = owed;
    return v;
  }

  useInterpreter(): void {
    if (this.wasm !== null) throw new Error('useInterpreter() after the WASM core is built');
    this.wasmMode = false;
    this.wasmBytesOverride = null;
    this.cpu.useInterpreter();
  }

  useTsFastPath(): void {
    if (this.wasm !== null) throw new Error('useTsFastPath() after the WASM core is built');
    this.wasmMode = false;
    this.wasmBytesOverride = null;
  }

  useWasmCore(bytes?: Uint8Array): void {
    this.wasmMode = true;
    this.wasmBytesOverride = bytes ?? null;
  }

  get usingWasm(): boolean { return this.wasmMode; }
  get onWasm(): boolean { return this.wasm !== null; }

  private wasm: M68kWasm | null = null;
  private wasmMode = true;
  private wasmBytesOverride: Uint8Array | null = null;
  private wasmCsEpoch = -1;
  private wasmRunStart = 0;
  private wasmTicked = 0;
  private wasmDsp = false;
  private pendingDac = 0;
  private irqOther = 0;
  private wasmReplay = false;

  private initWasm(): void {
    const w = new M68kWasm({
      wasmBytes: this.wasmBytesOverride ?? M68K_WASM_B64,
      bus: this,
      variant: 'cpu32',
      codeBase: 0,
      romBytes: this.rom.subarray(0, this.romTop),
      ramSize: RAM_SIZE,
      cartSize: 0,
      onTrapPre: () => this.wasmTrapPre(),
      onTrapPost: (write) => this.wasmTrapPost(write),
      fetchPen: (addr) => this.sim.busPenalty(addr, true),
    });
    w.ram.set(this.ram);
    this.ram = w.ram;
    this.cpu.bindRegisters(w.d, w.a);
    w.setDacPeriod(Mpu5.DAC_PERIOD);
    w.setSink(this.asic.regs[0xe], this.asic.regs[0xf]);
    this.wasm = w;
    w.setShadow(0, 0, 0, 0);
    this.syncWasmRegions();
  }

  private syncWasmRegions(): void {
    const w = this.wasm!;
    const sim = this.sim;
    this.wasmCsEpoch = sim.csEpochNow;
    const c0 = sim.csWindow(0);
    const c1 = sim.csWindow(1);
    const c2 = sim.csWindow(2);
    const c3 = sim.csWindow(3);
    const simLo = sim.valid ? sim.base >>> 0 : -1;
    const simHi = simLo + 0xfff;
    const overlapsSim = (lo: number, hi: number) => simLo >= 0 && simLo <= hi && simHi >= lo;
    const inside = (lo: number, hi: number, c: { on: boolean; lo: number; hi: number }) => c.on && c.lo <= lo && c.hi >= hi;
    const overlaps = (lo: number, hi: number, c: { on: boolean; lo: number; hi: number }) => c.on && c.lo <= hi && c.hi >= lo;
    const global = sim.cs0IsGlobal;
    const cartBase = 0, cartSize = 0;
    let romTop = 0, cs0Hi = 0, romW = 1, romB = 1;
    if (global) {
      romTop = this.romTop; cs0Hi = 0xffffffff; romW = 1; romB = 1;
    } else if (c0.on && c0.lo === 0) {
      romTop = Math.min(this.romTop, c0.hi + 1);
      cs0Hi = Math.min(c0.hi + 1, 0xffffffff);
      romW = c0.wordPen; romB = c0.bytePen;
    }
    if (overlapsSim(0, romTop - 1)) romTop = 0;
    let ramBase = 0, ramSize = 0, ramW = 1, ramB = 1;
    let cs2Lo = 0, cs2Size = 0, cs2W = 1, cs2B = 1, cs2Wp = false;
    if (!global && c3.on && (c3.lo & 0xffff) === 0) {
      const lo = c3.lo;
      let hi = Math.min(c3.hi, lo + 0xffff);
      if (c1.on && c1.lo >= lo && c1.lo <= hi) hi = c1.lo - 1;
      if (hi >= lo && !overlaps(lo, hi, c0) && !overlapsSim(lo, hi)
        && !(c1.on && c1.lo < lo && c1.hi >= lo)) {
        ramBase = lo; ramSize = hi - lo + 1; ramW = c3.wordPen; ramB = c3.bytePen;
        if (overlaps(lo, hi, c2)) {
          cs2Lo = Math.max(c2.lo, lo);
          cs2Size = Math.min(c2.hi, hi) - cs2Lo + 1;
          cs2W = c2.wordPen; cs2B = c2.bytePen; cs2Wp = c2.writeProtect;
        }
      }
    }
    let shadowSize = 0, sinkSize = 0;
    if (!global && inside(DAC_PTR, DAC_SAMPLE + 1, c1) && !overlaps(DAC_PTR, DAC_SAMPLE + 1, c0)
      && !overlapsSim(DAC_PTR, DAC_SAMPLE + 1)) { shadowSize = 4; sinkSize = 2; }
    w.setRegions({
      romTop, cs0Hi, romWordPen: romW, romBytePen: romB, cartBase, cartSize,
      ramBase, ramSize, ramWordPen: ramW, ramBytePen: ramB,
      cs2Lo, cs2Size, cs2WordPen: cs2W, cs2BytePen: cs2B, cs2WriteProtect: cs2Wp,
      watchLo: ramSize ? ramBase + (this.asic.commandAddr & 0xffff) : 0, watchSize: ramSize ? 6 : 0,
      shadowBase: DAC_PTR, shadowSize, sinkBase: DAC_SAMPLE, sinkSize,
      cs1WordPen: c1.wordPen, cs1BytePen: c1.bytePen,
    });
    w.setRamCode(ramBase, ramSize);
  }

  private wasmAvec6(): boolean {
    return this.sim.autovectored(Mpu5.DAC_IRQ_LEVEL) && !this.sim.hasSourceAt(Mpu5.DAC_IRQ_LEVEL);
  }

  private wasmTrapPre(): void {
    const w = this.wasm!;
    const used = w.used;
    const pre = used - this.wasmTicked;
    if (pre > 0) {
      this.pendingDevice += pre;
      this.lastInstrCycles = w.last;
      this.wasmTicked = used;
    }
    this.cpu.cycles = this.wasmRunStart + used;
    this.cpu.setInstructionContext(w.pc0, this.cpu.cycles);
    if (this.pendingDevice !== 0) this.catchUp();
  }

  private wasmTrapPost(write: boolean): void {
    const w = this.wasm!;
    w.trapPen = this.busPenalty;
    this.busPenalty = 0;
    this.refreshIrq();
    const h = this.horizon(false, true);
    if (h === 0) w.capBudget(w.used);
    else { this.deviceTouched = false; w.capBudget(w.used + h); }
    if (write) {
      if (this.sim.csEpochNow !== this.wasmCsEpoch) this.syncWasmRegions();
      w.avec6 = this.wasmAvec6();
      if (this.asic.dspRunning !== this.wasmDsp) {
        const usedPre = w.used;
        if (this.asic.dspRunning) w.dacIn = usedPre + Mpu5.DAC_PERIOD - this.dacAcc;
        else { this.dacAcc = Mpu5.DAC_PERIOD - (w.dacIn - usedPre); w.dacIn = M68kWasm.DAC_NEVER; }
        this.wasmDsp = this.asic.dspRunning;
      }
    }
  }

  private wasmTakesIrq(): boolean {
    return this.dacPending && this.irqOther < Mpu5.DAC_IRQ_LEVEL && this.wasmAvec6();
  }

  private settleDac(): void {
    if (this.pendingDac !== 0) {
      const c = this.pendingDac;
      this.pendingDac = 0;
      if (this.dacAdvance(c)) this.refreshIrq();
    }
  }

  private wasmUnit(budget: number): boolean {
    const cpu = this.cpu;
    const w = this.wasm!;
    this.settleDac();
    const irq = cpu.interruptPending();
    let core = !cpu.halted && !(irq && !this.wasmTakesIrq());
    if (this.wasmReplay) { this.wasmReplay = false; core = false; }
    if (core) {
      const idx = w.wordIndex(cpu.pc);
      if (idx < 0) core = false;
      else {
        if (w.needsMarshal(idx)) w.marshal(idx);
        if (w.kindAt(cpu.pc) === 0 && !(irq && this.wasmTakesIrq())) core = false;
      }
    }
    if (!core) {
      if (++this.pcSampleCount >= 0x10000) {
        this.pcSampleCount = 0;
        this.pcRing[this.pcRingPos] = cpu.pc >>> 0;
        this.srRing[this.pcRingPos] = cpu.sr;
        this.pcRingPos = (this.pcRingPos + 1) & 255;
      }
      let cycles = cpu.stepInterpretOnce();
      cycles += this.settleBusPenalty(cycles);
      this.pendingDevice += cycles;
      this.pendingDac += cycles;
      this.lastInstrCycles = cycles;
      return true;
    }
    if (this.sim.csEpochNow !== this.wasmCsEpoch) this.syncWasmRegions();
    w.pc = cpu.pc;
    w.sr = cpu.sr;
    w.otherSp = cpu.inactiveSp;
    w.vbr = cpu.vbr;
    w.carry = this.busCarry;
    w.carryTail = this.busCarryTail;
    w.head = cpu.instrHead;
    w.tail = cpu.instrTail;
    w.penIn = this.busPenalty;
    this.busPenalty = 0;
    w.irqOther = this.irqOther;
    w.dacPending = this.dacPending;
    w.avec6 = this.wasmAvec6();
    this.wasmDsp = this.asic.dspRunning;
    w.dacIn = this.wasmDsp ? Mpu5.DAC_PERIOD - this.dacAcc : M68kWasm.DAC_NEVER;
    this.wasmRunStart = cpu.cycles;
    this.wasmTicked = 0;
    w.runStart = cpu.cycles;
    const reason = w.run(Math.max(1, Math.ceil(budget)));
    const used = w.used;
    if (reason === REASON_FALLBACK && w.instrs === 0 && w.irq6Taken === 0) this.wasmReplay = true;
    const pre = used - this.wasmTicked;
    if (pre > 0) this.pendingDevice += pre;
    this.lastInstrCycles = w.last;
    cpu.cycles = this.wasmRunStart + used;
    cpu.pc = w.pc;
    cpu.sr = w.sr;
    cpu.inactiveSp = w.otherSp;
    cpu.instrHead = w.head;
    cpu.instrTail = w.tail;
    if (w.instrs !== 0) cpu.setInstructionContext(w.lastPc, this.wasmRunStart + w.instrStart);
    else if (w.irq6Taken !== 0) cpu.setInstructionContext(cpu.instructionPc, this.wasmRunStart + w.instrStart);
    this.busCarry = w.carry;
    this.busCarryTail = w.carryTail;
    this.busPenalty += w.penIn;
    if (w.dacIn !== M68kWasm.DAC_NEVER) this.dacAcc = Mpu5.DAC_PERIOD - (w.dacIn - used);
    this.dacPending = w.dacPending;
    const sunk = w.takeSinkWrites();
    if (sunk !== 0) {
      this.asic.dacWrites += sunk;
      this.asic.regs[0xe] = w.sinkHi;
      this.asic.regs[0xf] = w.sinkLo;
    }
    this.refreshIrq();
    return false;
  }

  private runWasm(cycles: number): number {
    const cpu = this.cpu;
    const start = cpu.cycles;
    const end = start + cycles;
    while (cpu.cycles < end) {
      this.sliceEnd = Math.min(end, cpu.cycles + this.horizon(false));
      let stalled = 0;
      do {
        const wasHalted = cpu.halted;
        const before = cpu.cycles;
        const interp = this.wasmUnit(this.sliceEnd - cpu.cycles);
        if (cpu.cycles === before) {
          if (++stalled >= 64) throw new Error(`[mpu5] core loop stalled: ${this.wasmStallState(interp)}`);
        } else stalled = 0;
        if (this.deviceTouched) {
          this.catchUp();
          this.sliceEnd = Math.min(end, cpu.cycles + this.horizon(false));
        } else if (interp && wasHalted && cpu.halted && cpu.cycles < this.sliceEnd) {
          this.settleDac();
          if (cpu.interruptPending()) continue;
          let idleEnd = this.sliceEnd;
          if (this.asic.dspRunning) idleEnd = Math.min(idleEnd, cpu.cycles + Mpu5.DAC_PERIOD - this.dacAcc);
          if (idleEnd > cpu.cycles) {
            const steps = Math.ceil((idleEnd - cpu.cycles) / 4);
            cpu.idle(steps);
            this.pendingDevice += steps * 4;
            this.pendingDac += steps * 4;
            this.lastInstrCycles = 4;
          }
        }
      } while (cpu.cycles < this.sliceEnd);
      this.catchUp();
    }
    this.mirrorReels();
    return cpu.cycles - start;
  }

  private wasmStallState(interp: boolean): string {
    const cpu = this.cpu;
    const w = this.wasm!;
    return `pc=$${(cpu.pc >>> 0).toString(16)} sr=$${cpu.sr.toString(16)} halted=${cpu.halted} irqLevel=${(cpu as unknown as { irqLevel: number }).irqLevel}`
      + ` pending=${cpu.interruptPending()} takes6=${this.wasmTakesIrq()} dacPending=${this.dacPending} irqOther=${this.irqOther}`
      + ` avec6=${this.wasmAvec6()} kind=${w.kindAt(cpu.pc)} interp=${interp} replay=${this.wasmReplay} cycles=${cpu.cycles} sliceEnd=${this.sliceEnd}`
      + ` instrs=${w.instrs} irq6=${w.irq6Taken} used=${w.used}`;
  }

  private settleBusPenalty(instrCycles: number): number {
    const raw = this.busPenalty;
    this.busPenalty = 0;
    const owed = this.busCarry;
    const tail = Math.max(0, this.busCarryTail + owed);
    const absorbed = Math.min(tail, this.cpu.instrHead);
    let charged = owed - absorbed;
    if (instrCycles + charged < 0) charged = -instrCycles;
    this.busCarry = raw;
    this.busCarryTail = this.cpu.instrTail;
    if (charged !== 0) this.cpu.cycles += charged;
    return charged;
  }

  private busCarry = 0;
  private busCarryTail = 0;

  get clockHz(): number {
    return MASTER_CLOCK;
  }

  pinHostClock(at: Date | null): void {
    this.pic.pin(at);
  }

  private static readonly DAC_PERIOD = Math.round(MASTER_CLOCK / 48_000);
  private dacAcc = 0;
  private static readonly DAC_IRQ_LEVEL = 6;
  private dacPending = false;

  private static readonly DUART_X1 = 3_686_400;
  private duartAcc = 0;
  private duartPending = 0;
  private static readonly DUART_IRQ_LEVEL = 3;

  private syncDuart(boardCycles: number): void {
    this.duartAcc += (this.duartPending + boardCycles) * Mpu5.DUART_X1;
    this.duartPending = 0;
    if (this.duartAcc >= MASTER_CLOCK) {
      const duartTicks = Math.floor(this.duartAcc / MASTER_CLOCK);
      this.duartAcc -= duartTicks * MASTER_CLOCK;
      if (!this.duart.idle()) this.duart.tick(duartTicks);
    }
  }

  diagPeek(addr: number): number {
    if (addr < 0x10000) return this.ram[addr] ?? -1;
    const off = addr - 0x10000000;
    if (off < 0) return -1;
    const slot = off & 0xfff;
    switch (off & ~0xfff) {
      case 0x0000: {
        if (slot === 0) return this.cpu.pc >>> 0;
        if (slot === 1) return this.cpu.sr;
        if (slot === 2) return this.cpu.instructionPc >>> 0;
        if (slot === 3) return this.pcRing.length;
        if (slot === 4) return this.watchdogResets;
        return -1;
      }
      case 0x1000: return slot < 256 ? this.pcRing[(this.pcRingPos + slot) & 255] : -1;
      case 0x2000: return slot < 256 ? this.srRing[(this.pcRingPos + slot) & 255] : -1;
      case 0x3000: return slot < 8 ? this.cpu.a[slot] >>> 0 : -1;
      case 0x4000: {
        const sp = (this.cpu.a[7] + slot * 4) >>> 0;
        try {
          return (((this.read16(sp) << 16) | this.read16((sp + 2) >>> 0)) >>> 0);
        } catch { return -1; }
      }
      default: return -1;
    }
  }

  step(): number {
    if (this.wasmMode) {
      if (this.wasm === null) this.startWasm();
      if (this.wasm !== null) return this.runWasm(1);
    }
    const cycles = this.execOne();
    this.catchUp();
    return cycles;
  }

  private startWasm(): void {
    try {
      this.initWasm();
    } catch (e) {
      console.warn(`[mpu5] WASM CPU32 core failed to start — staying on the TS fast path: ${(e as Error).message}`);
      this.wasmMode = false;
      this.wasmBytesOverride = null;
    }
  }

  private pendingDevice = 0;
  private deviceTouched = false;
  private sliceEnd = 0;

  private execOne(): number {
    if (++this.pcSampleCount >= 0x10000) {
      this.pcSampleCount = 0;
      this.pcRing[this.pcRingPos] = this.cpu.pc >>> 0;
      this.srRing[this.pcRingPos] = this.cpu.sr;
      this.pcRingPos = (this.pcRingPos + 1) & 255;
    }
    let cycles = this.cpu.step();
    cycles += this.settleBusPenalty(cycles);
    this.pendingDevice += cycles;
    this.lastInstrCycles = cycles;
    return cycles;
  }

  private lastInstrCycles = 0;

  private catchUp(): void {
    const span = this.pendingDevice;
    this.pendingDevice = 0;
    this.deviceTouched = false;
    if (span > 0) this.tickDevices(span, this.lastInstrCycles);
    this.refreshIrq();
  }

  private tickDevices(span: number, last: number): void {
    if (span > last) this.barbus.tick(span - last);
    this.sim.tick(span);
    this.barbus.tick(last);
    this.reelMirrorAcc += span;
    if (this.reelMirrorAcc >= Mpu5.REEL_MIRROR_CYCLES) {
      this.reelMirrorAcc = 0;
      this.mirrorReels();
    }
    if (this.barbus.hasReply) this.barbus.pump(this.serialRxSpace, this.serialReceive);
    if (this.vendBus) {
      this.vendBus.tick(span);
      this.vendBus.pump((b) => this.duart.receive(1, b), () => this.duart.rxSpace(1));
      for (const h of this.vendHoppers) if (h.timing) h.tick(span);
    }
    if (this.dataPakOut.length || this.dataPakIn.length) this.tickDataPak(span);
    this.tickCoin(span);
    this.tickPayout(span);
    this.tickMeters(span);
    this.tickBoardClocks(span, this.wasm === null ? span : this.pendingDac);
    this.pendingDac = 0;
  }

  private horizon(withDac = true, noFlush = false): number {
    let d = noFlush ? this.sim.eventInNoFlush() : this.sim.eventIn();
    if (noFlush && d <= 0) return 0;
    const b = this.barbus.eventIn();
    if (b < d) d = b;
    if (withDac && this.asic.dspRunning) {
      const c = Mpu5.DAC_PERIOD - this.dacAcc;
      if (c < d) d = c;
    }
    if (!this.duart.idle()) {
      const t = this.duart.nextEventTicks();
      if (t !== Infinity) {
        const c = Math.floor((t * MASTER_CLOCK - this.duartAcc) / Mpu5.DUART_X1) - 1;
        if (c < d) d = c;
      }
    }
    if (this.vendBus) {
      const v = this.vendBus.eventIn();
      if (v < d) d = v;
      for (const hp of this.vendHoppers) {
        const h = hp.eventIn();
        if (h < d) d = h;
      }
    }
    if (this.coinCycles > 0 && this.coinCycles < d) d = this.coinCycles;
    if (this.coinHold > 0 && this.coinHold < d) d = this.coinHold;
    if (this.payoutBeam || this.payoutOptB || (this.duart.outputs() & Mpu5.PAYOUT_MOTOR) !== 0) {
      const t = this.hopperHorizon(this.payoutPhase, this.payoutK);
      if (t < d) d = t;
    }
    if (this.hopper2Fitted && (this.hopper2Beam || (this.duart.outputs() & Mpu5.HOPPER2_MOTOR) !== 0)) {
      const t = this.hopperHorizon(this.hopper2Phase, this.hopper2K);
      if (t < d) d = t;
    }
    return d < 1 ? 1 : d;
  }

  run(cycles: number): number {
    if (this.wasmMode) {
      if (this.wasm === null) this.startWasm();
      if (this.wasm !== null) return this.runWasm(cycles);
    }
    const cpu = this.cpu;
    const start = cpu.cycles;
    const end = start + cycles;
    while (cpu.cycles < end) {
      this.sliceEnd = Math.min(end, cpu.cycles + this.horizon());
      do {
        const wasHalted = cpu.halted;
        this.execOne();
        if (this.deviceTouched) {
          this.catchUp();
          this.sliceEnd = Math.min(end, cpu.cycles + this.horizon());
        } else if (wasHalted && cpu.halted && cpu.cycles < this.sliceEnd && !cpu.interruptPending()) {
          const steps = Math.ceil((this.sliceEnd - cpu.cycles) / 4);
          cpu.idle(steps);
          this.pendingDevice += steps * 4;
          this.lastInstrCycles = 4;
        }
      } while (cpu.cycles < this.sliceEnd);
      this.catchUp();
    }
    this.mirrorReels();
    return cpu.cycles - start;
  }

  private static readonly REEL_MIRROR_CYCLES = 4096;
  private reelMirrorAcc = 0;

  private readonly serialRxSpace = (ch: 0 | 1): number => this.sim.serialRxSpace(ch);
  private readonly serialReceive = (ch: 0 | 1, v: number): void => this.sim.serialReceive(ch, v);

  private mirrorWires: number[] = [];

  private mirrorReels(): void {
    const configured = [
      ...this.barbus.reel5.configuredSlots(),
      ...this.barbus.reel5b.configuredSlots().map((wire) => 5 + wire),
    ];
    if (configured.length && configured.length >= this.mirrorWires.length) this.mirrorWires = configured;
    for (let i = 0; i < this.reels.length; i++) {
      const at = this.mirrorWires[i];
      const board = at !== undefined && at >= 5 ? this.barbus.reel5b : this.barbus.reel5;
      const wire = at !== undefined ? at % 5 : i + 1;
      const r = this.reels[i];
      const live = board.livePosition(wire);
      const steps = r.stepsPerRevolution;
      r.position = live === 0 ? 0 : steps - (live % steps);
      r.travel = board.liveTravel(wire);
    }
  }

  private tickBoardClocks(cycles: number, dacCycles: number): void {
    if (!this.duart.idle()) this.syncDuart(cycles);
    else if ((this.duartPending += cycles) >= MASTER_CLOCK) this.syncDuart(0);
    this.dacAdvance(dacCycles);
    if (this.asic.dspRunning) this.dsp.tick(cycles, MASTER_CLOCK);
    this.displayRefreshAcc += cycles;
    if (this.displayRefreshAcc >= 100_000) {
      this.displayRefreshAcc = 0;
      this.refreshDisplay();
    }
  }

  private dacAdvance(cycles: number): boolean {
    if (this.asic.dspRunning && cycles !== 0) {
      this.dacAcc += cycles;
      if (this.dacAcc >= Mpu5.DAC_PERIOD) {
        this.dacAcc -= Mpu5.DAC_PERIOD;
        this.dacPending = true;
        return true;
      }
    }
    return false;
  }

  private refreshIrq(): void {
    let other = this.sim.request();
    if (other < Mpu5.DUART_IRQ_LEVEL && this.duart.irq()) other = Mpu5.DUART_IRQ_LEVEL;
    this.irqOther = other;
    if (this.wasm !== null) this.wasm.irqOther = other;
    const level = this.dacPending && other < Mpu5.DAC_IRQ_LEVEL ? Mpu5.DAC_IRQ_LEVEL : other;
    this.cpu.setIRQ(level);
  }

  private interruptAck(level: number): number {
    const onChip = this.sim.interruptAck(level);
    if (onChip !== null) return onChip;
    if (level === Mpu5.DAC_IRQ_LEVEL) this.dacPending = false;
    this.deviceTouched = true;
    if (this.sim.autovectored(level)) return 24 + level;
    if (level === Mpu5.DUART_IRQ_LEVEL && this.duart.irq()) return this.duart.vector();
    return SPURIOUS_VECTOR;
  }

  ioActivity(): IoAccess[] {
    return [...this.ioLog.values()].sort(
      (x, y) => y.reads + y.writes - (x.reads + x.writes),
    );
  }

  ioTrace(): IoEvent[] {
    return [...this.trace.slice(this.tracePos), ...this.trace.slice(0, this.tracePos)];
  }

  readRam(off: number): number {
    return this.ram[off & 0xffff];
  }

  statusText(): string {
    let s = '';
    for (let off = 0xff6c; off < 0xfffc; off++) {
      const b = this.ram[off];
      if (b >= 32 && b < 127) s += String.fromCharCode(b);
      else if (s.length && b === 0) break;
    }
    return s;
  }

  get bootErrorCode(): number | null {
    const groups = this.asic.blinkGroups(8_000_000);
    const n = groups.length;
    if (n >= 4
      && groups[n - 1] === groups[n - 3]
      && groups[n - 2] === groups[n - 4]) {
      return ((groups[n - 2] & 0xf) << 4) | (groups[n - 1] & 0xf);
    }
    return null;
  }

  reels: Reel[] = [0, 1, 2, 3].map(() => new Reel({ stepsPerRevolution: 96, symbols: 16 }));

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: '64 LAMPS', part: 'multiplexed 8 × 8', signal: 'lamps' },
      { id: 'buttons', label: '16 LIT BUTTONS', part: '4 × 4 matrix', device: this.barbus },
      { id: 'switches', label: '16 SWITCHES', part: 'door · refill · test', device: this.barbus },
      { id: 'sevenseg', label: '8 × 7-SEG', part: 'LED bank', signal: 'digits' },
      { id: 'meters', label: '8 METERS', part: '12 V · current sense', device: this.cashLedger },
      { id: 'coins', label: '8 COIN INPUTS', part: '+ 4 × 24 V payouts', signal: 'coin' },

      { id: 'mux', label: '2 × 8 MUX  ·  LATCHED OPEN-DRAIN DRIVES',
        part: 'lamp select / drive · switch high-side · meter drives · opto switch inputs',
        device: this.barbus, signal: 'lamps' },
      { id: 'vreg', label: '12 V REG', part: 'power in' },

      { id: 'batt', label: 'BATT MGR' },
      { id: 'ram', label: 'RAM', part: '2 × 32K · battery', device: this.ram },
      { id: 'pal', label: 'PAL' },
      { id: 'asic', label: 'ASIC', part: '$FFFFFE00 · gate array', device: this.asic,
        io: [[ASIC_WINDOW, DAC_PTR], [DAC_PTR_END, DAC_SAMPLE]] },
      { id: 'dsp', label: 'DSP', part: 'ZR38021', device: this.dsp,
        io: [[DAC_PTR, DAC_PTR_END], [DAC_SAMPLE, ADDR_TOP]] },
      { id: 'dac', label: 'DAC', part: '16-bit' },
      { id: 'amp', label: 'STEREO AMP' },

      { id: 'cpu', label: 'CPU', part: 'MC68340 · 16.5 MHz', device: this.cpu, cpu: true },
      { id: 'testport', label: 'TEST PORT', part: 'BDM · JTAG' },
      { id: 'duart', label: 'DUART', part: 'MC68681 · 2 channel', device: this.duart,
        io: [[DUART_WINDOW, ASIC_WINDOW]] },
      { id: 'progcard', label: 'PROGRAM CARD', part: 'game ROM + sound ROM', device: this.rom },

      { id: 'configkey', label: 'CONFIG KEY', device: this.pic,
        io: [[PIC_WINDOW, DUART_WINDOW]] },
      { id: 'barbus', label: 'BARBUS', device: this.barbus },
      { id: 'auxrs232', label: 'AUX RS232' },
      { id: 'dataport', label: 'DATAPORT', part: 'DataPak · DUART A',
        ...(this.dataPakType ? { device: this.dataPak } : {}) },
      { id: 'alpha', label: 'ALPHA', device: this.display ?? this.barbusDisplay, signal: 'display' },
      { id: 'vendbus', label: 'VEND BUS', part: 'ccTalk · DUART B',
        ...(this.vendBus ? { modelled: true, note: `ccTalk coin mech at 2${this.vendHoppers.length ? `, serial hopper${this.vendHoppers.length > 1 ? 's' : ''} at ${this.vendHoppers.map((h) => h.address).join(' and ')}` : ''}${this.vendNote ? ', note validator at 40,' : ''} on DUART channel B.` } : {}) },
      { id: 'secmeter', label: 'SEC METER', device: this.sec },

      { id: 'reels', label: 'REEL5', part: 'reel mech', device: this.barbus, signal: 'reels' },
      { id: 'hopper', label: 'HOPPER', part: 'payout', modelled: true,
        note: 'Modelled as the payout beams, their cadence and the motor gates, not as a device; the payout inputs follow the layout\'s Hopper Type.' },
      { id: 'coinmech', label: 'COIN MECH', part: 'acceptor', signal: 'coin' },
      { id: 'notes', label: 'NOTE ACCEPTOR', ...(this.vendNote ? { part: 'ccTalk $28', device: this.vendNote } : {}) },
    ];
  }

  setReelGeometry(geometry: readonly ReelGeometry[]): void {
    geometry.slice(0, 10).forEach((g, i) => {
      this.reels[i] = new Reel({ stepsPerRevolution: g.halfSteps, symbols: g.stops });
    });
    for (const g of geometry) {
      if (g.number < 0 || g.number >= 10) continue;
      (g.number < 5 ? this.barbus.reel5 : this.barbus.reel5b).setRevolution(g.number % 5, g.halfSteps);
    }
  }

  reelRevolution(n: number): number {
    return (n < 5 ? this.barbus.reel5 : this.barbus.reel5b).revolutionOf(n % 5);
  }

  private readonly displayChars = new Uint8Array(16).fill(0x20);
  private readonly displayCells = new Uint32Array(16);

  private alphaSeen = false;

  private displayRefreshAcc = 0;

  private refreshDisplay(): void {
    if (this.alphaSeen) return;
    const s = this.statusText().slice(0, 16).padEnd(16);
    for (let i = 0; i < 16; i++) this.displayCells[i] = this.displayChars[i] = s.charCodeAt(i) & 0x7f;
  }

  get display(): MachineDisplay | null {
    return this.alphaRoute === 'barbus' ? this.barbusDisplay
      : this.alphaRoute === 'board' ? this.boardAlpha : null;
  }

  private readonly barbusDisplay: MachineDisplay = ((self: Mpu5) => ({
    kind: 'mpu5alpha' as const,
    chars: self.displayChars,
    cellWords: self.displayCells,
    get duty() { return self.alphaSeen ? self.barbus.alphaDuty : 31; },
    text: () => [...this.displayChars]
      .map((raw) => {
        const c = raw & 0x7f;
        return (c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : ' ') + (raw & 0x80 ? '.' : '');
      })
      .join(''),
  }))(this);
  readonly audioSource: AudioSource | null;

  get switchPanel(): CabinetSwitch[] {
    const level = (n: number): boolean => {
      const strobe = n >> 3;
      if (strobe === 4) return (this.barbus.inputs & (0x100 << (n & 7))) !== 0;
      if (strobe === 5) return (this.barbus.inputs & (1 << (n & 7))) !== 0;
      return (this.matrix[strobe] & (1 << (n & 7))) !== 0;
    };
    const rows: CabinetSwitch[] = this.#named.map((s) => ({
      id: s.number,
      label: s.name.charAt(0) + s.name.slice(1).toLowerCase(),
      on: level(s.number),
    }));
    const named = new Set(this.#named.map((s) => s.number));
    const drawn = this.#panel.filter((s) => !named.has(s.number));
    const repeats = new Map<string, number>();
    for (const s of drawn) if (s.label) repeats.set(s.label, (repeats.get(s.label) ?? 0) + 1);
    const nth = new Map<string, number>();
    for (const s of drawn) {
      const n = (nth.get(s.label) ?? 0) + 1;
      nth.set(s.label, n);
      const label = s.label
        ? (repeats.get(s.label)! > 1 ? `${s.label} ${n}` : s.label).replace(/\s+/g, ' ').trim()
        : `Switch ${s.number}`;
      rows.push({ id: s.number, label, on: level(s.number) });
    }
    return [...rows, ...this.dilRows];
  }
  readonly optionKeys: readonly OptionKey[] = [];

  private readonly lampSnapshot = new Uint8Array(0x250);

  private readonly asicLamps = new SwitchedLamps(8);
  private readonly opLamps = new SwitchedLamps(4);
  private asic7Written = 0;

  private asicLampWrite(val: number): void {
    const v = val & 0xff;
    if (v === this.asic7Written) return;
    this.asic7Written = v;
    this.asicLamps.write(v);
  }

  static readonly ASIC_LAMPS = 0x228;
  static readonly OP_LAMPS = 0x230;

  private planePair(base: number, stride: number, i: number): number {
    if (!base) return 0;
    const p = this.banks!.phase & 0xffff;
    const q = (((this.ram[p] << 8) | this.ram[p + 1]) & 3) * stride * 2;
    return this.ram[base + q + i] | (this.ram[base + q + stride + i] << 8);
  }

  private spreadMux(out: Uint8Array, first: number, unit: number, col: number, pair: number): void {
    const p1 = pair & 0xff;
    const p2 = (pair >> 8) & 0xff;
    for (let bit = 0; bit < 8; bit++) {
      const state = ((p1 >> bit) & 1) | (((p2 >> bit) & 1) << 1);
      out[first + col + bit * 8] = this.barbus.muxLevel(unit, col, state);
    }
  }

  get lamps(): Uint8Array {
    const out = this.boardLamps();
    this.paintVendLamps(out);
    out.set(this.asicLamps.shown, Mpu5.ASIC_LAMPS);
    out.set(this.opLamps.shown, Mpu5.OP_LAMPS);
    return out;
  }

  private boardLamps(): Uint8Array {
    const out = this.lampSnapshot;
    if (!this.barbus.lampsLive) return out.fill(0);
    out.fill(0);
    const wire = this.barbus.muxLamps;
    const banks = this.barbus.muxBanks;
    for (let unit = 0; unit < MUX_UNITS; unit++) {
      const base = this.barbus.muxBase[unit];
      if (base < 0) continue;
      for (let bank = 0; bank < banks; bank++) {
        const a = unit * MUX_UNIT_BYTES + bank * 16;
        const first = base + bank * 64;
        if (first + 64 > 480) break;
        for (let col = 0; col < 8; col++) {
          this.spreadMux(out, first, unit, col, wire[a + col] | (wire[a + 8 + col] << 8));
        }
      }
    }
    if (!this.banks) {
      for (let n = 0; n < 64; n++) out[n] = this.asic.matrixLevel[n];
      const lit = this.barbus.reelLamps;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 5; col++) {
          const bit = col + 3;
          const state = ((lit[row] >> bit) & 1) | (((lit[row + 3] >> bit) & 1) << 1);
          out[480 + row * 8 + col] = this.barbus.reelLampLevel(row, state);
        }
      }
      return out;
    }
    const b = this.banks;
    for (let i = 0; i < 8; i++) {
      const pair = this.planePair(b.asic & 0xffff, 9, i);
      for (let bit = 0; bit < 8; bit++) {
        const state = ((pair >> bit) & 1) | (((pair >> (8 + bit)) & 1) << 1);
        out[i * 8 + bit] = state === 0 ? 0 : state === 3 ? LAMP_FULL : MUX_LAMP_ALT;
      }
    }
    if (b.cabinet) for (let i = 0; i < 8; i++) this.spreadMux(out, 64, 0, i, this.planePair(b.cabinet & 0xffff, 9, i));
    if (b.zone) for (let i = 0; i < 8; i++) this.spreadMux(out, 128, 0, i, this.planePair(b.zone & 0xffff, 9, i));
    for (let i = 0; i < 3; i++) {
      const pair = this.planePair(b.reelLights & 0xffff, 4, i);
      const row = i;
      for (let col = 0; col < 5; col++) {
        const bit = col + 3;
        const state = ((pair >> bit) & 1) | (((pair >> (8 + bit)) & 1) << 1);
        out[480 + row * 8 + col] = this.barbus.reelLampLevel(row, state);
      }
    }
    return out;
  }

  get segDigits(): Uint8Array {
    const out = this.digitSnapshot;
    const lv = MPU5_DIGITS;
    for (let n = 0; n < 8; n++) {
      out[n] = this.asic.asicDigit(n);
      out.fill(0xff, lv + n * 8, lv + n * 8 + 8);
    }
    const word = this.barbus.muxLedWord;
    out.set(word.subarray(0, MPU5_DIGITS - 8), 8);
    out.set(this.barbus.muxLedLevel.subarray(0, (MPU5_DIGITS - 8) * 8), lv + 64);
    return out;
  }

  private readonly digitSnapshot = new Uint8Array(MPU5_DIGITS * 9);

  get ledOutputs(): Uint8Array {
    const out = this.ledTable;
    for (let d = 0; d < 8; d++) out[d] = this.asic.asicDigit(d);
    const word = this.barbus.muxLedWord;
    for (let unit = 0; unit < 4; unit++) {
      for (let bit = 0; bit < 8; bit++) out[8 + unit * 16 + bit] = word[unit * 8 + bit];
    }
    return out;
  }

  readonly ledKind = 'plain';

  private readonly ledTable = new Uint8Array(64);

  layoutLamp(n: number): boolean {
    return this.layoutLampLevel(n) !== 0;
  }

  layoutLampLevel(n: number): number {
    const raw = this.lamps;
    return n >= 0 && n < raw.length ? raw[n] : 0;
  }

  layoutDigit(n: number): number {
    return decodeDigit('mpu5', this.segDigits, null, n);
  }

  layoutDigitSegLevel(n: number, seg: number): number {
    return decodeDigitSegLevel('mpu5', this.segDigits, n, seg);
  }

  readonly matrix = new Uint8Array(16);

  #named: Mpu5MatrixSwitch[] = [];
  get programSwitches(): readonly Mpu5MatrixSwitch[] { return this.#named; }
  #panel: LayoutSwitch[] = [];

  layoutInput(id: number, on: boolean): void {
    if (id >= Mpu5.DIL_ID_BASE && id < Mpu5.DIL_ID_BASE + 16) {
      const n = id - Mpu5.DIL_ID_BASE;
      const mask = 1 << (n & 7);
      const raise = (v: number): number => (on ? v | mask : v & ~mask & 0xff);
      if (n < 8) this.optionSwitches1 = raise(this.optionSwitches1);
      else this.optionSwitches2 = raise(this.optionSwitches2);
      return;
    }
    if (id < 0 || id >= this.matrix.length * 8) return;
    const strobe = id >> 3;
    if (strobe === 4 || strobe === 5) {
      const mask = strobe === 4 ? 0x100 << (id & 7) : 1 << (id & 7);
      if (on) this.barbus.inputs |= mask;
      else this.barbus.inputs &= ~mask;
      return;
    }
    const mask = 1 << (id & 7);
    if (on) this.matrix[strobe] |= mask;
    else this.matrix[strobe] &= ~mask & 0xff;
  }

  private switchNibble(): number {
    const row = this.lowSelect();
    return row >= 1 && row <= 4 ? (this.matrix[row - 1] & 0x0f) << 4 : 0;
  }

  private lowSelect(): number {
    const c = ~this.asic.regs[0x5] & 0xff;
    return c !== 0 && (c & (c - 1)) === 0 ? 32 - Math.clz32(c) : 0;
  }

  setLayoutSwitches(list: readonly LayoutSwitch[]): number[] {
    const unapplied: number[] = [];
    for (const s of list) {
      if (!Mpu5.reachesFirmware(s.number) && !this.loopbackLine(s.number)) { unapplied.push(s.number); continue; }
      this.#panel.push({ ...s });
      this.layoutInput(s.number, s.closed);
    }
    return unapplied;
  }

  presetOperatorSwitch(id: number, made: boolean, label: string): void {
    if (!Mpu5.reachesFirmware(id)) return;
    this.layoutInput(id, made);
    if (!this.#panel.some((s) => s.number === id)) this.#panel.push({ number: id, label, closed: made });
  }

  private loopbackLine(n: number): boolean {
    return this.dataPakType === 2 && (n === 96 || n === 97);
  }

  private static reachesFirmware(n: number): boolean {
    if (n >= 32 && n < 48) return true;
    if (n >= 80 && n < 88) return true;
    if (n >= 104 && n < 108) return true;
    return n >= 0 && n < 32 && (n & 7) < 4;
  }

  private get coinLines(): number {
    let v = 0x80 | (this.nv4Fitted ? 0 : Mpu5.NO_AUX)
      | (this.optionSwitch() ? 0x01 : 0)
      | (this.meterSense() ? 0x10 : 0)
      | (this.payoutDrives() !== 0 ? 0x20 : 0);
    if (this.dataPakType === 2) v &= ~((this.matrix[12] & 3) << 1);
    return v;
  }

  private lampSense(): number {
    if (!this.lampTestPass) return 0;
    const high = this.asic.regs[0x1];
    const low = this.lowSelect();
    if (high === 0 || low === 0) return 0;
    return this.asic.lampCurrent(high, low) ? 0x08 : 0;
  }

  get lampTestPass(): boolean { return this.barbus.lampTestPass; }
  set lampTestPass(v: boolean) { this.barbus.lampTestPass = v; }

  private optionSwitch(): boolean {
    return (this.optionSwitches1 & (0x100 >> this.lowSelect())) !== 0;
  }

  optionSwitches1 = 0;

  get optionSwitches2(): number { return this.pic.config.optionSwitches & 0xff; }
  set optionSwitches2(v: number) {
    this.pic.config = { ...this.pic.config, optionSwitches: v & 0xff };
  }

  get dilRows(): CabinetSwitch[] {
    const out: CabinetSwitch[] = [];
    for (let i = 0; i < 16; i++) {
      const bank = i < 8 ? this.optionSwitches1 : this.optionSwitches2;
      out.push({
        id: Mpu5.DIL_ID_BASE + i,
        label: dilSwitchLabel(`Sw ${i < 8 ? 1 : 2}.${(i & 7) + 1}`, this.dilLabels?.[i]),
        on: (bank & (1 << (i & 7))) !== 0,
        group: i < 8 ? 'Option switches - MPU5 board' : 'Option switches - program card',
        option: true,
        bootOnly: true,
      });
    }
    return out;
  }

  private dilLabels: readonly string[] | null = null;
  setDilLabels(labels: readonly string[] | null): void { this.dilLabels = labels; }

  static readonly DIL_ID_BASE = 0x200;

  private meterSense(): boolean {
    if (this.secFitted) return !this.sec.data();
    return this.asic.regs[0x9] !== 0;
  }

  private static readonly PAYOUT_DRIVES = 0x0f;

  private payoutDrives(): number {
    return this.duart.outputs() & Mpu5.PAYOUT_DRIVES;
  }

  private static readonly PAYOUT_SWITCH_INPUTS = 0x0f;

  private static readonly NO_AUX = 0x06;
  nv4Fitted = false;

  private payoutEcho(): number {
    return this.payoutNibble() | this.switchNibble();
  }

  private payoutNibble(): number {
    const d = this.payoutDrives();
    const pin1 = Mpu5.countPin(this.payoutBeam, (d & 0x01) !== 0, (d & 0x02) !== 0);
    switch (this.hopperLaw) {
      case 0: return pin1;
      case 1: return (this.payoutOptB ? 0 : 0x01) | (this.payoutBeam ? 0 : 0x02);
      case 2: return pin1 | (this.hopper2Pin(d) << 2);
      case 3: return this.payoutBeam ? 0x01 : 0x00;
      case 4: return 0x0f;
      case 5: return pin1 | (Mpu5.PAYOUT_SWITCH_INPUTS & ~0x01);
      case 6: return pin1 | (this.hopper2Pin(d) << 3);
      default: return ~this.matrix[13] & 0x0f;
    }
  }

  private hopper2Pin(d: number): number {
    return Mpu5.countPin(this.hopper2Beam, (d & 0x04) !== 0, (d & 0x08) !== 0);
  }

  private static countPin(beam: boolean, motor: boolean, supply: boolean): number {
    if (!motor && !supply) return 1;
    return beam ? 1 : 0;
  }

  private static readonly HOPPER_TYPES: readonly string[] =
    ['Compact', 'Universal', 'Twin', 'New', 'Serial', 'Compact 2', 'Twin 2', 'None'];
  private static readonly HOPPER_FALLBACK_LAW = 5;
  static knowsHopperType(type: string): boolean {
    return Mpu5.HOPPER_TYPES.includes(type);
  }
  private hopperLaw = Mpu5.HOPPER_FALLBACK_LAW;

  private static readonly PAYOUT_MOTOR = 0x01;
  private static readonly MS = MASTER_CLOCK / 1000;

  private static readonly HOPPERS: Record<string, { rate: number; pulseMs: number }> = {
    Compact: { rate: 10, pulseMs: 25 },
    'Compact 2': { rate: 10, pulseMs: 25 },
    Universal: { rate: 3, pulseMs: 100 },
    Twin: { rate: 10, pulseMs: 25 },
    'Twin 2': { rate: 10, pulseMs: 25 },
  };

  private static readonly HOPPER_FALLBACK = 'Compact';

  private payoutPeriod =
    Math.round(1000 / Mpu5.HOPPERS[Mpu5.HOPPER_FALLBACK].rate * Mpu5.MS);
  private payoutPulse =
    Math.round(Mpu5.HOPPERS[Mpu5.HOPPER_FALLBACK].pulseMs * Mpu5.MS);
  private payoutPhase = 0;
  private payoutK = 0;
  private readonly hopperJitter = new HopperJitter();
  private payoutBeam = false;
  private payoutOptB = false;
  private payoutLag = 0;
  private static readonly UNIVERSAL_LAG_MS = 5;
  private payoutCoins = 0;

  private hopper2Fitted = false;
  private hopper2Phase = 0;
  private hopper2K = 0;
  private hopper2Beam = false;
  private hopper2Coins = 0;
  private static readonly HOPPER2_MOTOR = 0x04;

  get hoppers(): { paid: number; running: boolean }[] {
    const turns = this.hopperLaw !== 4 && this.hopperLaw !== 7;
    const parallel = turns && (this.duart.outputs() & Mpu5.PAYOUT_MOTOR) !== 0;
    const one = { paid: this.payoutCoins, running: parallel || this.vendHoppers.some((h) => h.dispensing) };
    if (!this.hopper2Fitted) return [one];
    return [one, { paid: this.hopper2Coins, running: turns && (this.duart.outputs() & Mpu5.HOPPER2_MOTOR) !== 0 }];
  }

  setHopper(type: string | null): void {
    const p = (type && Mpu5.HOPPERS[type]) || Mpu5.HOPPERS[Mpu5.HOPPER_FALLBACK];
    this.payoutPeriod = Math.round(1000 / p.rate * Mpu5.MS);
    this.payoutPulse = Math.round(p.pulseMs * Mpu5.MS);
    const law = type === null ? -1 : Mpu5.HOPPER_TYPES.indexOf(type);
    this.hopperLaw = law >= 0 ? law : Mpu5.HOPPER_FALLBACK_LAW;
    this.payoutLag = type === 'Universal' ? Math.round(Mpu5.UNIVERSAL_LAG_MS * Mpu5.MS) : 0;
    this.hopper2Fitted = type === 'Twin' || type === 'Twin 2';
    this.serialHopper = type === 'Serial';
  }

  private serialHopper = false;

  private vendBus: CcTalkBus | null = null;
  private vendMech: Sr5iMech | null = null;
  private vendHoppers: Sch2Hopper[] = [];
  static readonly SERIAL_HOPPER_PERIOD = 0x2aab2d;
  private static readonly VEND_MECH = 2;
  private static readonly VEND_HOPPER = 3;
  private static readonly VEND_HOPPER2 = 4;
  private static readonly VEND_NOTE = 0x28;
  private static readonly VEND_CHANNELS = [7, 4, 3, 2, 1, 6, 5];

  private vendCoinsIn(): boolean {
    return this.vendBus !== null && this.vendMech !== null && this.vendBus.spokenTo(this.vendMech);
  }

  get vend(): CcTalkBus | null {
    return this.vendBus;
  }

  fitVendBus(hoppers: readonly (string | null)[] = ['SCH 2', 'SCH 2']): void {
    if (this.vendBus) return;
    const bus = new CcTalkBus({
      replyDelay: 2 * Mpu5.MS,
      byteGap: Math.round(Mpu5.MS * 10 / 9.6),
      frameGap: 50 * Mpu5.MS,
    });
    const mech = new Sr5iMech();
    mech.onCredit = (channel) => {
      const pence = Sr5iMech.channelPence(channel);
      if (pence) this.cashLedger.inPence += pence;
    };
    bus.fit(Mpu5.VEND_MECH, mech);
    const parts: Record<number, CcTalkDevice> = { [Mpu5.VEND_MECH]: mech };
    const payers: Sch2Hopper[] = [];
    [Mpu5.VEND_HOPPER, Mpu5.VEND_HOPPER2].forEach((address, i) => {
      const model = hoppers[i] ?? 'SCH 2';
      const dev = model.trim().toUpperCase() === 'NONE' ? null : deviceFor(model);
      if (!(dev instanceof Sch2Hopper)) return;
      dev.address = address;
      dev.setPeriod(Mpu5.SERIAL_HOPPER_PERIOD);
      dev.onPaid = () => { this.cashLedger.outPence += 100; };
      bus.fit(address, dev);
      parts[address] = dev;
      payers.push(dev);
    });
    this.vendBus = bus;
    this.vendMech = mech;
    this.vendHoppers = payers;
    this.ccTalkParts = parts;
    mech.onLampWord = (word) => this.mechLamps.write(word);
    this.mechLamps.write(mech.lampWord);
  }

  private paintVendLamps(out: Uint8Array): void {
    out.set(this.noteLamps.shown, Mpu5.NOTE_LAMPS);
    out.set(this.mechLamps.shown, Mpu5.MECH_LAMPS);
  }

  private readonly noteLamps = new SwitchedLamps(16);
  private readonly mechLamps = new SwitchedLamps(16);

  private resetVendLamps(): void {
    this.noteLamps.reset();
    this.mechLamps.reset();
    this.noteLamps.write(this.vendNote?.lampWord ?? 0x8000);
    this.mechLamps.write(this.vendMech?.lampWord ?? 0x8000);
  }

  static readonly NOTE_LAMPS = 0x210;
  static readonly MECH_LAMPS = 0x240;

  fitNoteValidator(type: number): boolean {
    if (!this.vendBus || type !== 1) return false;
    const v = new JcmEba();
    v.address = Mpu5.VEND_NOTE;
    v.desFitted = false;
    v.onStacked = (billType) => { this.cashLedger.inPence += JcmEba.billPence(billType) ?? 0; };
    this.vendBus.fit(Mpu5.VEND_NOTE, v);
    this.vendNote = v;
    v.onLampWord = (word) => this.noteLamps.write(word);
    this.noteLamps.write(v.lampWord);
    this.ccTalkParts = { ...this.ccTalkParts, [Mpu5.VEND_NOTE]: v };
    return true;
  }

  private vendNote: JcmEba | null = null;

  get noteReaderFitted(): boolean {
    return this.vendNote !== null;
  }

  insertNote(type: number): NoteResult {
    return this.vendNote ? this.vendNote.insertNote(type) : 'unfitted';
  }

  ccTalkParts: Record<number, CcTalkDevice> = {};

  readonly dataPak = new DataPak(V20_CPU32_DATAPAK_CLOCK);
  private dataPakType = 0;
  private dataPakOut: number[] = [];
  private dataPakWait = 0;
  private dataPakIn: { wait: number; b: number }[] = [];
  private static readonly DATAPAK_TURNAROUND = 50_000;

  fitDataPak(type: number): void {
    this.dataPakType = type;
  }

  private onDuartTx(channel: 0 | 1, v: number): void {
    if (channel === 1 && this.vendBus) {
      this.vendBus.tx(v);
      if (this.duart.rxEnabled(1)) this.duart.receive(1, v);
    }
    if (channel !== 0 || this.dataPakType === 0) return;
    if (this.dataPakType === 2) {
      this.dataPakIn.push({ wait: this.charCyclesA(), b: v });
      return;
    }
    const reply = this.dataPak.receive(v, this.cpu.cycles);
    if (!reply) return;
    if (this.dataPakOut.length === 0) this.dataPakWait = Mpu5.DATAPAK_TURNAROUND;
    this.dataPakOut.push(...reply);
  }

  private charCyclesA(): number {
    return Math.ceil(this.duart.characterTicks(0) * MASTER_CLOCK / Mpu5.DUART_X1);
  }

  private tickDataPak(cycles: number): void {
    if (this.dataPakOut.length) {
      this.dataPakWait -= cycles;
      while (this.dataPakOut.length && this.dataPakWait <= 0) {
        this.dataPakIn.push({ wait: this.charCyclesA() + this.dataPakWait, b: this.dataPakOut.shift()! });
        this.dataPakWait += Mpu5.DATAPAK_TURNAROUND;
      }
    }
    while (this.dataPakIn.length) {
      const head = this.dataPakIn[0];
      head.wait -= cycles;
      cycles = 0;
      if (head.wait > 0 || this.duart.rxSpace(0) === 0) break;
      this.duart.receive(0, head.b);
      this.dataPakIn.shift();
      if (this.dataPakIn.length) this.dataPakIn[0].wait += head.wait;
    }
  }

  private resetDataPak(): void {
    this.dataPak.reset();
    this.dataPakOut = [];
    this.dataPakWait = 0;
    this.dataPakIn = [];
  }

  private tickPayout(cycles: number): void {
    if (this.hopperLaw === 4 || this.hopperLaw === 7) return;
    const d = this.payoutDrives();
    const s1 = this.stepHopper(this.payoutPhase, this.payoutK, (d & Mpu5.PAYOUT_MOTOR) !== 0, this.payoutBeam, cycles);
    this.payoutPhase = s1.phase;
    this.payoutK = s1.k;
    if (s1.a && !this.payoutBeam) this.bookHopperCoin();
    this.payoutBeam = s1.a;
    this.payoutOptB = s1.b;
    if (!this.hopper2Fitted) return;
    const s2 = this.stepHopper(this.hopper2Phase, this.hopper2K, (d & Mpu5.HOPPER2_MOTOR) !== 0, this.hopper2Beam, cycles);
    this.hopper2Phase = s2.phase;
    this.hopper2K = s2.k;
    if (s2.a && !this.hopper2Beam) {
      this.hopper2Coins++;
      const pence = this.hopperCoinPence[1];
      if (pence === null) this.cashLedger.unpricedOut++;
      else if (pence > 0) this.cashLedger.outPence += pence;
      else this.cashLedger.unpricedTokenOut++;
    }
    this.hopper2Beam = s2.a;
  }

  private hopperGapK(): number {
    return this.hopperJitter.next();
  }

  private hopperSpan(k: number): number {
    const tail = this.payoutPulse + this.payoutLag;
    return (this.payoutPeriod - tail) * Math.max(1, k) + tail;
  }

  private stepHopper(phase: number, k: number, running: boolean, beam: boolean, cycles: number):
    { phase: number; k: number; a: boolean; b: boolean } {
    const tail = this.payoutPulse + this.payoutLag;
    let period = this.hopperSpan(k);
    const inWindow = beam || (k !== 0 && phase >= period - tail);
    if (!running && !inWindow) return { phase: 0, k: 0, a: false, b: false };
    if (k === 0) { k = this.hopperGapK(); period = this.hopperSpan(k); }
    phase += cycles;
    if (phase >= period) {
      if (!running) return { phase: 0, k: 0, a: false, b: false };
      phase -= period;
      k = this.hopperGapK();
      period = this.hopperSpan(k);
    }
    const a = phase >= period - tail && phase < period - this.payoutLag;
    const b = phase >= period - this.payoutPulse;
    return { phase, k, a, b };
  }

  private hopperHorizon(phase: number, k: number): number {
    const period = this.hopperSpan(k);
    let d = period - phase;
    for (const edge of [
      period - this.payoutPulse - this.payoutLag,
      period - this.payoutLag,
      period - this.payoutPulse,
    ]) {
      const t = edge - phase;
      if (t > 0 && t < d) d = t;
    }
    return d;
  }

  private static readonly COIN_LINES = [0x04, 0x10, 0x20, 0x40, 0x81, 0x00, 0x08];
  private static readonly BCO_COINS: readonly BcoUkCoin[] =
    ['5p', '10p', '20p', '50p', '£1', '£2', 'token'];
  private static readonly BCO_SHIFT = 2;
  private static readonly BCO_DWELL = Math.round(BCO_PULSE_MS * Mpu5.MS);
  private coinPort = 0xff;
  private coinCycles = 0;
  private binaryMech = false;
  private static readonly COIN_DWELL = 1_300_000;

  setCoinMech(mech: string | null): void {
    this.binaryMech = mech === 'Binary';
  }

  private coinPortF(): number {
    const port = this.coinPort & ~this.matrix[10];
    return this.binaryMech ? port & ~(LINE.A << Mpu5.BCO_SHIFT) : port;
  }

  private static readonly BCO_INTERVAL = Math.round(330 * Mpu5.MS);
  private static readonly BCO_REJECT_HOLD = Math.round(500 * Mpu5.MS);
  private coinHold = 0;

  insertCoin(bit: number): void {
    if (this.vendCoinsIn() && this.vendMech) {
      const channel = Mpu5.VEND_CHANNELS[bit];
      if (!channel) return;
      this.vendMech.insert(channel);
      return;
    }
    if (this.coinCycles > 0 || this.coinHold > 0) return;
    if (this.asic.regs[7] === 0) {
      if (this.binaryMech) this.coinHold = Mpu5.BCO_REJECT_HOLD;
      return;
    }
    if (this.binaryMech) {
      const coin = Mpu5.BCO_COINS[bit];
      if (!coin) return;
      this.coinPort = 0xff ^ (BCO_UK[coin] << Mpu5.BCO_SHIFT);
      this.coinCycles = Mpu5.BCO_DWELL;
      this.coinHold = Mpu5.BCO_INTERVAL;
      return;
    }
    const lines = Mpu5.COIN_LINES[bit] ?? 0;
    if (!lines) return;
    this.coinPort = 0xff ^ lines;
    this.coinCycles = Mpu5.COIN_DWELL;
  }

  private tickCoin(cycles: number): void {
    if (this.coinHold > 0) this.coinHold -= cycles;
    if (this.coinCycles <= 0) return;
    this.coinCycles -= cycles;
    if (this.coinCycles <= 0) this.coinPort = 0xff;
  }

  get coinBusy(): boolean {
    return this.coinCycles > 0 || this.coinHold > 0;
  }

  get coinChutes(): readonly { label: string; bit: number }[] | undefined {
    return this.binaryMech || this.serialHopper ? Mpu5.BINARY_CHUTES : undefined;
  }

  private static readonly BINARY_CHUTES: readonly { label: string; bit: number }[] = [
    { label: '£2', bit: 5 },
    { label: '£1', bit: 4 },
    { label: '50p', bit: 3 },
    { label: '20p', bit: 2 },
    { label: '10p', bit: 1 },
    { label: '5p', bit: 0 },
  ];

  private static readonly BINARY_PORT_MASK = 0xf8;
  private static readonly PARALLEL_PORT_MASK = 0xfc;

  get coinPortLines(): CoinPortLines {
    return this.binaryMech ? Mpu5.BINARY_PORT : Mpu5.PARALLEL_PORT;
  }

  private static readonly BINARY_PORT: CoinPortLines = {
    compare: Mpu5.BINARY_PORT_MASK,
    lines: Mpu5.BCO_COINS.map((coin, bit) => ({ bit, mask: BCO_UK[coin] << Mpu5.BCO_SHIFT })),
  };

  private static readonly PARALLEL_PORT: CoinPortLines = {
    compare: Mpu5.PARALLEL_PORT_MASK,
    lines: Mpu5.COIN_LINES
      .map((mask, bit) => ({ bit, mask }))
      .filter((l) => (l.mask & Mpu5.PARALLEL_PORT_MASK) !== 0),
  };
}
