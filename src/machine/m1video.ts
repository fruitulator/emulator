import { M68000 } from '../cpu/m68000';
import type { Bus16 } from '../cpu/bus68k';
import { Mcs51 } from '../cpu/mcs51';
import { Mc68681 } from '../hw/mc68681';
import { I8279 } from '../hw/i8279';
import { Ym2413 } from '../hw/ym2413';
import { Upd7759, UPD7759_RATE } from '../hw/upd7759';
import { Mixer } from '../hw/mixer';
import { LampHistory } from '../hw/lamphistory';
import { MeterConfirm } from '../hw/meterconfirm';
import { V20Reels } from './v20reels';
import { placeRomPairs } from './pairplacer';
import { StrayCounter } from './strayaccess';
import { COIN_RAW } from './coinraw';
import type { AudioSource, CabinetSwitch, CashLedger, Machine, NamedCoin } from './machine';
import { newCashLedger } from './machine';
import { CoinBook, SlotCoins, coinOfNote, type BookedCoin } from './coinbook';
import type { SlideEffect } from '../layout/fmlconfig';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import type { ReelGeometry } from './layoutreels';
import type { Reel } from '../hw/reel';

export const M1VIDEO_CLOCK = 8_000_000;
export const M1VIDEO_SLAVE_HZ = 1_000_000;

const RAM_BASE = 0x80000;
const RAM_SIZE = 0x20000;
const ROM_SIZE = 0x180000;
const TIMER_PERIOD = 0x13880;
const LINE_PERIOD = 0x1e7;
const FRAME_PERIOD = Math.trunc(M1VIDEO_CLOCK / 0x3c);
const WATCHDOG = 200000;
const DUART_X1 = 3_686_400;
const SLAVE_TICK = 5000;
const REEL_COUNT = 4;
export const M1VIDEO_REEL_ADJUST = 1;
const REEL_PATTERN = [0, 1, 4, 5, 2, 3, 6, 7, 8, 9, 12, 13, 10, 11, 14, 15];

export const M1VIDEO_WIDTH = 640;
export const M1VIDEO_HEIGHT = 300;
const DRAM_WORDS = 0x40000;
const DRAM_BANK = [0, 0x20000, 0x10000, 0x30000];
const VCR0 = 0, RWBA = 2, DWBA = 3, DWSLM = 4, DSBA = 5, ODTBA = 7, ATBA = 8, CTBA = 9, ATBAC = 11;

const LAMP_COUNT = 0x108;
const TRIAC_LINES = 8;

export const M1VIDEO_COIN_ROW = 5;
const COIN_HOLD_ROW = Math.round(0.1 * M1VIDEO_CLOCK);
const COIN_HOLD_LINE = Math.round(0.07 * M1VIDEO_CLOCK);
const COIN_GAP = Math.round(0.005 * M1VIDEO_CLOCK);

export class M1VideoScreen {
  readonly width = M1VIDEO_WIDTH;
  readonly height = M1VIDEO_HEIGHT;
  readonly frame = new Uint32Array(M1VIDEO_WIDTH * M1VIDEO_HEIGHT).fill(0xff000000);
  frameSerial = 0;
}

export class M1Video implements Bus16, Machine {
  static readonly snapshotConfig: readonly string[] = ['switches', 'nvram', 'dataPakEcho', 'meterInRaw', 'meterOutRaw', 'triacInRaw', 'triacOutRaw'];

  readonly clockHz = M1VIDEO_CLOCK;
  readonly cpu: M68000;
  readonly slave: Mcs51;
  readonly display = null;

  readonly rom = new Uint8Array(ROM_SIZE);
  readonly slaveRom = new Uint8Array(0x10000);
  readonly ram = new Uint8Array(RAM_SIZE);
  private nvram: Uint8Array | null = null;

  readonly dram = new Uint16Array(DRAM_WORDS);
  readonly vreg = new Uint16Array(16);
  readonly video = new M1VideoScreen();
  private readonly pens = new Uint32Array(16).fill(0xff000000);
  private readonly lineBuf = new Uint8Array(0x200);
  private blinkOn = 0;
  private blinkCount = 0;

  readonly duart: Mc68681;
  readonly kbd: I8279;
  private kbdColumn = 0;
  readonly opll = Object.assign(new Ym2413(UPD7759_RATE), { v20Mix: true });
  readonly upd = new Upd7759();
  private readonly mixer = new Mixer([this.upd, this.opll]);
  get audioSource(): AudioSource { return this.mixer; }
  private soundFitted = false;

