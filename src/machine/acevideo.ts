import { Z80 } from '../cpu/z80';
import { SwitchedLamps } from '../hw/switchedlamps';
import { MeterConfirm } from '../hw/meterconfirm';
import { OneBitSpeaker } from '../hw/speaker';
import { AY_RATE } from '../hw/ay8910';
import { BASE_BOARD_BASS_FREQ } from '../hw/blipleak';
import { placeRomFlat } from './pairplacer';
import { StrayCounter } from './strayaccess';
import { COIN_RAW } from './coinraw';
import type { AudioSource, CabinetSwitch, CashLedger, Machine } from './machine';
import { newCashLedger } from './machine';
import type { SlideEffect } from '../layout/fmlconfig';
import type { BoardPart } from './parts';
import type { LayoutSwitch } from './layoutswitches';
import type { Reel } from '../hw/reel';

export const ACEVIDEO_CLOCK = 2_500_000;
const RAM_SIZE = 0x100;
export const ROW_CYCLES = 1500;
const VBLANK_CYCLES = 100;
const METER_TICK_CALLS = 1000;
export const ACEVIDEO_WIDTH = 256;
export const ACEVIDEO_HEIGHT = 512;
const LAMP_BASE = [0x00, 0x08, 0x18, 0x20, 0x10];
const LAMP_COUNT = 0x28;
const TRIAC_LINES = 8;
const METER_MASK = 0x12e;

const TILE_PAL = [0xffffffff, 0xffff0000, 0xff00ff00, 0xff0000ff];
const SPRITE_PAL = [
  0xff000000, 0xffff0000, 0xff00ff00, 0xffffffff, 0xff0000ff, 0xffffff00, 0xffff7f00, 0xff7f3f1f,
];
const BLACK = 0xff000000;
const STEP_RELOAD = [
  0x1f, 0xff, 0x00, 0x00, 0xff, 0x0d, 0x0e, 0x0f, 0x0c, 0x43, 0x72, 0x6d, 0x00, 0x10, 0x00, 0x64,
];

const COIN_HOLD = Math.round(0.105 * ACEVIDEO_CLOCK);
const COIN_GAP = Math.round(0.1 * ACEVIDEO_CLOCK);

export function aceVideoDipSwap(d: number): number {
  return ((d & 1) << 3) | ((d & 2) << 1) | ((d & 4) << 2) | ((d & 8) >> 2) | ((d & 0x10) >> 4) | (d & 0xe0);
}

export class AceVideoScreen {
  readonly width = ACEVIDEO_WIDTH;
  readonly height = ACEVIDEO_HEIGHT;
  readonly frame = new Uint32Array(ACEVIDEO_WIDTH * ACEVIDEO_HEIGHT).fill(BLACK);
  frameSerial = 0;
}

export class AceVideo implements Machine {
  static readonly snapshotConfig: readonly string[] = ['switches', 'slidePence', 'meterInRaw', 'meterOutRaw', 'triacInRaw', 'triacOutRaw'];

  readonly clockHz = ACEVIDEO_CLOCK;
  readonly cpu: Z80;
  readonly display = null;
  readonly reels: readonly Reel[] = [];

  readonly rom = new Uint8Array(0x10000);
  readonly gfx = new Uint8Array(0x2000);
  readonly ram = new Uint8Array(RAM_SIZE);
  private nvram: Uint8Array | null = null;
  readonly vram = new Uint8Array(0x800);
  readonly sprite = new Uint8Array(8);

  readonly video = new AceVideoScreen();

  readonly lampStore = new SwitchedLamps(LAMP_COUNT);
  get lamps(): Uint8Array { return this.lampStore.shown; }

  readonly meters = new MeterConfirm();
  readonly meterCounts = new Uint32Array(9);

  readonly matrix = new Uint8Array(8);
  private switches: LayoutSwitch[] = [];
  private dip1 = 0;
  private dip2 = 0;

