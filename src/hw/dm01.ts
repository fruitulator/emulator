import { M6809 } from '../cpu/m6809';
import type { Bus } from '../cpu/bus';

export const DM01_CLOCK = 2_000_000;
export const DM01_NMI_HZ = 1500;

export class Dm01 implements Bus {
  readonly cpu = new M6809(this);

  private readonly ram = new Uint8Array(0x2000);
  private readonly rom = new Uint8Array(0x10000);

  readonly dots = new Uint8Array(9 * 21);

  private control = 0;
  private xcounter = 0;
  private readonly scanline = new Uint8Array(9);

  private readonly queue = new Uint8Array(500);
  private readPos = 0;
  private writePos = 0;

  private nmiCycles = 0;
  private static readonly NMI_PERIOD = Math.round(DM01_CLOCK / DM01_NMI_HZ);
  private credit = 0;
  scanlines = 0;

  loadRom(bytes: Uint8Array): void {
    const base = Math.max(0, 0x10000 - bytes.length);
    this.rom.set(bytes.subarray(0, 0x10000 - base), base);
  }

  reset(): void {
    this.control = 0;
    this.xcounter = 0;
    this.readPos = 0;
    this.writePos = 0;
    this.nmiCycles = 0;
    this.credit = 0;
    this.scanlines = 0;
    this.scanline.fill(0);
    this.dots.fill(0);
    this.cpu.reset();
  }

  queueChar(v: number): void {
    this.queue[this.writePos] = v & 0xff;
    this.writePos = (this.writePos + 1) % this.queue.length;
    this.cpu.setIRQ(true);
  }

  busy(): boolean {
    return (this.control & 0x08) === 0 || this.readPos !== this.writePos;
  }

  run(cycles: number): void {
    this.credit += cycles;
    while (this.credit > 0) {
      const c = this.cpu.step();
      this.credit -= c;
      this.nmiCycles += c;
      if (this.nmiCycles >= Dm01.NMI_PERIOD) {
        this.nmiCycles -= Dm01.NMI_PERIOD;
        this.cpu.setNMI(true);
      }
    }
  }

  read8(addr: number): number {
    addr &= 0xffff;
    if (addr < 0x2000) return this.ram[addr];
    if (addr >= 0x4000) return this.rom[addr];
    switch (addr) {
      case 0x2000:
        return 0;
      case 0x2800:
        return 0;
      case 0x3000: {
        const v = this.queue[this.readPos];
        this.readPos = (this.readPos + 1) % this.queue.length;
        if (this.readPos === this.writePos) this.cpu.setIRQ(false);
        return v;
      }
      default:
        return 0;
    }
  }

  write8(addr: number, v: number): void {
    addr &= 0xffff;
    v &= 0xff;
    if (addr < 0x2000) {
      this.ram[addr] = v;
      return;
    }
    if (addr >= 0x4000) return;
    switch (addr) {
      case 0x2000: {
        const changed = this.control ^ v;
        this.control = v;
        if (changed & 0x02 && !(v & 0x02)) this.xcounter = 0;
        return;
      }
      case 0x2800: {
        if (this.xcounter < 9) this.scanline[this.xcounter++] = v;
        if (this.xcounter === 9) {
          this.xcounter = 0;
          this.scanlines++;
          const row = ((0xff ^ v) & 0x7c) >> 2;
          if (row < 21) {
            this.scanline[8] &= 0x80;
            this.dots.set(this.scanline, row * 9);
          }
        }
        return;
      }
      case 0x3800:
        this.cpu.setNMI(false);
        return;
      default:
        return;
    }
  }
}