  private readonly pia = new Uint8Array(10);

  readonly lampHistory = new LampHistory(LAMP_COUNT);
  get lamps(): Uint8Array { return this.lampHistory.level; }

  private readonly reelBank = new V20Reels(REEL_COUNT);
  get reels(): readonly Reel[] { return this.reelBank.reels; }

  readonly meters = new MeterConfirm();
  readonly meterCounts = new Uint32Array(8);
  private triacWord = 0;
  get triacLevels(): number { return this.triacWord; }
  readonly triacPulses = new Uint32Array(TRIAC_LINES);

  readonly latch = new Uint8Array(16);

  readonly matrix = new Uint8Array(9);
  private switches: LayoutSwitch[] = [];
  private dip1 = 0;
  private dip2 = 0;
  dataPakEcho = false;

  readonly cashLedger: CashLedger = newCashLedger();
  private readonly book = new CoinBook(this.cashLedger, M1VIDEO_CLOCK);
  private readonly slots = new SlotCoins();
  private meterInRaw: number[] = [];
  private meterOutRaw: number[] = [];
  private triacInRaw: number[] = [];
  private triacOutRaw: number[] = [];
  private readonly gridTotals = { in: 0, out: 0 };
  get meterTotals(): { readonly in: number; readonly out: number } { return this.gridTotals; }

  private timerAcc = 0;
  private lineAcc = 0;
  private frameAcc = 0;
  private watchdog = 0;
  watchdogTrips = 0;
  private slaveDebt = 0;
  private duartFrac = 0;
  private slaveTick = SLAVE_TICK;
  private p1 = 0;
  private p3 = 0;
  private reelLast = [0, 0];
  private sampleStarted = false;
  private wasPlaying = false;

  private coinRow = 0;
  private coinMask = 0;
  private coinTimer = 0;

  readonly strays = new StrayCounter();

  constructor() {
    this.cpu = new M68000(this);
    this.cpu.onInterruptAck = () => { this.cpu.setIRQ(0); return undefined; };
    this.cpu.onResetInstruction = () => this.resetHook();
    this.duart = new Mc68681({
      txByte: (ch, v) => {
        if (ch === 0) this.slave.serialRx(v & 0xff);
        else if (this.dataPakEcho) this.duart.receive(1, v);
      },
      outputPort: () => this.driveTriacs(),
    });
    this.kbd = new I8279({ rowRead: (row) => this.sensorRow(row) }, true);
    this.slave = new Mcs51({
      readCode: (a) => this.slaveRom[a & 0xffff],
      readXdata: () => 0xff,
      writeXdata: () => undefined,
      readPort: (p) => this.slavePortRead(p),
      writePort: (p, v) => this.slavePortWrite(p, v),
      serialTx: (v) => this.duart.receive(0, v),
    }, { ramSize: 256, timer2: true, dualDptr: true });
    this.vregInit();
    this.reset();
  }

  loadRom(files: readonly Uint8Array[]): void {
    this.rom.fill(0);
    const lo = placeRomPairs(files.slice(0, 4), 0, 0);
    this.rom.set(lo.subarray(0, Math.min(lo.length, 0x100000)));
    if (files.length === 8) {
      const hi = placeRomPairs(files.slice(4, 8), 0, 0);
      this.rom.set(hi.subarray(0, Math.min(hi.length, ROM_SIZE - 0x100000)), 0x100000);
    }
  }

  loadSlaveRom(files: readonly Uint8Array[]): void {
    this.slaveRom.fill(0);
    let at = 0;
    for (const f of files) {
      if (at >= this.slaveRom.length) break;
      this.slaveRom.set(f.subarray(0, this.slaveRom.length - at), at);
      at += f.length;
    }
  }

  loadSoundRom(data: Uint8Array): void {
    this.upd.loadRom(data);
    this.soundFitted = true;
  }

