import { Reel } from './reel';
import { M68705P3 } from './m68705p3';

export const PCP_TICK_CYCLES = 2048;
export const PCP_MCU_HZ = 1_000_000;

export class AcePcpReelPcb {
  readonly mcu: M68705P3;
  readonly reels: readonly Reel[];

  onNmi: (() => void) | null = null;

  private latch = 0;
  private piso = 0;
  private portC = 0xff;
  private sipoShift = 0;
  private sipoBits = 0;
  private sipo = 0;

  ticks = 0;

  constructor(reels: readonly Reel[]) {
    this.reels = reels;
    this.mcu = new M68705P3({
      portIn: (n) => this.portIn(n),
      portOut: (n, v, ddr) => this.portOut(n, v, ddr),
    });
  }

  loadRom(bytes: Uint8Array): void {
    this.mcu.loadRom(bytes);
  }

  reset(): void {
    this.latch = 0;
    this.piso = 0;
    this.sipoShift = 0;
    this.sipoBits = 0;
    this.sipo = 0;
    this.portC = 0xff;
    this.ticks = 0;
    this.mcu.reset();
  }

  run(cycles: number): number {
    return this.mcu.run(cycles);
  }

  write(value: number): void {
    this.latch = value & 0xff;
    this.piso = this.latch;
  }

  read(): number {
    return this.sipo;
  }

  startFrame(): void {
    this.mcu.setInt(true);
    this.mcu.setInt(false);
  }

  opticsNibble(): number {
    let v = 0x0f;
    for (let i = 0; i < 4 && i < this.reels.length; i++) {
      if (this.reels[i].optic()) v &= ~(1 << i);
    }
    return v;
  }

  busyMask(): number {
    let m = 0;
    for (let i = 0; i < 4; i++) if (this.mcu.ram[0x36 - 0x10 + i] !== 0) m |= 1 << i;
    return m;
  }

  mcuPositions(): number[] {
    return [0, 1, 2, 3].map((i) => this.mcu.ram[0x42 - 0x10 + i]);
  }

  private portIn(n: number): number {
    if (n === 2) {
      return (this.portC & ~0x02) | (this.piso & 0x01 ? 0x02 : 0);
    }
    return 0xff;
  }

  private portOut(n: number, v: number, ddr: number): void {
    if (n === 2) {
      const level = (v | ~ddr) & 0xff;
      const prev = this.portC;
      this.portC = level;
      const rose = level & ~prev;
      if (rose & 0x08) this.clock(level);
      if (rose & 0x01) this.strobe();
      return;
    }
    const out = v & ddr;
    const first = n === 1 ? 0 : 2;
    this.reels[first]?.update(out & 0x0f);
    this.reels[first + 1]?.update((out >> 4) & 0x0f);
  }

  private clock(portC: number): void {
    this.sipoShift = ((this.sipoShift >> 1) | (portC & 0x04 ? 0x80 : 0)) & 0xff;
    if (++this.sipoBits >= 8) {
      this.sipo = this.sipoShift;
      this.sipoBits = 0;
    }
    this.piso = (this.piso >> 1) | 0x80;
  }

  private strobe(): void {
    this.ticks++;
    this.onNmi?.();
  }
}
