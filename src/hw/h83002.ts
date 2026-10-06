import type { Bus16 } from '../cpu/bus68k';
import { H8 } from '../cpu/h8';
import { H8Intc } from './h8intc';
import { H8Port } from './h8port';
import { H8Timer16 } from './h8timer16';
import { H8Sci } from './h8sci';
import { H8Watchdog } from './h8watchdog';

export class H83002 implements Bus16 {
  readonly cpu: H8;
  readonly intc: H8Intc;
  readonly timer: H8Timer16;

  readonly watchdog: H8Watchdog;

  readonly sci: readonly [H8Sci, H8Sci];

  readonly port4 = new H8Port(0x00, 0x00);
  readonly port6 = new H8Port(0x80, 0x80);
  readonly port7 = new H8Port(0x00, 0x00);
  readonly port8 = new H8Port(0xf0, 0xe0);
  readonly port9 = new H8Port(0x00, 0xc0);
  readonly portA = new H8Port(0x00, 0x00);
  readonly portB = new H8Port(0x00, 0x00);

  private readonly iram = new Uint8Array(0x200);

  readonly unmodelled = new Map<number, number>();

  constructor(private readonly board: Bus16) {
    this.cpu = new H8(this);
    this.intc = new H8Intc(this.cpu);
    this.timer = new H8Timer16(this.intc);
    this.watchdog = new H8Watchdog(this.intc, 20);
    this.watchdog.onReset = () => { this.reset(); };
    this.sci = [new H8Sci(this.intc, 52), new H8Sci(this.intc, 56)];
    this.reset();
  }

  reset(): void {
    this.cpu.reset();
    this.intc.reset();
    this.timer.reset();
    this.watchdog.reset(this.cpu.totalCycles);
    for (const s of this.sci) s.reset();
    for (const p of [this.port4, this.port6, this.port7, this.port8,
      this.port9, this.portA, this.portB]) p.reset();
  }

  step(): number {
    const cycles = this.cpu.step();
    this.timer.update(this.cpu.totalCycles);
    this.watchdog.update(this.cpu.totalCycles);
    return cycles;
  }

  private internal(a: number): boolean {
    if (a < 0xfffd10) return false;
    if (a < 0xffff10) return true;
    const off = a & 0xff;
    return (off >= 0x20 && off < 0x40)
      || (off >= 0x60 && off < 0xa0)
      || (off >= 0xa8 && off <= 0xab) || off === 0xad
      || (off >= 0xb0 && off <= 0xb5) || (off >= 0xb8 && off <= 0xbd)
      || (off >= 0xc5 && off <= 0xda)
      || (off >= 0xe0 && off <= 0xe9)
      || off === 0xf2
      || (off >= 0xf4 && off <= 0xf6) || off === 0xf8 || off === 0xf9;
  }

  read8(addr: number): number {
    const a = addr & 0xffffff;
    return this.internal(a) ? this.internalRead(a) : this.board.read8(a);
  }

  write8(addr: number, val: number): void {
    const a = addr & 0xffffff;
    if (this.internal(a)) this.internalWrite(a, val & 0xff);
    else this.board.write8(a, val & 0xff);
  }

  read16(addr: number): number {
    const a = addr & 0xfffffe;
    if (!this.internal(a) && !this.internal(a + 1)) return this.board.read16(a);
    return (this.read8(a) << 8) | this.read8(a + 1);
  }

  write16(addr: number, val: number): void {
    const a = addr & 0xfffffe;
    if (!this.internal(a) && !this.internal(a + 1)) {
      this.board.write16(a, val & 0xffff);
      return;
    }
    if (a === 0xffffa8) { this.watchdog.write16(this.cpu.totalCycles, val & 0xffff); return; }
    if (a === 0xffffaa) return;
    this.write8(a, (val >> 8) & 0xff);
    this.write8(a + 1, val & 0xff);
  }