  batteryRam(): Uint8Array { return this.ram.slice(); }
  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, RAM_SIZE);
    this.ram.fill(0);
    this.ram.set(this.nvram);
  }

  setDips(d1: number, d2: number): void { this.dip1 = d1 & 0xff; this.dip2 = d2 & 0xff; }

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

  setSlides(slides: readonly SlideEffect[] | null): void { this.book.setSlides(slides); }
  setCoinSlots(lines: Iterable<readonly [number, BookedCoin]>): void { this.slots.setLines(lines); }
  get unnamedCoinLines(): readonly number[] { return this.slots.unnamed; }
  nameCoin(line: number, coin: NamedCoin): void { this.slots.name(line, coin); }
  setMeterMoney(map: {
    meterIn: readonly number[]; meterOut: readonly number[];
    triacIn: readonly number[]; triacOut: readonly number[];
  }): void {
    this.meterInRaw = [...map.meterIn];
    this.meterOutRaw = [...map.meterOut];
    this.triacInRaw = [...map.triacIn];
    this.triacOutRaw = [...map.triacOut];
  }

  layoutInput(id: number, on: boolean): void {
    if (id < 0 || id >= this.matrix.length * 8) return;
    if (on) this.matrix[id >> 3] |= 1 << (id & 7);
    else this.matrix[id >> 3] &= ~(1 << (id & 7));
  }

  layoutLamp(n: number): boolean { return n >= 0 && n < LAMP_COUNT && this.lamps[n] !== 0; }
  layoutLampLevel(n: number): number { return n >= 0 && n < LAMP_COUNT ? this.lamps[n] : 0; }

  private vregInit(): void {
    this.vreg.fill(0);
    this.vreg[RWBA] = 0x200;
    this.vreg[DWBA] = 0x8000;
  }

  powerCycle(): void {
    this.nvram = this.ram.slice();
    this.reset();
  }

  reset(): void {
    if (this.nvram) this.ram.set(this.nvram);
    this.boardReset();
  }

  private boardReset(): void {
    this.cpu.reset();
    this.cpu.setIRQ(0);
    this.duart.reset();
    this.opll.reset();
    this.kbd.reset();
    this.kbdColumn = 0;
    this.vregInit();
    this.pia.fill(0);
    this.frameAcc = 0;
    this.blinkCount = 0;
    this.blinkOn = 0;
    this.dram.fill(0);
    this.latch.fill(0, 0, 8);
    this.watchdog = 0;
    this.meters.reset();
    this.upd.reset();
    this.resetSlave();
    this.coinTimer = 0;
    this.coinMask = 0;
    this.book.reset();
  }

  private resetSlave(): void {
    this.slave.reset();
    this.p1 = 0;
    this.p3 = 0;
    this.reelLast = [0, 0];
    this.slaveTick = SLAVE_TICK;
    this.slaveDebt = 0;
    this.sampleStarted = false;
    this.wasPlaying = false;
    this.reelBank.reset();
  }

  private resetHook(): void {
    this.pia.fill(0);
    this.duart.reset();
    this.vregInit();
    this.dram.fill(0);
    this.resetSlave();
  }

  step(): number {
    const c = this.cpu.step() || 4;
    this.slice(c);
    return c;
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  private offer(level: number): void {
    if (level > ((this.cpu.sr >> 8) & 7)) this.cpu.setIRQ(level);
  }

  private slice(c: number): void {
    this.duartFrac += c * DUART_X1;
    const ticks = Math.floor(this.duartFrac / M1VIDEO_CLOCK);
    if (ticks) { this.duartFrac -= ticks * M1VIDEO_CLOCK; this.duart.tick(ticks); }
    this.timerAcc += c;
    this.lineAcc += c;
    this.frameAcc += c;
    this.opll.tick(c, M1VIDEO_CLOCK);
    if (this.soundFitted) this.upd.tick(c, M1VIDEO_CLOCK);
    if (this.timerAcc >= TIMER_PERIOD) {
      this.timerAcc -= TIMER_PERIOD;
      this.confirmMeters(this.meters.tick());
      this.offer(1);
    }
    while (this.lineAcc >= LINE_PERIOD) {
      this.lineAcc -= LINE_PERIOD;
      this.vreg[ATBAC] = (this.vreg[ATBAC] + 1) & 0xffff;
    }
    if (this.frameAcc >= FRAME_PERIOD) {
      this.frameAcc -= FRAME_PERIOD;
      this.vblank();
    }
    if (this.watchdog > 0) {
      this.watchdog -= c;
      if (this.watchdog < 1) {
        this.watchdog = 0;
        this.watchdogTrips++;
        this.boardReset();
        return;
      }
    }
    if (this.duart.irq()) this.offer(5);
    this.runSlave(c);
    this.book.elapse(c);
    if (this.coinTimer > 0) {
      this.coinTimer -= c;
      if (this.coinTimer <= COIN_GAP) this.matrix[this.coinRow] &= ~this.coinMask;
      if (this.coinTimer < 0) this.coinTimer = 0;
    }
  }

  private vblank(): void {
    if (this.dram[0] & 1) for (let i = 0; i < 16; i++) this.vreg[i] = this.dram[i];
    else {
      this.vreg[VCR0] = this.dram[VCR0];
      this.vreg[ATBA] = this.dram[ATBA];
    }
    this.offer(3);
    this.vreg[ATBAC] = this.vreg[ATBA];
    const v = this.vreg[VCR0];
    const period = (((v & 0x1f00) >> 8) + 1) * 8;
    const duty = v >> 13;
    if (duty === 7) this.blinkOn = 1;
    if (this.blinkCount !== 0) this.blinkCount--;
    if (this.blinkCount === 0 && duty !== 7) {
      if (!this.blinkOn) {
        this.blinkCount = ((duty + 1) * period) >> 3;
        this.blinkOn = 1;
      } else {
        this.blinkCount = Math.trunc(((7 - duty) * period) / 8);
        this.blinkOn = 0;
      }
    }
    this.draw();
  }

  private draw(): void {
    const out = this.video.frame;
    const r = this.vreg;
    if (!(r[VCR0] & 8)) {
      out.fill(0xff000000);
      this.video.frameSerial = (this.video.frameSerial + 1) >>> 0;
      return;
    }
    const d = this.dram;
    const ctba = r[CTBA];
    const obj = (r[ODTBA] & 0xffc0);
    for (let i = 0; i < 16; i++) {
      const w = d[(ctba + i) & (DRAM_WORDS - 1)];
      this.pens[w & 0xf] = (0xff000000 | ((w & 0xf000) << 8) | ((w & 0xf00) << 4) | (w & 0xf0)) >>> 0;
      d[(obj + i * 4 + 3) & (DRAM_WORDS - 1)] = d[(obj + i * 4 + 2) & (DRAM_WORDS - 1)];
    }
    const xbound = (r[DWBA] & 0x3f8) | 7;
    const atba = r[ATBA];
    const buf = this.lineBuf;
    const byteAt = (byteAddr: number): number => {
      const word = d[(byteAddr >> 1) & (DRAM_WORDS - 1)];
      return byteAddr & 1 ? word >> 8 : word & 0xff;
    };
    let mask = 0xffff;
    let o = 0;
    for (let line = 0; line < M1VIDEO_HEIGHT; line++) {
      mask = (mask ^ d[(atba + line) & (DRAM_WORDS - 1)] ^ 0xffff) & 0xffff;
      buf.fill(0x22);
      for (let n = 0; n < 16; n++) {
        if (mask & (1 << n)) continue;
        const e = (obj + n * 4) & (DRAM_WORDS - 1);
        const w0 = d[e];
        const w1 = d[e + 1];
        if (w0 & 0x800) continue;
        if ((w0 & 0x10) || ((w0 & 0x20) && !this.blinkOn)) continue;
        let x = w1 & 0x3ff;
        if (w1 & 0x200) x -= 0x400;
        const width = w1 >> 10;
        const res = (w0 & 0x600) >> 9;
        let src = (((w0 & 0xc0) << 10) | d[e + 3]) * 2;
        const end = Math.min(width * 8 + x, xbound);
        d[e + 3] = (d[e + 3] + (width << 2)) & 0xffff;
        const trans = (w0 & 4) !== 0;
        if (res === 3) {
          for (let p = x; p < end; p++, src++) {
            if (p < 0 || p >= buf.length) continue;
            const b = byteAt(src);
            if (!trans) buf[p] = b;
            else {
              if (b & 0x0f) buf[p] = (buf[p] & 0xf0) | (b & 0x0f);
              if (b & 0xf0) buf[p] = (buf[p] & 0x0f) | (b & 0xf0);
            }
          }
        } else if (res === 2) {
          const cs = w0 & 3;
          const lo = cs << 2;
          const hi = (cs << 6) & 0xff;
          let q = Math.max(x, 0);
          for (let p = x; p < end; p++, src++) {
            if (p < 0) continue;
            const b = byteAt(src);
            if (q + 1 < buf.length) {
              if (!trans) {
                buf[q] = (b & 3) | lo | ((b & 0xc) << 2) | hi;
                buf[q + 1] = ((b & 0x30) >> 4) | lo | ((b & 0xc0) >> 2) | hi;
              } else {
                if (b & 3) buf[q] = (buf[q] & 0xf0) | (b & 3) | lo;
                if (b & 0xc) buf[q] = (buf[q] & 0x0f) | ((b & 0xc) << 2) | hi;
                if (b & 0x30) buf[q + 1] = (buf[q + 1] & 0xf0) | ((b & 0x30) >> 4) | lo;
                if (b & 0xc0) buf[q + 1] = (buf[q + 1] & 0x0f) | ((b & 0xc0) >> 2) | hi;
              }
            }
            q += 2;
          }
        }
      }
      for (let i = 0; i < M1VIDEO_WIDTH / 2; i++) {
        const b = buf[i];
        out[o++] = this.pens[b & 0xf];
        out[o++] = this.pens[b >> 4];
      }
    }
    this.video.frameSerial = (this.video.frameSerial + 1) >>> 0;
  }

  private runSlave(mainCycles: number): void {
    this.slaveDebt += (mainCycles * M1VIDEO_SLAVE_HZ) / M1VIDEO_CLOCK;
    while (this.slaveDebt > 0) {
      const n = this.slave.step();
      this.slaveDebt -= n;
      this.slaveTick -= n;
      if (this.slaveTick < 1) this.slaveTick += SLAVE_TICK;
    }
    const playing = this.upd.active();
    if (this.sampleStarted && !playing && this.wasPlaying !== playing) {
      this.slave.setInput('int1', 0);
      this.slave.setInput('int1', 1);
      this.sampleStarted = false;
    }
    this.wasPlaying = playing;
  }

  private slavePortRead(port: number): number {
    if (port !== 1 || (this.p3 & 0x10)) return 0xff;
    return ((~this.reelBank.optos & 0x0f) | ((~this.dip2 & 0x0f) << 4)) & 0xff;
  }

  private slavePortWrite(port: number, v: number): void {
    v &= 0xff;
    if (port === 1) { this.p1 = v; return; }
    if (port !== 3) return;
    const old = this.p3;
    if (old === v) return;
    const rise = ~old & v;
    const fall = old & ~v;
    if ((rise & 0x80) && this.p1 !== this.reelLast[0]) {
      this.reelPair(0, this.p1);
      this.reelLast[0] = this.p1;
    }
    if ((rise & 0x20) && this.p1 !== this.reelLast[1]) {
      this.reelPair(2, this.p1);
      this.reelLast[1] = this.p1;
    }
    if (!this.sampleStarted && (fall & 0x40)) {
      if (this.soundFitted) {
        this.upd.portW(this.p1);
        this.upd.setStartLine(false);
        this.upd.setStartLine(true);
      }
      this.sampleStarted = true;
    }
    if (fall & 0x04) {
      this.upd.setResetLine(false);
      this.upd.setResetLine(true);
    }
    this.p3 = v;
  }

  private reelPair(first: number, v: number): void {
    this.reelBank.step(first, REEL_PATTERN[v >> 4]);
    this.reelBank.step(first + 1, REEL_PATTERN[v & 0xf]);
  }

  private sensorRow(row: number): number {
    return (~(row === 0 ? this.dip1 : this.matrix[row]) & 0xff);
  }

  read8(addr: number): number {
    addr &= 0xffffff;
    if (addr < RAM_BASE || (addr >= 0x100000 && addr < 0x180000)) return this.rom[addr];
    if (addr < 0xa0000) return this.ram[addr - RAM_BASE];
    switch (addr & 0xff0000) {
      case 0x820000: return this.kbd.read((addr >> 1) & 1);
      case 0x860000: return 0;
      case 0x8a0000:
        this.duartInputs();
        return this.duart.read((addr & 0xff) >> 1);
      case 0x8c0000: return this.piaRead((addr & 0xff) >> 1);
      default: this.strays.hit(addr); return 0;
    }
  }

  read16(addr: number): number {
    addr &= 0xfffffe;
    if (addr < RAM_BASE || (addr >= 0x100000 && addr < 0x180000)) return (this.rom[addr] << 8) | this.rom[addr + 1];
    if (addr < 0xa0000) { const a = addr - RAM_BASE; return (this.ram[a] << 8) | this.ram[a + 1]; }
    const page = addr & 0xff0000;
    if (page === 0x840000) { this.strays.hit(addr); return 0x5a; }
    if (page === 0x880000 || page === 0x890000) return this.videoRead((addr & 0x1ffff) >> 1);
    this.strays.hit(addr);
    return 0;
  }

  write8(addr: number, val: number): void {
    addr &= 0xffffff;
    const v = val & 0xff;
    if (addr >= RAM_BASE && addr < 0xa0000) { this.ram[addr - RAM_BASE] = v; return; }
    switch (addr & 0xff0000) {
      case 0x800000:
        if (addr & 2) this.opll.writeData(v);
        else this.opll.writeAddress(v);
        return;
      case 0x820000: this.kbdWrite(addr, v); return;
      case 0x860000: {
        const i = (addr >> 1) & 0xf;
        if (i === 4 && v === 0) this.watchdog = WATCHDOG;
        this.latch[i] = v;
        return;
      }
      case 0x8a0000:
        this.duart.write((addr & 0xff) >> 1, v);
        return;
      case 0x8c0000: this.piaWrite((addr & 0xff) >> 1, v); return;
      default: this.strays.hit(addr);
    }
  }

  write16(addr: number, val: number): void {
    addr &= 0xfffffe;
    const v = val & 0xffff;
    if (addr >= RAM_BASE && addr < 0xa0000) {
      const a = addr - RAM_BASE;
      this.ram[a] = v >> 8;
      this.ram[a + 1] = v & 0xff;
      return;
    }
    const page = addr & 0xff0000;
    if (page === 0x880000 || page === 0x890000) { this.videoWrite((addr & 0x1ffff) >> 1, v); return; }
    this.strays.hit(addr);
  }

  private windowWord(i: number): number {
    const r = this.vreg;
    return ((i - (r[DWBA] & 0xf800)) + DRAM_BANK[(r[DSBA] >> 7) & 3] + ((r[DSBA] & r[DWSLM]) & 0xf800))
      & (DRAM_WORDS - 1);
  }

  private videoWrite(i: number, v: number): void {
    if ((this.vreg[RWBA] & 0xfff0) === (i & 0xfff0)) this.dram[i & 0xf] = v;
    if ((this.vreg[DWBA] & 0xf800) <= i) this.dram[this.windowWord(i)] = v;
  }

  private videoRead(i: number): number {
    let v = 0;
    if ((this.vreg[RWBA] & 0xfff0) === (i & 0xfff0)) v = this.vreg[i & 0xf];
    if ((this.vreg[DWBA] & 0xf800) <= i) v = this.dram[this.windowWord(i)];
    return v;
  }

  private kbdWrite(addr: number, v: number): void {
    const a0 = (addr >> 1) & 1;
    if (a0) this.kbdColumn = v === 0xc1 ? 0x10 : 0;
    else this.kbdColumn = this.kbd.displayPointer;
    this.kbd.write(a0, v);
    if (!(addr & 1)) {
      if (this.kbdColumn >= 16) return;
      const b = this.kbd.dram[this.kbdColumn];
      const sw = ((b << 4) | (b >> 4)) & 0xff;
      for (let i = 0; i < 8; i++) this.lampHistory.write(this.kbdColumn * 8 + i, (sw >> i) & 1);
    } else if (this.kbdColumn === 0x10) {
      for (let c = 0; c < 16; c++) for (let i = 0; i < 8; i++) this.lampHistory.write(c * 8 + i, 0);
    }
  }

  private duartInputs(): void {
    const ip = this.matrix[8];
    for (let b = 0; b < 6; b++) this.duart.setIP(b, (ip >> b) & 1);
  }

  private driveTriacs(): void {
    if (!this.latch[2]) return;
    const w = this.duart.outputs() & 0xff;
    const rising = w & ~this.triacWord;
    this.triacWord = w;
    for (let i = 0; i < TRIAC_LINES; i++) {
      if (!(rising & (1 << i))) continue;
      this.triacPulses[i]++;
      this.gridTotals.in += this.triacInRaw[i] ?? 0;
      this.gridTotals.out += this.triacOutRaw[i] ?? 0;
      this.book.slide(i);
    }
  }

  private piaRead(reg: number): number {
    const p = this.pia;
    switch (reg & 3) {
      case 0: return p[0] & 4 ? (p[2] & p[8]) & 0xff : p[8];
      case 1: return p[0];
      case 2: return p[1] & 4 ? ((p[3] & p[9]) | (~p[9] & 0xf0)) & 0xff : p[9];
      default: return p[1];
    }
  }

  private piaWrite(reg: number, v: number): void {
    const p = this.pia;
    let changedA = 0;
    let changedB = 0;
    switch (reg & 3) {
      case 0:
        if (p[0] & 4) { changedA = (p[2] ^ v) & p[8]; p[2] = v; }
        else { changedA = (~p[8] & v & ~p[2]) | (~p[2] & p[8] & ~v); p[8] = v; }
        break;
      case 1: p[0] = (p[0] & 0xc0) | (v & 0x3f); break;
      case 2:
        if (p[1] & 4) { changedB = (p[3] ^ v) & p[9]; p[3] = v; }
        else { changedB = (~p[9] & v & ~p[3]) | (~p[3] & p[9] & ~v); p[9] = v; }
        break;
      default: p[1] = (p[1] & 0xc0) | (v & 0x3f); break;
    }
    if (changedA & 0xff) {
      this.latch[8] = v;
      for (let i = 0; i < 8; i++) this.lamps[0x100 + i] = (v >> i) & 1 ? 0xff : 0;
    }
    if (changedB & 0xff) this.meters.write(p[3]);
  }

  private confirmMeters(confirmed: number): void {
    if (!confirmed) return;
    for (let i = 0; i < 8; i++) {
      if (!(confirmed & (1 << i))) continue;
      this.meterCounts[i]++;
      this.gridTotals.in += this.meterInRaw[i] ?? 0;
      this.gridTotals.out += this.meterOutRaw[i] ?? 0;
    }
  }

  insertCoin(id: number): void {
    if (this.coinTimer > 0) return;
    const raw = id >= 0x100 && id < 0x180 ? id : COIN_RAW[id];
    if (raw === undefined) return;
    if (raw & 0x100) {
      const row = (raw & 0x78) >> 3;
      if (row >= this.matrix.length) return;
      this.coinRow = row;
      this.coinMask = 1 << (raw & 7);
      this.coinTimer = COIN_HOLD_LINE + COIN_GAP;
    } else {
      this.coinRow = M1VIDEO_COIN_ROW;
      this.coinMask = raw & 0xff;
      if (!this.coinMask) return;
      this.coinTimer = COIN_HOLD_ROW + COIN_GAP;
    }
    this.matrix[this.coinRow] |= this.coinMask;
    this.book.coin(id >= 0x100 ? this.slots.coinOn(id) : coinOfNote(id), this.coinTimer - COIN_GAP);
  }

  get coinBusy(): boolean { return this.coinTimer > 0; }

  get parts(): BoardPart[] {
    return [
      { id: 'cpu', label: 'CPU', part: '68000 - 8 MHz', device: this.cpu, cpu: true },
      { id: 'ram', label: 'RAM', part: '128K, battery backed', device: this.ram },
      { id: 'rom', label: 'PROGRAM ROM', part: 'game card', device: this.rom },
      { id: 'video', label: 'VIDEO', part: 'i82716 - 640 x 300', device: this.dram },
      { id: 'kbd', label: 'KEYBOARD/DISPLAY', part: 'i8279 - lamp columns, switch rows', device: this.kbd },
      { id: 'lamps', label: 'LAMPS', part: '16 columns of 8, and 8 on the PIA', device: this.lamps },
      { id: 'duart', label: 'DUART', part: 'MC68681 - reel card link, triacs', device: this.duart },
      { id: 'pia', label: 'PIA', part: 'MC6821 - lamps, meters', device: this.pia },
      { id: 'opll', label: 'SOUND', part: 'YM2413', device: this.opll },
      { id: 'slave', label: 'REEL CARD', part: '8032 - reels, samples', device: this.slave, cpu: true },
      { id: 'upd', label: 'SAMPLES', part: 'uPD7759', device: this.upd },
      { id: 'meters', label: 'METERS', part: '8 lines', device: this.meterCounts },
      { id: 'triacs', label: 'TRIACS', part: '8 lines', device: this.triacPulses },
      { id: 'switches', label: 'SWITCHES', part: '7 rows and the DUART inputs', device: this.matrix },
      { id: 'reels', label: 'REELS', part: 'four steppers', device: this.reelBank.reels },
    ];
  }
}
