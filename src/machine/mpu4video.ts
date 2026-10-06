import { M68000 } from '../cpu/m68000';
import type { Bus16 } from '../cpu/bus68k';
import { Ptm6840 } from '../hw/ptm6840';
import { Acia6850 } from '../hw/acia6850';
import { Scn2674 } from '../hw/scn2674';
import { Saa1099 } from '../hw/saa1099';
import { AY_RATE } from '../hw/ay8910';
import { StrayCounter } from './strayaccess';

export const VIDEO_CLOCK = 10_000_000;
const E_DIVIDE = 10;
const SAA_CLOCK = 8_000_000;

export const VIDEO_COLUMNS = 63;
export const VIDEO_ROWS = 37;
export const VIDEO_WIDTH = VIDEO_COLUMNS * 8;
export const VIDEO_HEIGHT = VIDEO_ROWS * 8;

export const EF9369_LEVELS = [
  0x00, 0x1f, 0x3c, 0x57, 0x70, 0x87, 0x9c, 0xaf,
  0xc0, 0xcf, 0xdc, 0xe7, 0xf0, 0xf7, 0xfc, 0xff,
] as const;

export function ef9369Argb(even: number, odd: number): number {
  return (0xff000000
    | (EF9369_LEVELS[odd & 0x0f] << 16)
    | (EF9369_LEVELS[(even >> 4) & 0x0f] << 8)
    | EF9369_LEVELS[even & 0x0f]) >>> 0;
}

const ROW_PALETTE_BYTES = 32;

export class Mpu4VideoCard implements Bus16 {
  readonly cpu: M68000;
  rom = new Uint8Array(0);
  readonly mainRam = new Uint8Array(0x20000);
  readonly charRam = new Uint8Array(0x20000);
  xram: Uint8Array | null = null;

  readonly ptm: Ptm6840;
  private ptmPhase = 0;

  readonly acia: Acia6850;
  readonly mpu4Acia: Acia6850;
  private aciaWasIrq = false;
  private mpu4AciaWasIrq = false;

  readonly scn = new Scn2674();
  readonly saa = new Saa1099(SAA_CLOCK, AY_RATE);

  readonly rowArgb = new Uint32Array(VIDEO_ROWS * 16);
  readonly rowRaw = new Uint8Array(VIDEO_ROWS * ROW_PALETTE_BYTES);
  readonly rowWritten = new Uint8Array(VIDEO_ROWS);
  private palIndex = 0;

  readonly chrTable = new Uint8Array(0x1000);
  private chrCol = 0;
  private chrRow = 0;

  readonly width = VIDEO_WIDTH;
  readonly height = VIDEO_HEIGHT;
  readonly frame = new Uint32Array(VIDEO_WIDTH * VIDEO_HEIGHT);
  frameSerial = 0;

  private owed = 0;
  readonly strays = new StrayCounter();

  constructor() {
    this.cpu = new M68000(this);
    this.ptm = new Ptm6840({
      irqChanged: () => undefined,
      output: (n, state) => {
        if (n === 0) {
          this.ptm.setExternalClock(1, state);
          if (!state) {
            this.acia.tick(1);
            this.mpu4Acia.tick(1);
          }
        } else if (n === 2) {
          this.ptm.setExternalClock(0, state);
        }
      },
    });
    this.acia = new Acia6850((b) => this.cardTransmitted(b));
    this.mpu4Acia = new Acia6850((b) => this.mpu4Transmitted(b));
    this.cpu.onResetInstruction = () => this.resetPeripherals();
  }

  loadVideoRoms(files: readonly Uint8Array[]): void {
    if (!files.length) {
      this.rom = new Uint8Array(0);
      return;
    }
    if (files.length < 2) {
      this.rom = files[0].slice();
      return;
    }
    const size0 = files[0].length;
    let end = 0;
    files.forEach((f, i) => { end = Math.max(end, (i >> 1) * 2 * size0 + (i & 1) + 2 * f.length); });
    const rom = new Uint8Array(end);
    files.forEach((f, i) => {
      let at = (i >> 1) * 2 * size0 + (i & 1);
      for (let k = 0; k < f.length; k++, at += 2) rom[at] = f[k];
    });
    this.rom = rom;
  }

  loadCharacteriser(data: Uint8Array | null): void {
    this.chrTable.fill(0);
    if (!data) return;
    const n = Math.min(data.length, 0x1000);
    this.chrTable.set(data.subarray(data.length - n), 0);
  }

  setXram(fitted: boolean): void {
    this.xram = fitted ? new Uint8Array(0x40000) : null;
  }

  reset(): void {
    this.resetPeripherals();
    this.mpu4Acia.reset();
    this.mpu4Acia.setCts(false);
    this.palIndex = 0;
    this.rowArgb.fill(0xff000000);
    this.aciaWasIrq = false;
    this.mpu4AciaWasIrq = false;
    this.owed = 0;
    this.ptmPhase = 0;
    this.cpu.reset();
  }

  private resetPeripherals(): void {
    this.ptm.reset();
    this.scn.reset();
    this.acia.reset();
    this.saa.reset();
    this.acia.setCts(false);
  }

