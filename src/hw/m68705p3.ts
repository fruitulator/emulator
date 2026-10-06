import type { Bus } from '../cpu/bus';
import { M6805 } from '../cpu/m6805';

const TCR_PS = 0x07;
const TCR_PSC = 0x08;
const TCR_TIE = 0x10;
const TCR_TIN = 0x20;
const TCR_TIM = 0x40;
const TCR_TIR = 0x80;

const PORT_MASK = [0x00, 0x00, 0xf0] as const;

export interface M68705Pins {
  portIn: (n: number) => number;
  portOut: (n: number, value: number, ddr: number) => void;
}

export class M68705P3 implements Bus {
  readonly cpu: M6805;
  readonly ram = new Uint8Array(0x70);
  private rom = new Uint8Array(0x800);

  readonly latch = new Uint8Array(3);
  readonly ddr = new Uint8Array(3);

  private tdr = 0xff;
  private tcr = 0x7f;
  private prescale = 0x7f;

  constructor(private readonly pins: M68705Pins) {
    this.cpu = new M6805(this, { addrMask: 0x7ff, spMask: 0x7f, spLow: 0x60 });
  }

  loadRom(bytes: Uint8Array): void {
    this.rom = new Uint8Array(0x800);
    this.rom.set(bytes.subarray(0, 0x800));
  }

  reset(): void {
    this.ddr.fill(0);
    this.latch.fill(0xff);
    this.tdr = 0xff;
    this.tcr = 0x7f;
    this.prescale = 0x7f;
    this.cpu.setTimerIrq(false);
    this.cpu.reset();
  }

  run(cycles: number): number {
    let done = 0;
    while (done < cycles) {
      const n = this.cpu.step();
      done += n;
      this.tickTimer(n);
    }
    return done;
  }

  setInt(asserted: boolean): void {
    this.cpu.setInt(asserted);
  }

  read8(addr: number): number {
    if (addr < 0x10) {
      switch (addr) {
        case 0x00: case 0x01: case 0x02: return this.portRead(addr);
        case 0x08: return this.tdr;
        case 0x09: return this.tcr & ~TCR_PSC;
        default: return 0xff;
      }
    }
    if (addr < 0x80) return this.ram[addr - 0x10];
    return this.rom[addr & 0x7ff];
  }

  write8(addr: number, v: number): void {
    v &= 0xff;
    if (addr < 0x10) {
      switch (addr) {
        case 0x00: case 0x01: case 0x02: this.portLatchWrite(addr, v); return;
        case 0x04: case 0x05: case 0x06: this.portDdrWrite(addr - 4, v); return;
        case 0x08: this.tdr = v; return;
        case 0x09: this.tcrWrite(v); return;
        default: return;
      }
    }
    if (addr < 0x80) this.ram[addr - 0x10] = v;
  }

  private portRead(n: number): number {
    const mask = PORT_MASK[n];
    const input = this.pins.portIn(n) & ~mask & 0xff;
    return (mask | (this.latch[n] & this.ddr[n]) | (input & ~this.ddr[n])) & 0xff;
  }

  private portLatchWrite(n: number, v: number): void {
    v &= ~PORT_MASK[n] & 0xff;
    const diff = this.latch[n] ^ v;
    this.latch[n] = v;
    if (diff & this.ddr[n]) this.pins.portOut(n, v, this.ddr[n]);
  }

  private portDdrWrite(n: number, v: number): void {
    v &= ~PORT_MASK[n] & 0xff;
    if (v === this.ddr[n]) return;
    this.ddr[n] = v;
    this.pins.portOut(n, this.latch[n], v);
  }

  private tcrWrite(v: number): void {
    if (v & TCR_PSC) this.prescale = 0;
    this.tcr = ((this.tcr & (v & TCR_TIR)) | (v & ~(TCR_TIR | TCR_PSC))) & 0xff;
    this.cpu.setTimerIrq((this.tcr & TCR_TIR) !== 0 && (this.tcr & TCR_TIM) === 0);
  }

  private tickTimer(count: number): void {
    const source = (this.tcr & (TCR_TIN | TCR_TIE)) >> 4;
    if (source === 2 || source === 3) return;
    const divisor = this.tcr & TCR_PS;
    const prescale = (this.prescale & ((1 << divisor) - 1)) + count;
    const decrements = prescale >> divisor;
    const interrupt = (this.tdr !== 0 ? this.tdr : 256) <= decrements;
    this.prescale = prescale & 0x7f;
    this.tdr = (this.tdr - decrements) & 0xff;
    if (interrupt) {
      this.tcr |= TCR_TIR;
      if (!(this.tcr & TCR_TIM)) this.cpu.setTimerIrq(true);
    }
  }
}
