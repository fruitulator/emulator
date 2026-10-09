import { Z80 } from '../cpu/z80';
import { Z80Ctc } from '../hw/z80ctc';
import { Z80DaisyChain } from '../hw/z80daisy';
import { Ay8910 } from '../hw/ay8910';
import { LampHistory } from '../hw/lamphistory';
import { DataPak } from '../hw/datapak';
import { V20Reels } from './v20reels';
import { placeRomFlat } from './pairplacer';
import { StrayCounter } from './strayaccess';
import { COIN_RAW } from './coinraw';
import type { AudioSource, CabinetSwitch, CashLedger, DigitKind, Machine } from './machine';
import { newCashLedger } from './machine';
import type { SlideEffect } from '../layout/fmlconfig';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import type { ReelGeometry } from './layoutreels';
import type { Reel } from '../hw/reel';

export const MMM_CLOCK = 2_500_000;
const AY_CLOCK = 0x1b4f51;
const RAM_SIZE = 0x100;
const REEL_COUNT = 4;
export const MMM_REEL_ADJUST = 8;
const REEL_PATTERN = [0, 1, 4, 5, 2, 3, 6, 7, 8, 9, 12, 13, 10, 11, 14, 15];
const OPTO_CODE = [
  0, 3, 1, 3, 1, 3, 0, 3, 1, 3, 2, 3, 0, 3, 2, 3, 1, 3, 0, 3, 2, 3, 2, 3,
];
const OPTO_MASK = [
  0x00, 0x03, 0x0c, 0x0f, 0x30, 0x33, 0x3c, 0x3f, 0xc0, 0xc3, 0xcc, 0xcf, 0xf0, 0xf3, 0xfc, 0xff,
];
const PORT_C_VALUE = 2;
const COIN_HOLD = Math.round(0.105 * MMM_CLOCK);
const COIN_GAP = Math.round(0.1 * MMM_CLOCK);
const TRIAC_LINES = 13;

export class Mmm implements Machine {
  static readonly snapshotConfig: readonly string[] = ['switches', 'slidePence', 'triacInRaw', 'triacOutRaw'];

  readonly digitKind: DigitKind = 'byte16';
  readonly clockHz = MMM_CLOCK;

  readonly cpu: Z80;
  readonly ctc = new Z80Ctc();
  private readonly chain = new Z80DaisyChain([this.ctc]);
  readonly ay = new Ay8910(AY_CLOCK);
  get audioSource(): AudioSource { return this.ay; }
  readonly dataPak = new DataPak(MMM_CLOCK);
  readonly serialOut: number[] = [];
  readonly display = null;

  readonly mem = new Uint8Array(0x10000);
  ramBase = 0;
  private nvram: Uint8Array | null = null;

  private readonly lampLaw = new LampHistory(64);
  get lamps(): Uint8Array { return this.lampLaw.level; }
  readonly digits = new Uint8Array(16);

  private readonly reelBank = new V20Reels(REEL_COUNT);
  get reels(): readonly Reel[] { return this.reelBank.reels; }

  readonly matrix = new Uint8Array(8);
  private switches: LayoutSwitch[] = [];

  private strobe = 0;
  private writesLeft = 0;
  portBFlag = 0;

  private triacWord = 0;
  readonly triacPulses = new Uint32Array(TRIAC_LINES);
  get triacLevels(): number { return this.triacWord; }
  private slidePence: SlideEffect[] = new Array(16).fill(null);
  private triacInRaw: number[] = [];
  private triacOutRaw: number[] = [];
  private readonly gridTotals = { in: 0, out: 0 };
  get meterTotals(): { readonly in: number; readonly out: number } { return this.gridTotals; }
  readonly cashLedger: CashLedger = newCashLedger();
  get slidesPriced(): boolean { return this.slidePence.some((p) => p !== null); }

  private serialCount = 0;
  private serialShift = 0;
  private serialOnes = 0;

  private coinRow = 0;
  private coinMask = 0;
  private coinTimer = 0;

  readonly strays = new StrayCounter();
  readonly strayPorts = new StrayCounter();

