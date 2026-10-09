import { M68000 } from '../cpu/m68000';
import type { Bus16 } from '../cpu/bus68k';
import { Z8530 } from '../hw/z8530';
import { placeRomPairs } from './pairplacer';
import { StrayCounter } from './strayaccess';

export const PLASMA_CLOCK = 9_830_400;
export const PLASMA_COLUMNS = 128;
export const PLASMA_ROWS = 32;
export const PLASMA_FRAME_BYTES = (PLASMA_COLUMNS / 8) * PLASMA_ROWS;

const ROM_SIZE = 0x40000;
const RAM_SIZE = 0x100000;

export class Mpu4PlasmaCard implements Bus16 {
  readonly cpu: M68000;
  rom = new Uint8Array(ROM_SIZE).fill(0xff);
  readonly ram = new Uint8Array(RAM_SIZE);
  readonly scc: Z8530;

  private readonly building = new Uint8Array(PLASMA_FRAME_BYTES);
  private ptr = PLASMA_FRAME_BYTES - 1;
  private rowCount = 0;
  private dirty = false;

  readonly frame = new Uint8Array(PLASMA_FRAME_BYTES);
  frameSerial = 0;

  private rxState = 0;
  private rxByte = 0;
  private resetLatched = false;

  private owed = 0;
  readonly strays = new StrayCounter();

  constructor() {
    this.cpu = new M68000(this);
    this.scc = new Z8530({
      dtrChanged: (ch, dtr) => {
        if (ch === 0 && !dtr) this.ptr = PLASMA_FRAME_BYTES - 1;
        else if (ch === 1 && dtr) this.rowCount = 0;
      },
      byteSent: (ch, b) => {
        if (ch === 1) this.displayByte(b);
      },
    });
  }

  loadRoms(files: readonly Uint8Array[]): void {
    this.rom = new Uint8Array(ROM_SIZE).fill(0xff);
    const placed = placeRomPairs(files, 0, 0, 0xff);
    this.rom.set(placed.subarray(0, ROM_SIZE));
  }

  private displayByte(b: number): void {
    this.rowCount++;
    if (this.rowCount >= 0x11 || this.ptr < 0) return;
    if (this.building[this.ptr] !== b) {
      this.dirty = true;
      this.building[this.ptr] = b;
    }
    if (this.ptr === 0 && this.dirty) {
      this.pushFrame();
      this.dirty = false;
    }
    this.ptr--;
  }

  private pushFrame(): void {
    let changed = false;
    for (let i = 0; i < PLASMA_FRAME_BYTES; i++) {
      if (this.frame[i] !== this.building[i]) {
        this.frame[i] = this.building[i];
        changed = true;
      }
    }
    if (changed) this.frameSerial = (this.frameSerial + 1) >>> 0;
  }

  reset(): void {
    this.cpu.reset();
    this.building.fill(0);
    this.ptr = PLASMA_FRAME_BYTES - 1;
    this.rowCount = 0;
    this.dirty = false;
    this.pushFrame();
    this.scc.hardwareReset(2);
  }

  resetLink(): void {
    this.rxState = 0;
    this.rxByte = 0;
    this.resetLatched = false;
  }

  powerOn(): void {
    this.ram.fill(0);
    this.owed = 0;
    this.resetLink();
    this.reset();
  }

  linkClock(level: boolean, data: boolean): boolean | null {
    if (!level) return this.scc.txBit(0);
    const s = this.rxState;
    if (s === 0) this.rxState = 1;
    else if (s === 1) {
      if (!data) this.rxState = 2;
    } else if (s === 10) {
      this.rxState = 1;
      this.scc.receive(0, this.rxByte);
    } else {
      this.rxState = s + 1;
      this.rxByte = (this.rxByte >> 1) | (data ? 0x80 : 0);
    }
    return null;
  }

  ic3Control(cra: number): void {
    if ((cra & 0x20) === 0) {
      if (!this.resetLatched) {
        this.resetLatched = true;
        this.reset();
      }
    } else if ((cra & 0x30) === 0x30) {
      this.resetLatched = false;
    }
  }

  advance(eCycles: number, eClock: number): void {
    this.owed += (eCycles * PLASMA_CLOCK) / eClock;
    while (this.owed > 0) this.owed -= this.step();
  }

  step(): number {
    const cycles = this.cpu.step() || 4;
    this.scc.tick(cycles);
    this.cpu.setIRQ(this.scc.irq() ? 4 : 0);
    return cycles;
  }

  read8(addr: number): number {
    addr &= 0xffffff;
    if (addr < ROM_SIZE) return this.rom[addr];
    if (addr >= 0x400000 && addr < 0x500000) return this.ram[addr & 0xfffff];
    if (addr >= 0xffff00) return this.scc.read((addr & 0xf) >> 1);
    if (addr !== 0x3fffff) this.strays.hit(addr);
    return 0;
  }

  read16(addr: number): number {
    addr &= 0xffffff;
    if (addr < ROM_SIZE) return (this.rom[addr] << 8) | this.rom[addr + 1];
    if (addr >= 0x400000 && addr < 0x500000) {
      const o = addr & 0xfffff;
      return (this.ram[o] << 8) | this.ram[(o + 1) & 0xfffff];
    }
    this.strays.hit(addr);
    return 0;
  }

  write8(addr: number, val: number): void {
    addr &= 0xffffff;
    if (addr >= 0x400000 && addr < 0x500000) {
      this.ram[addr & 0xfffff] = val & 0xff;
      return;
    }
    if (addr >= 0xffff00) {
      this.scc.write((addr & 0xf) >> 1, val);
      return;
    }
    this.strays.hit(addr);
  }

  write16(addr: number, val: number): void {
    addr &= 0xffffff;
    if (addr >= 0x400000 && addr < 0x500000) {
      const o = addr & 0xfffff;
      this.ram[o] = (val >> 8) & 0xff;
      this.ram[(o + 1) & 0xfffff] = val & 0xff;
      return;
    }
    this.strays.hit(addr);
  }
}