  private latch2 = 0;
  private latch3 = 0;
  private triacWord = 0;
  get triacLevels(): number { return this.triacWord; }
  readonly triacPulses = new Uint32Array(TRIAC_LINES);
  a005 = 1;

  private slidePence: SlideEffect[] = new Array(16).fill(null);
  private meterInRaw: number[] = [];
  private meterOutRaw: number[] = [];
  private triacInRaw: number[] = [];
  private triacOutRaw: number[] = [];
  private readonly gridTotals = { in: 0, out: 0 };
  get meterTotals(): { readonly in: number; readonly out: number } { return this.gridTotals; }
  readonly cashLedger: CashLedger = newCashLedger();
  get slidesPriced(): boolean { return this.slidePence.some((p) => p !== null); }

  private calls = 0;
  private irqRequest = false;
  vblank = false;
  private vblankLeft = 0;
  row = 0;
  private rowLeft = 0;
  private damage = 0;

  private cursor = 0;
  private count = 0;
  private p0 = 0;
  private p1 = 0;
  private p2 = 0;
  private rowOff = 0;
  private colour = 0;

  private toneLeft = 0;
  private tonePeriod = 0;
  private toneHigh = 0;
  readonly speaker = new OneBitSpeaker(ACEVIDEO_CLOCK, AY_RATE, { bassFreq: BASE_BOARD_BASS_FREQ });
  get audioSource(): AudioSource { return this.speaker; }

  private coinRow = 0;
  private coinMask = 0;
  private coinTimer = 0;

  readonly strays = new StrayCounter();
  wideColours = 0;

  constructor(prog: readonly Uint8Array[], gfx: readonly Uint8Array[] = []) {
    this.cpu = new Z80(
      { read8: (a) => this.read(a), write8: (a, v) => this.write(a, v) },
      { in: () => 0xff, out: () => { this.irqRequest = false; } },
      {
        irqAck: () => { this.irqRequest = false; return 0xff; },
      },
    );
    this.loadRom(prog);
    this.loadGfx(gfx);
  }

  loadRom(files: readonly Uint8Array[]): void {
    this.rom.set(placeRomFlat(files, { max: 0x10000, reverse: false }).image);
  }

  loadGfx(files: readonly Uint8Array[]): void {
    this.gfx.set(placeRomFlat(files, { max: 0x2000, reverse: false }).image);
  }

  loadNvram(data: Uint8Array): void {
    this.nvram = data.slice(0, RAM_SIZE);
    this.ram.fill(0);
    this.ram.set(this.nvram);
  }

  batteryRam(): Uint8Array { return this.ram.slice(); }

  setDips(d1: number, d2: number): void { this.dip1 = d1 & 0xff; this.dip2 = d2 & 0xff; }

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

  powerCycle(): void {
    this.nvram = this.ram.slice();
    this.reset();
  }

  reset(): void {
    if (this.nvram) this.ram.set(this.nvram);
    this.calls = 0;
    this.irqRequest = false;
    this.cpu.reset();
    this.meters.reset();
    this.row = 0;
    this.rowLeft = 0;
    this.latch2 = 0;
    this.latch3 = 0;
    this.triacWord = 0;
    this.a005 = 1;
    this.lampStore.reset();
    this.coinTimer = 0;
    this.coinMask = 0;
  }