  constructor(prog: readonly Uint8Array[], nvram?: Uint8Array) {
    this.cpu = new Z80(
      { read8: (a) => this.mem[a & 0xffff], write8: (a, v) => this.write(a, v) },
      { in: (p) => this.portIn(p), out: (p, v) => this.portOut(p, v) },
      { irqAck: () => this.chain.ack(), reti: () => this.chain.reti() },
    );
    this.loadRom(prog);
    if (nvram) this.loadNvram(nvram);
  }

  loadRom(files: readonly Uint8Array[]): void {
    const { image, placed } = placeRomFlat(files, { max: 0x10000, reverse: false });
    this.mem.set(image);
    const count = files.length;
    this.ramBase = count ? ((Math.floor(placed / count) * 4) & 0xffff) : 0;
  }

  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, RAM_SIZE);
    this.mem.set(this.nvram.subarray(0, Math.min(RAM_SIZE, 0x10000 - this.ramBase)), this.ramBase);
  }

  batteryRam(): Uint8Array { return this.mem.slice(this.ramBase, this.ramBase + RAM_SIZE); }

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

  setTriacMoney(inMult: readonly number[], outMult: readonly number[]): void {
    this.triacInRaw = [...inMult];
    this.triacOutRaw = [...outMult];
  }

  layoutInput(id: number, on: boolean): void {
    if (id < 0 || id >= this.matrix.length * 8) return;
    if (on) this.matrix[id >> 3] |= 1 << (id & 7);
    else this.matrix[id >> 3] &= ~(1 << (id & 7));
  }

  layoutLamp(n: number): boolean { return n >= 0 && n < 64 && this.lamps[n] !== 0; }
  layoutLampLevel(n: number): number { return n >= 0 && n < 64 ? this.lamps[n] : 0; }
  layoutDigit(n: number): number { return n >= 0 && n < this.digits.length ? this.digits[n] : 0; }

  powerCycle(): void {
    const keep = this.batteryRam();
    this.reset();
    this.mem.set(keep, this.ramBase);
  }

  reset(): void {
    this.cpu.reset();
    this.ay.reset();
    this.ctc.reset();
    this.dataPak.reset();
    this.triacWord = 0;
    this.strobe = 0;
    this.writesLeft = 0;
    this.serialCount = 0;
    this.serialShift = 0;
    this.serialOnes = 0;
    this.portBFlag = 0;
    this.reelBank.reset();
    this.lampLaw.reset();
    this.digits.fill(0);
    this.coinTimer = 0;
    this.coinMask = 0;
  }

  step(): number {
    this.cpu.setIRQ(this.chain.irq);
    const c = this.cpu.step();
    this.ctc.tick(c);
    this.ay.tick(c, MMM_CLOCK);
    if (this.coinTimer > 0) {
      this.coinTimer -= c;
      if (this.coinTimer <= COIN_GAP) this.matrix[this.coinRow] &= ~this.coinMask;
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
    return c;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  private write(addr: number, v: number): void {
    addr &= 0xffff;
    if (((addr - this.ramBase) >>> 0) < RAM_SIZE) this.mem[addr] = v & 0xff;
    else this.strays.hit(addr);
  }

  private portIn(port: number): number {
    switch (port & 0xf) {
      case 5: return this.ay.read();
      case 6: return this.ctc.read((port >> 4) & 3);
      case 7: return this.strobe === 0 ? 0xff : this.matrix[this.strobe - 1];
      case 8: return this.optics();
      case 0xc: return PORT_C_VALUE;
      case 0xe: return 0;
      default: this.strayPorts.hit(port & 0xff); return 0;
    }
  }

  private portOut(port: number, v: number): void {
    v &= 0xff;
    switch (port & 0xf) {
      case 0:
        if (v === 0) this.strobe = 0;
        else {
          const bit = 31 - Math.clz32(v);
          this.strobe = v === 1 << bit ? bit + 1 : 0;
          this.writesLeft = 2;
        }
        return;
      case 1:
        if (this.writesLeft) {
          if (this.strobe) this.lampLaw.writeByte((this.strobe - 1) * 8, v);
          this.writesLeft--;
        }
        return;
      case 2:
        if (this.writesLeft) {
          if (this.strobe) this.digits[this.strobe - 1] = v;
          this.writesLeft--;
        }
        return;
      case 3: this.ay.selectAddress(v); return;
      case 4: this.ayData(v); return;
      case 6: this.ctc.write((port >> 4) & 3, v); return;
      case 9:
      case 0xa:
        if (v) {
          const r = port & 2;
          this.reelBank.step(r, REEL_PATTERN[v & 0xf]);
          this.reelBank.step(r + 1, REEL_PATTERN[v >> 4]);
        }
        return;
      case 0xb:
        this.portBFlag = v & 0x40;
        this.setTriacs((this.triacWord & 0xff) | ((v & 0x1f) << 8));
        return;
      case 0xd: this.serialBit((v ^ 1) & 1); return;
      default: this.strayPorts.hit(port & 0xff); return;
    }
  }

  private ayData(v: number): void {
    const r = this.ay.selectedAddress;
    const before = this.ay.regs[14];
    this.ay.write(v);
    if (r === 0x0e && (this.ay.regs[7] & 0x40) && v !== before) {
      this.setTriacs((this.triacWord & 0x1f00) | v);
    }
  }

  private optics(): number {
    const st = this.reelBank.state;
    let v = 0;
    let fitted = 0;
    for (let i = 0; i < REEL_COUNT; i++) {
      const r = st[i];
      if (r.present) fitted |= 1 << i;
      const pos = r.pos;
      v |= (pos >= 0 && pos < 96 ? OPTO_CODE[pos >> 2] : 0) << (2 * i);
    }
    return v & OPTO_MASK[fitted & 0xf];
  }

  private setTriacs(word: number): void {
    const rising = word & ~this.triacWord;
    this.triacWord = word;
    if (!rising) return;
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
  }

  private serialBit(bit: number): void {
    if (this.serialCount === 0) {
      if (bit === 0) { this.serialCount = 10; this.serialOnes = 0; }
      return;
    }
    if (this.serialCount === 1) {
      if (bit) {
        const b = this.serialShift & 0xff;
        this.serialOut.push(b);
        if (this.serialOut.length > 256) this.serialOut.shift();
        this.dataPak.receive(b, this.cpu.cycles);
      }
    } else if (this.serialCount !== 2) {
      this.serialShift = ((this.serialShift >> 1) | (bit << 7)) & 0xff;
      if (bit) this.serialOnes++;
    }
    this.serialCount--;
  }

  insertCoin(id: number): void {
    if (this.coinTimer > 0) return;
    const raw = id >= 0x100 && id < 0x180 ? id : COIN_RAW[id];
    if (raw === undefined || !(raw & 0x100)) return;
    const row = (raw & 0x78) >> 3;
    if (row >= this.matrix.length) return;
    this.coinRow = row;
    this.coinMask = 1 << (raw & 7);
    this.coinTimer = COIN_HOLD + COIN_GAP;
    this.matrix[this.coinRow] |= this.coinMask;
  }

  get coinBusy(): boolean { return this.coinTimer > 0; }

  get parts(): BoardPart[] {
    return [
      { id: 'lamps', label: 'LAMPS', part: '8 x 8 strobed', device: this.lamps },
      { id: 'sevenseg', label: '7-SEG', part: 'eight digits under the strobe', device: this.digits },
      { id: 'triacs', label: 'TRIACS', part: 'AY port A + port B', device: this.triacPulses },
      { id: 'switches', label: 'SWITCHES', part: '8 strobed rows', device: this.matrix },
      { id: 'coins', label: 'COIN INPUTS', part: 'matrix lines', modelled: true,
        note: 'Timed matrix makes on the line the acceptor names - not a mech.' },
      { id: 'ctc', label: 'CTC', part: 'Z80 CTC - interrupts', device: this.ctc },
      { id: 'ram', label: 'RAM', part: '256 bytes - battery', device: this.mem },
      { id: 'rom', label: 'PROGRAM ROM', part: 'four sockets', device: this.mem },
      { id: 'cpu', label: 'CPU', part: 'Z80 - 2.5 MHz', device: this.cpu, cpu: true },
      { id: 'reels', label: 'REELS', part: 'stepper, coded optics', device: this.reelBank.reels },
      { id: 'sound', label: 'SOUND', part: 'AY-3-8910', device: this.ay },
    ];
  }
}