  clearRam(): void {
    this.mainRam.fill(0);
    this.charRam.fill(0);
    this.xram?.fill(0);
  }

  private mpu4Transmitted(b: number): void {
    this.acia.receive(b);
    if (this.acia.irq()) this.mpu4Acia.setCts(true);
  }

  private cardTransmitted(b: number): void {
    this.mpu4Acia.receive(b);
    if (this.mpu4Acia.irq()) this.acia.setCts(true);
  }

  mpu4AciaWrite(reg: number, val: number): void {
    this.mpu4Acia.write(reg, val);
    this.acia.setDcd(this.mpu4Acia.rts);
  }

  mpu4AciaIrq(): boolean {
    const irq = this.mpu4Acia.irq();
    if (!irq && this.mpu4AciaWasIrq) this.acia.setCts(false);
    this.mpu4AciaWasIrq = irq;
    return irq;
  }

  advance(eCycles: number, eClock: number): void {
    this.owed += (eCycles * VIDEO_CLOCK) / eClock;
    while (this.owed > 0) this.owed -= this.step();
  }

  step(): number {
    const cycles = this.cpu.step() || 4;
    this.saa.tick(cycles, VIDEO_CLOCK);
    this.ptmPhase += cycles;
    if (this.ptmPhase >= E_DIVIDE) {
      const n = Math.floor(this.ptmPhase / E_DIVIDE);
      this.ptmPhase -= n * E_DIVIDE;
      this.ptm.tick(n);
    }
    this.scn.tick(cycles);
    const aciaIrq = this.acia.irq();
    if (!aciaIrq && this.aciaWasIrq) this.mpu4Acia.setCts(false);
    this.aciaWasIrq = aciaIrq;
    const level = this.scn.irq() ? 3 : aciaIrq ? 2 : this.ptm.irq() ? 1 : 0;
    this.cpu.setIRQ(level);
    if (this.scn.frameDone && this.scn.displayOn) {
      this.scn.frameDone = false;
      this.draw();
    }
    return cycles;
  }

  draw(): void {
    const ram = this.mainRam;
    const chr = this.charRam;
    const out = this.frame;
    let changed = false;
    let pal = 0;
    let table = (this.scn.screenStart2 * 2 + 1) & 0x1ffff;
    for (let row = 0; row < VIDEO_ROWS; row++) {
      const lo = ram[table & 0x1ffff];
      const hi = ram[(table + 2) & 0x1ffff];
      table += 4;
      const mode = hi & 0xc0;
      this.scn.ir[14] = (this.scn.ir[14] & 0x3f) | mode;
      const second = mode === 0 ? 4 : 0;
      const half = mode & 0x40 ? 0x10 : 0;
      if (this.rowWritten[row]) pal = row;
      const palBase = pal * 16;
      let cell = (((hi << 8) | lo) & 0x3fff) * 2;
      const y0 = row * 8;
      for (let col = 0; col < VIDEO_COLUMNS; col++, cell += 2) {
        const word = (ram[cell & 0x1ffff] << 8) | ram[(cell + 1) & 0x1ffff];
        const planes = word >> 12;
        let p = ((word & 0xfff) * 0x20 + half) & 0x1ffff;
        const x0 = col * 8;
        for (let k = 0; k < 4; k++) {
          for (let line = 0; line < 2; line++) {
            const a = line === 0 ? p : p + second;
            const b0 = chr[a & 0x1ffff];
            const b1 = chr[(a + 1) & 0x1ffff];
            const b2 = chr[(a + 2) & 0x1ffff];
            const b3 = chr[(a + 3) & 0x1ffff];
            let o = (y0 + k * 2 + line) * VIDEO_WIDTH + x0;
            for (let bit = 7; bit >= 0; bit--, o++) {
              const pen = (((b3 >> bit) & 1) | (((b2 >> bit) & 1) << 1)
                | (((b1 >> bit) & 1) << 2) | (((b0 >> bit) & 1) << 3)) & planes;
              const argb = this.rowArgb[palBase + pen];
              if (out[o] !== argb) {
                out[o] = argb;
                changed = true;
              }
            }
          }
          p += second + 4;
        }
      }
    }
    if (changed) this.frameSerial = (this.frameSerial + 1) >>> 0;
  }

  private paletteWrite(addr: number, val: number): void {
    if ((addr >> 1) & 1) {
      this.palIndex = val & 0x1f;
      if (this.palIndex === 0 && this.scn.row === 0) this.rowWritten.fill(0);
      return;
    }
    const row = this.scn.row;
    this.rowWritten[row] = 1;
    const raw = row * ROW_PALETTE_BYTES;
    const i = this.palIndex;
    if (this.rowRaw[raw + i] !== (val & 0xff)) {
      this.rowRaw[raw + i] = val & 0xff;
      const pair = raw + (i & 0x1e);
      this.rowArgb[row * 16 + (i >> 1)] = ef9369Argb(this.rowRaw[pair], this.rowRaw[pair + 1]);
    }
    this.palIndex = (i + 1) & 0x1f;
  }