  step(): number {
    if (++this.calls % METER_TICK_CALLS === 0) this.confirmMeters(this.meters.tick());
    if (this.vblankLeft <= 0 && this.vblank) this.vblank = false;
    if (this.rowLeft <= 0) {
      this.drawRow();
      this.rowLeft = ROW_CYCLES;
      const base = 0x400 + this.row;
      for (let col = 0; col < 32; col++) {
        if (this.vram[base + col * 32] === 0x0c) { this.irqRequest = true; break; }
      }
      if (++this.row >= 32) {
        this.row = 0;
        this.vblank = true;
        this.vblankLeft = VBLANK_CYCLES;
      }
    }
    this.cpu.setIRQ(this.irqRequest);
    const c = this.cpu.step();
    this.tone(c);
    this.vblankLeft -= c;
    this.rowLeft -= c;
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

  private tone(c: number): void {
    if (this.toneLeft <= 0) { this.speaker.tick(c); return; }
    this.toneLeft -= c;
    if (this.toneLeft > 0) { this.speaker.tick(c); return; }
    const at = this.toneLeft + c;
    this.speaker.tick(at);
    this.toneHigh ^= 1;
    this.toneLeft += this.tonePeriod;
    if (this.tonePeriod === 0) this.toneHigh = 0;
    this.speaker.write(0, this.toneHigh);
    this.speaker.tick(c - at);
  }

  private read(addr: number): number {
    addr &= 0xffff;
    switch (addr >> 13) {
      case 0: return this.rom[addr];
      case 1: return this.ram[addr & 0xff];
      case 2: return addr < 0x4800 ? this.vram[addr - 0x4000] : 0;
      case 4: return this.inputs(addr & 7);
      default: this.strays.hit(addr); return 0;
    }
  }

  private inputs(k: number): number {
    const bit = 1 << k;
    let v = 0;
    if (this.matrix[0] & bit) v |= 1;
    if (this.matrix[1] & bit) v |= 2;
    if (this.matrix[2] & bit) v |= 4;
    if (aceVideoDipSwap(this.dip1) & bit) v |= 8;
    if (aceVideoDipSwap(this.dip2) & bit) v |= 0x10;
    if (!this.vblank) v |= 0x20;
    return ~v & 0xff;
  }

  private write(addr: number, v: number): void {
    addr &= 0xffff;
    v &= 0xff;
    switch (addr >> 13) {
      case 1: this.ram[addr & 0xff] = v; return;
      case 2: if (addr < 0x4800) this.vram[addr - 0x4000] = v; return;
      case 3: this.sprite[addr & 7] = v & 0xf; return;
      case 5: this.output(addr & 7, v); return;
      case 6: return;
      default: this.strays.hit(addr); return;
    }
  }

  private output(n: number, v: number): void {
    if (n < 5) this.lampStore.writeAt(LAMP_BASE[n], 8, v);
    switch (n) {
      case 2:
        if (v !== this.latch2) {
          if ((this.latch2 ^ v) & 0x2e) this.meters.write(((this.latch3 & 1) << 8) | (v & 0x2e));
          this.latch2 = v;
        }
        return;
      case 3:
        if (v !== this.latch3) {
          if ((this.latch3 ^ v) & 1) this.meters.write(((v & 1) << 8) | (this.latch2 & 0x2e));
          this.latch3 = v;
        }
        return;
      case 4: if (v !== this.triacWord) this.setTriacs(v); return;
      case 5: this.a005 = v & 1; return;
      case 6:
        this.tonePeriod = (0xff - ((v & 0x3f) * 4 + 3)) << 6;
        if (this.toneLeft < 1) this.toneLeft = this.tonePeriod;
        return;
      case 0: case 1: return;
      default: this.strays.hit(0xa000 + n); return;
    }
  }

  private confirmMeters(confirmed: number): void {
    if (!(confirmed & METER_MASK)) return;
    for (let i = 0; i < this.meterCounts.length; i++) {
      if (!(confirmed & (1 << i))) continue;
      this.meterCounts[i]++;
      this.gridTotals.in += this.meterInRaw[i] ?? 0;
      this.gridTotals.out += this.meterOutRaw[i] ?? 0;
    }
  }

  private setTriacs(word: number): void {
    const rising = word & ~this.triacWord;
    this.triacWord = word;
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

  private drawRow(): void {
    const row = this.row;
    const out = this.video.frame;
    const chars = 0x1800;
    this.cursor = 0;
    this.rowOff = 0;
    let toggle = false;
    for (let line = 0; line < 8; line++) {
      this.p0 = this.p1 = this.p2 = 0;
      const x = row * 8 + line;
      for (let col = 0; col < 32; col++) {
        const cell = col * 32 + row;
        const code = this.vram[cell];
        const c = this.vram[0x400 + cell];
        this.colour = c;
        let o = (511 - col * 16) * ACEVIDEO_WIDTH + x;
        if (c < 4) {
          let bits = this.gfx[chars + code * 8 + line];
          const fg = TILE_PAL[c];
          for (let px = 0; px < 16; px++, o -= ACEVIDEO_WIDTH) {
            const p = bits & 0x80 ? fg : BLACK;
            if (out[o] !== p) { out[o] = p; this.damage++; }
            if (px & 1) bits = (bits << 1) & 0xff;
          }
        } else if (c >= 5 && c <= 7) {
          for (let px = 0; px < 16; px++, o -= ACEVIDEO_WIDTH) {
            const p = SPRITE_PAL[(this.p0 >> 7) | ((this.p1 >> 6) & 2) | ((this.p2 >> 5) & 4)];
            if (out[o] !== p) { out[o] = p; this.damage++; }
            this.stepSprite(2, line);
          }
        } else {
          for (let px = 0; px < 16; px++, o -= ACEVIDEO_WIDTH) {
            if (out[o] !== BLACK) { out[o] = BLACK; this.damage++; }
          }
          if (c & 8) {
            if (toggle) {
              this.rowOff = (code & 3) << 5;
              this.cursor = (this.cursor + (code & 4) * 4) & 0xff;
              this.count = 0xf;
              this.stepSprite(12, line);
            } else {
              this.cursor = code & 0xf;
            }
            toggle = !toggle;
          }
        }
      }
    }
    if (row === 31 && this.damage) {
      this.damage = 0;
      this.video.frameSerial = (this.video.frameSerial + 1) >>> 0;
    }
  }

  private stepSprite(n: number, line: number): void {
    for (let i = 0; i < n; i++) {
      if (this.count === 0xf) {
        const c = this.colour;
        if (c > 0x0f) this.wideColours++;
        this.count = STEP_RELOAD[c & 0x0f];
        const k = this.cursor;
        if ((k & 7) === 7) {
          const base = (this.sprite[k >> 5] ^ 0xf) * 0x80;
          const off = (((k >> 3) & 3) + this.rowOff + line * 4) & 0xff;
          this.p0 = this.gfx[base + off];
          this.p1 = this.gfx[base + 0x800 + off];
          this.p2 = this.gfx[base + 0x1000 + off];
        } else {
          this.p0 = (this.p0 << 1) & 0xff;
          this.p1 = (this.p1 << 1) & 0xff;
          this.p2 = (this.p2 << 1) & 0xff;
        }
        this.cursor = (this.cursor + 1) & 0xff;
      } else {
        this.count = (this.count + 1) & 0xff;
      }
    }
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
      { id: 'cpu', label: 'CPU', part: 'Z80 - 2.5 MHz', device: this.cpu, cpu: true },
      { id: 'rom', label: 'PROGRAM ROM', part: 'four 2K sockets', device: this.rom },
      { id: 'ram', label: 'RAM', part: '256 bytes - battery', device: this.ram },
      { id: 'video', label: 'VIDEO', part: '32 x 32 tiles, sprite planes', device: this.vram },
      { id: 'gfx', label: 'GRAPHICS ROM', part: 'sprites and characters', device: this.gfx },
      { id: 'lamps', label: 'LAMPS', part: 'five output latches', device: this.lamps },
      { id: 'meters', label: 'METERS', part: '5 lines', device: this.meterCounts },
      { id: 'triacs', label: 'TRIACS', part: '8 lines', device: this.triacPulses },
      { id: 'switches', label: 'SWITCHES', part: '3 rows, read a bit at a time', device: this.matrix },
      { id: 'coins', label: 'COIN INPUTS', part: 'matrix lines', modelled: true,
        note: 'Timed matrix makes on the line the acceptor names - not a mech.' },
      { id: 'speaker', label: 'TONE', part: 'one-bit square wave', device: this.speaker },
    ];
  }
}