  private internalRead(a: number): number {
    if (a < 0xffff10) return this.iram[a - 0xfffd10];
    const off = a & 0xff;
    const now = this.cpu.totalCycles;

    if (off >= 0x60 && off < 0xa0) return this.timer.read(now, off - 0x60);
    if (off === 0xa8 || off === 0xa9) return this.watchdog.read(now, (off - 0xa8) as 0 | 1);
    if (off === 0xaa || off === 0xab) return this.watchdog.readRst();
    if (off >= 0xb0 && off <= 0xb5) return this.sci[0].read(off - 0xb0);
    if (off >= 0xb8 && off <= 0xbd) return this.sci[1].read(off - 0xb8);
    if (off >= 0xc5 && off <= 0xda) return this.portRead(off);
    switch (off) {
      case 0xf2: return this.cpu.syscr;
      case 0xf4: return this.intc.iscrR();
      case 0xf5: return this.intc.ierR();
      case 0xf6: return this.intc.isrR();
      case 0xf8: return this.intc.icrR(1);
      case 0xf9: return this.intc.icrR(0);
      default: break;
    }
    this.unmodelled.set(a, (this.unmodelled.get(a) ?? 0) + 1);
    return 0;
  }

  private internalWrite(a: number, val: number): void {
    if (a < 0xffff10) {
      this.iram[a - 0xfffd10] = val;
      return;
    }
    const off = a & 0xff;
    const now = this.cpu.totalCycles;

    if (off >= 0x60 && off < 0xa0) {
      this.timer.write(now, off - 0x60, val);
      return;
    }
    if (off >= 0xa8 && off <= 0xab) return;
    if (off >= 0xb0 && off <= 0xb5) {
      this.sci[0].write(off - 0xb0, val);
      return;
    }
    if (off >= 0xb8 && off <= 0xbd) {
      this.sci[1].write(off - 0xb8, val);
      return;
    }
    if (off >= 0xc5 && off <= 0xda) {
      this.portWrite(off, val);
      return;
    }
    switch (off) {
      case 0xf2: this.cpu.syscr = val; this.cpu.updateIrqFilter(); return;
      case 0xf4: this.intc.iscrW(val); return;
      case 0xf5: this.intc.ierW(val); return;
      case 0xf6: this.intc.isrW(val); return;
      case 0xf8: this.intc.icrW(1, val); return;
      case 0xf9: this.intc.icrW(0, val); return;
      default: break;
    }
    this.unmodelled.set(a, (this.unmodelled.get(a) ?? 0) + 1);
  }

  private portRead(off: number): number {
    switch (off) {
      case 0xc5: return this.port4.ddrR();
      case 0xc7: return this.port4.portR();
      case 0xc9: return this.port6.ddrR();
      case 0xcb: return this.port6.portR();
      case 0xcd: return this.port8.ddrR();
      case 0xce: return this.port7.portR();
      case 0xcf: return this.port8.portR();
      case 0xd0: return this.port9.ddrR();
      case 0xd1: return this.portA.ddrR();
      case 0xd2: return this.port9.portR();
      case 0xd3: return this.portA.portR();
      case 0xd4: return this.portB.ddrR();
      case 0xd6: return this.portB.portR();
      case 0xda: return this.port4.pcrR();
      default:
        this.unmodelled.set(0xff0000 | off, (this.unmodelled.get(0xff0000 | off) ?? 0) + 1);
        return 0;
    }
  }

  private portWrite(off: number, val: number): void {
    switch (off) {
      case 0xc5: this.port4.ddrW(val); return;
      case 0xc7: this.port4.drW(val); return;
      case 0xc9: this.port6.ddrW(val); return;
      case 0xcb: this.port6.drW(val); return;
      case 0xcd: this.port8.ddrW(val); return;
      case 0xcf: this.port8.drW(val); return;
      case 0xd0: this.port9.ddrW(val); return;
      case 0xd1: this.portA.ddrW(val); return;
      case 0xd2: this.port9.drW(val); return;
      case 0xd3: this.portA.drW(val); return;
      case 0xd4: this.portB.ddrW(val); return;
      case 0xd6: this.portB.drW(val); return;
      case 0xda: this.port4.pcrW(val); return;
      default:
        this.unmodelled.set(0xff0000 | off, (this.unmodelled.get(0xff0000 | off) ?? 0) + 1);
    }
  }
}