  private paletteRead(addr: number): number {
    if ((addr >> 1) & 1) return 0;
    const i = this.palIndex;
    const v = this.rowRaw[this.scn.row * ROW_PALETTE_BYTES + i];
    this.palIndex = (i + 1) & 0x1f;
    return i & 1 ? v & 0x0f : v;
  }

  private chrRead(): number {
    const v = this.chrTable[((this.chrRow & 0x3f) << 6) | this.chrCol];
    this.chrRow = v;
    return (v << 2) & 0xf8;
  }

  private romByte(addr: number): number {
    return addr < this.rom.length ? this.rom[addr] : 0;
  }

  private romCeiling(): number {
    return this.xram ? 0x600000 : 0x800000;
  }

  read8(addr: number): number {
    addr &= 0xffffff;
    if (addr < this.romCeiling()) return this.romByte(addr);
    if (addr >= 0x800000 && addr < 0x820000) return this.mainRam[addr - 0x800000];
    if (addr > 0xa00000 && addr < 0xa00013) return this.paletteRead(addr);
    if (addr >= 0xc00000 && addr < 0xc20000) return this.charRam[addr - 0xc00000];
    if (addr >= 0xb00000 && addr < 0xb00100) return this.scn.read((addr & 0xf) >> 1);
    if (this.xram && addr >= 0x600000 && addr < 0x640000) return this.xram[addr - 0x600000];
    const page = addr & 0xffff00;
    if (page === 0xffd000) return this.chrRead();
    if (page === 0xff8000 || page === 0xe00000) return this.acia.read((addr & 0xf) >> 1);
    if (page === 0xff9000 || page === 0xe01000) return this.ptm.read((addr & 0xf) >> 1);
    if (page === 0xe05000) return this.chrCol;
    this.strays.hit(addr);
    return 0;
  }

  read16(addr: number): number {
    addr &= 0xffffff;
    if (addr < this.romCeiling()) return (this.romByte(addr) << 8) | this.romByte(addr + 1);
    if (this.xram && addr >= 0x600000 && addr < 0x640000) {
      const o = addr - 0x600000;
      return (this.xram[o] << 8) | this.xram[o + 1];
    }
    if (addr >= 0x800000 && addr < 0x900000) {
      const o = addr & 0x1ffff;
      return (this.mainRam[o] << 8) | this.mainRam[(o + 1) & 0x1ffff];
    }
    if (addr >= 0xc00000 && addr < 0xc20000) {
      const o = addr - 0xc00000;
      return (this.charRam[o] << 8) | this.charRam[o + 1];
    }
    this.strays.hit(addr);
    return 0;
  }

  write8(addr: number, val: number): void {
    addr &= 0xffffff;
    val &= 0xff;
    if (addr >= 0x800000 && addr < 0x820000) {
      this.mainRam[addr - 0x800000] = val;
      return;
    }
    if (addr > 0xa00000 && addr < 0xa000ff) {
      this.paletteWrite(addr, val);
      return;
    }
    if (addr >= 0xb00000 && addr < 0xb00100) {
      this.scn.write((addr & 0xff) >> 1, val);
      return;
    }
    if (addr >= 0xc00000 && addr < 0xc20000) {
      this.charRam[addr - 0xc00000] = val;
      return;
    }
    if (addr >= 0x600000 && addr < 0x640000) {
      if (this.xram) this.xram[addr & 0x3ffff] = val;
      return;
    }
    const page = addr & 0xffff00;
    if (page === 0x900000) {
      if (addr & 2) this.saa.controlW(val);
      else this.saa.dataW(val);
      return;
    }
    if (page === 0xffd000) {
      this.chrCol = val & 0x3f;
      return;
    }
    if (page === 0xff8000 || page === 0xe00000) {
      this.acia.write((addr & 0xf) >> 1, val);
      this.mpu4Acia.setDcd(this.acia.rts);
      return;
    }
    if (page === 0xff9000 || page === 0xe01000) {
      this.ptm.write((addr & 0xf) >> 1, val);
      return;
    }
    this.strays.hit(addr);
  }

  write16(addr: number, val: number): void {
    addr &= 0xffffff;
    const hi = (val >> 8) & 0xff;
    const lo = val & 0xff;
    if (addr >= 0xc00000 && addr < 0xc20000) {
      const o = addr - 0xc00000;
      this.charRam[o] = hi;
      this.charRam[o + 1] = lo;
      return;
    }
    if (addr >= 0x800000 && addr < 0x820000) {
      const o = addr - 0x800000;
      this.mainRam[o] = hi;
      this.mainRam[o + 1] = lo;
      return;
    }
    if (addr >= 0x600000 && addr < 0x640000) {
      if (this.xram) {
        this.xram[addr - 0x600000] = hi;
        this.xram[addr - 0x600000 + 1] = lo;
      }
      return;
    }
    if (addr === 0xffd000 || addr === 0xe05000) {
      this.chrCol = hi & 0x3f;
      return;
    }
    this.strays.hit(addr);
  }
}
